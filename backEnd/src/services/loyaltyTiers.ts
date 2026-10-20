import { Types } from "mongoose";
import { Appointment } from "../models/Appointment";
import { Invoice, ACTIVE_INVOICE } from "../models/Invoice";
import { Patient } from "../models/Patient";
import { LoyaltyAccount } from "../models/LoyaltyAccount";
import { LoyaltyProgressEvent } from "../models/LoyaltyProgressEvent";
import { LoyaltySettings } from "../models/LoyaltySettings";
import { LoyaltyTierHistory } from "../models/LoyaltyTierHistory";
import { LoyaltyTransaction } from "../models/LoyaltyTransaction";
import { logActivity } from "./activityLogger";
import { LoyaltyError, assertEntitled, defaultLeaves, getSettings, isOid, withAccountLock } from "./loyaltyService";
import {
  FILS_PER_JOD,
  calculateTier,
  calculateTierProgress,
  checkPlainText,
  checkTierName,
  isUsable,
  metricValueOf,
  normalizeTierConfig,
  toDisplay,
  toInternal,
  validateThresholds,
  type TierConfig,
  type TierProgress,
} from "./loyaltyTierEngine";
import {
  TIER_EARNING_TYPES,
  TIER_KEYS,
  TIER_LIMITS,
  TIER_METRICS,
  tierRank,
  type TierDirection,
  type TierHistorySource,
  type TierKey,
  type TierMetric,
} from "../config/loyalty";

/**
 * ClinicOS Loyalty — TIERS & PROGRESSION (Phase 7), persistence + orchestration around the pure engine
 * (services/loyaltyTierEngine.ts). THE only place that writes `LoyaltyAccount.progress`, `LoyaltyAccount.tier` and
 * `LoyaltyTierHistory`; controllers only call the functions below.
 *
 * ── What counts (documented decisions) ─────────────────────────────────────────────────────────────────
 *  lifetime_points    net earn_visit + earn_spending (a reversal of such a row un-earns it). NOT manual credits / corrections,
 *                     NOT redemptions, NOT the reversal of a redemption. It is NEVER the redeemable balance, so spending points
 *                     (redeeming a reward) can not lower it.
 *  completed_visits   appointments whose status is "completed" (type ≠ blocked). Not scheduled / confirmed / cancelled / no_show,
 *                     not check-ins. Counted once per appointment (idempotency marker), un-counted if the appointment leaves "completed".
 *  lifetime_spending  the sum of real PAYMENTS on the patient's invoices, integer fils. Not invoice totals, not unpaid balances.
 *                     Counted once per payment (idempotency marker). Redeeming points never touches it.
 *
 * ── Downgrades ─────────────────────────────────────────────────────────────────────────────────────────
 * Events (earning, a completed visit, a payment) can only PROMOTE. Nothing a member does with their balance — redeeming,
 * expiring, manual debits, reversing a redemption — ever lowers a tier. The only things that can move a tier DOWN are the
 * clinic changing its own rules (thresholds / metric → "settings_recalculation") or an explicit staff reconciliation
 * ("manual_reconciliation") that finds the counters were wrong. Both are recorded in the history with direction "demotion".
 *
 * ── Safety ─────────────────────────────────────────────────────────────────────────────────────────────
 *  • Counters are a cache of the authoritative sources and can always be rebuilt (`recalculateMember`, backfill script).
 *  • A tier change is ONE compare-and-set on `tier.version`; only the winner writes history, whose unique
 *    (accountId, sequence) index is a second, database-level guard → no duplicate promotion rows, whatever the concurrency.
 *  • Hooks never throw into the caller: a Loyalty problem can never break an appointment, a payment or a ledger write.
 *  • Nothing runs at server start. Existing members are brought in through the explicit reconcile / backfill paths.
 */

export const toFils = (jod: number): number => Math.round(jod * FILS_PER_JOD);

type Lean = Record<string, any>;
const oid = (v: string | Types.ObjectId) => (typeof v === "string" ? new Types.ObjectId(v) : v);
const isDup = (e: any) => e?.code === 11000;

/* ============================================================
 * Configuration access
 * ============================================================ */

export async function getTierConfig(clinicId: string): Promise<TierConfig> {
  const { settings } = await getSettings(clinicId);
  return normalizeTierConfig(settings);
}

const METRIC_FIELD: Record<TierMetric, string> = {
  lifetime_points: "progress.earnedPoints",
  completed_visits: "progress.completedVisits",
  lifetime_spending: "progress.paidFils",
};

/** Tier block for one member (null when tiers are off / not usable). Pure given the config — no queries. */
export interface MemberTierView extends TierProgress {
  /** the stored tier key is missing, so the shown tier is computed and a recalculation will persist it */
  pending: boolean;
  /** counters were rebuilt from the sources at least once */
  reconciled: boolean;
  description: string | null;
  benefits: { title: string; description: string | null }[];
  changedAt: Date | null;
}
export function memberTierView(cfg: TierConfig, account: Lean): MemberTierView | null {
  if (!isUsable(cfg)) return null;
  const value = metricValueOf(cfg.metric as TierMetric, account.progress);
  const stored = account.tier?.key && (TIER_KEYS as readonly string[]).includes(account.tier.key) ? (account.tier.key as TierKey) : null;
  const key = stored ?? calculateTier(cfg, value);
  const p = calculateTierProgress(cfg, value, key, account.tier?.highestKey ?? null);
  return {
    ...p,
    pending: !stored,
    reconciled: !!account.progress?.reconciledAt,
    description: cfg.tiers[key].description,
    benefits: cfg.tiers[key].benefits,
    changedAt: account.tier?.changedAt ?? null,
  };
}

/* ============================================================
 * Evaluate + change a member's tier (compare-and-set, history)
 * ============================================================ */

export interface TierChange {
  changed: boolean;
  from: TierKey | null;
  to: TierKey | null;
  direction?: TierDirection;
  historyWritten?: boolean;
}

export async function evaluateAccountTier(
  clinicId: string,
  accountId: string,
  source: TierHistorySource,
  opts: { allowDemotion: boolean; config?: TierConfig; account?: Lean; dryRun?: boolean } = { allowDemotion: false }
): Promise<TierChange> {
  /**
   * How a tier change is made safe (the same idea works with or without atomic conditional updates):
   *   1. The change is identified by (accountId, sequence = tier.version + 1).
   *   2. The HISTORY row is inserted FIRST. Its unique (accountId, sequence) index lets exactly ONE concurrent evaluator through —
   *      that evaluator is "the" change; the others can never write a second row, so no duplicate history and no duplicate log.
   *   3. The account is then updated with a compare-and-set on `tier.version` (+ the previous key).
   *   4. A loser that finds the winner's row (but the account not yet updated — e.g. the winner crashed) HELPS: it applies the
   *      winner's tier to the account, then re-reads and decides again. So history and account can never disagree for long.
   * The base tier (tier1) is everybody's starting point, so a first assignment to tier1 skips the history gate (a plain,
   * idempotent compare-and-set on "no tier yet").
   */
  const cid = oid(clinicId);
  for (let attempt = 0; attempt < 6; attempt++) {
    const account = attempt === 0 && opts.account ? opts.account : await LoyaltyAccount.findOne({ _id: accountId, clinicId }).lean();
    if (!account) return { changed: false, from: null, to: null };
    const cfg = opts.config ?? (await getTierConfig(clinicId));
    if (!isUsable(cfg)) return { changed: false, from: null, to: null };
    const metric = cfg.metric as TierMetric;
    const value = metricValueOf(metric, account.progress);
    const target = calculateTier(cfg, value);
    const cur: TierKey | null = (TIER_KEYS as readonly string[]).includes(account.tier?.key) ? (account.tier.key as TierKey) : null;
    // Events only promote. A lower computed tier is ignored unless demotion is explicitly allowed (rule change / reconciliation).
    const next: TierKey = !opts.allowDemotion && cur && tierRank(target) < tierRank(cur) ? cur : target;

    if (cur === next) {
      if (!opts.dryRun && (account.tier?.rulesVersion ?? 0) !== cfg.rulesVersion) {
        await LoyaltyAccount.updateOne({ _id: account._id, clinicId }, { $set: { "tier.rulesVersion": cfg.rulesVersion } });
      }
      return { changed: false, from: cur, to: cur };
    }
    const direction: TierDirection = cur === null ? "initial" : tierRank(next) > tierRank(cur) ? "promotion" : "demotion";
    if (opts.dryRun) return { changed: true, from: cur, to: next, direction };

    const version: number = account.tier?.version ?? 0;
    const now = new Date();
    const applyToAccount = async (toKey: TierKey, at: Date, rulesVersion: number, expectKey: TierKey | null) => {
      const highest = tierRank(account.tier?.highestKey) >= tierRank(toKey) ? (account.tier.highestKey as TierKey) : toKey;
      const filter: Record<string, unknown> = { _id: account._id, clinicId: cid };
      if (version === 0) filter.$and = [{ $or: [{ "tier.version": 0 }, { "tier.version": { $exists: false } }] }];
      else filter["tier.version"] = version;
      filter["tier.key"] = expectKey; // null also matches "no tier yet"
      return LoyaltyAccount.findOneAndUpdate(
        filter,
        { $set: { "tier.key": toKey, "tier.highestKey": highest, "tier.changedAt": at, "tier.rulesVersion": rulesVersion }, $inc: { "tier.version": 1 } },
        { new: true }
      ).lean();
    };

    // The base tier is the starting point of everybody, so a first assignment to tier1 is not a "change" worth a history row.
    if (cur === null && next === "tier1") {
      const filter: Record<string, unknown> = { _id: account._id, clinicId: cid, "tier.key": null };
      await LoyaltyAccount.updateOne(filter, { $set: { "tier.key": "tier1", "tier.highestKey": account.tier?.highestKey ?? "tier1", "tier.changedAt": now, "tier.rulesVersion": cfg.rulesVersion } });
      return { changed: true, from: null, to: "tier1", direction: "initial", historyWritten: false };
    }

    const sequence = version + 1;
    try {
      await LoyaltyTierHistory.create({
        clinicId: cid,
        accountId: account._id,
        patientId: account.patientId,
        fromTierKey: cur,
        toTierKey: next,
        fromTierNameSnapshot: cur ? cfg.tiers[cur].name : null,
        toTierNameSnapshot: cfg.tiers[next].name,
        direction,
        progressionMetric: metric,
        metricValueAtChange: value,
        source,
        sequence,
        metadata: { rulesVersion: cfg.rulesVersion },
        changedAt: now,
      });
    } catch (e) {
      if (!isDup(e)) throw e; // a real failure: leave the tier alone, the next event retries
      // Somebody else already owns this change number → help finish THEIR change, then decide again from the fresh state.
      const theirs = (await LoyaltyTierHistory.findOne({ clinicId: account.clinicId, accountId: account._id, sequence }).lean()) as Lean | null;
      if (theirs && (TIER_KEYS as readonly string[]).includes(theirs.toTierKey)) {
        await applyToAccount(theirs.toTierKey as TierKey, theirs.changedAt ?? now, theirs.metadata?.rulesVersion ?? cfg.rulesVersion, (theirs.fromTierKey as TierKey | null) ?? null);
      }
      continue;
    }
    // We hold the history row → we are THE change. Apply it (compare-and-set). If a helper already did, that is fine.
    await applyToAccount(next, now, cfg.rulesVersion, cur);
    if (direction === "promotion" && !["settings_recalculation", "manual_reconciliation", "migration"].includes(source)) {
      await logActivity({
        action: "loyalty.tier.promoted",
        actorEmail: "system:loyalty",
        targetType: "clinic",
        targetId: clinicId,
        details: { accountId: String(account._id), fromTierKey: cur, toTierKey: next, metric, source }, // ids / keys only — no names
      });
    }
    return { changed: true, from: cur, to: next, direction, historyWritten: true };
  }
  return { changed: false, from: null, to: null };
}

/* ============================================================
 * Rebuild one member's counters from the authoritative sources
 * ============================================================ */

export interface Truth {
  earnedPoints: number;
  visitIds: string[];
  payments: { key: string; fils: number }[];
  paidFils: number;
}

/** What the counters SHOULD be, computed from the ledger, the appointments and the invoices of this patient at this clinic. */
export async function computeTruth(clinicId: string, account: Lean): Promise<Truth> {
  const [rows, appts, invoices] = await Promise.all([
    LoyaltyTransaction.find({ clinicId, accountId: account._id }).select("type pointsDelta reversesTransactionId metadata").lean(),
    Appointment.find({ clinicId, patientId: account.patientId, status: "completed", type: { $ne: "blocked" } }).select("_id").lean(),
    Invoice.find({ clinicId, patientId: account.patientId, ...ACTIVE_INVOICE }).select("payments").lean(), // PHASE 2 — a soft-deleted invoice is not spending
  ]);
  const earning = TIER_EARNING_TYPES as readonly string[];
  const byId = new Map<string, Lean>(rows.map((r) => [String(r._id), r as Lean]));
  let earned = 0;
  for (const r of rows as Lean[]) {
    if (earning.includes(r.type)) earned += r.pointsDelta;
    else if (r.type === "reversal") {
      const original = r.reversesTransactionId ? byId.get(String(r.reversesTransactionId)) : null;
      const originalType = original?.type ?? r.metadata?.reversedType;
      if (earning.includes(originalType)) earned += r.pointsDelta; // un-earns a mistaken earning; a REDEMPTION reversal is never counted
    }
  }
  const payments: { key: string; fils: number }[] = [];
  let paid = 0;
  for (const inv of invoices as Lean[]) {
    (inv.payments ?? []).forEach((p: Lean, i: number) => {
      if (typeof p.amount !== "number" || !(p.amount > 0)) return;
      const fils = toFils(p.amount);
      paid += fils;
      payments.push({ key: `payment:${inv._id}:${p._id ?? `i${i}`}`, fils });
    });
  }
  return { earnedPoints: Math.max(0, earned), visitIds: appts.map((a) => String(a._id)), payments, paidFils: paid };
}

async function insertEvents(docs: Record<string, unknown>[]) {
  for (let i = 0; i < docs.length; i += 500) {
    try {
      await LoyaltyProgressEvent.insertMany(docs.slice(i, i + 500), { ordered: false });
    } catch (e: any) {
      const errs = e?.writeErrors ?? e?.result?.result?.writeErrors;
      const allDup = isDup(e) || (Array.isArray(errs) && errs.length > 0 && errs.every((w: any) => isDup(w) || w?.code === 11000 || w?.err?.code === 11000));
      if (!allDup) throw e;
    }
  }
}

/** Bring the idempotency markers in line with the truth (so later hooks see the same picture the counters do). */
async function syncEvents(clinicId: string, account: Lean, t: Truth) {
  const existing = (await LoyaltyProgressEvent.find({ clinicId: oid(clinicId), accountId: account._id }).select("key kind active").lean()) as Lean[];
  const have = new Map(existing.map((e) => [e.key as string, e]));
  const visitKeys = new Set(t.visitIds.map((id) => `visit:${id}`));
  const payKeys = new Set(t.payments.map((p) => p.key));
  const cid = oid(clinicId);

  const toInsert: Record<string, unknown>[] = [];
  for (const k of visitKeys) if (!have.has(k)) toInsert.push({ clinicId: cid, accountId: account._id, kind: "visit", key: k, active: true, amountFils: 0 });
  for (const p of t.payments) if (!have.has(p.key)) toInsert.push({ clinicId: cid, accountId: account._id, kind: "payment", key: p.key, active: true, amountFils: p.fils });
  if (toInsert.length) await insertEvents(toInsert);

  const activate = existing.filter((e) => e.kind === "visit" && !e.active && visitKeys.has(e.key)).map((e) => e.key);
  const deactivate = existing.filter((e) => e.kind === "visit" && e.active && !visitKeys.has(e.key)).map((e) => e.key);
  const payGone = existing.filter((e) => e.kind === "payment" && e.active && !payKeys.has(e.key)).map((e) => e.key);
  if (activate.length) await LoyaltyProgressEvent.updateMany({ clinicId: cid, accountId: account._id, key: { $in: activate } }, { $set: { active: true } });
  const off = [...deactivate, ...payGone];
  if (off.length) await LoyaltyProgressEvent.updateMany({ clinicId: cid, accountId: account._id, key: { $in: off } }, { $set: { active: false } });
}

export interface MemberRecalc {
  accountId: string;
  rebuilt: boolean;
  counters: { before: { earnedPoints: number; completedVisits: number; paidFils: number }; after: { earnedPoints: number; completedVisits: number; paidFils: number } };
  countersChanged: boolean;
  tier: TierChange | null;
  /** the tier this member would have after the run (also for a dry run) */
  resultingTier: TierKey | null;
}

/**
 * Rebuild one member's counters from the sources, then evaluate the tier.
 * `rebuild:false` re-evaluates from the stored counters (cheap) — used for settings changes when the counters are already reconciled.
 */
type RecalcOpts = { source: TierHistorySource; allowDemotion: boolean; rebuild?: boolean; dryRun?: boolean; config?: TierConfig };

export async function recalculateMember(clinicId: string, accountId: string, opts: RecalcOpts): Promise<MemberRecalc | null> {
  if (!isOid(clinicId) || !isOid(accountId)) return null;
  // Same per-account queue the ledger uses: every write to one account's document (balance, counters, tier) is serialised
  // inside this process — on top of the atomic operators — so none of them can interleave with another.
  return withAccountLock(accountId, () => recalcLocked(clinicId, accountId, opts));
}

async function recalcLocked(clinicId: string, accountId: string, opts: RecalcOpts): Promise<MemberRecalc | null> {
  {
    const account = (await LoyaltyAccount.findOne({ _id: accountId, clinicId }).lean()) as Lean | null;
    if (!account) return null;
    const cfg = opts.config ?? (await getTierConfig(clinicId));
    const before = {
      earnedPoints: account.progress?.earnedPoints ?? 0,
      completedVisits: account.progress?.completedVisits ?? 0,
      paidFils: account.progress?.paidFils ?? 0,
    };
    const needRebuild = opts.rebuild !== false || !account.progress?.reconciledAt;
    let working: Lean = account;
    let after = before;
    if (needRebuild) {
      const t = await computeTruth(clinicId, account);
      after = { earnedPoints: t.earnedPoints, completedVisits: t.visitIds.length, paidFils: t.paidFils };
      if (!opts.dryRun) {
        await syncEvents(clinicId, account, t);
        const fresh = await LoyaltyAccount.findOneAndUpdate(
          { _id: accountId, clinicId },
          {
            $set: {
              "progress.earnedPoints": after.earnedPoints,
              "progress.completedVisits": after.completedVisits,
              "progress.paidFils": after.paidFils,
              "progress.reconciledAt": new Date(),
            },
          },
          { new: true }
        ).lean();
        working = (fresh as Lean) ?? account;
      } else {
        working = { ...account, progress: { ...(account.progress ?? {}), ...after } };
      }
    }
    const countersChanged = after.earnedPoints !== before.earnedPoints || after.completedVisits !== before.completedVisits || after.paidFils !== before.paidFils;
    let tier: TierChange | null = null;
    let resulting: TierKey | null = null;
    if (isUsable(cfg)) {
      tier = await evaluateAccountTier(clinicId, accountId, opts.source, { allowDemotion: opts.allowDemotion, config: cfg, account: working, dryRun: opts.dryRun });
      resulting = tier.changed ? (tier.to as TierKey) : tier.to ?? (working.tier?.key ?? null);
    }
    return { accountId, rebuilt: needRebuild, counters: { before, after }, countersChanged, tier, resultingTier: resulting };
  }
}

/* ============================================================
 * Event hooks (never throw)
 * ============================================================ */

async function entitledAndUsable(clinicId: string): Promise<TierConfig | null> {
  try {
    await assertEntitled(clinicId);
  } catch {
    return null;
  }
  const cfg = await getTierConfig(clinicId);
  return isUsable(cfg) ? cfg : null;
}

/** After an event changed a counter: promote if the new value reached a threshold. Unreconciled members are rebuilt from the sources first. */
async function afterEvent(clinicId: string, accountId: string, source: TierHistorySource) {
  const cfg = await entitledAndUsable(clinicId);
  if (!cfg) return;
  await withAccountLock(accountId, async () => {
    const account = (await LoyaltyAccount.findOne({ _id: accountId, clinicId }).lean()) as Lean | null;
    if (!account) return;
    if (!account.progress?.reconciledAt) {
      await recalcLocked(clinicId, accountId, { source, allowDemotion: false, config: cfg });
      return;
    }
    await evaluateAccountTier(clinicId, accountId, source, { allowDemotion: false, config: cfg, account });
  });
}

async function accountOf(clinicId: string, patientId: unknown): Promise<Lean | null> {
  if (!isOid(clinicId) || !patientId || !isOid(String(patientId))) return null;
  return (await LoyaltyAccount.findOne({ clinicId, patientId }).select("_id status progress.reconciledAt").lean()) as Lean | null;
}

const isReconciled = (a: Lean) => !!a.progress?.reconciledAt;

/** An appointment ENTERED "completed". Counts once per appointment. */
export async function onVisitCompleted(appt: { _id: unknown; clinicId: unknown; patientId?: unknown; type?: string; status: string }): Promise<void> {
  try {
    if (appt.type === "blocked" || !appt.patientId || appt.status !== "completed") return;
    const clinicId = String(appt.clinicId);
    const account = await accountOf(clinicId, appt.patientId);
    if (!account) return;
    const accountId = String(account._id);
    if (isReconciled(account)) {
      await withAccountLock(accountId, async () => {
        const key = `visit:${appt._id}`;
        let counted = false;
        try {
          await LoyaltyProgressEvent.create({ clinicId: oid(clinicId), accountId: account._id, kind: "visit", key, active: true });
          counted = true;
        } catch (e) {
          if (!isDup(e)) throw e;
          const r = await LoyaltyProgressEvent.updateOne({ clinicId: oid(clinicId), accountId: account._id, key, active: false }, { $set: { active: true } }); // completed again after being un-completed
          counted = (r.modifiedCount ?? 0) > 0;
        }
        if (counted) await LoyaltyAccount.updateOne({ _id: account._id, clinicId }, { $inc: { "progress.completedVisits": 1 } });
      });
    }
    await afterEvent(clinicId, accountId, "appointment_completed");
  } catch (e) {
    console.error("[loyalty] tier visit hook failed (appointment was NOT affected):", e instanceof Error ? e.message : e);
  }
}

/** An appointment LEFT "completed" (a correction). The visit stops counting; the tier is never lowered by it. */
export async function onVisitUncompleted(appt: { _id: unknown; clinicId: unknown; patientId?: unknown; type?: string }): Promise<void> {
  try {
    if (appt.type === "blocked" || !appt.patientId) return;
    const clinicId = String(appt.clinicId);
    const account = await accountOf(clinicId, appt.patientId);
    if (!account || !isReconciled(account)) return;
    await withAccountLock(String(account._id), async () => {
      const r = await LoyaltyProgressEvent.updateOne({ key: `visit:${appt._id}`, clinicId, active: true }, { $set: { active: false } });
      if ((r.modifiedCount ?? 0) > 0) await LoyaltyAccount.updateOne({ _id: account._id, clinicId, "progress.completedVisits": { $gt: 0 } }, { $inc: { "progress.completedVisits": -1 } });
    });
  } catch (e) {
    console.error("[loyalty] tier un-visit hook failed:", e instanceof Error ? e.message : e);
  }
}

/** A real payment was recorded on an invoice. Counts once per payment, by the amount actually paid. */
export async function onPaymentRecorded(invoice: { _id: unknown; clinicId: unknown; patientId?: unknown; payments: { _id?: unknown; amount: number }[] }, paymentId: string): Promise<void> {
  try {
    const payment = invoice.payments.find((p) => p._id && String(p._id) === paymentId);
    if (!payment || typeof payment.amount !== "number" || !(payment.amount > 0)) return;
    const clinicId = String(invoice.clinicId);
    const account = await accountOf(clinicId, invoice.patientId);
    if (!account) return;
    const accountId = String(account._id);
    const fils = toFils(payment.amount);
    if (isReconciled(account)) {
      await withAccountLock(accountId, async () => {
        try {
          await LoyaltyProgressEvent.create({ clinicId: oid(clinicId), accountId: account._id, kind: "payment", key: `payment:${invoice._id}:${paymentId}`, amountFils: fils, active: true });
        } catch (e) {
          if (isDup(e)) return; // this payment was already counted
          throw e;
        }
        await LoyaltyAccount.updateOne({ _id: account._id, clinicId }, { $inc: { "progress.paidFils": fils } });
      });
    }
    await afterEvent(clinicId, accountId, "payment_recorded");
  } catch (e) {
    console.error("[loyalty] tier payment hook failed (payment was NOT affected):", e instanceof Error ? e.message : e);
  }
}

/** The ledger credited earned points to this account (called by the central ledger after the write). */
export async function onPointsEarned(clinicId: string, accountId: string): Promise<void> {
  try {
    await afterEvent(clinicId, accountId, "points_earned");
  } catch (e) {
    console.error("[loyalty] tier points hook failed (points were NOT affected):", e instanceof Error ? e.message : e);
  }
}

/** A new member: counters are rebuilt from their real history and the tier is assigned. */
export async function onMemberEnrolled(clinicId: string, accountId: string): Promise<void> {
  try {
    await recalculateMember(clinicId, accountId, { source: "member_enrolled", allowDemotion: false });
  } catch (e) {
    console.error("[loyalty] tier enrolment hook failed (enrolment was NOT affected):", e instanceof Error ? e.message : e);
  }
}

/**
 * Phase 9.1 — a patient who activated Loyalty THEMSELVES starts from a clean slate, FROM ENROLMENT FORWARD:
 * the progression counters are set to ZERO and marked reconciled (so no later event or settings change quietly rebuilds them from the
 * patient's old appointments / invoices), then the tier is assigned from those zero counters (the clinic's base tier).
 * Historical visits, payments and spending are NOT imported. Only an explicit, separately-run reconciliation (`mode: "full"`) ever does that.
 * Never throws (enrolment already succeeded).
 */
export async function onMemberEnrolledFresh(clinicId: string, accountId: string): Promise<void> {
  try {
    await withAccountLock(accountId, async () => {
      const fresh = (await LoyaltyAccount.findOneAndUpdate(
        { _id: accountId, clinicId, "progress.reconciledAt": null },
        { $set: { "progress.earnedPoints": 0, "progress.completedVisits": 0, "progress.paidFils": 0, "progress.reconciledAt": new Date() } },
        { new: true }
      ).lean()) as Lean | null;
      const account = fresh ?? ((await LoyaltyAccount.findOne({ _id: accountId, clinicId }).lean()) as Lean | null);
      if (!account) return;
      const cfg = await getTierConfig(clinicId);
      if (isUsable(cfg)) await evaluateAccountTier(clinicId, accountId, "member_enrolled", { allowDemotion: false, config: cfg, account });
    });
  } catch (e) {
    console.error("[loyalty] tier initialisation for a self-enrolled member failed (enrolment was NOT affected):", e instanceof Error ? e.message : e);
  }
}

/* ============================================================
 * Clinic-wide recalculation (settings change / manual reconciliation / backfill)
 * ============================================================ */

export interface ClinicRecalcOptions {
  source: TierHistorySource;
  /** "tiers": re-evaluate (counters rebuilt only for members never reconciled). "full": rebuild every member's counters from the sources. */
  mode: "tiers" | "full";
  dryRun?: boolean;
  /** tiers mode: only members whose tier is missing / was evaluated under older rules (what a settings change leaves behind). */
  onlyStale?: boolean;
  cursor?: string | null;
  maxMembers?: number;
  budgetMs?: number;
  batchSize?: number;
  config?: TierConfig;
}
export interface ClinicRecalcResult {
  processed: number;
  promoted: number;
  demoted: number;
  initial: number;
  unchanged: number;
  countersCorrected: number;
  errors: number;
  errorAccountIds: string[];
  /** members counted by resulting tier (processed members only) */
  distribution: Record<TierKey, number>;
  done: boolean;
  nextCursor: string | null;
  /** members still waiting after this run (stale mode) */
  remaining: number | null;
  dryRun: boolean;
}

const running = new Set<string>();

export async function recalculateClinic(clinicId: string, opts: ClinicRecalcOptions): Promise<ClinicRecalcResult> {
  await assertEntitled(clinicId);
  const cfg = opts.config ?? (await getTierConfig(clinicId));
  if (opts.mode === "tiers" && !isUsable(cfg)) throw new LoyaltyError("TIERS_NOT_READY", "Tiers are switched off or not fully configured", 409);
  if (running.has(clinicId)) throw new LoyaltyError("RECALC_RUNNING", "A recalculation is already running for this clinic — try again in a moment", 409);
  running.add(clinicId);
  const started = Date.now();
  const budget = opts.budgetMs ?? TIER_LIMITS.recalcBudgetMs;
  const maxMembers = opts.maxMembers ?? TIER_LIMITS.recalcMaxMembersPerRequest;
  const batch = opts.batchSize ?? TIER_LIMITS.recalcBatchSize;
  const res: ClinicRecalcResult = {
    processed: 0, promoted: 0, demoted: 0, initial: 0, unchanged: 0, countersCorrected: 0, errors: 0, errorAccountIds: [],
    distribution: { tier1: 0, tier2: 0, tier3: 0, tier4: 0 }, done: false, nextCursor: null, remaining: null, dryRun: !!opts.dryRun,
  };
  const baseFilter = (): Record<string, unknown> => {
    const f: Record<string, unknown> = { clinicId: oid(clinicId) };
    if (opts.mode === "tiers" && opts.onlyStale && !opts.dryRun) {
      f.$or = [{ "progress.reconciledAt": null }, { "tier.key": null }, { "tier.rulesVersion": { $ne: cfg.rulesVersion } }];
    }
    return f;
  };
  try {
    let cursor = opts.cursor && isOid(opts.cursor) ? opts.cursor : null;
    for (;;) {
      const filter = baseFilter();
      if (cursor) filter._id = { $gt: oid(cursor) };
      const accounts = (await LoyaltyAccount.find(filter).sort({ _id: 1 }).limit(batch).select("_id").lean()) as Lean[];
      if (!accounts.length) {
        res.done = true;
        break;
      }
      for (const a of accounts) {
        const id = String(a._id);
        try {
          const r = await recalculateMember(clinicId, id, {
            source: opts.source,
            allowDemotion: true,
            rebuild: opts.mode === "full",
            dryRun: opts.dryRun,
            config: cfg,
          });
          res.processed++;
          if (r) {
            if (r.countersChanged) res.countersCorrected++;
            if (r.tier?.changed) {
              if (r.tier.direction === "promotion") res.promoted++;
              else if (r.tier.direction === "demotion") res.demoted++;
              else res.initial++;
            } else res.unchanged++;
            if (r.resultingTier) res.distribution[r.resultingTier]++;
          }
        } catch (e) {
          res.errors++;
          if (res.errorAccountIds.length < 10) res.errorAccountIds.push(id);
          console.error("[loyalty] tier recalculation failed for one member:", e instanceof Error ? e.message : e);
        }
        cursor = id;
        if (res.processed >= maxMembers || Date.now() - started > budget) break;
      }
      if (res.processed >= maxMembers || Date.now() - started > budget) break;
    }
    res.nextCursor = res.done ? null : cursor;
    if (!res.done) {
      // Honest "how many are left" — only meaningful when the filter shrinks as members get processed (stale mode, real run).
      res.remaining = opts.mode === "tiers" && opts.onlyStale && !opts.dryRun ? await LoyaltyAccount.countDocuments(baseFilter()) : null;
      if (res.remaining === 0) res.done = true;
    } else res.remaining = 0;
  } finally {
    running.delete(clinicId);
  }
  return res;
}

/* ============================================================
 * Configuration: validate + save + recalculate
 * ============================================================ */

export interface TierConfigInput {
  enabled: boolean;
  progressionMetric: TierMetric | null;
  tiers: Record<TierKey, { name: string; threshold?: number | null; description?: string | null; benefits?: { title: string; description?: string | null }[] }>;
}

const invalid = (message: string, field?: string) => new LoyaltyError("TIER_CONFIG_INVALID", message, 400, field ? { field } : undefined);

/** Full server-side validation → the clean config that will be stored (thresholds in INTERNAL units). Throws TIER_CONFIG_INVALID. */
export function validateTierInput(input: TierConfigInput): TierConfig {
  const metric = input.progressionMetric;
  if (metric !== null && !(TIER_METRICS as readonly string[]).includes(metric)) throw invalid("Unknown progression metric", "progressionMetric");
  if (input.enabled && metric === null) throw invalid("Choose what progression is based on before turning tiers on", "progressionMetric");

  const tiers = {} as TierConfig["tiers"];
  const seen = new Map<string, TierKey>();
  for (const key of TIER_KEYS) {
    const t = input.tiers?.[key];
    if (!t) throw invalid("All four tiers must be provided", key);
    const name = checkTierName(String(t.name ?? ""));
    if (!name.ok) throw invalid(`${key}: ${name.message}`, `${key}.name`);
    const lc = name.value.toLocaleLowerCase();
    if (seen.has(lc)) throw invalid("Two tiers can't have the same name", `${key}.name`);
    seen.set(lc, key);

    let description: string | null = null;
    if (t.description !== undefined && t.description !== null && String(t.description).trim() !== "") {
      const d = checkPlainText(String(t.description), TIER_LIMITS.descriptionMax);
      if (!d.ok) throw invalid(`${key} description: ${d.message}`, `${key}.description`);
      description = d.value || null;
    }
    const rawBenefits = t.benefits ?? [];
    if (!Array.isArray(rawBenefits) || rawBenefits.length > TIER_LIMITS.benefitsMax) throw invalid(`A tier can have at most ${TIER_LIMITS.benefitsMax} benefits`, `${key}.benefits`);
    const benefits = rawBenefits.map((b, i) => {
      const title = checkPlainText(String(b?.title ?? ""), TIER_LIMITS.benefitTitleMax, TIER_LIMITS.benefitTitleMin);
      if (!title.ok) throw invalid(`${key} benefit ${i + 1}: ${title.message}`, `${key}.benefits`);
      let desc: string | null = null;
      if (b?.description !== undefined && b.description !== null && String(b.description).trim() !== "") {
        const d = checkPlainText(String(b.description), TIER_LIMITS.benefitDescriptionMax);
        if (!d.ok) throw invalid(`${key} benefit ${i + 1}: ${d.message}`, `${key}.benefits`);
        desc = d.value || null;
      }
      return { title: title.value, description: desc };
    });

    let threshold: number | null;
    if (key === "tier1") {
      if (t.threshold !== undefined && t.threshold !== null && t.threshold !== 0) throw invalid("The first tier is the base tier — its threshold is always 0", "tier1.threshold");
      threshold = 0;
    } else if (t.threshold === undefined || t.threshold === null) {
      threshold = null;
    } else {
      if (metric === null) throw invalid("Choose a progression metric before setting thresholds", "progressionMetric");
      const internal = toInternal(metric, t.threshold);
      if (internal === null) throw invalid(metric === "lifetime_spending" ? "Spending thresholds are in JOD with at most 3 decimals" : "Thresholds must be whole non-negative numbers", `${key}.threshold`);
      threshold = internal;
    }
    tiers[key] = { key, name: name.value, threshold, description, benefits };
  }

  const list = TIER_KEYS.map((k) => tiers[k].threshold);
  const anySet = list.slice(1).some((v) => v !== null);
  if (input.enabled || anySet) {
    if (metric === null) throw invalid("Choose a progression metric", "progressionMetric");
    const err = validateThresholds(metric, list);
    if (err) throw invalid(err, "thresholds");
  }
  return { enabled: input.enabled, metric, rulesVersion: 0, tiers };
}

export interface TierConfigChange {
  enabledChanged: boolean;
  metricChanged: boolean;
  thresholdsChanged: boolean;
  namesChanged: TierKey[];
  textChanged: TierKey[];
  rulesChanged: boolean;
}

export function diffTierConfig(before: TierConfig, after: TierConfig): TierConfigChange {
  const thresholdsChanged = TIER_KEYS.some((k) => before.tiers[k].threshold !== after.tiers[k].threshold);
  const enabledChanged = before.enabled !== after.enabled;
  const metricChanged = before.metric !== after.metric;
  return {
    enabledChanged,
    metricChanged,
    thresholdsChanged,
    namesChanged: TIER_KEYS.filter((k) => before.tiers[k].name !== after.tiers[k].name),
    textChanged: TIER_KEYS.filter((k) => before.tiers[k].description !== after.tiers[k].description || JSON.stringify(before.tiers[k].benefits) !== JSON.stringify(after.tiers[k].benefits)),
    // a change that can alter somebody's tier: tiers switched ON, or (while on) a different metric / different thresholds
    rulesChanged: after.enabled && (!before.enabled || metricChanged || thresholdsChanged),
  };
}

export async function saveTierConfig(clinicId: string, userId: string, input: TierConfigInput) {
  await assertEntitled(clinicId);
  const next = validateTierInput(input);
  const before = await getTierConfig(clinicId);
  const change = diffTierConfig(before, next);

  const $set: Record<string, unknown> = {
    updatedBy: oid(userId),
    "tiers.enabled": next.enabled,
    "tiers.progressionMetric": next.metric,
  };
  for (const k of TIER_KEYS) {
    $set[`tiers.${k}.name`] = next.tiers[k].name;
    $set[`tiers.${k}.threshold`] = next.tiers[k].threshold;
    $set[`tiers.${k}.description`] = next.tiers[k].description;
    $set[`tiers.${k}.benefits`] = next.tiers[k].benefits;
  }
  const $inc: Record<string, number> = change.rulesChanged ? { "tiers.rulesVersion": 1 } : {};
  const touched = new Set([...Object.keys($set), ...Object.keys($inc)]);
  // First save of a clinic: store every other default explicitly, exactly like the Phase 2 settings writer does.
  const $setOnInsert = Object.fromEntries(Object.entries(defaultLeaves(new LoyaltySettings({ clinicId }).toObject())).filter(([p]) => !touched.has(p)));
  const run = () =>
    LoyaltySettings.findOneAndUpdate(
      { clinicId: oid(clinicId) },
      { $set, $setOnInsert, ...(Object.keys($inc).length ? { $inc } : {}) },
      { upsert: true, new: true, runValidators: true }
    ).lean();
  try {
    await run();
  } catch (e: any) {
    if (isDup(e)) await run();
    else throw e;
  }
  const after = await getTierConfig(clinicId);
  let recalculation: ClinicRecalcResult | null = null;
  if (change.rulesChanged && isUsable(after)) {
    // Small clinics finish inside this request; a big one hands back "N remaining" and the owner continues from the UI.
    recalculation = await recalculateClinic(clinicId, { source: "settings_recalculation", mode: "tiers", onlyStale: true, config: after });
  }
  return { before, after, change, recalculation };
}

/**
 * EXACT preview of what a proposed configuration would do to existing members — computed from the stored counters of the
 * members that have been reconciled (nothing is written). Members never reconciled are counted separately instead of guessed.
 */
export async function previewTierConfig(clinicId: string, input: TierConfigInput) {
  await assertEntitled(clinicId);
  const proposed = validateTierInput(input);
  if (!isUsable(proposed)) throw new LoyaltyError("TIERS_NOT_READY", "The proposed configuration is not complete — set the metric and all thresholds first", 409);
  const accounts = (await LoyaltyAccount.find({ clinicId }).sort({ _id: 1 }).limit(TIER_LIMITS.previewMaxMembers + 1).select("progress tier").lean()) as Lean[];
  const truncated = accounts.length > TIER_LIMITS.previewMaxMembers;
  let promoted = 0, demoted = 0, same = 0, unreconciled = 0;
  const distribution = { tier1: 0, tier2: 0, tier3: 0, tier4: 0 } as Record<TierKey, number>;
  for (const a of accounts.slice(0, TIER_LIMITS.previewMaxMembers)) {
    if (!a.progress?.reconciledAt) {
      unreconciled++;
      continue;
    }
    const target = calculateTier(proposed, metricValueOf(proposed.metric as TierMetric, a.progress));
    distribution[target]++;
    const cur = (TIER_KEYS as readonly string[]).includes(a.tier?.key) ? (a.tier.key as TierKey) : null;
    if (cur === null || target === cur) same++;
    else if (tierRank(target) > tierRank(cur)) promoted++;
    else demoted++;
  }
  return { evaluated: accounts.length - unreconciled - (truncated ? 1 : 0), promoted, demoted, same, unreconciled, distribution, exact: unreconciled === 0 && !truncated, truncated };
}

/* ============================================================
 * Reads: history + analytics
 * ============================================================ */

export function historyDto(h: Lean, cfg: TierConfig, patient?: Lean) {
  const metric = h.progressionMetric as TierMetric;
  return {
    id: String(h._id),
    accountId: String(h.accountId),
    patient: patient ? { id: String(patient._id), fullName: patient.fullName, fileNumber: patient.fileNumber } : undefined,
    fromTierKey: h.fromTierKey ?? null,
    toTierKey: h.toTierKey,
    fromTierName: h.fromTierNameSnapshot ?? null, // the name AT THAT TIME
    toTierName: h.toTierNameSnapshot,
    toTierNameNow: cfg.tiers[h.toTierKey as TierKey]?.name ?? h.toTierNameSnapshot,
    direction: h.direction,
    source: h.source,
    metric,
    metricValue: toDisplay(metric, h.metricValueAtChange),
    changedAt: h.changedAt,
  };
}

/** Multi-doctor patient isolation: omitted / null = whole clinic (owner, front desk); an array = only rows of those patients. */
export type PatientScope = Types.ObjectId[] | null | undefined;

export async function listTierHistory(clinicId: string, opts: { accountId?: string; page: number; limit: number; scope?: PatientScope }) {
  const cfg = await getTierConfig(clinicId);
  const filter: Record<string, unknown> = { clinicId: oid(clinicId), ...(opts.scope ? { patientId: { $in: opts.scope } } : {}) };
  if (opts.accountId) filter.accountId = oid(opts.accountId);
  const [rows, total] = await Promise.all([
    LoyaltyTierHistory.find(filter).sort({ changedAt: -1, _id: -1 }).skip((opts.page - 1) * opts.limit).limit(opts.limit).lean(),
    LoyaltyTierHistory.countDocuments(filter),
  ]);
  const ids = [...new Set((rows as Lean[]).map((r) => String(r.patientId)))];
  const patients = ids.length && !opts.accountId ? ((await Patient.find({ _id: { $in: ids }, clinicId }).select("fullName fileNumber").lean()) as Lean[]) : [];
  const pm = new Map(patients.map((p) => [String(p._id), p]));
  return { history: (rows as Lean[]).map((r) => historyDto(r, cfg, pm.get(String(r.patientId)))), total, page: opts.page, pages: Math.ceil(total / opts.limit) };
}

export async function recentTierHistory(clinicId: string, accountId: string, limit = 6) {
  const cfg = await getTierConfig(clinicId);
  const rows = await LoyaltyTierHistory.find({ clinicId, accountId }).sort({ sequence: -1 }).limit(limit).lean();
  return (rows as Lean[]).map((r) => historyDto(r, cfg));
}

export async function tierAnalytics(clinicId: string, scope?: PatientScope) {
  const cfg = await getTierConfig(clinicId);
  const cid = oid(clinicId);
  const since = new Date(Date.now() - TIER_LIMITS.analyticsWindowDays * 86_400_000);
  const usable = isUsable(cfg);
  const [total, dist, unreconciled, promos30, promosByTier, recent] = await Promise.all([
    LoyaltyAccount.countDocuments({ clinicId: cid }),
    LoyaltyAccount.aggregate([{ $match: { clinicId: cid } }, { $group: { _id: "$tier.key", count: { $sum: 1 } } }]),
    LoyaltyAccount.countDocuments({ clinicId: cid, "progress.reconciledAt": null }),
    LoyaltyTierHistory.countDocuments({ clinicId: cid, direction: "promotion", changedAt: { $gte: since } }),
    LoyaltyTierHistory.aggregate([{ $match: { clinicId: cid, direction: "promotion", changedAt: { $gte: since } } }, { $group: { _id: "$toTierKey", count: { $sum: 1 } } }]),
    LoyaltyTierHistory.find({ clinicId: cid, direction: "promotion", ...(scope ? { patientId: { $in: scope } } : {}) }).sort({ changedAt: -1, _id: -1 }).limit(TIER_LIMITS.recentPromotionsCount).lean(), // names: only the caller's patients
  ]);
  const countOf = (k: string | null) => (dist as Lean[]).find((d) => (d._id ?? null) === k)?.count ?? 0;
  const tiers = TIER_KEYS.map((k) => ({
    key: k,
    name: cfg.tiers[k].name,
    count: countOf(k),
    percent: total ? Math.round((countOf(k) / total) * 1000) / 10 : 0,
    promotionsInWindow: (promosByTier as Lean[]).find((d) => d._id === k)?.count ?? 0,
  }));
  const unassigned = countOf(null);

  // Members close to the next tier — computed only from real counters, per non-top tier.
  let nearNext: { total: number; byTier: { key: TierKey; count: number }[] } | null = null;
  if (usable) {
    const metric = cfg.metric as TierMetric;
    const field = METRIC_FIELD[metric];
    const counts: { key: TierKey; count: number }[] = [];
    for (let i = 0; i < TIER_KEYS.length - 1; i++) {
      const lo = cfg.tiers[TIER_KEYS[i]].threshold as number;
      const hi = cfg.tiers[TIER_KEYS[i + 1]].threshold as number;
      const from = Math.ceil(lo + ((hi - lo) * TIER_LIMITS.nearNextPercent) / 100);
      const count = await LoyaltyAccount.countDocuments({ clinicId: cid, "tier.key": TIER_KEYS[i], [field]: { $gte: from, $lt: hi } });
      counts.push({ key: TIER_KEYS[i], count });
    }
    nearNext = { total: counts.reduce((s, c) => s + c.count, 0), byTier: counts };
  }

  const patientIds = [...new Set((recent as Lean[]).map((r) => String(r.patientId)))];
  const patients = patientIds.length ? ((await Patient.find({ _id: { $in: patientIds }, clinicId }).select("fullName fileNumber").lean()) as Lean[]) : [];
  const pm = new Map(patients.map((p) => [String(p._id), p]));
  const staleCount = usable ? await LoyaltyAccount.countDocuments({ clinicId: cid, $or: [{ "tier.key": null }, { "tier.rulesVersion": { $ne: cfg.rulesVersion } }] }) : 0;

  return {
    enabled: usable,
    metric: cfg.metric,
    totalMembers: total,
    tiers,
    unassigned,
    topTier: { key: "tier4" as TierKey, name: cfg.tiers.tier4.name, count: countOf("tier4") },
    promotions: { windowDays: TIER_LIMITS.analyticsWindowDays, count: promos30 },
    nearNext: nearNext ? { ...nearNext, percent: TIER_LIMITS.nearNextPercent } : null,
    recentPromotions: (recent as Lean[]).map((r) => historyDto(r, cfg, pm.get(String(r.patientId)))),
    needsAttention: { unreconciled, awaitingRecalculation: staleCount },
  };
}

