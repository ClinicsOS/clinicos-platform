import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler";
import { Appointment } from "../models/Appointment";
import { Patient } from "../models/Patient";
import { DermAssessment } from "../models/DermAssessment";
import { DermTreatmentItem } from "../models/DermTreatmentItem";
import { DermTreatmentSession } from "../models/DermTreatmentSession";
import { DermFollowUp } from "../models/DermFollowUp";
import { getAmmanTodayRange } from "../utils/timezone";
import { loadDermBillingViewsForClinic } from "../services/dermBilling";

/**
 * GET /api/derm/dashboard — ONE summary read for the Dermatology & Aesthetics operational dashboard.
 * It only READS and summarizes existing data (Appointment, Derm* records, and — through the shared billing service —
 * Invoice). It owns nothing. Fixed, small number of queries regardless of clinic size (no per-row follow-up queries);
 * every patient name is fetched with ONE batched lookup. clinicId only ever comes from `protect`; the router already
 * applies requireSpecialty, so another specialty never reaches this handler. No 3D data is involved.
 */
const LIMIT = 8;
const NEEDS_BILLING_SCAN = 200;

export const getDermDashboard = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = new mongoose.Types.ObjectId(req.clinicId);
  const { start: dayStart, end: dayEnd } = getAmmanTodayRange();

  // ---------- Today (existing Appointment/Visit source of truth; a "blocked" slot is not a patient visit)
  const todays = (await Appointment.find({ clinicId, type: "appointment", startAt: { $gte: dayStart, $lte: dayEnd } }).select("status source").lean()) as any[];
  const today = { total: todays.length, scheduled: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0, walkIns: 0 };
  for (const a of todays) {
    if (a.status === "scheduled") today.scheduled++;
    else if (a.status === "confirmed") today.confirmed++;
    else if (a.status === "completed") today.completed++;
    else if (a.status === "cancelled") today.cancelled++;
    else if (a.status === "no_show") today.noShow++;
    if (a.source === "walk_in") today.walkIns++;
  }

  // ---------- Treatment Overview (COUNT SEMANTICS: plan items, never sessions), split by record type
  const grouped = (await DermTreatmentItem.aggregate([{ $match: { clinicId } }, { $group: { _id: { s: "$status", t: "$recordType" }, count: { $sum: 1 } } }])) as { _id: { s: string; t: string }; count: number }[];
  const cnt = (s: string, t?: string) => grouped.filter((r) => r._id.s === s && (!t || r._id.t === t)).reduce((n, r) => n + r.count, 0);
  const overview = (t?: string) => ({ planned: cnt("planned", t), inProgress: cnt("in_progress", t), completed: cnt("completed", t), cancelled: cnt("cancelled", t) });
  const treatmentOverview = { ...overview(), dermatology: overview("dermatology"), aesthetic: overview("aesthetic") };

  // ---------- Active Treatments: in-progress first (most recently touched), then a few most-recent planned
  const inProgress = (await DermTreatmentItem.find({ clinicId, status: "in_progress" }).sort({ updatedAt: -1 }).limit(LIMIT).lean()) as any[];
  const plannedFill = inProgress.length < LIMIT ? ((await DermTreatmentItem.find({ clinicId, status: "planned" }).sort({ createdAt: -1 }).limit(LIMIT - inProgress.length).lean()) as any[]) : [];
  const activeItems = [...inProgress, ...plannedFill];
  const sessionCounts = activeItems.length
    ? ((await DermTreatmentSession.aggregate([{ $match: { clinicId, itemId: { $in: activeItems.map((i) => i._id) } } }, { $group: { _id: "$itemId", count: { $sum: 1 } } }])) as { _id: any; count: number }[])
    : [];
  const sessionCountOf = new Map(sessionCounts.map((r) => [String(r._id), r.count]));

  // ---------- Needs Billing: COMPLETED and not linked to an invoice line. Eligibility comes from the ONE billing service.
  const completed = (await DermTreatmentItem.find({ clinicId, status: "completed" }).sort({ updatedAt: -1 }).limit(NEEDS_BILLING_SCAN).lean()) as any[];
  const views = await loadDermBillingViewsForClinic(clinicId, completed);
  const needsAll = completed.filter((i) => views.get(String(i._id))?.state === "none");
  const needsBilling = { count: needsAll.length, capped: completed.length >= NEEDS_BILLING_SCAN, items: needsAll.slice(0, LIMIT) };

  // ---------- Follow-Ups: review dates the CLINICIAN chose on a session, not yet documented
  const dueSessions = (await DermTreatmentSession.find({ clinicId, followUpDueAt: { $exists: true }, followUpResolvedAt: { $exists: false } }).sort({ followUpDueAt: 1 }).limit(LIMIT).lean()) as any[];
  const nowMs = Date.now();
  const soon = new Date(nowMs + 7 * 86_400_000);
  const [overdueCount, dueSoonCount] = await Promise.all([
    DermTreatmentSession.countDocuments({ clinicId, followUpDueAt: { $lt: dayStart }, followUpResolvedAt: { $exists: false } }),
    DermTreatmentSession.countDocuments({ clinicId, followUpDueAt: { $gte: dayStart, $lte: soon }, followUpResolvedAt: { $exists: false } }),
  ]);

  // ---------- Recent Activity (assessments, treatment changes, sessions, follow-ups) merged and trimmed
  const [rA, rI, rS, rF] = await Promise.all([
    DermAssessment.find({ clinicId, status: "active" }).sort({ createdAt: -1 }).limit(LIMIT).select("patientId recordType regionIds createdAt").lean() as Promise<any[]>,
    DermTreatmentItem.find({ clinicId, status: { $in: ["in_progress", "completed", "cancelled"] } }).sort({ updatedAt: -1 }).limit(LIMIT).select("patientId recordType procedureCode status updatedAt").lean() as Promise<any[]>,
    DermTreatmentSession.find({ clinicId }).sort({ startedAt: -1 }).limit(LIMIT).select("patientId recordType procedureCode sessionNumber startedAt").lean() as Promise<any[]>,
    DermFollowUp.find({ clinicId, status: "active" }).sort({ createdAt: -1 }).limit(LIMIT).select("patientId recordType createdAt").lean() as Promise<any[]>,
  ]);
  type Feed = { at: Date; kind: string; patientId: string; recordType: string; procedureCode?: string; status?: string; sessionNumber?: number };
  const feed: Feed[] = [
    ...rA.map((a) => ({ at: a.createdAt, kind: "assessment", patientId: String(a.patientId), recordType: a.recordType })),
    ...rI.map((i) => ({ at: i.updatedAt, kind: "treatment", patientId: String(i.patientId), recordType: i.recordType, procedureCode: i.procedureCode, status: i.status })),
    ...rS.map((s) => ({ at: s.startedAt, kind: "session", patientId: String(s.patientId), recordType: s.recordType, procedureCode: s.procedureCode, sessionNumber: s.sessionNumber })),
    ...rF.map((f) => ({ at: f.createdAt, kind: "follow_up", patientId: String(f.patientId), recordType: f.recordType })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, LIMIT);

  // ---------- ONE batched patient-name lookup for everything above
  const ids = new Set<string>();
  [...activeItems, ...needsBilling.items, ...dueSessions].forEach((x) => ids.add(String(x.patientId)));
  feed.forEach((f) => ids.add(f.patientId));
  const names = new Map<string, string>();
  if (ids.size) ((await Patient.find({ _id: { $in: [...ids] }, clinicId }).select("fullName").lean()) as any[]).forEach((p) => names.set(String(p._id), p.fullName));
  const nm = (id: unknown) => names.get(String(id)) ?? null;

  // the items behind the follow-up rows (one lookup) — for the procedure label only
  const dueItemIds = [...new Set(dueSessions.map((s) => String(s.itemId)))];
  const dueItems = dueItemIds.length ? ((await DermTreatmentItem.find({ _id: { $in: dueItemIds }, clinicId }).select("procedureCode recordType status").lean()) as any[]) : [];
  const dueItemOf = new Map(dueItems.map((i) => [String(i._id), i]));

  const brief = (i: any) => ({
    _id: String(i._id), patientId: String(i.patientId), patientName: nm(i.patientId), recordType: i.recordType, procedureCode: i.procedureCode,
    targetType: i.targetType, regionIds: i.regionIds ?? [], generalArea: i.generalArea ?? undefined, status: i.status, priority: i.priority,
    estimatedPrice: typeof i.estimatedPrice === "number" ? i.estimatedPrice : null, updatedAt: i.updatedAt,
  });
  return res.json({
    today,
    treatmentOverview,
    activeTreatments: activeItems.map((i) => ({ ...brief(i), sessionCount: sessionCountOf.get(String(i._id)) ?? 0 })),
    needsBilling: { count: needsBilling.count, capped: needsBilling.capped, items: needsBilling.items.map(brief) },
    followUps: {
      overdue: overdueCount, dueSoon: dueSoonCount,
      items: dueSessions.map((s) => ({
        sessionId: String(s._id), itemId: String(s.itemId), patientId: String(s.patientId), patientName: nm(s.patientId), dueAt: s.followUpDueAt,
        overdue: new Date(s.followUpDueAt).getTime() < dayStart.getTime(), recordType: s.recordType, procedureCode: dueItemOf.get(String(s.itemId))?.procedureCode ?? s.procedureCode,
      })),
    },
    recentActivity: feed.map((f) => ({ ...f, patientName: nm(f.patientId) })),
  });
});
