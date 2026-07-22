import { Router } from "express";
import rateLimit from "express-rate-limit";
import { adminLogin, adminMe } from "../controllers/adminAuthController";
import { requireAdmin } from "../middleware/adminAuth";
import {
  getDashboardStats,
  getGrowthStats,
  getPlansDistribution,
  getRevenueStats,
  listClinics,
  getClinicDetails,
  changeClinicPlan,
  extendClinicPlan,
  changeClinicStatus,
  deleteClinic,
  exportClinic,
  impersonateClinic,
  listUpgradeRequests,
  approveUpgradeRequest,
  rejectUpgradeRequest,
  listUsers,
  adminResetPassword,
  toggleUserActive,
  verifyUserEmailManually,
  getActivityLog,
  sendEmailToClinic,
  changeAdminPassword,
} from "../controllers/adminController";

const router = Router();

// Aggressive rate limit on login to slow down credential-stuffing attempts.
// The admin should never legitimately hit this limit.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again later." },
});

// Public admin login (no auth required to reach it, but it does its own auth)
router.post("/auth/login", loginLimiter, adminLogin);

// Everything below requires a valid admin JWT
router.use(requireAdmin);

// Session
router.get("/auth/me", adminMe);
router.post("/settings/change-password", changeAdminPassword);

// Dashboard
router.get("/stats", getDashboardStats);
router.get("/stats/growth", getGrowthStats);
router.get("/stats/plans", getPlansDistribution);
router.get("/stats/revenue", getRevenueStats);

// Clinics
router.get("/clinics", listClinics);
router.get("/clinics/:id", getClinicDetails);
router.patch("/clinics/:id/plan", changeClinicPlan);
router.patch("/clinics/:id/extend", extendClinicPlan);
router.patch("/clinics/:id/status", changeClinicStatus);
router.delete("/clinics/:id", deleteClinic);
router.get("/clinics/:id/export", exportClinic);
router.post("/clinics/:id/impersonate", impersonateClinic);

// Upgrade requests
router.get("/upgrade-requests", listUpgradeRequests);
router.post("/upgrade-requests/:id/approve", approveUpgradeRequest);
router.post("/upgrade-requests/:id/reject", rejectUpgradeRequest);

// Users
router.get("/users", listUsers);
router.post("/users/:id/reset-password", adminResetPassword);
router.patch("/users/:id/toggle-active", toggleUserActive);
router.patch("/users/:id/verify-email", verifyUserEmailManually);

// Activity log
router.get("/activity-log", getActivityLog);

// Email
router.post("/email/send", sendEmailToClinic);

export default router;
