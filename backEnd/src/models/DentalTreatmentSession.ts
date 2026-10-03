import mongoose, { Schema, Document, Types } from "mongoose";
import { TARGET_TYPES, type TargetType } from "../config/dentalProcedures";
import { SURFACES, type SurfaceId } from "../config/dental";

/**
 * Treatment Session = work ACTUALLY performed, linked to an EXISTING ClinicOS visit (Appointment — scheduled,
 * public booking, dashboard or walk-in; there is deliberately no DentalVisit model).
 *
 * procedureCode / targetType / toothNumbers / surfaces are a SNAPSHOT taken when the session starts, so the
 * historical record stays understandable even if the plan item is later changed.
 *
 * Unique indexes make duplicate submits impossible at the database level:
 *   - one session per (item, visit)          -> a double-clicked "Start" cannot create two
 *   - one number per (item, sessionNumber)   -> session numbers never collide
 */
export interface IDentalTreatmentSession extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  itemId: Types.ObjectId;
  appointmentId: Types.ObjectId;
  sessionNumber: number;
  procedureCode: string;
  customName?: string; // snapshot of the item's typed name (procedureCode "other")
  targetType: TargetType;
  toothNumbers: string[];
  surfaces: SurfaceId[];
  status: "in_progress" | "completed";
  autoClosed?: boolean; // closed by the system when the next session started (nobody pressed "finish")
  notes?: string;
  performedBy: Types.ObjectId;
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<IDentalTreatmentSession>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    itemId: { type: Schema.Types.ObjectId, ref: "DentalTreatmentItem", required: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment", required: true },
    sessionNumber: { type: Number, required: true, min: 1 },
    procedureCode: { type: String, required: true },
    customName: { type: String, trim: true, maxlength: 80 },
    targetType: { type: String, enum: TARGET_TYPES, required: true },
    toothNumbers: { type: [String], default: [] },
    surfaces: { type: [{ type: String, enum: SURFACES }], default: [] },
    status: { type: String, enum: ["in_progress", "completed"], default: "in_progress", required: true },
    autoClosed: { type: Boolean },
    notes: { type: String, trim: true, maxlength: 1000 },
    performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date },
  },
  { timestamps: true }
);
sessionSchema.index({ itemId: 1, appointmentId: 1 }, { unique: true });
sessionSchema.index({ itemId: 1, sessionNumber: 1 }, { unique: true });
sessionSchema.index({ clinicId: 1, patientId: 1, appointmentId: 1 });

export const DentalTreatmentSession = mongoose.model<IDentalTreatmentSession>("DentalTreatmentSession", sessionSchema);
