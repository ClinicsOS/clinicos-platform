import { Router } from "express";
import { protect, requireActivePlan, requirePlanFeature } from "../middleware/auth";
import { requireAccess } from "../auth/policy";
import {
  createInvoice,
  updateInvoice,
  listInvoices,
  addPayment,
  listDeletedInvoices,
  deleteInvoice,
  restoreInvoice,
  permanentDeleteInvoice,
} from "../controllers/invoiceController";

const router = Router();
router.use(protect);
router.use(requireAccess("invoices")); // PHASE 4 — row-level scope (a doctor sees only their own) is applied in the controller via resolveDataScope
router.use(requireActivePlan);
router.use(requirePlanFeature("invoicing"));

router.get("/", listInvoices);
router.post("/", createInvoice);
router.put("/:id", updateInvoice);
router.post("/:id/payments", addPayment);

// PHASE 2 — deletion lifecycle. Each route is gated by its own resource (receptionist: 403); row scope (a doctor: own invoices) is applied in the
// controller / lifecycle service. No two of these routes can shadow each other (different verb or different number of path segments).
router.get("/deleted", requireAccess("invoicesDelete"), listDeletedInvoices);
router.delete("/:id/permanent", requireAccess("invoicesPurge"), permanentDeleteInvoice);
router.patch("/:id/restore", requireAccess("invoicesDelete"), restoreInvoice);
router.delete("/:id", requireAccess("invoicesDelete"), deleteInvoice);
export default router;
