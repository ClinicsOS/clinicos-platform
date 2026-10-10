import { Router } from "express";
import { protect, requireActivePlan } from "../middleware/auth";
import { requireAccess } from "../auth/policy";
import {
  getOverview,
  getAlerts,
  createRecurring,
  updateRecurring,
  deleteRecurring,
  payRecurring,
  unpayRecurring,
  createExpense,
  updateExpense,
  payExpense,
  deleteExpense,
} from "../controllers/expenseController";
import { listLedger, getSummary, getExpense } from "../controllers/expenseLedgerController";

/**
 * Mounted at /api/expenses in index.ts.
 *
 * PHASE 5 access model (auth/policy.ts):
 *   "expenses"        READ the ledger        owner: whole clinic · doctor: only expenses attributed to them · receptionist: 403
 *   "expensesManage"  everything else        owner only (create / edit / delete / bills / the owner's personal expenses / month overview)
 * The row-level doctor scope is applied in the controller via resolveDataScope — never from anything the client sends.
 */
const router = Router();
router.use(protect);
router.use(requireAccess("expenses")); // receptionist (and any unknown role) stops here with 403
router.use(requireActivePlan);

// ---- read: owner + doctor (scoped) ----
router.get("/ledger", listLedger);
router.get("/summary", getSummary);

// ---- owner only ----
const manage = requireAccess("expensesManage");
router.get("/overview", manage, getOverview);
router.get("/alerts", manage, getAlerts);

// Monthly bills (entered once, repeat every month)
router.post("/recurring", manage, createRecurring);
router.put("/recurring/:id", manage, updateRecurring);
router.delete("/recurring/:id", manage, deleteRecurring);
router.post("/recurring/:id/pay", manage, payRecurring);
router.delete("/recurring/:id/pay/:period", manage, unpayRecurring);

// One-time expenses
router.post("/", manage, createExpense);
router.put("/:id", manage, updateExpense);
router.post("/:id/pay", manage, payExpense);
router.delete("/:id", manage, deleteExpense);

// ---- read one (declared last so it never shadows /ledger, /summary, /overview, /alerts) ----
router.get("/:id", getExpense);

export default router;
