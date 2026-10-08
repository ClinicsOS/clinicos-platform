import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getPublicInfo, identify, getMe, getActivity } from "../controllers/loyaltyPublicController";
import { getCheckIn, createCheckIn, cancelCheckIn } from "../controllers/loyaltyCheckInPublicController";
import { getMemberRewards, redeemReward } from "../controllers/loyaltyRewardsPublicController";
import { verifyPublicToken } from "../services/loyaltyPublic";
import { PUBLIC_LOYALTY, CHECKIN, REDEMPTION } from "../config/loyalty";

/**
 * Public patient Loyalty — mounted at /api/public/loyalty (BEFORE the generic /api/public router).
 * No authentication middleware by design: access is the Loyalty-only session token checked inside the controller.
 * It can never reach a clinic-user API, and none of these routes can create or change points.
 */
const router = Router();

const limitMsg = { message: "Too many requests, please try again shortly", code: "RATE_LIMITED" };

// Phone identification: the sensitive one. Phase 10 layers three limits (all in-memory, per server process):
//  1. FAILED attempts only, per IP (across clinics)      — what guessing numbers costs; a patient who gets in is never counted;
//  2. FAILED attempts only, per clinic + IP              — a tighter bucket inside one clinic's public page;
//  3. EVERY attempt, per IP                              — a hard ceiling that still leaves a shared clinic Wi-Fi plenty of room.
// (Repeated failures for the SAME number are throttled separately in the controller.) A success is any status < 400.
const identifyFailLimiter = rateLimit({
  windowMs: PUBLIC_LOYALTY.identifyWindowMs,
  max: PUBLIC_LOYALTY.identifyMaxPerIp,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMsg,
});
const identifyClinicFailLimiter = rateLimit({
  windowMs: PUBLIC_LOYALTY.identifyWindowMs,
  max: PUBLIC_LOYALTY.identifyMaxFailsPerClinicIp,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${String(req.params.slug ?? "").slice(0, 80)}|${req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMsg,
});
const identifyAttemptLimiter = rateLimit({
  windowMs: PUBLIC_LOYALTY.identifyWindowMs,
  max: PUBLIC_LOYALTY.identifyMaxAttemptsPerIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMsg,
});
// Reads with a session: generous enough for a normal visit, still bounded.
const readLimiter = rateLimit({
  windowMs: PUBLIC_LOYALTY.readWindowMs,
  max: PUBLIC_LOYALTY.readMaxPerIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMsg,
});

// Check-in (Phase 5). Keyed by the MEMBER'S session (falls back to IP when there is no valid session), not by IP alone:
// a clinic's patients share one Wi-Fi address, and a waiting room must not rate-limit itself.
const sessionKey = (req: import("express").Request) => {
  const raw = req.headers.authorization;
  const s = raw?.startsWith("Bearer ") ? verifyPublicToken(raw.slice(7)) : null;
  return s ? `acc:${s.accountId}` : `ip:${req.ip}`;
};
const checkInRequestLimiter = rateLimit({ windowMs: CHECKIN.requestWindowMs, max: CHECKIN.requestMaxPerKey, keyGenerator: sessionKey, standardHeaders: true, legacyHeaders: false, message: limitMsg });
const checkInStatusLimiter = rateLimit({ windowMs: CHECKIN.statusWindowMs, max: CHECKIN.statusMaxPerKey, keyGenerator: sessionKey, standardHeaders: true, legacyHeaders: false, message: limitMsg });

router.get("/:slug", readLimiter, getPublicInfo);
router.post("/:slug/identify", identifyAttemptLimiter, identifyFailLimiter, identifyClinicFailLimiter, identify);
router.get("/:slug/me", readLimiter, getMe);
router.get("/:slug/activity", readLimiter, getActivity);
const rewardsReadLimiter = rateLimit({ windowMs: REDEMPTION.readWindowMs, max: REDEMPTION.readMaxPerKey, keyGenerator: sessionKey, standardHeaders: true, legacyHeaders: false, message: limitMsg });
const rewardsRequestLimiter = rateLimit({ windowMs: REDEMPTION.requestWindowMs, max: REDEMPTION.requestMaxPerKey, keyGenerator: sessionKey, standardHeaders: true, legacyHeaders: false, message: limitMsg });
// Rewards (Phase 6, temporary minimal patient side): list what I can redeem, and ask for one (a PENDING request — never points).
router.get("/:slug/rewards", rewardsReadLimiter, getMemberRewards);
router.post("/:slug/rewards/:rewardId/redeem", rewardsRequestLimiter, redeemReward);
router.get("/:slug/checkin", checkInStatusLimiter, getCheckIn);
router.post("/:slug/checkin", checkInRequestLimiter, createCheckIn);
router.post("/:slug/checkin/cancel", checkInRequestLimiter, cancelCheckIn);

export default router;
