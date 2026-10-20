/**
 * PHASE 3 — UNIFIED CLINICAL HISTORY (Patient Profile → History).
 *
 * ONE chronological list of every genuine clinical NOTE of a patient, wherever it was written. It is a READ-ONLY aggregation: nothing is copied
 * or stored, each item is derived at read time from the ONE record that owns the text, so a note can never exist twice and an edit made at
 * the source is what the timeline shows.
 *
 *   sourceType        where the note lives                                         noteId (stable id of the note inside its source)
 *   ───────────────   ───────────────────────────────────────────────────────────  ─────────────────────────────────────────────────
 *   appointment       Appointment.visitNote                                          "visit-note"
 *                     ClinicalNote (sourceType appointment)                          the ClinicalNote _id
 *   treatment_plan    DentalTreatmentItem.notes  /  DermTreatmentItem.notes          "item-notes"
 *                     DentalTreatmentSession.notes / DermTreatmentSession.procedureNotes   "session:<sessionId>"
 *                     ClinicalNote (sourceType dental_treatment | derm_treatment)    the ClinicalNote _id
 *   dental_chart      DentalToothEvent.note (a condition / diagnosis on a tooth)     "note"
 *                     DentalToothEvent.resolution.note                               "resolution"
 *   clinical_map      DermAssessment.notes                                           "assessment-notes"
 *                     DermFollowUp.notes                                             "follow-up-notes"
 *   clinical_note     ClinicalNote (sourceType patient — a general note)             the ClinicalNote _id
 *
 * Uniqueness: `id = sourceType:sourceId:noteId` — one document can yield several items (a treatment item and its session notes) but never the
 * same (source, note) twice, and the merge step drops any repeat of an id.
 *
 * NOT clinical notes (deliberately excluded, never mixed in): treatment status changes / cancel reasons, billing, invoices (incl. deleted ones),
 * logins, reports, UI actions, ActivityLog rows, Appointment.procedureNote / blockNote (scheduling info), Patient.medicalNotes (one undated,
 * un-attributed field of the intake form — it is shown on the Overview, not as a timeline event).
 *
 * Authorization is NOT decided here: the controller admits the request only through the canonical `canAccessPatient` (Phase 1), and every
 * query below is additionally scoped by { clinicId, patientId }.
 *
 * Paging = keyset cursor over (at, id): every source is read with `at <= cursor` and a small over-fetch; the merged list is cut to `limit`.
 * No offsets, bounded payload, a fixed handful of queries per page whatever the patient's history size.
 */
import type { Types } from "mongoose";
import { Appointment } from "../models/Appointment";
import { ClinicalNote, type ClinicalNoteSource } from "../models/ClinicalNote";
import { DentalToothEvent } from "../models/DentalToothEvent";
import { DentalTreatmentItem } from "../models/DentalTreatmentItem";
import { DentalTreatmentSession } from "../models/DentalTreatmentSession";
import { DermAssessment } from "../models/DermAssessment";
import { DermFollowUp } from "../models/DermFollowUp";
import { DermTreatmentItem } from "../models/DermTreatmentItem";
import { DermTreatmentSession } from "../models/DermTreatmentSession";
import { User } from "../models/User";
import { DENTAL_SPECIALTY_ID } from "../config/dental";
import { DERM_SPECIALTY_ID } from "../config/dermatology";
import { PROCEDURES } from "../config/dentalProcedures";
import { clinicYmdOf } from "../utils/timezone";

export const HISTORY_SOURCES = ["appointment", "treatment_plan", "dental_chart", "clinical_map", "clinical_note"] as const;
export type HistorySource = (typeof HISTORY_SOURCES)[number];

/** The tab a deep link opens. These are the stable names used in the Patient Profile URL (`?tab=`). */
export type HistoryTab = "appointment" | "treatment-plan" | "dental-chart" | "derm-plan" | "clinical-map" | "record";

export interface HistoryDeepLink {
  tab: HistoryTab;
  sourceId: string;
  noteId: string;
  appointmentId?: string;
  appointmentDate?: string; // clinic-local YYYY-MM-DD of the visit
  itemId?: string;
  sessionId?: string;
  eventId?: string;
  assessmentId?: string;
  followUpId?: string;
  toothNumber?: string;
  surface?: string;
}

export interface ClinicalTimelineItem {
  id: string;
  patientId: string;
  clinicId: string;
  sourceType: HistorySource;
  /** The finer kind of note (visit_note, clinical_note, item_note, session_note, tooth_note, tooth_resolution, assessment_note, follow_up_note). */
  sourceKind: string;
  sourceId: string;
  noteId: string;
  doctorId: string | null;
  doctorName: string | null;
  /** The instant the timeline sorts by (a visit note: the visit; every other note: when it was written). */
  at: string;
  createdAt: string;
  updatedAt: string;
  /** Clinic-local calendar day (YYYY-MM-DD) of `at` — what Today / Yesterday grouping is computed from, never the browser's zone. */
  localDate: string;
  text: string;
  edited: boolean;
  editedAt?: string;
  /** The record was marked "entered in error" at its source (kept, never hidden — shown as such). */
  status?: "entered_in_error";
  toothNumber?: string;
  toothNumbers?: string[];
  surface?: string;
  surfaces?: string[];
  treatment?: { code?: string; customName?: string; name?: string; sessionNumber?: number; status?: string };
  /** Dermatology: anatomical regions the record is about (ids; the UI localises them). */
  regions?: { id: string; surface?: string }[];
  /** Condition / diagnosis code of a Dental Chart entry (e.g. "caries"). */
  chart?: { category?: string; code?: string };
  appointment?: { id: string; startAt: string; localDate: string; status?: string };
  /** The note refers to a record that no longer exists. The note itself stays readable. */
  sourceMissing?: boolean;
  deepLink: HistoryDeepLink;
}

export interface HistoryQuery {
  clinicId: Types.ObjectId | string;
  patientId: Types.ObjectId | string;
  specialty?: string;
  source?: HistorySource | "all";
  q?: string;
  limit: number;
  cursor?: { at: Date; id: string } | null;
}

export interface HistoryPage {
  items: ClinicalTimelineItem[];
  nextCursor: string | null;
  /** Which source filters make sense for this clinic (the UI shows exactly these chips). */
  sources: HistorySource[];
}

const OVERFETCH = 12;
const NON_EMPTY = { $exists: true, $nin: [null, ""] };
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const iso = (d: unknown) => (d ? new Date(d as Date).toISOString() : new Date(0).toISOString());
const s = (x: unknown) => (x == null ? "" : String(x));
const idOf = (x: unknown): string | null => {
  const v = x as { _id?: unknown } | null | undefined;
  return v && typeof v === "object" && "_id" in v && v._id ? String(v._id) : x ? String(x) : null;
};
const nameOf = (x: unknown): string | null => {
  const v = x as { name?: unknown } | null | undefined;
  return v && typeof v === "object" && typeof v.name === "string" ? v.name : null;
};
const humanize = (code: string) => code.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const treatmentName = (code?: string, custom?: string | null) => (custom ? custom : code ? humanize(code) : undefined);

export const sourcesForSpecialty = (specialty?: string): HistorySource[] => {
  const out: HistorySource[] = ["appointment"];
  // a Treatment Plan only exists in the two specialty modules; other clinics have visits + clinical notes
  if (specialty === DENTAL_SPECIALTY_ID || specialty === DERM_SPECIALTY_ID) out.push("treatment_plan");
  if (specialty === DENTAL_SPECIALTY_ID) out.push("dental_chart");
  if (specialty === DERM_SPECIALTY_ID) out.push("clinical_map");
  out.push("clinical_note");
  return out;
};

/** "ISO|id" -> cursor (null when malformed). */
export function parseCursor(raw: string | undefined): { at: Date; id: string } | null | "invalid" {
  if (!raw) return null;
  const cut = raw.indexOf("|");
  if (cut <= 0) return "invalid";
  const at = new Date(raw.slice(0, cut));
  if (Number.isNaN(at.getTime())) return "invalid";
  return { at, id: raw.slice(cut + 1) };
}

export async function getClinicalHistory(opts: HistoryQuery): Promise<HistoryPage> {
  const { clinicId, patientId, limit } = opts;
  const base = { clinicId, patientId };
  const dental = opts.specialty === DENTAL_SPECIALTY_ID;
  const derm = opts.specialty === DERM_SPECIALTY_ID;
  const available = sourcesForSpecialty(opts.specialty);
  const want = (src: HistorySource) => (!opts.source || opts.source === "all" ? true : opts.source === src) && available.includes(src);
  const cur = opts.cursor ?? null;
  const N = limit + OVERFETCH;
  const now = new Date();

  // ------------------------------------------------------------------ search (optional)
  const q = (opts.q ?? "").trim().slice(0, 80);
  const rx = q ? new RegExp(escapeRegExp(q), "i") : null;
  const isTooth = /^\d{2}$/.test(q);
  let doctorIds: Types.ObjectId[] = [];
  let procCodes: string[] = [];
  let itemIdsDental: Types.ObjectId[] = [];
  let itemIdsDerm: Types.ObjectId[] = [];
  if (rx) {
    doctorIds = (await User.find({ clinicId, name: rx }).select("_id").limit(50).lean()).map((u) => u._id as Types.ObjectId);
    const lq = q.toLowerCase();
    procCodes = PROCEDURES.filter((p) => p.code.replace(/_/g, " ").includes(lq) || p.code.includes(lq)).map((p) => p.code);
    const itemMatch = (extra: Record<string, unknown>[]) => ({ ...base, $or: [{ procedureCode: { $in: procCodes } }, ...extra] });
    if (dental && (want("treatment_plan") || want("clinical_note")))
      itemIdsDental = (await DentalTreatmentItem.find(itemMatch([{ customName: rx }, ...(isTooth ? [{ toothNumbers: q }] : [])])).select("_id").limit(300).lean()).map((i) => i._id as Types.ObjectId);
    if (derm && want("treatment_plan")) itemIdsDerm = (await DermTreatmentItem.find(itemMatch([{ regionIds: rx }])).select("_id").limit(300).lean()).map((i) => i._id as Types.ObjectId);
  }
  /** $or for a source: text matches OR one of the extra clauses. */
  const search = (fields: string[], extra: Record<string, unknown>[] = []) =>
    rx ? { $or: [...fields.map((f) => ({ [f]: rx })), ...extra] } : null;
  const withCursor = (field: string) => (cur ? { [field]: { $lte: cur.at } } : null);
  const and = (...parts: (Record<string, unknown> | null)[]) => {
    const list = parts.filter(Boolean) as Record<string, unknown>[];
    return list.length ? { $and: list } : {};
  };
  const byDoctor = (field: string) => (doctorIds.length ? [{ [field]: { $in: doctorIds } }] : []);

  // ------------------------------------------------------------------ reads (one query per source, all in parallel)
  const [visits, notes, dItems, dSessions, events, rItems, rSessions, assessments, followUps] = await Promise.all([
    want("appointment")
      ? Appointment.find({
          ...base,
          type: { $ne: "blocked" },
          visitNote: NON_EMPTY,
          // a visit that has not happened yet is "Upcoming", not history (same rule as the Clinical Record timeline)
          $and: [
            { $or: [{ startAt: { $lte: now } }, { status: { $in: ["completed", "cancelled", "no_show"] } }] },
            ...[withCursor("startAt"), search(["visitNote"], byDoctor("doctorId"))].filter(Boolean) as Record<string, unknown>[],
          ],
        })
          .select("startAt status doctorId visitNote createdAt updatedAt")
          .populate("doctorId", "name")
          .sort({ startAt: -1, _id: -1 })
          .limit(N)
          .lean()
      : [],
    want("appointment") || want("treatment_plan") || want("clinical_note")
      ? ClinicalNote.find({
          ...base,
          ...and(
            withCursor("createdAt"),
            opts.source && opts.source !== "all"
              ? { sourceType: { $in: noteSourceTypesFor(opts.source) } }
              : { sourceType: { $in: noteSourceTypesFor("all", available) } },
            search(["text"], [...byDoctor("authorId"), ...(itemIdsDental.length || itemIdsDerm.length ? [{ sourceId: { $in: [...itemIdsDental, ...itemIdsDerm] } }] : [])])
          ),
        })
          .select("-revisions")
          .populate("authorId", "name")
          .sort({ createdAt: -1, _id: -1 })
          .limit(N)
          .lean()
      : [],
    dental && want("treatment_plan")
      ? DentalTreatmentItem.find({
          ...base,
          notes: NON_EMPTY,
          ...and(withCursor("createdAt"), search(["notes", "customName"], [...byDoctor("createdBy"), ...(itemIdsDental.length ? [{ _id: { $in: itemIdsDental } }] : [])])),
        })
          .select("procedureCode customName targetType toothNumbers surfaces status notes createdBy createdAt updatedAt")
          .populate("createdBy", "name")
          .sort({ createdAt: -1, _id: -1 })
          .limit(N)
          .lean()
      : [],
    dental && want("treatment_plan")
      ? DentalTreatmentSession.find({
          ...base,
          notes: NON_EMPTY,
          ...and(withCursor("startedAt"), search(["notes"], [...byDoctor("performedBy"), ...(itemIdsDental.length ? [{ itemId: { $in: itemIdsDental } }] : [])])),
        })
          .select("itemId appointmentId sessionNumber procedureCode customName targetType toothNumbers surfaces status notes performedBy startedAt createdAt updatedAt")
          .populate("performedBy", "name")
          .sort({ startedAt: -1, _id: -1 })
          .limit(N)
          .lean()
      : [],
    dental && want("dental_chart")
      ? DentalToothEvent.find({
          ...base,
          $or: [{ note: NON_EMPTY }, { "resolution.note": NON_EMPTY }],
          ...and(
            cur ? { $or: [{ createdAt: { $lte: cur.at } }, { "resolution.at": { $lte: cur.at } }] } : null,
            search(["note", "resolution.note", "code"], [...byDoctor("createdBy"), ...(isTooth ? [{ fdi: q }] : [])])
          ),
        })
          .select("fdi category code surfaces note status createdBy createdAt updatedAt resolution")
          .populate("createdBy", "name")
          .populate("resolution.by", "name")
          .sort({ createdAt: -1, _id: -1 })
          .limit(N * 2)
          .lean()
      : [],
    derm && want("treatment_plan")
      ? DermTreatmentItem.find({
          ...base,
          notes: NON_EMPTY,
          ...and(withCursor("createdAt"), search(["notes"], [...byDoctor("createdBy"), ...(itemIdsDerm.length ? [{ _id: { $in: itemIdsDerm } }] : [])])),
        })
          .select("procedureCode regions status notes createdBy createdAt updatedAt")
          .populate("createdBy", "name")
          .sort({ createdAt: -1, _id: -1 })
          .limit(N)
          .lean()
      : [],
    derm && want("treatment_plan")
      ? DermTreatmentSession.find({
          ...base,
          procedureNotes: NON_EMPTY,
          ...and(withCursor("startedAt"), search(["procedureNotes"], [...byDoctor("performedBy"), ...(itemIdsDerm.length ? [{ itemId: { $in: itemIdsDerm } }] : [])])),
        })
          .select("itemId appointmentId sessionNumber procedureCode regions status procedureNotes performedBy startedAt createdAt updatedAt")
          .populate("performedBy", "name")
          .sort({ startedAt: -1, _id: -1 })
          .limit(N)
          .lean()
      : [],
    derm && want("clinical_map")
      ? DermAssessment.find({
          ...base,
          notes: NON_EMPTY,
          ...and(withCursor("createdAt"), search(["notes", "diagnosis", "concern"], [...byDoctor("createdBy"), ...(rx ? [{ regionIds: rx }] : [])])),
        })
          .select("appointmentId regions status notes createdBy createdAt updatedAt rev")
          .populate("createdBy", "name")
          .sort({ createdAt: -1, _id: -1 })
          .limit(N)
          .lean()
      : [],
    derm && want("clinical_map")
      ? DermFollowUp.find({
          ...base,
          notes: NON_EMPTY,
          ...and(withCursor("createdAt"), search(["notes"], [...byDoctor("createdBy"), ...(rx ? [{ regionIds: rx }] : [])])),
        })
          .select("itemId sessionId assessmentId appointmentId regions status notes createdBy createdAt updatedAt rev")
          .populate("createdBy", "name")
          .sort({ createdAt: -1, _id: -1 })
          .limit(N)
          .lean()
      : [],
  ]);

  // ------------------------------------------------------------------ lookups for context (batched, never one query per note)
  const apptIds = new Set<string>();
  const dentalItemIds = new Set<string>();
  const dermItemIds = new Set<string>();
  for (const n of notes as any[]) {
    if (!n.sourceId) continue;
    if (n.sourceType === "appointment") apptIds.add(String(n.sourceId));
    else if (n.sourceType === "dental_treatment") dentalItemIds.add(String(n.sourceId));
    else if (n.sourceType === "derm_treatment") dermItemIds.add(String(n.sourceId));
  }
  for (const x of [...(dSessions as any[]), ...(rSessions as any[])]) if (x.appointmentId) apptIds.add(String(x.appointmentId));
  for (const x of dSessions as any[]) dentalItemIds.add(String(x.itemId));
  for (const x of rSessions as any[]) dermItemIds.add(String(x.itemId));
  const [apptRows, dentalItemRows, dermItemRows] = await Promise.all([
    apptIds.size ? Appointment.find({ ...base, _id: { $in: [...apptIds] } }).select("startAt status doctorId").lean() : [],
    dentalItemIds.size ? DentalTreatmentItem.find({ ...base, _id: { $in: [...dentalItemIds] } }).select("procedureCode customName targetType toothNumbers surfaces status").lean() : [],
    dermItemIds.size ? DermTreatmentItem.find({ ...base, _id: { $in: [...dermItemIds] } }).select("procedureCode regions status").lean() : [],
  ]);
  const apptById = new Map((apptRows as any[]).map((a) => [String(a._id), a]));
  const dItemById = new Map((dentalItemRows as any[]).map((i) => [String(i._id), i]));
  const rItemById = new Map((dermItemRows as any[]).map((i) => [String(i._id), i]));
  const apptRef = (a: any) => (a ? { id: String(a._id), startAt: iso(a.startAt), localDate: clinicYmdOf(new Date(a.startAt)), status: a.status as string } : undefined);

  // ------------------------------------------------------------------ normalise
  const cid = String(clinicId);
  const pid = String(patientId);
  const out: ClinicalTimelineItem[] = [];
  const push = (
    sourceType: HistorySource,
    sourceKind: string,
    sourceId: string,
    noteId: string,
    at: Date,
    createdAt: Date,
    updatedAt: Date,
    doc: Omit<Partial<ClinicalTimelineItem>, "deepLink"> & { text: string; deepLink: Omit<HistoryDeepLink, "sourceId" | "noteId"> },
    doctor: unknown
  ) => {
    const atD = new Date(at);
    out.push({
      id: `${sourceType}:${sourceId}:${noteId}`,
      patientId: pid,
      clinicId: cid,
      sourceType,
      sourceKind,
      sourceId,
      noteId,
      doctorId: idOf(doctor),
      doctorName: nameOf(doctor),
      at: atD.toISOString(),
      createdAt: iso(createdAt),
      updatedAt: iso(updatedAt),
      localDate: clinicYmdOf(atD),
      edited: false,
      ...doc,
      deepLink: { ...doc.deepLink, sourceId, noteId },
    });
  };

  // Appointment.visitNote — attributed to the visit's doctor (the field has no author of its own); sorted at the visit's time.
  for (const a of visits as any[]) {
    const ref = apptRef(a)!;
    push("appointment", "visit_note", String(a._id), "visit-note", a.startAt, a.startAt, a.updatedAt ?? a.startAt,
      { text: s(a.visitNote), appointment: ref, deepLink: { tab: "appointment", appointmentId: ref.id, appointmentDate: ref.localDate } }, a.doctorId);
  }

  // ClinicalNote — the editable notes of the Patient File; `text` is the current authoritative version.
  for (const n of notes as any[]) {
    const sid = n.sourceId ? String(n.sourceId) : "";
    const edited = (n.editCount ?? 0) > 0;
    const common = { text: s(n.text), edited, ...(edited ? { editedAt: iso(n.lastEditedAt ?? n.updatedAt) } : {}) };
    const st = (n.sourceType ?? "patient") as ClinicalNoteSource;
    if (st === "appointment") {
      const a = apptById.get(sid);
      const ref = apptRef(a);
      push("appointment", "clinical_note", sid || String(n._id), String(n._id), n.createdAt, n.createdAt, n.updatedAt,
        { ...common, ...(ref ? { appointment: ref } : { sourceMissing: true }), deepLink: { tab: "appointment", appointmentId: sid || undefined, appointmentDate: ref?.localDate } }, n.authorId);
    } else if (st === "dental_treatment") {
      const it: any = dItemById.get(sid);
      push("treatment_plan", "clinical_note", sid || String(n._id), String(n._id), n.createdAt, n.createdAt, n.updatedAt,
        { ...common, ...(it ? dentalItemContext(it) : { sourceMissing: true }), deepLink: { tab: "treatment-plan", itemId: sid || undefined, toothNumber: it?.toothNumbers?.[0] } }, n.authorId);
    } else if (st === "derm_treatment") {
      const it: any = rItemById.get(sid);
      push("treatment_plan", "clinical_note", sid || String(n._id), String(n._id), n.createdAt, n.createdAt, n.updatedAt,
        { ...common, ...(it ? dermItemContext(it) : { sourceMissing: true }), deepLink: { tab: "derm-plan", itemId: sid || undefined } }, n.authorId);
    } else {
      push("clinical_note", "clinical_note", String(n._id), String(n._id), n.createdAt, n.createdAt, n.updatedAt,
        { ...common, deepLink: { tab: "record" } }, n.authorId);
    }
  }

  // Treatment Plan — notes typed on the item itself, and the notes of the sessions performed for it.
  for (const it of dItems as any[]) {
    push("treatment_plan", "item_note", String(it._id), "item-notes", it.createdAt, it.createdAt, it.updatedAt,
      { text: s(it.notes), ...dentalItemContext(it), deepLink: { tab: "treatment-plan", itemId: String(it._id), toothNumber: it.toothNumbers?.[0] } }, it.createdBy);
  }
  for (const x of dSessions as any[]) {
    const item: any = dItemById.get(String(x.itemId));
    const ap = apptRef(apptById.get(String(x.appointmentId)));
    push("treatment_plan", "session_note", String(x.itemId), `session:${x._id}`, x.startedAt, x.createdAt, x.updatedAt,
      { text: s(x.notes), ...(item ? dentalItemContext(item) : dentalItemContext(x)), treatment: { ...(dentalItemContext(item ?? x).treatment ?? {}), sessionNumber: x.sessionNumber }, ...(ap ? { appointment: ap } : {}),
        ...(item ? {} : { sourceMissing: true }),
        deepLink: { tab: "treatment-plan", itemId: String(x.itemId), sessionId: String(x._id), toothNumber: (item ?? x).toothNumbers?.[0] } }, x.performedBy);
  }
  for (const it of rItems as any[]) {
    push("treatment_plan", "item_note", String(it._id), "item-notes", it.createdAt, it.createdAt, it.updatedAt,
      { text: s(it.notes), ...dermItemContext(it), deepLink: { tab: "derm-plan", itemId: String(it._id) } }, it.createdBy);
  }
  for (const x of rSessions as any[]) {
    const item: any = rItemById.get(String(x.itemId));
    const ap = apptRef(apptById.get(String(x.appointmentId)));
    push("treatment_plan", "session_note", String(x.itemId), `session:${x._id}`, x.startedAt, x.createdAt, x.updatedAt,
      { text: s(x.procedureNotes), ...dermItemContext(item ?? x), treatment: { ...(dermItemContext(item ?? x).treatment ?? {}), sessionNumber: x.sessionNumber }, ...(ap ? { appointment: ap } : {}),
        ...(item ? {} : { sourceMissing: true }),
        deepLink: { tab: "derm-plan", itemId: String(x.itemId), sessionId: String(x._id) } }, x.performedBy);
  }

  // Dental Chart — the note typed when a condition / diagnosis was recorded on a tooth, and the note of its resolution.
  for (const e of events as any[]) {
    const common = {
      toothNumber: e.fdi, toothNumbers: [e.fdi], ...(e.surfaces?.length ? { surface: e.surfaces[0], surfaces: e.surfaces } : {}),
      chart: { category: e.category, code: e.code },
      ...(e.resolution?.reason === "entered_in_error" ? { status: "entered_in_error" as const } : {}),
    };
    const link = { tab: "dental-chart" as const, toothNumber: e.fdi, eventId: String(e._id), ...(e.surfaces?.length ? { surface: e.surfaces[0] } : {}) };
    if (e.note) push("dental_chart", "tooth_note", String(e._id), "note", e.createdAt, e.createdAt, e.createdAt, { text: s(e.note), ...common, deepLink: link }, e.createdBy);
    if (e.resolution?.note && e.resolution.at) {
      push("dental_chart", "tooth_resolution", String(e._id), "resolution", e.resolution.at, e.resolution.at, e.resolution.at, { text: s(e.resolution.note), ...common, deepLink: link }, e.resolution.by ?? e.createdBy);
    }
  }

  // Dermatology — the clinical-map assessment notes and follow-up notes.
  for (const a of assessments as any[]) {
    push("clinical_map", "assessment_note", String(a._id), "assessment-notes", a.createdAt, a.createdAt, a.updatedAt,
      { text: s(a.notes), regions: a.regions ?? [], edited: (a.rev ?? 0) > 0, ...((a.rev ?? 0) > 0 ? { editedAt: iso(a.updatedAt) } : {}), ...(a.status === "entered_in_error" ? { status: "entered_in_error" as const } : {}),
        deepLink: { tab: "clinical-map", assessmentId: String(a._id) } }, a.createdBy);
  }
  for (const f of followUps as any[]) {
    push("clinical_map", "follow_up_note", String(f._id), "follow-up-notes", f.createdAt, f.createdAt, f.updatedAt,
      { text: s(f.notes), regions: f.regions ?? [], edited: (f.rev ?? 0) > 0, ...((f.rev ?? 0) > 0 ? { editedAt: iso(f.updatedAt) } : {}), ...(f.status === "entered_in_error" ? { status: "entered_in_error" as const } : {}),
        deepLink: { tab: "clinical-map", followUpId: String(f._id), itemId: f.itemId ? String(f.itemId) : undefined } }, f.createdBy);
  }

  // ------------------------------------------------------------------ merge: dedupe → newest first → keyset cut
  const seen = new Set<string>();
  const unique = out.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)));
  const before = (i: ClinicalTimelineItem) => !cur || new Date(i.at) < cur.at || (new Date(i.at).getTime() === cur.at.getTime() && i.id < cur.id);
  const searchOk = (i: ClinicalTimelineItem) => !rx || textMatches(i, rx, q, isTooth);
  const merged = unique
    .filter(before)
    .filter(searchOk)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  const page = merged.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page, nextCursor: merged.length > limit && last ? `${last.at}|${last.id}` : null, sources: available };
}

/** ClinicalNote.sourceType values that belong to a given history filter. */
function noteSourceTypesFor(source: HistorySource | "all", available?: HistorySource[]): ClinicalNoteSource[] {
  const map: Record<HistorySource, ClinicalNoteSource[]> = {
    appointment: ["appointment"],
    treatment_plan: ["dental_treatment", "derm_treatment"],
    clinical_note: ["patient"],
    dental_chart: [],
    clinical_map: [],
  };
  if (source !== "all") return map[source];
  return (available ?? HISTORY_SOURCES).flatMap((a) => map[a]);
}

function dentalItemContext(it: any): Partial<ClinicalTimelineItem> {
  const teeth: string[] = it.toothNumbers ?? [];
  return {
    ...(teeth.length ? { toothNumber: teeth[0], toothNumbers: teeth } : {}),
    ...(it.surfaces?.length ? { surface: it.surfaces[0], surfaces: it.surfaces } : {}),
    treatment: { code: it.procedureCode, ...(it.customName ? { customName: it.customName } : {}), name: treatmentName(it.procedureCode, it.customName), ...(it.status ? { status: it.status } : {}) },
  };
}

function dermItemContext(it: any): Partial<ClinicalTimelineItem> {
  return {
    ...(it.regions?.length ? { regions: it.regions } : {}),
    treatment: { code: it.procedureCode, name: treatmentName(it.procedureCode), ...(it.status ? { status: it.status } : {}) },
  };
}

/**
 * The database already narrowed each source by its own text fields; this second pass makes the search behave the SAME for every item,
 * whichever route found it (so a tooth/treatment/doctor match that only one source could express never leaks unrelated rows).
 */
function textMatches(i: ClinicalTimelineItem, rx: RegExp, q: string, isTooth: boolean): boolean {
  if (rx.test(i.text)) return true;
  if (i.doctorName && rx.test(i.doctorName)) return true;
  if (isTooth && (i.toothNumbers ?? []).includes(q)) return true;
  const t = i.treatment;
  if (t && ((t.name && rx.test(t.name)) || (t.code && rx.test(t.code.replace(/_/g, " "))) || (t.customName && rx.test(t.customName)))) return true;
  if (i.chart?.code && rx.test(i.chart.code.replace(/_/g, " "))) return true;
  if ((i.regions ?? []).some((r) => rx.test(r.id.replace(/_/g, " ")))) return true;
  return false;
}
