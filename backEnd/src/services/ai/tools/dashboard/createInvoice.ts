import { z } from "zod";
import { Invoice } from "../../../../models/Invoice";
import { Patient } from "../../../../models/Patient";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";

export const createInvoiceDefinition: AIToolDefinition = {
  name: "createInvoice",
  description:
    "Creates a new invoice for a patient with one or more line items. Requires patientId (from searchPatients). Only call this AFTER the staff member has explicitly confirmed the items and amounts — never on the first mention of wanting to bill someone.",
  inputSchema: {
    type: "object",
    properties: {
      patientId: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            price: { type: "number" },
            qty: { type: "number" },
          },
          required: ["description", "price"],
        },
      },
      discount: { type: "number" },
    },
    required: ["patientId", "items"],
    additionalProperties: false,
  },
};

const inputSchema = z.object({
  patientId: z.string().length(24),
  items: z
    .array(
      z.object({
        description: z.string().min(1).max(200),
        price: z.number().min(0),
        qty: z.number().min(1).default(1),
      })
    )
    .min(1),
  discount: z.number().min(0).default(0),
});

export async function createInvoiceExecute(
  rawInput: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  if (!ctx.clinicId) return { error: "Not authenticated" };
  const input = inputSchema.parse(rawInput);

  const patient = await Patient.findOne({ _id: input.patientId, clinicId: ctx.clinicId });
  if (!patient) return { error: "Patient not found" };

  const itemsTotal = input.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const total = Math.max(0, itemsTotal - input.discount);

  const count = await Invoice.countDocuments({ clinicId: ctx.clinicId });

  const invoice = await Invoice.create({
    clinicId: ctx.clinicId,
    invoiceNumber: count + 1,
    patientId: input.patientId,
    items: input.items,
    discount: input.discount,
    total,
    status: total === 0 ? "paid" : "unpaid",
  });

  return {
    success: true,
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    total,
    patientName: patient.fullName,
  };
}
