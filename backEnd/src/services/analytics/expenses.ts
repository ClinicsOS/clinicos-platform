import type { DataScope } from "../../auth/policy";
import { summarizeExpenses, expenseTotalsByDay, type ExpenseSummary } from "../expenseLedger";
import type { DateRange } from "./range";

/**
 * PHASE 6 — EXPENSE METRICS. A thin adapter over the PHASE 5 ledger (services/expenseLedger.ts); NO expense arithmetic lives here.
 *
 *   Source: Expense collection via the ledger · Date: Expense.date (the financial date, clinic-local day) — never createdAt
 *   Included: status "paid", not soft-deleted (deletedAt unset).  Excluded: pending bills (reported separately), deleted rows.
 *   Business expenses = shared clinic + doctor-attributed.  Personal (the owner's household) is NEVER part of business expenses,
 *   never part of Net Cash, and is only returned to the owner when the whole clinic is in scope.
 *   Scope: the Phase 5 data scope — owner: clinic (or narrowed to a doctor → that doctor's attributed expenses only);
 *          doctor: ONLY expenses attributed to them (shared clinic expenses are never exposed and never allocated).
 */
export const expenseSummaryFor = (es: DataScope, r: DateRange): Promise<ExpenseSummary> => summarizeExpenses(es, { from: r.from, to: r.to });
export const expenseSeriesFor = (es: DataScope, r: DateRange, kind: "business" | "clinic" | "doctor" = "business") => expenseTotalsByDay(es, { from: r.from, to: r.to }, kind);
