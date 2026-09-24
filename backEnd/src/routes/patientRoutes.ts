import { Router } from "express";
import { protect, requireActivePlan } from "../middleware/auth";
import {
  createPatient,
  listPatients,
  getPatient,
  updatePatient,
} from "../controllers/patientController";

const router = Router();
router.use(protect);
router.get("/", listPatients);
router.get("/:id", getPatient);
router.post("/", requireActivePlan, createPatient);
router.patch("/:id", requireActivePlan, updatePatient); // NEW — edit patient file
export default router;
