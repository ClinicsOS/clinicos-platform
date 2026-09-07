import mongoose, { Schema, Document, Types } from "mongoose";

export interface IPatient extends Document {
  clinicId: Types.ObjectId;
  fileNumber: number;
  fullName: string;
  phone: string;
  email?: string;
  gender?: "male" | "female";
  birthDate?: Date;
  medicalNotes?: string;
  isArchived: boolean;
  whatsappOptIn?: boolean; // NEW — WhatsApp appointment reminders opt-in/out
  createdAt: Date;
  updatedAt: Date;
}

const patientSchema = new Schema<IPatient>(
  {
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    fileNumber: { type: Number, required: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    gender: { type: String, enum: ["male", "female"] },
    birthDate: { type: Date },
    medicalNotes: { type: String },
    isArchived: { type: Boolean, default: false },
    // NEW — defaults to true so every existing patient (where this field
    // doesn't exist yet in Mongo) is treated as opted-in without a
    // migration. Only an explicit `false` (set later from a patient-facing
    // toggle) opts someone out.
    whatsappOptIn: { type: Boolean, default: true },
  },
  { timestamps: true }
);

patientSchema.index({ clinicId: 1, phone: 1 }, { unique: true });
patientSchema.index({ clinicId: 1, fileNumber: 1 }, { unique: true });

export const Patient = mongoose.model<IPatient>("Patient", patientSchema);
