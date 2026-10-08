import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { INSIGHTS, loyaltyAnalytics, memberInsights, recentActivity } from "../services/loyaltyInsights";
import { isOid } from "../services/loyaltyService";

/**
 * Loyalty insights (Phase 8) — read-only, behind protect → requireAddon("loyalty") → authorize(...LOYALTY_ROLES.read)
 * (see routes/loyaltyRoutes.ts). The clinic always comes from the signed-in user. Nothing here writes anything.
 *
 *   GET /api/loyalty/activity?limit=15      the live activity stream (real, recent events)
 *   GET /api/loyalty/analytics?days=30      counts / sums per clinic-local day, reward performance (7 · 30 · 90 days)
 *   GET /api/loyalty/members/:id/insights   one member's recent check-ins / redemptions and which rewards they can afford now
 */

const activityQuery = z.object({ limit: z.coerce.number().int().min(1).max(INSIGHTS.activityMax).default(INSIGHTS.activityDefault) });
const analyticsQuery = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((v) => (INSIGHTS.analyticsDays as readonly number[]).includes(v), { message: `days must be one of ${INSIGHTS.analyticsDays.join(", ")}` })
    .default(30),
});

const noStore = (res: Response) => res.setHeader("Cache-Control", "no-store");

export const getActivity = asyncHandler(async (req: Request, res: Response) => {
  const q = activityQuery.parse(req.query);
  noStore(res);
  return res.json(await recentActivity(req.clinicId as string, q.limit));
});

export const getAnalytics = asyncHandler(async (req: Request, res: Response) => {
  const q = analyticsQuery.parse(req.query);
  noStore(res);
  return res.json(await loyaltyAnalytics(req.clinicId as string, q.days));
});

export const getMemberInsights = asyncHandler(async (req: Request, res: Response) => {
  const notFound = () => res.status(404).json({ message: "Loyalty member not found", code: "ACCOUNT_NOT_FOUND" });
  if (!isOid(req.params.id)) return notFound();
  const out = await memberInsights(req.clinicId as string, req.params.id);
  if (!out) return notFound();
  noStore(res);
  return res.json(out);
});
