import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * One treatment plan per (clinic, patient). It only holds plan-level organisation (phase names);
 * the treatment items are separate documents (DentalTreatmentItem) that reference this plan.
 */
export interface IDentalTreatmentPlan extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  phases: { number: number; name?: string }[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const planSchema = new Schema<IDentalTreatmentPlan>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    phases: [{ _id: false, number: { type: Number, required: true, min: 1, max: 20 }, name: { type: String, trim: true, maxlength: 60 } }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);
planSchema.index({ clinicId: 1, patientId: 1 }, { unique: true });

export const DentalTreatmentPlan = mongoose.model<IDentalTreatmentPlan>("DentalTreatmentPlan", planSchema);
