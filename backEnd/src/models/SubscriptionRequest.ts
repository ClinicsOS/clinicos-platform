import mongoose, { Schema, Document, Types } from "mongoose";
import type { Plan } from "../config/plans";

/**
 * When a clinic owner picks a plan they want to upgrade to,
 * we record it here. In production this would trigger payment,
 * but for the MVP we mark it "pending" and the platform admin
 * approves it manually — which activates the plan on the clinic.
 */
export interface ISubscriptionRequest extends Document {
  clinicId: Types.ObjectId;
  requestedPlan: Plan;
  billingName: string;
  billingEmail: string;
  billingPhone: string;
  paymentMethod: "cliq" | "bank_transfer" | "cash";
  paymentRef?: string;              // CliQ ref / transfer ref if provided
  notes?: string;
  status: "pending" | "approved" | "rejected";
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ISubscriptionRequest>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    requestedPlan: { type: String, enum: ["trial", "basic", "pro"], required: true },
    billingName: { type: String, required: true },
    billingEmail: { type: String, required: true, lowercase: true },
    billingPhone: { type: String, required: true },
    paymentMethod: { type: String, enum: ["cliq", "bank_transfer", "cash"], required: true },
    paymentRef: { type: String },
    notes: { type: String },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

export const SubscriptionRequest = mongoose.model<ISubscriptionRequest>(
  "SubscriptionRequest",
  schema
);
