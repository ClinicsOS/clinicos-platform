import { Appointment } from "../../../../models/Appointment";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";

export const listTodayAppointmentsDefinition: AIToolDefinition = {
  name: "listTodayAppointments",
  description:
    "Lists today's appointments for the clinic with patient name, doctor name, time, and status. Optionally filter to one doctor by id (from listDoctors).",
  inputSchema: {
    type: "object",
    properties: {
      doctorId: { type: "string", description: "Optional — limit to one doctor's appointments" },
    },
    additionalProperties: false,
  },
};

export async function listTodayAppointmentsExecute(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  if (!ctx.clinicId) return { error: "Not authenticated" };

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setUTCDate(todayEnd.getUTCDate() + 1);

  const filter: Record<string, unknown> = {
    clinicId: ctx.clinicId,
    type: { $ne: "blocked" },
    startAt: { $gte: todayStart, $lt: todayEnd },
  };
  if (typeof input.doctorId === "string" && input.doctorId) filter.doctorId = input.doctorId;

  const appointments = await Appointment.find(filter)
    .sort({ startAt: 1 })
    .populate("patientId", "fullName phone")
    .populate("doctorId", "name")
    .limit(100);

  return {
    count: appointments.length,
    appointments: appointments.map((a: any) => ({
      id: String(a._id),
      patientName: a.patientId?.fullName ?? "—",
      doctorName: a.doctorId?.name ?? "—",
      startAt: a.startAt,
      status: a.status,
      visitType: a.visitType,
    })),
  };
}
