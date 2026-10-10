import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Patient CLINICAL note — a doctor's note in the patient's medical record.
 *
 * NOT the same thing as `ClinicNote` (platform-admin sales notes about a clinic, never shown to clinics).
 * It does not replace the older free-text fields either (Patient.medicalNotes, Appointment.visitNote,
 * DentalTreatmentSession.notes ...): those keep working exactly as before. This is the one place for
 * NEW, timestamped, attributable, edit-audited notes.
 *
 * Edit history: the note document keeps its own `revisions` array — one entry per edit holding the text that was
 * REPLACED, who replaced it and when. Because it lives in the same document, an edit and its revision are written
 * by ONE atomic update (no half-saved state, no orphan revision rows), and nothing is ever overwritten silently.
 * Notes are never deleted through the API (medical record).
 *
 * Additive & backward compatible: a new collection; no existing document or model is touched.
 */
export const CLINICAL_NOTE_SOURCES = ["patient", "appointment", "dental_treatment", "derm_treatment"] as const;
export type ClinicalNoteSource = (typeof CLINICAL_NOTE_SOURCES)[number];

export const CLINICAL_NOTE_MAX_CHARS = 5000;
/** A note document can't grow without bound (16 MB document limit): after this many edits it asks for a new note. */
export const CLINICAL_NOTE_MAX_REVISIONS = 100;

export interface IClinicalNoteRevision {
  _id: Types.ObjectId;
  text: string; // the content that was replaced by this edit
  versionAt: Date; // when that replaced content had been saved (creation or the previous edit)
  editedBy: Types.ObjectId; // who made the edit
  editedAt: Date; // when the edit was made
}

export interface IClinicalNote extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  authorId: Types.ObjectId;
  doctorId?: Types.ObjectId; // the visit's doctor when the note belongs to an appointment
  sourceType: ClinicalNoteSource;
  sourceId?: Types.ObjectId; // appointment / treatment item; absent for a plain patient note
  text: string;
  editCount: number; // also the optimistic-concurrency token for edits
  lastEditedAt?: Date;
  lastEditedBy?: Types.ObjectId;
  requestKey?: string; // idempotency key of the create request (double click / retry)
  revisions: IClinicalNoteRevision[];
  createdAt: Date;
  updatedAt: Date;
}

const revisionSchema = new Schema<IClinicalNoteRevision>(
  {
    text: { type: String, required: true, maxlength: CLINICAL_NOTE_MAX_CHARS },
    versionAt: { type: Date, required: true },
    editedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    editedAt: { type: Date, required: true },
  },
  { _id: true }
);

const clinicalNoteSchema = new Schema<IClinicalNote>(
  {
    clinicId: { type: Schema.Types.ObjectId, ref: "Clinic", required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "Patient", required: true },
    authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: "User" },
    sourceType: { type: String, enum: CLINICAL_NOTE_SOURCES, default: "patient", required: true },
    sourceId: { type: Schema.Types.ObjectId },
    text: { type: String, required: true, trim: true, minlength: 1, maxlength: CLINICAL_NOTE_MAX_CHARS },
    editCount: { type: Number, default: 0, min: 0 },
    lastEditedAt: { type: Date },
    lastEditedBy: { type: Schema.Types.ObjectId, ref: "User" },
    requestKey: { type: String, maxlength: 160 },
    revisions: { type: [revisionSchema], default: [] },
  },
  { timestamps: true }
);

// Patient file / timeline: newest first, always clinic + patient scoped.
clinicalNoteSchema.index({ clinicId: 1, patientId: 1, createdAt: -1 });
// "Notes of this visit / this treatment".
clinicalNoteSchema.index({ clinicId: 1, patientId: 1, sourceType: 1, sourceId: 1 });
// Idempotent create. Sparse (single field) so every note without a key is simply not indexed.
clinicalNoteSchema.index({ requestKey: 1 }, { unique: true, sparse: true });

export const ClinicalNote = mongoose.model<IClinicalNote>("ClinicalNote", clinicalNoteSchema);
