import { z } from "zod";
import { Lead } from "../../../models/Lead";
import type { AIToolDefinition } from "../AIProvider";
import type { ToolContext } from "./types";

export const createLeadDefinition: AIToolDefinition = {
  name: "createLead",
  description:
    "Saves a visitor's contact details as a sales lead, once they've shown genuine interest in subscribing to ClinicOS (e.g. asking for a trial, how to sign up their clinic, or to be contacted). Only call this after clear interest — never ask for these details on a simple informational question. Always confirm the details back to the visitor in your reply right after calling this.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "The visitor's full name" },
      phone: { type: "string", description: "The visitor's phone number, as they typed it" },
      clinicName: { type: "string", description: "The name of their clinic, if mentioned" },
      notes: { type: "string", description: "A short note on what they're interested in" },
    },
    required: ["name", "phone"],
    additionalProperties: false,
  },
};

const inputSchema = z.object({
  name: z.string().min(2).max(100),
  phone: z.string().min(7).max(20),
  clinicName: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
});

export async function createLeadExecute(
  rawInput: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  const input = inputSchema.parse(rawInput);

  const lead = await Lead.create({
    name: input.name,
    phone: input.phone,
    clinicName: input.clinicName,
    notes: input.notes,
    conversationId: ctx.conversationObjectId,
  });

  return { success: true, leadId: String(lead._id) };
}
