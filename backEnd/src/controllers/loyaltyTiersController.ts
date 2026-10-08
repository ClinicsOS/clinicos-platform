import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { User } from "../models/User";
import { logActivity } from "../services/activityLogger";
import { LoyaltyError, isOid } from "../services/loyaltyService";
import {
  getTierConfig,
  listTierHistory,
  previewTierConfig,
  recalculateClinic,
  saveTierConfig,
  tierAnalytics,
  type ClinicRecalcResult,
  type TierConfigInput,
} from "../services/loyaltyTiers";
import { isUsable, toDisplay, unitOf, type TierConfig } from "../services/loyaltyTierEngine";
import { LOYALTY_ROLES, TIER_DEFAULT_NAMES, TIER_KEYS, TIER_LIMITS, TIER_METRICS } from "../config/loyalty";

/**
 * Tiers API (Phase 7) — mounted under /api/loyalty/tiers behind  protect → requireAddon("loyalty") → authorize(roles)
 * (writes also requireActivePlan). Clinic scope ALWAYS comes from the authenticated user; no id from the client is trusted.
 *   view      owner, doctor, receptionist           GET  /tiers/config, /tiers/analytics, /tiers/history
 *   configure owner, doctor                         PUT  /tiers/config, POST /tiers/preview, POST /tiers/recalculate
 * This controller never calculates a tier and never touches a balance: it validates the request and calls services/loyaltyTiers.ts.
 */

const handler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  asyncHandler(async (req, res, next) => {
    try {
      return await fn(req, res, next);
    } catch (e) {
      if (e instanceof LoyaltyError) return res.status(e.status).json({ message: e.message, code: e.code, ...(e.extra ?? {}) });
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
    details: { ...details, actorType: "clinic_user", actorUserId: req.userId, actorRole: req.role }, // clinic configuration + counts only — never patient data
  });
}

/* ---------- DTO ---------- */

export function tierConfigDto(cfg: TierConfig) {
  const metric = cfg.metric;
  return {
    enabled: cfg.enabled,
    usable: isUsable(cfg),
    progressionMetric: metric,
    unit: metric ? unitOf(metric) : null,
    rulesVersion: cfg.rulesVersion,
    tiers: TIER_KEYS.map((k, i) => ({
      key: k,
      rank: i + 1,
      name: cfg.tiers[k].name,
      defaultName: TIER_DEFAULT_NAMES[k],
      threshold: cfg.tiers[k].threshold === null ? null : metric ? toDisplay(metric, cfg.tiers[k].threshold as number) : cfg.tiers[k].threshold,
      description: cfg.tiers[k].description,
      benefits: cfg.tiers[k].benefits,
    })),
  };
}

const limitsDto = () => ({
  nameMin: TIER_LIMITS.nameMin,
  nameMax: TIER_LIMITS.nameMax,
  descriptionMax: TIER_LIMITS.descriptionMax,
  benefitsMax: TIER_LIMITS.benefitsMax,
  benefitTitleMin: TIER_LIMITS.benefitTitleMin,
  benefitTitleMax: TIER_LIMITS.benefitTitleMax,
  benefitDescriptionMax: TIER_LIMITS.benefitDescriptionMax,
  maxThreshold: TIER_LIMITS.maxThreshold,
  metrics: TIER_METRICS.map((m) => ({ key: m, unit: unitOf(m) })),
});

const recalcDto = (r: ClinicRecalcResult) => ({
  processed: r.processed,
  promoted: r.promoted,
  demoted: r.demoted,
  initial: r.initial,
  unchanged: r.unchanged,
  countersCorrected: r.countersCorrected,
  errors: r.errors,
  distribution: r.distribution,
  done: r.done,
  nextCursor: r.nextCursor,
  remaining: r.remaining,
  dryRun: r.dryRun,
});

/* ---------- validation (shape only — meaning is validated by the service) ---------- */

const slot = z
  .object({
    name: z.string().max(80),
    threshold: z.number().finite().nullable().optional(),
    description: z.string().max(400).nullable().optional(),
    benefits: z
      .array(z.object({ title: z.string().max(200), description: z.string().max(400).nullable().optional() }).strict())
      .max(20)
      .optional(),
  })
  .strict();

const configSchema = z
  .object({
    enabled: z.boolean(),
    progressionMetric: z.enum(TIER_METRICS).nullable(),
    tiers: z.object({ tier1: slot, tier2: slot, tier3: slot, tier4: slot }).strict(),
  })
  .strict();

const recalcSchema = z
  .object({
    mode: z.enum(["tiers", "full"]).default("tiers"),
    dryRun: z.boolean().default(false),
    cursor: z.string().regex(/^[a-fA-F0-9]{24}$/).nullable().optional(),
  })
  .strict();

const historyQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(TIER_LIMITS.historyMaxPageSize).default(TIER_LIMITS.historyPageSize),
  accountId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
});

/* ============================================================
 * GET /api/loyalty/tiers/config
 * ============================================================ */
export const getTiersConfig = handler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const cfg = await getTierConfig(req.clinicId as string);
  return res.json({
    config: tierConfigDto(cfg),
    limits: limitsDto(),
    canConfigure: (LOYALTY_ROLES.tiersManage as readonly string[]).includes(req.role as string),
  });
});

/* ============================================================
 * PUT /api/loyalty/tiers/config   (owner, doctor)
 * ============================================================ */
export const putTiersConfig = handler(async (req, res) => {
  const body = configSchema.parse(req.body) as TierConfigInput;
  const { before, after, change, recalculation } = await saveTierConfig(req.clinicId as string, req.userId as string, body);

  const nothing = !change.enabledChanged && !change.metricChanged && !change.thresholdsChanged && !change.namesChanged.length && !change.textChanged.length;
  if (change.enabledChanged) await audit(req, after.enabled ? "loyalty.tiers.enabled" : "loyalty.tiers.disabled", { progressionMetric: after.metric });
  if (!nothing) {
    await audit(req, "loyalty.tier.settings.updated", {
      changed: {
        metric: change.metricChanged ? { from: before.metric, to: after.metric } : undefined,
        thresholds: change.thresholdsChanged
          ? { from: TIER_KEYS.map((k) => before.tiers[k].threshold), to: TIER_KEYS.map((k) => after.tiers[k].threshold), unit: after.metric ? (after.metric === "lifetime_spending" ? "fils" : unitOf(after.metric)) : null }
          : undefined,
        names: change.namesChanged.length ? Object.fromEntries(change.namesChanged.map((k) => [k, { from: before.tiers[k].name, to: after.tiers[k].name }])) : undefined,
        textTiers: change.textChanged.length ? change.textChanged : undefined,
      },
      rulesVersion: after.rulesVersion,
    });
  }
  if (recalculation) {
    await audit(req, "loyalty.tier.recalculated", { source: "settings_recalculation", ...recalcDto(recalculation) });
  }
  return res.json({
    config: tierConfigDto(after),
    limits: limitsDto(),
    canConfigure: true,
    rulesChanged: change.rulesChanged,
    recalculation: recalculation ? recalcDto(recalculation) : null,
    message: nothing ? "No changes — tier settings are already up to date" : "Tier settings saved",
  });
});

/* ============================================================
 * POST /api/loyalty/tiers/preview   (owner, doctor) — exact effect of a proposed config, nothing is written
 * ============================================================ */
export const previewTiers = handler(async (req, res) => {
  const body = configSchema.parse(req.body) as TierConfigInput;
  const current = await getTierConfig(req.clinicId as string);
  const impact = await previewTierConfig(req.clinicId as string, body);
  return res.json({ impact, currentlyEnabled: current.enabled });
});

/* ============================================================
 * POST /api/loyalty/tiers/recalculate   (owner, doctor)
 *   mode "tiers"  continue / run the re-evaluation for members whose tier is missing or older than the current rules
 *   mode "full"   rebuild EVERY member's counters from the ledger / appointments / invoices, then re-evaluate (reconciliation)
 *   dryRun        compute and report, write nothing
 * One request handles a bounded number of members and returns `nextCursor` / `remaining` — call again to continue.
 * ============================================================ */
export const recalculateTiers = handler(async (req, res) => {
  const body = recalcSchema.parse(req.body ?? {});
  const result = await recalculateClinic(req.clinicId as string, {
    source: body.mode === "full" ? "manual_reconciliation" : "settings_recalculation",
    mode: body.mode,
    onlyStale: body.mode === "tiers",
    dryRun: body.dryRun,
    cursor: body.cursor ?? null,
  });
  if (!body.dryRun) await audit(req, "loyalty.tier.recalculated", { source: body.mode === "full" ? "manual_reconciliation" : "settings_recalculation", ...recalcDto(result) });
  return res.json({ result: recalcDto(result) });
});

/* ============================================================
 * GET /api/loyalty/tiers/analytics   +   GET /api/loyalty/tiers/history
 * ============================================================ */
export const getTiersAnalytics = handler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  return res.json(await tierAnalytics(req.clinicId as string));
});

export const getTiersHistory = handler(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const q = historyQuery.parse(req.query);
  return res.json(await listTierHistory(req.clinicId as string, { accountId: q.accountId && isOid(q.accountId) ? q.accountId : undefined, page: q.page, limit: q.limit }));
});

