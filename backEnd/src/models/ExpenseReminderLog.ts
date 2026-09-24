import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * NEW MODEL — same idea as SubscriptionReminderLog: guarantees the daily
 * expense-reminder email goes out at most once per clinic per day, even if
 * the cron job fires twice. A "failed" attempt doesn't block a retry.
 */
export interface IExpenseReminderLog extends Document {
  clinicId: Types.ObjectId;
  dateStr: string; // "YYYY-MM-DD" in Asia/Amman
  itemCount: number;
  status: "sent" | "failed";
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IExpenseReminderLog>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    dateStr: { type: String, required: true },
    itemCount: { type: Number, default: 0 },
    status: { type: String, enum: ["sent", "failed"], required: true },
    errorMessage: { type: String },
  },
  { timestamps: true }
);

schema.index(
  { clinicId: 1, dateStr: 1 },
  { unique: true, partialFilterExpression: { status: "sent" } }
);

export const ExpenseReminderLog = mongoose.model<IExpenseReminderLog>(
  "ExpenseReminderLog",
  schema
);
