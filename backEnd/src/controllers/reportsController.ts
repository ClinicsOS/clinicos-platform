import { Request, Response } from "express";
import mongoose from "mongoose";
import { Appointment } from "../models/Appointment";
import { Invoice } from "../models/Invoice";
import { Patient } from "../models/Patient";
import { User } from "../models/User";
import { asyncHandler } from "../middleware/errorHandler";

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
    { $match: { clinicId, startAt: { $gte: start, $lt: end } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const byStatus: Record<string, number> = {};
  statusAgg.forEach((row) => { byStatus[row._id] = row.count; });

  // ==== Patient count for the month ====
  const newPatients = await Patient.countDocuments({
    clinicId,
    createdAt: { $gte: start, $lt: end },
  });

  // ==== Top doctors ====
  const topDoctorsAgg = await Appointment.aggregate([
    { $match: { clinicId, startAt: { $gte: start, $lt: end } } },
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
      { $match: { clinicId, startAt: { $gte: start, $lt: end } } },
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
  });
});
