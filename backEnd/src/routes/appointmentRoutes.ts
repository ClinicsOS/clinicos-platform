import { Router } from "express";
import { protect, requireActivePlan } from "../middleware/auth";
import { createAppointment, listAppointments, updateStatus, markRead, markAllRead } from "../controllers/appointmentController";

const router = Router();
router.use(protect);
router.get("/", listAppointments);
router.post("/", requireActivePlan, createAppointment);
router.patch("/read-all", markAllRead);
router.patch("/:id/status", requireActivePlan, updateStatus);
router.patch("/:id/read", markRead);
export default router;
