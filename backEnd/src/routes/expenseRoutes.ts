import { Router } from "express";
import { protect, authorize, requireActivePlan } from "../middleware/auth";
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

/**
 * NEW ROUTES FILE — mounted at /api/expenses in index.ts.
 * Owner-only: the ledger holds the owner's personal expenses too.
 */
const router = Router();
router.use(protect);
router.use(authorize("owner"));
router.use(requireActivePlan);

router.get("/overview", getOverview);
router.get("/alerts", getAlerts);

// Monthly bills (entered once, repeat every month)
router.post("/recurring", createRecurring);
router.put("/recurring/:id", updateRecurring);
router.delete("/recurring/:id", deleteRecurring);
router.post("/recurring/:id/pay", payRecurring);
router.delete("/recurring/:id/pay/:period", unpayRecurring);

// One-time expenses
router.post("/", createExpense);
router.put("/:id", updateExpense);
router.post("/:id/pay", payExpense);
router.delete("/:id", deleteExpense);

export default router;
