import { Invoice } from "../../models/Invoice";
import { DentalTreatmentItem } from "../../models/DentalTreatmentItem";
import { DermTreatmentItem } from "../../models/DermTreatmentItem";
import type { AnalyticsScope } from "./scope";
import { doctorFilter } from "./scope";
import type { DateRange } from "./range";
import { dayOf, round3 } from "./agg";

/**
 * PHASE 6 — FINANCIAL METRICS (invoices & payments). Cash-basis. Expense money lives in services/expenseLedger.ts (Phase 5).
 *
 * ┌ Collected revenue ─ Source: Invoice.payments[]   Date: payments.paidAt (clinic-local day)
 * │    Formula: Σ payments.amount of every payment whose paidAt falls in the range. NOT the invoice total.
 * │    Doctor attribution: Invoice.doctorId (the TREATING doctor, Phase 4). Never Invoice.createdBy. No doctorId → "unassigned / legacy".
 * │    ClinicOS has no void / refund state on a payment or an invoice, so every stored payment is a valid payment.
 * ├ Invoiced revenue ─ Source: Invoice.total   Date: Invoice.createdAt (the invoice's issue date; there is no separate one)
 * │    Formula: Σ invoice.total (net of the invoice discount) of invoices created in the range.
 * ├ Outstanding ─ Source: Invoice   Date: AS OF NOW (a balance, not a flow — it has no "previous period")
 * │    Formula: Σ (invoice.total − Σ payments.amount) over invoices whose status is unpaid / partially_paid and whose balance > 0.
 * └ Payment status ─ the invoice's own `status` (the existing invoice logic) for invoices created in the range.
 */

type Row = Record<string, any>;
const idStr = (v: unknown) => (v ? String(v) : null);
export const UNASSIGNED = "unassigned";

const paymentsInRange = (s: AnalyticsScope, r: DateRange, group: Row) => [
  { $match: { clinicId: s.clinicOid, ...doctorFilter(s), "payments.paidAt": { $gte: r.start, $lt: r.end } } },
  { $unwind: "$payments" },
  { $match: { "payments.paidAt": { $gte: r.start, $lt: r.end } } },
  { $group: group },
];

/** Collected revenue in the range. */
export async function collectedTotal(s: AnalyticsScope, r: DateRange): Promise<{ amount: number; payments: number }> {
  const rows = await Invoice.aggregate(paymentsInRange(s, r, { _id: null, total: { $sum: "$payments.amount" }, n: { $sum: 1 } }));
  return { amount: round3(rows[0]?.total ?? 0), payments: rows[0]?.n ?? 0 };
}

/** Collected revenue per clinic-local day (a Map "YYYY-MM-DD" → JD). */
export async function collectedByDay(s: AnalyticsScope, r: DateRange): Promise<Map<string, number>> {
  const rows = await Invoice.aggregate(paymentsInRange(s, r, { _id: dayOf("$payments.paidAt"), total: { $sum: "$payments.amount" } }));
  return new Map(rows.map((x: Row) => [String(x._id), x.total ?? 0]));
}

/** Collected revenue per treating doctor ("unassigned" = legacy invoices with no doctor). Same pipeline as the total, just keyed by doctor. */
export async function collectedByDoctor(s: AnalyticsScope, r: DateRange): Promise<Map<string, number>> {
  const rows = await Invoice.aggregate(paymentsInRange(s, r, { _id: "$doctorId", total: { $sum: "$payments.amount" } }));
  const out = new Map<string, number>();
  for (const x of rows) out.set(idStr(x._id) ?? UNASSIGNED, round3((out.get(idStr(x._id) ?? UNASSIGNED) ?? 0) + (x.total ?? 0)));
  return out;
}

/** Collected revenue by payment method (cash / cliq / card / other). */
export async function collectedByMethod(s: AnalyticsScope, r: DateRange): Promise<{ method: string; amount: number; payments: number }[]> {
  const rows = await Invoice.aggregate(paymentsInRange(s, r, { _id: "$payments.method", total: { $sum: "$payments.amount" }, n: { $sum: 1 } }));
  return rows.map((x: Row) => ({ method: String(x._id ?? "other"), amount: round3(x.total ?? 0), payments: x.n ?? 0 })).sort((a, b) => b.amount - a.amount || (a.method < b.method ? -1 : 1));
}

const invoicesIn = (s: AnalyticsScope, r: DateRange) => ({ clinicId: s.clinicOid, ...doctorFilter(s), createdAt: { $gte: r.start, $lt: r.end } });

/** Invoiced revenue in the range. */
export async function invoicedTotal(s: AnalyticsScope, r: DateRange): Promise<{ amount: number; invoices: number }> {
  const rows = await Invoice.aggregate([{ $match: invoicesIn(s, r) }, { $group: { _id: null, total: { $sum: "$total" }, n: { $sum: 1 } } }]);
  return { amount: round3(rows[0]?.total ?? 0), invoices: rows[0]?.n ?? 0 };
}

export async function invoicedByDay(s: AnalyticsScope, r: DateRange): Promise<Map<string, number>> {
  const rows = await Invoice.aggregate([{ $match: invoicesIn(s, r) }, { $group: { _id: dayOf("$createdAt"), total: { $sum: "$total" } } }]);
  return new Map(rows.map((x: Row) => [String(x._id), x.total ?? 0]));
}

/** Outstanding balance as of now (see header). Sub-fil float noise (< 0.0005 JD) is not a balance. */
export async function outstanding(s: AnalyticsScope): Promise<{ amount: number; invoices: number }> {
  const rows = await Invoice.aggregate([
    { $match: { clinicId: s.clinicOid, ...doctorFilter(s), status: { $in: ["unpaid", "partially_paid"] } } },
    { $addFields: { paid: { $sum: "$payments.amount" } } },
    { $addFields: { balance: { $subtract: ["$total", "$paid"] } } },
    { $match: { balance: { $gt: 0.0005 } } },
    { $group: { _id: null, amount: { $sum: "$balance" }, n: { $sum: 1 } } },
  ]);
  return { amount: round3(rows[0]?.amount ?? 0), invoices: rows[0]?.n ?? 0 };
}

/** Invoices created in the range by their stored status, with their billed and collected-so-far amounts. */
export async function paymentStatus(s: AnalyticsScope, r: DateRange) {
  const rows = await Invoice.aggregate([
    { $match: invoicesIn(s, r) },
    { $group: { _id: "$status", invoices: { $sum: 1 }, billed: { $sum: "$total" }, paid: { $sum: { $sum: "$payments.amount" } } } },
  ]);
  const base = { invoices: 0, billed: 0, paid: 0 };
  const by: Record<"paid" | "partially_paid" | "unpaid", typeof base> = { paid: { ...base }, partially_paid: { ...base }, unpaid: { ...base } };
  for (const x of rows) {
    const k = (x._id === "paid" || x._id === "partially_paid" ? x._id : "unpaid") as keyof typeof by;
    by[k].invoices += x.invoices ?? 0;
    by[k].billed = round3(by[k].billed + (x.billed ?? 0));
    by[k].paid = round3(by[k].paid + (x.paid ?? 0));
  }
  return by;
}

/**
 * Billed value by service. A treatment billed through "Add to invoice" carries sourceType/sourceId on its invoice line (set only by
 * trusted server code), so the line can be traced to the treatment's procedure. Lines typed by hand have no source and are reported
 * as ONE "manual lines" bucket — never guessed from the free-text description.
 * IMPORTANT: this is the LINE value (price × qty) of invoices created in the range, BEFORE the invoice-level discount; payments are not
 * allocated to lines, so this is not "collected revenue by service".
 */
export async function billedByService(s: AnalyticsScope, r: DateRange) {
  const lines = await Invoice.aggregate([
    { $match: invoicesIn(s, r) },
    { $unwind: "$items" },
    { $group: { _id: { type: "$items.sourceType", id: "$items.sourceId" }, amount: { $sum: { $multiply: ["$items.price", "$items.qty"] } }, n: { $sum: 1 } } },
  ]);
  let manual = 0, manualLines = 0;
  const wanted: Record<string, Map<string, number>> = { dental_treatment: new Map(), derm_treatment: new Map() };
  for (const l of lines) {
    const type = l._id?.type as string | undefined, id = idStr(l._id?.id);
    if (!type || !id || !wanted[type]) { manual += l.amount ?? 0; manualLines += l.n ?? 0; continue; }
    wanted[type].set(id, (wanted[type].get(id) ?? 0) + (l.amount ?? 0));
  }
  const byCode = new Map<string, { code: string; amount: number; treatments: number; source: string }>();
  const lookups: [string, any][] = [["dental_treatment", DentalTreatmentItem], ["derm_treatment", DermTreatmentItem]];
  for (const [type, Model] of lookups) {
    const ids = Array.from(wanted[type].keys());
    for (let i = 0; i < ids.length; i += 500) {
      const items = await Model.find({ _id: { $in: ids.slice(i, i + 500) }, clinicId: s.clinicId }).select("procedureCode customName").lean();
      const seen = new Set<string>();
      for (const it of items as Row[]) {
        const code = String(it.procedureCode);
        seen.add(String(it._id));
        const row = byCode.get(`${type}:${code}`) ?? { code, amount: 0, treatments: 0, source: type };
        row.amount += wanted[type].get(String(it._id)) ?? 0;
        row.treatments += 1;
        byCode.set(`${type}:${code}`, row);
      }
      // a sourced line whose treatment no longer exists (or belongs to another clinic) is not guessed — it joins the manual bucket
      for (const id of ids.slice(i, i + 500)) if (!seen.has(id)) { manual += wanted[type].get(id) ?? 0; manualLines += 1; }
    }
  }
  return {
    byTreatment: Array.from(byCode.values()).map((x) => ({ ...x, amount: round3(x.amount) })).sort((a, b) => b.amount - a.amount || (a.code < b.code ? -1 : 1)),
    manual: { amount: round3(manual), lines: manualLines },
  };
}
