import mongoose, { Schema, Document, Types } from "mongoose";
import { CHECKIN, type CheckInStatus, type CheckInVia } from "../config/loyalty";

/**
 * A patient's "I'm here" request at one clinic (Phase 5). Created by the PUBLIC Loyalty page after the patient
 * identified themselves, confirmed (or rejected) by clinic staff at the desk.
 *
 * A check-in NEVER changes a balance and never writes the ledger. It is a plain workflow record:
 *   pending ──► confirmed | rejected   (reception)
 *   pending ──► cancelled              (the patient)
 *   pending ──► expired                (nobody answered in time)
 * Every transition is ONE conditional update (`status: "pending"` is part of the filter), so two receptionists —
 * or a receptionist and the patient — can never both "win".
 *
 * `activeKey` enforces "at most one pending request per member" at the database level. It is set ONLY while the
 * request is pending and `$unset` on every transition. It is a SINGLE-field sparse unique index on purpose:
 * a compound sparse unique index would index every row (every row has a clinicId) and collide on the missing key —
 * the exact mistake the ledger hotfix repaired.
 */
export interface ILoyaltyCheckIn extends Document {
  clinicId: Types.ObjectId;
  accountId: Types.ObjectId;
  patientId: Types.ObjectId;

  status: CheckInStatus;
  via: CheckInVia;
  requestedAt: Date;
  expiresAt: Date;

  activeKey?: string;

  resolvedAt?: Date | null;
  resolvedBy?: Types.ObjectId | null; // clinic user who confirmed / rejected (null for patient-cancel / expiry)
  /** Optional informational link to the patient's appointment (validated: same clinic, same patient, near in time). */
  appointmentId?: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

const loyaltyCheckInSchema = new Schema<ILoyaltyCheckIn>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "LoyaltyAccount", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },

    status: { type: String, enum: CHECKIN.statuses, default: "pending" },
    via: { type: String, enum: CHECKIN.vias, default: "link" },
    requestedAt: { type: Date, required: true, default: Date.now },
    expiresAt: { type: Date, required: true },

    activeKey: { type: String },

    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment", default: null },
  },
  { timestamps: true }
);

// At most ONE pending request per member (single-field sparse unique — see the note above).
loyaltyCheckInSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
// Reception queue / history (per clinic, by status, oldest or newest first).
loyaltyCheckInSchema.index({ clinicId: 1, status: 1, requestedAt: -1 });
// A member's recent requests (status polling, daily cap, dedupe).
loyaltyCheckInSchema.index({ accountId: 1, requestedAt: -1 });

export const LoyaltyCheckIn = mongoose.model<ILoyaltyCheckIn>("LoyaltyCheckIn", loyaltyCheckInSchema);
