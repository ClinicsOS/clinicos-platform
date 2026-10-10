import { Appointment } from "../../../../models/Appointment";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";
import { scopeOf, doctorMatch } from "../../../../auth/policy";
import { clinicTodayRange } from "../../../../utils/timezone";

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

  // PHASE 7 — "today" = the clinic-local calendar day, not the UTC day.
  const { start: todayStart, end: todayEnd } = clinicTodayRange();

  const filter: Record<string, unknown> = {
    clinicId: ctx.clinicId,
    type: { $ne: "blocked" },
    startAt: { $gte: todayStart, $lt: todayEnd },
  };
  // PHASE 4 — same rule as the schedule board: a doctor's scope is always their own appointments.
  const scope = scopeOf(ctx, "appointments", typeof input.doctorId === "string" ? input.doctorId : undefined);
  Object.assign(filter, doctorMatch(scope));

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
