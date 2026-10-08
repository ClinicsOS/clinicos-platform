import mongoose, { Schema, Document, Types } from "mongoose";
import { TIER_DIRECTIONS, TIER_HISTORY_SOURCES, TIER_KEYS, TIER_METRICS, type TierDirection, type TierHistorySource, type TierKey, type TierMetric } from "../config/loyalty";

/**
 * One row per REAL tier change of a member (never per metric change). Rows are only ever inserted by services/loyaltyTiers.ts.
 *
 * Tiers are stored by STABLE KEY (`fromTierKey` / `toTierKey`). The clinic-editable display name at the moment of the change is
 * copied into `…NameSnapshot`, so history keeps saying "Gold" after the clinic renames tier3 to "Elite".
 * `accountId` is the project's name for the Loyalty account reference.
 *
 *   direction  initial   first assignment above the base tier (e.g. an existing member backfilled straight into tier3)
 *              promotion moved up a tier
 *              demotion  moved down — only a rule change / explicit reconciliation can do this, never a redemption or balance change
 *   sequence   = the account's `tier.version` after the change. The unique (accountId, sequence) index is the database-level
 *              guarantee that two racing updates can never write the same change twice.
 */
export interface ILoyaltyTierHistory extends Document {
  clinicId: Types.ObjectId;
  accountId: Types.ObjectId;
  patientId: Types.ObjectId;
  fromTierKey: TierKey | null;
  toTierKey: TierKey;
  fromTierNameSnapshot: string | null;
  toTierNameSnapshot: string;
  direction: TierDirection;
  progressionMetric: TierMetric;
  /** Metric value at the change, in the metric's internal unit (points / visits / fils). */
  metricValueAtChange: number;
  source: TierHistorySource;
  sequence: number;
  metadata: { rulesVersion: number } | null;
  changedAt: Date;
}

const schema = new Schema<ILoyaltyTierHistory>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "LoyaltyAccount", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    fromTierKey: { type: String, enum: [...TIER_KEYS, null], default: null },
    toTierKey: { type: String, enum: TIER_KEYS, required: true },
    fromTierNameSnapshot: { type: String, default: null, maxlength: 40 },
    toTierNameSnapshot: { type: String, required: true, maxlength: 40 },
    direction: { type: String, enum: TIER_DIRECTIONS, required: true },
    progressionMetric: { type: String, enum: TIER_METRICS, required: true },
    metricValueAtChange: { type: Number, required: true, min: 0 },
    source: { type: String, enum: TIER_HISTORY_SOURCES, required: true },
    sequence: { type: Number, required: true, min: 1 },
    metadata: { type: Schema.Types.Mixed, default: null },
    changedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, strict: true }
);

// One row per (account, change number): duplicate prevention + a member's history in order.
schema.index({ accountId: 1, sequence: -1 }, { unique: true });
// Clinic-wide "recent promotions" feed and the analytics window.
schema.index({ clinicId: 1, changedAt: -1 });

export const LoyaltyTierHistory = mongoose.model<ILoyaltyTierHistory>("LoyaltyTierHistory", schema);
