import mongoose from "mongoose";
import { Appointment } from "../../../../models/Appointment";
import { Invoice } from "../../../../models/Invoice";
import { Patient } from "../../../../models/Patient";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";

export const getClinicStatsDefinition: AIToolDefinition = {
  name: "getClinicStats",
  description:
    "Returns appointment counts (total/completed/cancelled/no-show) and revenue in JOD for the clinic, for either today or the current calendar month. Use period='today' for 'how many patients today/revenue today', and period='month' for 'revenue this month/how's this month going'.",
  inputSchema: {
    type: "object",
    properties: {
      period: { type: "string", enum: ["today", "month"], description: "Defaults to 'today' if omitted" },
    },
    additionalProperties: false,
  },
};

export async function getClinicStatsExecute(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  if (!ctx.clinicId) return { error: "Not authenticated" };
  const clinicId = new mongoose.Types.ObjectId(ctx.clinicId);
  const period = input.period === "month" ? "month" : "today";

  let start: Date;
  let end: Date;
  if (period === "today") {
    start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
  } else {
    const now = new Date();
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  }

  const byStatusAgg = await Appointment.aggregate([
    { $match: { clinicId, type: { $ne: "blocked" }, startAt: { $gte: start, $lt: end } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const statusCounts: Record<string, number> = {};
  for (const row of byStatusAgg) statusCounts[row._id] = row.count;
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  const revenueResult = await Invoice.aggregate([
    { $match: { clinicId } },
    { $unwind: "$payments" },
    { $match: { "payments.paidAt": { $gte: start, $lt: end } } },
    { $group: { _id: null, total: { $sum: "$payments.amount" } } },
  ]);
  const revenueJOD = revenueResult[0]?.total || 0;

  const result: Record<string, unknown> = {
    period,
    total,
    completed: statusCounts["completed"] || 0,
    cancelled: statusCounts["cancelled"] || 0,
    noShow: statusCounts["no_show"] || 0,
    revenueJOD,
  };

  if (period === "month") {
    result.newPatients = await Patient.countDocuments({ clinicId, createdAt: { $gte: start, $lt: end } });
  }

  return result;
}
