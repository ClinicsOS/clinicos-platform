import { Router } from "express";
import { protect, authorize, requireActivePlan, requirePlanFeature } from "../middleware/auth";
import { requireSpecialty } from "../middleware/requireSpecialty";
import { DENTAL_SPECIALTY_ID } from "../config/dental";
import {
  getRecord,
  getToothHistory,
  setDentition,
  setCurrentTeeth,
  addExistingCondition,
  addDiagnosis,
  resolveEvent,
} from "../controllers/dentalController";
import { invoiceTreatment } from "../controllers/dentalBillingController";
import { getDentalDashboard } from "../controllers/dentalDashboardController";
import { getDentalReport } from "../controllers/dentalReportController";
import {
  getTreatmentPlan, getVisitTreatments, createItem, updateItem, setPhases, cancelItem, startItem, finishSession, completeItem, updateSessionNotes,
} from "../controllers/dentalTreatmentController";

const router = Router();

// 1) authenticate  2) clinic must be a dentistry clinic (server-side, from the DB)
router.use(protect);
router.use(requireSpecialty(DENTAL_SPECIALTY_ID));

// Reads: any authenticated role of the clinic.
router.get("/dashboard", getDentalDashboard);
router.get("/patients/:patientId/report", getDentalReport);
router.get("/patients/:patientId/record", getRecord);
router.get("/patients/:patientId/teeth/:fdi/history", getToothHistory);

// Clinical writes: active plan + clinician roles only (same order as userRoutes).
router.put("/patients/:patientId/dentition", requireActivePlan, authorize("owner", "doctor"), setDentition);
router.put("/patients/:patientId/current-teeth", requireActivePlan, authorize("owner", "doctor"), setCurrentTeeth);
router.post("/patients/:patientId/teeth/:fdi/conditions", requireActivePlan, authorize("owner", "doctor"), addExistingCondition);
router.post("/patients/:patientId/teeth/:fdi/diagnoses", requireActivePlan, authorize("owner", "doctor"), addDiagnosis);
router.post("/patients/:patientId/events/:eventId/resolve", requireActivePlan, authorize("owner", "doctor"), resolveEvent);

// ---- Treatment plan / procedures (Phase 3). Same guards: reads = any role of the clinic; clinical writes = owner/doctor.
router.get("/patients/:patientId/treatment-plan", getTreatmentPlan);
router.get("/patients/:patientId/visits/:appointmentId/treatments", getVisitTreatments);
const clinical = [requireActivePlan, authorize("owner", "doctor")];
router.post("/patients/:patientId/treatment-plan/items", ...clinical, createItem);
router.put("/patients/:patientId/treatment-plan/items/:itemId", ...clinical, updateItem);
router.put("/patients/:patientId/treatment-plan/phases", ...clinical, setPhases);
router.post("/patients/:patientId/treatment-plan/items/:itemId/cancel", ...clinical, cancelItem);
router.post("/patients/:patientId/treatment-plan/items/:itemId/start", ...clinical, startItem);
router.post("/patients/:patientId/treatment-plan/items/:itemId/finish-session", ...clinical, finishSession);
router.post("/patients/:patientId/treatment-plan/items/:itemId/complete", ...clinical, completeItem);
router.put("/patients/:patientId/treatment-sessions/:sessionId/notes", ...clinical, updateSessionNotes);

// ---- Financial (Phase 4). FINANCIAL permission = exactly what the invoice routes require (active plan + invoicing
// feature; no role restriction there), NOT the clinical owner/doctor rule. Dentistry-only comes from the router.
router.post("/patients/:patientId/treatment-plan/items/:itemId/invoice", requireActivePlan, requirePlanFeature("invoicing"), invoiceTreatment);

export default router;
