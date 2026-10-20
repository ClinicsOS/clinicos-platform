import mongoose, { Schema, Document, Types } from "mongoose";
import { Patient } from "./Patient";
import { User } from "./User";

/**
 * PATIENT <-> DOCTOR ACCESS (Phase 1 — multi-doctor patient isolation).
 *
 * One row = "this doctor may open this patient's file". A patient is NOT owned by one doctor: patients can interact with several
 * clinicians, so ownership is a set of rows, never a single `patient.doctorId`.
 *
 *   accessType "primary"    the doctor treats / registered / was booked with the patient. Created by the server when a doctor
 *                           registers a patient, when an appointment is booked with the doctor, when the owner assigns the patient
 *                           — or by the one-off, deterministic backfill of pre-existing data (services/patientAccessBackfill.ts).
 *   accessType "delegated"  temporary COVERAGE granted by the clinic owner (see DoctorDelegation). It never transfers ownership: the
 *                           covered doctor keeps his primary row. It can be revoked at any time and can expire.
 *
 * The decision "may this user open this patient" is made in ONE place: auth/patientAccess.ts (canAccessPatient). Nothing else reads
 * this collection to authorise anything.
 *
 * Isolation between clinics is part of the model, not just of the callers: a row can only be CREATED when the patient and the doctor
 * both belong to `clinicId` (see the validator below; services/patientAccess.ts checks the same before its bulk writes).
 */
export const ACCESS_TYPES = ["primary", "delegated"] as const;
export type AccessType = (typeof ACCESS_TYPES)[number];

/** Why a row exists (audit / support only — never used to authorise). */
export const ACCESS_SOURCES = [
  "created", // a doctor registered the patient
  "appointment", // an appointment was booked with the doctor (dashboard, walk-in, public booking, AI assistant, reassignment)
  "sole_doctor", // the clinic has exactly one doctor, so every patient of the clinic is that doctor's
  "assigned", // the owner assigned the patient to the doctor
  "delegation", // coverage granted by a DoctorDelegation
  "backfill_appointment",
  "backfill_invoice",
  "backfill_clinical",
  "backfill_sole_doctor",
] as const;
export type AccessSource = (typeof ACCESS_SOURCES)[number];

export const PRIMARY_GRANT_KEY = "primary";
export const delegationGrantKey = (delegationId: unknown) => `d:${String(delegationId)}`;

export interface IPatientDoctorAccess extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  doctorId: Types.ObjectId;
  accessType: AccessType;
  /** "primary" for a primary row, "d:<delegationId>" for coverage — makes (clinic, patient, doctor, grant) unique without a partial index. */
  grantKey: string;
  source: AccessSource;
  /** delegated only: the DoctorDelegation this row belongs to, who granted it, and which doctor is being covered. */
  delegationId?: Types.ObjectId;
  delegatedBy?: Types.ObjectId;
  coveringDoctorId?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  isActive: boolean;
  /** Optional validity window (delegated rows). Absent = from now / until revoked. Evaluated at READ time, so expiry needs no job. */
  startsAt?: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  revokedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IPatientDoctorAccess>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    accessType: { type: String, enum: ACCESS_TYPES, required: true },
    grantKey: { type: String, required: true, maxlength: 60 },
    source: { type: String, enum: ACCESS_SOURCES, required: true },
    delegationId: { type: Schema.Types.ObjectId, ref: "DoctorDelegation" },
    delegatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    coveringDoctorId: { type: Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    isActive: { type: Boolean, default: true },
    startsAt: { type: Date },
    expiresAt: { type: Date },
    revokedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

// One row per (clinic, patient, doctor, grant): a doctor has at most ONE primary row per patient and at most one row per delegation.
schema.index({ clinicId: 1, patientId: 1, doctorId: 1, grantKey: 1 }, { unique: true });
// "Which patients may this doctor open?" — the doctor's patient list / search / dashboards.
schema.index({ clinicId: 1, doctorId: 1, isActive: 1, accessType: 1 });
// "Who may open this patient?" — the owner's view, the list badges.
schema.index({ clinicId: 1, patientId: 1, isActive: 1 });
// Revoking / listing one delegation.
schema.index({ delegationId: 1 });

/**
 * Cross-clinic guard (defence in depth; the service layer also checks before its bulk writes): a NEW row is rejected unless the
 * patient and the doctor both belong to the row's clinic, and a delegated row carries its delegation + a different covered doctor.
 */
schema.pre("validate", async function () {
  if (!this.isNew) return;
  const [patient, doctor] = await Promise.all([
    Patient.exists({ _id: this.patientId, clinicId: this.clinicId }),
    User.exists({ _id: this.doctorId, clinicId: this.clinicId, role: "doctor" }),
  ]);
  if (!patient) throw new Error("Patient does not belong to this clinic");
  if (!doctor) throw new Error("Doctor does not belong to this clinic");
  if (this.accessType === "primary") {
    if (this.grantKey !== PRIMARY_GRANT_KEY) throw new Error("A primary row must use the primary grant key");
    return;
  }
  if (!this.delegationId || !this.delegatedBy || !this.coveringDoctorId) throw new Error("A delegated row needs its delegation, grantor and covered doctor");
  if (String(this.coveringDoctorId) === String(this.doctorId)) throw new Error("A doctor cannot cover himself");
  if (this.grantKey !== delegationGrantKey(this.delegationId)) throw new Error("Invalid grant key");
  const covered = await User.exists({ _id: this.coveringDoctorId, clinicId: this.clinicId, role: "doctor" });
  if (!covered) throw new Error("Covered doctor does not belong to this clinic");
});

export const PatientDoctorAccess = mongoose.model<IPatientDoctorAccess>("PatientDoctorAccess", schema);
