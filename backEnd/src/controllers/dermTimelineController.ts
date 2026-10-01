import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { Appointment } from "../models/Appointment";
import { DermAssessment } from "../models/DermAssessment";
import { DermTreatmentItem } from "../models/DermTreatmentItem";
import { DermTreatmentSession } from "../models/DermTreatmentSession";
import { DermFollowUp } from "../models/DermFollowUp";
import { RECORD_TYPES } from "../config/dermatology";
import { loadPatient, isKnownRegionId, populateAssessment, serializeAssessment, visitsFor } from "./dermController";
import { populateSession, serializeSession, populateItem } from "./dermTreatmentController";
import { populateFollowUp, serializeFollowUp } from "./dermFollowUpController";
import { loadDermBillingViews } from "../services/dermBilling";

/**
 * UNIFIED TIMELINE (read-only normalisation layer). Phase 1 records are NEVER rewritten: assessments, treatment status
 * changes (from each item's append-only statusHistory), sessions and follow-ups are read from their own collections and
 * merged newest-first at read time. The same endpoint serves BOTH the patient timeline and Area History (`regionId`).
 *
 * Pagination is a keyset cursor over (at, key): every source is fetched with `at <= cursor` and a small over-fetch, the
 * merged list is cut to `limit`, and the next cursor is the last returned event — no offset scans, bounded payloads.
 * Diagnosis is shown INSIDE the assessment event (that is where the clinician stores it); it is not a separate record.
 */
const query = z.object({
  kind: z.enum(["all", "assessment", "treatment", "follow_up"]).optional(),
  recordType: z.enum(RECORD_TYPES).optional(),
  regionId: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(60).optional(),
  includeVoided: z.enum(["0", "1", "true", "false"]).optional(), // Phase 1 parity: "show entered in error"
  before: z.string().max(200).optional(), // "ISO|key" (a treatment key is ~85 chars)
});

interface Ev { key: string; kind: "assessment" | "treatment" | "follow_up"; event: string; at: Date; data: Record<string, unknown>; appointmentId?: string }

const briefItem = (i: any) => ({
  itemId: String(i._id), recordType: i.recordType, procedureCode: i.procedureCode, targetType: i.targetType,
  regions: (i.regions ?? []).map((r: any) => ({ id: r.id, ...(r.surface ? { surface: r.surface } : {}) })), generalArea: i.generalArea ?? undefined, priority: i.priority, phase: i.phase,
});

export const getTimeline = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const q = query.parse(req.query);
  if (q.regionId && !isKnownRegionId(q.regionId)) return res.status(400).json({ message: "Unknown anatomical region" });
  const limit = q.limit ?? 30;
  const kind = q.kind ?? "all";

  let curAt: Date | null = null, curKey = "";
  if (q.before) {
    const cut = q.before.indexOf("|");
    const at = new Date(cut > 0 ? q.before.slice(0, cut) : q.before);
    if (Number.isNaN(at.getTime()) || cut < 0) return res.status(400).json({ message: "Invalid cursor" });
    curAt = at; curKey = q.before.slice(cut + 1);
  }
  const base = { clinicId: req.clinicId, patientId: patient._id };
  const withFilters = (dateField: string, extra: Record<string, unknown> = {}) => {
    const f: Record<string, unknown> = { ...base, ...extra };
    if (q.recordType) f.recordType = q.recordType;
    if (q.regionId) f.regionIds = q.regionId;
    if (curAt) f[dateField] = { $lte: curAt };
    return f;
  };
  const withVoided = q.includeVoided === "1" || q.includeVoided === "true";
  const activeOnly = withVoided ? {} : { status: "active" };
  const N = limit + 12;
  const events: Ev[] = [];

  const wantA = kind === "all" || kind === "assessment";
  const wantT = kind === "all" || kind === "treatment";
  const wantF = kind === "all" || kind === "follow_up";

  const [assessments, items, sessions, followUps] = await Promise.all([
    wantA ? (populateAssessment(DermAssessment.find(withFilters("createdAt", activeOnly)).sort({ createdAt: -1, _id: -1 }).limit(N)).lean() as Promise<any[]>) : [],
    wantT ? (populateItem(DermTreatmentItem.find({ ...base, ...(q.recordType ? { recordType: q.recordType } : {}), ...(q.regionId ? { regionIds: q.regionId } : {}) }).limit(400)).lean() as Promise<any[]>) : [],
    wantT ? (populateSession(DermTreatmentSession.find(withFilters("startedAt")).sort({ startedAt: -1, _id: -1 }).limit(N)).lean() as Promise<any[]>) : [],
    wantF ? (populateFollowUp(DermFollowUp.find(withFilters("createdAt", activeOnly)).sort({ createdAt: -1, _id: -1 }).limit(N)).lean() as Promise<any[]>) : [],
  ]);

  const aVisits = await visitsFor(req, patient._id, assessments);
  for (const a of assessments) events.push({ key: `assessment:${a._id}`, kind: "assessment", event: "assessment", at: new Date(a.createdAt), data: { assessment: serializeAssessment(a, aVisits) } });
  for (const i of items) {
    for (const h of i.statusHistory ?? []) {
      const ev = h.status === "in_progress" ? "started" : h.status;
      events.push({
        key: `treatment:${i._id}:${h.status}:${new Date(h.at).getTime()}`, kind: "treatment", event: ev, at: new Date(h.at),
        appointmentId: h.appointmentId ? String(h.appointmentId) : undefined,
        data: { treatment: briefItem(i), by: h.by && h.by._id ? { _id: String(h.by._id), name: h.by.name } : null, note: h.note ?? undefined },
      });
    }
  }
  for (const s of sessions) events.push({ key: `session:${s._id}`, kind: "treatment", event: "session", at: new Date(s.startedAt), appointmentId: String(s.appointmentId), data: { session: serializeSession(s) } });
  for (const f of followUps) events.push({ key: `follow_up:${f._id}`, kind: "follow_up", event: "follow_up", at: new Date(f.createdAt), appointmentId: f.appointmentId ? String(f.appointmentId) : undefined, data: { followUp: serializeFollowUp(f) } });

  const cmp = (a: Ev, b: Ev) => b.at.getTime() - a.at.getTime() || (a.key < b.key ? 1 : a.key > b.key ? -1 : 0);
  const after = curAt ? events.filter((e) => e.at.getTime() < curAt!.getTime() || (e.at.getTime() === curAt!.getTime() && e.key < curKey)) : events;
  after.sort(cmp);
  const page = after.slice(0, limit);
  const hasMore = after.length > limit;
  const last = page[page.length - 1];

  const visitIds = [...new Set(page.map((e) => e.appointmentId).filter(Boolean) as string[])];
  const visits: Record<string, { startAt: Date; source: string; status: string }> = {};
  if (visitIds.length) {
    ((await Appointment.find({ _id: { $in: visitIds }, ...base }).select("startAt source status").lean()) as any[]).forEach((v) => (visits[String(v._id)] = { startAt: v.startAt, source: v.source, status: v.status }));
  }
  return res.json({
    events: page.map((e) => ({ key: e.key, kind: e.kind, event: e.event, at: e.at, appointmentId: e.appointmentId ?? null, ...e.data })),
    visits,
    hasMore,
    nextBefore: hasMore && last ? `${last.at.toISOString()}|${last.key}` : null,
  });
});

/**
 * GET /derm/patients/:patientId/overview — the compact Patient Specialty Overview (counts + last activity). It never
 * duplicates the Core patient financial summary. "Needs Billing" = COMPLETED treatment not yet linked to an invoice line
 * (it does NOT mean the patient owes money).
 */
export const getPatientOverview = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const scope = { clinicId: req.clinicId, patientId: patient._id };
  const [activeAssessments, byStatus, completed, dueSession, lastA, lastI, lastS, lastF] = await Promise.all([
    DermAssessment.countDocuments({ ...scope, status: "active" }),
    DermTreatmentItem.aggregate([{ $match: { clinicId: new mongoose.Types.ObjectId(req.clinicId), patientId: patient._id } }, { $group: { _id: "$status", count: { $sum: 1 } } }]) as Promise<{ _id: string; count: number }[]>,
    DermTreatmentItem.find({ ...scope, status: "completed" }).select("billing").limit(300).lean() as Promise<any[]>,
    DermTreatmentSession.findOne({ ...scope, followUpDueAt: { $exists: true }, followUpResolvedAt: { $exists: false } }).sort({ followUpDueAt: 1 }).select("followUpDueAt itemId").lean() as Promise<any>,
    DermAssessment.findOne({ ...scope, status: "active" }).sort({ createdAt: -1 }).select("createdAt").lean() as Promise<any>,
    DermTreatmentItem.findOne(scope).sort({ updatedAt: -1 }).select("updatedAt").lean() as Promise<any>,
    DermTreatmentSession.findOne(scope).sort({ startedAt: -1 }).select("startedAt").lean() as Promise<any>,
    DermFollowUp.findOne({ ...scope, status: "active" }).sort({ createdAt: -1 }).select("createdAt").lean() as Promise<any>,
  ]);
  const n = (s: string) => byStatus.find((r) => r._id === s)?.count ?? 0;
  const views = await loadDermBillingViews({ clinicId: req.clinicId, userId: req.userId, patientId: patient._id }, completed);
  const needsBilling = completed.filter((i) => views.get(String(i._id))?.state === "none").length;
  const times = [lastA?.createdAt, lastI?.updatedAt, lastS?.startedAt, lastF?.createdAt].filter(Boolean).map((d) => new Date(d));
  return res.json({
    activeAssessments,
    planned: n("planned"), inProgress: n("in_progress"), completed: n("completed"), cancelled: n("cancelled"),
    needsBilling,
    upcomingFollowUpAt: dueSession?.followUpDueAt ?? null,
    lastActivityAt: times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : null,
  });
});
