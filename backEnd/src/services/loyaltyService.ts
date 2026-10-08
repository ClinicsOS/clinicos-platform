import mongoose, { Types, type ClientSession } from "mongoose";
import { Clinic } from "../models/Clinic";
import { Patient } from "../models/Patient";
import { LoyaltyAccount } from "../models/LoyaltyAccount";
import { LoyaltyTransaction } from "../models/LoyaltyTransaction";
import { LoyaltySettings } from "../models/LoyaltySettings";
import { LoyaltyCheckIn } from "../models/LoyaltyCheckIn";
import { LoyaltyReward } from "../models/LoyaltyReward";
import { LoyaltyRedemption } from "../models/LoyaltyRedemption";
import { hasAddon } from "./addons";
import { LoyaltyTierHistory } from "../models/LoyaltyTierHistory";
import { LoyaltyProgressEvent } from "../models/LoyaltyProgressEvent";
import {
  CREDIT_TYPES,
  DEBIT_TYPES,
  EARN_SOURCE_TYPES,
  TIER_EARNING_TYPES,
  IDEMPOTENT_EARN_TYPES,
  LOYALTY_SOURCE_TYPES,
  LOYALTY_TECHNICAL_LIMITS as LIMITS,
  REASON_REQUIRED_TYPES,
  type EnrollmentSource,
  type LoyaltySourceType,
  type LoyaltyTransactionType,
} from "../config/loyalty";

/**
 * THE ONLY place allowed to change a Loyalty balance.
 *
 *  - Controllers never touch `pointsBalance` / lifetime counters. They call creditPoints / debitPoints /
 *    reverseTransaction, which (1) verify the Loyalty add-on is ACTIVE (reusing Phase 1's `hasAddon`),
 *    (2) validate, (3) change the cached balance with ONE atomic conditional `$inc`, and (4) write the immutable
 *    ledger row that explains it.
 *  - Every operation also verifies clinic scope: the account must belong to `clinicId` (derived by the caller
 *    from the authenticated user — never from the client).
 *
 * ── Concurrency / atomicity (see the Phase 2 report for the full discussion) ─────────────────────────────
 *  1. Atomic balance guard: the account update is a single-document conditional `findOneAndUpdate`
 *     (`pointsBalance >= amount` for debits). MongoDB guarantees single-document atomicity, so two concurrent
 *     debits can never both succeed against the same funds — across processes and instances.
 *  2. Balance + ledger together: when the deployment is a replica set / mongos (Atlas always is) both writes
 *     run inside one MongoDB transaction → all-or-nothing. On a standalone mongod (local dev) transactions do
 *     not exist, so we fall back to: atomic $inc → insert ledger row → if the insert fails, an immediate
 *     compensating $inc. A hard process crash between the two writes can still leave a missing ledger row in the
 *     fallback path; `account.seq` (incremented with every change) vs the ledger row count makes that
 *     detectable (`reconcileAccount`).
 *  3. A per-account in-process queue serialises operations on the same account inside one Node process, which
 *     keeps the fallback path strictly ordered on a single instance. It is a defence-in-depth layer, NOT a
 *     substitute for (1)/(2) when several instances run.
 *
 * ── Manual adjustments ───────────────────────────────────────────────────────────────────────────────────
 *  `creditPoints` / `debitPoints` support manual_credit / manual_debit, but Phase 2 deliberately exposes NO route
 *  or UI for them: point rules are undecided, and a casual "set any balance" button would force those decisions.
 */

/* ============================================================
 * Errors
 * ============================================================ */

export type LoyaltyErrorCode =
  | "ENTITLEMENT_REQUIRED"
  | "PROGRAM_DISABLED"
  | "PATIENT_NOT_FOUND"
  | "PATIENT_ARCHIVED"
  | "ALREADY_ENROLLED"
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_NOT_ACTIVE"
  | "INSUFFICIENT_BALANCE"
  | "BALANCE_LIMIT"
  | "INVALID_AMOUNT"
  | "INVALID_TYPE"
  | "INVALID_SOURCE"
  | "INVALID_REASON"
  | "INVALID_METADATA"
  | "TRANSACTION_NOT_FOUND"
  | "ALREADY_REVERSED"
  | "NOT_REVERSIBLE"
  | "LEDGER_INCONSISTENT"
  // Tiers (Phase 7)
  | "TIER_CONFIG_INVALID"
  | "TIERS_NOT_READY"
  | "RECALC_RUNNING";

export class LoyaltyError extends Error {
  constructor(
    public code: LoyaltyErrorCode,
    message: string,
    public status = 400,
    public extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LoyaltyError";
  }
}

/* ============================================================
 * Helpers
 * ============================================================ */

const OID = /^[a-f0-9]{24}$/i;
export const isOid = (v: unknown): v is string => typeof v === "string" && OID.test(v);
const oid = (v: string) => new Types.ObjectId(v);

/** Throws unless the clinic currently holds an ACTIVE Loyalty entitlement (Phase 1 rules incl. account state/period). */
export async function assertEntitled(clinicId: string): Promise<void> {
  if (!isOid(clinicId)) throw new LoyaltyError("ENTITLEMENT_REQUIRED", "Loyalty is not active for this clinic", 402);
  const clinic = await Clinic.findById(clinicId).select("status planExpiresAt addons").lean();
  if (!clinic || !hasAddon(clinic as never, "loyalty")) {
    throw new LoyaltyError("ENTITLEMENT_REQUIRED", "ClinicOS Loyalty is not active for this clinic", 402, { addon: "loyalty" });
  }
}

const CONTROL = /[\u0000-\u001f\u007f]/g;
function cleanText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new LoyaltyError("INVALID_REASON", "reason must be text");
  const s = v.replace(CONTROL, " ").trim();
  return s.length ? s : null;
}

/** Flat, bounded, primitive-only metadata. Rejects operators (`$…`), dotted keys, nesting and oversized values. */
export function sanitizeMetadata(input: unknown): Record<string, string | number | boolean | null> | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new LoyaltyError("INVALID_METADATA", "metadata must be a flat object");
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > LIMITS.metadataMaxKeys) throw new LoyaltyError("INVALID_METADATA", `metadata allows at most ${LIMITS.metadataMaxKeys} keys`);
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(k)) throw new LoyaltyError("INVALID_METADATA", `invalid metadata key "${k.slice(0, 20)}"`);
    if (v === null || typeof v === "boolean") out[k] = v;
    else if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new LoyaltyError("INVALID_METADATA", "metadata numbers must be finite");
      out[k] = v;
    } else if (typeof v === "string") {
      if (v.length > LIMITS.metadataMaxStringLength) throw new LoyaltyError("INVALID_METADATA", "metadata value too long");
      out[k] = v.replace(CONTROL, " ");
    } else throw new LoyaltyError("INVALID_METADATA", "metadata values must be string, number, boolean or null");
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Effect of a movement on the lifetime counters. For a reversal this is called with the ORIGINAL type and the inverse delta.
 *   earned / redeemed  the Phase 2 informational counters (unchanged semantics)
 *   progress           Phase 7 tier progression: ONLY earn_visit / earn_spending (and the reversal of one of those). Manual credits,
 *                      corrections, redemptions and the reversal of a redemption never move it (see config TIER_EARNING_TYPES).
 */
export function counterEffect(type: LoyaltyTransactionType, delta: number): { earned: number; redeemed: number; progress: number } {
  return {
    earned: (CREDIT_TYPES as readonly string[]).includes(type) ? delta : 0,
    redeemed: type === "reward_redemption" ? -delta : 0,
    progress: (TIER_EARNING_TYPES as readonly string[]).includes(type) ? delta : 0,
  };
}

/* ============================================================
 * Per-account in-process queue (defence in depth — see header)
 * ============================================================ */

const locks = new Map<string, Promise<unknown>>();
export function withAccountLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

/* ============================================================
 * Transaction support detection
 * ============================================================ */

let txSupport: boolean | null = null;

/** True when the connected deployment is a replica set / sharded cluster (MongoDB multi-document transactions). */
export async function supportsTransactions(): Promise<boolean> {
  if (process.env.LOYALTY_TRANSACTIONS === "off") return false; // operational kill-switch
  if (txSupport !== null) return txSupport;
  try {
    const admin = mongoose.connection.db!.admin();
    const hello = (await admin.command({ hello: 1 }).catch(() => admin.command({ isMaster: 1 }))) as { setName?: string; msg?: string };
    txSupport = !!(hello.setName || hello.msg === "isdbgrid");
  } catch {
    txSupport = false;
  }
  return txSupport;
}
export const __resetTransactionSupportCache = () => {
  txSupport = null;
};
const isTxUnsupported = (e: any) =>
  e?.code === 20 || /Transaction numbers are only allowed|transactions? (are|is) not supported|replica set member or mongos/i.test(String(e?.message));

/* ============================================================
 * Ledger write (the single balance-mutation path)
 * ============================================================ */

interface Normalized {
  clinicId: Types.ObjectId;
  accountId: Types.ObjectId;
  type: LoyaltyTransactionType;
  delta: number;
  sourceType: LoyaltySourceType;
  sourceId: string | null;
  idempotencyKey?: string;
  reverses?: Types.ObjectId;
  reason: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  actorId: Types.ObjectId | null;
  counter: { earned: number; redeemed: number; progress: number };
}

export interface LedgerResult {
  account: Record<string, any>;
  transaction: Record<string, any>;
  /** True when the same source had already earned — nothing was changed and the existing row is returned. */
  duplicate: boolean;
}

async function updateAccount(n: Normalized, session?: ClientSession) {
  const filter: Record<string, unknown> = { _id: n.accountId, clinicId: n.clinicId, status: "active" };
  // Atomic guards: never below zero, never above the technical ceiling.
  filter.pointsBalance = n.delta < 0 ? { $gte: -n.delta } : { $lte: LIMITS.maxBalance - n.delta };

  const inc: Record<string, number> = { pointsBalance: n.delta, seq: 1, lifetimePointsEarned: n.counter.earned, lifetimePointsRedeemed: n.counter.redeemed };
  if (n.counter.progress !== 0) inc["progress.earnedPoints"] = n.counter.progress; // tier progression (Phase 7) — same atomic write as the balance
  const account = await LoyaltyAccount.findOneAndUpdate(
    filter,
    {
      $inc: inc,
      $set: { lastActivityAt: new Date() },
    },
    { new: true, session }
  ).lean();
  if (account) return account;

  // The guard rejected it — find out why (clinic-scoped lookup, so it also catches foreign / unknown ids).
  const cur = await LoyaltyAccount.findOne({ _id: n.accountId, clinicId: n.clinicId }).select("status pointsBalance").lean();
  if (!cur) throw new LoyaltyError("ACCOUNT_NOT_FOUND", "Loyalty account not found", 404);
  if (cur.status !== "active") throw new LoyaltyError("ACCOUNT_NOT_ACTIVE", "This Loyalty account is not active", 409);
  if (n.delta < 0) {
    throw new LoyaltyError("INSUFFICIENT_BALANCE", "Not enough points for this movement", 409, { balance: cur.pointsBalance, requested: -n.delta });
  }
  throw new LoyaltyError("BALANCE_LIMIT", "This movement would exceed the maximum balance", 409);
}

async function insertLedgerRow(n: Normalized, account: Record<string, any>, session?: ClientSession) {
  const [row] = await LoyaltyTransaction.create(
    [
      {
        clinicId: n.clinicId,
        accountId: n.accountId,
        patientId: account.patientId,
        type: n.type,
        pointsDelta: n.delta,
        balanceBefore: account.pointsBalance - n.delta,
        balanceAfter: account.pointsBalance,
        seq: account.seq,
        sourceType: n.sourceType,
        sourceId: n.sourceId,
        idempotencyKey: n.idempotencyKey,
        reversesTransactionId: n.reverses,
        reason: n.reason,
        metadata: n.metadata,
        createdBy: n.actorId,
      },
    ],
    { session }
  );
  return row.toObject();
}

/** Existing row for a duplicate source + the current account — used when the unique key says "already earned". */
async function resolveDuplicate(err: any, n: Normalized): Promise<LedgerResult | null> {
  if (err?.code !== 11000) return null;
  const text = `${JSON.stringify(err.keyPattern ?? {})} ${err.message ?? ""}`;
  if (/reversesTransactionId/.test(text)) throw new LoyaltyError("ALREADY_REVERSED", "This transaction has already been reversed", 409);
  if (/idempotencyKey/.test(text) && n.idempotencyKey) {
    const [transaction, account] = await Promise.all([
      LoyaltyTransaction.findOne({ clinicId: n.clinicId, idempotencyKey: n.idempotencyKey }).lean(),
      LoyaltyAccount.findOne({ _id: n.accountId, clinicId: n.clinicId }).lean(),
    ]);
    if (transaction && account) return { account, transaction, duplicate: true };
  }
  return null;
}

async function writeInTransaction(n: Normalized): Promise<LedgerResult> {
  const session = await mongoose.startSession();
  try {
    let out!: LedgerResult;
    await session.withTransaction(async () => {
      const account = await updateAccount(n, session);
      const transaction = await insertLedgerRow(n, account, session);
      out = { account, transaction, duplicate: false };
    });
    return out;
  } finally {
    await session.endSession();
  }
}

async function writeWithCompensation(n: Normalized): Promise<LedgerResult> {
  const account = await updateAccount(n);
  try {
    const transaction = await insertLedgerRow(n, account);
    return { account, transaction, duplicate: false };
  } catch (err) {
    // The balance moved but the ledger row did not land → undo the balance immediately.
    try {
      await LoyaltyAccount.updateOne(
        { _id: n.accountId, clinicId: n.clinicId },
        {
          $inc: {
            pointsBalance: -n.delta,
            lifetimePointsEarned: -n.counter.earned,
            lifetimePointsRedeemed: -n.counter.redeemed,
            ...(n.counter.progress !== 0 ? { "progress.earnedPoints": -n.counter.progress } : {}),
          },
        }
      );
    } catch (undoErr) {
      console.error("[loyalty] LEDGER INCONSISTENT — compensation failed", { accountId: String(n.accountId), delta: n.delta, undoErr });
      throw new LoyaltyError("LEDGER_INCONSISTENT", "Loyalty ledger needs attention — contact support", 500);
    }
    const dup = await resolveDuplicate(err, n);
    if (dup) return dup;
    throw err;
  }
}

async function writeLedger(n: Normalized): Promise<LedgerResult> {
  if (await supportsTransactions()) {
    try {
      return await writeInTransaction(n);
    } catch (err) {
      if (isTxUnsupported(err)) txSupport = false; // deployment can't do it after all → use the fallback below
      else {
        const dup = await resolveDuplicate(err, n);
        if (dup) return dup;
        throw err;
      }
    }
  }
  return writeWithCompensation(n);
}

async function runLedgerOp(
  clinicId: string,
  accountId: string,
  prepare: () => Promise<Normalized | { duplicate: LedgerResult }>
): Promise<LedgerResult> {
  if (!isOid(clinicId)) throw new LoyaltyError("ENTITLEMENT_REQUIRED", "Loyalty is not active for this clinic", 402);
  if (!isOid(accountId)) throw new LoyaltyError("ACCOUNT_NOT_FOUND", "Loyalty account not found", 404);
  await assertEntitled(clinicId);
  let earnedUp = false;
  const result = await withAccountLock(accountId, async () => {
    const prepared = await prepare();
    if ("duplicate" in prepared) return prepared.duplicate;
    const written = await writeLedger(prepared);
    // Earned points went UP → the member may have reached a tier (Phase 7). Evaluated after the ledger write and outside the lock;
    // the tier engine never throws into this path and never touches the balance.
    earnedUp = prepared.counter.progress > 0 && !written.duplicate;
    return written;
  });
  if (earnedUp) {
    try {
      const { onPointsEarned } = await import("./loyaltyTiers"); // lazy: loyaltyTiers imports this module
      await onPointsEarned(clinicId, accountId);
    } catch (e) {
      console.error("[loyalty] tier evaluation after earning failed (points were NOT affected):", e instanceof Error ? e.message : e);
    }
  }
  return result;
}

/* ============================================================
 * Public point operations
 * ============================================================ */

export interface PointsInput {
  clinicId: string;
  accountId: string;
  type: LoyaltyTransactionType;
  /** POSITIVE magnitude; the sign is decided by creditPoints / debitPoints. */
  points: number;
  sourceType?: LoyaltySourceType;
  sourceId?: string | null;
  reason?: string | null;
  metadata?: unknown;
  actorId?: string | null;
}

function normalize(input: PointsInput, sign: 1 | -1): Normalized {
  if (!isOid(input.clinicId)) throw new LoyaltyError("ENTITLEMENT_REQUIRED", "Loyalty is not active for this clinic", 402);
  if (!isOid(input.accountId)) throw new LoyaltyError("ACCOUNT_NOT_FOUND", "Loyalty account not found", 404);
  const allowed = sign === 1 ? [...CREDIT_TYPES, "correction"] : [...DEBIT_TYPES, "correction"];
  if (!allowed.includes(input.type)) {
    throw new LoyaltyError("INVALID_TYPE", `${input.type} cannot be used to ${sign === 1 ? "credit" : "debit"} points`);
  }
  const p = input.points;
  if (typeof p !== "number" || !Number.isSafeInteger(p) || p <= 0 || p > LIMITS.maxPointsPerTransaction) {
    throw new LoyaltyError("INVALID_AMOUNT", `points must be a whole number between 1 and ${LIMITS.maxPointsPerTransaction}`);
  }
  const sourceType = input.sourceType ?? "manual";
  if (!(LOYALTY_SOURCE_TYPES as readonly string[]).includes(sourceType)) throw new LoyaltyError("INVALID_SOURCE", "unknown source type");
  let sourceId: string | null = null;
  if (input.sourceId !== undefined && input.sourceId !== null) {
    if (typeof input.sourceId !== "string" || !/^[A-Za-z0-9_\-:.]{1,64}$/.test(input.sourceId)) throw new LoyaltyError("INVALID_SOURCE", "invalid sourceId");
    sourceId = input.sourceId;
  }
  const idempotent = (IDEMPOTENT_EARN_TYPES as readonly string[]).includes(input.type);
  if (idempotent && (!sourceId || !(EARN_SOURCE_TYPES as readonly string[]).includes(sourceType))) {
    throw new LoyaltyError("INVALID_SOURCE", `${input.type} must name its source (invoice / appointment / check-in) so it can never earn twice`);
  }
  const reason = cleanText(input.reason);
  if ((REASON_REQUIRED_TYPES as readonly string[]).includes(input.type) && (!reason || reason.length < LIMITS.reasonMinLength)) {
    throw new LoyaltyError("INVALID_REASON", `a reason (at least ${LIMITS.reasonMinLength} characters) is required for ${input.type}`);
  }
  if (reason && reason.length > LIMITS.reasonMaxLength) throw new LoyaltyError("INVALID_REASON", `reason is limited to ${LIMITS.reasonMaxLength} characters`);
  if (input.actorId && !isOid(input.actorId)) throw new LoyaltyError("INVALID_SOURCE", "invalid actor");
  const delta = sign * p;
  return {
    clinicId: oid(input.clinicId),
    accountId: oid(input.accountId),
    type: input.type,
    delta,
    sourceType,
    sourceId,
    // Earning rows are idempotent per source (above). A reward REDEMPTION debit is idempotent per redemption record too
    // (Phase 6): "reward_redemption:reward:<redemptionId>" is unique, so the same redemption can never be deducted twice.
    idempotencyKey: idempotent
      ? `${input.type}:${sourceType}:${sourceId}`
      : input.type === "reward_redemption" && sourceType === "reward" && sourceId
        ? `reward_redemption:reward:${sourceId}`
        : undefined,
    reason,
    metadata: sanitizeMetadata(input.metadata),
    actorId: input.actorId ? oid(input.actorId) : null,
    counter: counterEffect(input.type, delta),
  };
}

async function postPoints(input: PointsInput, sign: 1 | -1): Promise<LedgerResult> {
  const n = normalize(input, sign);
  return runLedgerOp(input.clinicId, input.accountId, async () => {
    if (n.idempotencyKey) {
      const existing = await LoyaltyTransaction.findOne({ clinicId: n.clinicId, idempotencyKey: n.idempotencyKey }).lean();
      if (existing) {
        const account = await LoyaltyAccount.findOne({ _id: n.accountId, clinicId: n.clinicId }).lean();
        if (account) return { duplicate: { account, transaction: existing, duplicate: true } };
      }
    }
    return n;
  });
}

/** Add points. Types: earn_visit, earn_spending, manual_credit, correction. NOT wired to any route in Phase 2. */
export const creditPoints = (input: PointsInput) => postPoints(input, 1);
/** Remove points (never below zero). Types: manual_debit, reward_redemption, expiration, correction. NOT wired to any route in Phase 2. */
export const debitPoints = (input: PointsInput) => postPoints(input, -1);

/**
 * Undo a ledger row by appending its inverse (history is never edited). A row can be reversed once, a reversal
 * cannot itself be reversed (post a correction instead), and — like every debit — a reversal can't push the
 * balance below zero.
 */
export async function reverseTransaction(input: {
  clinicId: string;
  transactionId: string;
  reason: string;
  actorId?: string | null;
}): Promise<LedgerResult> {
  if (!isOid(input.clinicId)) throw new LoyaltyError("ENTITLEMENT_REQUIRED", "Loyalty is not active for this clinic", 402);
  if (!isOid(input.transactionId)) throw new LoyaltyError("TRANSACTION_NOT_FOUND", "Transaction not found", 404);
  const reason = cleanText(input.reason);
  if (!reason || reason.length < LIMITS.reasonMinLength) throw new LoyaltyError("INVALID_REASON", `a reason (at least ${LIMITS.reasonMinLength} characters) is required to reverse a transaction`);
  if (reason.length > LIMITS.reasonMaxLength) throw new LoyaltyError("INVALID_REASON", `reason is limited to ${LIMITS.reasonMaxLength} characters`);
  if (input.actorId && !isOid(input.actorId)) throw new LoyaltyError("INVALID_SOURCE", "invalid actor");

  const first = await LoyaltyTransaction.findOne({ _id: input.transactionId, clinicId: input.clinicId }).select("accountId").lean();
  if (!first) throw new LoyaltyError("TRANSACTION_NOT_FOUND", "Transaction not found", 404);

  return runLedgerOp(input.clinicId, String(first.accountId), async () => {
    const orig = await LoyaltyTransaction.findOne({ _id: input.transactionId, clinicId: input.clinicId }).lean();
    if (!orig) throw new LoyaltyError("TRANSACTION_NOT_FOUND", "Transaction not found", 404);
    if (orig.type === "reversal") throw new LoyaltyError("NOT_REVERSIBLE", "A reversal cannot be reversed — post a correction instead", 409);
    if (await LoyaltyTransaction.exists({ clinicId: input.clinicId, reversesTransactionId: orig._id })) {
      throw new LoyaltyError("ALREADY_REVERSED", "This transaction has already been reversed", 409);
    }
    const delta = -orig.pointsDelta;
    return {
      clinicId: oid(input.clinicId),
      accountId: orig.accountId as Types.ObjectId,
      type: "reversal" as const,
      delta,
      sourceType: "system" as const,
      sourceId: String(orig._id),
      reverses: orig._id as Types.ObjectId,
      reason,
      metadata: { reversedType: orig.type, reversedSeq: orig.seq },
      actorId: input.actorId ? oid(input.actorId) : null,
      // un-earn / un-redeem: apply the ORIGINAL type's counter effect with the inverse delta
      counter: counterEffect(orig.type, delta),
    };
  });
}

/* ============================================================
 * Integrity check (operations / tests — not an API)
 * ============================================================ */

export interface Reconciliation {
  ok: boolean;
  balance: number;
  ledgerSum: number;
  ledgerCount: number;
  seq: number;
  /** seq − ledgerCount: > 0 means a balance change happened without its ledger row (fallback-path crash window). */
  missingEntries: number;
  lifetimePointsEarned: number;
  lifetimePointsRedeemed: number;
  expectedEarned: number;
  expectedRedeemed: number;
}

export async function reconcileAccount(clinicId: string, accountId: string): Promise<Reconciliation | null> {
  const account = await LoyaltyAccount.findOne({ _id: accountId, clinicId }).lean();
  if (!account) return null;
  const rows = await LoyaltyTransaction.find({ clinicId, accountId }).select("type pointsDelta reversesTransactionId").lean();
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  let sum = 0;
  let earned = 0;
  let redeemed = 0;
  for (const r of rows) {
    sum += r.pointsDelta;
    const original = r.reversesTransactionId ? byId.get(String(r.reversesTransactionId)) : null;
    const eff = counterEffect(original ? original.type : r.type, r.pointsDelta);
    earned += eff.earned;
    redeemed += eff.redeemed;
  }
  const missingEntries = account.seq - rows.length;
  return {
    ok: sum === account.pointsBalance && missingEntries === 0 && earned === account.lifetimePointsEarned && redeemed === account.lifetimePointsRedeemed,
    balance: account.pointsBalance,
    ledgerSum: sum,
    ledgerCount: rows.length,
    seq: account.seq,
    missingEntries,
    lifetimePointsEarned: account.lifetimePointsEarned,
    lifetimePointsRedeemed: account.lifetimePointsRedeemed,
    expectedEarned: earned,
    expectedRedeemed: redeemed,
  };
}

/* ============================================================
 * Settings
 * ============================================================ */

export type SettingsView = Record<string, any>;

const isPlainObject = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Types.ObjectId);

/** Defaults filled in underneath whatever is stored, so an unset value always reads as `null` / `false`, never `undefined`. */
function withDefaults(defaults: Record<string, any>, stored: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = { ...defaults };
  for (const [k, v] of Object.entries(stored)) out[k] = isPlainObject(v) && isPlainObject(defaults[k]) ? withDefaults(defaults[k], v) : v;
  return out;
}

/** Every default leaf as a dotted path, e.g. { "earning.visits.enabled": false, "earning.visits.pointsPerVisit": null, … }. */
export function defaultLeaves(obj: Record<string, any>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!prefix && ["_id", "__v", "clinicId", "createdAt", "updatedAt", "updatedBy"].includes(k)) continue;
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v)) Object.assign(out, defaultLeaves(v, path));
    else out[path] = v;
  }
  return out;
}

/** Stored settings, or the schema defaults when the clinic has never saved any (nothing is written by reading). */
export async function getSettings(clinicId: string): Promise<{ settings: SettingsView; persisted: boolean }> {
  const defaults = new LoyaltySettings({ clinicId }).toObject() as Record<string, any>;
  const stored = await LoyaltySettings.findOne({ clinicId }).lean();
  if (stored) return { settings: withDefaults(defaults, stored), persisted: true };
  return { settings: defaults, persisted: false };
}

export interface SettingsPatch {
  program?: { enabled?: boolean };
  checkin?: { enabled?: boolean };
  branding?: { displayName?: string | null };
  earning?: {
    visits?: { enabled?: boolean; pointsPerVisit?: number | null };
    spending?: { enabled?: boolean; spendAmount?: number | null; pointsPerSpendAmount?: number | null };
  };
}

export async function updateSettings(clinicId: string, patch: SettingsPatch, userId: string) {
  const before = (await getSettings(clinicId)).settings;
  const $set: Record<string, unknown> = { updatedBy: oid(userId) };
  if (patch.program?.enabled !== undefined) $set["program.enabled"] = patch.program.enabled;
  if (patch.branding && "displayName" in patch.branding) $set["branding.displayName"] = patch.branding.displayName ?? null;
  if (patch.checkin?.enabled !== undefined) $set["checkin.enabled"] = patch.checkin.enabled;

  const v = patch.earning?.visits;
  if (v) {
    if (v.enabled !== undefined) $set["earning.visits.enabled"] = v.enabled;
    if ("pointsPerVisit" in v) $set["earning.visits.pointsPerVisit"] = v.pointsPerVisit ?? null;
  }
  const sp = patch.earning?.spending;
  if (sp) {
    if (sp.enabled !== undefined) $set["earning.spending.enabled"] = sp.enabled;
    if ("spendAmount" in sp) $set["earning.spending.spendAmount"] = sp.spendAmount ?? null;
    if ("pointsPerSpendAmount" in sp) $set["earning.spending.pointsPerSpendAmount"] = sp.pointsPerSpendAmount ?? null;
    // NO RETROACTIVE POINTS: the moment spending earning is switched on or its rule changes, remember it.
    // Only payments made from now on can earn under the new rule.
    const bs = before.earning?.spending ?? {};
    const nextEnabled = sp.enabled ?? !!bs.enabled;
    const nextAmount = "spendAmount" in sp ? sp.spendAmount ?? null : bs.spendAmount ?? null;
    const nextPoints = "pointsPerSpendAmount" in sp ? sp.pointsPerSpendAmount ?? null : bs.pointsPerSpendAmount ?? null;
    if (nextEnabled && (!bs.enabled || nextAmount !== (bs.spendAmount ?? null) || nextPoints !== (bs.pointsPerSpendAmount ?? null))) {
      $set["earning.spending.activatedAt"] = new Date();
    }
  }

  // On first save, store EVERY default explicitly (nulls / false) so the document is complete and no value is ever "missing".
  const $setOnInsert = Object.fromEntries(Object.entries(defaultLeaves(new LoyaltySettings({ clinicId }).toObject())).filter(([path]) => !(path in $set)));
  const run = () =>
    LoyaltySettings.findOneAndUpdate({ clinicId: oid(clinicId) }, { $set, $setOnInsert }, { upsert: true, new: true, runValidators: true }).lean();
  let after;
  try {
    after = await run();
  } catch (e: any) {
    if (e?.code === 11000) after = await run(); // two first-time saves raced; the second just updates
    else throw e;
  }
  const defaults = new LoyaltySettings({ clinicId }).toObject() as Record<string, any>;
  return { before, after: withDefaults(defaults, after as Record<string, any>) as SettingsView };
}

/* ============================================================
 * Enrolment
 * ============================================================ */

export interface EnrollInput {
  clinicId: string;
  patientId: string;
  /** The staff user who enrolled the patient; null/absent for a self-enrolment. */
  enrolledBy?: string | null;
  /** Defaults to "clinic" (staff). The public page passes "self_enrollment". */
  source?: EnrollmentSource;
  /**
   * What the member's tier progression starts from.
   *   "rebuild" (staff enrolment, unchanged since Phase 7): counters are rebuilt from the patient's real history.
   *   "fresh"   (self-enrolment, Phase 9.1): ZERO — only what happens from enrolment forward counts. No retroactive points, no retroactive tier.
   */
  history?: "rebuild" | "fresh";
}

/**
 * The ONE authoritative way a Loyalty account is created (staff enrolment and patient self-enrolment both end up here).
 * It enforces: entitlement, program switched on, patient exists IN THIS CLINIC and is not archived, one account per
 * (clinic, patient), 0 starting points (no welcome bonus, no ledger row), source, timestamps and the tier initialisation.
 *
 *   mode "strict"  a second enrolment of the same patient is a clear conflict (ALREADY_ENROLLED, with the existing account id)
 *   mode "ensure"  find-or-create: returns the existing account (created = false) instead of failing — safe to call concurrently
 */
async function enrollCore(input: EnrollInput, mode: "strict" | "ensure"): Promise<{ account: any; created: boolean }> {
  await assertEntitled(input.clinicId);
  if (!isOid(input.patientId)) throw new LoyaltyError("PATIENT_NOT_FOUND", "Patient not found", 404);

  const { settings } = await getSettings(input.clinicId);
  if (!settings.program?.enabled) {
    throw new LoyaltyError("PROGRAM_DISABLED", "The Loyalty program is switched off — turn it on in Loyalty settings before enrolling members", 409);
  }

  // Clinic-scoped: a patient id from another clinic is simply "not found".
  const patient = await Patient.findOne({ _id: input.patientId, clinicId: input.clinicId }).select("isArchived").lean();
  if (!patient) throw new LoyaltyError("PATIENT_NOT_FOUND", "Patient not found", 404);
  if (patient.isArchived) throw new LoyaltyError("PATIENT_ARCHIVED", "Archived patients can't be enrolled", 409);

  const source: EnrollmentSource = input.source ?? "clinic";
  const fresh = (input.history ?? "rebuild") === "fresh";

  // Three layers against a duplicate account for one patient at one clinic:
  //   1. in-process lock per (clinic, patient)   — serialises simultaneous requests on this instance
  //   2. an explicit lookup before creating      — does not depend on any index existing
  //   3. the unique index (clinicId, patientId)  — the cross-instance backstop (E11000 → same clear conflict / the same account)
  const existingOf = () => LoyaltyAccount.findOne({ clinicId: input.clinicId, patientId: input.patientId }).lean();
  const conflict = async () => {
    const existing = await existingOf();
    return new LoyaltyError("ALREADY_ENROLLED", "This patient is already a Loyalty member", 409, { accountId: existing ? String(existing._id) : undefined });
  };
  const out = await withAccountLock(`enroll:${input.clinicId}:${input.patientId}`, async () => {
    const already = await existingOf();
    if (already) {
      if (mode === "strict") throw await conflict();
      return { account: already as any, created: false };
    }
    let account: any;
    try {
      const doc = await LoyaltyAccount.create({
        clinicId: oid(input.clinicId),
        patientId: oid(input.patientId),
        status: "active",
        enrolledBy: input.enrolledBy ? oid(input.enrolledBy) : null,
        enrollmentSource: source,
        joinedAt: new Date(),
      });
      account = doc.toObject();
    } catch (e: any) {
      if (e?.code === 11000) {
        if (mode === "strict") throw await conflict();
        const winner = await existingOf(); // another instance created it between our lookup and our insert
        if (winner) return { account: winner as any, created: false };
      }
      throw e;
    }
    // A self-enrolled member's tier is initialised INSIDE the lock, so a concurrent request can never read the account half-set-up.
    if (fresh) {
      const { onMemberEnrolledFresh } = await import("./loyaltyTiers");
      await onMemberEnrolledFresh(input.clinicId, String(account._id));
      const after = await LoyaltyAccount.findOne({ _id: account._id, clinicId: input.clinicId }).lean();
      if (after) account = after;
    }
    return { account, created: true };
  });

  // Staff enrolment (Phase 7, unchanged): the new member's progression counters are built from their REAL history and the tier is assigned (never throws).
  if (out.created && !fresh) {
    try {
      const { onMemberEnrolled } = await import("./loyaltyTiers");
      await onMemberEnrolled(input.clinicId, String(out.account._id));
      const after = await LoyaltyAccount.findOne({ _id: out.account._id, clinicId: input.clinicId }).lean();
      if (after) out.account = after;
    } catch {
      /* enrolment already succeeded */
    }
  }
  return out;
}

/**
 * Enrol an EXISTING patient of this clinic (staff). Starts at 0 points — no welcome bonus, no demo points.
 * A second enrolment of the same patient is a clear conflict (ALREADY_ENROLLED, with the existing account id).
 */
export async function enrollPatient(input: { clinicId: string; patientId: string; enrolledBy: string }) {
  return (await enrollCore({ ...input, source: "clinic", history: "rebuild" }, "strict")).account;
}

/**
 * Patient self-enrolment (Phase 9.1): find-or-create the Loyalty account of an EXISTING, non-archived patient of this clinic.
 * Idempotent and safe under any concurrency — ten simultaneous calls create exactly ONE account and exactly one of them gets `created: true`.
 * Awards 0 points, writes no ledger row, imports no history. Never creates a Patient. The caller (public controller) has already resolved
 * the clinic from the public slug and the patient from the clinic-scoped phone lookup — no id ever comes from the client.
 */
export async function ensureSelfEnrolled(input: { clinicId: string; patientId: string }): Promise<{ account: any; created: boolean }> {
  return enrollCore({ clinicId: input.clinicId, patientId: input.patientId, enrolledBy: null, source: "self_enrollment", history: "fresh" }, "ensure");
}

/* ============================================================
 * Clinic deletion
 * ============================================================ */

/**
 * Remove ALL Loyalty data of a clinic that is being permanently deleted (owner or platform admin).
 * Uses the raw collections on purpose: the ledger model refuses deletes, and this system-level purge is the
 * only sanctioned way history ever disappears. Idempotent and safe when the clinic never used Loyalty.
 */
export async function purgeClinicLoyaltyData(clinicId: string): Promise<void> {
  if (!isOid(clinicId)) return;
  const id = oid(clinicId);
  await Promise.all([
    LoyaltyTransaction.collection.deleteMany({ clinicId: id }),
    LoyaltyAccount.collection.deleteMany({ clinicId: id }),
    LoyaltySettings.collection.deleteMany({ clinicId: id }),
    LoyaltyCheckIn.collection.deleteMany({ clinicId: id }), // Phase 5: check-in requests
    LoyaltyReward.collection.deleteMany({ clinicId: id }), // Phase 6: reward catalog
    LoyaltyRedemption.collection.deleteMany({ clinicId: id }), // Phase 6: redemption requests
    LoyaltyTierHistory.collection.deleteMany({ clinicId: id }), // Phase 7: tier history
    LoyaltyProgressEvent.collection.deleteMany({ clinicId: id }), // Phase 7: progression idempotency markers
  ]);
}
