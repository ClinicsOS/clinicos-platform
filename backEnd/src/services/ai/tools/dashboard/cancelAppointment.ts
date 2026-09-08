import { z } from "zod";
import { Appointment } from "../../../../models/Appointment";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";

export const cancelAppointmentDefinition: AIToolDefinition = {
  name: "cancelAppointment",
  description:
    "Cancels an existing appointment by id, with an optional reason. Only call this AFTER the staff member has explicitly confirmed they want to cancel that specific appointment — never on the first mention of a cancellation.",
  inputSchema: {
    type: "object",
    properties: {
      appointmentId: { type: "string" },
      reason: { type: "string" },
    },
    required: ["appointmentId"],
    additionalProperties: false,
  },
};

const inputSchema = z.object({
  appointmentId: z.string().length(24),
  reason: z.string().max(300).optional(),
});

export async function cancelAppointmentExecute(
  rawInput: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  if (!ctx.clinicId) return { error: "Not authenticated" };
  const input = inputSchema.parse(rawInput);

  const appointment = await Appointment.findOneAndUpdate(
    { _id: input.appointmentId, clinicId: ctx.clinicId },
    { $set: { status: "cancelled", cancelReason: input.reason } },
    { new: true }
  );
  if (!appointment) return { error: "Appointment not found" };

  return { success: true, appointmentId: String(appointment._id) };
}
