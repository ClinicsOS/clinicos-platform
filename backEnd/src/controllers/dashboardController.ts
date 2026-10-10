import { Request, Response } from "express";
import mongoose from "mongoose";
import { Appointment } from "../models/Appointment";
import { Invoice } from "../models/Invoice";
import { asyncHandler } from "../middleware/errorHandler";
import { resolveDataScope, doctorMatchOid, accessOf, PolicyError } from "../auth/policy";
import { addDaysYmd, clinicLocalToUtc, clinicTodayRange, DEFAULT_CLINIC_TIMEZONE } from "../utils/timezone";

/**
 * GET /api/dashboard/stats
 *
 * PHASE 4 — one endpoint, three audiences (the front end keeps ONE dashboard):
 *   owner         clinic-wide; may narrow to a doctor with ?doctorId=<id>
 *   doctor        their own appointments, and revenue = payments on invoices attributed to them
 *   receptionist  clinic-wide appointment counts; NO money (revenue is null — the card is not shown)
 * `today.revenue` is null whenever the role has no revenue access, so a hidden card never carries a number.
 */
export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const countScope = resolveDataScope(req, "dashboardCounts", req.query.doctorId);
  if (countScope.unassigned) throw new PolicyError(400, "INVALID_DOCTOR", "Pick a doctor, or leave the filter empty for the whole clinic");
  const clinicId = new mongoose.Types.ObjectId(req.clinicId);
  const apptMatch = doctorMatchOid(countScope);

  // PHASE 7 — "today" is the CLINIC-local calendar day (utils/timezone.ts), not the UTC day: a payment taken at 00:30 in Amman
  // belongs to today, and this card must agree with Analytics → Today. The week strip is the last 7 clinic days.
  const today = clinicTodayRange();
  const todayStart = today.start;
  const todayEnd = today.end;
  const weekFirstYmd = addDaysYmd(today.ymd, -6);
  const weekStart = clinicLocalToUtc(weekFirstYmd);

  const todayByStatus = await Appointment.aggregate([
    { $match: { clinicId, ...apptMatch, type: { $ne: "blocked" }, startAt: { $gte: todayStart, $lt: todayEnd } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of todayByStatus) statusCounts[row._id] = row.count;

  const todayTotal = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  // Money: only for a role that has revenue access; a doctor's figure is limited to invoices attributed to them
  // (legacy / unattributed invoices are never counted for a doctor).
  let todayRevenue: number | null = null;
  if (accessOf(req.role, "dashboardRevenue") !== "none") {
    const revScope = resolveDataScope(req, "dashboardRevenue", req.query.doctorId);
    const revenueResult = await Invoice.aggregate([
      { $match: { clinicId, ...doctorMatchOid(revScope) } },
      { $unwind: "$payments" },
      { $match: { "payments.paidAt": { $gte: todayStart, $lt: todayEnd } } },
      { $group: { _id: null, total: { $sum: "$payments.amount" } } },
    ]);
    todayRevenue = revenueResult[0]?.total || 0;
  }

  const weekAgg = await Appointment.aggregate([
    { $match: { clinicId, ...apptMatch, type: { $ne: "blocked" }, startAt: { $gte: weekStart, $lt: todayEnd } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$startAt", timezone: DEFAULT_CLINIC_TIMEZONE } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const week: { date: string; count: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const key = addDaysYmd(weekFirstYmd, i);
    const found = weekAgg.find((w) => w._id === key);
    week.push({ date: key, count: found?.count || 0 });
  }

  return res.json({
    today: {
      total: todayTotal,
      completed: statusCounts["completed"] || 0,
      cancelled: statusCounts["cancelled"] || 0,
      noShow: statusCounts["no_show"] || 0,
      revenue: todayRevenue,
    },
    week,
    scope: { level: countScope.level, doctorId: countScope.doctorId ?? null, showsRevenue: todayRevenue !== null },
  });
});
