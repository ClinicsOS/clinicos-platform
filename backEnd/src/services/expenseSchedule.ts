/**
 * NEW FILE — date math for the expense tracker, always in Asia/Amman
 * (Render runs in UTC; Jordan is a fixed UTC+3 with no DST since 2022 —
 * same assumption as utils/timezone.ts).
 *
 * Dates are handled as plain "YYYY-MM-DD" strings and months as "YYYY-MM"
 * strings, so there is never any off-by-one-day drift between the server
 * and the doctor's phone.
 *
 * Used by BOTH the dashboard (controllers/expenseController.ts) and the
 * daily reminder cron (controllers/expenseReminderController.ts), so what
 * the owner sees on screen and what the email says always agree.
 */
import { Types } from "mongoose";
import { getAmmanTodayRange } from "../utils/timezone";
import { RecurringExpense } from "../models/RecurringExpense";
import { Expense } from "../models/Expense";

export const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type BillStatus = "paid" | "overdue" | "due_soon" | "upcoming";

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" for the given instant, in Amman. */
export const ammanDateStr = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Amman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

export const todayStr = (): string => getAmmanTodayRange().dateStr;
export const currentPeriod = (): string => todayStr().slice(0, 7);

/** Midday Amman time for a "YYYY-MM-DD" — safe from any timezone edge. */
export const dateFromStr = (s: string): Date => new Date(`${s}T12:00:00+03:00`);

export const isValidDateStr = (s: string): boolean => {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return d <= daysInMonth(y, m);
};

export const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Moves a "YYYY-MM" period by n months (n can be negative). */
export const shiftPeriod = (period: string, n: number): string => {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};

/** Due date of a monthly bill in a given month — day 31 becomes 30/29/28 when needed. */
export const dueDateStr = (period: string, dueDay: number): string => {
  const [y, m] = period.split("-").map(Number);
  return `${period}-${pad(Math.min(dueDay, daysInMonth(y, m)))}`;
};

/** Whole days from `from` to `to` (both "YYYY-MM-DD"). Negative = in the past. */
export const daysBetween = (from: string, to: string): number => {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
};

export const statusFor = (daysUntil: number, remindDaysBefore: number, paid: boolean): BillStatus => {
  if (paid) return "paid";
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= remindDaysBefore) return "due_soon";
  return "upcoming";
};

/**
 * First month a new monthly bill applies to: this month if its due day
 * hasn't passed yet, otherwise next month. This way adding "Rent, due on
 * the 1st" on the 24th doesn't instantly show this month's rent as overdue.
 */
export const defaultStartPeriod = (dueDay: number, today = todayStr()): string => {
  const period = today.slice(0, 7);
  return dueDateStr(period, dueDay) >= today ? period : shiftPeriod(period, 1);
};

// ===================================================================
// Shared "what's due" calculation
// ===================================================================

export interface DueItem {
  kind: "bill" | "expense";
  id: string;
  title: string;
  category: string;
  scope: string;
  amount: number;
  period: string;
  dueDate: string;
  daysUntil: number;
  remindDaysBefore: number;
  status: Exclude<BillStatus, "paid">;
}

/**
 * Everything still unpaid for a clinic "now": this month's monthly bills,
 * last month's monthly bills that were never marked paid, NEXT month's
 * bills whose reminder window has already opened (e.g. rent due on the
 * 1st with a 3-day reminder must remind on the 28th/29th/30th of this
 * month), and one-time bills saved as "pending". Most urgent first.
 */
export async function getDueItems(clinicId: string | Types.ObjectId): Promise<DueItem[]> {
  const today = todayStr();
  const current = today.slice(0, 7);
  const previous = shiftPeriod(current, -1);
  const next = shiftPeriod(current, 1);

  const bills = await RecurringExpense.find({ clinicId, isActive: true }).lean();
  const billIds = bills.map((b) => b._id);

  const [payments, pending] = await Promise.all([
    billIds.length
      ? Expense.find({ clinicId, recurringId: { $in: billIds }, period: { $in: [previous, current, next] } })
          .select("recurringId period")
          .lean()
      : Promise.resolve([]),
    Expense.find({ clinicId, status: "pending" }).lean(),
  ]);

  const paidKey = new Set(payments.map((p) => `${String(p.recurringId)}|${p.period}`));
  const items: DueItem[] = [];

  for (const b of bills) {
    for (const period of [previous, current, next]) {
      if (b.startPeriod > period) continue;
      if (paidKey.has(`${String(b._id)}|${period}`)) continue;
      const dueDate = dueDateStr(period, b.dueDay);
      const daysUntil = daysBetween(today, dueDate);
      const status = statusFor(daysUntil, b.remindDaysBefore, false);
      // Last month's bill only matters if it's still unpaid AND past due;
      // next month's only once its reminder window has opened.
      if (period === previous && status !== "overdue") continue;
      if (period === next && status !== "due_soon") continue;
      items.push({
        kind: "bill",
        id: String(b._id),
        title: b.title,
        category: b.category,
        scope: b.scope,
        amount: b.amount,
        period,
        dueDate,
        daysUntil,
        remindDaysBefore: b.remindDaysBefore,
        status: status as DueItem["status"],
      });
    }
  }

  for (const e of pending) {
    const dueDate = ammanDateStr(e.date);
    const remind = e.remindDaysBefore ?? 3;
    const daysUntil = daysBetween(today, dueDate);
    items.push({
      kind: "expense",
      id: String(e._id),
      title: e.title,
      category: e.category,
      scope: e.scope,
      amount: e.amount,
      period: e.period,
      dueDate,
      daysUntil,
      remindDaysBefore: remind,
      status: statusFor(daysUntil, remind, false) as DueItem["status"],
    });
  }

  return items.sort((a, b) => a.daysUntil - b.daysUntil);
}
