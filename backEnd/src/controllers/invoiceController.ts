import { Request, Response } from "express";
import { z } from "zod";
import { Invoice } from "../models/Invoice";
import { Patient } from "../models/Patient";
import { asyncHandler } from "../middleware/errorHandler";

const createInvoiceSchema = z.object({
  patientId: z.string().length(24),
  appointmentId: z.string().length(24).optional(),
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

export const createInvoice = asyncHandler(async (req: Request, res: Response) => {
  const data = createInvoiceSchema.parse(req.body);

  const patient = await Patient.findOne({
    _id: data.patientId,
    clinicId: req.clinicId,
  });
  if (!patient) return res.status(404).json({ message: "Patient not found" });

  const itemsTotal = data.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const total = Math.max(0, itemsTotal - data.discount);

  const count = await Invoice.countDocuments({ clinicId: req.clinicId });

  const invoice = await Invoice.create({
    clinicId: req.clinicId,
    invoiceNumber: count + 1,
    patientId: data.patientId,
    appointmentId: data.appointmentId,
    items: data.items,
    discount: data.discount,
    total,
    status: total === 0 ? "paid" : "unpaid",
  });

  return res.status(201).json(invoice);
});

const updateInvoiceSchema = z.object({
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

/**
 * PUT /api/invoices/:id
 * Lets staff fix mistakes on an invoice (wrong price, wrong item, printed
 * before it was corrected, etc). The one hard rule: the new total can never
 * drop below what's already been collected in payments — that would mean
 * the patient somehow overpaid, which needs a refund flow we don't have.
 */
export const updateInvoice = asyncHandler(async (req: Request, res: Response) => {
  const data = updateInvoiceSchema.parse(req.body);

  const invoice = await Invoice.findOne({ _id: req.params.id, clinicId: req.clinicId });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  const itemsTotal = data.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const newTotal = Math.max(0, itemsTotal - data.discount);

  const paidSoFar = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  if (newTotal < paidSoFar) {
    return res.status(400).json({
      message: `Can't lower the total below what's already been paid (${paidSoFar} JD collected). Adjust items or add a note instead.`,
      code: "TOTAL_BELOW_PAID",
    });
  }

  invoice.items = data.items;
  invoice.discount = data.discount;
  invoice.total = newTotal;
  invoice.status = paidSoFar === 0 ? "unpaid" : paidSoFar >= newTotal ? "paid" : "partially_paid";

  await invoice.save();
  return res.json(invoice);
});

/** Escapes user input so it can be used safely inside a RegExp. */
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * GET /api/invoices
 * Query params (all optional):
 *   status     unpaid | partially_paid | paid
 *   patientId  only this patient's invoices
 *   from / to  createdAt range (ISO)
 *   search     NEW — patient name, phone number, file number, or invoice number
 *              ("INV-0012", "#12", "12")
 *   sort       NEW — "total" = biggest invoice first (default: newest first)
 */
export const listInvoices = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, any> = { clinicId: req.clinicId };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.patientId) filter.patientId = String(req.query.patientId);
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(String(req.query.from));
    if (req.query.to) filter.createdAt.$lt = new Date(String(req.query.to));
  }

  const search = String(req.query.search || "").trim().slice(0, 60);
  if (search) {
    const or: Record<string, unknown>[] = [];

    // Invoice number: "INV-0012", "inv12", "#12", or just "12".
    // With an explicit "INV" prefix it's an invoice number ONLY; a bare
    // number / "#12" can also be a patient's file number.
    const numMatch = search.match(/^(inv[-\s]?)?#?0*(\d{1,9})$/i);
    const explicitInvoice = !!numMatch?.[1];
    if (numMatch) or.push({ invoiceNumber: Number(numMatch[2]) });

    // Patients matching by name, phone (spaces ignored) or file number.
    // Archived patients are included on purpose — their invoices still exist.
    if (!explicitInvoice) {
      const patientOr: Record<string, unknown>[] = [
        { fullName: new RegExp(escapeRegex(search), "i") },
      ];
      const digits = search.replace(/\D/g, "");
      if (digits.length >= 3) patientOr.push({ phone: new RegExp(digits.split("").join("\\D*")) });
      if (numMatch) patientOr.push({ fileNumber: Number(numMatch[2]) });

      const patients = await Patient.find({ clinicId: req.clinicId, $or: patientOr })
        .select("_id")
        .limit(500)
        .lean();
      if (patients.length) or.push({ patientId: { $in: patients.map((p) => p._id) } });
    }

    // Nothing can match — skip the invoice query entirely.
    if (!or.length) return res.json([]);

    // If a patientId filter was also sent, keep it as a hard constraint.
    filter.$or = or;
  }

  const sort: Record<string, 1 | -1> =
    req.query.sort === "total" ? { total: -1, createdAt: -1 } : { createdAt: -1 };

  const invoices = await Invoice.find(filter)
    .sort(sort)
    .limit(300)
    .populate("patientId", "fullName phone fileNumber");

  return res.json(invoices);
});

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(["cash", "cliq", "card", "other"]).default("cash"),
});

export const addPayment = asyncHandler(async (req: Request, res: Response) => {
  const data = paymentSchema.parse(req.body);

  const invoice = await Invoice.findOne({
    _id: req.params.id,
    clinicId: req.clinicId,
  });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  const paidSoFar = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
  const remaining = invoice.total - paidSoFar;

  if (data.amount > remaining) {
    return res.status(400).json({
      message: `Payment exceeds remaining balance (${remaining} JD)`,
    });
  }

  invoice.payments.push({
    amount: data.amount,
    method: data.method,
    paidAt: new Date(),
  });
  const newPaid = paidSoFar + data.amount;
  invoice.status = newPaid >= invoice.total ? "paid" : "partially_paid";

  await invoice.save();
  return res.json(invoice);
});
