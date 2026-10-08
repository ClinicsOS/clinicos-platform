import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { logActivity } from "../services/activityLogger";
import { sessionOr401 } from "./loyaltyPublicController";
import { CheckInError, cancelOwnCheckIn, currentCheckInForAccount, requestCheckIn } from "../services/loyaltyCheckIn";
import { CHECKIN } from "../config/loyalty";
import type { ILoyaltyCheckIn } from "../models/LoyaltyCheckIn";

/**
 * Public patient check-in (Phase 5) — /api/public/loyalty/:slug/checkin…
 *
 * Same session as the rest of the public Loyalty API (Loyalty-only token from /identify; clinic from the slug).
 *  • Opening the page NEVER checks anyone in — a check-in is created only by an explicit POST (the button).
 *  • It only creates a PENDING request. Nothing counts as "arrived" until reception confirms it, and nothing here can
 *    create or change points.
 *  • Responses carry only a status and timestamps — no ids, no names, no staff data, no rejection reasons.
 */

const publicDto = (c: ILoyaltyCheckIn | null) => (c ? { status: c.status, requestedAt: c.requestedAt, expiresAt: c.expiresAt, resolvedAt: c.resolvedAt ?? null } : null);

const bodySchema = z.object({ via: z.enum(CHECKIN.vias).optional() }).strict();

/* GET /:slug/checkin — is check-in available, and what is the state of my request? (polled while pending) */
export const getCheckIn = asyncHandler(async (req: Request, res: Response) => {
  const s = await sessionOr401(req, res);
  if (!s) return;
  if (!s.clinic.checkInEnabled) return res.json({ enabled: false, checkIn: null });
  const current = await currentCheckInForAccount(s.clinic.id, String(s.account._id));
  return res.json({ enabled: true, checkIn: publicDto(current) });
});

/* POST /:slug/checkin  { via?: "qr" | "nfc" | "link" } — the patient taps "Check in" */
export const createCheckIn = asyncHandler(async (req: Request, res: Response) => {
  const s = await sessionOr401(req, res);
  if (!s) return;
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ message: "Invalid request", code: "INVALID_REQUEST" });
  if (!s.clinic.checkInEnabled) {
    return res.status(409).json({ message: "Check-in is not available at this clinic right now. Please tell reception you have arrived.", code: "CHECKIN_DISABLED" });
  }
  try {
    const r = await requestCheckIn({ clinicId: s.clinic.id, accountId: String(s.account._id), patientId: String(s.account.patientId), via: parsed.data.via });
    if (r.state === "created") {
      await logActivity({
        action: "loyalty.checkin.requested",
        actorEmail: "public:patient",
        targetType: "clinic",
        targetId: s.clinic.id,
        details: { checkInId: String(r.checkIn._id), accountId: String(s.account._id), via: r.checkIn.via }, // no phone, no name
      });
    }
    return res.status(r.state === "created" ? 201 : 200).json({ state: r.state, checkIn: publicDto(r.checkIn) });
  } catch (e) {
    if (e instanceof CheckInError) return res.status(e.status).json({ message: e.message, code: e.code });
    throw e;
  }
});

/* POST /:slug/checkin/cancel — the patient withdraws their own pending request (idempotent) */
export const cancelCheckIn = asyncHandler(async (req: Request, res: Response) => {
  const s = await sessionOr401(req, res);
  if (!s) return;
  const cancelled = await cancelOwnCheckIn(s.clinic.id, String(s.account._id));
  if (cancelled) {
    await logActivity({
      action: "loyalty.checkin.cancelled",
      actorEmail: "public:patient",
      targetType: "clinic",
      targetId: s.clinic.id,
      details: { checkInId: String(cancelled._id), accountId: String(s.account._id) },
    });
  }
  const current = s.clinic.checkInEnabled ? await currentCheckInForAccount(s.clinic.id, String(s.account._id)) : null;
  return res.json({ enabled: s.clinic.checkInEnabled, checkIn: publicDto(current) });
});
