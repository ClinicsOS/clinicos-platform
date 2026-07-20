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

export const listInvoices = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, any> = { clinicId: req.clinicId };
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.patientId) filter.patientId = String(req.query.patientId);

  const invoices = await Invoice.find(filter)
    .sort({ createdAt: -1 })
    .limit(50)
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
