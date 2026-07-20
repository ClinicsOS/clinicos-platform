import { Router } from "express";
import { protect, authorize } from "../middleware/auth";
import {
  getMyClinic,
  updateMyClinic,
  deleteMyClinic,
  exportMyClinic,
} from "../controllers/clinicController";

const router = Router();
router.use(protect);
router.get("/", getMyClinic);
router.patch("/", authorize("owner"), updateMyClinic);
router.get("/export", exportMyClinic);
router.delete("/", authorize("owner"), deleteMyClinic);
export default router;
