import { Request, Response } from "express";
import mongoose from "mongoose";
import { Appointment } from "../models/Appointment";
import { Invoice } from "../models/Invoice";
import { Patient } from "../models/Patient";
import { User } from "../models/User";
import { asyncHandler } from "../middleware/errorHandler";

/**
 * FIX #4 — converts a Jordan-local (Asia/Amman) wall-clock date/time into
 * the equivalent UTC Date. This is the month/day-boundary counterpart of
 * `localDayOfWeek` in utils/workingHoursTime.ts: that function answers
 * "what Jordan-local weekday is this instant", this one answers "what UTC
 * instant IS this Jordan-local moment" — needed because a calendar-month
 * boundary computed with `Date.UTC(...)` (as the pre-existing `start`/`end`
 * below already do) is a UTC boundary, not a Jordan-local one, and can
 * misclassify an appointment in the first/last few hours of a Jordan-local
 * month (e.g. Sep 1, 01:00 Amman time is still Aug 31 in UTC).
 *
 * Scoped to ONLY the new Scheduled-vs-Walk-in aggregation below — see the
 * implementation report for why the pre-existing revenue/status/daily-series
 * metrics on this same endpoint keep their original (slightly UTC-shifted)
 * boundaries unchanged rather than being reworked as part of this task.
 *
 * Uses Intl's own Asia/Amman offset at the given instant (rather than a
 * hardcoded +3) so this stays correct even if Jordan's DST rules ever
 * change again — the standard "guess, measure the actual offset, correct"
 * technique for one-off timezone conversion without a timezone library.
 */
function ammanLocalToUTC(year: number, month1to12: number, day: number): Date {
  const guess = new Date(Date.UTC(year, month1to12 - 1, day, 0, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Amman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(guess);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  // Some environments report midnight as hour "24" rather than "00" with
  // hour12:false — normalize defensively.
  const localAsUTC = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  const offsetMs = localAsUTC - guess.getTime();
  return new Date(guess.getTime() - offsetMs);
}

/**
 * GET /api/reports/monthly?year=2026&month=7
 *
 * Returns rolled-up analytics for a given month:
 *   - revenue (from paid invoice payments)
 *   - appointment counts by status
 *   - patients added this month
 *   - top doctors by appointment count
 *   - daily revenue + appointment series
 */
export const monthlyReport = asyncHandler(async (req: Request, res: Response) => {
  const now = new Date();
  const year = Number(req.query.year) || now.getUTCFullYear();
  const month = Number(req.query.month) || now.getUTCMonth() + 1;

  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const clinicId = new mongoose.Types.ObjectId(req.clinicId);

  // ==== Revenue (from paid invoice payments during the month) ====
  const revenueAgg = await Invoice.aggregate([
    { $match: { clinicId } },
    { $unwind: "$payments" },
    { $match: { "payments.paidAt": { $gte: start, $lt: end } } },
    { $group: { _id: null, total: { $sum: "$payments.amount" } } },
  ]);
  const revenue = revenueAgg[0]?.total || 0;

  // ==== Appointments by status ====
  const statusAgg = await Appointment.aggregate([
    { $match: { clinicId, type: { $ne: "blocked" }, startAt: { $gte: start, $lt: end } } },
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
  // Boundaries are computed in Jordan-local time (ammanLocalToUTC), NOT the
  // `start`/`end` above, so a late-night/early-morning visit near a month
  // boundary is attributed to the correct Jordan-local month.
  const ammanStart = ammanLocalToUTC(year, month, 1);
  const ammanNextMonth = month === 12 ? 1 : month + 1;
  const ammanNextYear = month === 12 ? year + 1 : year;
  const ammanEnd = ammanLocalToUTC(ammanNextYear, ammanNextMonth, 1);

  const sourceAgg = await Appointment.aggregate([
    {
      $match: {
        clinicId,
        type: { $ne: "blocked" },
        status: { $nin: ["cancelled", "no_show"] },
        startAt: { $gte: ammanStart, $lt: ammanEnd },
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
  const newPatients = await Patient.countDocuments({
    clinicId,
    createdAt: { $gte: start, $lt: end },
  });

  // ==== Top doctors ====
  const topDoctorsAgg = await Appointment.aggregate([
    { $match: { clinicId, type: { $ne: "blocked" }, startAt: { $gte: start, $lt: end } } },
    { $group: { _id: "$doctorId", count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 },
  ]);
  const doctorIds = topDoctorsAgg.map((d) => d._id);
  const doctors = await User.find({ _id: { $in: doctorIds } }).select("name");
  const doctorMap = new Map(doctors.map((d) => [String(d._id), d.name]));
  const topDoctors = topDoctorsAgg.map((d) => ({
    id: String(d._id),
    name: doctorMap.get(String(d._id)) || "—",
    count: d.count,
  }));

  // ==== Daily series (revenue + appointments per day) ====
  const [revSeries, apptSeries] = await Promise.all([
    Invoice.aggregate([
      { $match: { clinicId } },
      { $unwind: "$payments" },
      { $match: { "payments.paidAt": { $gte: start, $lt: end } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$payments.paidAt" } },
          amount: { $sum: "$payments.amount" },
        },
      },
    ]),
    Appointment.aggregate([
      { $match: { clinicId, type: { $ne: "blocked" }, startAt: { $gte: start, $lt: end } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$startAt" } },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);
  const revMap = new Map(revSeries.map((r) => [r._id, r.amount]));
  const apptMap = new Map(apptSeries.map((r) => [r._id, r.count]));

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const daily = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1, i + 1));
    const key = d.toISOString().slice(0, 10);
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
