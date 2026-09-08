import { Patient } from "../../../../models/Patient";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";

export const searchPatientsDefinition: AIToolDefinition = {
  name: "searchPatients",
  description:
    "Searches the clinic's patients by name or phone number. Use this to find a patient's id before booking an appointment or creating an invoice for them.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name or phone number (or part of it) to search for" },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

export async function searchPatientsExecute(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  if (!ctx.clinicId) return { error: "Not authenticated" };
  const query = String(input.query ?? "").trim();
  if (!query) return { patients: [] };

  const patients = await Patient.find({
    clinicId: ctx.clinicId,
    isArchived: false,
    $or: [{ fullName: { $regex: query, $options: "i" } }, { phone: { $regex: query } }],
  })
    .select("fullName phone fileNumber")
    .limit(10);

  return {
    patients: patients.map((p) => ({
      id: String(p._id),
      fullName: p.fullName,
      phone: p.phone,
      fileNumber: p.fileNumber,
    })),
  };
}
