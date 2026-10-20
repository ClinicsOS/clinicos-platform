import { Router } from "express";
import { protect, requireActivePlan } from "../middleware/auth";
import { getDelegations, postDelegation, postRevokeDelegation, getDoctorPatients, postAssign, postUnassign } from "../controllers/patientAccessController";

/**
 * PHASE 1 — doctor coverage (delegation) and patient assignment. See controllers/patientAccessController.ts.
 * Reads: owner + doctor. Writes: owner only (enforced in the controller with the policy matrix) and an active plan.
 */
const router = Router();
router.use(protect);
router.get("/delegations", getDelegations);
router.post("/delegations", requireActivePlan, postDelegation);
router.post("/delegations/:id/revoke", requireActivePlan, postRevokeDelegation);
router.get("/doctors/:doctorId/patients", getDoctorPatients);
router.post("/assign", requireActivePlan, postAssign);
router.post("/unassign", requireActivePlan, postUnassign);
export default router;
