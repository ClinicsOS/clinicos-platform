import { Router } from "express";
import { protect, requireActivePlan, authorize } from "../middleware/auth";
import { requireAccess } from "../auth/policy";
import {
  createPatient,
  listPatients,
  getPatient,
  updatePatient,
} from "../controllers/patientController";

import { listNotes, createNote, updateNote, listRevisions } from "../controllers/clinicalNoteController";
import { getClinicalTimeline } from "../controllers/clinicalTimelineController";

const router = Router();
router.use(protect);
router.get("/", listPatients);
router.get("/:id", getPatient);
// ---- Clinical record (Phase 3). Reads: any role of the clinic (same as the patient file). Writes: active plan + owner/doctor
// (the same clinical-write rule as the dental routes). Every handler re-loads the patient with the caller's clinicId.
router.get("/:id/clinical-timeline", getClinicalTimeline);
router.get("/:id/clinical-notes", listNotes);
router.get("/:id/clinical-notes/:noteId/revisions", listRevisions);
router.post("/:id/clinical-notes", requireActivePlan, requireAccess("clinicalWrite"), createNote);
router.put("/:id/clinical-notes/:noteId", requireActivePlan, requireAccess("clinicalWrite"), updateNote);

router.post("/", requireActivePlan, createPatient);
router.patch("/:id", requireActivePlan, updatePatient); // NEW — edit patient file
export default router;
