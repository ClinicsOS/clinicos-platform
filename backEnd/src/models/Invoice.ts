import mongoose, { Schema, Document, Types } from "mongoose";

interface IInvoiceItem {
  description: string;
  price: number;
  qty: number;
}
interface IPayment {
  amount: number;
  method: "cash" | "cliq" | "card" | "other";
  paidAt: Date;
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
