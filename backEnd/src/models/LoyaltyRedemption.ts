import mongoose, { Schema, Document, Types } from "mongoose";
import { REDEMPTION, type RedemptionStatus } from "../config/loyalty";

/**
 * A member's request to redeem a reward (Phase 6).
 *
 *  • Requesting NEVER moves points. Points are deducted only when staff CONFIRM, through the central ledger
 *    (services/loyaltyService.ts → debitPoints, type `reward_redemption`, sourceId = this redemption's id). The ledger row is
 *    linked in `transactionId`; a REVERSAL appends a NEW positive row linked in `reversalTransactionId`.
 *  • `rewardNameSnapshot` and `pointsCostSnapshot` are copied from the reward when the member asks and are NEVER
 *    rewritten, so later reward edits don't change pending or historical redemptions.
 *  • Nothing in here is a balance: `pointsCostSnapshot` is a server-copied number used as the amount to debit.
 *
 * `activeKey` ("<accountId>:<rewardId>") exists only while the request is open (pending / confirming) and is
 * covered by a single-field sparse UNIQUE index → one open request per member per reward, enforced by the database.
 * `claimToken` / `claimedAt` mark the short internal claim taken by whoever is confirming / reversing right now.
 */
export interface ILoyaltyRedemption extends Document {
  clinicId: Types.ObjectId;
  rewardId: Types.ObjectId;
  accountId: Types.ObjectId;
  patientId: Types.ObjectId;

  rewardNameSnapshot: string;
  pointsCostSnapshot: number;

  status: RedemptionStatus;
  activeKey?: string;
  claimToken?: string;
  claimedAt?: Date;

  requestedAt: Date;
  confirmedAt: Date | null;
  rejectedAt: Date | null;
  reversedAt: Date | null;
  confirmedBy: Types.ObjectId | null;
  rejectedBy: Types.ObjectId | null;
  reversedBy: Types.ObjectId | null;
  rejectionReason: string | null;
  reversalReason: string | null;
  transactionId?: Types.ObjectId;
  reversalTransactionId?: Types.ObjectId;

  createdAt: Date;
  updatedAt: Date;
}

const loyaltyRedemptionSchema = new Schema<ILoyaltyRedemption>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    rewardId: { type: Schema.Types.ObjectId, ref: "LoyaltyReward", required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "LoyaltyAccount", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },

    rewardNameSnapshot: { type: String, required: true, maxlength: 80 },
    pointsCostSnapshot: { type: Number, required: true, min: 1 },

    status: { type: String, enum: REDEMPTION.statuses, default: "pending" },
    activeKey: { type: String },
    claimToken: { type: String },
    claimedAt: { type: Date },

    requestedAt: { type: Date, required: true, default: Date.now },
    confirmedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    reversedAt: { type: Date, default: null },
    confirmedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    rejectedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reversedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    rejectionReason: { type: String, default: null, maxlength: REDEMPTION.rejectionReasonMax },
    reversalReason: { type: String, default: null, maxlength: 300 },
    transactionId: { type: Schema.Types.ObjectId, ref: "LoyaltyTransaction" },
    reversalTransactionId: { type: Schema.Types.ObjectId, ref: "LoyaltyTransaction" },
  },
  { timestamps: true }
);

// One OPEN request per member per reward (single-field sparse unique — see the note on the ledger indexes).
loyaltyRedemptionSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
// A ledger row can back at most one redemption (and one reversal) — defence in depth next to the ledger's own unique keys.
loyaltyRedemptionSchema.index({ transactionId: 1 }, { unique: true, sparse: true });
loyaltyRedemptionSchema.index({ reversalTransactionId: 1 }, { unique: true, sparse: true });
// Desk queue / history (per clinic, by status, newest first).
loyaltyRedemptionSchema.index({ clinicId: 1, status: 1, requestedAt: -1 });
// A member's own requests (duplicate checks, daily cap, patient page).
loyaltyRedemptionSchema.index({ accountId: 1, requestedAt: -1 });
// Per-reward counts and the "has history → never hard-delete" check.
loyaltyRedemptionSchema.index({ rewardId: 1, status: 1 });

export const LoyaltyRedemption = mongoose.model<ILoyaltyRedemption>("LoyaltyRedemption", loyaltyRedemptionSchema);
