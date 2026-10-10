import { z } from "zod";
import { nextNumber, retryPause, NUMBER_ATTEMPTS } from "../../../numbering";
import { Invoice } from "../../../../models/Invoice";
import { Patient } from "../../../../models/Patient";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";
import { scopeOf } from "../../../../auth/policy";
import { resolveManualInvoiceDoctor } from "../../../doctorAttribution";

export const createInvoiceDefinition: AIToolDefinition = {
  name: "createInvoice",
  description:
    "Creates a new invoice for a patient with one or more line items. Requires patientId (from searchPatients). Only call this AFTER the staff member has explicitly confirmed the items and amounts — never on the first mention of wanting to bill someone.",
  inputSchema: {
    type: "object",
    properties: {
      patientId: { type: "string" },
      doctorId: { type: "string", description: "Optional — the treating doctor (from listDoctors). A doctor account always bills as themself." },
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
  doctorId: z.string().length(24).optional(),
  items: z
    .array(
      z.object({
        description: z.string().min(1).max(200),
        price: z.number().finite().min(0).max(100000),
        qty: z.number().finite().min(1).max(1000).default(1),
      })
    )
    .min(1)
    .max(100),
  discount: z.number().finite().min(0).max(10_000_000).default(0),
});

export async function createInvoiceExecute(
  rawInput: Record<string, unknown>,
  ctx: ToolContext
): Promise<Record<string, unknown>> {
  if (!ctx.clinicId) return { error: "Not authenticated" };
  const input = inputSchema.parse(rawInput);

  const patient = await Patient.findOne({ _id: input.patientId, clinicId: ctx.clinicId });
  if (!patient) return { error: "Patient not found" };

  // PHASE 4 — same attribution + access rules as POST /api/invoices (the creator is never the treating doctor).
  const doctorId = await resolveManualInvoiceDoctor(scopeOf(ctx, "invoices"), { doctorId: input.doctorId, patientId: input.patientId });

  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const itemsTotal = input.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const total = round3(Math.max(0, itemsTotal - input.discount));

  // PHASE 7 — same numbering + retry as POST /api/invoices
  let invoice: InstanceType<typeof Invoice> | null = null;
  for (let attempt = 0; attempt < NUMBER_ATTEMPTS && !invoice; attempt++) {
    await retryPause(attempt);
    const next = await nextNumber(Invoice, ctx.clinicId, "invoiceNumber");
    try {
      invoice = await new Invoice({
        clinicId: ctx.clinicId,
        invoiceNumber: next,
        patientId: input.patientId,
        ...(doctorId ? { doctorId } : {}),
        createdBy: ctx.userId,
        items: input.items,
        discount: input.discount,
        total,
        status: total === 0 ? "paid" : "unpaid",
      }).save();
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
    }
  }
  if (!invoice) return { error: "Could not create the invoice, please try again" };

  return {
    success: true,
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    total,
    patientName: patient.fullName,
  };
}
