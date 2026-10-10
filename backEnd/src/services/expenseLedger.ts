import mongoose from "mongoose";
import { Expense } from "../models/Expense";
import { User } from "../models/User";
import { PolicyError, isOid, type DataScope } from "../auth/policy";
import { findClinicDoctor } from "./doctorAttribution";
import { EXPENSE_CATEGORIES } from "../config/expenses";
import { ammanDateStr, isValidDateStr } from "./expenseSchedule";
import { clinicDayRange, DEFAULT_CLINIC_TIMEZONE } from "../utils/timezone";

/**
 * PHASE 5 — THE financial query layer for expenses (the expense half of ClinicOS' financial architecture).
 *
 * Every screen / endpoint / future report that needs expense numbers goes through this file, so a total can never be
 * computed two different ways (controllers/expenseLedgerController.ts, the Expenses page, and — in Phase 6 — Reports and
 * the Dashboard). Nothing here lives in React components.
 *
 * ── Definitions (these are the contract Phase 6 builds on) ──────────────────────────────────────────────────────────────
 *  • A record COUNTS in totals only when it is  status = "paid"  AND  not soft-deleted (deletedAt is unset).
 *    "pending" bills (due in the future) are reported separately as `pending` and are never part of a total.
 *  • FINANCIAL DATE = the `date` field (the day the money was spent / paid, Asia/Amman). `createdAt` is audit metadata
 *    only and is never used to place an expense in a period. (`period` "YYYY-MM" is the accounting-month label used by the
 *    monthly-bills tracker; for a bill paid late it can differ from the month of `date`.)
 *  • Three kinds of money, never mixed:
 *      clinic    = scope "clinic" with NO doctorId  → a SHARED clinic expense (rent, electricity…). It is NOT split
 *                  between doctors — no allocation system exists, so nothing here ever invents one.
 *      doctor    = scope "clinic" WITH a doctorId   → attributed to that doctor (lab work for Dr Ahmad…).
 *      personal  = scope "personal"                 → the owner's household money. Owner-only, never part of `business`.
 *    business = clinic + doctor.  This is the "Total expenses" of the clinic. `personal` is reported next to it, never inside.
 *  • Data scope (Phase 4 policy): owner → whole clinic (optionally narrowed to a doctor); doctor → ONLY doctor-attributed
 *    expenses where doctorId = themselves; receptionist → no access (rejected before it gets here).
 *  • Money is JD with up to 3 decimals (same convention as invoices); sums are rounded to 3 decimals.
 */

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** True when `n` is a positive, finite amount with at most 3 decimals (fils). */
export const isValidAmount = (n: unknown, max: number): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0 && n <= max && round3(n) === n;

export type ExpenseKind = "all" | "clinic" | "doctor" | "personal";
export const EXPENSE_KINDS: readonly ExpenseKind[] = ["all", "clinic", "doctor", "personal"];

export interface ExpenseFilter {
  from?: string; // YYYY-MM-DD, inclusive (financial date)
  to?: string; // YYYY-MM-DD, inclusive
  category?: string;
  kind?: ExpenseKind;
  status?: "paid" | "pending";
  search?: string; // description / vendor / reference
}

// PHASE 6: day bounds come from the central clinic-timezone helper (no hard-coded UTC offset). [start of `from` day, start of the day AFTER `to`).
const startOf = (ymd: string) => clinicDayRange(ymd).start;
const endExclusive = (ymd: string) => clinicDayRange(ymd).end;
const escapeRx = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // PHASE 7 — a NUL / control character makes MongoDB reject the pattern (was a 500)

/**
 * The Mongo filter for (scope, filter). `oid: true` returns real ObjectIds (needed inside aggregate() $match, which does not cast);
 * `oid: false` returns strings for find()/countDocuments(). Every condition is AND-ed, so a client filter can only NARROW what
 * the data scope allows — it can never widen it.
 */
export function buildExpenseMatch(scope: DataScope, f: ExpenseFilter = {}, oid = false): Record<string, unknown> {
  const id = (v: string) => (oid ? new mongoose.Types.ObjectId(v) : v);
  const and: Record<string, unknown>[] = [{ clinicId: id(scope.clinicId) }, { deletedAt: null }];

  // ── data scope (Phase 4) ──
  if (scope.level === "self") {
    // a doctor: only business expenses attributed to themselves (personal / shared-clinic expenses are never theirs)
    and.push({ doctorId: id(scope.userId) }, { scope: "clinic" });
  } else if (scope.unassigned) {
    and.push({ doctorId: null });
  } else if (scope.doctorId) {
    and.push({ doctorId: id(scope.doctorId) });
  }

  // ── client filters (narrowing only) ──
  if (f.kind === "clinic") and.push({ scope: "clinic" }, { doctorId: null });
  else if (f.kind === "doctor") and.push({ doctorId: { $ne: null } });
  else if (f.kind === "personal") and.push({ scope: "personal" });

  if (f.category) and.push({ category: f.category });
  if (f.status) and.push({ status: f.status });
  if (f.from || f.to) {
    const range: Record<string, Date> = {};
    if (f.from) range.$gte = startOf(f.from);
    if (f.to) range.$lt = endExclusive(f.to);
    and.push({ date: range });
  }
  if (f.search) {
    const rx = new RegExp(escapeRx(f.search), "i");
    and.push({ $or: [{ title: rx }, { vendor: rx }, { reference: rx }] });
  }
  return { $and: and };
}

/** Validates a raw query-string filter (strings only — an object/array from `?a[$ne]=x` is a 400, never passed to Mongo). */
export function parseExpenseFilter(q: Record<string, unknown>): ExpenseFilter {
  const str = (k: string): string | undefined => {
    const v = q[k];
    if (v === undefined || v === "") return undefined;
    if (typeof v !== "string") throw new PolicyError(400, "INVALID_FILTER", `Invalid ${k}`);
    return v.trim();
  };
  const f: ExpenseFilter = {};
  const from = str("from"), to = str("to"), category = str("category"), kind = str("kind"), status = str("status"), search = str("search");
  if (from) { if (!isValidDateStr(from)) throw new PolicyError(400, "INVALID_DATE", "Invalid from date (YYYY-MM-DD)"); f.from = from; }
  if (to) { if (!isValidDateStr(to)) throw new PolicyError(400, "INVALID_DATE", "Invalid to date (YYYY-MM-DD)"); f.to = to; }
  if (f.from && f.to && f.from > f.to) throw new PolicyError(400, "INVALID_DATE", "The start date is after the end date");
  if (category) { if (!(EXPENSE_CATEGORIES as readonly string[]).includes(category)) throw new PolicyError(400, "INVALID_CATEGORY", "Unknown category"); f.category = category; }
  if (kind && kind !== "all") { if (!EXPENSE_KINDS.includes(kind as ExpenseKind)) throw new PolicyError(400, "INVALID_FILTER", "Invalid kind"); f.kind = kind as ExpenseKind; }
  if (status) { if (status !== "paid" && status !== "pending") throw new PolicyError(400, "INVALID_FILTER", "Invalid status"); f.status = status; }
  if (search) { if (search.length > 60) throw new PolicyError(400, "INVALID_FILTER", "Search text is too long"); f.search = search; }
  return f;
}

// ───────────────────────────── list ─────────────────────────────

export interface ExpenseRow {
  _id: string;
  title: string;
  category: string;
  scope: "clinic" | "personal";
  kind: "clinic" | "doctor" | "personal";
  amount: number;
  status: "paid" | "pending";
  date: string; // financial date, YYYY-MM-DD (Asia/Amman)
  period: string;
  method?: string;
  vendor?: string;
  reference?: string;
  notes?: string;
  recurringId?: string;
  doctor: { _id: string; name: string } | null;
  createdBy: { _id: string; name: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

export function serializeExpense(e: any): ExpenseRow {
  const ref = (v: any) => (v && typeof v === "object" && v._id ? { _id: String(v._id), name: String(v.name ?? "") } : v ? { _id: String(v), name: "" } : null);
  const doctor = ref(e.doctorId);
  return {
    _id: String(e._id),
    title: e.title,
    category: e.category,
    scope: e.scope,
    kind: e.scope === "personal" ? "personal" : doctor ? "doctor" : "clinic",
    amount: e.amount,
    status: e.status,
    date: ammanDateStr(e.date),
    period: e.period,
    method: e.method,
    vendor: e.vendor,
    reference: e.reference,
    notes: e.notes,
    recurringId: e.recurringId ? String(e.recurringId) : undefined,
    doctor,
    createdBy: ref(e.createdBy),
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

const SORT = { date: -1, createdAt: -1, _id: -1 } as const;
export const MAX_PAGE_SIZE = 100;

export async function listExpenses(scope: DataScope, filter: ExpenseFilter, page: number, limit: number) {
  const match = buildExpenseMatch(scope, filter);
  const pageSize = Math.min(Math.max(1, Math.floor(limit) || 25), MAX_PAGE_SIZE);
  const p = Math.max(1, Math.floor(page) || 1);
  const [rows, total] = await Promise.all([
    Expense.find(match).sort(SORT).skip((p - 1) * pageSize).limit(pageSize).populate("doctorId", "name").populate("createdBy", "name").lean(),
    Expense.countDocuments(match),
  ]);
  return { items: rows.map(serializeExpense), total, page: p, limit: pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** One expense by id inside the caller's scope. Out of scope / deleted / other clinic / malformed id are all the same `null` (→ 404). */
export async function getExpenseInScope(scope: DataScope, id: string): Promise<ExpenseRow | null> {
  if (!isOid(id)) return null;
  const match = buildExpenseMatch(scope);
  const e = await Expense.findOne({ $and: [match, { _id: id }] }).populate("doctorId", "name").populate("createdBy", "name").lean();
  return e ? serializeExpense(e) : null;
}

// ───────────────────────────── summary (the reusable totals) ─────────────────────────────

export interface ExpenseSummary {
  currency: "JOD";
  range: { from: string | null; to: string | null };
  count: number; // number of PAID expenses in range
  totals: { business: number; clinic: number; doctor: number; personal: number };
  pending: number; // unpaid (due) expenses in range — informational, not part of totals
  byCategory: { category: string; total: number; clinic: number; doctor: number; personal: number }[];
  byDoctor: { doctorId: string; name: string; total: number }[]; // doctor-attributed only; shared clinic expenses are NOT allocated
}

/**
 * Totals for (scope, filter). One small aggregation (grouped by scope × doctor × category — a few dozen rows at most, never the
 * whole history) plus one for the pending total. `filter.status` is ignored: totals are always paid money.
 */
export async function summarizeExpenses(scope: DataScope, filter: ExpenseFilter = {}): Promise<ExpenseSummary> {
  const paidMatch = buildExpenseMatch(scope, { ...filter, status: "paid" }, true);
  const pendingMatch = buildExpenseMatch(scope, { ...filter, status: "pending" }, true);

  const [groups, pend] = await Promise.all([
    Expense.aggregate([
      { $match: paidMatch },
      { $group: { _id: { scope: "$scope", doctorId: "$doctorId", category: "$category" }, total: { $sum: "$amount" }, n: { $sum: 1 } } },
    ]),
    Expense.aggregate([{ $match: pendingMatch }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
  ]);

  let business = 0, clinic = 0, doctor = 0, personal = 0, count = 0;
  const cat = new Map<string, { total: number; clinic: number; doctor: number; personal: number }>();
  const doc = new Map<string, number>();
  for (const g of groups) {
    const amount: number = g.total ?? 0;
    const sc: string = g._id?.scope;
    const did = g._id?.doctorId ? String(g._id.doctorId) : null;
    const category: string = g._id?.category;
    count += g.n ?? 0;
    const c = cat.get(category) ?? { total: 0, clinic: 0, doctor: 0, personal: 0 };
    if (sc === "personal") { personal += amount; c.personal += amount; }
    else if (did) { doctor += amount; business += amount; c.doctor += amount; doc.set(did, (doc.get(did) ?? 0) + amount); }
    else { clinic += amount; business += amount; c.clinic += amount; }
    c.total += amount;
    cat.set(category, c);
  }

  const names = new Map<string, string>();
  if (doc.size) {
    const users = await User.find({ clinicId: scope.clinicId, _id: { $in: Array.from(doc.keys()) } }).select("name").lean();
    for (const u of users) names.set(String(u._id), u.name);
  }

  return {
    currency: "JOD",
    range: { from: filter.from ?? null, to: filter.to ?? null },
    count,
    totals: { business: round3(business), clinic: round3(clinic), doctor: round3(doctor), personal: round3(personal) },
    pending: round3(pend[0]?.total ?? 0),
    byCategory: Array.from(cat.entries())
      .map(([category, v]) => ({ category, total: round3(v.total), clinic: round3(v.clinic), doctor: round3(v.doctor), personal: round3(v.personal) }))
      .sort((a, b) => b.total - a.total),
    byDoctor: Array.from(doc.entries())
      .map(([doctorId, total]) => ({ doctorId, name: names.get(doctorId) ?? "", total: round3(total) }))
      .sort((a, b) => b.total - a.total),
  };
}

/**
 * PHASE 6 — paid business expenses (clinic + doctor-attributed; personal is never included) per clinic-local day, for the analytics
 * time series. Same scope + same filters + same definitions as summarizeExpenses (it reuses buildExpenseMatch), so a series always adds
 * up to the summary total. `kind` defaults to "business"; pass "clinic" / "doctor" to split.
 */
export async function expenseTotalsByDay(scope: DataScope, filter: ExpenseFilter = {}, kind: "business" | "clinic" | "doctor" = "business"): Promise<Map<string, number>> {
  const match = buildExpenseMatch(scope, { ...filter, status: "paid" }, true);
  const and = (match.$and as Record<string, unknown>[]).concat([{ scope: "clinic" }]);
  if (kind === "clinic") and.push({ doctorId: null });
  if (kind === "doctor") and.push({ doctorId: { $ne: null } });
  const rows = await Expense.aggregate([
    { $match: { $and: and } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$date", timezone: DEFAULT_CLINIC_TIMEZONE } }, total: { $sum: "$amount" } } },
  ]);
  return new Map(rows.map((x: { _id: string; total: number }) => [String(x._id), x.total ?? 0]));
}

// ───────────────────────────── write helpers ─────────────────────────────

/**
 * A doctorId arriving in a write body: must be a doctor of THIS clinic (and, when newly assigned, an active one).
 * Business expenses only — an owner-personal expense can never be attributed to a doctor.
 */
export async function assertAttributableDoctor(clinicId: unknown, doctorId: string, opts: { activeOnly?: boolean } = {}) {
  const d = await findClinicDoctor(clinicId, doctorId, { activeOnly: opts.activeOnly });
  if (!d) throw new PolicyError(404, "DOCTOR_NOT_FOUND", "Doctor not found");
  return d;
}

/**
 * Soft delete (audit-safe). The record stays in the database with deletedAt / deletedBy and disappears from every list and total.
 * A monthly-bill payment gives its recurringId back (kept in archivedRecurringId) so that month can be paid again.
 */
export async function softDeleteExpense(clinicId: unknown, id: unknown, userId: unknown): Promise<boolean> {
  if (!isOid(String(id))) return false;
  const e = await Expense.findOne({ _id: id, clinicId, deletedAt: null }).select("recurringId");
  if (!e) return false;
  const $set: Record<string, unknown> = { deletedAt: new Date(), deletedBy: userId };
  const update: Record<string, unknown> = { $set };
  if (e.recurringId) {
    $set.archivedRecurringId = e.recurringId;
    update.$unset = { recurringId: 1 };
  }
  const r = await Expense.updateOne({ _id: e._id, clinicId, deletedAt: null }, update);
  return r.modifiedCount === 1;
}

