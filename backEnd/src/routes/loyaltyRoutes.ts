import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { protect, authorize, requireActivePlan } from "../middleware/auth";
import { requireAddon } from "../services/addons";
import { LOYALTY_ROLES, STAFF_LIMITS } from "../config/loyalty";
import {
  getLoyaltySettings,
  patchLoyaltySettings,
  getOverview,
  listMembers,
  getMember,
  listMemberTransactions,
  listTransactions,
  enrollMember,
  adjustMemberPoints,
} from "../controllers/loyaltyController";
import { getCheckInSummary, listCheckIns, confirmCheckIn, rejectCheckIn } from "../controllers/loyaltyCheckInController";
import {
  listRewardsHandler,
  rewardsSummaryHandler,
  pendingCountHandler,
  getRewardHandler,
  createRewardHandler,
  updateRewardHandler,
  activateRewardHandler,
  deactivateRewardHandler,
  deleteRewardHandler,
  listRedemptionsHandler,
  confirmRedemptionHandler,
  rejectRedemptionHandler,
  reverseRedemptionHandler,
} from "../controllers/loyaltyRewardsController";

import { getTiersConfig, putTiersConfig, previewTiers, recalculateTiers, getTiersAnalytics, getTiersHistory } from "../controllers/loyaltyTiersController";
import { getActivity, getAnalytics, getMemberInsights } from "../controllers/loyaltyInsightsController";

/**
 * ClinicOS Loyalty — clinic-facing API (Phase 2).
 *
 * Every route requires, in order:
 *   1. protect              — a signed-in clinic user (clinic derived from the user, never from the client)
 *   2. requireAddon         — the ACTIVE paid Loyalty add-on (Phase 1 entitlement; also denies for a suspended/expired account)
 *   3. authorize(...roles)  — see LOYALTY_ROLES in config/loyalty.ts
 * Writes additionally run `requireActivePlan` first, exactly like the patient/invoice write routes.
 *
 * There is no route that edits or deletes a transaction. The only way to change a balance by hand is
 * POST /members/:id/adjust (owner / doctor, mandatory reason, immutable ledger row). Automatic earning is NOT a route:
 * it runs from the appointment / payment hooks in services/loyaltyPoints.ts.
 * Check-in requests (Phase 5) are answered at /checkins — an arrival record only, never points.
 * Tiers (Phase 7): /tiers/config (view all, edit owner / doctor), /tiers/analytics, /tiers/history, /tiers/preview, /tiers/recalculate.
 * Insights (Phase 8, read-only): /activity (live activity stream) and /analytics (per-day counts / sums) — real stored records only.
 * Rewards + redemptions (Phase 6): /rewards (catalog; owner / doctor manage, reception views) and /redemptions (queue + history;
 * reception may confirm / reject, only owner / doctor may reverse). Confirm / reverse move points ONLY through the central ledger.
 */
const router = Router();
router.use(protect);

// Phase 10 — per-USER abuse ceilings on every state-changing route (see STAFF_LIMITS). `protect` has already run, so `req.userId` is the
// verified user; a request without one (cannot happen here) falls back to the IP. Responses carry no internals.
const staffKey = (req: Request) => (req.userId ? `u:${req.userId}` : `ip:${req.ip}`);
const staffMsg = { message: "Too many requests, please slow down and try again shortly", code: "RATE_LIMITED" };
const staffLimiter = (max: number) =>
  rateLimit({
    windowMs: STAFF_LIMITS.windowMs,
    max,
    keyGenerator: staffKey,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req: Request, res: Response) => res.status(429).json(staffMsg),
  });
const writeLimiter = staffLimiter(STAFF_LIMITS.writeMax);
const sensitiveLimiter = staffLimiter(STAFF_LIMITS.sensitiveMax);

const read = [requireAddon("loyalty"), authorize(...LOYALTY_ROLES.read)];
const write = (roles: readonly ("owner" | "doctor" | "receptionist")[]) => [writeLimiter, requireActivePlan, requireAddon("loyalty"), authorize(...roles)];
/** Same as `write`, plus a tighter ceiling for manual adjustment, reward / tier / settings changes, reversal and recalculation. */
const sensitive = (roles: readonly ("owner" | "doctor" | "receptionist")[]) => [writeLimiter, sensitiveLimiter, requireActivePlan, requireAddon("loyalty"), authorize(...roles)];

router.get("/overview", ...read, getOverview);
router.get("/settings", ...read, getLoyaltySettings);
router.patch("/settings", ...sensitive(LOYALTY_ROLES.configure), patchLoyaltySettings);

router.get("/members", ...read, listMembers);
router.post("/members", ...write(LOYALTY_ROLES.enroll), enrollMember);
router.get("/members/:id", ...read, getMember);
// Manual credit/debit (owner, doctor only — LOYALTY_ROLES.adjust). Central service, mandatory reason, immutable ledger row.
router.post("/members/:id/adjust", ...sensitive(LOYALTY_ROLES.adjust), adjustMemberPoints);
router.get("/members/:id/transactions", ...read, listMemberTransactions);

router.get("/transactions", ...read, listTransactions);

// Insights (Phase 8): read-only, computed from stored records. Same access as the rest of Loyalty reading.
router.get("/activity", ...read, getActivity);
router.get("/analytics", ...read, getAnalytics);
router.get("/members/:id/insights", ...read, getMemberInsights);

// Patient check-in (Phase 5): reception sees the pending queue and confirms / rejects. No points, no appointment change.
// Reading history stays available even if the clinic later turns check-in off; new requests are blocked by the public API.
const checkinRead = [requireAddon("loyalty"), authorize(...LOYALTY_ROLES.checkin)];
router.get("/checkins/summary", ...checkinRead, getCheckInSummary);
router.get("/checkins", ...checkinRead, listCheckIns);
router.post("/checkins/:id/confirm", ...write(LOYALTY_ROLES.checkin), confirmCheckIn);
router.post("/checkins/:id/reject", ...write(LOYALTY_ROLES.checkin), rejectCheckIn);

// Rewards (Phase 6). Everyone who may read Loyalty can see the catalog; only owner / doctor change it.
router.get("/rewards", ...read, listRewardsHandler);
router.get("/rewards/summary", ...read, rewardsSummaryHandler);
router.get("/rewards/pending-count", ...read, pendingCountHandler);
router.post("/rewards", ...sensitive(LOYALTY_ROLES.rewardsManage), createRewardHandler);
router.get("/rewards/:id", ...read, getRewardHandler);
router.patch("/rewards/:id", ...sensitive(LOYALTY_ROLES.rewardsManage), updateRewardHandler);
router.post("/rewards/:id/activate", ...sensitive(LOYALTY_ROLES.rewardsManage), activateRewardHandler);
router.post("/rewards/:id/deactivate", ...sensitive(LOYALTY_ROLES.rewardsManage), deactivateRewardHandler);
router.delete("/rewards/:id", ...sensitive(LOYALTY_ROLES.rewardsManage), deleteRewardHandler);

// Redemptions (Phase 6): queue + history; confirm deducts through the ledger; reverse appends a NEW credit row.
router.get("/redemptions", ...read, listRedemptionsHandler);
router.post("/redemptions/:id/confirm", ...write(LOYALTY_ROLES.redemptionResolve), confirmRedemptionHandler);
router.post("/redemptions/:id/reject", ...write(LOYALTY_ROLES.redemptionResolve), rejectRedemptionHandler);
router.post("/redemptions/:id/reverse", ...sensitive(LOYALTY_ROLES.redemptionReverse), reverseRedemptionHandler);

// Tiers (Phase 7). Everyone who may read Loyalty can see the configuration, analytics and history; only owner / doctor configure,
// preview or recalculate. Preview writes nothing, so it only needs the add-on (not an active plan) — like a read.
router.get("/tiers/config", ...read, getTiersConfig);
router.put("/tiers/config", ...sensitive(LOYALTY_ROLES.tiersManage), putTiersConfig);
router.post("/tiers/preview", writeLimiter, requireAddon("loyalty"), authorize(...LOYALTY_ROLES.tiersManage), previewTiers);
router.post("/tiers/recalculate", ...sensitive(LOYALTY_ROLES.tiersManage), recalculateTiers);
router.get("/tiers/analytics", ...read, getTiersAnalytics);
router.get("/tiers/history", ...read, getTiersHistory);

export default router;
