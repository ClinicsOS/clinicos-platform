import mongoose, { Schema, Document, Types } from "mongoose";
import { DENTITION_TYPES, type DentitionType } from "../config/dental";

/**
 * One Dental Record per (clinic, patient). It holds only record-level settings; the
 * clinical facts live in the append-only DentalToothEvent collection.
 *
 * `dentitionType` is a DOCTOR's choice (never derived from age). Changing it never
 * touches existing events, so historical primary-tooth entries are preserved; every
 * change is appended to `dentitionLog`.
 */
export interface IDentalRecord extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  dentitionType: DentitionType;
  /** Mixed dentition only: FDI codes currently charted (doctor's choice). undefined => default mixed chart. */
  currentTeeth?: string[];
  dentitionLog: Array<{ from: DentitionType; to: DentitionType; changedAt: Date; changedBy: Types.ObjectId }>;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const dentalRecordSchema = new Schema<IDentalRecord>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    dentitionType: { type: String, enum: DENTITION_TYPES, default: "permanent", required: true },
    currentTeeth: { type: [String], default: undefined },
    dentitionLog: [
      {
        _id: false,
        from: { type: String, enum: DENTITION_TYPES, required: true },
        to: { type: String, enum: DENTITION_TYPES, required: true },
        changedAt: { type: Date, required: true },
        changedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
      },
    ],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Tenant-scoped uniqueness: exactly one record per patient per clinic.
dentalRecordSchema.index({ clinicId: 1, patientId: 1 }, { unique: true });

export const DentalRecord = mongoose.model<IDentalRecord>("DentalRecord", dentalRecordSchema);
