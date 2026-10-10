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
  "lab", // PHASE 5 — external laboratory work (dental lab, pathology…), usually attributed to the treating doctor
  "materials", // PHASE 5 — consumable materials used on patients (composites, fillers, implants…)
  "software", // PHASE 5 — subscriptions / licences
  "equipment",
  "maintenance",
  "marketing",
  "fees", // licences, syndicate, government fees, taxes
  "insurance",
  "transport",
  "family", // owner's personal: household, kids, school...
  "other",
] as const;

/**
 * `scope` answers WHOSE MONEY it is: the clinic's business, or the owner's personal household money (which is never shown to
 * doctors / receptionists and never counts in clinic or doctor figures).
 * PHASE 5 adds a second, independent dimension for business expenses — `doctorId` (see models/Expense.ts):
 *   scope "clinic" + no doctor  = SHARED CLINIC expense (rent, electricity…; never split between doctors automatically)
 *   scope "clinic" + doctorId   = DOCTOR-ATTRIBUTED expense (lab work for Dr Ahmad…)
 *   scope "personal"            = owner's personal; can never carry a doctorId
 */
export const EXPENSE_SCOPES = ["clinic", "personal"] as const;
export const EXPENSE_METHODS = ["cash", "cliq", "card", "bank", "other"] as const;

/** Largest single amount accepted (JD) — same ceiling the tracker always had. */
export const MAX_EXPENSE_AMOUNT = 10_000_000;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpenseScope = (typeof EXPENSE_SCOPES)[number];
export type ExpenseMethod = (typeof EXPENSE_METHODS)[number];
