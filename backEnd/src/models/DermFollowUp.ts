import mongoose, { Schema, Document, Types } from "mongoose";
import { RECORD_TYPES, SURFACE_IDS, type DermRecordType, type SurfaceId } from "../config/dermatology";
import { FOLLOWUP_OUTCOMES, type FollowUpOutcome } from "../config/dermProcedures";

/**
 * Follow-Up = a clinical REVIEW after an assessment / treatment / session. It is NOT a new diagnosis and NOT an
 * assessment, and nothing in it is computed: `outcome` is chosen by the clinician (or left empty for free text only).
 *
 * It links to at least one of: an assessment, a treatment item, a session (the item is always derived from the session
 * on the server). Regions are the anatomical context (registry ids). A linked visit must be a real ClinicOS visit of
 * the same clinic + patient. Corrections keep the row: text edits are versioned (`revisions`), a wrong entry is marked
 * "entered_in_error" (never deleted).
 */
export interface IDermFollowUp extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  recordType: DermRecordType;
  itemId?: Types.ObjectId;
  sessionId?: Types.ObjectId;
  assessmentId?: Types.ObjectId;
  appointmentId?: Types.ObjectId;
  regions: { id: string; surface?: SurfaceId }[];
  regionIds: string[];
  outcome?: FollowUpOutcome;
  clinicianAssessment?: string;
  progress?: string;
  complications?: string;
  notes?: string;
  nextStep?: string;
  status: "active" | "entered_in_error";
  rev: number;
  revisions: { at: Date; by: Types.ObjectId; previous: Record<string, string> }[];
  resolution?: { at: Date; by: Types.ObjectId; reason: string; note?: string };
  clientRequestId: string;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IDermFollowUp>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    recordType: { type: String, enum: RECORD_TYPES, required: true },
    itemId: { type: Schema.Types.ObjectId, ref: "DermTreatmentItem" },
    sessionId: { type: Schema.Types.ObjectId, ref: "DermTreatmentSession" },
    assessmentId: { type: Schema.Types.ObjectId, ref: "DermAssessment" },
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },
    regions: { type: [{ _id: false, id: { type: String, required: true, maxlength: 60 }, surface: { type: String, enum: SURFACE_IDS } }], default: [] },
    regionIds: { type: [String], default: [] },
    outcome: { type: String, enum: FOLLOWUP_OUTCOMES },
    clinicianAssessment: { type: String, trim: true, maxlength: 2000 },
    progress: { type: String, trim: true, maxlength: 2000 },
    complications: { type: String, trim: true, maxlength: 2000 },
    notes: { type: String, trim: true, maxlength: 2000 },
    nextStep: { type: String, trim: true, maxlength: 1000 },
    status: { type: String, enum: ["active", "entered_in_error"], default: "active", required: true },
    rev: { type: Number, default: 0, min: 0 },
    revisions: [{ _id: false, at: { type: Date, required: true }, by: { type: Schema.Types.ObjectId, ref: "User", required: true }, previous: { type: Schema.Types.Mixed } }],
    resolution: { _id: false, at: { type: Date }, by: { type: Schema.Types.ObjectId, ref: "User" }, reason: { type: String, enum: ["entered_in_error"] }, note: { type: String, trim: true, maxlength: 500 } },
    clientRequestId: { type: String, required: true, trim: true, minlength: 8, maxlength: 64 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);
schema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
schema.index({ clinicId: 1, patientId: 1, regionIds: 1, createdAt: -1 });
schema.index({ clinicId: 1, itemId: 1, createdAt: -1 });
schema.index({ clinicId: 1, createdAt: -1 }); // dashboard "recent activity"
schema.index({ clinicId: 1, clientRequestId: 1 }, { unique: true });

export const DermFollowUp = mongoose.model<IDermFollowUp>("DermFollowUp", schema);
