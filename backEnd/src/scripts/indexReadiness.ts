import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { PatientDoctorAccess } from "../models/PatientDoctorAccess";
import { DoctorDelegation } from "../models/DoctorDelegation";
import { Invoice } from "../models/Invoice";
import { InvoiceCounter } from "../models/InvoiceCounter";
import { bootstrapInvoiceCounters } from "../services/invoiceNumbering";
import { DentalTreatmentItem } from "../models/DentalTreatmentItem";
import { DentalTreatmentSession } from "../models/DentalTreatmentSession";
import { DentalTreatmentPlan } from "../models/DentalTreatmentPlan";
import { DentalRecord } from "../models/DentalRecord";
import { DentalToothEvent } from "../models/DentalToothEvent";
import { ClinicalNote } from "../models/ClinicalNote";

/**
 * PHASE 6 — production INDEX READINESS check (operator tool). READ-ONLY by default.
 *
 * Covers the collections introduced or changed by Phases 1–5:
 *   Phase 1  PatientDoctorAccess (unique grantKey row per patient/doctor/grant), DoctorDelegation
 *   Phase 2  Invoice (soft delete: deletedAt index; unique {clinicId, invoiceNumber})
 *   Phase 3  InvoiceCounter (unique per clinic), invoice-number monotonic counter
 *   Phase 4  DentalTreatmentItem partial-unique {clinicId, patientId, activeTwinKey} and {clinicId, patientId, clientRequestId}
 *   Phase 5  no new index (the new `toothSurfaces` field is read/written by the existing records; nothing to build)
 *
 * Usage (from backEnd/, after `npm run build`; MONGO_URI is read from the environment exactly like the server — this script NEVER guesses a database):
 *   node dist/scripts/indexReadiness.js                          # REPORT ONLY: missing indexes, duplicate keys that would make a unique index fail, counter vs max invoice number
 *   node dist/scripts/indexReadiness.js --create --confirm-db <databaseName>
 *                                                                # ALSO builds the MISSING indexes (createIndexes). Refused unless the database name you
 *                                                                # type equals the one MONGO_URI points to, and refused when a duplicate preflight failed.
 *
 * Safety: it never drops an index, never edits/deletes a document, prints COUNTS only (no names / phones / ids of patients), and prints the database
 * NAME only (never the connection string / credentials). Exit code 0 = ready, 2 = something needs the operator's attention, 1 = the tool itself failed.
 */
type Fix = "REQUIRED BEFORE DEPLOY" | "SAFE DURING DEPLOY" | "OPTIONAL";
const MODELS: { name: string; model: mongoose.Model<any>; phase: string; fix: Fix }[] = [
  { name: "PatientDoctorAccess", model: PatientDoctorAccess, phase: "1", fix: "REQUIRED BEFORE DEPLOY" },
  { name: "DoctorDelegation", model: DoctorDelegation, phase: "1", fix: "SAFE DURING DEPLOY" },
  { name: "Invoice", model: Invoice, phase: "2/3", fix: "REQUIRED BEFORE DEPLOY" },
  { name: "InvoiceCounter", model: InvoiceCounter, phase: "3", fix: "REQUIRED BEFORE DEPLOY" },
  { name: "DentalTreatmentItem", model: DentalTreatmentItem, phase: "4", fix: "REQUIRED BEFORE DEPLOY" },
  { name: "DentalTreatmentSession", model: DentalTreatmentSession, phase: "3", fix: "SAFE DURING DEPLOY" },
  { name: "DentalTreatmentPlan", model: DentalTreatmentPlan, phase: "3", fix: "SAFE DURING DEPLOY" },
  { name: "DentalRecord", model: DentalRecord, phase: "2-5", fix: "SAFE DURING DEPLOY" },
  { name: "DentalToothEvent", model: DentalToothEvent, phase: "2-5", fix: "OPTIONAL" },
  { name: "ClinicalNote", model: ClinicalNote, phase: "3/4", fix: "SAFE DURING DEPLOY" },
];

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/** Duplicate groups that would make the corresponding UNIQUE index fail to build (counts only). */
async function duplicateGroups(coll: mongoose.Collection, key: Record<string, string>, match: Record<string, unknown> = {}): Promise<number> {
  const rows = await coll
    .aggregate([{ $match: match }, { $group: { _id: key, n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: "groups" }])
    .toArray();
  return rows[0]?.groups ?? 0;
}

async function main() {
  const create = process.argv.includes("--create");
  const confirm = arg("confirm-db");
  // READ-ONLY means read-only: Mongoose would otherwise build every declared index (and create empty collections) the moment the models connect
  // (its default autoIndex/autoCreate). Switched off here, before the connection opens; --create builds explicitly, below.
  mongoose.set("autoIndex", false);
  mongoose.set("autoCreate", false);
  await connectDB();
  const dbName = mongoose.connection.name;
  console.log(`Index readiness — ${create ? "WILL CREATE MISSING INDEXES (never drops)" : "REPORT ONLY (nothing is written)"} — database "${dbName}"`);
  if (create && confirm !== dbName) throw new Error(`--create needs --confirm-db ${dbName} (type the database name this run points to)`);

  let attention = 0;
  const missingByModel = new Map<string, number>();
  console.log("\n== 1. Indexes declared by the code vs. indexes that exist ==");
  for (const m of MODELS) {
    let toCreate: any[] = [];
    let toDrop: string[] = [];
    try {
      const d = await (m.model as any).diffIndexes();
      toCreate = d.toCreate ?? [];
      toDrop = d.toDrop ?? [];
    } catch (e: any) {
      if (e?.codeName !== "NamespaceNotFound" && !/ns does not exist|not found/i.test(String(e?.message))) throw e;
      toCreate = (m.model.schema.indexes() as any[]).map(([spec]) => spec); // collection does not exist yet: every declared index is "missing"
    }
    missingByModel.set(m.name, toCreate.length);
    if (toCreate.length) attention++;
    console.log(`  ${m.name.padEnd(24)} phase ${m.phase.padEnd(4)} [${m.fix}]  missing: ${toCreate.length}${toCreate.length ? "  -> " + toCreate.map((s) => JSON.stringify(s)).join(" ") : ""}${toDrop.length ? `   (info: ${toDrop.length} extra index(es) not declared by the code — NOT touched)` : ""}`);
  }

  console.log("\n== 2. Duplicate preflight (a duplicate makes the unique index build FAIL; counts of duplicate GROUPS) ==");
  const db = mongoose.connection;
  const preflight: { label: string; run: () => Promise<number> }[] = [
    { label: "Invoice {clinicId, invoiceNumber}", run: () => duplicateGroups(Invoice.collection, { c: "$clinicId", n: "$invoiceNumber" }) },
    { label: "InvoiceCounter {clinicId}", run: () => duplicateGroups(InvoiceCounter.collection, { c: "$clinicId" }) },
    { label: "PatientDoctorAccess {clinicId, patientId, doctorId, grantKey}", run: () => duplicateGroups(PatientDoctorAccess.collection, { c: "$clinicId", p: "$patientId", d: "$doctorId", g: "$grantKey" }) },
    { label: "DentalTreatmentItem activeTwinKey (docs that carry one)", run: () => duplicateGroups(DentalTreatmentItem.collection, { c: "$clinicId", p: "$patientId", k: "$activeTwinKey" }, { activeTwinKey: { $type: "string" } }) },
    { label: "DentalTreatmentItem clientRequestId (docs that carry one)", run: () => duplicateGroups(DentalTreatmentItem.collection, { c: "$clinicId", p: "$patientId", k: "$clientRequestId" }, { clientRequestId: { $type: "string" } }) },
  ];
  let dupFailed = 0;
  for (const p of preflight) {
    const n = await p.run();
    if (n) { dupFailed++; attention++; }
    console.log(`  ${n === 0 ? "OK  " : "FAIL"} ${p.label}: ${n} duplicate group(s)`);
  }

  console.log("\n== 3. Invoice counter vs. highest existing invoice number (soft-deleted included) ==");
  // The highest number is read ONLY in the canonical service (tests/invoices A9f guards this): its dry-run says what it WOULD do, writing nothing.
  const r = await bootstrapInvoiceCounters({ dryRun: true });
  const behind = r.raised, noCounter = r.created;
  console.log(`  clinics with invoices: ${r.clinics}; without a counter yet: ${noCounter}; counter BEHIND the highest number: ${behind}`);
  if (behind) { attention++; console.log("  ACTION: run `node dist/scripts/invoiceCounterBootstrap.js --dry-run`, then without --dry-run (idempotent, only raises)."); }
  if (noCounter) console.log("  info: a clinic without a counter is bootstrapped automatically (server start, or lazily on its next invoice) ABOVE its highest number — safe.");

  if (create) {
    if (dupFailed) throw new Error("Refusing to build indexes: a duplicate preflight failed (see section 2). Resolve the duplicates first — this tool never deletes data.");
    console.log("\n== 4. Building the missing indexes (createIndexes only — nothing is dropped) ==");
    for (const m of MODELS) {
      if (!missingByModel.get(m.name)) continue;
      await m.model.createIndexes();
      console.log(`  built: ${m.name}`);
    }
  }
  console.log(`\nRESULT: ${attention ? "ATTENTION NEEDED (" + attention + " item(s) above)" : "READY — every declared index exists, no duplicates, counters are consistent"}`);
  await db.close();
  process.exit(attention && !create ? 2 : 0);
}

main().catch(async (e) => {
  console.error("Index readiness failed:", e instanceof Error ? e.message : e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
