import { Router } from "express";
import { protect, requireActivePlan, requirePlanFeature } from "../middleware/auth";
import { monthlyReport } from "../controllers/reportsController";
import { requireAccess } from "../auth/policy";

const router = Router();
router.use(protect);
// PHASE 4 — analytics: owner (clinic-wide) and doctor (own data only). A receptionist has no reports access.
router.use(requireAccess("reports"));
router.use(requireActivePlan);
router.use(requirePlanFeature("reports"));
router.get("/monthly", monthlyReport);
export default router;
