import { Request, Response } from "express";
import mongoose from "mongoose";
import { asyncHandler } from "../middleware/errorHandler";
import { Appointment } from "../models/Appointment";
import { Patient } from "../models/Patient";
import { DentalTreatmentItem } from "../models/DentalTreatmentItem";
import { DentalTreatmentSession } from "../models/DentalTreatmentSession";
import { DentalToothEvent } from "../models/DentalToothEvent";
import { getAmmanTodayRange } from "../utils/timezone";
import { loadBillingViewsForClinic } from "../services/dentalBilling";

/**
 * GET /api/dental/dashboard — one summary read for the Dentistry operational dashboard.
 *
 * This endpoint only READS and summarizes existing data (Appointment, DentalTreatmentItem/Session,
 * DentalToothEvent, and — through the shared billing service — Invoice). It owns nothing: appointments,
 * treatments and invoices remain exactly as authoritative as they are everywhere else in ClinicOS.
 *
 * Efficiency: a fixed, small number of queries regardless of clinic size (today's appointments, one grouped
 * count for the Treatment Overview, one page of active items + one grouped session-count aggregate, one page
 * of completed-but-unbilled items via the shared billing service, three small "recent" queries, and ONE batched
 * Patient lookup for every name this response needs) — no per-appointment or per-treatment follow-up query.
 *
 * Security: clinicId is taken only from `protect` (never the client); the router already applies
 * requireSpecialty("dentistry"), so a non-dentistry clinic never reaches this handler.
 */
const LIMIT = 8;

export const getDentalDashboard = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = new mongoose.Types.ObjectId(req.clinicId);
  const { start: dayStart, end: dayEnd, dateStr } = getAmmanTodayRange(); // Asia/Amman wall-clock day, same helper reminders already use

  // ---------- Today (existing Appointment/Visit source of truth; a "blocked" slot is not a patient visit) ----------
  const todaysAppts = (await Appointment.find({ clinicId, type: "appointment", startAt: { $gte: dayStart, $lte: dayEnd } })
    .sort({ startAt: 1 })
    .populate("doctorId", "name")
    .select("patientId doctorId startAt status source")
    .lean()) as any[];

  const todayCounts = { total: todaysAppts.length, scheduled: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0, walkIns: 0 };
  for (const a of todaysAppts) {
    if (a.status === "scheduled") todayCounts.scheduled++;
    else if (a.status === "confirmed") todayCounts.confirmed++;
    else if (a.status === "completed") todayCounts.completed++;
    else if (a.status === "cancelled") todayCounts.cancelled++;
    else if (a.status === "no_show") todayCounts.noShow++;
    if (a.source === "walk_in") todayCounts.walkIns++;
  }

  // ---------- Treatment Overview (COUNT SEMANTICS: plan items, never sessions) ----------
  const byStatus = (await DentalTreatmentItem.aggregate([{ $match: { clinicId } }, { $group: { _id: "$status", count: { $sum: 1 } } }])) as { _id: string; count: number }[];
  const statusCount = (s: string) => byStatus.find((r) => r._id === s)?.count ?? 0;
  const treatmentOverview = { planned: statusCount("planned"), inProgress: statusCount("in_progress"), completed: statusCount("completed"), cancelled: statusCount("cancelled") };

  // ---------- Active Treatments: in-progress first (most recently touched), then a few most-recent planned ----------
  const inProgress = (await DentalTreatmentItem.find({ clinicId, status: "in_progress" }).sort({ updatedAt: -1 }).limit(LIMIT).lean()) as any[];
  const plannedFill = inProgress.length < LIMIT
    ? ((await DentalTreatmentItem.find({ clinicId, status: "planned" }).sort({ createdAt: -1 }).limit(LIMIT - inProgress.length).lean()) as any[])
    : [];
  const activeItems = [...inProgress, ...plannedFill];
  const sessionCounts = activeItems.length
    ? ((await DentalTreatmentSession.aggregate([
        { $match: { clinicId, itemId: { $in: activeItems.map((i) => i._id) } } },
        { $group: { _id: "$itemId", count: { $sum: 1 } } },
      ])) as { _id: any; count: number }[])
    : [];
  const sessionCountOf = new Map(sessionCounts.map((r) => [String(r._id), r.count]));

  // ---------- Needs Billing: COMPLETED items, eligibility from the ONE authoritative billing service (not re-derived here) ----------
  const completedCandidates = (await DentalTreatmentItem.find({ clinicId, status: "completed" }).sort({ updatedAt: -1 }).limit(40).lean()) as any[];
  const billingViews = await loadBillingViewsForClinic(clinicId, completedCandidates);
  const needsBillingItems = completedCandidates.filter((i) => billingViews.get(String(i._id))?.state === "none").slice(0, LIMIT);

  // ---------- Recent Activity: diagnoses, treatment status changes, and invoicing — merged and trimmed ----------
  const recentDiagnoses = (await DentalToothEvent.find({ clinicId, category: "diagnosis" }).sort({ createdAt: -1 }).limit(LIMIT).lean()) as any[];
  const recentStatusItems = (await DentalTreatmentItem.find({ clinicId, status: { $in: ["in_progress", "completed", "cancelled"] } }).sort({ updatedAt: -1 }).limit(LIMIT).lean()) as any[];
  const recentBilled = (await DentalTreatmentItem.find({ clinicId, "billing.state": "invoiced" }).sort({ "billing.at": -1 }).limit(LIMIT).lean()) as any[];

  type Feed = { at: Date; kind: string; patientId: string; procedureCode?: string; customName?: string; targetType?: string; toothNumbers?: string[]; invoiceNumber?: number; amount?: number };
  const feed: Feed[] = [
    ...recentDiagnoses.map((e) => ({ at: e.createdAt as Date, kind: "diagnosis", patientId: String(e.patientId), procedureCode: e.code, toothNumbers: [e.fdi] })),
    ...recentStatusItems.map((i) => ({
      at: i.updatedAt as Date,
      kind: i.status === "in_progress" ? "treatment_started" : i.status === "completed" ? "treatment_completed" : "treatment_cancelled",
      patientId: String(i.patientId), procedureCode: i.procedureCode, customName: i.customName ?? undefined, targetType: i.targetType, toothNumbers: i.toothNumbers,
    })),
    ...recentBilled.map((i) => ({ at: i.billing.at as Date, kind: "invoiced", patientId: String(i.patientId), procedureCode: i.procedureCode, customName: i.customName ?? undefined, targetType: i.targetType, toothNumbers: i.toothNumbers, invoiceNumber: i.billing.invoiceNumber, amount: i.billing.amount })),
  ]
    .sort((a, b) => +new Date(b.at) - +new Date(a.at))
    .slice(0, LIMIT);

  // ---------- ONE batched name lookup for everything above (today, active, needs-billing, recent activity) ----------
  const patientIds = new Set<string>();
  todaysAppts.forEach((a) => a.patientId && patientIds.add(String(a.patientId)));
  activeItems.forEach((i) => patientIds.add(String(i.patientId)));
  needsBillingItems.forEach((i) => patientIds.add(String(i.patientId)));
  feed.forEach((e) => patientIds.add(e.patientId));
  const patients = patientIds.size
    ? ((await Patient.find({ _id: { $in: [...patientIds] }, clinicId }).select("fullName").lean()) as any[])
    : [];
  const nameOf = new Map(patients.map((p) => [String(p._id), p.fullName as string]));

  // Today's dental-treatment indicator per patient (batched — no per-appointment query): prefer an in-progress
  // treatment over a planned one when a patient happens to have both.
  const todayPatientIds = [...new Set(todaysAppts.map((a) => a.patientId).filter(Boolean).map(String))];
  const todaysTreatments = todayPatientIds.length
    ? ((await DentalTreatmentItem.find({ clinicId, patientId: { $in: todayPatientIds }, status: { $in: ["planned", "in_progress"] } }).sort({ status: 1, updatedAt: -1 }).lean()) as any[]) // "in_progress" < "planned" alphabetically
    : [];
  const treatmentOfPatient = new Map<string, any>();
  for (const t of todaysTreatments) { const k = String(t.patientId); if (!treatmentOfPatient.has(k)) treatmentOfPatient.set(k, t); }

  return res.json({
    date: dateStr,
    today: {
      counts: todayCounts,
      appointments: todaysAppts.map((a) => {
        const tx = a.patientId ? treatmentOfPatient.get(String(a.patientId)) : undefined;
        return {
          _id: String(a._id), startAt: a.startAt, status: a.status, source: a.source,
          patientId: a.patientId ? String(a.patientId) : null, patientName: a.patientId ? nameOf.get(String(a.patientId)) ?? null : null,
          doctorName: a.doctorId?.name ?? null,
          treatment: tx ? { status: tx.status, procedureCode: tx.procedureCode, customName: tx.customName ?? undefined, targetType: tx.targetType, toothNumbers: tx.toothNumbers } : null,
        };
      }),
    },
    treatmentOverview,
    activeTreatments: activeItems.map((i) => ({
      _id: String(i._id), patientId: String(i.patientId), patientName: nameOf.get(String(i.patientId)) ?? null,
      procedureCode: i.procedureCode, customName: i.customName ?? undefined, targetType: i.targetType, toothNumbers: i.toothNumbers, surfaces: i.surfaces,
      status: i.status, priority: i.priority, phase: i.phase, sessionCount: sessionCountOf.get(String(i._id)) ?? 0, updatedAt: i.updatedAt,
    })),
    needsBilling: needsBillingItems.map((i) => ({
      _id: String(i._id), patientId: String(i.patientId), patientName: nameOf.get(String(i.patientId)) ?? null,
      procedureCode: i.procedureCode, customName: i.customName ?? undefined, targetType: i.targetType, toothNumbers: i.toothNumbers, surfaces: i.surfaces,
      estimatedPrice: typeof i.estimatedPrice === "number" ? i.estimatedPrice : null,
    })),
    recentActivity: feed.map((e) => ({ ...e, patientName: nameOf.get(e.patientId) ?? null })),
  });
});
