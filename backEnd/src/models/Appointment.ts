import mongoose, { Schema, Document, Types } from "mongoose";

export interface IAppointment extends Document {
  clinicId: Types.ObjectId;
  patientId?: Types.ObjectId;
  doctorId: Types.ObjectId;
  startAt: Date;
  duration: number;
  status: "scheduled" | "confirmed" | "completed" | "cancelled" | "no_show";
  source: "dashboard" | "public" | "walk_in";
  type: "appointment" | "blocked";
  blockNote?: string;
  visitType?: "consultation" | "procedure";
  procedureNote?: string;
  visitNote?: string;
  cancelReason?: string;
  refCode?: string;
  // PHASE 3.5 — Walk-in only (both optional, so every existing document stays valid):
  //   createdBy  — the staff member who registered the walk-in at reception (a real user reference, not a name).
  //   requestKey — idempotency key ("clinic:patient:doctor:requestId") so a double-clicked / retried "Register walk-in"
  //                can only ever create ONE record. Unique+sparse: records without a key are not constrained at all.
  createdBy?: Types.ObjectId;
  requestKey?: string;
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
      // Required for real appointments, absent for the doctor's own blocked slots
      required: function (this: IAppointment) {
        return this.type !== "blocked";
      },
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
      enum: ["dashboard", "public", "walk_in"],
      default: "dashboard",
    },
    type: {
      type: String,
      enum: ["appointment", "blocked"],
      default: "appointment",
      index: true,
    },
    blockNote: { type: String },
    visitType: {
      type: String,
      enum: ["consultation", "procedure"],
      default: "consultation",
    },
    procedureNote: { type: String },
    visitNote: { type: String },
    cancelReason: { type: String },
    refCode: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    requestKey: { type: String, maxlength: 200 },
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
// PHASE 3 — unified clinical History reads this patient's records newest-first (keyset on the date field).
appointmentSchema.index({ clinicId: 1, patientId: 1, startAt: -1 });
// FIX #11 (F-05) — refCode uniqueness. Sparse because only public bookings
// ever get one (dashboard/walk-in/AI-created and blocked appointments never
// set it) — a plain unique index would incorrectly forbid more than one
// appointment with no refCode at all. Sparse excludes documents where the
// field is missing entirely from the uniqueness constraint, so this only
// ever governs the appointments that actually have a refCode.
appointmentSchema.index({ refCode: 1 }, { unique: true, sparse: true });
// PHASE 3.5 — walk-in double-submit guard (see `requestKey` above). Sparse: only walk-ins created with a request id carry one.
appointmentSchema.index({ requestKey: 1 }, { unique: true, sparse: true });

export const Appointment = mongoose.model<IAppointment>("Appointment", appointmentSchema);
