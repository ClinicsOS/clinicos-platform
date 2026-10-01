import mongoose from "mongoose";
import { Invoice } from "../models/Invoice";
import { DermTreatmentItem } from "../models/DermTreatmentItem";

/**
 * Dermatology & Aesthetics -> Invoice: the ONE authoritative billing operation for a COMPLETED treatment item.
 * (Same algorithm as services/dentalBilling.ts — kept as a separate file so Dentistry is not touched at all.)
 *
 * Principles
 *  - The existing Invoice / Payment system stays the ONLY financial source of truth. Derm only stores a LINK
 *    (which invoice line was created for a treatment) — never a balance, never a payment.
 *  - Billing unit = the COMPLETED treatment plan item (never a single session): one item -> one invoice line.
 *  - No MongoDB transaction is assumed. Consistency comes from:
 *      1) an atomic CLAIM on the treatment item (only one caller can hold it),
 *      2) IDs generated BEFORE anything is written (invoice line _id, and _id of a new invoice) and stored in the claim,
 *         so a retry after a crash can find out exactly what did / didn't get written,
 *      3) every step idempotent, and a stale claim that produced nothing is released.
 */
export const STALE_CLAIM_MS = 60_000;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const isOid = (v: unknown) => mongoose.isValidObjectId(v);

export type Fail = { ok: false; status: number; code: string; message: string };
const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });

export interface Ctx { clinicId: any; userId: any; patientId?: any }

export interface BillingView {
  state: "none" | "pending" | "invoiced";
  invoiceId?: string;
  invoiceNumber?: number;
  invoiceItemId?: string;
  /** LIVE amount of the invoice line (price x qty) — the invoice is authoritative, not the snapshot below. */
  amount?: number;
  invoiceStatus?: string;
  at?: Date;
  by?: { _id: string; name: string } | null;
}

const linePresent = (inv: any, lineId: unknown) => !!inv?.items?.some((l: any) => String(l._id) === String(lineId));

/** Display state for many treatment items at once (read-only; nothing is written). */
/** Clinic-wide read of the SAME authoritative billing state (no patient scoping) — used by the Derm Dashboard. */
export const loadDermBillingViewsForClinic = (clinicId: any, items: any[]) => loadDermBillingViews({ clinicId, userId: undefined }, items);

export async function loadDermBillingViews(ctx: Ctx, items: any[]): Promise<Map<string, BillingView>> {
  const out = new Map<string, BillingView>();
  const wanted = items.filter((i) => i.billing && (i.billing.state === "invoiced" || i.billing.state === "pending"));
  const ids = [...new Set(wanted.map((i) => String(i.billing.invoiceId)))].filter(isOid);
  // patientId is omitted for a clinic-wide read (e.g. the Derm Dashboard's "Needs Billing"); every per-patient
  // caller still passes it, so their behaviour is unchanged.
  const invs = ids.length
    ? ((await Invoice.find({ _id: { $in: ids }, clinicId: ctx.clinicId, ...(ctx.patientId ? { patientId: ctx.patientId } : {}) }).select("invoiceNumber status items").lean()) as any[])
    : [];
  const byId = new Map(invs.map((v) => [String(v._id), v]));
  for (const it of items) {
    const b = it.billing;
    if (!b || !b.state || b.state === "none") { out.set(String(it._id), { state: "none" }); continue; }
    const inv = byId.get(String(b.invoiceId));
    const line = inv?.items?.find((l: any) => String(l._id) === String(b.invoiceItemId));
    const by = b.by && b.by._id ? { _id: String(b.by._id), name: b.by.name } : null;
    if (line) {
      out.set(String(it._id), { state: "invoiced", invoiceId: String(inv._id), invoiceNumber: inv.invoiceNumber, invoiceItemId: String(line._id), amount: round3(line.price * line.qty), invoiceStatus: inv.status, at: b.at, by });
    } else if (b.state === "pending" && b.at && Date.now() - new Date(b.at).getTime() < STALE_CLAIM_MS) {
      out.set(String(it._id), { state: "pending" });
    } else {
      out.set(String(it._id), { state: "none" }); // the invoice line is gone (or the claim went stale): billable again
    }
  }
  return out;
}

const release = (ctx: Ctx, item: any, reason: string) =>
  DermTreatmentItem.findOneAndUpdate(
    { _id: item._id, clinicId: ctx.clinicId, patientId: ctx.patientId, "billing.claimId": item.billing.claimId, "billing.state": { $in: ["pending", "invoiced"] } },
    {
      $set: { "billing.state": "none" },
      $push: { billingHistory: { event: "released", at: new Date(), by: ctx.userId, invoiceId: item.billing.invoiceId, invoiceItemId: item.billing.invoiceItemId, invoiceNumber: item.billing.invoiceNumber, amount: item.billing.amount, reason } },
    },
    { new: true }
  );

const finalize = (ctx: Ctx, item: any, invoiceNumber: number) =>
  DermTreatmentItem.findOneAndUpdate(
    { _id: item._id, clinicId: ctx.clinicId, patientId: ctx.patientId, "billing.claimId": item.billing.claimId, "billing.state": "pending" },
    {
      $set: { "billing.state": "invoiced", "billing.invoiceNumber": invoiceNumber },
      $push: { billingHistory: { event: "invoiced", at: new Date(), by: item.billing.by, invoiceId: item.billing.invoiceId, invoiceItemId: item.billing.invoiceItemId, invoiceNumber, amount: item.billing.amount } },
    },
    { new: true }
  );

type Existing = { kind: "none" } | { kind: "invoiced"; invoice: any } | { kind: "pending" };

/**
 * Where does this item stand right now? Self-heals: a crashed attempt is either completed (its invoice line exists)
 * or released (nothing was written and the claim is stale), so a retry is always safe.
 */
async function resolveExisting(ctx: Ctx, item: any): Promise<Existing> {
  const b = item.billing;
  if (!b || !b.state || b.state === "none") return { kind: "none" };
  const inv: any = isOid(b.invoiceId) ? await Invoice.findOne({ _id: b.invoiceId, clinicId: ctx.clinicId, patientId: ctx.patientId }) : null;
  const present = linePresent(inv, b.invoiceItemId);
  if (b.state === "invoiced") {
    if (present) return { kind: "invoiced", invoice: inv };
    await release(ctx, item, "invoice line no longer exists"); // e.g. staff removed the line from the invoice
    return { kind: "none" };
  }
  // pending
  if (present) { await finalize(ctx, item, inv.invoiceNumber); return { kind: "invoiced", invoice: inv }; } // crashed after the invoice write
  if (b.at && Date.now() - new Date(b.at).getTime() < STALE_CLAIM_MS) return { kind: "pending" };
  await release(ctx, item, "abandoned attempt"); // nothing was written
  return { kind: "none" };
}

/** Add one line to an EXISTING invoice. Optimistic guarded update (no lost updates vs. payments / other edits). */
async function appendToInvoice(ctx: Ctx, invoiceId: any, line: { _id: any; description: string; price: number }, sourceId: any) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const inv: any = await Invoice.findOne({ _id: invoiceId, clinicId: ctx.clinicId, patientId: ctx.patientId });
    if (!inv) return fail(404, "INVOICE_NOT_FOUND", "Invoice not found");
    if (linePresent(inv, line._id)) return { ok: true as const, invoice: inv }; // idempotent retry
    if (inv.status === "paid") return fail(409, "INVOICE_NOT_EDITABLE", "This invoice is already fully paid. Create a new invoice or choose another one.");
    const itemsTotal = inv.items.reduce((s: number, i: any) => s + i.price * i.qty, 0) + line.price;
    const total = round3(Math.max(0, itemsTotal - inv.discount));
    const paid = inv.payments.reduce((s: number, p: any) => s + p.amount, 0);
    const status = paid >= total ? "paid" : paid === 0 ? "unpaid" : "partially_paid"; // same outcomes as create/update invoice
    const updated: any = await Invoice.findOneAndUpdate(
      { _id: invoiceId, clinicId: ctx.clinicId, patientId: ctx.patientId, total: inv.total, discount: inv.discount, items: { $size: inv.items.length }, payments: { $size: inv.payments.length } },
      { $push: { items: { _id: line._id, description: line.description, price: line.price, qty: 1, sourceType: "derm_treatment", sourceId } }, $set: { total, status } },
      { new: true }
    );
    if (updated) return { ok: true as const, invoice: updated };
  }
  return fail(409, "INVOICE_CHANGED", "This invoice changed while you were adding the treatment. Please try again.");
}

/** Create a NEW invoice through the same rules as the normal invoice creation (numbering, status). */
async function createInvoiceWithLine(ctx: Ctx, invoiceId: any, line: { _id: any; description: string; price: number }, sourceId: any, appointmentId?: any) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const count = await Invoice.countDocuments({ clinicId: ctx.clinicId });
    try {
      const inv: any = await Invoice.create({
        _id: invoiceId, clinicId: ctx.clinicId, invoiceNumber: count + 1, patientId: ctx.patientId, appointmentId,
        items: [{ _id: line._id, description: line.description, price: line.price, qty: 1, sourceType: "derm_treatment", sourceId }],
        discount: 0, total: round3(line.price), status: line.price === 0 ? "paid" : "unpaid",
      });
      return { ok: true as const, invoice: inv };
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      const mine: any = await Invoice.findOne({ _id: invoiceId, clinicId: ctx.clinicId, patientId: ctx.patientId }); // same claim wrote it already
      if (mine) return { ok: true as const, invoice: mine };
      // otherwise: invoice number collision with a concurrent invoice — recount and retry
    }
  }
  return fail(409, "INVOICE_CREATE_FAILED", "Could not create the invoice. Please try again.");
}

export interface BillInput { price: number; description: string; invoiceId?: string }
export type BillResult =
  | { ok: true; created: boolean; invoice: { _id: string; invoiceNumber: number; status: string; total: number }; invoiceLineId: string }
  | Fail;

const invoiceBrief = (inv: any) => ({ _id: String(inv._id), invoiceNumber: inv.invoiceNumber, status: inv.status, total: inv.total });

export async function billDermTreatmentItem(ctx: Ctx, itemId: unknown, input: BillInput): Promise<BillResult> {
  for (let round = 0; round < 3; round++) {
    const item: any = await DermTreatmentItem.findOne({ _id: itemId, clinicId: ctx.clinicId, patientId: ctx.patientId });
    if (!item) return fail(404, "NOT_FOUND", "Treatment item not found");
    if (item.status === "cancelled") return fail(409, "TREATMENT_CANCELLED", "A cancelled treatment can't be invoiced");
    if (item.status !== "completed") return fail(409, "TREATMENT_NOT_COMPLETED", "Only a completed treatment can be added to an invoice");

    const ex = await resolveExisting(ctx, item);
    if (ex.kind === "invoiced") return { ok: true, created: false, invoice: invoiceBrief(ex.invoice), invoiceLineId: String(item.billing.invoiceItemId) }; // idempotent
    if (ex.kind === "pending") return fail(409, "BILLING_IN_PROGRESS", "This treatment is being added to an invoice right now. Refresh in a moment.");

    // validate the target BEFORE claiming (never trust the client's invoiceId)
    let target: any = null;
    if (input.invoiceId) {
      target = isOid(input.invoiceId) ? await Invoice.findOne({ _id: input.invoiceId, clinicId: ctx.clinicId, patientId: ctx.patientId }) : null;
      if (!target) return fail(404, "INVOICE_NOT_FOUND", "Invoice not found for this patient");
      if (target.status === "paid") return fail(409, "INVOICE_NOT_EDITABLE", "This invoice is already fully paid. Create a new invoice or choose another one.");
    }

    const claimId = String(new mongoose.Types.ObjectId());
    const lineId = new mongoose.Types.ObjectId();
    const invoiceId = target ? target._id : new mongoose.Types.ObjectId();
    const completedIn = [...(item.statusHistory ?? [])].reverse().find((h: any) => h.status === "completed")?.appointmentId; // visit it was completed in
    const claimed = await DermTreatmentItem.findOneAndUpdate(
      { _id: item._id, clinicId: ctx.clinicId, patientId: ctx.patientId, status: "completed", "billing.state": { $nin: ["pending", "invoiced"] } },
      { $set: { billing: { state: "pending", claimId, invoiceId, invoiceItemId: lineId, amount: input.price, description: input.description, at: new Date(), by: ctx.userId } } },
      { new: true }
    );
    if (!claimed) continue; // somebody else got there first — re-evaluate (they'll be seen as invoiced / in progress)

    const line = { _id: lineId, description: input.description, price: input.price };
    let res: any;
    try {
      res = target ? await appendToInvoice(ctx, invoiceId, line, item._id) : await createInvoiceWithLine(ctx, invoiceId, line, item._id, completedIn);
    } catch (err) {
      // an unexpected failure: nothing (or maybe something) was written — decide from what is really there
      const inv: any = await Invoice.findOne({ _id: invoiceId, clinicId: ctx.clinicId, patientId: ctx.patientId });
      if (!linePresent(inv, lineId)) await release(ctx, claimed, "invoice write failed");
      throw err;
    }
    if (!res.ok) { await release(ctx, claimed, res.code); return res; }

    const done = await finalize(ctx, claimed, res.invoice.invoiceNumber);
    if (!done) {
      // someone healed it between our steps: fine as long as it ended up invoiced with our line
      const cur: any = await DermTreatmentItem.findOne({ _id: item._id, clinicId: ctx.clinicId, patientId: ctx.patientId });
      if (!(cur?.billing?.state === "invoiced" && String(cur.billing.invoiceItemId) === String(lineId))) return fail(409, "BILLING_CONFLICT", "Please refresh and check the invoice before trying again.");
    }
    return { ok: true, created: true, invoice: invoiceBrief(res.invoice), invoiceLineId: String(lineId) };
  }
  return fail(409, "BILLING_CONFLICT", "This treatment was just invoiced by someone else. Refresh to see it.");
}
