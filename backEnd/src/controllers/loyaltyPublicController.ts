import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { LoyaltyAccount } from "../models/LoyaltyAccount";
import { LoyaltyTransaction } from "../models/LoyaltyTransaction";
import { LoyaltyTierHistory } from "../models/LoyaltyTierHistory";
import { Patient } from "../models/Patient";
import { logActivity } from "../services/activityLogger";
import {
  displayName,
  isThrottled,
  isValidSlug,
  jitter,
  memberRef,
  nationalDigits,
  opaqueKey,
  recordFailure,
  recordSelfEnroll,
  resolvePhone,
  selfEnrollCapped,
  resolvePublicClinic,
  signPublicToken,
  verifyPublicToken,
  type PublicClinic,
} from "../services/loyaltyPublic";
import { PUBLIC_LOYALTY } from "../config/loyalty";
import { getTierConfig, memberTierView } from "../services/loyaltyTiers";
import { ensureSelfEnrolled } from "../services/loyaltyService";

/**
 * Public patient Loyalty API (Phase 4) — /api/public/loyalty/:slug/…
 *
 * No ClinicOS login. Safe by construction:
 *  • the clinic comes from the PUBLIC SLUG (never an id), the patient from the signed Loyalty session;
 *  • only Loyalty data is ever returned (first name, balance, member-since, a reference, safe activity rows) —
 *    no phone, no ids, no medical data, no invoices, no appointment notes, no staff-written reasons;
 *  • "not a patient", "archived", "suspended" and "ambiguous" all get the SAME answer; a patient of THIS clinic with no account is enrolled on the spot (Phase 9.1);
 *  • identification is rate limited (per IP, per phone) and answers failures after a small random delay;
 *  • scanning / opening this page never creates points or a check-in. The ONLY write the public page can cause is Phase 9.1's
 *    self-enrolment inside `identify` (an account for an EXISTING patient of this clinic: 0 points, no ledger row, no patient created).
 *    (A check-in is a separate, explicit tap: see loyaltyCheckInPublicController.ts, Phase 5.)
 */

const NO_STORE = (res: Response) => res.setHeader("Cache-Control", "no-store");
const UNAVAILABLE = { message: "Loyalty is currently unavailable for this clinic", code: "LOYALTY_UNAVAILABLE" };
// Phase 9.1: ONE answer for "not a patient of this clinic", "archived", "suspended" and "ambiguous" — it reveals nothing about which.
const GENERIC_NOT_FOUND = {
  message: "We couldn't find this phone number in the clinic records. Please contact reception.",
  code: "MEMBERSHIP_NOT_FOUND",
};

async function clinicOr404(req: Request, res: Response): Promise<PublicClinic | null> {
  NO_STORE(res);
  if (!isValidSlug(req.params.slug)) {
    res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
    return null;
  }
  const clinic = await resolvePublicClinic(req.params.slug);
  if (!clinic) {
    res.status(404).json({ message: "Not found", code: "NOT_FOUND" });
    return null;
  }
  return clinic;
}

/** Bearer public-session → { clinic, account } or sends 401 / 503. */
export async function sessionOr401(req: Request, res: Response) {
  const clinic = await clinicOr404(req, res);
  if (!clinic) return null;
  if (!clinic.available) {
    res.status(503).json(UNAVAILABLE);
    return null;
  }
  const raw = req.headers.authorization;
  const session = raw?.startsWith("Bearer ") ? verifyPublicToken(raw.slice(7)) : null;
  // The session must belong to THIS clinic (slug) — a token from another clinic is simply invalid here.
  if (!session || session.clinicId !== clinic.id) {
    res.status(401).json({ message: "Your session has expired. Please enter your number again.", code: "SESSION_EXPIRED" });
    return null;
  }
  const account = await LoyaltyAccount.findOne({ _id: session.accountId, clinicId: clinic.id, status: "active" }).lean();
  if (!account) {
    res.status(401).json({ message: "Your session has expired. Please enter your number again.", code: "SESSION_EXPIRED" });
    return null;
  }
  return { clinic, account };
}

const brand = (c: PublicClinic) => ({ name: c.name, logoUrl: c.logoUrl, brandColor: c.brandColor, programName: c.programName });

/** Human-safe activity kind (never the internal enum). */
const kindOf = (type: string) =>
  type === "earn_visit"
    ? "visit"
    : type === "earn_spending"
    ? "spending"
    : type === "manual_credit"
    ? "adjustment_credit"
    : type === "manual_debit"
    ? "adjustment_debit"
    : type === "reversal"
    ? "reversal"
    : type === "reward_redemption" // Phase 9: a CONFIRMED redemption (the only thing that ever deducts points for a reward)
    ? "redemption"
    : "other";

/* ---------- GET /:slug — can the page work? (no member data) ---------- */
export const getPublicInfo = asyncHandler(async (req: Request, res: Response) => {
  const clinic = await clinicOr404(req, res);
  if (!clinic) return;
  if (!clinic.available) return res.json({ available: false, clinic: { name: clinic.name } });
  return res.json({ available: true, clinic: brand(clinic) });
});

/* ---------- POST /:slug/identify ---------- */
const identifySchema = z.object({ phone: z.string().trim().min(5).max(25) }).strict();

export const identify = asyncHandler(async (req: Request, res: Response) => {
  const clinic = await clinicOr404(req, res);
  if (!clinic) return;
  const parsed = identifySchema.safeParse(req.body);
  const national = parsed.success ? nationalDigits(parsed.data.phone) : null;
  if (!national) return res.status(400).json({ message: "Please enter a valid mobile number", code: "INVALID_PHONE" });
  if (!clinic.available) return res.status(503).json(UNAVAILABLE);

  if (isThrottled(clinic.id, national)) {
    return res.status(429).json({ message: "Too many attempts. Please try again in a few minutes or ask reception.", code: "RATE_LIMITED" });
  }

  const notFound = async () => {
    const n = recordFailure(clinic.id, national);
    if (n === PUBLIC_LOYALTY.failMaxPerPhone) {
      // one line the moment a number gets throttled — never the number itself
      await logActivity({ action: "loyalty.public.identify_throttled", actorEmail: "public:patient", targetType: "clinic", targetId: clinic.id, details: { failures: n } });
    }
    await jitter(); // equalise timing between "no such number" and other failures
    return res.status(404).json(GENERIC_NOT_FOUND);
  };

  // Phase 9.1 — everything below is scoped to THIS clinic (resolved from the public slug). The client sends only a phone number:
  // no patient id, account id or clinic id is ever read from the request.
  const r = await resolvePhone(clinic.id, national);
  if (r.kind === "none") return notFound();

  let accountId: string;
  let newlyEnrolled = false;
  if (r.kind === "member") {
    accountId = String(r.account._id);
  } else {
    // The patient exists in this clinic's records but has no Loyalty account yet → activate it now (instant, no reception, 0 points).
    if (selfEnrollCapped(clinic.id)) {
      return res.status(429).json({ message: "Too many attempts. Please try again in a few minutes or ask reception.", code: "RATE_LIMITED" });
    }
    try {
      const out = await ensureSelfEnrolled({ clinicId: clinic.id, patientId: r.patientId });
      accountId = String(out.account._id);
      newlyEnrolled = out.created;
      if (out.account.status !== "active") return notFound(); // (defensive) a suspended account is never opened
    } catch (e: any) {
      // a patient archived / removed or a program switched off between the lookup and the enrolment: same generic answer, never a 500 detail
      if (e?.name === "LoyaltyError" && (e.code === "PATIENT_NOT_FOUND" || e.code === "PATIENT_ARCHIVED")) return notFound();
      if (e?.name === "LoyaltyError" && (e.code === "PROGRAM_DISABLED" || e.code === "ENTITLEMENT_REQUIRED")) return res.status(503).json(UNAVAILABLE);
      throw e;
    }
    if (newlyEnrolled) {
      recordSelfEnroll(clinic.id);
      await logActivity({
        action: "loyalty.public.self_enrolled",
        actorEmail: "public:patient",
        targetType: "clinic",
        targetId: clinic.id,
        details: { accountId, source: "self_enrollment" }, // no phone number, no name
      });
    }
  }

  const token = signPublicToken({ clinicId: clinic.id, accountId });
  await logActivity({
    action: "loyalty.public.member_access",
    actorEmail: "public:patient",
    targetType: "clinic",
    targetId: clinic.id,
    details: { accountId, via: "phone" }, // no phone number, no name
  });
  return res.json({ token, expiresIn: PUBLIC_LOYALTY.tokenTtlSeconds, newlyEnrolled });
});

/* ---------- GET /:slug/me ---------- */
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  const s = await sessionOr401(req, res);
  if (!s) return;
  const { clinic, account } = s;
  const patient = await Patient.findOne({ _id: account.patientId, clinicId: clinic.id }).select("fullName").lean();

  // Highlight a REAL recent earning only (never a fake "just earned"): latest credit in the last N days that
  // has not been reversed.
  const since = new Date(Date.now() - PUBLIC_LOYALTY.highlightDays * 86_400_000);
  const latest = await LoyaltyTransaction.findOne({ clinicId: clinic.id, accountId: account._id, pointsDelta: { $gt: 0 }, type: { $in: ["earn_visit", "earn_spending", "manual_credit"] }, createdAt: { $gte: since } })
    .sort({ createdAt: -1, _id: -1 })
    .select("type pointsDelta createdAt")
    .lean();
  const reversed = latest ? await LoyaltyTransaction.exists({ clinicId: clinic.id, reversesTransactionId: latest._id }) : null;

  // Tier (Phase 7) — only the clinic-defined, patient-safe facts, all calculated by the server's Tier Engine.
  const tierCfg = await getTierConfig(clinic.id);
  const t = memberTierView(tierCfg, account);

  // Phase 9: a REAL, recent promotion the patient app may celebrate (once per device — the client remembers the opaque key).
  // Only offered while the member is STILL at that tier, so a later rule change can never replay a stale celebration.
  let promotion: { key: string; fromTierKey: string | null; toTierKey: string; fromName: string | null; toName: string; at: Date } | null = null;
  if (t) {
    const since = new Date(Date.now() - PUBLIC_LOYALTY.promotionDays * 86_400_000);
    const h = await LoyaltyTierHistory.findOne({ clinicId: clinic.id, accountId: account._id, toTierKey: t.currentTierKey, direction: { $in: ["promotion", "initial"] }, changedAt: { $gte: since } })
      .sort({ sequence: -1 })
      .select("fromTierKey toTierKey fromTierNameSnapshot toTierNameSnapshot changedAt")
      .lean();
    if (h) {
      promotion = {
        key: opaqueKey(String(h._id)),
        fromTierKey: h.fromTierKey ?? null,
        toTierKey: h.toTierKey,
        // the clinic's CURRENT display names (a later rename must show), the snapshot only as a fallback
        fromName: h.fromTierKey ? tierCfg.tiers[h.fromTierKey]?.name || h.fromTierNameSnapshot || null : null,
        toName: tierCfg.tiers[h.toTierKey]?.name || h.toTierNameSnapshot,
        at: h.changedAt,
      };
    }
  }

  return res.json({
    clinic: brand(clinic),
    member: {
      displayName: displayName(patient?.fullName ?? ""),
      status: account.status,
      balance: account.pointsBalance,
      memberSince: account.joinedAt,
      ref: memberRef(String(account._id)),
    },
    tier: t
      ? {
          key: t.currentTierKey,
          name: t.currentTierName,
          rank: t.currentTierRank,
          description: t.description,
          benefits: t.benefits,
          metric: t.metric,
          unit: t.unit,
          metricValue: t.metricValue,
          nextTierName: t.nextTierName,
          nextTierThreshold: t.nextTierThreshold,
          remaining: t.remaining,
          progressPercent: t.progressPercent,
          isTopTier: t.isTopTier,
        }
      : null,
    latestEarning: latest && !reversed ? { kind: kindOf(latest.type), points: latest.pointsDelta, at: latest.createdAt } : null,
    promotion,
    expiresIn: PUBLIC_LOYALTY.tokenTtlSeconds,
  });
});

/* ---------- GET /:slug/activity ---------- */
const activityQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  // Over-large page sizes are clamped (not rejected): a public client can never pull more than the maximum per request.
  limit: z.coerce.number().int().min(1).default(PUBLIC_LOYALTY.activityPageSize).transform((v) => Math.min(v, PUBLIC_LOYALTY.activityMaxPageSize)),
});

export const getActivity = asyncHandler(async (req: Request, res: Response) => {
  const s = await sessionOr401(req, res);
  if (!s) return;
  const q = activityQuery.parse(req.query);
  const filter = { clinicId: s.clinic.id, accountId: s.account._id };
  const start = (q.page - 1) * q.limit;
  // One query per page: when page > 1 we also read the LAST row of the previous page (a time boundary) and one row of the next page,
  // so tier promotions can be placed on the page whose rows surround them — no promotion is lost or repeated between pages.
  const [window, total] = await Promise.all([
    LoyaltyTransaction.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(Math.max(0, start - 1))
      .limit(q.limit + 2)
      .select("type pointsDelta balanceAfter createdAt")
      .lean(),
    LoyaltyTransaction.countDocuments(filter),
  ]);
  const before = q.page > 1 ? window[0] : undefined; // last row of the previous page
  const body = q.page > 1 ? window.slice(1) : window;
  const rows = body.slice(0, q.limit);
  const after = body[q.limit]; // first row of the next page

  const upper = before ? before.createdAt : null; // exclusive
  const lower = after ? after.createdAt : null; // inclusive
  const promos = await LoyaltyTierHistory.find({ ...filter, direction: { $in: ["promotion", "initial"] } })
    .sort({ changedAt: -1 })
    .limit(PUBLIC_LOYALTY.activityPromotionsMax)
    .select("toTierKey toTierNameSnapshot changedAt")
    .lean();
  const cfg = promos.length ? await getTierConfig(s.clinic.id) : null;
  const inPage = promos.filter((p) => (upper === null || p.changedAt < upper) && (lower === null || p.changedAt >= lower));

  const items = [
    ...rows.map((r) => ({ key: opaqueKey(String(r._id)), kind: kindOf(r.type), points: r.pointsDelta, balanceAfter: r.balanceAfter as number | null, at: r.createdAt, tierName: null as string | null })),
    ...inPage.map((p) => ({ key: opaqueKey(String(p._id)), kind: "tier_promotion", points: 0, balanceAfter: null as number | null, at: p.changedAt, tierName: cfg?.tiers[p.toTierKey]?.name || p.toTierNameSnapshot })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));

  return res.json({
    activity: items,
    // every row the patient can ever scroll to: ledger movements + the (few) tier promotions merged into the timeline
    total: total + promos.length,
    page: q.page,
    pages: Math.ceil(total / q.limit),
  });
});
