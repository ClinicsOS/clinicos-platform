import mongoose, { Schema, Document, Types } from "mongoose";
import { PLAN_STATUSES, PRIORITIES, TARGET_TYPES, type PlanStatus, type Priority, type TargetType } from "../config/dentalProcedures";
import { SURFACES, DENTITION_TYPES, type DentitionType, type SurfaceId } from "../config/dental";

/**
 * Treatment Plan Item = clinical INTENT ("what the dentist intends to do"). It is NOT performed work:
 * performed work is a DentalTreatmentSession. It is also NOT a diagnosis (DentalToothEvent).
 *
 * `statusHistory` is append-only: every lifecycle change is kept with who/when/which visit, so status is
 * never simply overwritten. `estimatedPrice` is an ESTIMATE only — never a charge, balance or invoice line.
 */
export interface IStatusEntry {
  status: PlanStatus;
  at: Date;
  by: Types.ObjectId;
  appointmentId?: Types.ObjectId; // the existing ClinicOS visit, when the change happened during one
  note?: string;
}

/**
 * Financial LINK (not a financial record): which existing Invoice line was created for this treatment.
 * The Invoice / Payment system stays the only source of truth for money.
 *   pending  = a user is in the middle of adding it (a claim, held atomically so nobody else can charge it)
 *   invoiced = the invoice line exists
 *   none     = not (or no longer) invoiced
 */
export interface IBilling {
  state: "none" | "pending" | "invoiced";
  claimId?: string;
  invoiceId?: Types.ObjectId;
  invoiceItemId?: Types.ObjectId; // the embedded invoice line's _id
  invoiceNumber?: number;
  amount?: number; // amount at the time it was added (audit snapshot; the live amount is read from the invoice line)
  description?: string;
  at?: Date;
  by?: Types.ObjectId;
}
export interface IBillingEvent {
  event: "invoiced" | "released";
  at: Date;
  by: Types.ObjectId;
  invoiceId?: Types.ObjectId;
  invoiceItemId?: Types.ObjectId;
  invoiceNumber?: number;
  amount?: number;
  reason?: string;
}

export interface IDentalTreatmentItem extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  planId: Types.ObjectId;
  procedureCode: string;
  catalogVersion: number;
  targetType: TargetType;
  toothNumbers: string[]; // FDI codes (array — never a comma-separated string)
  surfaces: SurfaceId[];
  status: PlanStatus;
  priority: Priority;
  phase: number;
  estimatedPrice?: number;
  notes?: string;
  sourceDiagnosisIds: Types.ObjectId[]; // DentalToothEvent ids (optional provenance; diagnosis stays a separate record)
  dentitionType: DentitionType; // dentition of the record when created
  cancelReason?: string;
  statusHistory: IStatusEntry[];
  billing?: IBilling;
  billingHistory: IBillingEvent[]; // append-only
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const itemSchema = new Schema<IDentalTreatmentItem>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    planId: { type: Schema.Types.ObjectId, ref: "DentalTreatmentPlan", required: true },
    procedureCode: { type: String, required: true, trim: true, maxlength: 40 }, // validated against config/dentalProcedures.ts
    catalogVersion: { type: Number, required: true },
    targetType: { type: String, enum: TARGET_TYPES, required: true },
    toothNumbers: { type: [String], default: [] },
    surfaces: { type: [{ type: String, enum: SURFACES }], default: [] },
    status: { type: String, enum: PLAN_STATUSES, default: "planned", required: true },
    priority: { type: String, enum: PRIORITIES, default: "normal" },
    phase: { type: Number, default: 1, min: 1, max: 20 },
    estimatedPrice: { type: Number, min: 0 },
    notes: { type: String, trim: true, maxlength: 1000 },
    sourceDiagnosisIds: [{ type: Schema.Types.ObjectId, ref: "DentalToothEvent" }],
    dentitionType: { type: String, enum: DENTITION_TYPES, required: true },
    cancelReason: { type: String, trim: true, maxlength: 300 },
    statusHistory: [
      {
        _id: false,
        status: { type: String, enum: PLAN_STATUSES, required: true },
        at: { type: Date, required: true },
        by: { type: Schema.Types.ObjectId, ref: "User", required: true },
        appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },
        note: { type: String, trim: true, maxlength: 300 },
      },
    ],
    billing: {
      _id: false,
      state: { type: String, enum: ["none", "pending", "invoiced"] },
      claimId: { type: String },
      invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
      invoiceItemId: { type: Schema.Types.ObjectId },
      invoiceNumber: { type: Number },
      amount: { type: Number, min: 0 },
      description: { type: String, maxlength: 200 },
      at: { type: Date },
      by: { type: Schema.Types.ObjectId, ref: "User" },
    },
    billingHistory: [
      {
        _id: false,
        event: { type: String, enum: ["invoiced", "released"], required: true },
        at: { type: Date, required: true },
        by: { type: Schema.Types.ObjectId, ref: "User", required: true },
        invoiceId: { type: Schema.Types.ObjectId },
        invoiceItemId: { type: Schema.Types.ObjectId },
        invoiceNumber: { type: Number },
        amount: { type: Number },
        reason: { type: String, maxlength: 200 },
      },
    ],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);
itemSchema.index({ clinicId: 1, patientId: 1, status: 1 });
itemSchema.index({ clinicId: 1, patientId: 1, toothNumbers: 1 });

export const DentalTreatmentItem = mongoose.model<IDentalTreatmentItem>("DentalTreatmentItem", itemSchema);
