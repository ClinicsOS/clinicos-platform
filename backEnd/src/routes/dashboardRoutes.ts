import { Router } from "express";
import { protect } from "../middleware/auth";
import { getStats } from "../controllers/dashboardController";

const router = Router();
router.use(protect);
router.get("/stats", getStats);
export default router;
