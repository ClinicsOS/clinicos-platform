import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * NEW MODEL — additive only, does not touch Clinic.ts or any existing model.
 * A running, timestamped log of internal admin notes per clinic (sales
 * calls, follow-ups, lead status) so context isn't lost between outreach
 * conversations. Never exposed to the clinic itself — admin-only.
 */
export interface IClinicNote extends Document {
  clinicId: Types.ObjectId;
  authorEmail: string;
  text: string;
  createdAt: Date;
  updatedAt: Date;
}

const clinicNoteSchema = new Schema<IClinicNote>(
  {
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    authorEmail: { type: String, required: true },
    text: { type: String, required: true, trim: true, maxlength: 5000 },
  },
  { timestamps: true }
);

// Newest notes first when listing a clinic's history
clinicNoteSchema.index({ clinicId: 1, createdAt: -1 });

export const ClinicNote = mongoose.model<IClinicNote>("ClinicNote", clinicNoteSchema);
