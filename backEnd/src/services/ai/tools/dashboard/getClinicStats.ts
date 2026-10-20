import mongoose from "mongoose";
import { Appointment } from "../../../../models/Appointment";
import { Invoice, ACTIVE_INVOICE } from "../../../../models/Invoice";
import { Patient } from "../../../../models/Patient";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";
import { scopeOf, doctorMatchOid, accessOf } from "../../../../auth/policy";
import { clinicTodayRange, clinicMonthRange, clinicMonthOf } from "../../../../utils/timezone";

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
  // PHASE 4 — the AI assistant is bound by the SAME access rules as the dashboard: a doctor gets their own numbers, a receptionist
  // gets no money at all (the revenue field is simply absent), the owner gets the clinic.
  const scope = scopeOf(ctx, "dashboardCounts");
  const showRevenue = accessOf(ctx.role, "dashboardRevenue") !== "none";
  const clinicId = new mongoose.Types.ObjectId(ctx.clinicId);
  const period = input.period === "month" ? "month" : "today";

  // PHASE 7 — clinic-local day / month boundaries (same helpers as the dashboard and the Analytics Center), never UTC.
  let start: Date;
  let end: Date;
  if (period === "today") {
    ({ start, end } = clinicTodayRange());
  } else {
    const { year, month } = clinicMonthOf();
    ({ start, end } = clinicMonthRange(year, month));
  }

  const byStatusAgg = await Appointment.aggregate([
    { $match: { clinicId, ...doctorMatchOid(scope), type: { $ne: "blocked" }, startAt: { $gte: start, $lt: end } } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  const statusCounts: Record<string, number> = {};
  for (const row of byStatusAgg) statusCounts[row._id] = row.count;
  const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  let revenueJOD: number | undefined;
  if (showRevenue) {
    const revenueResult = await Invoice.aggregate([
      { $match: { clinicId, ...doctorMatchOid(scopeOf(ctx, "dashboardRevenue")), ...ACTIVE_INVOICE } }, // PHASE 2 — soft-deleted invoices are not revenue
      { $unwind: "$payments" },
      { $match: { "payments.paidAt": { $gte: start, $lt: end } } },
      { $group: { _id: null, total: { $sum: "$payments.amount" } } },
    ]);
    revenueJOD = revenueResult[0]?.total || 0;
  }

  const result: Record<string, unknown> = {
    period,
    total,
    completed: statusCounts["completed"] || 0,
    cancelled: statusCounts["cancelled"] || 0,
    noShow: statusCounts["no_show"] || 0,
    ...(showRevenue ? { revenueJOD } : { note: "Revenue figures are not available for this account's role." }),
  };

  // new patients are a clinic-wide figure (patients have no treating-doctor attribution) — not shown to a doctor-scoped caller
  if (period === "month" && scope.level === "clinic") {
    result.newPatients = await Patient.countDocuments({ clinicId, createdAt: { $gte: start, $lt: end } });
  }

  return result;
}
