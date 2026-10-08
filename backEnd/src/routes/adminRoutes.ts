import { Router } from "express";
import rateLimit from "express-rate-limit";
import { adminLogin, adminMe, adminVerifyTotp } from "../controllers/adminAuthController";
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
  addClinicNote,
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
  setupTotp,
  verifyTotpSetup,
} from "../controllers/adminController";
import {
  listClinicAddons,
  activateAddon,
  updateAddon,
  suspendAddon,
  reactivateAddon,
  cancelAddon,
} from "../controllers/adminAddonController";

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
// Second step of login when 2FA is configured — also public (the caller
// doesn't have a full admin token yet), but protected by the same limiter
// plus the short-lived pendingToken + 6-digit code.
router.post("/auth/verify-totp", loginLimiter, adminVerifyTotp);

// Everything below requires a valid admin JWT
router.use(requireAdmin);

// Session
router.get("/auth/me", adminMe);
router.post("/settings/change-password", changeAdminPassword);
router.get("/settings/totp/setup", setupTotp);
router.post("/settings/totp/verify", verifyTotpSetup);

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
router.post("/clinics/:id/notes", addClinicNote);

// Paid add-ons (e.g. ClinicOS Loyalty) — platform-admin-only entitlement lifecycle.
// Nothing here is reachable with a clinic (owner / doctor / receptionist) token.
router.get("/clinics/:id/addons", listClinicAddons);
router.post("/clinics/:id/addons/:addonId/activate", activateAddon);
router.patch("/clinics/:id/addons/:addonId", updateAddon);
router.post("/clinics/:id/addons/:addonId/suspend", suspendAddon);
router.post("/clinics/:id/addons/:addonId/reactivate", reactivateAddon);
router.post("/clinics/:id/addons/:addonId/cancel", cancelAddon);

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
