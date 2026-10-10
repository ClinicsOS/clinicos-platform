import { Appointment } from "../../models/Appointment";
import { User } from "../../models/User";
import type { AnalyticsScope } from "./scope";
import { doctorFilter } from "./scope";
import type { DateRange } from "./range";
import { dayOf, hourOf, dowOf } from "./agg";
import { ratePct } from "./metrics";

/**
 * PHASE 6 — APPOINTMENT / WALK-IN / PATIENT-VISIT METRICS.
 *
 * Population (every metric below): Appointment where type ≠ "blocked" (blocks are doctor time-off, never visits),
 *   startAt in the clinic-local range, doctor scope applied on Appointment.doctorId.
 * Source (the ONLY way a walk-in is recognised): Appointment.source = "walk_in". "public" = online booking, "dashboard" = booked by staff.
 *   A legacy record without a source is a dashboard booking (the schema default) — never a walk-in.
 * Status: scheduled | confirmed = still open; completed; cancelled; no_show.
 * Rates (all null when the denominator is 0):
 *   completion = completed ÷ total · cancellation = cancelled ÷ total · no-show = no_show ÷ total · walk-in share = walk-ins ÷ total
 *   walk-in completion = completed walk-ins ÷ walk-ins
 * Peak day / hour: appointments that were NOT cancelled, bucketed by the clinic-local weekday / hour of startAt.
 */

type Row = Record<string, any>;
export const STATUSES = ["scheduled", "confirmed", "completed", "cancelled", "no_show"] as const;
export const SOURCES = ["dashboard", "public", "walk_in"] as const;

const base = (s: AnalyticsScope, r: DateRange) => ({ clinicId: s.clinicOid, ...doctorFilter(s), type: { $ne: "blocked" }, startAt: { $gte: r.start, $lt: r.end } });

export interface ApptBreakdown {
  total: number;
  byStatus: Record<(typeof STATUSES)[number], number>;
  bySource: Record<(typeof SOURCES)[number], number>;
  walkIn: { total: number; completed: number; cancelled: number; noShow: number };
  perDoctor: Map<string, { total: number; completed: number; cancelled: number; noShow: number; walkIn: number; walkInCompleted: number }>;
}

/** ONE grouped query (status × source × doctor — a few dozen rows) feeds every count, rate and per-doctor figure. */
export async function appointmentBreakdown(s: AnalyticsScope, r: DateRange): Promise<ApptBreakdown> {
  const rows = await Appointment.aggregate([
    { $match: base(s, r) },
    { $group: { _id: { status: "$status", source: { $ifNull: ["$source", "dashboard"] }, doctorId: "$doctorId" }, n: { $sum: 1 } } },
  ]);
  const out: ApptBreakdown = {
    total: 0,
    byStatus: { scheduled: 0, confirmed: 0, completed: 0, cancelled: 0, no_show: 0 },
    bySource: { dashboard: 0, public: 0, walk_in: 0 },
    walkIn: { total: 0, completed: 0, cancelled: 0, noShow: 0 },
    perDoctor: new Map(),
  };
  for (const x of rows) {
    const n: number = x.n ?? 0;
    const status = (STATUSES as readonly string[]).includes(x._id?.status) ? (x._id.status as (typeof STATUSES)[number]) : "scheduled";
    const source = (SOURCES as readonly string[]).includes(x._id?.source) ? (x._id.source as (typeof SOURCES)[number]) : "dashboard";
    const doc = String(x._id?.doctorId ?? "");
    out.total += n;
    out.byStatus[status] += n;
    out.bySource[source] += n;
    const d = out.perDoctor.get(doc) ?? { total: 0, completed: 0, cancelled: 0, noShow: 0, walkIn: 0, walkInCompleted: 0 };
    d.total += n;
    if (status === "completed") d.completed += n;
    if (status === "cancelled") d.cancelled += n;
    if (status === "no_show") d.noShow += n;
    if (source === "walk_in") {
      d.walkIn += n;
      out.walkIn.total += n;
      if (status === "completed") { d.walkInCompleted += n; out.walkIn.completed += n; }
      if (status === "cancelled") out.walkIn.cancelled += n;
      if (status === "no_show") out.walkIn.noShow += n;
    }
    out.perDoctor.set(doc, d);
  }
  return out;
}

export const appointmentRates = (b: ApptBreakdown) => ({
  completionRate: ratePct(b.byStatus.completed, b.total),
  cancellationRate: ratePct(b.byStatus.cancelled, b.total),
  noShowRate: ratePct(b.byStatus.no_show, b.total),
  walkInShare: ratePct(b.walkIn.total, b.total),
  walkInCompletionRate: ratePct(b.walkIn.completed, b.walkIn.total),
});

/** Per-day totals / completed / walk-ins (clinic-local days). */
export async function appointmentsByDay(s: AnalyticsScope, r: DateRange) {
  const rows = await Appointment.aggregate([
    { $match: base(s, r) },
    {
      $group: {
        _id: dayOf("$startAt"),
        total: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } },
        walkIn: { $sum: { $cond: [{ $eq: ["$source", "walk_in"] }, 1, 0] } },
      },
    },
  ]);
  return new Map<string, { total: number; completed: number; walkIn: number }>(rows.map((x: Row) => [String(x._id), { total: x.total ?? 0, completed: x.completed ?? 0, walkIn: x.walkIn ?? 0 }]));
}

/** Non-cancelled appointments by clinic-local hour (0–23) — optionally only walk-ins. */
export async function appointmentsByHour(s: AnalyticsScope, r: DateRange, walkInOnly = false): Promise<number[]> {
  const rows = await Appointment.aggregate([
    { $match: { ...base(s, r), status: { $ne: "cancelled" }, ...(walkInOnly ? { source: "walk_in" } : {}) } },
    { $group: { _id: hourOf("$startAt"), n: { $sum: 1 } } },
  ]);
  const out = new Array(24).fill(0);
  for (const x of rows) if (Number.isInteger(x._id) && x._id >= 0 && x._id < 24) out[x._id] = x.n ?? 0;
  return out;
}

/** Non-cancelled appointments by clinic-local weekday, index 0 = Sunday … 6 = Saturday. */
export async function appointmentsByWeekday(s: AnalyticsScope, r: DateRange): Promise<number[]> {
  const rows = await Appointment.aggregate([{ $match: { ...base(s, r), status: { $ne: "cancelled" } } }, { $group: { _id: dowOf("$startAt"), n: { $sum: 1 } } }]);
  const out = new Array(7).fill(0);
  for (const x of rows) if (Number.isInteger(x._id) && x._id >= 1 && x._id <= 7) out[x._id - 1] = x.n ?? 0;
  return out;
}

/** Distinct patients with a COMPLETED visit, per doctor, in the range. */
export async function patientsSeenByDoctor(s: AnalyticsScope, r: DateRange): Promise<Map<string, number>> {
  const rows = await Appointment.aggregate([
    { $match: { ...base(s, r), status: "completed" } },
    { $group: { _id: { doctorId: "$doctorId", patientId: "$patientId" } } },
    { $group: { _id: "$_id.doctorId", patients: { $sum: 1 } } },
  ]);
  return new Map(rows.map((x: Row) => [String(x._id), x.patients ?? 0]));
}

/** Names of doctors of THIS clinic (history may point at a doctor who has since left — still resolved, never guessed). */
export async function doctorNames(clinicId: string, ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  if (!uniq.length) return m;
  const users = await User.find({ clinicId, _id: { $in: uniq } }).select("name").lean();
  for (const u of users as Row[]) m.set(String(u._id), u.name);
  return m;
}
