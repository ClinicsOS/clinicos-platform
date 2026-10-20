import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { Invoice } from "../models/Invoice";
import { InvoiceCounter } from "../models/InvoiceCounter";
import { bootstrapInvoiceCounters } from "../services/invoiceNumbering";

/**
 * PHASE 3 — invoice number COUNTER bootstrap (operator tool). See services/invoiceNumbering.ts.
 *
 * Usage (from backEnd/, after `npm run build`; needs MONGO_URI like the server):
 *   node dist/scripts/invoiceCounterBootstrap.js --dry-run               # report only, writes nothing
 *   node dist/scripts/invoiceCounterBootstrap.js                         # all clinics
 *   node dist/scripts/invoiceCounterBootstrap.js --clinic <clinicId>     # one clinic
 *
 * Idempotent: a counter is created at the clinic's highest existing invoice number (soft-deleted included) or raised to it; it is NEVER lowered, and
 * no invoice is edited, deleted or renumbered. The server runs the same step at start-up, so this is only needed to inspect or force it.
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const clinicId = arg("clinic");
  if (clinicId && !/^[a-f0-9]{24}$/i.test(clinicId)) throw new Error("--clinic must be a 24-character clinic id");
  await connectDB();
  await Promise.all([InvoiceCounter.init(), Invoice.init()]);
  console.log(`Invoice counter bootstrap — ${dryRun ? "DRY RUN (nothing is written)" : "LIVE"} — ${clinicId ? "one clinic" : "all clinics"}`);
  const r = await bootstrapInvoiceCounters({ dryRun, clinicId });
  console.log(`${r.clinics} clinic(s) with invoices: ${dryRun ? "would create" : "created"} ${r.created} counter(s), ${dryRun ? "would raise" : "raised"} ${r.raised}, ${r.unchanged} already correct.`);
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error("Bootstrap failed:", e instanceof Error ? e.message : e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
