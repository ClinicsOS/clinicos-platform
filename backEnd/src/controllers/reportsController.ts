import { Request, Response } from "express";
import mongoose from "mongoose";
import { Appointment } from "../models/Appointment";
import { Invoice, ACTIVE_INVOICE } from "../models/Invoice";
import { Patient } from "../models/Patient";
import { User } from "../models/User";
import { asyncHandler } from "../middleware/errorHandler";
import { resolveDataScope, doctorMatchOid, PolicyError } from "../auth/policy";
import { addDaysYmd, clinicMonthOf, clinicMonthRange, DEFAULT_CLINIC_TIMEZONE } from "../utils/timezone";

/**
 * GET /api/reports/monthly?year=2026&month=7
 *
 * DEPRECATED (Phase 6): the Reports screen now uses /api/analytics/*. Kept only so older clients keep working. PHASE 7: its month and
 * day boundaries are now the CLINIC-local calendar (they used to be UTC, so the same payment could land on a different day / month
 * than in the Analytics Center); year / month are validated.
 *
 * Returns rolled-up analytics for a given month:
 *   - revenue (from paid invoice payments)
 *   - appointment counts by status
 *   - patients added this month
 *   - top doctors by appointment count
 *   - daily revenue + appointment series
 */
export const monthlyReport = asyncHandler(async (req: Request, res: Response) => {
  // PHASE 4 — who is asking decides WHAT is aggregated. The owner sees the whole clinic and may narrow to one doctor
  // (?doctorId=<id>); a doctor is always limited to their own appointments and the invoices attributed to them (another
  // doctor's id is a 403); a receptionist is refused at the route (reports access = none). Nothing is ever "faked" per doctor:
  // a metric that has no reliable treating-doctor attribution (new patients) is returned as null for a doctor-scoped report.
  const scope = resolveDataScope(req, "reports", req.query.doctorId);
  if (scope.unassigned) throw new PolicyError(400, "INVALID_DOCTOR", "Pick a doctor, or leave the filter empty for the whole clinic");
  const doctorScoped = !!scope.doctorId;
  const apptMatch = doctorMatchOid(scope); // Appointment.doctorId
  const invMatch = doctorMatchOid(scope); // Invoice.doctorId (the treating doctor)

  const cur = clinicMonthOf();
  const yearIn = req.query.year === undefined || req.query.year === "" ? cur.year : Number(req.query.year);
  const monthIn = req.query.month === undefined || req.query.month === "" ? cur.month : Number(req.query.month);
  if (!Number.isInteger(yearIn) || yearIn < 2000 || yearIn > 2100) throw new PolicyError(400, "INVALID_DATE", "Invalid year");
  if (!Number.isInteger(monthIn) || monthIn < 1 || monthIn > 12) throw new PolicyError(400, "INVALID_DATE", "Invalid month");
  const year = yearIn;
  const month = monthIn;

  const { start, end } = clinicMonthRange(year, month);
  const clinicId = new mongoose.Types.ObjectId(req.clinicId);

  // ==== Revenue (from paid invoice payments during the month) ====
  const revenueOf = async (match: Record<string, unknown>) => {
    const rows = await Invoice.aggregate([
      { $match: { clinicId, ...match, ...ACTIVE_INVOICE } }, // PHASE 2 — soft-deleted invoices never count
      { $unwind: "$payments" },
      { $match: { "payments.paidAt": { $gte: start, $lt: end } } },
      { $group: { _id: null, total: { $sum: "$payments.amount" } } },
    ]);
    return rows[0]?.total || 0;
  };
  // Clinic-wide (owner): also report how much revenue has NO treating doctor on record (legacy invoices), so the gap is visible
  // instead of silently attributed. A doctor-scoped report never needs it.
  const [revenue, unassignedRevenue] = await Promise.all([
    revenueOf(invMatch),
    scope.level === "clinic" && !doctorScoped ? revenueOf({ doctorId: null }) : Promise.resolve(0),
  ]);

  // ==== Appointments by status ====
  const statusAgg = await Appointment.aggregate([
    { $match: { clinicId, ...apptMatch, type: { $ne: "blocked" }, startAt: { $gte: start, $lt: end } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const byStatus: Record<string, number> = {};
  statusAgg.forEach((row) => { byStatus[row._id] = row.count; });

  // ==== FIX #4 — Scheduled vs Walk-in visit sources ====
  // CORRECTION (per review): the doctor's question is "how many patients
  // actually came" — a cancelled appointment (patient never came, or the
  // visit was called off) and a no-show (patient didn't come) must NOT
  // count as a Scheduled Visit, and the same exclusion applies if a
  // Walk-in record is itself later marked cancelled/no_show. So THIS
  // aggregation's population is narrower than `byStatus`/
  // `totalAppointments` above: those two metrics are UNCHANGED and still
  // include every non-blocked status, exactly as before — this narrower
  // exclusion applies ONLY to visitSources below.
  //
  // Population: type != "blocked", within the period, AND status NOT IN
  // ["cancelled", "no_show"]. The remaining statuses (scheduled, confirmed,
  // completed) all still count — ClinicOS has no separate "attended" flag
  // distinguishing a completed visit from a merely-not-yet-happened
  // scheduled one, and inventing one is out of scope here (see report).
  //
  // (Boundaries are clinic-local — the same `start`/`end` as every other metric on this endpoint.)
  const sourceAgg = await Appointment.aggregate([
    {
      $match: {
        clinicId,
        ...apptMatch,
        type: { $ne: "blocked" },
        status: { $nin: ["cancelled", "no_show"] },
        startAt: { $gte: start, $lt: end },
      },
    },
    { $group: { _id: "$source", count: { $sum: 1 } } },
  ]);
  const bySource: Record<string, number> = {};
  sourceAgg.forEach((row) => {
    // Defensive fallback for any legacy/unexpected value: treat it as a
    // normal clinic-scheduled visit (never silently drop a real visit from
    // the total, and never misclassify an unknown value as a walk-in).
    const key = row._id === "walk_in" || row._id === "public" || row._id === "dashboard" ? row._id : "dashboard";
    bySource[key] = (bySource[key] || 0) + row.count;
  });

  const walkInVisits = bySource["walk_in"] || 0;
  const clinicScheduledVisits = bySource["dashboard"] || 0;
  const onlineBookingVisits = bySource["public"] || 0;
  const scheduledVisits = clinicScheduledVisits + onlineBookingVisits;
  const totalVisits = scheduledVisits + walkInVisits;
  const visitPct = (n: number) => (totalVisits > 0 ? Math.round((n / totalVisits) * 1000) / 10 : 0);

  // ==== Patient count for the month ====
  // Patients belong to the clinic, not to a doctor (no reliable "registered by / treated by" link) — so for a doctor-scoped
  // report this metric is NOT available (null) rather than invented. Deferred to the Phase 6 reporting work.
  const newPatients = doctorScoped
    ? null
    : await Patient.countDocuments({
        clinicId,
        createdAt: { $gte: start, $lt: end },
      });

  // ==== Top doctors ====
  const topDoctorsAgg = await Appointment.aggregate([
    { $match: { clinicId, ...apptMatch, type: { $ne: "blocked" }, startAt: { $gte: start, $lt: end } } },
    { $group: { _id: "$doctorId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);
  const doctorIds = topDoctorsAgg.map((d) => d._id);
  const doctors = await User.find({ _id: { $in: doctorIds }, clinicId }).select("name");
  const doctorMap = new Map(doctors.map((d) => [String(d._id), d.name]));
  const topDoctors = topDoctorsAgg.map((d) => ({
    id: String(d._id),
    name: doctorMap.get(String(d._id)) || "—",
    count: d.count,
  }));

  // ==== Daily series (revenue + appointments per day) ====
  const [revSeries, apptSeries] = await Promise.all([
    Invoice.aggregate([
      { $match: { clinicId, ...invMatch, ...ACTIVE_INVOICE } }, // PHASE 2
      { $unwind: "$payments" },
      { $match: { "payments.paidAt": { $gte: start, $lt: end } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$payments.paidAt", timezone: DEFAULT_CLINIC_TIMEZONE } },
          amount: { $sum: "$payments.amount" },
        },
      },
    ]),
    Appointment.aggregate([
      { $match: { clinicId, ...apptMatch, type: { $ne: "blocked" }, startAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$startAt", timezone: DEFAULT_CLINIC_TIMEZONE } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);
  const revMap = new Map(revSeries.map((r) => [r._id, r.amount]));
  const apptMap = new Map(apptSeries.map((r) => [r._id, r.count]));

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daily = Array.from({ length: daysInMonth }, (_, i) => {
    const key = addDaysYmd(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`, i);
    return {
      date: key,
      revenue: revMap.get(key) || 0,
      appointments: apptMap.get(key) || 0,
    };
  });

  return res.json({
    year,
    month,
    revenue,
    totalAppointments: Object.values(byStatus).reduce((a, b) => a + b, 0),
    byStatus,
    newPatients,
    topDoctors,
    daily,
    // PHASE 4 — what this report covers, and (clinic-wide only) how much of the revenue has no treating doctor on record.
    scope: { level: scope.level, doctorId: scope.doctorId ?? null },
    ...(scope.level === "clinic" && !doctorScoped ? { attribution: { attributedRevenue: revenue - unassignedRevenue, unassignedRevenue } } : {}),
    // FIX #4 — Scheduled vs Walk-in visit sources for this same period.
    visitSources: {
      total: totalVisits,
      scheduled: scheduledVisits,
      walkIn: walkInVisits,
      scheduledPct: visitPct(scheduledVisits),
      walkInPct: visitPct(walkInVisits),
      clinicScheduled: clinicScheduledVisits,
      onlineBooking: onlineBookingVisits,
    },
  });
});
