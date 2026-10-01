import { Router } from "express";
import { protect, authorize, requireActivePlan, requirePlanFeature } from "../middleware/auth";
import { requireSpecialty } from "../middleware/requireSpecialty";
import { DERM_SPECIALTY_ID } from "../config/dermatology";
import {
  getMap,
  listAssessments,
  createAssessment,
  editAssessment,
  voidAssessment,
} from "../controllers/dermController";
import {
  getTreatmentPlan, createItem, updateItem, setPhases, cancelItem, startItem, updateSession, endSession, completeItem,
} from "../controllers/dermTreatmentController";
import { createFollowUp, listFollowUps, editFollowUp, voidFollowUp } from "../controllers/dermFollowUpController";
import { getTimeline, getPatientOverview } from "../controllers/dermTimelineController";
import { getDermDashboard } from "../controllers/dermDashboardController";
import { invoiceDermTreatment } from "../controllers/dermBillingController";
import { getDermReport } from "../controllers/dermReportController";

const router = Router();

// 1) authenticate  2) clinic must be a Dermatology & Aesthetics clinic (server-side, read fresh from the DB)
router.use(protect);
router.use(requireSpecialty(DERM_SPECIALTY_ID));

// Reads: any authenticated role of the clinic (same visibility rule as the Dentistry module).
router.get("/patients/:patientId/map", getMap);
router.get("/patients/:patientId/assessments", listAssessments);

// Clinical writes: active plan + clinician roles only (same order as dentalRoutes / userRoutes).
const clinical = [requireActivePlan, authorize("owner", "doctor")];
router.post("/patients/:patientId/assessments", ...clinical, createAssessment);
router.patch("/patients/:patientId/assessments/:assessmentId", ...clinical, editAssessment);
router.post("/patients/:patientId/assessments/:assessmentId/void", ...clinical, voidAssessment);

// ---------------------------------------------------------------- Phase 2: Treatment Plan / Sessions / Follow-Up / Timeline
// Reads: any authenticated role of the clinic (dermatology-only comes from the router-level guard above).
router.get("/dashboard", getDermDashboard);
router.get("/patients/:patientId/overview", getPatientOverview);
router.get("/patients/:patientId/timeline", getTimeline);
router.get("/patients/:patientId/treatment-plan", getTreatmentPlan);
router.get("/patients/:patientId/follow-ups", listFollowUps);
// ---------------------------------------------------------------- Phase 3: printable reports (read-only; financial section is gated inside)
router.get("/patients/:patientId/report", getDermReport);

// Clinical writes: active plan + owner/doctor (the same `clinical` chain as Phase 1 — no second permission system).
router.post("/patients/:patientId/treatment-plan/items", ...clinical, createItem);
router.put("/patients/:patientId/treatment-plan/items/:itemId", ...clinical, updateItem);
router.put("/patients/:patientId/treatment-plan/phases", ...clinical, setPhases);
router.post("/patients/:patientId/treatment-plan/items/:itemId/cancel", ...clinical, cancelItem);
router.post("/patients/:patientId/treatment-plan/items/:itemId/start", ...clinical, startItem);
router.post("/patients/:patientId/treatment-plan/items/:itemId/end-session", ...clinical, endSession);
router.post("/patients/:patientId/treatment-plan/items/:itemId/complete", ...clinical, completeItem);
router.put("/patients/:patientId/treatment-sessions/:sessionId", ...clinical, updateSession);
router.post("/patients/:patientId/follow-ups", ...clinical, createFollowUp);
router.patch("/patients/:patientId/follow-ups/:followUpId", ...clinical, editFollowUp);
router.post("/patients/:patientId/follow-ups/:followUpId/void", ...clinical, voidFollowUp);

// Financial: EXACTLY what the invoice routes require (active plan + invoicing feature; no role restriction there) —
// clinical permission neither is required nor implies it. There is no second financial system.
router.post("/patients/:patientId/treatment-plan/items/:itemId/invoice", requireActivePlan, requirePlanFeature("invoicing"), invoiceDermTreatment);

export default router;
