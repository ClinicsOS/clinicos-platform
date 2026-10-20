import { Patient } from "../../../../models/Patient";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";
import { patientSearchFilter } from "../../../patientSearch";
import { accessiblePatientIds, viewerOfCtx } from "../../../../auth/patientAccess";

export const searchPatientsDefinition: AIToolDefinition = {
  name: "searchPatients",
  description:
    "Searches the patients the signed-in user is allowed to open, by name or phone number. Use this to find a patient's id before booking an appointment or creating an invoice for them.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Name or phone number (or part of it) to search for" },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

/**
 * PHASE 1 (multi-doctor patient isolation) — the assistant searches with EXACTLY the scope of the patient list (GET /api/patients):
 * a doctor finds only his own patients and the ones he currently covers; the owner and the front desk find the whole clinic.
 * The query is escaped (a "(" or "+" from a user message can no longer crash the search or inject a pattern), and the scope is a
 * filter on the query itself — a patient outside it is never read, so it can never reach the model.
 */
export async function searchPatientsExecute(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  if (!ctx.clinicId) return { error: "Not authenticated" };
  const viewer = viewerOfCtx(ctx);
  if (!viewer) return { error: "Not authenticated" };
  const query = String(input.query ?? "").trim();
  if (!query) return { patients: [] };

  const filter = patientSearchFilter(ctx.clinicId, query);
  const scope = await accessiblePatientIds(viewer, "patients"); // null = whole clinic
  if (scope !== null) filter._id = { $in: scope };

  const patients = await Patient.find(filter).select("fullName phone fileNumber").limit(10);

  return {
    patients: patients.map((p) => ({
      id: String(p._id),
      fullName: p.fullName,
      phone: p.phone,
      fileNumber: p.fileNumber,
    })),
  };
}
