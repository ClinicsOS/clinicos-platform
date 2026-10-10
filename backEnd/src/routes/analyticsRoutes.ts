import { Router } from "express";
import { protect, requireActivePlan, requirePlanFeature } from "../middleware/auth";
import { requireAccess } from "../auth/policy";
import { requireAddon } from "../services/addons";
import { section, meta, exportSection } from "../controllers/analyticsController";

/**
 * PHASE 6 — Analytics Center API.
 *   protect → requireAccess("reports")  (owner: clinic · doctor: own data · receptionist: 403 — Phase 4 stays exactly as it was)
 *   → requireActivePlan → requirePlanFeature("reports")  (the same plan gate the old Reports page had)
 *   Clinic-wide-only material (loyalty) additionally needs requireAccess("reportsClinic") — a doctor gets 403 — and the paid add-on.
 */
const router = Router();
router.use(protect);
router.use(requireAccess("reports"));
router.use(requireActivePlan);
router.use(requirePlanFeature("reports"));

router.get("/meta", meta);
router.get("/overview", section("overview"));
router.get("/financial", section("financial"));
router.get("/appointments", section("appointments"));
router.get("/patients", section("patients"));
router.get("/treatments", section("treatments"));
router.get("/doctors", section("doctors"));
router.get("/expenses", section("expenses"));
router.get("/loyalty", requireAccess("reportsClinic"), requireAddon("loyalty"), section("loyalty"));
router.get("/export", exportSection);

export default router;
