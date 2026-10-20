import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db";
import { PatientDoctorAccess } from "../models/PatientDoctorAccess";
import { DoctorDelegation } from "../models/DoctorDelegation";
import { backfillAllClinics } from "../services/patientAccessBackfill";

/**
 * PHASE 1 — patient ownership BACKFILL (operator tool). See services/patientAccessBackfill.ts for the rules.
 *
 * Usage (from backEnd/, after `npm run build`; needs MONGO_URI like the server):
 *   node dist/scripts/patientAccessBackfill.js --dry-run                  # report only, writes nothing
 *   node dist/scripts/patientAccessBackfill.js                            # all clinics
 *   node dist/scripts/patientAccessBackfill.js --clinic <clinicId>        # one clinic
 *
 * Idempotent and insert-only: it never edits or deletes a patient, appointment, invoice or clinical record, and never touches an
 * existing access row. Output = COUNTS per clinic (no names, no phone numbers).
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
  await Promise.all([PatientDoctorAccess.init(), DoctorDelegation.init()]);
  console.log(`Patient access backfill — ${dryRun ? "DRY RUN (nothing is written)" : "LIVE"} — ${clinicId ? "one clinic" : "all clinics"}`);
  const s = await backfillAllClinics({ dryRun, clinicId });
  for (const r of s.reports) {
    console.log(
      `clinic ${r.clinicId}: patients ${r.patients}, doctors ${r.doctors}, already linked ${r.alreadyLinked}, ` +
        `+${r.fromAppointments} appointments, +${r.fromInvoices} invoices, +${r.fromClinicalRecords} clinical, +${r.fromSoleDoctor} sole-doctor ` +
        `=> ${dryRun ? "would create" : "created"} ${r.created}; unassigned ${r.unassigned}`
    );
  }
  console.log(`TOTAL: ${s.clinics} clinic(s), ${dryRun ? "would create" : "created"} ${s.created} link(s), ${s.unassigned} patient(s) left unassigned (owner / front desk only).`);
  if (s.failed.length) console.log(`FAILED clinics: ${s.failed.join(", ")}`);
  await mongoose.disconnect();
  process.exit(s.failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error("Backfill failed:", e instanceof Error ? e.message : e);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
