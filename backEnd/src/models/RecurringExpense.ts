import mongoose, { Schema, Document, Types } from "mongoose";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_SCOPES,
  type ExpenseCategory,
  type ExpenseScope,
} from "../config/expenses";

/**
 * NEW MODEL — a monthly bill the owner enters ONCE (clinic rent, internet,
 * salaries, a personal loan instalment...). Every month the system works out
 * its due date, shows it as upcoming / due soon / overdue / paid, and emails
 * a reminder — the owner never re-types it.
 *
 * The actual money paid each month is NOT stored here; each "Mark as paid"
 * creates an Expense document (models/Expense.ts) linked by recurringId +
 * period, so the monthly ledger and totals come from one place.
 */
export interface IRecurringExpense extends Document {
  clinicId: Types.ObjectId;
  createdBy?: Types.ObjectId;
  title: string;
  category: ExpenseCategory;
  scope: ExpenseScope;
  amount: number; // expected monthly amount — the real paid amount can differ
  dueDay: number; // 1–31; clamped to the last day in shorter months
  remindDaysBefore: number; // 0–10
  startPeriod: string; // "YYYY-MM" — first month this bill applies to
  isActive: boolean; // paused bills stop showing and stop reminding
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IRecurringExpense>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    scope: { type: String, enum: EXPENSE_SCOPES, required: true },
    amount: { type: Number, required: true, min: 0 },
    dueDay: { type: Number, required: true, min: 1, max: 31 },
    remindDaysBefore: { type: Number, default: 3, min: 0, max: 10 },
    startPeriod: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    isActive: { type: Boolean, default: true },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

schema.index({ clinicId: 1, isActive: 1 });

export const RecurringExpense = mongoose.model<IRecurringExpense>("RecurringExpense", schema);
