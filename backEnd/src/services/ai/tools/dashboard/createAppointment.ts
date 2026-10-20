import { z } from "zod";
import { Appointment } from "../../../../models/Appointment";
import { Patient } from "../../../../models/Patient";
import { User } from "../../../../models/User";
import { Clinic } from "../../../../models/Clinic";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";
import { scopeOf, assertWritableDoctor } from "../../../../auth/policy";
import { checkDoctorTiming } from "../../../doctorSchedule";
import {
  checkAppointmentTiming,
  checkAppointmentPlanCap,
} from "../../../appointmentRules";
import { findOverlappingAppointment } from "../../../appointmentAvailability";
import { canAccessPatient, viewerOfCtx } from "../../../../auth/patientAccess";
import { ensurePrimaryAccess } from "../../../patientAccess";

// This tool now enforces the SAME business rules as the human dashboard flow
// (controllers/appointmentController.ts) by calling the shared
// services/appointmentRules.ts helpers — working hours, break windows, and the
// trial plan's appointment cap — in addition to the past-time and
// double-booking guards it already had.
export const createAppointmentDefinition: AIToolDefinition = {
  name: "createAppointment",
  description:
    "Books a new appointment for an existing patient with a doctor. Requires patientId (from searchPatients) and doctorId (from listDoctors). Only call this AFTER the staff member has explicitly confirmed the patient, doctor, and date/time in the conversation — never on the first mention of wanting to book something.",
  inputSchema: {
    type: "object",
    properties: {
      patientId: { type: "string" },
      doctorId: { type: "string" },
      startAt: { type: "string", description: "ISO 8601 datetime, e.g. 2026-09-10T09:00:00.000Z" },
      duration: { type: "number", description: "Minutes, optional — defaults to the clinic's standard slot length" },
      visitType: { type: "string", enum: ["consultation", "procedure"] },
      procedureNote: { type: "string", description: "Required if visitType is 'procedure'" },
    },
    required: ["patientId", "doctorId", "startAt"],
    additionalProperties: false,
  },
};

const inputSchema = z.object({
  patientId: z.string().length(24),
  doctorId: z.string().length(24),
  startAt: z.string(),
  duration: z.number().min(10).max(180).optional(),
  visitType: z.enum(["consultation", "procedure"]).default("consultation"),
  procedureNote: z.string().max(200).optional(),
});

export async function createAppointmentExecute(
  rawInput: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  if (!ctx.clinicId) return { error: "Not authenticated" };
  const input = inputSchema.parse(rawInput);
  assertWritableDoctor(scopeOf(ctx, "appointments"), input.doctorId); // PHASE 4 — a doctor books only for themself

  const startAt = new Date(input.startAt);

  const [patient, doctor, clinic] = await Promise.all([
    Patient.findOne({ _id: input.patientId, clinicId: ctx.clinicId }),
    User.findOne({ _id: input.doctorId, clinicId: ctx.clinicId, role: "doctor", isActive: true }),
    Clinic.findById(ctx.clinicId),
  ]);
  // PHASE 1 — same rule as the dashboard: a patient the user may not open is "not found" (a doctor books only his own / covered patients).
  const viewer = viewerOfCtx(ctx);
  if (!patient || !viewer || !(await canAccessPatient(viewer, input.patientId, "patients"))) return { error: "Patient not found" };
  if (!doctor) return { error: "Doctor not found" };
  if (!clinic) return { error: "Clinic not found" };

  const duration = input.duration ?? clinic.slotDuration;

  // Same business rules as the human dashboard flow: past-time, closed day,
  // working-hours fit, break window.
  const timing = checkAppointmentTiming(clinic, startAt, duration);
  if (timing) return { error: timing.message, code: timing.code };
  const doctorTiming = checkDoctorTiming(doctor.workingHours, startAt, duration); // PHASE 4 — the doctor's own hours
  if (doctorTiming) return { error: doctorTiming.message, code: doctorTiming.code };

  // Same trial appointment cap as the human dashboard flow.
  const count = await Appointment.countDocuments({ clinicId: ctx.clinicId });
  const cap = checkAppointmentPlanCap(clinic, count);
  if (cap) return { error: cap.message, code: cap.code };

  // Same real interval-overlap conflict check as the human dashboard flow —
  // catches landing inside an existing longer appointment/block too.
  const conflict = await findOverlappingAppointment(ctx.clinicId, input.doctorId, startAt, duration);
  if (conflict) return { error: "This time slot is already taken for this doctor" };

  const appointment = await Appointment.create({
    clinicId: ctx.clinicId,
    patientId: input.patientId,
    doctorId: input.doctorId,
    startAt,
    duration,
    source: "dashboard",
    createdBy: ctx.userId,
    visitType: input.visitType,
    procedureNote: input.visitType === "procedure" ? input.procedureNote : undefined,
  });

  // PHASE 1 — booking a patient with a doctor makes him that doctor's patient (same as the dashboard flow).
  await ensurePrimaryAccess(ctx.clinicId, input.patientId, input.doctorId, "appointment", ctx.userId);

  return {
    success: true,
    appointmentId: String(appointment._id),
    patientName: patient.fullName,
    doctorName: doctor.name,
    startAt: appointment.startAt,
  };
}
