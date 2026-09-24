/**
 * NEW FILE — shared constants for the clinic / owner expense tracker.
 * Keep in sync with frontEnd/src/lib/expenses.ts
 */
export const EXPENSE_CATEGORIES = [
  "rent",
  "internet",
  "utilities", // electricity / water
  "salaries",
  "supplies", // medical & dental supplies
  "equipment",
  "maintenance",
  "marketing",
  "fees", // licences, syndicate, government fees, taxes
  "insurance",
  "transport",
  "family", // owner's personal: household, kids, school...
  "other",
] as const;

export const EXPENSE_SCOPES = ["clinic", "personal"] as const;
export const EXPENSE_METHODS = ["cash", "cliq", "card", "bank", "other"] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpenseScope = (typeof EXPENSE_SCOPES)[number];
export type ExpenseMethod = (typeof EXPENSE_METHODS)[number];
