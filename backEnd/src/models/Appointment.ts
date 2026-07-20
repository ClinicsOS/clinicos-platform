import mongoose, { Schema, Document, Types } from "mongoose";

export interface IAppointment extends Document {
  clinicId: Types.ObjectId;
  patientId: Types.ObjectId;
  doctorId: Types.ObjectId;
  startAt: Date;
  duration: number;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  source: "dashboard" | "public";
  visitNote?: string;
  cancelReason?: string;
  refCode?: string;
  readBy: Types.ObjectId[];  // users who have "read" this notification
  createdAt: Date;
  updatedAt: Date;
}

const appointmentSchema = new Schema<IAppointment>(
  {
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    startAt: { type: Date, required: true },
    duration: { type: Number, required: true, default: 30 },
    status: {
      type: String,
      enum: ["scheduled", "confirmed", "completed", "cancelled", "no_show"],
      default: "scheduled",
    },
    source: {
      type: String,
      enum: ["dashboard", "public"],
      default: "dashboard",
    },
    visitNote: { type: String },
    cancelReason: { type: String },
    refCode: { type: String, index: true },
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

appointmentSchema.index(
  { clinicId: 1, doctorId: 1, startAt: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["scheduled", "confirmed"] } },
  }
);
appointmentSchema.index({ clinicId: 1, startAt: 1 });

export const Appointment = mongoose.model<IAppointment>("Appointment", appointmentSchema);
