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
}

export interface IInvoice extends Document {
  clinicId: Types.ObjectId;
  invoiceNumber: number;
  patientId: Types.ObjectId;
  appointmentId?: Types.ObjectId;
  items: IInvoiceItem[];
  discount: number;
  total: number;
  payments: IPayment[];
  status: "unpaid" | "partially_paid" | "paid";
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<IInvoice>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true, index: true },
    invoiceNumber: { type: Number, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true, index: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },
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
      },
    ],
    status: {
      type: String,
      enum: ["unpaid", "partially_paid", "paid"],
      default: "unpaid",
    },
  },
  { timestamps: true }
);

invoiceSchema.index({ clinicId: 1, invoiceNumber: 1 }, { unique: true });

export const Invoice = mongoose.model<IInvoice>("Invoice", invoiceSchema);
