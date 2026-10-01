import mongoose, { Schema, Document, Types } from "mongoose";
import { PLAN_STATUSES, PRIORITIES, TARGET_TYPES, GENERAL_AREAS, type PlanStatus, type Priority, type TargetType } from "../config/dermProcedures";
import { RECORD_TYPES, SURFACE_IDS, type DermRecordType, type SurfaceId } from "../config/dermatology";

/**
 * Treatment Plan Item = clinical INTENT ("what the clinician intends to do"). It is NOT performed work (that is a
 * DermTreatmentSession), NOT an observation (DermAssessment) and NOT a charge (Invoice).
 *
 *  - `regions` use the stable Phase-1 anatomical region ids (never mesh names). `regionIds` is a server-derived flat
 *    copy for the multikey index only. A GENERAL treatment has no regions (no fake ids) and may name an area group.
 *  - `statusHistory` is append-only: a lifecycle change is never simply overwritten, and cancelled items stay.
 *  - `estimatedPrice` is an ESTIMATE only — never an invoice, payment, debt or balance.
 *  - `sourceAssessmentId` / `sourceDiagnosis` are provenance. The diagnosis is a read-only SNAPSHOT of the text the
 *    clinician wrote on the assessment (the diagnosis itself stays a field of the assessment; nothing is inferred).
 *  - `billing` is a LINK to an existing Invoice line (see services/dermBilling.ts), not a financial record.
 */
export interface IStatusEntry {
  status: PlanStatus;
  at: Date;
  by: Types.ObjectId;
  appointmentId?: Types.ObjectId;
  note?: string;
}
export interface IBilling {
  state: "none" | "pending" | "invoiced";
  claimId?: string;
  invoiceId?: Types.ObjectId;
  invoiceItemId?: Types.ObjectId;
  invoiceNumber?: number;
  amount?: number;
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

export interface IDermTreatmentItem extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  planId: Types.ObjectId;
  recordType: DermRecordType;
  procedureCode: string;
  catalogVersion: number;
  targetType: TargetType;
  regions: { id: string; surface?: SurfaceId }[];
  regionIds: string[];
  generalArea?: string;
  status: PlanStatus;
  priority: Priority;
  phase: number;
  estimatedPrice?: number;
  notes?: string;
  sourceAssessmentId?: Types.ObjectId;
  sourceDiagnosis?: string;
  cancelReason?: string;
  statusHistory: IStatusEntry[];
  billing?: IBilling;
  billingHistory: IBillingEvent[];
  clientRequestId: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const itemSchema = new Schema<IDermTreatmentItem>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    planId: { type: Schema.Types.ObjectId, ref: "DermTreatmentPlan", required: true },
    recordType: { type: String, enum: RECORD_TYPES, required: true },
    procedureCode: { type: String, required: true, trim: true, maxlength: 40 }, // validated against config/dermProcedures.ts
    catalogVersion: { type: Number, required: true },
    targetType: { type: String, enum: TARGET_TYPES, required: true },
    regions: { type: [{ _id: false, id: { type: String, required: true, maxlength: 60 }, surface: { type: String, enum: SURFACE_IDS } }], default: [] },
    regionIds: { type: [String], default: [] },
    generalArea: { type: String, enum: GENERAL_AREAS },
    status: { type: String, enum: PLAN_STATUSES, default: "planned", required: true },
    priority: { type: String, enum: PRIORITIES, default: "normal" },
    phase: { type: Number, default: 1, min: 1, max: 20 },
    estimatedPrice: { type: Number, min: 0 },
    notes: { type: String, trim: true, maxlength: 1000 },
    sourceAssessmentId: { type: Schema.Types.ObjectId, ref: "DermAssessment" },
    sourceDiagnosis: { type: String, trim: true, maxlength: 300 },
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
    clientRequestId: { type: String, required: true, trim: true, minlength: 8, maxlength: 64 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);
// Query patterns -> indexes (kept deliberately few):
//  1. patient's plan, grouped by status             -> clinic+patient+status
//  2. Area History / region focus (multikey)        -> clinic+patient+regionIds
//  3. dashboard counts + active lists + needs-billing -> clinic+status+updatedAt
//  4. source-assessment lookups                      -> clinic+sourceAssessmentId (sparse by nature: only some items have one)
//  5. idempotent create (unique per clinic)          -> clinic+clientRequestId
itemSchema.index({ clinicId: 1, patientId: 1, status: 1 });
itemSchema.index({ clinicId: 1, patientId: 1, regionIds: 1 });
itemSchema.index({ clinicId: 1, status: 1, updatedAt: -1 });
itemSchema.index({ clinicId: 1, sourceAssessmentId: 1 });
itemSchema.index({ clinicId: 1, clientRequestId: 1 }, { unique: true });

export const DermTreatmentItem = mongoose.model<IDermTreatmentItem>("DermTreatmentItem", itemSchema);
