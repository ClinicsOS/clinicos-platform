import { Types } from "mongoose";
import { Clinic } from "../models/Clinic";
import { User } from "../models/User";
import { Patient } from "../models/Patient";
import { Appointment } from "../models/Appointment";
import { Invoice } from "../models/Invoice";
import { ClinicalNote } from "../models/ClinicalNote";
import { DentalTreatmentItem } from "../models/DentalTreatmentItem";
import { DentalToothEvent } from "../models/DentalToothEvent";
import { DermTreatmentItem } from "../models/DermTreatmentItem";
import { DermAssessment } from "../models/DermAssessment";
import { PatientDoctorAccess, PRIMARY_GRANT_KEY, type AccessSource } from "../models/PatientDoctorAccess";

/**
 * PHASE 1 — BACKFILL of patient ownership for data that existed BEFORE patients were doctor-scoped.
 *
 * Until now every patient was shared by the whole clinic, so nothing in the database says "this patient is Dr X's". This module
 * derives it ONLY from facts that already prove a treating relationship — it never guesses, and it never deletes or edits any
 * patient / appointment / invoice / clinical record. It only INSERTS PatientDoctorAccess rows (accessType "primary").
 *
 *   Rule A  an Appointment (not a blocked slot) between the patient and the doctor                      -> source backfill_appointment
 *   Rule B  an Invoice whose treating doctor (Phase 4 attribution) is the doctor                         -> source backfill_invoice
 *   Rule C  clinical work authored by a doctor-role user: clinical notes (author / visit doctor), dental + derm treatment items,
 *           derm assessments, dental tooth events                                                         -> source backfill_clinical
 *   Rule D  a clinic that has had exactly ONE doctor-role user (ever) -> every patient with no link yet belongs to that doctor
 *           (nobody else could have treated them)                                                         -> source backfill_sole_doctor
 *   anything else           -> the patient stays UNASSIGNED: the owner and the front desk see him, doctors do not, until the owner
 *                              assigns a doctor or an appointment is booked. (Reported as `unassigned`, never assigned at random.)
 *
 * Safety properties (all covered by tests/patient-access):
 *   · idempotent — a (clinic, patient, doctor, primary) row that already exists, ACTIVE OR NOT, is never touched, so re-running never
 *     resurrects access the owner switched off;
 *   · tenant-safe — a pair is written only when the patient AND the doctor both belong to the clinic being processed;
 *   · dry-run — computes and reports everything, writes nothing;
 *   · reports COUNTS only (no names, phones or clinical content).
 * It runs once per server start (idempotent, cheap) unless PATIENT_ACCESS_BACKFILL=off, and can be run by an operator:
 *   node dist/scripts/patientAccessBackfill.js [--dry-run] [--clinic <clinicId>]
 */

export interface BackfillReport {
  clinicId: string;
  dryRun: boolean;
  patients: number;
  doctors: number;
  alreadyLinked: number;
  fromAppointments: number;
  fromInvoices: number;
  fromClinicalRecords: number;
  fromSoleDoctor: number;
  created: number;
  /** patients that still have no doctor after the backfill (owner / front desk only) */
  unassigned: number;
}

type PairSource = { rule: AccessSource; read: (clinicOid: Types.ObjectId) => Promise<[string, string][]> };

async function pairsOf(model: { aggregate: (p: any[]) => Promise<any[]> }, clinicOid: Types.ObjectId, match: Record<string, unknown>, patientField: string, doctorField: string): Promise<[string, string][]> {
  const rows = await model.aggregate([
    { $match: { clinicId: clinicOid, ...match } },
    { $group: { _id: { p: `$${patientField}`, d: `$${doctorField}` } } },
  ]);
  return rows.filter((r) => r._id?.p && r._id?.d).map((r) => [String(r._id.p), String(r._id.d)] as [string, string]);
}

const SOURCES: PairSource[] = [
  { rule: "backfill_appointment", read: (c) => pairsOf(Appointment, c, { type: { $ne: "blocked" }, patientId: { $ne: null }, doctorId: { $ne: null } }, "patientId", "doctorId") },
  { rule: "backfill_invoice", read: (c) => pairsOf(Invoice, c, { doctorId: { $ne: null } }, "patientId", "doctorId") },
  {
    rule: "backfill_clinical",
    read: async (c) =>
      (
        await Promise.all([
          pairsOf(ClinicalNote, c, { authorId: { $ne: null } }, "patientId", "authorId"),
          pairsOf(ClinicalNote, c, { doctorId: { $ne: null } }, "patientId", "doctorId"),
          pairsOf(DentalTreatmentItem, c, {}, "patientId", "createdBy"),
          pairsOf(DentalToothEvent, c, {}, "patientId", "createdBy"),
          pairsOf(DermTreatmentItem, c, {}, "patientId", "createdBy"),
          pairsOf(DermAssessment, c, {}, "patientId", "createdBy"),
        ])
      ).flat(),
  },
];

const FIELD: Record<string, keyof BackfillReport> = {
  backfill_appointment: "fromAppointments",
  backfill_invoice: "fromInvoices",
  backfill_clinical: "fromClinicalRecords",
  backfill_sole_doctor: "fromSoleDoctor",
};

export async function backfillClinic(clinicId: string, opts: { dryRun?: boolean } = {}): Promise<BackfillReport> {
  const dryRun = !!opts.dryRun;
  const clinicOid = new Types.ObjectId(clinicId);

  const [doctorRows, patientRows, existing] = await Promise.all([
    User.find({ clinicId: clinicOid, role: "doctor" }).select("_id").lean() as Promise<{ _id: Types.ObjectId }[]>,
    Patient.find({ clinicId: clinicOid }).select("_id").lean() as Promise<{ _id: Types.ObjectId }[]>,
    // every primary row that exists, active or not: those are never touched (a switched-off row is the owner's decision)
    PatientDoctorAccess.find({ clinicId: clinicOid, accessType: "primary" }).select("patientId doctorId").lean() as Promise<{ patientId: Types.ObjectId; doctorId: Types.ObjectId }[]>,
  ]);
  const doctors = new Set(doctorRows.map((d) => String(d._id)));
  const patients = new Set(patientRows.map((p) => String(p._id)));
  const linked = new Set(existing.map((r) => `${r.patientId}|${r.doctorId}`));
  const hasPrimary = new Set(existing.map((r) => String(r.patientId)));

  const report: BackfillReport = {
    clinicId, dryRun, patients: patients.size, doctors: doctors.size, alreadyLinked: linked.size,
    fromAppointments: 0, fromInvoices: 0, fromClinicalRecords: 0, fromSoleDoctor: 0, created: 0, unassigned: 0,
  };

  const toWrite: { patientId: string; doctorId: string; rule: AccessSource }[] = [];
  const add = (p: string, d: string, rule: AccessSource) => {
    if (!patients.has(p) || !doctors.has(d)) return; // tenant-safe: both must belong to THIS clinic
    const k = `${p}|${d}`;
    if (linked.has(k)) return;
    linked.add(k);
    hasPrimary.add(p);
    toWrite.push({ patientId: p, doctorId: d, rule });
    (report[FIELD[rule]] as number) += 1;
  };

  for (const src of SOURCES) for (const [p, d] of await src.read(clinicOid)) add(p, d, src.rule);

  // Rule D — a clinic with exactly one doctor-role user ever: whoever has no link yet is that doctor's.
  if (doctors.size === 1) {
    const only = Array.from(doctors)[0];
    for (const p of patients) if (!hasPrimary.has(p)) add(p, only, "backfill_sole_doctor");
  }

  report.unassigned = Array.from(patients).filter((p) => !hasPrimary.has(p)).length;
  report.created = toWrite.length;
  if (dryRun || !toWrite.length) return report;

  for (let i = 0; i < toWrite.length; i += 500) {
    await PatientDoctorAccess.bulkWrite(
      toWrite.slice(i, i + 500).map((w) => ({
        updateOne: {
          filter: { clinicId: clinicOid, patientId: new Types.ObjectId(w.patientId), doctorId: new Types.ObjectId(w.doctorId), grantKey: PRIMARY_GRANT_KEY },
          update: { $setOnInsert: { accessType: "primary", source: w.rule, isActive: true } },
          upsert: true,
        },
      })),
      { ordered: false }
    );
  }
  return report;
}

export interface BackfillSummary {
  clinics: number;
  created: number;
  unassigned: number;
  reports: BackfillReport[];
}

/** All clinics (or one). A failure in one clinic is reported and does not stop the others. */
export async function backfillAllClinics(opts: { dryRun?: boolean; clinicId?: string } = {}): Promise<BackfillSummary & { failed: string[] }> {
  const ids = opts.clinicId ? [opts.clinicId] : ((await Clinic.find({}).select("_id").lean()) as { _id: Types.ObjectId }[]).map((c) => String(c._id));
  const reports: BackfillReport[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    try {
      reports.push(await backfillClinic(id, { dryRun: opts.dryRun }));
    } catch (e) {
      failed.push(id);
      console.error("[patient-access] backfill failed for clinic", id, e instanceof Error ? e.message : e);
    }
  }
  return { clinics: ids.length, created: reports.reduce((n, r) => n + r.created, 0), unassigned: reports.reduce((n, r) => n + r.unassigned, 0), reports, failed };
}
