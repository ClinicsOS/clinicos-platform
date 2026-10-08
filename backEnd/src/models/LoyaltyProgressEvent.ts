import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Idempotency markers for the progression counters that do NOT come from the points ledger (Phase 7).
 *
 *   kind "visit"    key "visit:<appointmentId>"            active = the appointment is currently counted as completed
 *   kind "payment"  key "payment:<invoiceId>:<paymentId>"  amountFils = what that payment added; always active
 *
 * The counter on LoyaltyAccount is incremented only by the request that WINS the unique `key`, so a repeated status update,
 * a retried hook or a double click can never count a visit or a payment twice. These rows are bookkeeping, not business data:
 * `recalculateMember` rebuilds them (and the counters) from the real Appointment / Invoice records at any time.
 */
export interface ILoyaltyProgressEvent extends Document {
  clinicId: Types.ObjectId;
  accountId: Types.ObjectId;
  kind: "visit" | "payment";
  key: string;
  amountFils: number;
  active: boolean;
  createdAt: Date;
}

const schema = new Schema<ILoyaltyProgressEvent>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "LoyaltyAccount", required: true },
    kind: { type: String, enum: ["visit", "payment"], required: true },
    key: { type: String, required: true, maxlength: 90 },
    amountFils: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The key embeds globally-unique record ids, so global uniqueness == "this appointment / payment is counted once".
schema.index({ key: 1 }, { unique: true });
// Rebuilding / checking one member's markers.
schema.index({ accountId: 1, kind: 1 });

export const LoyaltyProgressEvent = mongoose.model<ILoyaltyProgressEvent>("LoyaltyProgressEvent", schema);
