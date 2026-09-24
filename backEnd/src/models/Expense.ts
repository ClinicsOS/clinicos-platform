import mongoose, { Schema, Document, Types } from "mongoose";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_SCOPES,
  EXPENSE_METHODS,
  type ExpenseCategory,
  type ExpenseScope,
  type ExpenseMethod,
} from "../config/expenses";

/**
 * NEW MODEL — one line in the expense ledger.
 *
 *  - A one-time expense ("bought a new compressor") is created directly.
 *    It can be "paid" (money already spent) or "pending" (a bill due on a
 *    future date — gets a reminder like the monthly ones).
 *  - A monthly bill's payment ("paid September rent") is created from
 *    RecurringExpense and carries recurringId + period.
 *
 * `period` ("YYYY-MM", Asia/Amman) is the month the line counts towards, so
 * monthly totals are a simple indexed query.
 */
export interface IExpense extends Document {
  clinicId: Types.ObjectId;
  createdBy?: Types.ObjectId;
  title: string;
  category: ExpenseCategory;
  scope: ExpenseScope;
  amount: number;
  status: "paid" | "pending";
  date: Date; // paid date (paid) or due date (pending)
  period: string; // "YYYY-MM"
  method?: ExpenseMethod;
  remindDaysBefore?: number; // pending one-time bills only
  recurringId?: Types.ObjectId;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IExpense>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    scope: { type: String, enum: EXPENSE_SCOPES, required: true },
    amount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ["paid", "pending"], default: "paid" },
    date: { type: Date, required: true },
    period: { type: String, required: true, match: /^\d{4}-(0[1-9]|1[0-2])$/ },
    method: { type: String, enum: EXPENSE_METHODS },
    remindDaysBefore: { type: Number, min: 0, max: 10 },
    recurringId: { type: Schema.Types.ObjectId, ref: "RecurringExpense" },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true }
);

schema.index({ clinicId: 1, period: 1 });
schema.index({ clinicId: 1, status: 1 });
// A monthly bill can only be paid once per month.
schema.index(
  { recurringId: 1, period: 1 },
  { unique: true, partialFilterExpression: { recurringId: { $exists: true } } }
);

export const Expense = mongoose.model<IExpense>("Expense", schema);
