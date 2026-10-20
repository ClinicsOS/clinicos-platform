import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { User } from "../models/User";
import { logActivity } from "../services/activityLogger";
import { LoyaltyError } from "../services/loyaltyService";
import {
  RewardError,
  confirmRedemption,
  countPendingRedemptions,
  createReward,
  deleteRewardIfUnused,
  getReward,
  listPendingRedemptions,
  listRedemptionHistory,
  listRewards,
  rejectRedemption,
  reverseRedemption,
  rewardsSummary,
  setRewardStatus,
  updateReward,
} from "../services/loyaltyRewards";
import { REDEMPTION, REWARD } from "../config/loyalty";
import { accessiblePatientIds, viewerOf } from "../auth/patientAccess";

/**
 * Clinic-facing Rewards + Redemptions API (Phase 6) — /api/loyalty/rewards, /api/loyalty/redemptions.
 * Behind protect → requireAddon("loyalty") → authorize(...) (see routes/loyaltyRoutes.ts); writes also requireActivePlan.
 *
 * The clinic ALWAYS comes from the signed-in user. Request bodies are strict zod schemas: a client cannot send a clinic id,
 * an account id, a balance, a points cost or a status — the server derives all of those. This file never touches a balance:
 * confirm / reverse call the services, which go through the central ledger.
 */

const handler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  asyncHandler(async (req, res, next) => {
    try {
      return await fn(req, res, next);
    } catch (e) {
      if (e instanceof RewardError || e instanceof LoyaltyError) {
        return res.status(e.status).json({ message: e.message, code: e.code, ...(e.extra ?? {}) });
      }
      throw e;
    }
  });

async function audit(req: Request, action: string, details: Record<string, unknown>) {
  const actor = await User.findById(req.userId).select("email").lean();
  await logActivity({
    action,
    actorEmail: actor?.email || "unknown",
    targetType: "clinic",
    targetId: req.clinicId as string,
    details: { ...details, actorType: "clinic_user", actorUserId: req.userId, actorRole: req.role }, // ids / numbers only — no patient names, phones or medical data
  });
}

const clinicOf = (req: Request) => req.clinicId as string;
const userOf = (req: Request) => req.userId as string;
/** Patient isolation: null = whole clinic (owner / front desk); a doctor gets only the ids of his own + covered patients. */
const scopeOf = (req: Request) => accessiblePatientIds(viewerOf(req), "patients");
const OID = /^[a-fA-F0-9]{24}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

/* ============================ Rewards ============================ */

const dateField = z.string().max(40).nullable().optional();
const rewardCreate = z
  .object({
    name: z.string().trim().min(REWARD.nameMin).max(REWARD.nameMax),
    description: z.string().max(REWARD.descriptionMax).optional(),
    pointsRequired: z.number().int().min(REWARD.pointsMin).max(REWARD.pointsMax),
    validFrom: dateField,
    validUntil: dateField,
  })
  .strict();
const rewardUpdate = rewardCreate
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
const emptyBody = z.object({}).strict();

/* GET /api/loyalty/rewards?status=active|inactive */
export const listRewardsHandler = handler(async (req, res) => {
  const q = z.object({ status: z.enum(["active", "inactive"]).optional() }).parse(req.query);
  noStore(res);
  return res.json({ rewards: await listRewards(clinicOf(req), { status: q.status }), canManage: ["owner", "doctor"].includes(String(req.role)) });
});

/* GET /api/loyalty/rewards/summary — real numbers for the tab header, badge and sidebar dot */
export const rewardsSummaryHandler = handler(async (req, res) => {
  noStore(res);
  return res.json(await rewardsSummary(clinicOf(req)));
});

/* GET /api/loyalty/rewards/pending-count — cheap, polled */
export const pendingCountHandler = handler(async (req, res) => {
  noStore(res);
  return res.json({ pending: await countPendingRedemptions(clinicOf(req), await scopeOf(req)) });
});

/* GET /api/loyalty/rewards/:id */
export const getRewardHandler = handler(async (req, res) => {
  noStore(res);
  return res.json({ reward: await getReward(clinicOf(req), req.params.id) });
});

/* POST /api/loyalty/rewards */
export const createRewardHandler = handler(async (req, res) => {
  const body = rewardCreate.parse(req.body ?? {});
  const reward = await createReward(clinicOf(req), body, userOf(req));
  await audit(req, "loyalty.reward.created", { rewardId: reward.id, pointsRequired: reward.pointsRequired, hasValidity: !!(reward.validFrom || reward.validUntil) });
  return res.status(201).json({ reward, message: "Reward created" });
});

/* PATCH /api/loyalty/rewards/:id */
export const updateRewardHandler = handler(async (req, res) => {
  const body = rewardUpdate.parse(req.body ?? {});
  const { reward, changed } = await updateReward(clinicOf(req), req.params.id, body, userOf(req));
  if (changed.length) await audit(req, "loyalty.reward.updated", { rewardId: reward.id, changed, ...(changed.includes("pointsRequired") ? { pointsRequired: reward.pointsRequired } : {}) });
  return res.json({ reward, message: changed.length ? "Reward updated" : "No changes" });
});

const setStatus = (status: "active" | "inactive") =>
  handler(async (req, res) => {
    emptyBody.parse(req.body ?? {});
    const { reward, changed } = await setRewardStatus(clinicOf(req), req.params.id, status, userOf(req));
    if (changed) await audit(req, status === "active" ? "loyalty.reward.activated" : "loyalty.reward.deactivated", { rewardId: reward.id });
    return res.json({ reward, message: status === "active" ? "Reward activated" : "Reward deactivated" });
  });
/* POST /api/loyalty/rewards/:id/activate | /deactivate */
export const activateRewardHandler = setStatus("active");
export const deactivateRewardHandler = setStatus("inactive");

/* DELETE /api/loyalty/rewards/:id — only while the reward has no redemption history */
export const deleteRewardHandler = handler(async (req, res) => {
  const reward = await deleteRewardIfUnused(clinicOf(req), req.params.id);
  await audit(req, "loyalty.reward.deleted", { rewardId: reward.id });
  return res.json({ message: "Reward deleted" });
});

/* ============================ Redemptions ============================ */

const listQuery = z.object({
  scope: z.enum(["pending", "history"]).default("pending"),
  status: z.enum(["pending", "confirmed", "rejected", "reversed"]).optional(),
  rewardId: z.string().regex(OID).optional(),
  accountId: z.string().regex(OID).optional(),
  q: z.string().max(60).optional(),
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(REDEMPTION.historyMaxPageSize).default(REDEMPTION.historyPageSize),
});

/* GET /api/loyalty/redemptions?scope=pending|history&status&rewardId&accountId&q&from&to&page&limit */
export const listRedemptionsHandler = handler(async (req, res) => {
  const q = listQuery.parse(req.query);
  noStore(res);
  if (q.scope === "pending") {
    const { rows, total } = await listPendingRedemptions(clinicOf(req), await scopeOf(req));
    return res.json({ scope: "pending", redemptions: rows, total });
  }
  const r = await listRedemptionHistory(clinicOf(req), { status: q.status, rewardId: q.rewardId, accountId: q.accountId, q: q.q, from: q.from, to: q.to, page: q.page, limit: q.limit }, await scopeOf(req));
  return res.json({ scope: "history", redemptions: r.rows, total: r.total, page: r.page, pages: r.pages, limit: q.limit });
});

/* POST /api/loyalty/redemptions/:id/confirm — empty body: the amount is the server-side snapshot */
export const confirmRedemptionHandler = handler(async (req, res) => {
  emptyBody.parse(req.body ?? {});
  const r = await confirmRedemption({ clinicId: clinicOf(req), redemptionId: req.params.id, userId: userOf(req), scope: await scopeOf(req) });
  await audit(req, "loyalty.redemption.confirmed", {
    redemptionId: r.redemption.id,
    rewardId: r.redemption.rewardId,
    accountId: r.redemption.accountId,
    points: r.points,
    balanceBefore: r.balanceBefore,
    balanceAfter: r.balanceAfter,
    transactionId: r.transactionId,
  });
  return res.json({ redemption: r.redemption, points: r.points, balanceBefore: r.balanceBefore, balanceAfter: r.balanceAfter, message: "Reward redeemed" });
});

/* POST /api/loyalty/redemptions/:id/reject  { reason?: string } */
export const rejectRedemptionHandler = handler(async (req, res) => {
  const body = z.object({ reason: z.string().max(REDEMPTION.rejectionReasonMax).nullable().optional() }).strict().parse(req.body ?? {});
  const row = await rejectRedemption({ clinicId: clinicOf(req), redemptionId: req.params.id, userId: userOf(req), reason: body.reason ?? null, scope: await scopeOf(req) });
  await audit(req, "loyalty.redemption.rejected", { redemptionId: row.id, rewardId: row.rewardId, accountId: row.accountId, hasReason: !!row.rejectionReason });
  return res.json({ redemption: row, message: "Request rejected" });
});

/* POST /api/loyalty/redemptions/:id/reverse  { reason: string } — owner / doctor only */
export const reverseRedemptionHandler = handler(async (req, res) => {
  const body = z.object({ reason: z.string().trim().min(3).max(300) }).strict().parse(req.body ?? {});
  const r = await reverseRedemption({ clinicId: clinicOf(req), redemptionId: req.params.id, userId: userOf(req), reason: body.reason, scope: await scopeOf(req) });
  await audit(req, "loyalty.redemption.reversed", {
    redemptionId: r.redemption.id,
    rewardId: r.redemption.rewardId,
    accountId: r.redemption.accountId,
    points: r.points,
    balanceBefore: r.balanceBefore,
    balanceAfter: r.balanceAfter,
    reversalTransactionId: r.reversalTransactionId,
  });
  return res.json({ redemption: r.redemption, points: r.points, balanceBefore: r.balanceBefore, balanceAfter: r.balanceAfter, message: "Redemption reversed" });
});
