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
// Full PHI dump (every patient, note, appointment, invoice) — restrict to the
// clinic owner, matching the update/delete guards on the same resource.
router.get("/export", authorize("owner"), exportMyClinic);
router.delete("/", authorize("owner"), deleteMyClinic);
export default router;
