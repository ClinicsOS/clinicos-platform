import mongoose, { Schema, Document, Types } from "mongoose";
import { RECORD_TYPES, SURFACE_IDS, type DermRecordType, type SurfaceId } from "../config/dermatology";
import { TARGET_TYPES, type TargetType } from "../config/dermProcedures";

/**
 * Treatment Session = work ACTUALLY performed, linked to an EXISTING ClinicOS visit (Appointment — scheduled, public
 * booking, dashboard or walk-in). There is deliberately no DermVisit / AestheticVisit model.
 *
 * `procedureCode` / `recordType` / `targetType` / `regions` are a SNAPSHOT taken when the session starts, so the
 * historical record stays understandable even if the plan item is later changed. `treatedRegions` is what was actually
 * treated in THIS session (defaults to the item's regions).
 *
 * Session notes are PROCEDURE-specific; the visit's own notes (Appointment.visitNote) are untouched and coexist.
 * `product` / `device` are OPTIONAL clinician-entered traceability blocks (documentation only, never validated
 * clinically and never recommended by the system).
 *
 * Unique indexes make duplicates impossible at the DB level:
 *   - one session per (item, visit)         -> a double-clicked "Start" cannot create two
 *   - one number per (item, sessionNumber)  -> session numbers never collide
 */
export interface IProductInfo { name?: string; brand?: string; lotNumber?: string; expiryDate?: string; quantity?: string; unit?: string; notes?: string }
export interface IDeviceInfo { name?: string; identifier?: string; settingsSummary?: string; notes?: string }

export interface IDermTreatmentSession extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  itemId: Types.ObjectId;
  appointmentId: Types.ObjectId;
  sessionNumber: number;
  recordType: DermRecordType;
  procedureCode: string;
  targetType: TargetType;
  regions: { id: string; surface?: SurfaceId }[];
  regionIds: string[];
  generalArea?: string;
  treatedRegions: { id: string; surface?: SurfaceId }[];
  status: "in_progress" | "ended";
  autoClosed?: boolean;
  procedureNotes?: string;
  observations?: string;
  outcome?: string;
  followUpInstructions?: string;
  /** Clinician-chosen review date (never computed). Drives the dashboard "Follow-Ups" list until a follow-up is documented. */
  followUpDueAt?: Date;
  followUpResolvedAt?: Date;
  product?: IProductInfo;
  device?: IDeviceInfo;
  /**
   * SNAPSHOT of the procedure identity at the time the session started (Phase 3): the catalog / documentation-schema
   * versions, the metadata kind and the EN/AR display name. Lets an old record stay understandable if the catalog is later
   * renamed or re-organised. Absent on sessions created before Phase 3 (readers fall back to the live catalog).
   */
  procedureSnapshot?: { catalogVersion: number; docSchemaVersion: number; metadata: string; labelEn: string; labelAr: string };
  performedBy: Types.ObjectId;
  /** Last user who saved documentation on this session (audit; `performedBy` stays the treating clinician). */
  updatedBy?: Types.ObjectId;
  startedAt: Date;
  endedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const regionRef = { _id: false, id: { type: String, required: true, maxlength: 60 }, surface: { type: String, enum: SURFACE_IDS } };

const sessionSchema = new Schema<IDermTreatmentSession>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    itemId: { type: Schema.Types.ObjectId, ref: "DermTreatmentItem", required: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment", required: true },
    sessionNumber: { type: Number, required: true, min: 1 },
    recordType: { type: String, enum: RECORD_TYPES, required: true },
    procedureCode: { type: String, required: true },
    targetType: { type: String, enum: TARGET_TYPES, required: true },
    regions: { type: [regionRef], default: [] },
    regionIds: { type: [String], default: [] },
    generalArea: { type: String },
    treatedRegions: { type: [regionRef], default: [] },
    status: { type: String, enum: ["in_progress", "ended"], default: "in_progress", required: true },
    autoClosed: { type: Boolean },
    procedureNotes: { type: String, trim: true, maxlength: 2000 },
    observations: { type: String, trim: true, maxlength: 2000 },
    outcome: { type: String, trim: true, maxlength: 1000 },
    followUpInstructions: { type: String, trim: true, maxlength: 1000 },
    followUpDueAt: { type: Date },
    followUpResolvedAt: { type: Date },
    product: {
      _id: false,
      name: { type: String, trim: true, maxlength: 120 },
      brand: { type: String, trim: true, maxlength: 120 },
      lotNumber: { type: String, trim: true, maxlength: 60 },
      expiryDate: { type: String, trim: true, maxlength: 10 }, // YYYY-MM-DD (a label printed on the product, not a scheduling date)
      quantity: { type: String, trim: true, maxlength: 60 },
      unit: { type: String, trim: true, maxlength: 20 },
      notes: { type: String, trim: true, maxlength: 300 },
    },
    device: {
      _id: false,
      name: { type: String, trim: true, maxlength: 120 },
      identifier: { type: String, trim: true, maxlength: 80 },
      settingsSummary: { type: String, trim: true, maxlength: 500 },
      notes: { type: String, trim: true, maxlength: 500 },
    },
    procedureSnapshot: {
      _id: false,
      catalogVersion: { type: Number },
      docSchemaVersion: { type: Number },
      metadata: { type: String, maxlength: 20 },
      labelEn: { type: String, maxlength: 120 },
      labelAr: { type: String, maxlength: 120 },
    },
    performedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date },
  },
  { timestamps: true }
);
sessionSchema.index({ itemId: 1, appointmentId: 1 }, { unique: true });
sessionSchema.index({ itemId: 1, sessionNumber: 1 }, { unique: true });
sessionSchema.index({ clinicId: 1, patientId: 1, startedAt: -1 });
sessionSchema.index({ clinicId: 1, patientId: 1, regionIds: 1, startedAt: -1 });
sessionSchema.index({ clinicId: 1, appointmentId: 1 });
// dashboard "Follow-Ups": sessions with a clinician-chosen review date that has not been documented yet
sessionSchema.index({ clinicId: 1, followUpDueAt: 1, followUpResolvedAt: 1 });

export const DermTreatmentSession = mongoose.model<IDermTreatmentSession>("DermTreatmentSession", sessionSchema);
