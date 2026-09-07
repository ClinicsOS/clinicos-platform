import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * NEW MODEL — does not modify or touch Appointment.ts, Patient.ts (schema
 * fields), User.ts, or any existing model. Purely additive collection.
 *
 * One document per (appointment, recipient) reminder attempt. Used for:
 *  1) An audit trail (who got reminded, when, and whether it worked).
 *  2) Idempotency — the unique partial index below stops the same
 *     reminder being sent twice to the same recipient for the same
 *     appointment if the daily job ever gets triggered more than once
 *     (e.g. the external cron pinger retries).
 */
export interface IReminderLog extends Document {
  appointmentId: Types.ObjectId;
  clinicId: Types.ObjectId;
  recipientRole: "doctor" | "patient";
  recipientPhone: string;
  status: "sent" | "failed" | "skipped";
  errorMessage?: string;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const reminderLogSchema = new Schema<IReminderLog>(
  {
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      index: true,
    },
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    recipientRole: {
      type: String,
      enum: ["doctor", "patient"],
      required: true,
    },
    recipientPhone: { type: String, required: true },
    status: {
      type: String,
      enum: ["sent", "failed", "skipped"],
      required: true,
    },
    errorMessage: { type: String },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Only "sent" reminders are unique — a "failed" attempt can be retried
// (a later successful "sent" document for the same pair is still allowed).
reminderLogSchema.index(
  { appointmentId: 1, recipientRole: 1 },
  { unique: true, partialFilterExpression: { status: "sent" } }
);

export const ReminderLog = mongoose.model<IReminderLog>(
  "ReminderLog",
  reminderLogSchema
);
