import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { User } from "../models/User";
import { logActivity } from "../services/activityLogger";
import { LoyaltyError, getSettings } from "../services/loyaltyService";
import { CheckInError, countPending, listPending, listRecent, resolveCheckIn, type ResolveAction } from "../services/loyaltyCheckIn";
import { CHECKIN } from "../config/loyalty";
import { accessiblePatientIds, viewerOf } from "../auth/patientAccess";

/**
 * Clinic-facing check-in API (Phase 5) — /api/loyalty/checkins, behind protect → requireAddon("loyalty") →
 * authorize(LOYALTY_ROLES.checkin) (see routes/loyaltyRoutes.ts). The clinic always comes from the signed-in user.
 *
 * Reception sees who is waiting, then CONFIRMS (patient is here) or REJECTS (not a valid request). Neither action
 * awards points or changes an appointment: a check-in is an arrival record only.
 */

const handler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  asyncHandler(async (req, res, next) => {
    try {
      return await fn(req, res, next);
    } catch (e) {
      if (e instanceof CheckInError || e instanceof LoyaltyError) {
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
    details: { ...details, actorType: "clinic_user", actorUserId: req.userId, actorRole: req.role }, // ids only — no patient names / phones
  });
}

/* GET /api/loyalty/checkins/summary — cheap, polled by the sidebar dot and the tab badge */
export const getCheckInSummary = handler(async (req, res) => {
  const clinicId = req.clinicId as string;
  const [pending, { settings }] = await Promise.all([countPending(clinicId, await accessiblePatientIds(viewerOf(req), "patients")), getSettings(clinicId)]);
  res.setHeader("Cache-Control", "no-store");
  return res.json({ pending, enabled: !!settings.checkin?.enabled });
});

const listQuery = z.object({
  scope: z.enum(["pending", "recent"]).default("pending"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(CHECKIN.recentPageSize),
});

/* GET /api/loyalty/checkins?scope=pending|recent */
export const listCheckIns = handler(async (req, res) => {
  const clinicId = req.clinicId as string;
  const q = listQuery.parse(req.query);
  const { settings } = await getSettings(clinicId);
  res.setHeader("Cache-Control", "no-store");
  const enabled = !!settings.checkin?.enabled;
  const scope = await accessiblePatientIds(viewerOf(req), "patients"); // doctors: only their patients' requests
  if (q.scope === "pending") {
    const { rows, total } = await listPending(clinicId, scope);
    return res.json({ scope: "pending", enabled, checkIns: rows, total });
  }
  const r = await listRecent(clinicId, q.page, q.limit, scope);
  return res.json({ scope: "recent", enabled, checkIns: r.rows, total: r.total, page: r.page, pages: r.pages, limit: q.limit });
});

const confirmSchema = z.object({ appointmentId: z.string().regex(/^[a-fA-F0-9]{24}$/, "must be a valid appointment id").nullable().optional() }).strict();
const rejectSchema = z.object({}).strict();

const resolve = (action: ResolveAction) =>
  handler(async (req, res) => {
    const body = action === "confirm" ? confirmSchema.parse(req.body ?? {}) : (rejectSchema.parse(req.body ?? {}), {} as { appointmentId?: string | null });
    const row = await resolveCheckIn({ clinicId: req.clinicId as string, checkInId: req.params.id, action, userId: req.userId as string, appointmentId: body.appointmentId ?? null, scope: await accessiblePatientIds(viewerOf(req), "patients") });
    await audit(req, action === "confirm" ? "loyalty.checkin.confirmed" : "loyalty.checkin.rejected", {
      checkInId: row.id,
      accountId: row.accountId,
      patientId: row.patient?.id ?? null,
      appointmentId: row.appointmentId,
    });
    return res.json({ checkIn: row, message: action === "confirm" ? "Check-in confirmed" : "Check-in rejected" });
  });

/* POST /api/loyalty/checkins/:id/confirm   { appointmentId?: string | null } */
export const confirmCheckIn = resolve("confirm");
/* POST /api/loyalty/checkins/:id/reject */
export const rejectCheckIn = resolve("reject");
