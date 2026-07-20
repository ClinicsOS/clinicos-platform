import { Request, Response } from "express";
import mongoose from "mongoose";
import { Appointment } from "../models/Appointment";
import { Invoice } from "../models/Invoice";
import { asyncHandler } from "../middleware/errorHandler";

export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const clinicId = new mongoose.Types.ObjectId(req.clinicId);

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  const weekStart = new Date(todayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);

  const todayByStatus = await Appointment.aggregate([
    { $match: { clinicId, startAt: { $gte: todayStart, $lt: todayEnd } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);

  const statusCounts: Record<string, number> = {};
  for (const row of todayByStatus) statusCounts[row._id] = row.count;

  const todayTotal = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  const revenueResult = await Invoice.aggregate([
    { $match: { clinicId } },
    { $unwind: "$payments" },
    { $match: { "payments.paidAt": { $gte: todayStart, $lt: todayEnd } } },
    { $group: { _id: null, total: { $sum: "$payments.amount" } } },
  ]);
  const todayRevenue = revenueResult[0]?.total || 0;

  const weekAgg = await Appointment.aggregate([
    { $match: { clinicId, startAt: { $gte: weekStart, $lt: todayEnd } } },
    {
      $group: {
        _id: { $dateToString: { format: "%Y-%m-%d", date: "$startAt" } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const week: { date: string; count: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
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
  });
});
