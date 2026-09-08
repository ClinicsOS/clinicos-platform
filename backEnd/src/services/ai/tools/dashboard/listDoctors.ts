import { User } from "../../../../models/User";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";

export const listDoctorsDefinition: AIToolDefinition = {
  name: "listDoctors",
  description:
    "Lists the clinic's active doctors with their id and name. Call this before createAppointment if you don't already know the doctor's id — staff usually only give a doctor's name.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

export async function listDoctorsExecute(
  _input: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  if (!ctx.clinicId) return { error: "Not authenticated" };

  const doctors = await User.find({ clinicId: ctx.clinicId, role: "doctor", isActive: true }).select(
    "name"
  );

  return { doctors: doctors.map((d) => ({ id: String(d._id), name: d.name })) };
}
