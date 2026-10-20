import { z } from "zod";
import { createNumberedInvoice } from "../../../invoiceNumbering";
import { Patient } from "../../../../models/Patient";
import type { AIToolDefinition } from "../../AIProvider";
import type { ToolContext } from "../types";
import { scopeOf } from "../../../../auth/policy";
import { resolveManualInvoiceDoctor } from "../../../doctorAttribution";
import { canAccessPatient, viewerOfCtx } from "../../../../auth/patientAccess";

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
  // PHASE 1 — a patient the user may not open is "not found" (a doctor bills only his own / covered patients).
  const viewer = viewerOfCtx(ctx);
  if (!patient || !viewer || !(await canAccessPatient(viewer, input.patientId, "patients"))) return { error: "Patient not found" };

  // PHASE 4 — same attribution + access rules as POST /api/invoices (the creator is never the treating doctor).
  const doctorId = await resolveManualInvoiceDoctor(scopeOf(ctx, "invoices"), { doctorId: input.doctorId, patientId: input.patientId });

  const round3 = (n: number) => Math.round(n * 1000) / 1000;
  const itemsTotal = input.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const total = round3(Math.max(0, itemsTotal - input.discount));

  // PHASE 3 — the same canonical generator as POST /api/invoices
  const invoice = await createNumberedInvoice(ctx.clinicId, {
    patientId: input.patientId,
    ...(doctorId ? { doctorId } : {}),
    createdBy: ctx.userId,
    items: input.items,
    discount: input.discount,
    total,
    status: total === 0 ? "paid" : "unpaid",
  });
  if (!invoice) return { error: "Could not create the invoice, please try again" };

  return {
    success: true,
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    total,
    patientName: patient.fullName,
  };
}
