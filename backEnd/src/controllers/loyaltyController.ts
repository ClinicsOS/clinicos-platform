import { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { Patient } from "../models/Patient";
import { User } from "../models/User";
import { LoyaltyAccount } from "../models/LoyaltyAccount";
import { LoyaltyTransaction } from "../models/LoyaltyTransaction";
import { logActivity } from "../services/activityLogger";
import { LoyaltyError, creditPoints, debitPoints, enrollPatient, getSettings, isOid, updateSettings } from "../services/loyaltyService";
import { DISPLAY_NAME_MAX, EARNING_LIMITS, EDITABLE_SETTING_PATHS, LOYALTY_ACCOUNT_STATUSES, LOYALTY_ROLES, LOYALTY_TECHNICAL_LIMITS, RESERVED_SETTING_SECTIONS, TIER_KEYS } from "../config/loyalty";
import { getTierConfig, memberTierView, recentTierHistory } from "../services/loyaltyTiers";
import { isUsable, type TierConfig } from "../services/loyaltyTierEngine";

/**
 * Clinic-facing Loyalty API (Phase 2). Mounted at /api/loyalty behind  protect → (requireActivePlan on writes)
 * → requireAddon("loyalty")  — see routes/loyaltyRoutes.ts. Role rules live in config/loyalty.ts (LOYALTY_ROLES).
 *
 * Clinic isolation: the clinic ALWAYS comes from the authenticated user (`req.clinicId`, set by `protect`) and
 * every query below is filtered by it. Ids from the URL/body are only ever looked up WITHIN that clinic, so a
 * foreign id behaves exactly like a missing one (404) — there is nothing to enumerate across clinics.
 *
 * This controller never writes a balance. (Phase 2 exposes no endpoint that creates points at all.)
 */

/** Converts LoyaltyError into the project's usual `{ message, code }` JSON; anything else goes to errorHandler. */
const handler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  asyncHandler(async (req, res, next) => {
    try {
      return await fn(req, res, next);
    } catch (e) {
      if (e instanceof LoyaltyError) {
        return res.status(e.status).json({ message: e.message, code: e.code, ...(e.extra ?? {}) });
      }
      throw e;
    }
  });

const CONTROL = /[\u0000-\u001f\u007f]/g;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const oidOf = (v: string) => new Types.ObjectId(v);

/* ---------- DTOs (explicit allow-lists: nothing internal such as `seq` / `enrolledBy` leaks) ---------- */

const settingsDto = (s: Record<string, any>) => ({
  program: { enabled: !!s.program?.enabled },
  branding: { displayName: s.branding?.displayName ?? null },
  checkin: { enabled: !!s.checkin?.enabled },
  earning: {
    visits: { enabled: !!s.earning?.visits?.enabled, pointsPerVisit: s.earning?.visits?.pointsPerVisit ?? null },
    spending: {
      enabled: !!s.earning?.spending?.enabled,
      spendAmount: s.earning?.spending?.spendAmount ?? null,
      pointsPerSpendAmount: s.earning?.spending?.pointsPerSpendAmount ?? null,
      activatedAt: s.earning?.spending?.activatedAt ?? null,
    },
  },
  redemption: s.redemption,
  // Tier configuration lives under /api/loyalty/tiers/config; here only the on/off state (details are not part of the program settings).
  tiers: { enabled: !!s.tiers?.enabled, progressionMetric: s.tiers?.progressionMetric ?? null },
  expiration: s.expiration,
  antiAbuse: s.antiAbuse,
  updatedAt: s.updatedAt ?? null,
});

/** Compact tier block for lists; the full block (benefits, history) is returned by GET /members/:id. null when tiers are off. */
const tierBrief = (cfg: TierConfig, a: Record<string, any>) => {
  const t = memberTierView(cfg, a);
  if (!t) return null;
  return {
    key: t.currentTierKey,
    name: t.currentTierName,
    rank: t.currentTierRank,
    metric: t.metric,
    unit: t.unit,
    metricValue: t.metricValue,
    nextTierName: t.nextTierName,
    nextTierThreshold: t.nextTierThreshold,
    remaining: t.remaining,
    progressPercent: t.progressPercent,
    isTopTier: t.isTopTier,
    pending: t.pending,
  };
};

const memberDto = (a: Record<string, any>, p: Record<string, any> | undefined, cfg?: TierConfig) => ({
  id: String(a._id),
  patientId: String(a.patientId),
  status: a.status,
  pointsBalance: a.pointsBalance,
  lifetimePointsEarned: a.lifetimePointsEarned,
  lifetimePointsRedeemed: a.lifetimePointsRedeemed,
  joinedAt: a.joinedAt,
  lastActivityAt: a.lastActivityAt ?? null,
  patient: p ? { id: String(p._id), fullName: p.fullName, phone: p.phone, fileNumber: p.fileNumber, isArchived: !!p.isArchived } : null,
  // Tier progression is SEPARATE from the redeemable balance above: spending points never lowers it.
  tier: cfg ? tierBrief(cfg, a) : null,
});

const txDto = (t: Record<string, any>, patient?: Record<string, any>, actor?: Record<string, any>) => ({
  id: String(t._id),
  accountId: String(t.accountId),
  patientId: String(t.patientId),
  patient: patient ? { id: String(patient._id), fullName: patient.fullName, fileNumber: patient.fileNumber } : null,
  type: t.type,
  pointsDelta: t.pointsDelta,
  balanceBefore: t.balanceBefore,
  balanceAfter: t.balanceAfter,
  sourceType: t.sourceType,
  sourceId: t.sourceId ?? null,
  reason: t.reason ?? null,
  metadata: t.metadata ?? null,
  reversesTransactionId: t.reversesTransactionId ? String(t.reversesTransactionId) : null,
  createdBy: t.createdBy ? { id: String(t.createdBy), name: actor?.name ?? null } : null,
  createdAt: t.createdAt,
});

const patientsById = async (clinicId: string, ids: unknown[]) => {
  const unique = [...new Set(ids.map(String))];
  if (!unique.length) return new Map<string, Record<string, any>>();
  const rows = await Patient.find({ _id: { $in: unique }, clinicId }).select("fullName phone fileNumber isArchived").lean();
  return new Map(rows.map((r) => [String(r._id), r as Record<string, any>]));
};

/* ---------- audit ---------- */

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

/* ---------- query validation ---------- */

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const memberQuery = pageQuery.extend({
  search: z.string().trim().max(60).optional(),
  status: z.enum(LOYALTY_ACCOUNT_STATUSES).optional(),
  /** a stable tier key (never a display name), or "none" for members whose tier has not been assigned yet */
  tier: z.enum([...TIER_KEYS, "none"]).optional(),
});
const txQuery = pageQuery.extend({
  accountId: z.string().regex(/^[a-fA-F0-9]{24}$/).optional(),
  type: z.string().regex(/^[a-z_]{3,30}$/).optional(),
});

/* ============================================================
 * GET /api/loyalty/settings
 * ============================================================ */
export const getLoyaltySettings = handler(async (req, res) => {
  const { settings, persisted } = await getSettings(req.clinicId as string);
  return res.json({
    settings: settingsDto(settings),
    persisted,
    // Tells the UI which fields the backend will accept today; everything else is read-only foundation.
    editable: EDITABLE_SETTING_PATHS,
    canConfigure: (LOYALTY_ROLES.configure as readonly string[]).includes(req.role as string),
    limits: { pointsPerVisit: EARNING_LIMITS.pointsPerVisit, pointsPerSpendAmount: EARNING_LIMITS.pointsPerSpendAmount, spendAmount: EARNING_LIMITS.spendAmount },
  });
});

/* ============================================================
 * PATCH /api/loyalty/settings   (owner, doctor)
 * ============================================================ */
const cleanName = z
  .string()
  .max(DISPLAY_NAME_MAX * 2)
  .nullable()
  .transform((v) => (v == null ? null : v.replace(CONTROL, " ").replace(/\s+/g, " ").trim() || null))
  .refine((v) => v === null || v.length <= DISPLAY_NAME_MAX, { message: `must be at most ${DISPLAY_NAME_MAX} characters` });

const intIn = (r: { min: number; max: number }) => z.number().int().min(r.min).max(r.max);
// JOD with at most 3 decimals (fils); finite; within technical limits. NaN / Infinity / negatives are rejected by zod.
const jod = z
  .number()
  .finite()
  .min(EARNING_LIMITS.spendAmount.min)
  .max(EARNING_LIMITS.spendAmount.max)
  .refine((v) => Math.abs(v * EARNING_LIMITS.filsPerJod - Math.round(v * EARNING_LIMITS.filsPerJod)) < 1e-6, { message: "must have at most 3 decimal places" })
  .transform((v) => Math.round(v * EARNING_LIMITS.filsPerJod) / EARNING_LIMITS.filsPerJod);

const settingsPatchSchema = z
  .object({
    program: z.object({ enabled: z.boolean() }).strict().optional(),
    branding: z.object({ displayName: cleanName }).strict().optional(),
    checkin: z.object({ enabled: z.boolean() }).strict().optional(),
    earning: z
      .object({
        visits: z
          .object({ enabled: z.boolean().optional(), pointsPerVisit: intIn(EARNING_LIMITS.pointsPerVisit).nullable().optional() })
          .strict()
          .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one visit-earning field" })
          .optional(),
        spending: z
          .object({
            enabled: z.boolean().optional(),
            spendAmount: jod.nullable().optional(),
            pointsPerSpendAmount: intIn(EARNING_LIMITS.pointsPerSpendAmount).nullable().optional(),
          })
          .strict()
          .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one spending-earning field" })
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((v) => v.program !== undefined || v.branding !== undefined || v.checkin !== undefined || v.earning !== undefined, { message: "Provide at least one setting to change" });

export const patchLoyaltySettings = handler(async (req, res) => {
  const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
  if ("tiers" in body) {
    return res.status(400).json({ message: "Tier settings are managed at /api/loyalty/tiers/config", code: "USE_TIERS_ENDPOINT" });
  }
  const reserved = RESERVED_SETTING_SECTIONS.filter((k) => k in body);
  if (reserved.length) {
    // Rewards / tiers / expiration / anti-abuse are not built yet — refuse instead of storing guesses.
    return res.status(400).json({
      message: `${reserved.join(", ")} can't be configured yet — these rules are not available in this version`,
      code: "NOT_CONFIGURABLE_YET",
      sections: reserved,
    });
  }
  const patch = settingsPatchSchema.parse(body);

  // Cross-field rule (server-side, not left to the UI): a mode can only be ON when its value(s) are configured.
  if (patch.earning) {
    const cur = (await getSettings(req.clinicId as string)).settings.earning ?? {};
    const pick = <T,>(has: boolean, next: T | undefined, old: T | null | undefined) => (has ? (next ?? null) : old ?? null);
    const v = patch.earning.visits;
    if (v) {
      const en = v.enabled ?? !!cur.visits?.enabled;
      const pts = pick("pointsPerVisit" in v, v.pointsPerVisit as number | null | undefined, cur.visits?.pointsPerVisit);
      if (en && pts == null) return res.status(400).json({ message: "Set the points per completed visit before turning visit earning on", code: "EARNING_INCOMPLETE", field: "earning.visits" });
    }
    const sp = patch.earning.spending;
    if (sp) {
      const en = sp.enabled ?? !!cur.spending?.enabled;
      const amt = pick("spendAmount" in sp, sp.spendAmount as number | null | undefined, cur.spending?.spendAmount);
      const pts = pick("pointsPerSpendAmount" in sp, sp.pointsPerSpendAmount as number | null | undefined, cur.spending?.pointsPerSpendAmount);
      if (en && (amt == null || pts == null)) return res.status(400).json({ message: "Set both the amount and the points before turning spending earning on", code: "EARNING_INCOMPLETE", field: "earning.spending" });
    }
  }

  const { before, after } = await updateSettings(req.clinicId as string, patch, req.userId as string);

  // Audit — nested (not dotted) keys: field names containing "." are rejected by older MongoDB versions.
  const changes: Record<string, any> = {};
  if (patch.program && !!before.program?.enabled !== after.program.enabled) changes.program = { enabled: { from: !!before.program?.enabled, to: after.program.enabled } };
  if (patch.branding && (before.branding?.displayName ?? null) !== (after.branding?.displayName ?? null)) {
    changes.branding = { displayName: { from: before.branding?.displayName ?? null, to: after.branding?.displayName ?? null } };
  }
  if (patch.checkin && !!before.checkin?.enabled !== !!after.checkin?.enabled) changes.checkin = { enabled: { from: !!before.checkin?.enabled, to: !!after.checkin?.enabled } };
  const earningChanges: Record<string, any> = {};
  const diff = (mode: "visits" | "spending", keys: string[]) => {
    for (const k of keys) {
      const f = (before.earning?.[mode] as Record<string, any> | undefined)?.[k] ?? null;
      const t = (after.earning?.[mode] as Record<string, any> | undefined)?.[k] ?? null;
      if (f !== t) (earningChanges[mode] ||= {})[k] = { from: f, to: t };
    }
  };
  if (patch.earning?.visits) diff("visits", ["enabled", "pointsPerVisit"]);
  if (patch.earning?.spending) diff("spending", ["enabled", "spendAmount", "pointsPerSpendAmount"]);
  if (Object.keys(changes).length) await audit(req, "loyalty.settings_updated", { changes });
  if (Object.keys(earningChanges).length) await audit(req, "loyalty.settings.earning_updated", { changes: earningChanges });

  const changed = Object.keys(changes).length + Object.keys(earningChanges).length > 0;
  return res.json({
    settings: settingsDto(after),
    persisted: true,
    editable: EDITABLE_SETTING_PATHS,
    canConfigure: true,
    limits: { pointsPerVisit: EARNING_LIMITS.pointsPerVisit, pointsPerSpendAmount: EARNING_LIMITS.pointsPerSpendAmount, spendAmount: EARNING_LIMITS.spendAmount },
    earningChanged: Object.keys(earningChanges).length > 0,
    message: changed ? "Loyalty settings saved" : "No changes — settings are already up to date",
  });
});

/* ============================================================
 * GET /api/loyalty/overview
 * ============================================================ */
export const getOverview = handler(async (req, res) => {
  const clinicId = req.clinicId as string;
  const cid = oidOf(clinicId);
  const [{ settings }, members, transactions, outstanding, issued, recent] = await Promise.all([
    getSettings(clinicId),
    LoyaltyAccount.countDocuments({ clinicId: cid }),
    LoyaltyTransaction.countDocuments({ clinicId: cid }),
    LoyaltyAccount.aggregate([{ $match: { clinicId: cid } }, { $group: { _id: null, total: { $sum: "$pointsBalance" } } }]),
    // Points ISSUED, by source (uses the {clinicId, createdAt} index prefix; reversals are not netted here).
    LoyaltyTransaction.aggregate([
      { $match: { clinicId: cid, type: { $in: ["earn_visit", "earn_spending", "manual_credit"] } } },
      { $group: { _id: "$type", total: { $sum: "$pointsDelta" } } },
    ]),
    LoyaltyTransaction.find({ clinicId: cid }).sort({ createdAt: -1, _id: -1 }).limit(5).lean(),
  ]);
  const by = (t: string) => issued.find((x: { _id: string }) => x._id === t)?.total ?? 0;
  const visitsOn = !!settings.earning?.visits?.enabled && settings.earning.visits.pointsPerVisit != null;
  const spendOn = !!settings.earning?.spending?.enabled && settings.earning.spending.pointsPerSpendAmount != null && settings.earning.spending.spendAmount != null;

  const patients = await patientsById(clinicId, recent.map((r) => r.patientId));
  return res.json({
    members,
    transactions,
    pointsOutstanding: outstanding[0]?.total ?? 0,
    pointsIssued: { total: by("earn_visit") + by("earn_spending") + by("manual_credit"), visits: by("earn_visit"), spending: by("earn_spending"), manual: by("manual_credit") },
    recent: recent.map((r) => txDto(r, patients.get(String(r.patientId)))),
    program: { enabled: !!settings.program?.enabled, displayName: settings.branding?.displayName ?? null },
    earningConfigured: visitsOn || spendOn,
    earning: { visits: visitsOn, spending: spendOn },
  });
});

/* ============================================================
 * GET /api/loyalty/members
 * ============================================================ */
export const listMembers = handler(async (req, res) => {
  const clinicId = req.clinicId as string;
  const q = memberQuery.parse(req.query);
  const filter: Record<string, unknown> = { clinicId: oidOf(clinicId) };
  if (q.status) filter.status = q.status;
  if (q.tier) filter["tier.key"] = q.tier === "none" ? null : q.tier;

  if (q.search) {
    // Same safe, escaped matching the patient list uses — resolved to ids first (one query), then members by id.
    const rx = new RegExp(escapeRegex(q.search), "i");
    const or: Record<string, unknown>[] = [{ fullName: rx }, { phone: rx }];
    const digits = q.search.replace(/\D/g, "");
    if (digits.length >= 3) or.push({ phone: new RegExp(digits.split("").join("\\D*")) });
    if (/^\d{1,9}$/.test(q.search)) or.push({ fileNumber: Number(q.search) });
    const ids = await Patient.find({ clinicId, $or: or }).select("_id").limit(500).lean();
    filter.patientId = { $in: ids.map((p) => p._id) };
  }

  const [accounts, total] = await Promise.all([
    LoyaltyAccount.find(filter)
      .sort({ joinedAt: -1, _id: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .lean(),
    LoyaltyAccount.countDocuments(filter),
  ]);
  const [patients, tierCfg] = await Promise.all([patientsById(clinicId, accounts.map((a) => a.patientId)), getTierConfig(clinicId)]);
  return res.json({
    members: accounts.map((a) => memberDto(a, patients.get(String(a.patientId)), tierCfg)),
    tiersEnabled: isUsable(tierCfg),
    total,
    page: q.page,
    limit: q.limit,
    pages: Math.ceil(total / q.limit),
  });
});

/* ============================================================
 * GET /api/loyalty/members/:id
 * ============================================================ */
export const getMember = handler(async (req, res) => {
  const clinicId = req.clinicId as string;
  if (!isOid(req.params.id)) return res.status(404).json({ message: "Loyalty member not found", code: "ACCOUNT_NOT_FOUND" });
  const account = await LoyaltyAccount.findOne({ _id: req.params.id, clinicId }).lean();
  if (!account) return res.status(404).json({ message: "Loyalty member not found", code: "ACCOUNT_NOT_FOUND" });
  const [patients, tierCfg] = await Promise.all([patientsById(clinicId, [account.patientId]), getTierConfig(clinicId)]);
  const tier = memberTierView(tierCfg, account);
  return res.json({
    member: memberDto(account, patients.get(String(account.patientId)), tierCfg),
    // Full tier picture (Phase 7): current tier, REAL progress, benefits and recent history — all calculated server-side.
    tier,
    tierHistory: tier ? await recentTierHistory(clinicId, String(account._id), 6) : [],
    // The two numbers staff must never confuse: what the member can spend vs what drives the tier.
    points: { available: account.pointsBalance, lifetimeEarned: account.progress?.earnedPoints ?? 0 },
  });
});

/* ============================================================
 * GET /api/loyalty/members/:id/transactions   +   GET /api/loyalty/transactions
 * ============================================================ */
async function pageTransactions(req: Request, filter: Record<string, unknown>, page: number, limit: number, withPatients: boolean) {
  const clinicId = req.clinicId as string;
  const [rows, total] = await Promise.all([
    LoyaltyTransaction.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    LoyaltyTransaction.countDocuments(filter),
  ]);
  const actorIds = [...new Set(rows.filter((r) => r.createdBy).map((r) => String(r.createdBy)))];
  const [patients, actors] = await Promise.all([
    withPatients ? patientsById(clinicId, rows.map((r) => r.patientId)) : Promise.resolve(new Map<string, Record<string, any>>()),
    actorIds.length ? User.find({ _id: { $in: actorIds }, clinicId }).select("name").lean() : Promise.resolve([]),
  ]);
  const actorMap = new Map(actors.map((u) => [String(u._id), u as Record<string, any>]));
  return {
    transactions: rows.map((r) => txDto(r, patients.get(String(r.patientId)), r.createdBy ? actorMap.get(String(r.createdBy)) : undefined)),
    total,
    page,
    limit,
    pages: Math.ceil(total / limit),
  };
}

export const listMemberTransactions = handler(async (req, res) => {
  const clinicId = req.clinicId as string;
  const q = pageQuery.parse(req.query);
  if (!isOid(req.params.id)) return res.status(404).json({ message: "Loyalty member not found", code: "ACCOUNT_NOT_FOUND" });
  const owned = await LoyaltyAccount.exists({ _id: req.params.id, clinicId });
  if (!owned) return res.status(404).json({ message: "Loyalty member not found", code: "ACCOUNT_NOT_FOUND" });
  return res.json(await pageTransactions(req, { clinicId: oidOf(clinicId), accountId: oidOf(req.params.id) }, q.page, q.limit, false));
});

export const listTransactions = handler(async (req, res) => {
  const clinicId = req.clinicId as string;
  const q = txQuery.parse(req.query);
  const filter: Record<string, unknown> = { clinicId: oidOf(clinicId) };
  if (q.accountId) filter.accountId = oidOf(q.accountId);
  if (q.type) filter.type = q.type;
  return res.json(await pageTransactions(req, filter, q.page, q.limit, true));
});

/* ============================================================
 * POST /api/loyalty/members   (owner, doctor, receptionist)  — enrol an existing patient
 * ============================================================ */
const enrollSchema = z.object({ patientId: z.string().regex(/^[a-fA-F0-9]{24}$/, "must be a valid patient id") }).strict();

export const enrollMember = handler(async (req, res) => {
  const { patientId } = enrollSchema.parse(req.body);
  const account = await enrollPatient({ clinicId: req.clinicId as string, patientId, enrolledBy: req.userId as string });
  const patients = await patientsById(req.clinicId as string, [account.patientId]);
  await audit(req, "loyalty.member_enrolled", { accountId: String(account._id), patientId });
  return res.status(201).json({ member: memberDto(account, patients.get(String(account.patientId)), await getTierConfig(req.clinicId as string)), message: "Patient enrolled in Loyalty" });
});

/* ============================================================
 * POST /api/loyalty/members/:id/adjust   (owner, doctor)  — MANUAL credit / debit
 * Goes through the central service only: one atomic balance change + one immutable ledger row. Reason is mandatory.
 * ============================================================ */
const adjustSchema = z
  .object({
    direction: z.enum(["credit", "debit"]),
    points: z.number().int().min(1).max(LOYALTY_TECHNICAL_LIMITS.maxPointsPerTransaction),
    reason: z.string().trim().min(LOYALTY_TECHNICAL_LIMITS.reasonMinLength).max(LOYALTY_TECHNICAL_LIMITS.reasonMaxLength),
  })
  .strict();

export const adjustMemberPoints = handler(async (req, res) => {
  const clinicId = req.clinicId as string;
  if (!isOid(req.params.id)) return res.status(404).json({ message: "Loyalty member not found", code: "ACCOUNT_NOT_FOUND" });
  const body = adjustSchema.parse(req.body);
  const owned = await LoyaltyAccount.exists({ _id: req.params.id, clinicId });
  if (!owned) return res.status(404).json({ message: "Loyalty member not found", code: "ACCOUNT_NOT_FOUND" });

  const input = { clinicId, accountId: req.params.id, points: body.points, reason: body.reason, sourceType: "manual" as const, actorId: req.userId as string };
  const r = body.direction === "credit" ? await creditPoints({ ...input, type: "manual_credit" }) : await debitPoints({ ...input, type: "manual_debit" });

  await audit(req, body.direction === "credit" ? "loyalty.points.manual_credit" : "loyalty.points.manual_debit", {
    accountId: req.params.id,
    transactionId: String(r.transaction._id),
    points: body.points,
    balanceBefore: r.transaction.balanceBefore,
    balanceAfter: r.transaction.balanceAfter,
  });
  const [patients, actor] = await Promise.all([patientsById(clinicId, [r.account.patientId]), User.findById(req.userId).select("name").lean()]);
  return res.json({
    member: memberDto(r.account, patients.get(String(r.account.patientId))),
    transaction: txDto(r.transaction, patients.get(String(r.account.patientId)), actor as Record<string, any> | undefined),
    message: body.direction === "credit" ? "Points added" : "Points deducted",
  });
});
