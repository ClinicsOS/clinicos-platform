import mongoose from "mongoose";
import { Invoice, ACTIVE_INVOICE, DELETED_INVOICE } from "../models/Invoice";
import { doctorMatch, type DataScope } from "../auth/policy";
import { reserveInvoiceNumber } from "./invoiceNumbering";

/**
 * PHASE 2 — THE invoice deletion lifecycle. One implementation, used by every endpoint (and therefore by every screen):
 *
 *      ACTIVE ──softDelete──▶ DELETED (deletedAt set) ──restore──▶ ACTIVE
 *                                     └──permanentDelete──▶ gone from the database
 *
 *  - softDelete NEVER removes the document: it only stamps deletedAt / deletedBy / deleteReason. Items, discount, total, payments, status
 *    and the invoice number are not touched, so deletion and payment status stay two separate concepts.
 *  - restore clears those three fields and stamps restoredAt / restoredBy. It is the SAME document (same _id, same invoice number): nothing is
 *    created, so a restore can never duplicate an invoice or consume a number.
 *  - permanentDelete works ONLY on an invoice that is already soft-deleted, and only with the invoice number typed back as confirmation.
 *    PHASE 3: the HTTP layer allows it for the clinic OWNER only, and the clinic's number counter is pinned above the number first (never reused).
 *
 * Authorization is part of every database filter, not a check beside it: the filter always carries { _id, clinicId } plus the caller's data scope
 * (a doctor: doctorId == self). An invoice of another clinic, or of another doctor, is therefore simply "not found" (404) — the same answer as a
 * made-up id, so the endpoints are no existence oracle.
 *
 * Every transition is ONE atomic findOneAndUpdate / findOneAndDelete whose filter contains the state it expects (deletedAt null / not null), so two
 * requests racing each other (a double click, two staff members) cannot both win and cannot run an invalid transition.
 */

export type Fail = { ok: false; status: number; code: string; message: string };
export type Done<T = any> = { ok: true; invoice: T };
export type Result<T = any> = Done<T> | Fail;

const fail = (status: number, code: string, message: string): Fail => ({ ok: false, status, code, message });
const NOT_FOUND = () => fail(404, "INVOICE_NOT_FOUND", "Invoice not found");

export interface Actor {
  clinicId: string;
  userId: string;
  /** The caller's data scope for the lifecycle resource (resolveDataScope(req, "invoicesDelete" | "invoicesPurge")). */
  scope: DataScope;
}

const oid = (v: unknown) => mongoose.isValidObjectId(v) && /^[a-f\d]{24}$/i.test(String(v));
const BAD_ID = () => fail(400, "INVALID_ID", "Invalid ID format");

/** The filter for "this invoice, in this clinic, that this caller may manage". */
const mine = (a: Actor, id: string) => ({ _id: id, clinicId: a.clinicId, ...doctorMatch(a.scope) });

/** ACTIVE -> DELETED. */
export async function softDeleteInvoice(a: Actor, id: string, reason?: string | null): Promise<Result> {
  if (!oid(id)) return BAD_ID();
  const cleanReason = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 300) : null;
  const doc = await Invoice.findOneAndUpdate(
    { ...mine(a, id), ...ACTIVE_INVOICE },
    { $set: { deletedAt: new Date(), deletedBy: a.userId, deleteReason: cleanReason } },
    { new: true }
  );
  if (doc) return { ok: true, invoice: doc };
  // Why not? Out of scope / unknown -> 404 (indistinguishable); in scope but already deleted -> 409.
  const exists = await Invoice.exists(mine(a, id));
  return exists ? fail(409, "INVOICE_ALREADY_DELETED", "This invoice is already in Deleted Invoices") : NOT_FOUND();
}

/** DELETED -> ACTIVE (same document). */
export async function restoreInvoice(a: Actor, id: string): Promise<Result> {
  if (!oid(id)) return BAD_ID();
  const doc = await Invoice.findOneAndUpdate(
    { ...mine(a, id), ...DELETED_INVOICE },
    { $set: { deletedAt: null, deletedBy: null, deleteReason: null, restoredAt: new Date(), restoredBy: a.userId } },
    { new: true }
  );
  if (doc) return { ok: true, invoice: doc };
  const exists = await Invoice.exists(mine(a, id));
  return exists ? fail(409, "INVOICE_NOT_DELETED", "This invoice is not in Deleted Invoices") : NOT_FOUND();
}

/** "INV-0012", "inv12", "#12", "12" or 12 -> 12 (null when it is none of those). */
export function parseInvoiceNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(?:inv[-\s]?)?#?0*(\d{1,9})$/i);
  return m ? Number(m[1]) : null;
}

/** DELETED -> gone. The caller must type the invoice number; an ACTIVE invoice is refused (409) and left exactly as it is. */
export async function permanentDeleteInvoice(a: Actor, id: string, confirm: unknown): Promise<Result> {
  if (!oid(id)) return BAD_ID();
  const doc: any = await Invoice.findOne(mine(a, id)).lean();
  if (!doc) return NOT_FOUND();
  if (!doc.deletedAt) return fail(409, "INVOICE_NOT_DELETED", "An invoice must be moved to Deleted Invoices before it can be permanently deleted");
  if (parseInvoiceNumber(confirm) !== doc.invoiceNumber) {
    return fail(400, "CONFIRMATION_MISMATCH", "Type the invoice number to confirm the permanent deletion");
  }
  // PHASE 3 — pin the clinic's counter at (or above) this number FIRST, so the number can never be handed out again once the row is gone.
  await reserveInvoiceNumber(a.clinicId, doc.invoiceNumber);
  // The filter repeats the state we checked (still deleted, same number): if somebody restored it a moment ago nothing is removed.
  const removed = await Invoice.findOneAndDelete({ ...mine(a, id), ...DELETED_INVOICE, invoiceNumber: doc.invoiceNumber });
  if (!removed) return fail(409, "INVOICE_CHANGED", "This invoice just changed — please refresh and try again");
  return { ok: true, invoice: doc };
}
