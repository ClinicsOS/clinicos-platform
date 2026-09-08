import { z } from "zod";
import { Appointment } from "../../../../models/Appointment";
import { Patient } from "../../../../models/Patient";
import { User } from "../../../../models/User";
import { Clinic } from "../../../../models/Clinic";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";

// NOTE (known limitation): unlike controllers/appointmentController.ts's
// createAppointment, this does NOT re-check working hours, break windows,
// or the trial plan's appointment cap. It keeps the two checks that
// prevent real data corruption — past-time and double-booking — and
// leaves the softer business rules for a follow-up hardening pass.
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

  const startAt = new Date(input.startAt);
  if (isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
    return { error: "Invalid or past appointment time" };
  }

  const [patient, doctor, clinic] = await Promise.all([
    Patient.findOne({ _id: input.patientId, clinicId: ctx.clinicId }),
    User.findOne({ _id: input.doctorId, clinicId: ctx.clinicId, role: "doctor", isActive: true }),
    Clinic.findById(ctx.clinicId),
  ]);
  if (!patient) return { error: "Patient not found" };
  if (!doctor) return { error: "Doctor not found" };
  if (!clinic) return { error: "Clinic not found" };

  const conflict = await Appointment.findOne({
    clinicId: ctx.clinicId,
    doctorId: input.doctorId,
    startAt,
    status: { $in: ["scheduled", "confirmed"] },
  });
  if (conflict) return { error: "This time slot is already taken for this doctor" };

  const appointment = await Appointment.create({
    clinicId: ctx.clinicId,
    patientId: input.patientId,
    doctorId: input.doctorId,
    startAt,
    duration: input.duration ?? clinic.slotDuration,
    source: "dashboard",
    visitType: input.visitType,
    procedureNote: input.visitType === "procedure" ? input.procedureNote : undefined,
  });

  return {
    success: true,
    appointmentId: String(appointment._id),
    patientName: patient.fullName,
    doctorName: doctor.name,
    startAt: appointment.startAt,
  };
}
