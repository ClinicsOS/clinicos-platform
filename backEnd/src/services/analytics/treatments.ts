import { DentalTreatmentItem } from "../../models/DentalTreatmentItem";
import { DermTreatmentItem } from "../../models/DermTreatmentItem";
import type { AnalyticsScope } from "./scope";
import type { DateRange } from "./range";
import { resolveTreatingDoctors } from "../doctorAttribution";
import { round3 } from "./agg";
import { ratePct } from "./metrics";

/**
 * PHASE 6 — TREATMENT METRICS (dentistry → DentalTreatmentItem, dermatology → DermTreatmentItem).
 *
 * SOURCE OF TRUTH = the Treatment Plan ITEM (one document per treatment). The dental chart, the invoice line, the session list and the
 * timeline all POINT AT an item; none of them is counted separately, so a treatment is never counted twice.
 *
 *  • Completed   = items whose CURRENT status is "completed" and whose last "completed" entry in `statusHistory` falls in the range
 *                  (the date is the server-written history entry, not updatedAt).
 *  • Started     = distinct items with an "in_progress" history entry in the range.                  (clinic-wide only)
 *  • Cancelled   = distinct items whose current status is "cancelled" with a "cancelled" entry in the range.  (clinic-wide only)
 *  • Planned     = items created in the range (createdAt).                                           (clinic-wide only)
 *  • Completion rate = completed ÷ (completed + cancelled) of the same range — items that reached a final state in the range.
 *  • Treating doctor = SAME Phase 4 rule used for billing (services/doctorAttribution.ts → resolveTreatingDoctors): the doctor who
 *    completed it, else the doctor of the visit it was completed in, else "unassigned". Planned / started / cancelled have no reliable
 *    treating doctor (the creator of a plan is not the treating doctor), so a doctor-scoped report returns null for them — never a guess.
 *  • Estimated value = Σ estimatedPrice of the completed items. It is an ESTIMATE (never a charge); real money is in the invoice metrics.
 *  • Invoiced = completed items whose billing link is "invoiced"; "not invoiced" = the rest.
 */

type Row = Record<string, any>;
export type TreatmentKind = "dental" | "derm";
const modelOf = (k: TreatmentKind): any => (k === "dental" ? DentalTreatmentItem : DermTreatmentItem);

export interface TreatmentStats {
  kind: TreatmentKind;
  planned: number | null;
  started: number | null;
  cancelled: number | null;
  completed: number;
  completionRate: number | null;
  estimatedValue: number;
  invoiced: number;
  notInvoiced: number;
  byProcedure: { code: string; count: number; estimatedValue: number }[];
  byDoctor: { doctorId: string | null; count: number; estimatedValue: number }[];
  topTeeth: { tooth: string; count: number }[]; // dental only
}

const lastCompletedAt = (it: Row): Date | null => {
  const h = [...(it.statusHistory ?? [])].reverse().find((x: Row) => x?.status === "completed");
  return h?.at ? new Date(h.at) : null;
};

export async function treatmentStats(s: AnalyticsScope, r: DateRange, kind: TreatmentKind): Promise<TreatmentStats> {
  const Model = modelOf(kind);
  const clinicWideOnly = s.level === "clinic" && !s.doctorId; // planned / started / cancelled can't be attributed to a treating doctor

  // 1) status transitions that happened in the range (small: grouped by status × current status)
  const events: Row[] = await Model.aggregate([
    { $match: { clinicId: s.clinicOid, "statusHistory.at": { $gte: r.start, $lt: r.end } } },
    { $unwind: "$statusHistory" },
    { $match: { "statusHistory.at": { $gte: r.start, $lt: r.end } } },
    { $group: { _id: { status: "$statusHistory.status", cur: "$status", item: "$_id" } } },
    { $group: { _id: { status: "$_id.status", cur: "$_id.cur" }, n: { $sum: 1 } } },
  ]);
  const ev = (status: string, cur?: string) => events.filter((e) => e._id?.status === status && (cur === undefined || e._id?.cur === cur)).reduce((a, e) => a + (e.n ?? 0), 0);

  // 2) planned in range (clinic-wide only)
  let planned: number | null = null;
  if (clinicWideOnly) {
    const p = await Model.aggregate([{ $match: { clinicId: s.clinicOid, createdAt: { $gte: r.start, $lt: r.end } } }, { $group: { _id: null, n: { $sum: 1 } } }]);
    planned = p[0]?.n ?? 0;
  }

  // 3) the items completed in the range (ids from the database; details fetched in bounded batches)
  const ids: Row[] = await Model.aggregate([
    { $match: { clinicId: s.clinicOid, status: "completed", "statusHistory.at": { $gte: r.start, $lt: r.end } } },
    { $unwind: "$statusHistory" },
    { $match: { "statusHistory.status": "completed", "statusHistory.at": { $gte: r.start, $lt: r.end } } },
    { $group: { _id: "$_id" } },
  ]);
  const done: Row[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500).map((x) => x._id);
    const items: Row[] = await Model.find({ _id: { $in: chunk }, clinicId: s.clinicId, status: "completed" }).select("procedureCode customName estimatedPrice statusHistory toothNumbers billing").lean();
    for (const it of items) {
      const at = lastCompletedAt(it);
      if (at && at >= r.start && at < r.end) done.push(it); // the LAST completion decides which period it belongs to
    }
  }
  const doctors = await resolveTreatingDoctors(s.clinicId, done.map((d) => ({ _id: d._id, statusHistory: d.statusHistory })));
  const mine = s.doctorId ? done.filter((d) => doctors.get(String(d._id)) === s.doctorId) : done;

  const proc = new Map<string, { count: number; value: number }>();
  const doc = new Map<string, { count: number; value: number }>();
  const teeth = new Map<string, number>();
  let value = 0, invoiced = 0;
  for (const it of mine) {
    const price = Number(it.estimatedPrice) || 0;
    value += price;
    if (it.billing?.state === "invoiced") invoiced += 1;
    const code = String(it.procedureCode);
    const p = proc.get(code) ?? { count: 0, value: 0 };
    p.count += 1; p.value += price; proc.set(code, p);
    const d = doctors.get(String(it._id)) ?? "";
    const dd = doc.get(d) ?? { count: 0, value: 0 };
    dd.count += 1; dd.value += price; doc.set(d, dd);
    for (const t of it.toothNumbers ?? []) teeth.set(String(t), (teeth.get(String(t)) ?? 0) + 1);
  }

  const completed = mine.length;
  const cancelled = clinicWideOnly ? ev("cancelled", "cancelled") : null;
  return {
    kind,
    planned,
    started: clinicWideOnly ? ev("in_progress") : null,
    cancelled,
    completed,
    completionRate: clinicWideOnly ? ratePct(completed, completed + (cancelled ?? 0)) : null,
    estimatedValue: round3(value),
    invoiced,
    notInvoiced: completed - invoiced,
    byProcedure: Array.from(proc.entries()).map(([code, v]) => ({ code, count: v.count, estimatedValue: round3(v.value) })).sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1)),
    byDoctor: Array.from(doc.entries()).map(([id, v]) => ({ doctorId: id || null, count: v.count, estimatedValue: round3(v.value) })).sort((a, b) => b.count - a.count),
    topTeeth: Array.from(teeth.entries()).map(([tooth, count]) => ({ tooth, count })).sort((a, b) => b.count - a.count || (a.tooth < b.tooth ? -1 : 1)).slice(0, 8),
  };
}
