import { Router } from "express";
import { protect, authorize, requireActivePlan } from "../middleware/auth";
import { createStaff, listStaff, toggleActive, editStaff, setDoctorWorkingHours } from "../controllers/userController";

const router = Router();
router.use(protect);
router.get("/", listStaff);
router.post("/", requireActivePlan, authorize("owner"), createStaff);
router.patch("/:id", requireActivePlan, authorize("owner"), editStaff);
router.put("/:id/working-hours", requireActivePlan, authorize("owner"), setDoctorWorkingHours);
router.patch("/:id/active", requireActivePlan, authorize("owner"), toggleActive);
export default router;
