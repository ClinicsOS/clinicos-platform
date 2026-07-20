import { Router } from "express";
import { protect, requireActivePlan, requirePlanFeature } from "../middleware/auth";
import { createInvoice, listInvoices, addPayment } from "../controllers/invoiceController";

const router = Router();
router.use(protect);
router.use(requireActivePlan);
router.use(requirePlanFeature("invoicing"));

router.get("/", listInvoices);
router.post("/", createInvoice);
router.post("/:id/payments", addPayment);
export default router;
