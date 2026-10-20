import mongoose, { Schema, Document, Types } from "mongoose";
import { User } from "./User";

/**
 * DOCTOR DELEGATION (coverage) — "Dr Ahmad covers Dr Mahmoud's patients".
 *
 * This is the GRANT itself (who covers whom, for which patients, for how long, and whether it was revoked). The effective permission
 * lives in PatientDoctorAccess rows (accessType "delegated", one per covered patient), which is what auth/patientAccess.ts reads.
 *
 *   scope "all"       every patient who is (or later becomes) a PRIMARY patient of `fromDoctorId`. New primary patients of the covered
 *                     doctor are added to the coverage automatically while it is active (services/patientAccess.ts).
 *   scope "selected"  exactly `patientIds` (each must be a primary patient of `fromDoctorId` when granted).
 *
 * Ownership is never transferred: the covered doctor keeps his patients. Revoking is immediate (rows are deactivated; the access check
 * reads isActive on every request). A delegation with `expiresAt` simply stops granting access when that instant passes — no job needed.
 */
export const DELEGATION_SCOPES = ["all", "selected"] as const;
export type DelegationScope = (typeof DELEGATION_SCOPES)[number];
export const MAX_SELECTED_PATIENTS = 500;

export interface IDoctorDelegation extends Document {
  clinicId: Types.ObjectId;
  /** The doctor being covered (the patients belong to him). */
  fromDoctorId: Types.ObjectId;
  /** The doctor who covers (gets the access). */
  toDoctorId: Types.ObjectId;
  scope: DelegationScope;
  patientIds: Types.ObjectId[];
  startsAt?: Date;
  expiresAt?: Date;
  note?: string;
  isActive: boolean;
  createdBy: Types.ObjectId;
  revokedAt?: Date;
  revokedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IDoctorDelegation>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    fromDoctorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    toDoctorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    scope: { type: String, enum: DELEGATION_SCOPES, required: true },
    patientIds: { type: [{ type: Schema.Types.ObjectId, ref: "Patient" }], default: [] },
    startsAt: { type: Date },
    expiresAt: { type: Date },
    note: { type: String, trim: true, maxlength: 200 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    revokedAt: { type: Date },
    revokedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

schema.index({ clinicId: 1, createdAt: -1 });
schema.index({ clinicId: 1, toDoctorId: 1, isActive: 1 });
schema.index({ clinicId: 1, fromDoctorId: 1, isActive: 1 });

/** Cross-clinic guard: both doctors must be doctors of THIS clinic, different from each other; "selected" needs patients, "all" none. */
schema.pre("validate", async function () {
  if (this.isNew) {
    const n = await User.countDocuments({ _id: { $in: [this.fromDoctorId, this.toDoctorId] }, clinicId: this.clinicId, role: "doctor" });
    const distinct = String(this.fromDoctorId) !== String(this.toDoctorId);
    if (!distinct) throw new Error("A doctor cannot cover himself");
    if (n !== 2) throw new Error("Both doctors must belong to this clinic");
  }
  if (this.scope === "selected" && (this.patientIds.length === 0 || this.patientIds.length > MAX_SELECTED_PATIENTS)) {
    throw new Error("A selected delegation needs between 1 and " + MAX_SELECTED_PATIENTS + " patients");
  }
  if (this.scope === "all" && this.patientIds.length) throw new Error("An 'all' delegation must not list patients");
  if (this.startsAt && this.expiresAt && this.expiresAt <= this.startsAt) throw new Error("The end of the coverage must be after its start");
});

export const DoctorDelegation = mongoose.model<IDoctorDelegation>("DoctorDelegation", schema);

export type DelegationStatus = "active" | "scheduled" | "expired" | "revoked";

/** The state of a delegation right now (derived — nothing is stored, so it can never go stale). */
export function delegationStatus(d: Pick<IDoctorDelegation, "isActive" | "startsAt" | "expiresAt">, now = new Date()): DelegationStatus {
  if (!d.isActive) return "revoked";
  if (d.expiresAt && d.expiresAt <= now) return "expired";
  if (d.startsAt && d.startsAt > now) return "scheduled";
  return "active";
}
