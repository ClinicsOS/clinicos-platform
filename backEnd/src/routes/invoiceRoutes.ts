import { Router } from "express";
import { protect, requireActivePlan, requirePlanFeature } from "../middleware/auth";
import { requireAccess } from "../auth/policy";
import { createInvoice, updateInvoice, listInvoices, addPayment } from "../controllers/invoiceController";

const router = Router();
router.use(protect);
router.use(requireAccess("invoices")); // PHASE 4 — row-level scope (a doctor sees only their own) is applied in the controller via resolveDataScope
router.use(requireActivePlan);
router.use(requirePlanFeature("invoicing"));

router.get("/", listInvoices);
router.post("/", createInvoice);
router.put("/:id", updateInvoice);
router.post("/:id/payments", addPayment);
export default router;
