import { Router } from "express";
import { protect, requireActivePlan } from "../middleware/auth";
import { createAppointment, createBlock, listAppointments, updateAppointment, markRead, markAllRead } from "../controllers/appointmentController";

const router = Router();
router.use(protect);
router.get("/", listAppointments);
router.post("/", requireActivePlan, createAppointment);
router.post("/block", requireActivePlan, createBlock);
router.patch("/read-all", markAllRead);
router.patch("/:id/status", requireActivePlan, updateAppointment);
router.patch("/:id/read", markRead);
export default router;
