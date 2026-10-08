import mongoose, { Schema, Document, Types } from "mongoose";
import { ENROLLMENT_SOURCES, LOYALTY_ACCOUNT_STATUSES, TIER_KEYS, type EnrollmentSource, type LoyaltyAccountStatus, type TierKey } from "../config/loyalty";

/**
 * A patient's Loyalty account AT ONE CLINIC. References the existing Patient — no patient data (name, phone…)
 * is copied here; Patient stays the single source of truth.
 *
 * `pointsBalance` and the lifetime counters are a CACHE of the immutable ledger (LoyaltyTransaction).
 * They are written ONLY by services/loyaltyService.ts (atomic $inc together with a ledger row) — never by a
 * controller, never with a plain `+=`. `seq` counts ledger entries so a missing entry is detectable.
 */
export interface ILoyaltyAccount extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  status: LoyaltyAccountStatus;

  pointsBalance: number;
  lifetimePointsEarned: number;
  lifetimePointsRedeemed: number;
  seq: number; // number of ledger entries ever applied (monotonic)

  /**
   * Tier PROGRESSION counters (Phase 7) — separate from the redeemable balance on purpose: spending points never lowers them.
   *   earnedPoints     net of earn_visit / earn_spending (+ their reversals). Maintained by the ledger's atomic $inc.
   *   completedVisits  appointments in status "completed" (maintained from the appointment hook; idempotent per appointment).
   *   paidFils         actual payments, in integer fils (maintained from the payment hook; idempotent per payment).
   *   reconciledAt     null/absent until the counters were last REBUILT from the authoritative sources (ledger / appointments / invoices).
   * They are a cache: `recalculateMember` / the backfill script can always rebuild them from the sources.
   */
  progress?: { earnedPoints: number; completedVisits: number; paidFils: number; reconciledAt: Date | null };
  /**
   * Current tier. `key` is a stable tier key (never a display name). `highestKey` is the best tier ever reached (never lowered).
   * `version` counts tier changes and is the compare-and-set token that makes concurrent updates safe. `rulesVersion` is the
   * settings.tiers.rulesVersion this account was last evaluated against.
   */
  tier?: { key: TierKey | null; highestKey: TierKey | null; changedAt: Date | null; version: number; rulesVersion: number };

  joinedAt: Date;
  lastActivityAt: Date | null;
  enrolledBy?: Types.ObjectId | null;
  /** Phase 9.1: how the account was created. null/absent on accounts that pre-date it. `joinedAt` is the enrolment time. */
  enrollmentSource?: EnrollmentSource | null;

  createdAt: Date;
  updatedAt: Date;
}

const loyaltyAccountSchema = new Schema<ILoyaltyAccount>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    status: { type: String, enum: LOYALTY_ACCOUNT_STATUSES, default: "active" },

    pointsBalance: { type: Number, default: 0, min: 0 },
    lifetimePointsEarned: { type: Number, default: 0, min: 0 },
    lifetimePointsRedeemed: { type: Number, default: 0, min: 0 },
    seq: { type: Number, default: 0, min: 0 },

    progress: {
      earnedPoints: { type: Number, default: 0, min: 0 },
      completedVisits: { type: Number, default: 0, min: 0 },
      paidFils: { type: Number, default: 0, min: 0 },
      reconciledAt: { type: Date, default: null },
    },
    tier: {
      key: { type: String, enum: [...TIER_KEYS, null], default: null },
      highestKey: { type: String, enum: [...TIER_KEYS, null], default: null },
      changedAt: { type: Date, default: null },
      version: { type: Number, default: 0, min: 0 },
      rulesVersion: { type: Number, default: 0, min: 0 },
    },

    joinedAt: { type: Date, default: Date.now },
    lastActivityAt: { type: Date, default: null },
    enrolledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    enrollmentSource: { type: String, enum: [...ENROLLMENT_SOURCES, null], default: null },
  },
  { timestamps: true }
);

// One account per patient PER CLINIC (the same person may join other clinics independently).
loyaltyAccountSchema.index({ clinicId: 1, patientId: 1 }, { unique: true });
// Member list, newest first.
loyaltyAccountSchema.index({ clinicId: 1, joinedAt: -1 });
// Members filtered by tier + the tier distribution (Phase 7): $match clinicId, group / filter by tier.key.
loyaltyAccountSchema.index({ clinicId: 1, "tier.key": 1 });

export const LoyaltyAccount = mongoose.model<ILoyaltyAccount>("LoyaltyAccount", loyaltyAccountSchema);
