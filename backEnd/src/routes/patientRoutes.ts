import { Router } from "express";
import { protect, requireActivePlan } from "../middleware/auth";
import { createPatient, listPatients, getPatient } from "../controllers/patientController";

const router = Router();
router.use(protect);
router.get("/", listPatients);
router.get("/:id", getPatient);
router.post("/", requireActivePlan, createPatient);
export default router;
