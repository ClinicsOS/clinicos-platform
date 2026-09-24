import { Request, Response } from "express";
import { z } from "zod";
import { RecurringExpense } from "../models/RecurringExpense";
import { Expense } from "../models/Expense";
import { asyncHandler } from "../middleware/errorHandler";
import { EXPENSE_CATEGORIES, EXPENSE_SCOPES, EXPENSE_METHODS } from "../config/expenses";
import {
  PERIOD_RE,
  isValidDateStr,
  todayStr,
  currentPeriod,
  shiftPeriod,
  dueDateStr,
  daysBetween,
  statusFor,
  dateFromStr,
  ammanDateStr,
  defaultStartPeriod,
  getDueItems,
} from "../services/expenseSchedule";

/**
 * NEW CONTROLLER — clinic & owner expense tracker.
 * All routes are owner-only (see routes/expenseRoutes.ts): personal
 * expenses must never be visible to receptionists or doctors on staff.
 */

// ===================================================================
// Validation
// ===================================================================

const money = z.number().min(0).max(10_000_000);
const dateStr = z.string().refine(isValidDateStr, { message: "Invalid date (YYYY-MM-DD)" });
const periodStr = z.string().regex(PERIOD_RE, "Invalid month (YYYY-MM)");
const notes = z.string().trim().max(500).optional();

const recurringFields = {
  title: z.string().trim().min(1).max(100),
  category: z.enum(EXPENSE_CATEGORIES),
  scope: z.enum(EXPENSE_SCOPES),
  amount: money,
  dueDay: z.number().int().min(1).max(31),
  remindDaysBefore: z.number().int().min(0).max(10).default(3),
  startPeriod: periodStr.optional(),
  isActive: z.boolean().optional(),
  notes,
};
const createRecurringSchema = z.object(recurringFields);
const updateRecurringSchema = z
  .object({ ...recurringFields, remindDaysBefore: z.number().int().min(0).max(10) })
  .partial();

const expenseFields = {
  title: z.string().trim().min(1).max(100),
  category: z.enum(EXPENSE_CATEGORIES),
  scope: z.enum(EXPENSE_SCOPES),
  amount: money,
  status: z.enum(["paid", "pending"]).default("paid"),
  date: dateStr, // paid date, or due date when pending
  method: z.enum(EXPENSE_METHODS).optional(),
  remindDaysBefore: z.number().int().min(0).max(10).optional(),
  notes,
};
const createExpenseSchema = z.object(expenseFields);
const updateExpenseSchema = z
  .object({ ...expenseFields, status: z.enum(["paid", "pending"]) })
  .partial();

const payRecurringSchema = z.object({
  period: periodStr,
  amount: money.optional(), // defaults to the bill's expected amount
  date: dateStr.optional(), // defaults to today
  method: z.enum(EXPENSE_METHODS).optional(),
  notes,
});

const payExpenseSchema = z.object({
  amount: money.optional(),
  date: dateStr.optional(),
  method: z.enum(EXPENSE_METHODS).optional(),
});

const isDuplicate = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;

const round3 = (n: number) => Math.round(n * 1000) / 1000;

// ===================================================================
// Overview — everything the Expenses page needs in one request
// ===================================================================

/**
 * GET /api/expenses/overview?period=YYYY-MM
 * Monthly bills with their status for that month, the month's ledger,
 * totals split clinic vs personal, and (for the current month) anything
 * from last month that is still unpaid.
 */
export const getOverview = asyncHandler(async (req: Request, res: Response) => {
  const today = todayStr();
  const nowPeriod = currentPeriod();
  const q = String(req.query.period || "");
  const period = PERIOD_RE.test(q) ? q : nowPeriod;
  const clinicId = req.clinicId;

  const [bills, entries] = await Promise.all([
    RecurringExpense.find({ clinicId }).sort({ dueDay: 1, title: 1 }).lean(),
    Expense.find({ clinicId, period }).sort({ date: -1, createdAt: -1 }).lean(),
  ]);

  const paymentByBill = new Map<string, (typeof entries)[number]>();
  for (const e of entries) if (e.recurringId) paymentByBill.set(String(e.recurringId), e);

  const toRow = (b: (typeof bills)[number], forPeriod: string, payment?: (typeof entries)[number]) => {
    const dueDate = dueDateStr(forPeriod, b.dueDay);
    const daysUntil = daysBetween(today, dueDate);
    return {
      _id: String(b._id),
      title: b.title,
      category: b.category,
      scope: b.scope,
      amount: b.amount,
      dueDay: b.dueDay,
      remindDaysBefore: b.remindDaysBefore,
      startPeriod: b.startPeriod,
      isActive: b.isActive,
      notes: b.notes,
      period: forPeriod,
      dueDate,
      daysUntil,
      status: statusFor(daysUntil, b.remindDaysBefore, !!payment),
      payment: payment
        ? {
            _id: String(payment._id),
            amount: payment.amount,
            date: ammanDateStr(payment.date),
            method: payment.method,
          }
        : null,
    };
  };

  // Bills that apply to this month. Paused bills are included (so they can
  // be resumed from the page) but never count as due — see totals below.
  const billRows = bills
    .filter((b) => b.startPeriod <= period)
    .map((b) => toRow(b, period, paymentByBill.get(String(b._id))));

  // Bills added recently whose first due date is in a later month (e.g.
  // "Rent, due on the 1st" added on the 24th) — shown so they don't look lost.
  const notStarted = bills
    .filter((b) => b.isActive && b.startPeriod > period)
    .map((b) => toRow(b, b.startPeriod));

  // Carry-over: last month's bills still unpaid (only when viewing this month).
  let carryOver: ReturnType<typeof toRow>[] = [];
  let overduePending: typeof entries = [];
  if (period === nowPeriod) {
    const prev = shiftPeriod(nowPeriod, -1);
    const active = bills.filter((b) => b.isActive && b.startPeriod <= prev);
    if (active.length) {
      const prevPaid = await Expense.find({
        clinicId,
        period: prev,
        recurringId: { $in: active.map((b) => b._id) },
      })
        .select("recurringId")
        .lean();
      const paidSet = new Set(prevPaid.map((p) => String(p.recurringId)));
      carryOver = active.filter((b) => !paidSet.has(String(b._id))).map((b) => toRow(b, prev));
    }
    overduePending = await Expense.find({ clinicId, status: "pending", period: { $lt: nowPeriod } })
      .sort({ date: 1 })
      .lean();
  }

  // Totals — only money actually paid counts.
  const totals = { clinic: 0, personal: 0, total: 0, pending: 0, expected: 0 };
  const byCategory: Record<string, { clinic: number; personal: number }> = {};
  for (const e of entries) {
    if (e.status !== "paid") {
      totals.pending += e.amount;
      continue;
    }
    totals[e.scope] += e.amount;
    totals.total += e.amount;
    byCategory[e.category] ??= { clinic: 0, personal: 0 };
    byCategory[e.category][e.scope] += e.amount;
  }
  for (const r of billRows) if (!r.payment && r.isActive) totals.pending += r.amount;
  totals.expected = totals.total + totals.pending;
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = round3(totals[k]);

  return res.json({
    period,
    today,
    currentPeriod: nowPeriod,
    bills: billRows,
    notStarted,
    carryOver,
    entries: entries.map((e) => ({ ...e, date: ammanDateStr(e.date) })),
    overduePending: overduePending.map((e) => ({ ...e, date: ammanDateStr(e.date) })),
    totals,
    byCategory: Object.entries(byCategory)
      .map(([category, v]) => ({
        category,
        clinic: round3(v.clinic),
        personal: round3(v.personal),
        total: round3(v.clinic + v.personal),
      }))
      .sort((a, b) => b.total - a.total),
  });
});

/**
 * GET /api/expenses/alerts
 * Small payload for the sidebar dot: how many bills are overdue / due soon.
 */
export const getAlerts = asyncHandler(async (req: Request, res: Response) => {
  const items = await getDueItems(req.clinicId!);
  const overdue = items.filter((i) => i.status === "overdue").length;
  const dueSoon = items.filter((i) => i.status === "due_soon").length;
  return res.json({ overdue, dueSoon, count: overdue + dueSoon });
});

// ===================================================================
// Monthly bills
// ===================================================================

export const createRecurring = asyncHandler(async (req: Request, res: Response) => {
  const data = createRecurringSchema.parse(req.body);
  const bill = await RecurringExpense.create({
    ...data,
    startPeriod: data.startPeriod ?? defaultStartPeriod(data.dueDay),
    clinicId: req.clinicId,
    createdBy: req.userId,
  });
  return res.status(201).json(bill);
});

export const updateRecurring = asyncHandler(async (req: Request, res: Response) => {
  const data = updateRecurringSchema.parse(req.body);
  const bill = await RecurringExpense.findOneAndUpdate(
    { _id: req.params.id, clinicId: req.clinicId },
    { $set: data },
    { new: true, runValidators: true }
  );
  if (!bill) return res.status(404).json({ message: "Bill not found" });
  return res.json(bill);
});

/** Deletes the bill itself. Payments already recorded stay in the ledger. */
export const deleteRecurring = asyncHandler(async (req: Request, res: Response) => {
  const result = await RecurringExpense.deleteOne({ _id: req.params.id, clinicId: req.clinicId });
  if (!result.deletedCount) return res.status(404).json({ message: "Bill not found" });
  return res.json({ ok: true });
});

/** POST /api/expenses/recurring/:id/pay — "Mark as paid" for one month. */
export const payRecurring = asyncHandler(async (req: Request, res: Response) => {
  const data = payRecurringSchema.parse(req.body);
  const bill = await RecurringExpense.findOne({ _id: req.params.id, clinicId: req.clinicId });
  if (!bill) return res.status(404).json({ message: "Bill not found" });

  const ALREADY_PAID = "This bill is already marked as paid for that month";
  if (await Expense.exists({ clinicId: req.clinicId, recurringId: bill._id, period: data.period })) {
    return res.status(409).json({ message: ALREADY_PAID });
  }

  try {
    const entry = await Expense.create({
      clinicId: req.clinicId,
      createdBy: req.userId,
      title: bill.title,
      category: bill.category,
      scope: bill.scope,
      amount: data.amount ?? bill.amount,
      status: "paid",
      date: dateFromStr(data.date ?? todayStr()),
      period: data.period,
      method: data.method,
      notes: data.notes,
      recurringId: bill._id,
    });
    return res.status(201).json(entry);
  } catch (err) {
    if (isDuplicate(err)) {
      return res.status(409).json({ message: ALREADY_PAID });
    }
    throw err;
  }
});

/** DELETE /api/expenses/recurring/:id/pay/:period — undo "Mark as paid". */
export const unpayRecurring = asyncHandler(async (req: Request, res: Response) => {
  const period = periodStr.parse(req.params.period);
  const result = await Expense.deleteOne({
    clinicId: req.clinicId,
    recurringId: req.params.id,
    period,
  });
  if (!result.deletedCount) return res.status(404).json({ message: "Payment not found" });
  return res.json({ ok: true });
});

// ===================================================================
// One-time expenses (ledger lines)
// ===================================================================

export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const data = createExpenseSchema.parse(req.body);
  const entry = await Expense.create({
    ...data,
    date: dateFromStr(data.date),
    period: data.date.slice(0, 7),
    remindDaysBefore: data.status === "pending" ? data.remindDaysBefore ?? 3 : undefined,
    method: data.status === "paid" ? data.method : undefined,
    clinicId: req.clinicId,
    createdBy: req.userId,
  });
  return res.status(201).json(entry);
});

export const updateExpense = asyncHandler(async (req: Request, res: Response) => {
  const data = updateExpenseSchema.parse(req.body);
  const entry = await Expense.findOne({ _id: req.params.id, clinicId: req.clinicId });
  if (!entry) return res.status(404).json({ message: "Expense not found" });

  if (data.title !== undefined) entry.title = data.title;
  if (data.amount !== undefined) entry.amount = data.amount;
  if (data.notes !== undefined) entry.notes = data.notes || undefined;
  if (data.method !== undefined) entry.method = data.method;

  // Lines created from a monthly bill keep the bill's category / scope /
  // month; only amount, date, method and notes can change.
  if (!entry.recurringId) {
    if (data.category !== undefined) entry.category = data.category;
    if (data.scope !== undefined) entry.scope = data.scope;
    if (data.status !== undefined) entry.status = data.status;
    if (data.remindDaysBefore !== undefined) entry.remindDaysBefore = data.remindDaysBefore;
    if (data.date !== undefined) entry.period = data.date.slice(0, 7);
    if (entry.status === "paid") entry.remindDaysBefore = undefined;
  }
  if (data.date !== undefined) entry.date = dateFromStr(data.date);

  await entry.save();
  return res.json(entry);
});

/** POST /api/expenses/:id/pay — a pending one-time bill was paid. */
export const payExpense = asyncHandler(async (req: Request, res: Response) => {
  const data = payExpenseSchema.parse(req.body);
  const entry = await Expense.findOne({ _id: req.params.id, clinicId: req.clinicId });
  if (!entry) return res.status(404).json({ message: "Expense not found" });
  if (entry.status === "paid") return res.status(400).json({ message: "Already paid" });

  const paidOn = data.date ?? todayStr();
  entry.status = "paid";
  entry.date = dateFromStr(paidOn);
  entry.period = paidOn.slice(0, 7);
  entry.remindDaysBefore = undefined;
  if (data.amount !== undefined) entry.amount = data.amount;
  if (data.method !== undefined) entry.method = data.method;

  await entry.save();
  return res.json(entry);
});

export const deleteExpense = asyncHandler(async (req: Request, res: Response) => {
  const result = await Expense.deleteOne({ _id: req.params.id, clinicId: req.clinicId });
  if (!result.deletedCount) return res.status(404).json({ message: "Expense not found" });
  return res.json({ ok: true });
});
