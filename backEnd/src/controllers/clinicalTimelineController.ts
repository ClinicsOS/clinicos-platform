import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { Clinic } from "../models/Clinic";
import { Appointment } from "../models/Appointment";
import { ClinicalNote, type ClinicalNoteSource } from "../models/ClinicalNote";
import { DentalTreatmentItem } from "../models/DentalTreatmentItem";
import { DentalTreatmentSession } from "../models/DentalTreatmentSession";
import { DENTAL_SPECIALTY_ID } from "../config/dental";
import { loadNotePatient, who } from "./clinicalNoteController";

/**
 * PATIENT CLINICAL TIMELINE — a READ-ONLY merge of records that already exist, newest first. Nothing is copied or
 * stored: every event is derived at read time from the ONE record that owns it, so a retried request, a refresh or a
 * second screen can never create a second copy.
 *
 *   visit      Appointment                                     (what happened at the visit + the visit note)
 *   treatment  DentalTreatmentItem.statusHistory (+ creation)  planned / started / completed / cancelled — ONE row per milestone
 *   note       ClinicalNote, and treatment-session notes that carry text
 *
 * Why nothing shows up twice:
 *   - a treatment appears only through its own milestones; its sessions are NOT repeated as events (they would restate
 *     "started"/"completed"); only a session that carries written notes adds information, and then as a note;
 *   - the Dental Chart has no records of its own for treatments (it derives from the plan), so it contributes nothing here;
 *   - invoices are not clinical events: billing stays in the Treatment Plan / Invoices;
 *   - future (not yet happened) appointments are excluded — the Patient File already lists them under "Upcoming".
 *
 * Paging = keyset cursor over (at, key): every source is read with `at <= cursor` and a small over-fetch, the merged
 * list is cut to `limit`; no offsets, bounded payload, a handful of queries per page regardless of page size.
 */
const query = z.object({
  kind: z.enum(["all", "visit", "treatment", "note"]).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
  before: z.string().max(200).optional(), // "ISO|key"
});

type Kind = "visit" | "treatment" | "note";
interface Ctx { procedureCode?: string; customName?: string; targetType?: string; toothNumbers?: string[]; surfaces?: string[] }
interface Ev {
  key: string;
  kind: Kind;
  event: string;
  at: Date;
  by: { _id: string; name: string } | null;
  context: Ctx & { visitAt?: Date; visitStatus?: string; visitType?: string; visitSource?: string; sourceType?: ClinicalNoteSource };
  content?: string;
  appointmentId?: string;
  itemId?: string;
  noteId?: string;
  editable?: boolean;
  edited?: { at: Date; by: { _id: string; name: string } | null } | null;
  editCount?: number;
  reason?: string;
}

const OVERFETCH = 12;
const ITEM_CAP = 400; // a patient's treatment items; their milestones are derived in memory

export const getClinicalTimeline = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadNotePatient(req, res);
  if (!patient) return;
  const q = query.parse(req.query);
  const limit = q.limit ?? 25;
  const kind = q.kind ?? "all";

  let curAt: Date | null = null;
  let curKey = "";
  if (q.before) {
    const cut = q.before.indexOf("|");
    const at = new Date(cut > 0 ? q.before.slice(0, cut) : q.before);
    if (Number.isNaN(at.getTime()) || cut < 0) return res.status(400).json({ message: "Invalid cursor" });
    curAt = at;
    curKey = q.before.slice(cut + 1);
  }
  const base = { clinicId: req.clinicId, patientId: patient._id };
  const N = limit + OVERFETCH;
  const wantV = kind === "all" || kind === "visit";
  const wantT = kind === "all" || kind === "treatment";
  const wantN = kind === "all" || kind === "note";

  const clinic = wantT || wantN ? await Clinic.findById(req.clinicId).select("specialty").lean<{ specialty?: string } | null>() : null;
  const dental = clinic?.specialty === DENTAL_SPECIALTY_ID;

  const now = new Date();
  const [appts, notes, items, sessions] = await Promise.all([
    wantV
      ? Appointment.find({
          ...base,
          type: { $ne: "blocked" },
          $and: [
            { $or: [{ startAt: { $lte: now } }, { status: { $in: ["completed", "cancelled", "no_show"] } }] },
            ...(curAt ? [{ startAt: { $lte: curAt } }] : []),
          ],
        })
          .select("startAt duration status source visitType visitNote cancelReason doctorId")
          .populate("doctorId", "name")
          .sort({ startAt: -1, _id: -1 })
          .limit(N)
          .lean()
      : [],
    wantN
      ? ClinicalNote.find({ ...base, ...(curAt ? { createdAt: { $lte: curAt } } : {}) })
          .select("-revisions")
          .populate("authorId", "name")
          .populate("lastEditedBy", "name")
          .sort({ createdAt: -1, _id: -1 })
          .limit(N)
          .lean()
      : [],
    dental && (wantT || wantN)
      ? DentalTreatmentItem.find(base)
          .select("procedureCode customName targetType toothNumbers surfaces status statusHistory cancelReason createdAt createdBy")
          .populate("createdBy", "name")
          .populate("statusHistory.by", "name")
          .sort({ updatedAt: -1 })
          .limit(ITEM_CAP)
          .lean()
      : [],
    dental && wantN
      ? DentalTreatmentSession.find({ ...base, notes: { $exists: true, $ne: "" }, ...(curAt ? { startedAt: { $lte: curAt } } : {}) })
          .select("itemId appointmentId sessionNumber procedureCode customName targetType toothNumbers surfaces notes startedAt performedBy")
          .populate("performedBy", "name")
          .sort({ startedAt: -1, _id: -1 })
          .limit(N)
          .lean()
      : [],
  ]);

  const events: Ev[] = [];

  for (const a of appts) {
    events.push({
      key: `visit:${a._id}`, kind: "visit", event: a.status, at: a.startAt, by: who(a.doctorId),
      context: { visitType: a.visitType ?? "consultation", visitStatus: a.status, ...(a.source === "walk_in" ? { visitSource: "walk_in" } : {}) },
      content: a.visitNote || undefined, appointmentId: String(a._id),
      reason: a.status === "cancelled" ? a.cancelReason || undefined : undefined,
    });
  }

  // Context for notes that belong to a visit / treatment: two batched lookups, never one query per note.
  const treatById = new Map<string, Ctx>(items.map((i) => [String(i._id), { procedureCode: i.procedureCode, customName: i.customName ?? undefined, targetType: i.targetType, toothNumbers: i.toothNumbers ?? [], surfaces: i.surfaces ?? [] }]));
  const apptIds = notes.filter((n) => n.sourceType === "appointment" && n.sourceId).map((n) => String(n.sourceId));
  const missingTreat = notes.filter((n) => n.sourceType === "dental_treatment" && n.sourceId && !treatById.has(String(n.sourceId))).map((n) => n.sourceId as Types.ObjectId);
  const [visitRows, treatRows] = await Promise.all([
    apptIds.length ? Appointment.find({ ...base, _id: { $in: apptIds } }).select("startAt status").lean() : [],
    missingTreat.length ? DentalTreatmentItem.find({ ...base, _id: { $in: missingTreat } }).select("procedureCode customName targetType toothNumbers surfaces").lean() : [],
  ]);
  const visitById = new Map(visitRows.map((v) => [String(v._id), v]));
  for (const t of treatRows) treatById.set(String(t._id), { procedureCode: t.procedureCode, customName: t.customName ?? undefined, targetType: t.targetType, toothNumbers: t.toothNumbers ?? [], surfaces: t.surfaces ?? [] });

  for (const n of notes) {
    const sid = n.sourceId ? String(n.sourceId) : "";
    const v = n.sourceType === "appointment" ? visitById.get(sid) : undefined;
    events.push({
      key: `note:${n._id}`, kind: "note", event: "note", at: n.createdAt, by: who(n.authorId), content: n.text,
      noteId: String(n._id), editable: true, editCount: n.editCount ?? 0,
      edited: (n.editCount ?? 0) > 0 ? { at: n.lastEditedAt ?? n.updatedAt, by: who(n.lastEditedBy) } : null,
      context: { sourceType: n.sourceType, ...(n.sourceType === "dental_treatment" ? treatById.get(sid) ?? {} : {}), ...(v ? { visitAt: v.startAt, visitStatus: v.status } : {}) },
      ...(n.sourceType === "appointment" && sid ? { appointmentId: sid } : {}),
      ...(n.sourceType === "dental_treatment" && sid ? { itemId: sid } : {}),
    });
  }

  if (wantT) {
    for (const it of items) {
      const ctx: Ctx = { procedureCode: it.procedureCode, customName: it.customName ?? undefined, targetType: it.targetType, toothNumbers: it.toothNumbers ?? [], surfaces: it.surfaces ?? [] };
      events.push({ key: `treatment:${it._id}:planned`, kind: "treatment", event: "planned", at: it.createdAt, by: who(it.createdBy), context: ctx, itemId: String(it._id) });
      (it.statusHistory ?? []).forEach((h, i) => {
        if (h.status === "planned") return; // = the creation event above
        events.push({
          key: `treatment:${it._id}:${h.status}:${i}`, kind: "treatment", event: h.status, at: h.at, by: who(h.by), context: ctx, itemId: String(it._id),
          ...(h.appointmentId ? { appointmentId: String(h.appointmentId) } : {}),
          ...(h.status === "cancelled" ? { reason: it.cancelReason || h.note || undefined } : {}),
        });
      });
    }
  }

  // Treatment-session notes: a session is NOT an event of its own (see header); its written notes are.
  for (const s of sessions) {
    events.push({
      key: `note:session:${s._id}`, kind: "note", event: "session_note", at: s.startedAt, by: who(s.performedBy), content: s.notes || undefined,
      itemId: String(s.itemId), appointmentId: String(s.appointmentId), editable: false,
      context: { procedureCode: s.procedureCode, customName: s.customName ?? undefined, targetType: s.targetType, toothNumbers: s.toothNumbers ?? [], surfaces: s.surfaces ?? [] },
    });
  }

  const keep = (e: Ev) => !curAt || e.at < curAt || (e.at.getTime() === curAt.getTime() && e.key < curKey);
  const merged = events
    .map((e) => ({ ...e, at: new Date(e.at) }))
    .filter(keep)
    .sort((a, b) => b.at.getTime() - a.at.getTime() || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));

  const page = merged.slice(0, limit);
  const last = page[page.length - 1];
  return res.json({
    events: page,
    nextCursor: merged.length > limit && last ? `${last.at.toISOString()}|${last.key}` : null,
  });
});
