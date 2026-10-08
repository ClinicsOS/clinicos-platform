import mongoose, { Schema, Document, Types } from "mongoose";
import {
  LOYALTY_TRANSACTION_TYPES,
  LOYALTY_SOURCE_TYPES,
  type LoyaltyTransactionType,
  type LoyaltySourceType,
} from "../config/loyalty";

/**
 * IMMUTABLE points ledger. Rows are only ever INSERTED (by services/loyaltyService.ts).
 * A mistake is fixed with a new `reversal` / `correction` row — history is never rewritten.
 *
 * Immutability is enforced here, at the model level: every update / replace / delete hook below throws, so no
 * controller can edit or delete a row by accident. (Deleting a whole clinic purges its ledger through the raw
 * collection in `purgeClinicLoyaltyData` — a deliberate, separate, system-level path.)
 */
export interface ILoyaltyTransaction extends Document {
  clinicId: Types.ObjectId;
  accountId: Types.ObjectId;
  patientId: Types.ObjectId;

  type: LoyaltyTransactionType;
  pointsDelta: number; // signed, non-zero integer
  balanceBefore: number;
  balanceAfter: number;
  seq: number; // position in the account's ledger (1, 2, 3 …)

  sourceType: LoyaltySourceType;
  sourceId: string | null;
  /** Set only for earning rows that name a source: "<type>:<sourceType>:<sourceId>" — unique per clinic. */
  idempotencyKey?: string;
  /** Set only on a `reversal` row: the row it reverses (unique per clinic → a row can be reversed once). */
  reversesTransactionId?: Types.ObjectId;

  reason: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  createdBy: Types.ObjectId | null; // acting clinic user; null = system
  createdAt: Date;
}

const loyaltyTransactionSchema = new Schema<ILoyaltyTransaction>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "LoyaltyAccount", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },

    type: { type: String, enum: LOYALTY_TRANSACTION_TYPES, required: true },
    pointsDelta: {
      type: Number,
      required: true,
      validate: { validator: (v: number) => Number.isSafeInteger(v) && v !== 0, message: "pointsDelta must be a non-zero integer" },
    },
    balanceBefore: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    seq: { type: Number, required: true, min: 1 },

    sourceType: { type: String, enum: LOYALTY_SOURCE_TYPES, required: true, default: "manual" },
    sourceId: { type: String, default: null, maxlength: 64 },
    idempotencyKey: { type: String },
    reversesTransactionId: { type: Schema.Types.ObjectId, ref: "LoyaltyTransaction" },

    reason: { type: String, default: null, maxlength: 300 },
    metadata: { type: Schema.Types.Mixed, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, strict: true }
);

// ---- indexes ----
loyaltyTransactionSchema.index({ accountId: 1, seq: -1 }, { unique: true }); // per-account order; also catches double-applied seq
loyaltyTransactionSchema.index({ clinicId: 1, createdAt: -1 }); // clinic-wide history
loyaltyTransactionSchema.index({ accountId: 1, createdAt: -1 }); // member history
// IMPORTANT — these two are deliberately SINGLE-FIELD sparse indexes.
// A sparse COMPOUND index (e.g. { clinicId, idempotencyKey }) still indexes every document that has ANY of its keys,
// and every row has a clinicId — so MongoDB would treat all rows without the second key as (clinicId, null) and allow
// only ONE such row per clinic (E11000 on the second one). A single-field sparse index really skips documents that
// don't have the field.
//   • idempotencyKey ("<type>:<sourceType>:<sourceId>") — the sourceId is a server-side record id (appointment /
//     invoice+payment), globally unique, so global uniqueness == "a source can earn once".
//   • reversesTransactionId — an ObjectId, globally unique, so "a ledger row can be reversed once".
loyaltyTransactionSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
loyaltyTransactionSchema.index({ reversesTransactionId: 1 }, { unique: true, sparse: true });

// ---- immutability ----
const immutable = () => {
  throw new Error("LoyaltyTransaction is immutable: create a reversal or correction instead of changing history");
};
loyaltyTransactionSchema.pre("save", function () {
  if (!this.isNew) immutable();
});
loyaltyTransactionSchema.pre(
  ["updateOne", "updateMany", "findOneAndUpdate", "findOneAndReplace", "replaceOne", "findOneAndDelete", "deleteOne", "deleteMany"] as any,
  immutable
);
loyaltyTransactionSchema.pre("deleteOne", { document: true, query: false }, immutable);

export const LoyaltyTransaction = mongoose.model<ILoyaltyTransaction>("LoyaltyTransaction", loyaltyTransactionSchema);

/**
 * One-time repair, run at startup. Earlier versions created two MULTI-KEY sparse unique indexes
 * (clinicId_1_idempotencyKey_1, clinicId_1_reversesTransactionId_1) that, on real MongoDB, allow only one
 * "plain" ledger row per clinic. This drops those two (and any other multi-key sparse index on the ledger collection)
 * and lets Mongoose create the corrected single-field ones. Safe to run on every start: it does nothing once repaired, and never
 * touches ledger rows.
 */
export async function repairLoyaltyTransactionIndexes(): Promise<string[]> {
  const dropped: string[] = [];
  let existing: { name?: string; key: Record<string, unknown>; sparse?: boolean }[] = [];
  try {
    existing = (await LoyaltyTransaction.collection.indexes()) as typeof existing;
  } catch {
    return dropped; // collection doesn't exist yet — Mongoose will create the right indexes
  }
  for (const ix of existing) {
    const legacy = ix.name === "clinicId_1_idempotencyKey_1" || ix.name === "clinicId_1_reversesTransactionId_1";
    if (ix.name && (legacy || (ix.sparse && Object.keys(ix.key).length > 1))) {
      await LoyaltyTransaction.collection.dropIndex(ix.name);
      dropped.push(ix.name);
    }
  }
  if (dropped.length) await LoyaltyTransaction.createIndexes();
  return dropped;
}
