import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { logActivity } from "../services/activityLogger";
import { LoyaltyError } from "../services/loyaltyService";
import { opaqueKey } from "../services/loyaltyPublic";
import { sessionOr401 } from "./loyaltyPublicController";
import { RewardError, listForMember, requestRedemption } from "../services/loyaltyRewards";

/**
 * Public patient rewards (Phase 6) — /api/public/loyalty/:slug/rewards…  (TEMPORARY, minimal: only enough to request a reward
 * through the current phone-based Loyalty session; the final patient experience is a later phase).
 *
 *  • Same Loyalty-only session as the rest of the public API; the clinic comes from the slug, the member from the token.
 *  • Requesting creates a PENDING request. It NEVER moves points — staff confirm at the desk.
 *  • Responses carry no clinic / account / patient ids, no staff data and no rejection reasons.
 */

const handler = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  asyncHandler(async (req, res) => {
    try {
      return await fn(req, res);
    } catch (e) {
      if (e instanceof RewardError || e instanceof LoyaltyError) return res.status(e.status).json({ message: e.message, code: e.code, ...(e.extra ?? {}) });
      throw e;
    }
  });

const emptyBody = z.object({}).strict();

const requestDto = (r: { id: string; rewardName: string; points: number; status: string; requestedAt: Date; resolvedAt: Date | null }) => ({
  key: opaqueKey(r.id),
  rewardName: r.rewardName,
  points: r.points,
  status: r.status,
  requestedAt: r.requestedAt,
  resolvedAt: r.resolvedAt,
});

/* GET /:slug/rewards — rewards on offer, my eligibility, my latest requests */
export const getMemberRewards = handler(async (req, res) => {
  const s = await sessionOr401(req, res);
  if (!s) return;
  const data = await listForMember(s.clinic.id, String(s.account._id));
  return res.json({ balance: data.balance, rewards: data.rewards, requests: data.requests.map(requestDto) });
});

/* POST /:slug/rewards/:rewardId/redeem — empty body */
export const redeemReward = handler(async (req, res) => {
  const s = await sessionOr401(req, res);
  if (!s) return;
  if (!emptyBody.safeParse(req.body ?? {}).success) return res.status(400).json({ message: "Invalid request", code: "INVALID_REQUEST" });
  const r = await requestRedemption({ clinicId: s.clinic.id, accountId: String(s.account._id), rewardId: req.params.rewardId });
  if (r.state === "created") {
    await logActivity({
      action: "loyalty.redemption.requested",
      actorEmail: "public:patient",
      targetType: "clinic",
      targetId: s.clinic.id,
      details: { redemptionId: String(r.redemption._id), rewardId: String(r.redemption.rewardId), accountId: String(s.account._id), points: r.redemption.pointsCostSnapshot }, // no name, no phone
    });
  }
  return res.status(r.state === "created" ? 201 : 200).json({
    state: r.state,
    request: requestDto({
      id: String(r.redemption._id),
      rewardName: r.redemption.rewardNameSnapshot,
      points: r.redemption.pointsCostSnapshot,
      status: "pending",
      requestedAt: r.redemption.requestedAt,
      resolvedAt: null,
    }),
    balance: r.balance,
  });
});
