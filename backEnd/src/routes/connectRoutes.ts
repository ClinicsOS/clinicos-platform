import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { protect, requireActivePlan, requirePlanFeature } from "../middleware/auth";
import { requireAccess } from "../auth/policy";
import { asyncHandler } from "../middleware/errorHandler";
import { CONNECT_LIMITS } from "../config/connect";
import {
  getConversations,
  getTeam,
  getUnreadCount,
  openDirect,
  getConversation,
  getMessages,
  postMessage,
  postRead,
  postCards,
  getPatientPicker,
  getAppointmentPicker,
} from "../controllers/connectController";

/**
 * CLINICOS CONNECT (C1) — internal staff chat. Mounted at /api/connect (index.ts adds Cache-Control: no-store).
 *
 * EVERY route runs, in this order (the gate cannot be skipped by guessing a URL — it is router-level):
 *   1. protect                          — a signed-in, ACTIVE staff member; clinic + role come from their database record
 *   2. requireAccess("internalChat")    — the central role matrix (auth/policy.ts); all three roles
 *   3. requireActivePlan                — suspended / expired clinic → 402 SUSPENDED / EXPIRED (same as every other module)
 *   4. requirePlanFeature("internalChat") — the PRO entitlement from config/plans.ts → 402 PLAN_LIMIT { feature: "internalChat" }
 * Which conversation a user may touch is then decided per request by MEMBERSHIP (services/connect/conversations.ts), not by role.
 */
const router = Router();
router.use(protect);
router.use(requireAccess("internalChat"));
router.use(asyncHandler(requireActivePlan));
router.use(asyncHandler(requirePlanFeature("internalChat")));

// per-USER abuse ceilings (same pattern as the Loyalty staff routes); `protect` has already run, so req.userId is verified
const userKey = (req: Request) => (req.userId ? `u:${req.userId}` : `ip:${req.ip}`);
const limiter = (max: number) =>
  rateLimit({
    windowMs: CONNECT_LIMITS.windowMs,
    max,
    keyGenerator: userKey,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => res.status(429).json({ message: "Too many requests, please slow down and try again shortly", code: "RATE_LIMITED" }),
  });
const sendLimiter = limiter(CONNECT_LIMITS.sendMax);
const openLimiter = limiter(CONNECT_LIMITS.openMax);
const readLimiter = limiter(CONNECT_LIMITS.readMax);

router.get("/team", getTeam);
router.get("/unread-count", getUnreadCount);
router.get("/conversations", getConversations);
router.post("/conversations/direct", openLimiter, openDirect);
router.get("/conversations/:id", getConversation);
router.get("/conversations/:id/messages", getMessages);
router.post("/conversations/:id/messages", sendLimiter, postMessage);
router.post("/conversations/:id/read", readLimiter, postRead);
// C4 — Appointment / Patient cards. Behind the same four gates as everything above (router-level), so a non-PRO clinic gets the 402 here too.
router.post("/conversations/:id/cards", readLimiter, postCards);
router.get("/pickers/patients", readLimiter, getPatientPicker);
router.get("/pickers/appointments", readLimiter, getAppointmentPicker);

export default router;
