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
  // ===== PHASE 5 (all optional → every existing document stays valid) =====
  /** The doctor this expense financially belongs to (NOT the person who typed it — that is createdBy). Only with scope "clinic". */
  doctorId?: Types.ObjectId;
  vendor?: string; // payee / supplier / lab name
  reference?: string; // invoice / receipt number given by the vendor
  updatedBy?: Types.ObjectId;
  // Soft delete: a deleted expense is kept for audit but is excluded from EVERY read and total (see services/expenseLedger.ts).
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  /** When a monthly-bill payment is deleted its recurringId moves here, so the (recurringId, period) unique index lets the month be paid again. */
  archivedRecurringId?: Types.ObjectId;
  /** PHASE 7 — double-click guard for one-time expenses: hash of (clinic, who, what, when) + a 10-second bucket. Unique. */
  dedupeKey?: string;
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
    doctorId: { type: Schema.Types.ObjectId, ref: "User" },
    vendor: { type: String, trim: true, maxlength: 100 },
    reference: { type: String, trim: true, maxlength: 60 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    archivedRecurringId: { type: Schema.Types.ObjectId, ref: "RecurringExpense" },
    dedupeKey: { type: String, maxlength: 64 },
  },
  { timestamps: true }
);

schema.index({ clinicId: 1, period: 1 });
schema.index({ clinicId: 1, status: 1 });
// PHASE 5 — the three real list/summary access paths (all by the financial date `date`, newest first):
schema.index({ clinicId: 1, date: -1 }); // whole clinic, date range
schema.index({ clinicId: 1, doctorId: 1, date: -1 }); // one doctor (a doctor's own view, the owner's doctor filter)
schema.index({ clinicId: 1, category: 1, date: -1 }); // category filter / breakdown
// PHASE 7 — two identical submissions in the same 10 s bucket (a parallel double click) cannot both be stored.
// (the clinic id is part of the hash, so a plain sparse single-field index is enough — and works on every MongoDB version.)
schema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
// A monthly bill can only be paid once per month.
schema.index(
  { recurringId: 1, period: 1 },
  { unique: true, partialFilterExpression: { recurringId: { $exists: true } } }
);

export const Expense = mongoose.model<IExpense>("Expense", schema);
