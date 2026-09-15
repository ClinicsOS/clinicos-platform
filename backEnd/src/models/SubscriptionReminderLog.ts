import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * NEW MODEL — additive only. Tracks which (clinic, milestone, expiry cycle)
 * subscription reminder emails have already been sent, so the daily cron
 * job never double-sends the same "7 days left" email to the same clinic
 * twice for the same expiry date.
 *
 * planExpiresAt is stored (not just clinicId + milestoneDays) so that when
 * a clinic renews and planExpiresAt moves forward, the next expiry cycle's
 * "7 days left" reminder is treated as new and gets sent again — the unique
 * index below is scoped per expiry date, not per clinic forever.
 */
export interface ISubscriptionReminderLog extends Document {
  clinicId: Types.ObjectId;
  milestoneDays: 7 | 3 | 1;
  planExpiresAt: Date;
  status: "sent" | "failed";
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ISubscriptionReminderLog>(
  {
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    milestoneDays: { type: Number, enum: [7, 3, 1], required: true },
    planExpiresAt: { type: Date, required: true },
    status: { type: String, enum: ["sent", "failed"], required: true },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

// Only a "sent" reminder blocks a resend for that exact (clinic, milestone,
// expiry date) combo — a "failed" attempt can be retried on the next run.
schema.index(
  { clinicId: 1, milestoneDays: 1, planExpiresAt: 1 },
  { unique: true, partialFilterExpression: { status: "sent" } }
);

export const SubscriptionReminderLog = mongoose.model<ISubscriptionReminderLog>(
  "SubscriptionReminderLog",
  schema
);
