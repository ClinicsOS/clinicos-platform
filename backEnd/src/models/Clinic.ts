import mongoose, { Schema, Document } from "mongoose";
import type { Plan } from "../config/plans";

export interface IClinic extends Document {
  name: string;
  slug: string;
  specialty: string;
  phone?: string;
  address?: string;
  logoUrl?: string;
  brandColor?: string;                 // Pro feature — customise booking page colour
  workingHours: {
    day: number;
    isOpen: boolean;
    from: string;
    to: string;
  }[];
  slotDuration: number;

  // ===== Subscription =====
  plan: Plan;
  planStartedAt: Date;
  planExpiresAt: Date;
  status: "active" | "suspended" | "expired";

  createdAt: Date;
  updatedAt: Date;
}

const clinicSchema = new Schema<IClinic>(
  {
    name: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]{3,50}$/,
    },
    specialty: { type: String, required: true },
    phone: { type: String },
    address: { type: String },
    logoUrl: { type: String },
    brandColor: { type: String },
    workingHours: [
      {
        day: { type: Number, required: true, min: 0, max: 6 },
        isOpen: { type: Boolean, default: true },
        from: { type: String, default: "10:00" },
        to: { type: String, default: "18:00" },
      },
    ],
    slotDuration: { type: Number, default: 30 },

    plan: { type: String, enum: ["trial", "basic", "pro"], default: "trial" },
    planStartedAt: { type: Date, default: Date.now },
    planExpiresAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "suspended", "expired"],
      default: "active",
    },
  },
  { timestamps: true }
);

export const Clinic = mongoose.model<IClinic>("Clinic", clinicSchema);
