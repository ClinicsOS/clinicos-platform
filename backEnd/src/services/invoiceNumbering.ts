/**
 * PHASE 3 — THE canonical invoice number generator and the ONLY place an invoice document may be inserted.
 *
 * Every creation path (POST /api/invoices, the AI assistant, dental "Add to invoice", dermatology "Add to invoice") goes through
 * `createNumberedInvoice`. Nothing else may call `Invoice.create` / `new Invoice(...)` (tests/invoices/invoice-safety-phase3.test.js (A9) scans the
 * source tree and fails if anything does).
 *
 * Guarantees
 *   - clinic-scoped: every clinic has its own sequence;
 *   - atomic: the number comes from ONE `findOneAndUpdate($inc)` on the clinic's InvoiceCounter row, so parallel requests get distinct numbers;
 *   - monotonic and never reused: the counter is a separate document — deleting an invoice (soft OR permanent) does not lower it. The old
 *     "highest existing invoice + 1" rule handed a number out a second time once the highest invoice was permanently deleted;
 *   - never renumbering: an invoice keeps the number it was created with, forever;
 *   - safe bootstrap: a clinic with no counter yet (every clinic that existed before Phase 3) starts ABOVE its highest existing number,
 *     soft-deleted invoices included, so legacy data needs no migration;
 *   - self-healing: if the invoice unique index ({clinicId, invoiceNumber}) ever rejects a number (counter row lost or restored from an old
 *     backup, an old server instance still running during a deploy), the counter is raised to the clinic's real maximum and the number retried.
 */
import type { Types } from "mongoose";
import { Invoice } from "../models/Invoice";
import { InvoiceCounter } from "../models/InvoiceCounter";

type Oid = Types.ObjectId | string;

/** How many times creation may retry after a real number collision / lost bootstrap race before giving up. */
export const INVOICE_NUMBER_ATTEMPTS = 12;

const isDup = (err: any) => err?.code === 11000;
/** True when a duplicate-key error is about the document _id (not the invoice number). Unknown shape = treated as a number collision (retry). */
const isIdCollision = (err: any) => {
  const kp = err?.keyPattern ?? err?.keyValue;
  if (kp && typeof kp === "object") return "_id" in kp && !("invoiceNumber" in kp);
  return /index:\s*_id_|_id_ dup key/.test(String(err?.message ?? ""));
};

const highestExisting = async (clinicId: Oid): Promise<number> => {
  const top = await Invoice.findOne({ clinicId }).sort({ invoiceNumber: -1 }).select("invoiceNumber").lean<{ invoiceNumber?: number } | null>();
  return top?.invoiceNumber ?? 0; // soft-deleted invoices are still rows, so they are counted too
};

/** Hand out the next invoice number of a clinic (atomic). */
export async function allocateInvoiceNumber(clinicId: Oid): Promise<number> {
  for (let i = 0; i < INVOICE_NUMBER_ATTEMPTS; i++) {
    // 1) the normal path — an existing counter: one atomic increment.
    const bumped = await InvoiceCounter.findOneAndUpdate({ clinicId }, { $inc: { seq: 1 } }, { new: true }).lean<{ seq: number } | null>();
    if (bumped) {
      // Belt and braces: the counter must never trail the clinic's real highest number (a counter row lost / restored from an old backup,
      // or invoices imported by hand). If it does, lift it and take the next one — the skipped number is simply never used.
      const top = await highestExisting(clinicId);
      if (bumped.seq > top) return bumped.seq;
      await raiseCounterTo(clinicId, top);
      continue;
    }
    // 2) first use for this clinic: start above whatever it already has. The unique index on clinicId makes the bootstrap race-safe — the
    //    request that loses the insert simply loops back to step 1 and increments the winner's row.
    const first = (await highestExisting(clinicId)) + 1;
    try {
      await InvoiceCounter.create({ clinicId, seq: first });
      return first;
    } catch (err: any) {
      if (!isDup(err)) throw err;
    }
  }
  throw new Error("Could not allocate an invoice number");
}

/** Raise (never lower) a clinic's counter to at least `value` (creating it when the clinic has none yet). */
export async function raiseCounterTo(clinicId: Oid, value: number): Promise<void> {
  const r = await InvoiceCounter.updateOne({ clinicId }, { $max: { seq: value } });
  if (!r.matchedCount) {
    try { await InvoiceCounter.create({ clinicId, seq: value }); } catch (err: any) { if (!isDup(err)) throw err; await InvoiceCounter.updateOne({ clinicId }, { $max: { seq: value } }); }
  }
}

export interface CreateNumberedOptions {
  /**
   * Idempotency hook for callers that choose the invoice _id themselves (dental / dermatology billing): called after a duplicate-key error,
   * return the document if THIS very request already stored it, so it is returned instead of creating a second invoice.
   */
  existing?: () => Promise<any | null>;
}

/**
 * Create an invoice with a freshly allocated number. `fields` is everything except `invoiceNumber` / `clinicId`.
 * Returns the stored document, or null if a number could not be secured (callers answer 409 INVOICE_CREATE_FAILED like before).
 */
export async function createNumberedInvoice(clinicId: Oid, fields: Record<string, any>, opts: CreateNumberedOptions = {}): Promise<any | null> {
  for (let attempt = 0; attempt < INVOICE_NUMBER_ATTEMPTS; attempt++) {
    const invoiceNumber = await allocateInvoiceNumber(clinicId);
    try {
      return await Invoice.create({ ...fields, clinicId, invoiceNumber });
    } catch (err: any) {
      if (!isDup(err)) throw err;
      if (opts.existing) {
        const mine = await opts.existing();
        if (mine) return mine;
      }
      if (isIdCollision(err)) {
        if (!opts.existing) throw err; // a duplicate _id that is not ours cannot be fixed by retrying
        continue;
      }
      await raiseCounterTo(clinicId, await highestExisting(clinicId)); // a real number collision: never hand out that number again
    }
  }
  return null;
}

/**
 * Make sure the clinic's counter already covers `invoiceNumber` BEFORE that invoice is permanently removed. Without this a clinic whose
 * counter has not been created yet (nobody has issued an invoice since Phase 3 shipped) could lose its highest number to a purge and
 * then bootstrap BELOW it — handing the deleted number out a second time.
 */
export async function reserveInvoiceNumber(clinicId: Oid, invoiceNumber: number): Promise<void> {
  await raiseCounterTo(clinicId, Math.max(invoiceNumber, await highestExisting(clinicId)));
}

export interface CounterBootstrapReport { clinics: number; created: number; raised: number; unchanged: number }

/**
 * One-off, idempotent, NON-destructive bootstrap: every clinic that already has invoices gets a counter equal to its highest existing
 * number (soft-deleted included). A counter that already exists is only ever raised, never lowered; no invoice is edited or renumbered.
 * Runs at server start (INVOICE_COUNTER_BOOTSTRAP=off skips it) and as an operator script (dist/scripts/invoiceCounterBootstrap.js).
 */
export async function bootstrapInvoiceCounters(opts: { dryRun?: boolean; clinicId?: string } = {}): Promise<CounterBootstrapReport> {
  const report: CounterBootstrapReport = { clinics: 0, created: 0, raised: 0, unchanged: 0 };
  const ids: any[] = opts.clinicId ? [opts.clinicId] : await Invoice.distinct("clinicId");
  for (const clinicId of ids) {
    const top = await highestExisting(clinicId);
    if (!top) continue;
    report.clinics++;
    const have = await InvoiceCounter.findOne({ clinicId }).select("seq").lean<{ seq: number } | null>();
    if (!have) { report.created++; if (!opts.dryRun) await raiseCounterTo(clinicId, top); }
    else if (have.seq < top) { report.raised++; if (!opts.dryRun) await raiseCounterTo(clinicId, top); }
    else report.unchanged++;
  }
  return report;
}
