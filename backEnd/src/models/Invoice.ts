import mongoose, { Schema, Document, Types } from "mongoose";

interface IInvoiceItem {
  description: string;
  price: number;
  qty: number;
  // Optional provenance: set ONLY by trusted server code (e.g. dental billing), never from a client payload.
  // Every existing invoice item simply has neither field.
  sourceType?: "dental_treatment" | "derm_treatment";
  sourceId?: Types.ObjectId;
}
interface IPayment {
  amount: number;
  method: "cash" | "cliq" | "card" | "other";
  paidAt: Date;
  note?: string;
  /** PHASE 7 — optional client token of the "Record payment" dialog: the same token can never record a second payment. */
  requestId?: string;
}

export interface IInvoice extends Document {
  clinicId: Types.ObjectId;
  invoiceNumber: number;
  patientId: Types.ObjectId;
  appointmentId?: Types.ObjectId;
  // PHASE 4 — who is this invoice's revenue attributed to?
  //   doctorId  — the TREATING doctor (a clinic user). Set only by trusted server code: from the treatment that was billed,
  //               from the visit's doctor, or chosen explicitly by an owner / receptionist / the doctor themself. NEVER inferred
  //               from who created the invoice. Absent on every invoice created before Phase 4 = "unassigned / legacy": it is
  //               reported as such and never guessed.
  //   createdBy — the staff member who created the invoice (audit only; it never carries revenue).
  doctorId?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  items: IInvoiceItem[];
  discount: number;
  total: number;
  payments: IPayment[];
  status: "unpaid" | "partially_paid" | "paid";
  // PHASE 2 — deletion lifecycle (soft delete -> Deleted Invoices -> restore / permanent delete). It is a state SEPARATE from the payment
  // `status`: deleting never touches items, total, payments or status, so a restored invoice contributes exactly what it did before.
  //   deletedAt == null / absent   ACTIVE  (every invoice created before Phase 2 is active: no migration)
  //   deletedAt is a Date          SOFT-DELETED: excluded from every active list, KPI, report and revenue figure (see ACTIVE_INVOICE)
  deletedAt?: Date | null;
  deletedBy?: Types.ObjectId | null;
  deleteReason?: string | null;
  /** Audit only: the LAST time this invoice was restored from Deleted Invoices, and by whom. */
  restoredAt?: Date | null;
  restoredBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<IInvoice>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    invoiceNumber: { type: Number, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },
    doctorId: { type: Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    items: [
      {
        description: { type: String, required: true },
        price: { type: Number, required: true, min: 0 },
        qty: { type: Number, required: true, min: 1, default: 1 },
        sourceType: { type: String, enum: ["dental_treatment", "derm_treatment"] },
        sourceId: { type: Schema.Types.ObjectId },
      },
    ],
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    payments: [
      {
        amount: { type: Number, required: true, min: 0 },
        method: {
          type: String,
          enum: ["cash", "cliq", "card", "other"],
          default: "cash",
        },
        paidAt: { type: Date, default: Date.now },
        // Optional — what the payment was for (e.g. "New tooth procedure").
        // Every existing payment document is still valid with no migration:
        // it simply has no note.
        note: { type: String, trim: true, maxlength: 300 },
        // PHASE 7 — idempotency token (see addPayment). Absent on every existing payment; no migration, no index.
        requestId: { type: String, maxlength: 64 },
      },
    ],
    status: {
      type: String,
      enum: ["unpaid", "partially_paid", "paid"],
      default: "unpaid",
    },
    // PHASE 2 — soft delete. No defaults on purpose: an existing document has none of these fields and `{ deletedAt: null }` matches it,
    // so every legacy invoice is ACTIVE without a migration.
    deletedAt: { type: Date, default: undefined },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User", default: undefined },
    deleteReason: { type: String, trim: true, maxlength: 300, default: undefined },
    restoredAt: { type: Date, default: undefined },
    restoredBy: { type: Schema.Types.ObjectId, ref: "User", default: undefined },
  },
  { timestamps: true }
);

invoiceSchema.index({ clinicId: 1, invoiceNumber: 1 }, { unique: true });
// PHASE 4 — a doctor's own invoice list / their revenue aggregation always starts with { clinicId, doctorId }.
invoiceSchema.index({ clinicId: 1, doctorId: 1, createdAt: -1 });

// PHASE 6 — analytics access paths (each justified by a query in services/analytics/financial.ts):
//   { clinicId, payments.paidAt }            collected revenue, whole clinic (multikey: a payment date range)
//   { clinicId, doctorId, payments.paidAt }  collected revenue, one doctor
//   { clinicId, createdAt }                  invoiced revenue / payment-status distribution, whole clinic (the Phase 4 index above covers one doctor)
invoiceSchema.index({ clinicId: 1, "payments.paidAt": 1 });
invoiceSchema.index({ clinicId: 1, doctorId: 1, "payments.paidAt": 1 });
invoiceSchema.index({ clinicId: 1, createdAt: -1 });
// PHASE 2 — the Deleted Invoices list ({ clinicId, deletedAt: { $ne: null } } newest deletion first).
invoiceSchema.index({ clinicId: 1, deletedAt: -1 });

/**
 * PHASE 2 — THE active-invoice predicate. Spread it into the filter / first $match of EVERY query that is about live invoices
 * (lists, counts, revenue, outstanding, reports, dashboards, AI). `deletedAt: null` also matches documents that do not have the field,
 * which is why existing invoices need no backfill. Only the Deleted Invoices endpoints, the lifecycle service, billing links to a
 * specific invoice id, the clinic export and the clinic purge may look at soft-deleted invoices.
 */
export const ACTIVE_INVOICE: Readonly<{ deletedAt: null }> = Object.freeze({ deletedAt: null });
/** The opposite predicate: soft-deleted invoices only (Deleted Invoices list, restore, permanent delete). */
export const DELETED_INVOICE: Readonly<{ deletedAt: { $ne: null } }> = Object.freeze({ deletedAt: { $ne: null } });

export const Invoice = mongoose.model<IInvoice>("Invoice", invoiceSchema);
