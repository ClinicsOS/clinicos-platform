import mongoose, { Schema, Document, Types } from "mongoose";
import { TIER_DEFAULT_NAMES, TIER_KEYS, TIER_LIMITS, TIER_METRICS, type TierKey, type TierMetric } from "../config/loyalty";

/**
 * Clinic-specific Loyalty PROGRAM configuration (layer 2 — controlled by the clinic).
 * One document per clinic (unique index). Created lazily the first time an entitled clinic saves settings;
 * until then readers get the defaults below WITHOUT anything being written.
 *
 * Every earning / redemption / tier / expiration / anti-abuse value is nullable or disabled by default —
 * NO point values are decided yet and nothing here may be populated from assumptions.
 */
export interface ILoyaltySettings extends Document {
  clinicId: Types.ObjectId;

  program: { enabled: boolean }; // clinic-level launch switch (gates enrolling members). NOT the paid entitlement.
  branding: { displayName: string | null };

  // ---- foundation only: stored, defaulted OFF, not editable in Phase 2 ----
  earning: {
    visits: { enabled: boolean; pointsPerVisit: number | null };
    spending: {
      enabled: boolean;
      spendAmount: number | null; // JOD (≤ 3 decimals): "for every <spendAmount> JOD paid …"
      pointsPerSpendAmount: number | null; // "… give <pointsPerSpendAmount> points"
      /**
       * Set by the server whenever spending earning is switched on or its rule changes. Only payments made AT or
       * AFTER this moment can earn — so changing a rule never recalculates anything that already happened.
       */
      activatedAt: Date | null;
    };
  };
  /**
   * Patient check-in (Phase 5). OFF by default and switched on by the clinic: turning it on shows a "Check in" button
   * on the patient's Loyalty page and creates requests that reception must answer — so it is a deliberate choice.
   */
  checkin: { enabled: boolean };
  redemption: { enabled: boolean; minimumPoints: number | null };
  /**
   * Tiers (Phase 7). Four ordered slots with STABLE keys (tier1…tier4); `name` is display-only content the clinic may rename.
   * `threshold` is stored in the metric's INTERNAL unit: points, visits, or integer FILS for lifetime_spending (tier1 is always 0).
   * `rulesVersion` goes up whenever a change can alter someone's tier (tiers switched on, metric or a threshold changed); every
   * account remembers the version it was last evaluated against, which is how a recalculation finds exactly the stale ones.
   * Benefits are informational text only — nothing here changes points, prices or priorities.
   */
  tiers: {
    enabled: boolean;
    progressionMetric: TierMetric | null;
    rulesVersion: number;
  } & Record<TierKey, { name: string; threshold: number | null; description: string | null; benefits: { title: string; description: string | null }[] }>;
  expiration: { enabled: boolean; months: number | null };
  antiAbuse: { minHoursBetweenVisitEarnings: number | null; maxPointsPerDay: number | null };

  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const num = { type: Number, default: null, min: 0 };

const tierSlot = (key: TierKey) => ({
  name: { type: String, trim: true, maxlength: TIER_LIMITS.nameMax, default: TIER_DEFAULT_NAMES[key] },
  threshold: { type: Number, min: 0, default: key === "tier1" ? 0 : null },
  description: { type: String, trim: true, maxlength: TIER_LIMITS.descriptionMax, default: null },
  benefits: {
    type: [
      new Schema(
        {
          title: { type: String, trim: true, required: true, maxlength: TIER_LIMITS.benefitTitleMax },
          description: { type: String, trim: true, maxlength: TIER_LIMITS.benefitDescriptionMax, default: null },
        },
        { _id: false }
      ),
    ],
    default: [],
  },
});

const loyaltySettingsSchema = new Schema<ILoyaltySettings>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true, unique: true },

    program: { enabled: { type: Boolean, default: false } },
    branding: { displayName: { type: String, trim: true, maxlength: 60, default: null } },

    earning: {
      visits: { enabled: { type: Boolean, default: false }, pointsPerVisit: num },
      spending: {
        enabled: { type: Boolean, default: false },
        spendAmount: num,
        pointsPerSpendAmount: num,
        activatedAt: { type: Date, default: null },
      },
    },
    checkin: { enabled: { type: Boolean, default: false } },
    redemption: { enabled: { type: Boolean, default: false }, minimumPoints: num },
    tiers: {
      enabled: { type: Boolean, default: false },
      progressionMetric: { type: String, enum: [...TIER_METRICS, null], default: null },
      rulesVersion: { type: Number, default: 0, min: 0 },
      ...Object.fromEntries(TIER_KEYS.map((k) => [k, tierSlot(k)])),
    },
    expiration: { enabled: { type: Boolean, default: false }, months: num },
    antiAbuse: { minHoursBetweenVisitEarnings: num, maxPointsPerDay: num },

    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const LoyaltySettings = mongoose.model<ILoyaltySettings>("LoyaltySettings", loyaltySettingsSchema);
