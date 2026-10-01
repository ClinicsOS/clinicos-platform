import mongoose, { Schema, Document, Types } from "mongoose";
import {
  RECORD_TYPES,
  SURFACE_IDS,
  MARKER_SPACE,
  MAX_TEXT,
  type DermRecordType,
  type SurfaceId,
} from "../config/dermatology";

/**
 * ONE clinical assessment made by a clinician on the Dermatology & Aesthetics anatomical map.
 *
 *  - It EXTENDS the Core patient journey: it references the existing Patient and (optionally) the existing
 *    Appointment (visit). There is no specialty visit / patient / invoice model.
 *  - ONE document can involve MANY regions (`regions[]`). It is never duplicated per region: every linked region's
 *    history query finds this same row through `regionIds`.
 *  - `regionIds` is a server-derived flat copy of `regions[].id` (used only for the multikey index); it is never
 *    accepted from the client.
 *  - `recordType` (dermatology | aesthetic) is a REQUIRED, immutable choice. The two workflows share the map but
 *    are never merged: an aesthetic concern is not a diagnosis, and a dermatology assessment needs no diagnosis.
 *  - `diagnosis` is free text ENTERED BY THE CLINICIAN. Nothing in the system infers or suggests one.
 *  - Clinical history never silently disappears: text edits push the PREVIOUS values onto `revisions` (who/when),
 *    and a wrong entry is marked `entered_in_error` (with who/when/why) instead of being deleted.
 *  - `clientRequestId` makes a submission idempotent (double click / retry after a network drop).
 */
export interface IDermAssessment extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  appointmentId?: Types.ObjectId;
  recordType: DermRecordType;
  regions: Array<{ id: string; surface?: SurfaceId }>;
  regionIds: string[];
  markers: Array<{ regionId: string; u: number; v: number; w: number }>;
  markerSpace: string;
  concern?: string;
  findings?: string;
  diagnosis?: string;
  notes?: string;
  status: "active" | "entered_in_error";
  rev: number;
  clientRequestId: string;
  registryVersion: number;
  createdBy: Types.ObjectId;
  revisions: Array<{
    at: Date;
    by: Types.ObjectId;
    previous: { concern?: string; findings?: string; diagnosis?: string; notes?: string };
  }>;
  resolution?: { at: Date; by: Types.ObjectId; reason: "entered_in_error"; note?: string };
  createdAt: Date;
  updatedAt: Date;
}

const text = (max: number) => ({ type: String, trim: true, maxlength: max });

const schema = new Schema<IDermAssessment>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    appointmentId: { type: Schema.Types.ObjectId, ref: "Appointment" },
    recordType: { type: String, enum: RECORD_TYPES, required: true },
    regions: {
      type: [
        {
          _id: false,
          id: { type: String, required: true, trim: true, maxlength: 60 },
          surface: { type: String, enum: SURFACE_IDS },
        },
      ],
      validate: [(v: unknown[]) => Array.isArray(v) && v.length >= 1, "At least one region is required"],
    },
    regionIds: { type: [String], required: true },
    markers: {
      type: [
        {
          _id: false,
          regionId: { type: String, required: true, maxlength: 60 },
          u: { type: Number, required: true, min: 0, max: 1 },
          v: { type: Number, required: true, min: 0, max: 1 },
          w: { type: Number, required: true, min: 0, max: 1 },
        },
      ],
      default: [],
    },
    markerSpace: { type: String, default: MARKER_SPACE },
    concern: text(MAX_TEXT.concern),
    findings: text(MAX_TEXT.findings),
    diagnosis: text(MAX_TEXT.diagnosis),
    notes: text(MAX_TEXT.notes),
    status: { type: String, enum: ["active", "entered_in_error"], default: "active", required: true },
    rev: { type: Number, default: 0, required: true },
    clientRequestId: { type: String, required: true, trim: true, minlength: 8, maxlength: 64 },
    registryVersion: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    revisions: {
      type: [
        {
          _id: false,
          at: { type: Date, required: true },
          by: { type: Schema.Types.ObjectId, ref: "User", required: true },
          previous: {
            _id: false,
            concern: { type: String, maxlength: MAX_TEXT.concern },
            findings: { type: String, maxlength: MAX_TEXT.findings },
            diagnosis: { type: String, maxlength: MAX_TEXT.diagnosis },
            notes: { type: String, maxlength: MAX_TEXT.notes },
          },
        },
      ],
      default: [],
    },
    resolution: {
      _id: false,
      at: Date,
      by: { type: Schema.Types.ObjectId, ref: "User" },
      reason: { type: String, enum: ["entered_in_error"] },
      note: { type: String, trim: true, maxlength: MAX_TEXT.voidNote },
    },
  },
  { timestamps: true }
);

// Access patterns (every query is tenant-scoped: clinicId first):
//  1. patient timeline (newest first)                         -> clinic+patient+createdAt
//  2. timeline filtered by Dermatology / Aesthetic            -> clinic+patient+recordType+createdAt
//  3. Area History for one region (multikey on regionIds)     -> clinic+patient+regionIds+createdAt
//  4. assessments documented in ONE existing visit            -> clinic+appointment
//  5. idempotent create (unique per clinic)                   -> clinic+clientRequestId
schema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
schema.index({ clinicId: 1, patientId: 1, recordType: 1, createdAt: -1 });
schema.index({ clinicId: 1, patientId: 1, regionIds: 1, createdAt: -1 });
schema.index({ clinicId: 1, appointmentId: 1 });
schema.index({ clinicId: 1, clientRequestId: 1 }, { unique: true });

export const DermAssessment = mongoose.model<IDermAssessment>("DermAssessment", schema);
