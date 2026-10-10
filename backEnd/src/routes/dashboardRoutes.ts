import { Router } from "express";
import { protect } from "../middleware/auth";
import { requireAccess } from "../auth/policy";
import { getStats } from "../controllers/dashboardController";

const router = Router();
router.use(protect);
router.use(requireAccess("dashboardCounts"));
router.get("/stats", getStats);
export default router;
