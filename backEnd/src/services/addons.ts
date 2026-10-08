import { Request, Response, NextFunction } from "express";
import { Clinic, type IAddonSubscription } from "../models/Clinic";
import { ADDONS, ADDON_IDS, type AddonId, type AddonStatus } from "../config/addons";

/**
 * Server-side entitlement for paid add-ons.
 *
 * Question answered:  "Has this clinic paid for add-on X, and may it use it RIGHT NOW?"
 *
 * This is the security boundary. The frontend may hide or show things, but anything that
 * actually serves add-on functionality MUST be protected with `requireAddon(id)` (or call
 * `hasAddon(clinic, id)`), never with a client-supplied flag.
 *
 * Entitlement is granted only when ALL of these hold:
 *   1. the clinic has an add-on record whose status is "active" and `enabled` is true
 *      (both are required — an inconsistent hand-edited record fails closed);
 *   2. the whole ClinicOS account is eligible under the EXISTING subscription rules —
 *      clinic.status is "active" (not suspended / expired) and the plan has not run past
 *      planExpiresAt. An active add-on never overrides a suspended or expired account;
 *   3. the add-on's own billing period has not ended (currentPeriodEnd, when set).
 *
 * Existing clinics have no `addons` field at all; that is read as "not subscribed".
 */

type AddonClinicLike = {
  status?: string | null;
  planExpiresAt?: Date | string | null;
  addons?: Partial<Record<AddonId, IAddonSubscription | null | undefined>> | null;
};

export type AddonDenyReason =
  | "not_subscribed"
  | "suspended"
  | "cancelled"
  | "period_ended"
  | "account_suspended"
  | "account_expired";

export interface AddonEvaluation {
  addon: AddonId;
  /** Lifecycle status stored on the clinic ("inactive" when there is no record). */
  status: AddonStatus;
  /** True only if the clinic may use the add-on right now. */
  entitled: boolean;
  /** Why not (undefined when entitled). */
  reason?: AddonDenyReason;
  /** The add-on billing period has ended (only meaningful for an active record). */
  periodExpired: boolean;
  /** The ClinicOS account itself is in good standing (status active, plan not past expiry). */
  accountEligible: boolean;
}

const toDate = (v: Date | string | null | undefined): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** The stored record for an add-on, or null when the clinic never subscribed. */
export function getAddonRecord(
  clinic: AddonClinicLike | null | undefined,
  id: AddonId
): IAddonSubscription | null {
  return clinic?.addons?.[id] ?? null;
}

export function evaluateAddon(
  clinic: AddonClinicLike | null | undefined,
  id: AddonId,
  now: Date = new Date()
): AddonEvaluation {
  const rec = getAddonRecord(clinic, id);
  const status: AddonStatus = rec?.status ?? "inactive";

  const expiresAt = toDate(clinic?.planExpiresAt);
  const accountEligible =
    !!clinic && clinic.status === "active" && !(expiresAt && expiresAt.getTime() < now.getTime());

  const periodEnd = toDate(rec?.currentPeriodEnd);
  const periodExpired = status === "active" && !!periodEnd && periodEnd.getTime() < now.getTime();

  const base = { addon: id, status, periodExpired, accountEligible };

  if (!rec || status === "inactive") return { ...base, entitled: false, reason: "not_subscribed" };
  if (status === "suspended") return { ...base, entitled: false, reason: "suspended" };
  if (status === "cancelled") return { ...base, entitled: false, reason: "cancelled" };

  // status === "active" from here on
  if (!rec.enabled) return { ...base, entitled: false, reason: "not_subscribed" };
  if (!accountEligible) {
    return {
      ...base,
      entitled: false,
      reason: clinic?.status === "suspended" ? "account_suspended" : "account_expired",
    };
  }
  if (periodExpired) return { ...base, entitled: false, reason: "period_ended" };
  return { ...base, entitled: true };
}

/** Pure check — is the clinic currently entitled to this add-on? */
export const hasAddon = (
  clinic: AddonClinicLike | null | undefined,
  id: AddonId,
  now?: Date
): boolean => evaluateAddon(clinic, id, now).entitled;

/**
 * Express middleware. Use AFTER `protect` (which derives req.clinicId from the authenticated
 * user's own record — never from the client):
 *
 *     router.use(protect, requireActivePlan, requireAddon("loyalty"));
 *
 * The clinic is read fresh from the database on every request, so a suspension or
 * cancellation takes effect immediately. Responses reuse the existing 402 conventions.
 */
export const requireAddon =
  (id: AddonId) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const clinic = await Clinic.findById(req.clinicId).select("status planExpiresAt addons");
      if (!clinic) return res.status(404).json({ message: "Clinic not found" });

      const ev = evaluateAddon(clinic, id);
      if (ev.entitled) return next();

      if (ev.reason === "account_suspended") {
        return res
          .status(402)
          .json({ message: "Account suspended — contact support", code: "SUSPENDED" });
      }
      if (ev.reason === "account_expired") {
        return res
          .status(402)
          .json({ message: "Subscription expired — please renew", code: "EXPIRED" });
      }
      return res.status(402).json({
        message: `${ADDONS[id].name} is not active for this clinic`,
        code: "ADDON_REQUIRED",
        addon: id,
        reason: ev.reason,
      });
    } catch (err) {
      return next(err);
    }
  };

/* ============================================================
 * Serializers
 * ============================================================ */

/** What a clinic user may see about an add-on (GET /api/subscription). No setup fee, no admin dates. */
export interface ClinicSafeAddon {
  /** Effective entitlement — gate UI on this. Already accounts for the account state and billing period. */
  enabled: boolean;
  /** Stored lifecycle status. */
  status: AddonStatus;
  /** The clinic's agreed monthly price; the product list price when the clinic has no record. */
  monthlyPrice: number;
  currentPeriodEnd: Date | null;
  /** Active, but the billing period has ended (so `enabled` is false until the admin renews it). */
  periodExpired: boolean;
}

export function toClinicSafeAddons(
  clinic: AddonClinicLike | null | undefined
): Record<AddonId, ClinicSafeAddon> {
  const out = {} as Record<AddonId, ClinicSafeAddon>;
  for (const id of ADDON_IDS) {
    const rec = getAddonRecord(clinic, id);
    const ev = evaluateAddon(clinic, id);
    out[id] = {
      enabled: ev.entitled,
      status: ev.status,
      monthlyPrice: rec ? rec.monthlyPrice : ADDONS[id].defaultMonthlyPrice,
      currentPeriodEnd: toDate(rec?.currentPeriodEnd),
      periodExpired: ev.periodExpired,
    };
  }
  return out;
}

/** Full view for the platform admin (everything on the record + computed flags). */
export interface AdminAddonView {
  id: AddonId;
  name: string;
  status: AddonStatus;
  /** Effective entitlement right now. */
  entitled: boolean;
  reason: AddonDenyReason | null;
  hasRecord: boolean;
  enabled: boolean;
  setupFee: number | null;
  monthlyPrice: number | null;
  activatedAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
  periodExpired: boolean;
  accountEligible: boolean;
  /** Whole days until currentPeriodEnd (negative once passed); null when there is no end date. */
  daysUntilPeriodEnd: number | null;
}

export function toAdminAddonView(
  clinic: AddonClinicLike | null | undefined,
  id: AddonId,
  now: Date = new Date()
): AdminAddonView {
  const rec = getAddonRecord(clinic, id);
  const ev = evaluateAddon(clinic, id, now);
  const end = toDate(rec?.currentPeriodEnd);
  return {
    id,
    name: ADDONS[id].name,
    status: ev.status,
    entitled: ev.entitled,
    reason: ev.reason ?? null,
    hasRecord: !!rec,
    enabled: !!rec?.enabled,
    setupFee: rec ? rec.setupFee : null,
    monthlyPrice: rec ? rec.monthlyPrice : null,
    activatedAt: toDate(rec?.activatedAt),
    currentPeriodStart: toDate(rec?.currentPeriodStart),
    currentPeriodEnd: end,
    suspendedAt: toDate(rec?.suspendedAt),
    cancelledAt: toDate(rec?.cancelledAt),
    periodExpired: ev.periodExpired,
    accountEligible: ev.accountEligible,
    daysUntilPeriodEnd: end ? Math.ceil((end.getTime() - now.getTime()) / 86_400_000) : null,
  };
}

/**
 * Remove the add-on entitlement record from an object that is about to be sent to ordinary
 * clinic users. Existing endpoints that return the whole clinic document (GET/PATCH /api/clinic,
 * the owner's data export) call this so agreed prices and billing dates never reach staff —
 * the only clinic-facing view of add-ons is the safe one in GET /api/subscription.
 */
export function withoutAddons<T extends Record<string, unknown>>(clinicObject: T): Omit<T, "addons"> {
  const { addons: _omit, ...rest } = clinicObject;
  void _omit;
  return rest;
}
