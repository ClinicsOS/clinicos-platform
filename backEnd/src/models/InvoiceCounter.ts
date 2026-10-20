import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * PHASE 3 — the persistent, clinic-scoped invoice number counter.
 *
 * One row per clinic. `seq` is the LAST invoice number that was handed out for that clinic. It only ever goes UP:
 *   - the next number is `seq + 1`, taken with one atomic `$inc` (so two parallel requests can never receive the same number);
 *   - permanently deleting an invoice does not touch this row, so a number is never reused;
 *   - nothing ever renumbers an invoice.
 * A number that was handed out but whose invoice was then not stored (a failed write) is simply skipped: gaps are allowed, reuse is not.
 *
 * Created lazily and safely by services/invoiceNumbering.ts, which bootstraps a clinic that already has invoices ABOVE its highest
 * existing number — so no data migration is required and old clinics keep working.
 */
export interface IInvoiceCounter extends Document {
  clinicId: Types.ObjectId;
  seq: number;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceCounterSchema = new Schema<IInvoiceCounter>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    seq: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

invoiceCounterSchema.index({ clinicId: 1 }, { unique: true });

export const InvoiceCounter =
  (mongoose.models.InvoiceCounter as mongoose.Model<IInvoiceCounter>) ||
  mongoose.model<IInvoiceCounter>("InvoiceCounter", invoiceCounterSchema);
