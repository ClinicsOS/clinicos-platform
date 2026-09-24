import mongoose, { Schema, Document, Types } from "mongoose";
import {
  MEDICAL_KEYS,
  BLOOD_TYPES,
  MARITAL_STATUSES,
  REFERRAL_SOURCES,
  type MedicalHistory,
} from "../config/medicalHistory";

export interface IPatient extends Document {
  clinicId: Types.ObjectId;
  fileNumber: number;
  fullName: string;
  phone: string;
  email?: string;
  gender?: "male" | "female";
  birthDate?: Date;
  medicalNotes?: string; // kept as the "general notes" field — the mobile app already reads it
  isArchived: boolean;
  whatsappOptIn?: boolean; // WhatsApp appointment reminders opt-in/out

  // ===== NEW — extended personal details =====
  nationalId?: string;
  address?: string;
  occupation?: string;
  maritalStatus?: (typeof MARITAL_STATUSES)[number];
  bloodType?: (typeof BLOOD_TYPES)[number];
  referralSource?: (typeof REFERRAL_SOURCES)[number];
  emergencyContact?: { name?: string; relation?: string; phone?: string };
  insurance?: { provider?: string; policyNumber?: string };

  // ===== NEW — structured medical history (checkbox + details per question) =====
  medicalHistory?: MedicalHistory;
  medicalUpdatedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

// One { has, details } pair per medical question. _id: false keeps the
// stored document small and clean.
const medicalFlagSchema = new Schema(
  {
    has: { type: Boolean, default: false },
    details: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

// Built from the shared MEDICAL_KEYS list so the schema and the Zod
// validation in the controller can never drift apart.
const medicalHistorySchema = new Schema(
  Object.fromEntries(MEDICAL_KEYS.map((k) => [k, { type: medicalFlagSchema }])),
  { _id: false }
);

const emergencyContactSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 100 },
    relation: { type: String, trim: true, maxlength: 50 },
    phone: { type: String, trim: true, maxlength: 20 },
  },
  { _id: false }
);

const insuranceSchema = new Schema(
  {
    provider: { type: String, trim: true, maxlength: 100 },
    policyNumber: { type: String, trim: true, maxlength: 60 },
  },
  { _id: false }
);

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
    // Defaults to true so every existing patient (where this field
    // doesn't exist yet in Mongo) is treated as opted-in without a
    // migration. Only an explicit `false` opts someone out.
    whatsappOptIn: { type: Boolean, default: true },

    // ===== NEW fields — all optional, so every existing patient document
    // stays valid with zero migration. =====
    nationalId: { type: String, trim: true, maxlength: 30 },
    address: { type: String, trim: true, maxlength: 200 },
    occupation: { type: String, trim: true, maxlength: 100 },
    maritalStatus: { type: String, enum: MARITAL_STATUSES },
    bloodType: { type: String, enum: BLOOD_TYPES },
    referralSource: { type: String, enum: REFERRAL_SOURCES },
    emergencyContact: { type: emergencyContactSchema },
    insurance: { type: insuranceSchema },
    medicalHistory: { type: medicalHistorySchema },
    medicalUpdatedAt: { type: Date },
  },
  { timestamps: true }
);

patientSchema.index({ clinicId: 1, phone: 1 }, { unique: true });
patientSchema.index({ clinicId: 1, fileNumber: 1 }, { unique: true });

export const Patient = mongoose.model<IPatient>("Patient", patientSchema);
