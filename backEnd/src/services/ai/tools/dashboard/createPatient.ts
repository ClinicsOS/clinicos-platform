import { z } from "zod";
import { nextNumber, retryPause, NUMBER_ATTEMPTS } from "../../../numbering";
import { Patient } from "../../../../models/Patient";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";

export const createPatientDefinition: AIToolDefinition = {
  name: "createPatient",
  description:
    "Registers a new patient file for the clinic. Requires at least full name and phone number. Only call this AFTER the staff member has explicitly confirmed the patient's details — never on the first mention of a new patient.",
  inputSchema: {
    type: "object",
    properties: {
      fullName: { type: "string" },
      phone: { type: "string" },
      email: { type: "string" },
      gender: { type: "string", enum: ["male", "female"] },
      birthDate: { type: "string", description: "YYYY-MM-DD, optional" },
      medicalNotes: { type: "string" },
    },
    required: ["fullName", "phone"],
    additionalProperties: false,
  },
};

const inputSchema = z.object({
  fullName: z.string().min(2).max(100),
  phone: z.string().min(7).max(20),
  email: z.string().email().optional(),
  gender: z.enum(["male", "female"]).optional(),
  birthDate: z.string().optional(),
  medicalNotes: z.string().max(1000).optional(),
});

export async function createPatientExecute(
  rawInput: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  if (!ctx.clinicId) return { error: "Not authenticated" };
  const input = inputSchema.parse(rawInput);

  // PHASE 7 — same numbering + retry as POST /api/patients (a parallel registration used to fail on the file-number index)
  for (let attempt = 0; attempt < NUMBER_ATTEMPTS; attempt++) {
    await retryPause(attempt);
    const next = await nextNumber(Patient, ctx.clinicId, "fileNumber");
    try {
      const patient = await Patient.create({
        fullName: input.fullName,
        phone: input.phone,
        email: input.email,
        gender: input.gender,
        birthDate: input.birthDate ? new Date(input.birthDate) : undefined,
        medicalNotes: input.medicalNotes,
        clinicId: ctx.clinicId,
        fileNumber: next,
      });

      return {
        success: true,
        patientId: String(patient._id),
        fullName: patient.fullName,
        fileNumber: patient.fileNumber,
      };
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      // Patient has a unique {clinicId, phone} index — a duplicate PHONE is a clean message; a duplicate FILE NUMBER is retried.
      if (String(err?.keyPattern ? Object.keys(err.keyPattern) : err?.message).includes("phone")) {
        return { error: "A patient with this phone number already exists at this clinic" };
      }
    }
  }
  return { error: "Could not register the patient, please try again" };
}
