import { Router } from "express";
import { protect, authorize } from "../middleware/auth";
import { getSubscription, requestUpgrade } from "../controllers/subscriptionController";

const router = Router();
router.use(protect);
router.get("/", getSubscription);
router.post("/upgrade", authorize("owner"), requestUpgrade);
export default router;
