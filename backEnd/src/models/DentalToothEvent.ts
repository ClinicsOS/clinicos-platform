import mongoose, { Schema, Document, Types } from "mongoose";
import { DENTITION_TYPES, SURFACES, type DentitionType, type SurfaceId, type EventCategory } from "../config/dental";

/**
 * Append-only clinical history. A row is NEVER edited or deleted through the API.
 * The only permitted transition is active -> resolved (with reason + who + when),
 * so the clinical past always stays traceable. Current tooth state = active events.
 *
 * `code` is deliberately a plain String (validated against config/dental.ts), not a
 * Mongo enum, so the taxonomy can grow without a schema migration.
 */
export interface IDentalToothEvent extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  dentalRecordId: Types.ObjectId;
  fdi: string;
  dentitionType: DentitionType; // dentition of the record when this was written
  category: EventCategory;
  code: string;
  surfaces: SurfaceId[];
  note?: string;
  status: "active" | "resolved";
  taxonomyVersion: number;
  createdBy: Types.ObjectId;
  resolution?: { at: Date; by: Types.ObjectId; reason: "resolved" | "entered_in_error"; note?: string };
  createdAt: Date;
  updatedAt: Date;
}

const eventSchema = new Schema<IDentalToothEvent>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    dentalRecordId: { type: Schema.Types.ObjectId, ref: "DentalRecord", required: true },
    fdi: { type: String, required: true },
    dentitionType: { type: String, enum: DENTITION_TYPES, required: true },
    category: { type: String, enum: ["existing_condition", "diagnosis"], required: true },
    code: { type: String, required: true, trim: true, maxlength: 60 },
    surfaces: { type: [{ type: String, enum: SURFACES }], default: [] },
    note: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: ["active", "resolved"], default: "active", required: true },
    taxonomyVersion: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    resolution: {
      _id: false,
      at: Date,
      by: { type: Schema.Types.ObjectId, ref: "User" },
      reason: { type: String, enum: ["resolved", "entered_in_error"] },
      note: { type: String, trim: true, maxlength: 500 },
    },
  },
  { timestamps: true }
);

// Every query is tenant-scoped (clinicId first) — these serve the chart + tooth history reads.
eventSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
eventSchema.index({ clinicId: 1, patientId: 1, fdi: 1, createdAt: -1 });

export const DentalToothEvent = mongoose.model<IDentalToothEvent>("DentalToothEvent", eventSchema);
