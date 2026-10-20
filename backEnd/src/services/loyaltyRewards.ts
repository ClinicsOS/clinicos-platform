import crypto from "crypto";
import { Types } from "mongoose";
import { LoyaltyAccount } from "../models/LoyaltyAccount";
import { LoyaltyReward, type ILoyaltyReward } from "../models/LoyaltyReward";
import { LoyaltyRedemption, type ILoyaltyRedemption } from "../models/LoyaltyRedemption";
import { LoyaltyTransaction } from "../models/LoyaltyTransaction";
import { Patient } from "../models/Patient";
import { User } from "../models/User";
import { REDEMPTION, REWARD, type RedemptionStatus } from "../config/loyalty";
import { LoyaltyError, assertEntitled, debitPoints, isOid, reverseTransaction } from "./loyaltyService";

/**
 * Rewards + redemptions (Phase 6) — the ONLY place that creates or changes a reward or a redemption.
 *
 * Money-like rules (read these before changing anything):
 *  1. This file NEVER writes a balance. Points move only through the central ledger service:
 *       confirm  → debitPoints({ type: "reward_redemption", sourceType: "reward", sourceId: <redemptionId> })
 *       reverse  → reverseTransaction(<the confirm's ledger row>)   (appends a NEW positive row; history is never edited)
 *     The debit is idempotent per redemption (unique ledger key "reward_redemption:reward:<id>"), a ledger row can be
 *     reversed once (unique `reversesTransactionId`), and balances can't go below zero (atomic guard in the ledger).
 *  2. REQUESTING moves ZERO points. Rejecting moves ZERO points.
 *  3. The amount debited is ALWAYS `pointsCostSnapshot`, copied by the server from the reward when the request was created.
 *     Nothing a client sends is ever an amount, a balance, an account id or a clinic id.
 *  4. Every state change is ONE conditional update with the expected status in the filter. Confirm / reverse first
 *     CLAIM the record (pending → confirming, confirmed → reversing, with a random claim token), then run the ledger
 *     operation, then finalize with the token in the filter. Two staff clicking at once: one wins the claim, the other
 *     gets a 409. A crashed worker leaves a claim that becomes re-claimable after `claimStaleSeconds`; re-running is
 *     harmless because the ledger operation is idempotent.
 *  5. Everything is clinic-scoped: ids from a client are only looked up WITHIN the clinic derived server-side.
 */

/* ============================================================
 * Errors
 * ============================================================ */

export type RewardErrorCode =
  | "REWARD_NOT_FOUND"
  | "REWARD_INVALID"
  | "REWARD_UNAVAILABLE"
  | "REWARD_LIMIT"
  | "REWARD_HAS_HISTORY"
  | "REDEMPTION_NOT_FOUND"
  | "REDEMPTION_NOT_PENDING"
  | "REDEMPTION_NOT_CONFIRMED"
  | "REDEMPTION_LIMIT"
  | "REDEMPTION_QUEUE_FULL";

export class RewardError extends Error {
  constructor(
    public code: RewardErrorCode,
    message: string,
    public status = 400,
    public extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "RewardError";
  }
}

const oid = (v: string | Types.ObjectId) => new Types.ObjectId(String(v));
const CONTROL = /[\u0000-\u001f\u007f]/g;
const clean = (v: string) => v.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
const redemptionKey = (id: string | Types.ObjectId) => `reward_redemption:reward:${String(id)}`;

/* ============================================================
 * Validity dates
 * ============================================================ */

/**
 * Accepts `YYYY-MM-DD` (read as the clinic's local day: start-of-day for validFrom, end-of-day for validUntil) or a full
 * ISO date-time. `null` / "" clears it. Returns a Date or null; throws REWARD_INVALID for anything else.
 */
export function parseValidityDate(v: unknown, edge: "start" | "end", field: string): Date | null {
  if (v === null || v === "") return null;
  if (typeof v !== "string") throw new RewardError("REWARD_INVALID", `${field} must be a date`);
  let d: Date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    d = new Date(`${v}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}${REWARD.clinicUtcOffset}`);
    // reject impossible days such as 2026-02-31 (they would silently roll over)
    const noon = new Date(`${v}T12:00:00${REWARD.clinicUtcOffset}`);
    if (Number.isNaN(d.getTime()) || Number.isNaN(noon.getTime()) || noon.toISOString().slice(0, 10) !== v) throw new RewardError("REWARD_INVALID", `${field} is not a real date`);
  } else {
    d = new Date(v);
  }
  if (Number.isNaN(d.getTime())) throw new RewardError("REWARD_INVALID", `${field} is not a valid date`);
  const y = d.getUTCFullYear();
  if (y < REWARD.yearMin || y > REWARD.yearMax) throw new RewardError("REWARD_INVALID", `${field} is out of range`);
  return d;
}

export function assertValidityRange(validFrom: Date | null, validUntil: Date | null) {
  if (validFrom && validUntil && validUntil.getTime() < validFrom.getTime()) {
    throw new RewardError("REWARD_INVALID", "validUntil cannot be before validFrom");
  }
}

/* ============================================================
 * Eligibility (single source of truth — the frontend only displays it)
 * ============================================================ */

export type IneligibleReason = "REWARD_INACTIVE" | "REWARD_NOT_STARTED" | "REWARD_EXPIRED" | "INSUFFICIENT_BALANCE" | "ACCOUNT_NOT_ACTIVE";

export interface Eligibility {
  eligible: boolean;
  reason: IneligibleReason | null;
  missingPoints: number;
}

/**
 * A member can redeem a reward when: the reward is active, inside its validity window, the member's account is active
 * and the CURRENT balance covers the cost. (Clinic match and the Loyalty entitlement are enforced by the callers that
 * load the reward / account scoped to the clinic and by `assertEntitled`.)
 */
export function evaluateEligibility(
  reward: Pick<ILoyaltyReward, "status" | "pointsRequired" | "validFrom" | "validUntil">,
  account: { status: string; pointsBalance: number },
  now = new Date()
): Eligibility {
  if (reward.status !== "active") return { eligible: false, reason: "REWARD_INACTIVE", missingPoints: 0 };
  if (reward.validFrom && now.getTime() < new Date(reward.validFrom).getTime()) return { eligible: false, reason: "REWARD_NOT_STARTED", missingPoints: 0 };
  if (reward.validUntil && now.getTime() > new Date(reward.validUntil).getTime()) return { eligible: false, reason: "REWARD_EXPIRED", missingPoints: 0 };
  if (account.status !== "active") return { eligible: false, reason: "ACCOUNT_NOT_ACTIVE", missingPoints: 0 };
  if (account.pointsBalance < reward.pointsRequired) return { eligible: false, reason: "INSUFFICIENT_BALANCE", missingPoints: reward.pointsRequired - account.pointsBalance };
  return { eligible: true, reason: null, missingPoints: 0 };
}

/* ============================================================
 * Rewards (clinic catalog)
 * ============================================================ */

export interface RewardView {
  id: string;
  name: string;
  description: string;
  pointsRequired: number;
  status: string;
  validFrom: Date | null;
  validUntil: Date | null;
  /** "open" now / "scheduled" (not started) / "expired" — derived from the window, for display. */
  window: "open" | "scheduled" | "expired";
  createdAt: Date;
  updatedAt: Date;
  /** Real counts of this reward's redemptions (only on list / get). */
  counts?: { pending: number; confirmed: number; rejected: number; reversed: number; total: number };
}

function windowOf(r: { validFrom?: Date | null; validUntil?: Date | null }, now = new Date()): RewardView["window"] {
  if (r.validFrom && now.getTime() < new Date(r.validFrom).getTime()) return "scheduled";
  if (r.validUntil && now.getTime() > new Date(r.validUntil).getTime()) return "expired";
  return "open";
}

export function rewardView(r: Record<string, any>, counts?: RewardView["counts"]): RewardView {
  return {
    id: String(r._id),
    name: r.name,
    description: r.description ?? "",
    pointsRequired: r.pointsRequired,
    status: r.status,
    validFrom: r.validFrom ?? null,
    validUntil: r.validUntil ?? null,
    window: windowOf(r),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(counts ? { counts } : {}),
  };
}

async function countsFor(clinicId: string, rewardIds: Types.ObjectId[]): Promise<Map<string, NonNullable<RewardView["counts"]>>> {
  const out = new Map<string, NonNullable<RewardView["counts"]>>();
  if (!rewardIds.length) return out;
  const rows = await LoyaltyRedemption.aggregate([
    { $match: { clinicId: oid(clinicId), rewardId: { $in: rewardIds } } },
    { $group: { _id: { r: "$rewardId", s: "$status" }, n: { $sum: 1 } } },
  ]);
  for (const row of rows) {
    const key = String(row._id.r);
    const c = out.get(key) ?? { pending: 0, confirmed: 0, rejected: 0, reversed: 0, total: 0 };
    const s = row._id.s as RedemptionStatus;
    const bucket = s === "pending" || s === "confirming" ? "pending" : s === "confirmed" || s === "reversing" ? "confirmed" : s;
    (c as any)[bucket] += row.n;
    c.total += row.n;
    out.set(key, c);
  }
  return out;
}

export async function listRewards(clinicId: string, opts: { status?: "active" | "inactive" } = {}): Promise<RewardView[]> {
  const filter: Record<string, unknown> = { clinicId: oid(clinicId) };
  if (opts.status) filter.status = opts.status;
  const docs = await LoyaltyReward.find(filter).sort({ status: 1, pointsRequired: 1, createdAt: -1 }).limit(REWARD.maxPerClinic).lean();
  const counts = await countsFor(clinicId, docs.map((d) => d._id as Types.ObjectId));
  const empty = { pending: 0, confirmed: 0, rejected: 0, reversed: 0, total: 0 };
  return docs.map((d) => rewardView(d, counts.get(String(d._id)) ?? empty));
}

async function loadReward(clinicId: string, rewardId: string) {
  if (!isOid(rewardId)) throw new RewardError("REWARD_NOT_FOUND", "Reward not found", 404);
  const doc = await LoyaltyReward.findOne({ _id: oid(rewardId), clinicId: oid(clinicId) });
  if (!doc) throw new RewardError("REWARD_NOT_FOUND", "Reward not found", 404);
  return doc;
}

export async function getReward(clinicId: string, rewardId: string): Promise<RewardView> {
  const doc = await loadReward(clinicId, rewardId);
  const counts = await countsFor(clinicId, [doc._id as Types.ObjectId]);
  return rewardView(doc.toObject(), counts.get(String(doc._id)) ?? { pending: 0, confirmed: 0, rejected: 0, reversed: 0, total: 0 });
}

export interface RewardInput {
  name: string;
  description?: string;
  pointsRequired: number;
  validFrom?: string | null;
  validUntil?: string | null;
}

export async function createReward(clinicId: string, input: RewardInput, userId: string): Promise<RewardView> {
  await assertEntitled(clinicId);
  const total = await LoyaltyReward.countDocuments({ clinicId: oid(clinicId) });
  if (total >= REWARD.maxPerClinic) throw new RewardError("REWARD_LIMIT", `A clinic can have at most ${REWARD.maxPerClinic} rewards. Deactivate unused ones instead.`, 409);
  const validFrom = parseValidityDate(input.validFrom ?? null, "start", "validFrom");
  const validUntil = parseValidityDate(input.validUntil ?? null, "end", "validUntil");
  assertValidityRange(validFrom, validUntil);
  const doc = await LoyaltyReward.create({
    clinicId: oid(clinicId),
    name: clean(input.name),
    description: clean(input.description ?? ""),
    pointsRequired: input.pointsRequired,
    status: "active",
    validFrom,
    validUntil,
    createdBy: oid(userId),
    updatedBy: oid(userId),
  });
  return rewardView(doc.toObject(), { pending: 0, confirmed: 0, rejected: 0, reversed: 0, total: 0 });
}

export type RewardChanges = Partial<RewardInput>;

/** Edit a reward. Pending / historical redemptions keep their snapshots; only NEW requests use the new values. */
export async function updateReward(clinicId: string, rewardId: string, input: RewardChanges, userId: string): Promise<{ reward: RewardView; changed: string[] }> {
  await assertEntitled(clinicId);
  const doc = await loadReward(clinicId, rewardId);
  const set: Record<string, unknown> = {};
  const changed: string[] = [];
  if (input.name !== undefined && clean(input.name) !== doc.name) (set.name = clean(input.name)), changed.push("name");
  if (input.description !== undefined && clean(input.description) !== (doc.description ?? "")) (set.description = clean(input.description)), changed.push("description");
  if (input.pointsRequired !== undefined && input.pointsRequired !== doc.pointsRequired) (set.pointsRequired = input.pointsRequired), changed.push("pointsRequired");
  let validFrom = doc.validFrom ?? null;
  let validUntil = doc.validUntil ?? null;
  if (input.validFrom !== undefined) {
    validFrom = parseValidityDate(input.validFrom, "start", "validFrom");
    if ((validFrom?.getTime() ?? null) !== (doc.validFrom?.getTime() ?? null)) (set.validFrom = validFrom), changed.push("validFrom");
  }
  if (input.validUntil !== undefined) {
    validUntil = parseValidityDate(input.validUntil, "end", "validUntil");
    if ((validUntil?.getTime() ?? null) !== (doc.validUntil?.getTime() ?? null)) (set.validUntil = validUntil), changed.push("validUntil");
  }
  assertValidityRange(validFrom, validUntil);
  if (changed.length) {
    set.updatedBy = oid(userId);
    await LoyaltyReward.updateOne({ _id: doc._id, clinicId: oid(clinicId) }, { $set: set });
  }
  return { reward: await getReward(clinicId, rewardId), changed };
}

export async function setRewardStatus(clinicId: string, rewardId: string, status: "active" | "inactive", userId: string): Promise<{ reward: RewardView; changed: boolean }> {
  await assertEntitled(clinicId);
  const doc = await loadReward(clinicId, rewardId);
  const changed = doc.status !== status;
  if (changed) await LoyaltyReward.updateOne({ _id: doc._id, clinicId: oid(clinicId) }, { $set: { status, updatedBy: oid(userId) } });
  return { reward: await getReward(clinicId, rewardId), changed };
}

/** Hard delete is only possible while NOTHING ever referenced the reward; otherwise it must be deactivated (history stays). */
export async function deleteRewardIfUnused(clinicId: string, rewardId: string): Promise<RewardView> {
  await assertEntitled(clinicId);
  const doc = await loadReward(clinicId, rewardId);
  const used = await LoyaltyRedemption.exists({ clinicId: oid(clinicId), rewardId: doc._id });
  if (used) throw new RewardError("REWARD_HAS_HISTORY", "This reward already has redemption history, so it cannot be deleted. Deactivate it instead.", 409);
  const view = rewardView(doc.toObject());
  await LoyaltyReward.deleteOne({ _id: doc._id, clinicId: oid(clinicId) });
  return view;
}

/* ============================================================
 * Redemption — shapes
 * ============================================================ */

/** The two internal claim states are shown as what they effectively are. */
const displayStatus = (s: string) => (s === "confirming" ? "pending" : s === "reversing" ? "confirmed" : s);

export interface RedemptionRow {
  id: string;
  status: "pending" | "confirmed" | "rejected" | "reversed";
  /** true while a confirm / reversal is running right now. */
  busy: boolean;
  rewardId: string;
  rewardNameSnapshot: string;
  pointsCostSnapshot: number;
  currentReward: { name: string; pointsRequired: number; status: string } | null;
  requestedAt: Date;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  reversedAt: Date | null;
  confirmedBy: { id: string; name: string | null } | null;
  rejectedBy: { id: string; name: string | null } | null;
  reversedBy: { id: string; name: string | null } | null;
  rejectionReason: string | null;
  reversalReason: string | null;
  transactionId: string | null;
  reversalTransactionId: string | null;
  accountId: string;
  patient: { id: string; fullName: string; phone: string; fileNumber: number } | null;
  /** Member's balance RIGHT NOW. */
  balance: number | null;
  /** Only for open requests: balance − cost (display only; the server re-checks on confirm). */
  balanceAfter: number | null;
  canAfford: boolean | null;
}

async function toRows(clinicId: string, docs: Record<string, any>[]): Promise<RedemptionRow[]> {
  const cid = oid(clinicId);
  const ids = (key: string) => [...new Set(docs.map((d) => d[key]).filter(Boolean).map(String))];
  const actorIds = [...new Set(docs.flatMap((d) => [d.confirmedBy, d.rejectedBy, d.reversedBy]).filter(Boolean).map(String))];
  const [patients, accounts, rewards, actors] = await Promise.all([
    ids("patientId").length ? Patient.find({ _id: { $in: ids("patientId") }, clinicId: cid }).select("fullName phone fileNumber").lean() : Promise.resolve([]),
    ids("accountId").length ? LoyaltyAccount.find({ _id: { $in: ids("accountId") }, clinicId: cid }).select("pointsBalance").lean() : Promise.resolve([]),
    ids("rewardId").length ? LoyaltyReward.find({ _id: { $in: ids("rewardId") }, clinicId: cid }).select("name pointsRequired status").lean() : Promise.resolve([]),
    actorIds.length ? User.find({ _id: { $in: actorIds }, clinicId: cid }).select("name").lean() : Promise.resolve([]),
  ]);
  const pm = new Map(patients.map((p) => [String(p._id), p as Record<string, any>]));
  const am = new Map(accounts.map((a) => [String(a._id), a as Record<string, any>]));
  const rm = new Map(rewards.map((r) => [String(r._id), r as Record<string, any>]));
  const um = new Map(actors.map((u) => [String(u._id), u as Record<string, any>]));
  const actor = (id: unknown) => (id ? { id: String(id), name: um.get(String(id))?.name ?? null } : null);
  return docs.map((d) => {
    const status = displayStatus(d.status) as RedemptionRow["status"];
    const p = pm.get(String(d.patientId));
    const r = rm.get(String(d.rewardId));
    const bal = am.get(String(d.accountId))?.pointsBalance ?? null;
    const open = status === "pending";
    return {
      id: String(d._id),
      status,
      busy: d.status === "confirming" || d.status === "reversing",
      rewardId: String(d.rewardId),
      rewardNameSnapshot: d.rewardNameSnapshot,
      pointsCostSnapshot: d.pointsCostSnapshot,
      currentReward: r ? { name: r.name, pointsRequired: r.pointsRequired, status: r.status } : null,
      requestedAt: d.requestedAt,
      confirmedAt: d.confirmedAt ?? null,
      rejectedAt: d.rejectedAt ?? null,
      reversedAt: d.reversedAt ?? null,
      confirmedBy: actor(d.confirmedBy),
      rejectedBy: actor(d.rejectedBy),
      reversedBy: actor(d.reversedBy),
      rejectionReason: d.rejectionReason ?? null,
      reversalReason: d.reversalReason ?? null,
      transactionId: d.transactionId ? String(d.transactionId) : null,
      reversalTransactionId: d.reversalTransactionId ? String(d.reversalTransactionId) : null,
      accountId: String(d.accountId),
      patient: p ? { id: String(p._id), fullName: p.fullName, phone: p.phone, fileNumber: p.fileNumber } : null,
      balance: bal,
      balanceAfter: open && bal !== null ? bal - d.pointsCostSnapshot : null,
      canAfford: open && bal !== null ? bal >= d.pointsCostSnapshot : null,
    };
  });
}

async function rowFor(clinicId: string, id: string | Types.ObjectId): Promise<RedemptionRow> {
  const doc = await LoyaltyRedemption.findOne({ _id: oid(id), clinicId: oid(clinicId) }).lean();
  if (!doc) throw new RewardError("REDEMPTION_NOT_FOUND", "Redemption request not found", 404);
  return (await toRows(clinicId, [doc]))[0];
}

/* ============================================================
 * Redemption — member side (public Loyalty session)
 * ============================================================ */

export interface MemberReward {
  id: string;
  name: string;
  description: string;
  pointsRequired: number;
  validUntil: Date | null;
  canRedeem: boolean;
  missingPoints: number;
  /** The member already has an open request for this reward. */
  pending: boolean;
}

export interface MemberRequestRow {
  id: string;
  rewardName: string;
  points: number;
  status: "pending" | "confirmed" | "rejected" | "reversed";
  requestedAt: Date;
  resolvedAt: Date | null;
}

/** Active, currently valid rewards of THIS clinic with the member's eligibility, plus the member's own latest requests. */
export async function listForMember(clinicId: string, accountId: string): Promise<{ balance: number; rewards: MemberReward[]; requests: MemberRequestRow[] }> {
  const cid = oid(clinicId);
  const aid = oid(accountId);
  const now = new Date();
  const account = await LoyaltyAccount.findOne({ _id: aid, clinicId: cid }).select("status pointsBalance").lean();
  if (!account) throw new LoyaltyError("ACCOUNT_NOT_FOUND", "Loyalty account not found", 404);
  const [docs, open, recent] = await Promise.all([
    LoyaltyReward.find({ clinicId: cid, status: "active" }).sort({ pointsRequired: 1, createdAt: -1 }).limit(REWARD.maxPerClinic).lean(),
    LoyaltyRedemption.find({ clinicId: cid, accountId: aid, status: { $in: ["pending", "confirming"] } }).select("rewardId").lean(),
    LoyaltyRedemption.find({ clinicId: cid, accountId: aid }).sort({ requestedAt: -1, _id: -1 }).limit(REDEMPTION.patientRecentCount).lean(),
  ]);
  const openSet = new Set(open.map((o) => String(o.rewardId)));
  const rewards: MemberReward[] = [];
  for (const r of docs) {
    if (windowOf(r, now) !== "open") continue; // not started / expired rewards are not offered
    const e = evaluateEligibility(r, account, now);
    rewards.push({
      id: String(r._id),
      name: r.name,
      description: r.description ?? "",
      pointsRequired: r.pointsRequired,
      validUntil: r.validUntil ?? null,
      canRedeem: e.eligible && !openSet.has(String(r._id)),
      missingPoints: e.missingPoints,
      pending: openSet.has(String(r._id)),
    });
  }
  const requests: MemberRequestRow[] = recent.map((d) => {
    const st = displayStatus(d.status) as MemberRequestRow["status"];
    const resolvedAt = st === "confirmed" ? d.confirmedAt : st === "rejected" ? d.rejectedAt : st === "reversed" ? d.reversedAt : null;
    return { id: String(d._id), rewardName: d.rewardNameSnapshot, points: d.pointsCostSnapshot, status: st, requestedAt: d.requestedAt, resolvedAt: resolvedAt ?? null };
  });
  return { balance: account.pointsBalance, rewards, requests };
}

export type RequestState = "created" | "already_pending";

/**
 * The member asks for a reward. Validates everything server-side, copies name + cost into the request and creates a
 * PENDING redemption. NO points move. Idempotent: an open request for the same reward is returned instead of a second one.
 */
export async function requestRedemption(input: { clinicId: string; accountId: string; rewardId: string }): Promise<{ redemption: ILoyaltyRedemption; state: RequestState; balance: number }> {
  await assertEntitled(input.clinicId);
  if (!isOid(input.rewardId)) throw new RewardError("REWARD_NOT_FOUND", "Reward not found", 404);
  const cid = oid(input.clinicId);
  const aid = oid(input.accountId);
  const now = new Date();

  const account = await LoyaltyAccount.findOne({ _id: aid, clinicId: cid }).select("status pointsBalance patientId").lean();
  if (!account) throw new LoyaltyError("ACCOUNT_NOT_FOUND", "Loyalty account not found", 404);
  if (account.status !== "active") throw new LoyaltyError("ACCOUNT_NOT_ACTIVE", "This Loyalty account is not active", 409);
  const patient = await Patient.findOne({ _id: account.patientId, clinicId: cid }).select("isArchived").lean();
  if (!patient || patient.isArchived) throw new LoyaltyError("PATIENT_ARCHIVED", "This membership is not available", 409);

  const reward = await LoyaltyReward.findOne({ _id: oid(input.rewardId), clinicId: cid }).lean();
  if (!reward) throw new RewardError("REWARD_NOT_FOUND", "Reward not found", 404);

  // An open request for this reward is returned as-is (double tap / refresh / retry) — even if the reward changed since.
  const activeKey = `${input.accountId}:${input.rewardId}`;
  const existing = await LoyaltyRedemption.findOne({ clinicId: cid, accountId: aid, rewardId: reward._id, status: { $in: ["pending", "confirming"] } });
  if (existing) return { redemption: existing, state: "already_pending", balance: account.pointsBalance };

  const e = evaluateEligibility(reward, account, now);
  if (!e.eligible) {
    if (e.reason === "INSUFFICIENT_BALANCE") {
      throw new LoyaltyError("INSUFFICIENT_BALANCE", "You don't have enough points for this reward yet", 409, { balance: account.pointsBalance, required: reward.pointsRequired, missingPoints: e.missingPoints });
    }
    throw new RewardError("REWARD_UNAVAILABLE", "This reward is not available right now", 409, { reason: e.reason });
  }

  const [open, last24h, queue] = await Promise.all([
    LoyaltyRedemption.countDocuments({ clinicId: cid, accountId: aid, status: { $in: ["pending", "confirming"] } }),
    LoyaltyRedemption.countDocuments({ accountId: aid, requestedAt: { $gte: new Date(now.getTime() - 24 * 3_600_000) } }),
    LoyaltyRedemption.countDocuments({ clinicId: cid, status: { $in: ["pending", "confirming"] } }),
  ]);
  if (open >= REDEMPTION.maxPendingPerAccount) throw new RewardError("REDEMPTION_LIMIT", "You already have several requests waiting. Please ask reception.", 429);
  if (last24h >= REDEMPTION.maxRequestsPerAccountPer24h) throw new RewardError("REDEMPTION_LIMIT", "Too many requests today. Please ask reception.", 429);
  if (queue >= REDEMPTION.maxPendingPerClinic) throw new RewardError("REDEMPTION_QUEUE_FULL", "Rewards are very busy right now. Please ask reception.", 503);

  try {
    const created = await LoyaltyRedemption.create({
      clinicId: cid,
      rewardId: reward._id,
      accountId: aid,
      patientId: account.patientId,
      rewardNameSnapshot: reward.name, // snapshots are copied by the SERVER, from the reward in this clinic
      pointsCostSnapshot: reward.pointsRequired,
      status: "pending",
      activeKey,
      requestedAt: now,
    });
    return { redemption: created, state: "created", balance: account.pointsBalance };
  } catch (err: any) {
    if (err?.code === 11000) {
      const winner = await LoyaltyRedemption.findOne({ clinicId: cid, accountId: aid, rewardId: reward._id, status: { $in: ["pending", "confirming"] } });
      if (winner) return { redemption: winner, state: "already_pending", balance: account.pointsBalance };
    }
    throw err;
  }
}

/* ============================================================
 * Redemption — desk side
 * ============================================================ */

/**
 * `scope` (multi-doctor patient isolation): omitted / null = whole clinic (owner, front desk); an array = only the requests of those
 * patients (a doctor never sees, counts or resolves another doctor's patient's request).
 */
export type PatientScope = Types.ObjectId[] | null | undefined;
const scoped = (scope: PatientScope): Record<string, unknown> => (scope ? { patientId: { $in: scope } } : {});

export async function countPendingRedemptions(clinicId: string, scope?: PatientScope): Promise<number> {
  return LoyaltyRedemption.countDocuments({ clinicId: oid(clinicId), status: { $in: ["pending", "confirming"] }, ...scoped(scope) });
}

/** The queue: open requests, oldest first. */
export async function listPendingRedemptions(clinicId: string, scope?: PatientScope): Promise<{ rows: RedemptionRow[]; total: number }> {
  const filter = { clinicId: oid(clinicId), status: { $in: ["pending", "confirming"] }, ...scoped(scope) };
  const [docs, total] = await Promise.all([LoyaltyRedemption.find(filter).sort({ requestedAt: 1, _id: 1 }).limit(REDEMPTION.pendingListMax).lean(), LoyaltyRedemption.countDocuments(filter)]);
  return { rows: await toRows(clinicId, docs), total };
}

export interface HistoryFilter {
  status?: "pending" | "confirmed" | "rejected" | "reversed";
  rewardId?: string;
  accountId?: string;
  q?: string;
  /** YYYY-MM-DD, inclusive, clinic-local days. */
  from?: string;
  to?: string;
  page: number;
  limit: number;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** History: resolved requests by default (confirmed / rejected / reversed), newest first, paged and filterable. */
export async function listRedemptionHistory(clinicId: string, f: HistoryFilter, scope?: PatientScope): Promise<{ rows: RedemptionRow[]; total: number; page: number; pages: number }> {
  const cid = oid(clinicId);
  const filter: Record<string, any> = { clinicId: cid, ...scoped(scope) };
  if (f.status === "pending") filter.status = { $in: ["pending", "confirming"] };
  else if (f.status === "confirmed") filter.status = { $in: ["confirmed", "reversing"] };
  else if (f.status) filter.status = f.status;
  else filter.status = { $in: ["confirmed", "reversing", "rejected", "reversed"] };
  if (f.rewardId) filter.rewardId = oid(f.rewardId);
  if (f.accountId) filter.accountId = oid(f.accountId);
  if (f.from || f.to) {
    filter.requestedAt = {};
    if (f.from) filter.requestedAt.$gte = parseValidityDate(f.from, "start", "from");
    if (f.to) filter.requestedAt.$lte = parseValidityDate(f.to, "end", "to");
  }
  if (f.q) {
    const q = clean(f.q).slice(0, 60);
    if (q) {
      const or: Record<string, unknown>[] = [{ fullName: { $regex: escapeRe(q), $options: "i" } }, { phone: { $regex: escapeRe(q) } }];
      if (/^\d{1,9}$/.test(q)) or.push({ fileNumber: Number(q) });
      const matches = await Patient.find({ clinicId: cid, ...(scope ? { _id: { $in: scope } } : {}), $or: or }).select("_id").limit(200).lean();
      filter.patientId = { $in: matches.map((m) => m._id) }; // already inside the caller's scope (the patient search above was)
    }
  }
  const [docs, total] = await Promise.all([
    LoyaltyRedemption.find(filter)
      .sort({ requestedAt: -1, _id: -1 })
      .skip((f.page - 1) * f.limit)
      .limit(f.limit)
      .lean(),
    LoyaltyRedemption.countDocuments(filter),
  ]);
  return { rows: await toRows(clinicId, docs), total, page: f.page, pages: Math.ceil(total / f.limit) };
}

/** Real numbers only. */
export async function rewardsSummary(clinicId: string) {
  const cid = oid(clinicId);
  const [activeRewards, pending, confirmed, redeemedAgg, recent] = await Promise.all([
    LoyaltyReward.countDocuments({ clinicId: cid, status: "active" }),
    countPendingRedemptions(clinicId),
    LoyaltyRedemption.countDocuments({ clinicId: cid, status: { $in: ["confirmed", "reversing"] } }),
    LoyaltyRedemption.aggregate([{ $match: { clinicId: cid, status: { $in: ["confirmed", "reversing"] } } }, { $group: { _id: null, points: { $sum: "$pointsCostSnapshot" } } }]),
    LoyaltyRedemption.find({ clinicId: cid, status: { $in: ["confirmed", "reversing", "rejected", "reversed"] } }).sort({ requestedAt: -1, _id: -1 }).limit(5).lean(),
  ]);
  return { activeRewards, pending, confirmed, pointsRedeemed: redeemedAgg[0]?.points ?? 0, recent: await toRows(clinicId, recent) };
}

/* ============================================================
 * Confirm / reject / reverse
 * ============================================================ */

const newToken = () => crypto.randomBytes(12).toString("hex");

async function loadRedemption(clinicId: string, id: string, scope?: PatientScope) {
  if (!isOid(id)) throw new RewardError("REDEMPTION_NOT_FOUND", "Redemption request not found", 404);
  const doc = await LoyaltyRedemption.findOne({ _id: oid(id), clinicId: oid(clinicId), ...scoped(scope) }).lean();
  if (!doc) throw new RewardError("REDEMPTION_NOT_FOUND", "Redemption request not found", 404);
  return doc;
}

const notPending = (status: string) => new RewardError("REDEMPTION_NOT_PENDING", "This request was already handled", 409, { status: displayStatus(status) });

/** True when the ledger already holds this redemption's debit. */
const debitExists = async (clinicId: string, redemptionId: string) => !!(await LoyaltyTransaction.exists({ clinicId: oid(clinicId), idempotencyKey: redemptionKey(redemptionId) }));

export interface ConfirmResult {
  redemption: RedemptionRow;
  /** Values come from the ledger row that was written, not from the client. */
  points: number;
  balanceBefore: number;
  balanceAfter: number;
  transactionId: string;
}

/**
 * Staff confirm that the reward was given → deduct `pointsCostSnapshot` through the ledger. See the file header for the
 * claim / debit / finalize sequence. If the member can't afford it any more the request stays pending (nothing moved).
 */
export async function confirmRedemption(input: { clinicId: string; redemptionId: string; userId: string; scope?: PatientScope }): Promise<ConfirmResult> {
  const { clinicId, userId } = input;
  const doc = await loadRedemption(clinicId, input.redemptionId, input.scope);
  if (doc.status === "confirmed" || doc.status === "rejected" || doc.status === "reversed" || doc.status === "reversing") throw notPending(doc.status);
  await assertEntitled(clinicId);

  const now = new Date();
  const token = newToken();
  const stale = new Date(now.getTime() - REDEMPTION.claimStaleSeconds * 1000);
  const claimed = await LoyaltyRedemption.findOneAndUpdate(
    { _id: doc._id, clinicId: oid(clinicId), $or: [{ status: "pending" }, { status: "confirming", claimedAt: { $lte: stale } }] },
    { $set: { status: "confirming", claimToken: token, claimedAt: now } },
    { new: true }
  ).lean();
  if (!claimed) {
    const cur = await LoyaltyRedemption.findOne({ _id: doc._id, clinicId: oid(clinicId) }).select("status").lean();
    throw notPending(cur?.status ?? "pending");
  }

  const release = async () => {
    // Only hand the request back when NO debit exists for it (otherwise the claim stays and a retry finalizes it).
    if (await debitExists(clinicId, String(claimed._id))) return;
    await LoyaltyRedemption.updateOne({ _id: claimed._id, clinicId: oid(clinicId), status: "confirming", claimToken: token }, { $set: { status: "pending" }, $unset: { claimToken: 1, claimedAt: 1 } });
  };

  let ledger;
  try {
    const account = await LoyaltyAccount.findOne({ _id: claimed.accountId, clinicId: oid(clinicId) }).select("status patientId").lean();
    if (!account) throw new LoyaltyError("ACCOUNT_NOT_FOUND", "Loyalty account not found", 404);
    if (account.status !== "active") throw new LoyaltyError("ACCOUNT_NOT_ACTIVE", "This Loyalty account is not active", 409);
    const patient = await Patient.findOne({ _id: account.patientId, clinicId: oid(clinicId) }).select("isArchived").lean();
    if (!patient || patient.isArchived) throw new LoyaltyError("PATIENT_ARCHIVED", "This membership is not available", 409);

    ledger = await debitPoints({
      clinicId,
      accountId: String(claimed.accountId),
      type: "reward_redemption",
      points: claimed.pointsCostSnapshot, // the SNAPSHOT — never the reward's current cost, never a client value
      sourceType: "reward",
      sourceId: String(claimed._id),
      metadata: { redemptionId: String(claimed._id), rewardName: claimed.rewardNameSnapshot },
      actorId: userId,
    });
  } catch (e) {
    await release().catch(() => undefined);
    throw e;
  }

  let done;
  try {
    done = await LoyaltyRedemption.findOneAndUpdate(
      { _id: claimed._id, clinicId: oid(clinicId), status: "confirming", claimToken: token },
      { $set: { status: "confirmed", confirmedAt: new Date(), confirmedBy: oid(userId), transactionId: ledger.transaction._id }, $unset: { activeKey: 1, claimToken: 1, claimedAt: 1 } },
      { new: true }
    ).lean();
  } catch (e: any) {
    if (e?.code === 11000) throw notPending("confirmed");
    throw e;
  }
  if (!done) {
    // Another actor finalized it (e.g. took over a stale claim). The ledger holds exactly one debit either way.
    const cur = await LoyaltyRedemption.findOne({ _id: claimed._id, clinicId: oid(clinicId) }).select("status").lean();
    throw notPending(cur?.status ?? "confirmed");
  }
  return {
    redemption: (await toRows(clinicId, [done]))[0],
    points: claimed.pointsCostSnapshot,
    balanceBefore: ledger.transaction.balanceBefore,
    balanceAfter: ledger.transaction.balanceAfter,
    transactionId: String(ledger.transaction._id),
  };
}

function cleanReason(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new RewardError("REWARD_INVALID", "reason must be text");
  const s = clean(v);
  if (!s) return null;
  if (s.length > max) throw new RewardError("REWARD_INVALID", `reason is limited to ${max} characters`);
  return s;
}

/** Staff reject an open request. ZERO points move; the request is kept (status "rejected"). */
export async function rejectRedemption(input: { clinicId: string; redemptionId: string; userId: string; reason?: string | null; scope?: PatientScope }): Promise<RedemptionRow> {
  const { clinicId } = input;
  const reason = cleanReason(input.reason, REDEMPTION.rejectionReasonMax);
  const doc = await loadRedemption(clinicId, input.redemptionId, input.scope);
  await assertEntitled(clinicId);
  const res = await LoyaltyRedemption.findOneAndUpdate(
    { _id: doc._id, clinicId: oid(clinicId), status: "pending" },
    { $set: { status: "rejected", rejectedAt: new Date(), rejectedBy: oid(input.userId), rejectionReason: reason }, $unset: { activeKey: 1, claimToken: 1, claimedAt: 1 } },
    { new: true }
  ).lean();
  if (!res) {
    const cur = await LoyaltyRedemption.findOne({ _id: doc._id, clinicId: oid(clinicId) }).select("status").lean();
    throw notPending(cur?.status ?? "pending");
  }
  return (await toRows(clinicId, [res]))[0];
}

export interface ReverseResult {
  redemption: RedemptionRow;
  points: number;
  balanceBefore: number;
  balanceAfter: number;
  reversalTransactionId: string;
}

/**
 * Give the points of a CONFIRMED redemption back. Appends a NEW positive ledger row linked to the original (which is
 * never edited). A redemption can be reversed once: the claim guards the record, and the ledger's unique
 * `reversesTransactionId` guards the row.
 */
export async function reverseRedemption(input: { clinicId: string; redemptionId: string; userId: string; reason: string; scope?: PatientScope }): Promise<ReverseResult> {
  const { clinicId, userId } = input;
  const reason = cleanReason(input.reason, 300);
  if (!reason || reason.length < 3) throw new RewardError("REWARD_INVALID", "A reason (at least 3 characters) is required to reverse a redemption");
  const doc = await loadRedemption(clinicId, input.redemptionId, input.scope);
  if (doc.status === "reversed") throw new RewardError("REDEMPTION_NOT_CONFIRMED", "This redemption was already reversed", 409, { status: "reversed" });
  if (doc.status === "pending" || doc.status === "confirming" || doc.status === "rejected") {
    throw new RewardError("REDEMPTION_NOT_CONFIRMED", "Only a confirmed redemption can be reversed", 409, { status: displayStatus(doc.status) });
  }
  await assertEntitled(clinicId);

  const now = new Date();
  const token = newToken();
  const stale = new Date(now.getTime() - REDEMPTION.claimStaleSeconds * 1000);
  const claimed = await LoyaltyRedemption.findOneAndUpdate(
    { _id: doc._id, clinicId: oid(clinicId), transactionId: { $exists: true }, $or: [{ status: "confirmed" }, { status: "reversing", claimedAt: { $lte: stale } }] },
    { $set: { status: "reversing", claimToken: token, claimedAt: now } },
    { new: true }
  ).lean();
  if (!claimed || !claimed.transactionId) {
    const cur = await LoyaltyRedemption.findOne({ _id: doc._id, clinicId: oid(clinicId) }).select("status").lean();
    throw new RewardError("REDEMPTION_NOT_CONFIRMED", cur?.status === "reversed" ? "This redemption was already reversed" : "This redemption is being processed or cannot be reversed", 409, { status: displayStatus(cur?.status ?? "confirmed") });
  }

  const reversalRow = () => LoyaltyTransaction.findOne({ clinicId: oid(clinicId), reversesTransactionId: claimed.transactionId }).lean();
  const release = async () => {
    if (await reversalRow()) return; // the credit already exists → a retry finalizes, never release
    await LoyaltyRedemption.updateOne({ _id: claimed._id, clinicId: oid(clinicId), status: "reversing", claimToken: token }, { $set: { status: "confirmed" }, $unset: { claimToken: 1, claimedAt: 1 } });
  };

  let tx: Record<string, any>;
  try {
    try {
      const r = await reverseTransaction({ clinicId, transactionId: String(claimed.transactionId), reason, actorId: userId });
      tx = r.transaction;
    } catch (e) {
      // A previous (crashed) attempt may already have written the credit — pick it up instead of failing.
      if (e instanceof LoyaltyError && e.code === "ALREADY_REVERSED") {
        const existing = await reversalRow();
        if (!existing) throw e;
        tx = existing;
      } else throw e;
    }
  } catch (e) {
    await release().catch(() => undefined);
    throw e;
  }

  let done;
  try {
    done = await LoyaltyRedemption.findOneAndUpdate(
      { _id: claimed._id, clinicId: oid(clinicId), status: "reversing", claimToken: token },
      { $set: { status: "reversed", reversedAt: new Date(), reversedBy: oid(userId), reversalReason: reason, reversalTransactionId: tx._id }, $unset: { claimToken: 1, claimedAt: 1 } },
      { new: true }
    ).lean();
  } catch (e: any) {
    if (e?.code === 11000) throw new RewardError("REDEMPTION_NOT_CONFIRMED", "This redemption was already reversed", 409, { status: "reversed" });
    throw e;
  }
  if (!done) throw new RewardError("REDEMPTION_NOT_CONFIRMED", "This redemption was already reversed", 409, { status: "reversed" });
  return {
    redemption: (await toRows(clinicId, [done]))[0],
    points: claimed.pointsCostSnapshot,
    balanceBefore: tx.balanceBefore,
    balanceAfter: tx.balanceAfter,
    reversalTransactionId: String(tx._id),
  };
}

export { rowFor as getRedemptionRow };
