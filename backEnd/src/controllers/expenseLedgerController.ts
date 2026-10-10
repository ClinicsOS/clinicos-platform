import { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { resolveDataScope } from "../auth/policy";
import { parseExpenseFilter, listExpenses, summarizeExpenses, getExpenseInScope } from "../services/expenseLedger";

/**
 * PHASE 5 — READ side of the expense ledger (list, summary, one expense). Reachable by the owner (whole clinic) and by a doctor
 * (only the expenses attributed to themselves); a receptionist is rejected by the route gate. Writes live in expenseController.ts
 * and are owner-only. Nothing here trusts the client: clinicId and the doctor scope come from resolveDataScope (database identity).
 */

const intParam = (v: unknown, def: number, min: number, max: number) => {
  if (v === undefined || v === "") return def;
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isInteger(n) ? Math.min(Math.max(n, min), max) : def;
};

/** GET /api/expenses/ledger?from&to&category&kind=all|clinic|doctor|personal&doctorId&status&search&page&limit */
export const listLedger = asyncHandler(async (req: Request, res: Response) => {
  const scope = resolveDataScope(req, "expenses", req.query.doctorId);
  const filter = parseExpenseFilter(req.query);
  const result = await listExpenses(scope, filter, intParam(req.query.page, 1, 1, 100000), intParam(req.query.limit, 25, 1, 100));
  return res.json({ ...result, scope: { level: scope.level, doctorId: scope.doctorId ?? null } });
});

/** GET /api/expenses/summary — the same filters; totals / by category / by doctor (see services/expenseLedger.ts for the definitions). */
export const getSummary = asyncHandler(async (req: Request, res: Response) => {
  const scope = resolveDataScope(req, "expenses", req.query.doctorId);
  const filter = parseExpenseFilter(req.query);
  const summary = await summarizeExpenses(scope, filter);
  return res.json({ ...summary, scope: { level: scope.level, doctorId: scope.doctorId ?? null } });
});

/** GET /api/expenses/:id — a doctor gets 404 for anything that is not an expense attributed to them (same as an unknown id). */
export const getExpense = asyncHandler(async (req: Request, res: Response) => {
  const scope = resolveDataScope(req, "expenses");
  const row = await getExpenseInScope(scope, String(req.params.id));
  if (!row) return res.status(404).json({ message: "Expense not found" });
  return res.json(row);
});
