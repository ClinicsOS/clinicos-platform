import mongoose, { Schema, Document, Types } from "mongoose";
import { REWARD, type RewardStatus } from "../config/loyalty";

/**
 * A reward a clinic offers for points (Phase 6). Belongs to exactly ONE clinic. There is no seed / default catalog:
 * every reward — its name, cost and validity — is entered by the clinic (owner / doctor).
 *
 * Changing a reward never rewrites history: a redemption copies the name and cost at request time
 * (`LoyaltyRedemption.rewardNameSnapshot / pointsCostSnapshot`).
 * A reward that has redemptions is never hard-deleted — it is deactivated instead.
 */
export interface ILoyaltyReward extends Document {
  clinicId: Types.ObjectId;
  name: string;
  description: string;
  pointsRequired: number;
  status: RewardStatus;
  /** Optional validity window (inclusive). null = open-ended on that side. */
  validFrom: Date | null;
  validUntil: Date | null;
  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const loyaltyRewardSchema = new Schema<ILoyaltyReward>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    name: { type: String, required: true, trim: true, minlength: REWARD.nameMin, maxlength: REWARD.nameMax },
    description: { type: String, default: "", trim: true, maxlength: REWARD.descriptionMax },
    pointsRequired: {
      type: Number,
      required: true,
      validate: { validator: (v: number) => Number.isSafeInteger(v) && v >= REWARD.pointsMin && v <= REWARD.pointsMax, message: "pointsRequired must be a positive whole number" },
    },
    status: { type: String, enum: REWARD.statuses, default: "active" },
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Catalog list per clinic, filtered by status, newest first.
loyaltyRewardSchema.index({ clinicId: 1, status: 1, createdAt: -1 });

export const LoyaltyReward = mongoose.model<ILoyaltyReward>("LoyaltyReward", loyaltyRewardSchema);
