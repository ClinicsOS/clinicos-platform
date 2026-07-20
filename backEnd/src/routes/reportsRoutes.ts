import { Router } from "express";
import { protect, requireActivePlan, requirePlanFeature } from "../middleware/auth";
import { monthlyReport } from "../controllers/reportsController";

const router = Router();
router.use(protect);
router.use(requireActivePlan);
router.use(requirePlanFeature("reports"));
router.get("/monthly", monthlyReport);
export default router;
