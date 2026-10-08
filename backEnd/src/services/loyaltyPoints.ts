import { Types } from "mongoose";
import { LoyaltyAccount } from "../models/LoyaltyAccount";
import { LoyaltyTransaction } from "../models/LoyaltyTransaction";
import { logActivity } from "./activityLogger";
import { LoyaltyError, assertEntitled, creditPoints, getSettings, isOid, reverseTransaction } from "./loyaltyService";
import { onPaymentRecorded, onVisitCompleted, onVisitUncompleted } from "./loyaltyTiers";
import { EARNING_LIMITS, LOYALTY_TECHNICAL_LIMITS, type LoyaltySourceType, type LoyaltyTransactionType } from "../config/loyalty";

/**
 * ClinicOS Loyalty — the POINTS ENGINE (Phase 3).
 *
 * Everything that decides "how many points?" and "should this event earn?" lives here, in ONE place.
 * Controllers (appointments, invoices) only call the two hook functions at the bottom; they never calculate
 * points and never touch a balance. Every award goes through the Phase 2 service (`creditPoints`), which
 * verifies the add-on, scope and amount, changes the balance atomically and writes the immutable ledger row.
 *
 * ── Rules ────────────────────────────────────────────────────────────────────────────────────────────────
 *  • NOTHING is awarded unless: the Loyalty add-on is active AND the clinic's program is switched on AND the
 *    specific earning mode is enabled with a configured value AND the patient already has an ACTIVE
 *    Loyalty account. Patients are never auto-enrolled.
 *  • VISIT points: one award per appointment, when it moves INTO `completed` (the existing appointment status
 *    that represents a finished visit). scheduled / confirmed / cancelled / no_show never earn.
 *  • SPENDING points: one award per PAYMENT (invoices store each payment with its own _id). Based on the amount
 *    actually PAID, never on the invoice total. Rule = "for every <spendAmount> JOD paid, <pointsPerSpendAmount>
 *    points", computed on the CUMULATIVE eligible amount of the invoice, so partial payments never lose their
 *    remainder:  points(payment k) = floor(after / step) × pts − floor(before / step) × pts.
 *  • NO RETROACTIVITY: only payments made at/after `earning.spending.activatedAt` (set whenever the spending
 *    rule is switched on or changed) are eligible, and visit points are only awarded on a status change that
 *    happens after the rule exists. Saving settings never recalculates history.
 *  • Money is integer FILS (1 JOD = 1000) — never floating point.
 *  • The hooks NEVER throw into the caller: a Loyalty problem must not break an appointment or a payment.
 */

export interface AwardResult {
  awarded: boolean;
  /** Same source had already earned — nothing changed. */
  duplicate?: boolean;
  /** Why nothing was awarded (not an error). */
  skipped?: string;
  points?: number;
  transactionId?: string;
}

/* ============================================================
 * Calculations (pure)
 * ============================================================ */

/** JOD → integer fils. Rounds to the nearest fil, so 0.1 + 0.2 style float noise can never leak in. */
export const toFils = (jod: number): number => Math.round(jod * EARNING_LIMITS.filsPerJod);

const isPosInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

export interface EarningSettingsLike {
  program?: { enabled?: boolean };
  earning?: {
    visits?: { enabled?: boolean; pointsPerVisit?: number | null };
    spending?: { enabled?: boolean; spendAmount?: number | null; pointsPerSpendAmount?: number | null; activatedAt?: Date | string | null };
  };
}

/** Points for one completed visit, or null when visit earning is off / not configured. */
export function calculateVisitPoints(settings: EarningSettingsLike): number | null {
  const v = settings.earning?.visits;
  if (!v?.enabled || !isPosInt(v.pointsPerVisit)) return null;
  return v.pointsPerVisit;
}

/**
 * Points earned by moving the invoice's eligible-paid total from `beforeFils` to `afterFils`.
 * Example: spendAmount 5, pointsPerSpendAmount 2, paying 50 JOD in one go → floor(50000/5000) × 2 = 20.
 * Returns 0 when the rule is off / not configured / the payment stays inside the same step.
 */
export function calculateSpendingPoints(settings: EarningSettingsLike, beforeFils: number, afterFils: number): number {
  const s = settings.earning?.spending;
  if (!s?.enabled || typeof s.spendAmount !== "number" || !isPosInt(s.pointsPerSpendAmount)) return 0;
  const step = toFils(s.spendAmount);
  if (!Number.isSafeInteger(step) || step < 1) return 0;
  if (!Number.isSafeInteger(beforeFils) || !Number.isSafeInteger(afterFils) || beforeFils < 0 || afterFils <= beforeFils) return 0;
  return (Math.floor(afterFils / step) - Math.floor(beforeFils / step)) * s.pointsPerSpendAmount;
}

/* ============================================================
 * Shared preconditions
 * ============================================================ */

async function activeAccount(clinicId: string, patientId: string): Promise<{ id: string } | { skipped: string }> {
  if (!isOid(clinicId) || !isOid(patientId)) return { skipped: "INVALID_REFERENCE" };
  const account = await LoyaltyAccount.findOne({ clinicId, patientId }).select("_id status").lean();
  if (!account) return { skipped: "NO_LOYALTY_ACCOUNT" }; // never auto-enrol
  if (account.status !== "active") return { skipped: "ACCOUNT_NOT_ACTIVE" };
  return { id: String(account._id) };
}

async function entitledAndEnabled(clinicId: string) {
  try {
    await assertEntitled(clinicId);
  } catch {
    return { skipped: "NOT_ENTITLED" as const };
  }
  const { settings } = await getSettings(clinicId);
  if (!settings.program?.enabled) return { skipped: "PROGRAM_OFF" as const };
  return { settings };
}

const audit = (action: string, clinicId: string, details: Record<string, unknown>) =>
  logActivity({ action, actorEmail: "system:loyalty", targetType: "clinic", targetId: clinicId, details });

/* ============================================================
 * Awards
 * ============================================================ */

export interface AppointmentLike {
  _id: Types.ObjectId | string;
  clinicId: Types.ObjectId | string;
  patientId?: Types.ObjectId | string | null;
  type?: string;
  status: string;
}

/** Visit points for ONE completed appointment (idempotent per appointment). */
export async function awardVisitPoints(appt: AppointmentLike, actorId?: string | null): Promise<AwardResult> {
  const clinicId = String(appt.clinicId);
  if (appt.type === "blocked" || !appt.patientId) return { awarded: false, skipped: "NOT_A_PATIENT_VISIT" };
  if (appt.status !== "completed") return { awarded: false, skipped: "NOT_COMPLETED" };

  const gate = await entitledAndEnabled(clinicId);
  if ("skipped" in gate) return { awarded: false, skipped: gate.skipped };
  const points = calculateVisitPoints(gate.settings);
  if (points === null) return { awarded: false, skipped: "VISIT_EARNING_OFF" };
  if (points > LOYALTY_TECHNICAL_LIMITS.maxPointsPerTransaction) return { awarded: false, skipped: "EXCEEDS_LIMIT" };

  const acct = await activeAccount(clinicId, String(appt.patientId));
  if ("skipped" in acct) return { awarded: false, skipped: acct.skipped };

  const res = await creditPoints({
    clinicId,
    accountId: acct.id,
    type: "earn_visit",
    points,
    sourceType: "appointment",
    sourceId: String(appt._id),
    // The rule in force at the time is stored, so the history can always explain WHY this amount was given.
    metadata: { rule: "visit", pointsPerVisit: points },
    actorId: actorId && isOid(actorId) ? actorId : null,
  });
  if (res.duplicate) return { awarded: false, duplicate: true, skipped: "ALREADY_AWARDED", transactionId: String(res.transaction._id) };
  await audit("loyalty.points.visit_awarded", clinicId, {
    accountId: acct.id,
    transactionId: String(res.transaction._id),
    points,
    sourceType: "appointment",
    sourceId: String(appt._id),
    actorUserId: actorId ?? null,
  });
  return { awarded: true, points, transactionId: String(res.transaction._id) };
}

export interface InvoiceLike {
  _id: Types.ObjectId | string;
  clinicId: Types.ObjectId | string;
  patientId: Types.ObjectId | string;
  invoiceNumber?: number;
  payments: { _id?: Types.ObjectId | string; amount: number; paidAt?: Date | string }[];
}

/** Spending points for ONE payment of an invoice (idempotent per payment). */
export async function awardSpendingPoints(invoice: InvoiceLike, paymentId: string, actorId?: string | null): Promise<AwardResult> {
  const clinicId = String(invoice.clinicId);
  const idx = invoice.payments.findIndex((p) => p._id && String(p._id) === paymentId);
  if (idx < 0) return { awarded: false, skipped: "PAYMENT_NOT_FOUND" };
  const payment = invoice.payments[idx];
  if (typeof payment.amount !== "number" || !(payment.amount > 0)) return { awarded: false, skipped: "NO_PAID_AMOUNT" };

  const gate = await entitledAndEnabled(clinicId);
  if ("skipped" in gate) return { awarded: false, skipped: gate.skipped };
  const rule = gate.settings.earning?.spending;
  if (!rule?.enabled || typeof rule.spendAmount !== "number" || !isPosInt(rule.pointsPerSpendAmount)) {
    return { awarded: false, skipped: "SPENDING_EARNING_OFF" };
  }
  const activatedAt = rule.activatedAt ? new Date(rule.activatedAt).getTime() : null;
  if (activatedAt === null) return { awarded: false, skipped: "RULE_NOT_ACTIVATED" };
  const paidAt = (p: { paidAt?: Date | string }) => (p.paidAt ? new Date(p.paidAt).getTime() : 0);
  if (paidAt(payment) < activatedAt) return { awarded: false, skipped: "PAYMENT_BEFORE_RULE" }; // no retroactive points

  // Cumulative eligible-paid amount of this invoice (only payments made under the CURRENT rule).
  let before = 0;
  for (let i = 0; i < idx; i++) if (paidAt(invoice.payments[i]) >= activatedAt) before += toFils(invoice.payments[i].amount);
  const paymentFils = toFils(payment.amount);
  const after = before + paymentFils;
  const points = calculateSpendingPoints(gate.settings, before, after);
  if (points <= 0) return { awarded: false, skipped: "BELOW_SPEND_STEP" };
  if (points > LOYALTY_TECHNICAL_LIMITS.maxPointsPerTransaction) return { awarded: false, skipped: "EXCEEDS_LIMIT" };

  const acct = await activeAccount(clinicId, String(invoice.patientId));
  if ("skipped" in acct) return { awarded: false, skipped: acct.skipped };

  const res = await creditPoints({
    clinicId,
    accountId: acct.id,
    type: "earn_spending",
    points,
    sourceType: "invoice",
    sourceId: `${invoice._id}:${paymentId}`, // payment-level idempotency
    metadata: {
      rule: "spending",
      invoiceNumber: invoice.invoiceNumber ?? null,
      paidFils: paymentFils,
      eligibleBeforeFils: before,
      eligibleAfterFils: after,
      spendAmount: rule.spendAmount,
      pointsPerSpendAmount: rule.pointsPerSpendAmount,
    },
    actorId: actorId && isOid(actorId) ? actorId : null,
  });
  if (res.duplicate) return { awarded: false, duplicate: true, skipped: "ALREADY_AWARDED", transactionId: String(res.transaction._id) };
  await audit("loyalty.points.spending_awarded", clinicId, {
    accountId: acct.id,
    transactionId: String(res.transaction._id),
    points,
    sourceType: "invoice",
    sourceId: `${invoice._id}:${paymentId}`,
    actorUserId: actorId ?? null,
  });
  return { awarded: true, points, transactionId: String(res.transaction._id) };
}

/* ============================================================
 * Reversal (history is never edited — a reversal row is appended)
 * ============================================================ */

/**
 * Reverse the points a source (appointment / invoice payment) earned. Finds the earning row by its idempotency
 * key and appends a `reversal` row via the Phase 2 service. Safe to call repeatedly; returns what happened.
 * A reversal can't take the balance below zero — if the points were already used, it reports
 * INSUFFICIENT_BALANCE and leaves the balance alone (use a manual debit with a reason in that case).
 */
export async function reversePointsForSource(input: {
  clinicId: string;
  sourceType: LoyaltySourceType;
  sourceId: string;
  types: LoyaltyTransactionType[];
  reason: string;
  actorId?: string | null;
}): Promise<{ reversed: boolean; skipped?: string }> {
  let reversedAny = false;
  for (const type of input.types) {
    const row = await LoyaltyTransaction.findOne({ clinicId: input.clinicId, idempotencyKey: `${type}:${input.sourceType}:${input.sourceId}` }).select("_id").lean();
    if (!row) continue;
    try {
      const res = await reverseTransaction({ clinicId: input.clinicId, transactionId: String(row._id), reason: input.reason, actorId: input.actorId ?? null });
      reversedAny = true;
      await audit("loyalty.points.reversed", input.clinicId, {
        accountId: String(res.account._id),
        transactionId: String(res.transaction._id),
        reverses: String(row._id),
        points: res.transaction.pointsDelta,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      });
    } catch (e) {
      if (e instanceof LoyaltyError && e.code === "ALREADY_REVERSED") continue;
      if (e instanceof LoyaltyError) return { reversed: reversedAny, skipped: e.code };
      throw e;
    }
  }
  return { reversed: reversedAny, skipped: reversedAny ? undefined : "NOTHING_TO_REVERSE" };
}

/* ============================================================
 * Integration hooks (called by the appointment / invoice controllers)
 * ============================================================ */

/**
 * Call after an appointment's status really changed. Entering `completed` → visit points; leaving `completed`
 * (a correction, e.g. completed → cancelled) → the visit points are reversed with an immutable reversal row.
 * Re-completing an appointment whose points were reversed does NOT re-award them (the source already earned
 * once); use a manual credit if that is ever needed.
 */
export async function onAppointmentStatusChange(prevStatus: string, appt: AppointmentLike, actorId?: string | null): Promise<void> {
  try {
    if (appt.type === "blocked" || !appt.patientId || prevStatus === appt.status) return;
    if (appt.status === "completed") {
      await awardVisitPoints(appt, actorId);
      await onVisitCompleted(appt); // Phase 7: counts the completed visit toward tier progression (idempotent; never throws)
    } else if (prevStatus === "completed") {
      await onVisitUncompleted(appt);
      await reversePointsForSource({
        clinicId: String(appt.clinicId),
        sourceType: "appointment",
        sourceId: String(appt._id),
        types: ["earn_visit"],
        reason: "Appointment status corrected",
        actorId,
      });
    }
  } catch (e) {
    console.error("[loyalty] appointment hook failed (appointment was NOT affected):", e instanceof Error ? e.message : e);
  }
}

/** Call after a payment has been appended to an invoice. Never throws. */
export async function onInvoicePayment(invoice: InvoiceLike, paymentId: string, actorId?: string | null): Promise<void> {
  try {
    await awardSpendingPoints(invoice, paymentId, actorId);
    await onPaymentRecorded(invoice, paymentId); // Phase 7: the real paid amount counts toward tier progression (idempotent; never throws)
  } catch (e) {
    console.error("[loyalty] payment hook failed (payment was NOT affected):", e instanceof Error ? e.message : e);
  }
}
