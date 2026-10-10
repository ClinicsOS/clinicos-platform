import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { Invoice } from "../models/Invoice";
import { Patient } from "../models/Patient";
import { onInvoicePayment } from "../services/loyaltyPoints";
import { nextNumber, retryPause, NUMBER_ATTEMPTS } from "../services/numbering";
import { asyncHandler } from "../middleware/errorHandler";
import { resolveDataScope, doctorMatch, PolicyError, canManageClinic } from "../auth/policy";
import { findClinicDoctor, resolveManualInvoiceDoctor } from "../services/doctorAttribution";

/**
 * PHASE 7 — money hygiene. JOD has 3 decimals (fils). Floating point made 50.1 + 50.2 > 100.3, so an exact payment of the
 * remaining balance was rejected and a fully-paid invoice could stay "partially paid". Every amount is validated as finite and
 * rounded to fils, and every comparison happens on fils-rounded numbers.
 */
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const money = (max: number, min = 0) => z.number().finite().min(min).max(max).transform(round3);

const createInvoiceSchema = z.object({
  patientId: z.string().length(24),
  appointmentId: z.string().length(24).optional(),
  // PHASE 4 — optional treating doctor. Owner / receptionist may pick one; a doctor can only ever be themself (enforced below).
  doctorId: z.string().length(24).optional(),
  items: z
    .array(
      z.object({
        description: z.string().min(1).max(200),
        // Upper bounds are a data-sanity guard, not a business rule: without
        // them a malformed/extreme request (e.g. price: 1e21) is accepted
        // as a valid number and corrupts the invoice total. 100,000 JD per
        // line item and 1,000 units are far beyond any real clinic charge.
        price: money(100000),
        qty: z.number().finite().min(1).max(1000).default(1),
      })
    )
    .min(1)
    .max(100),
  discount: money(10_000_000).default(0),
});

export const createInvoice = asyncHandler(async (req: Request, res: Response) => {
  const data = createInvoiceSchema.parse(req.body);
  const scope = resolveDataScope(req, "invoices");

  const patient = await Patient.findOne({
    _id: data.patientId,
    clinicId: req.clinicId,
  });
  if (!patient) return res.status(404).json({ message: "Patient not found" });

  // PHASE 4 — the treating doctor is decided by the server (see services/doctorAttribution.ts): never the creator by default.
  const doctorId = await resolveManualInvoiceDoctor(scope, { doctorId: data.doctorId, appointmentId: data.appointmentId, patientId: data.patientId });

  const itemsTotal = data.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const total = round3(Math.max(0, itemsTotal - data.discount));

  // The number is clinicId-unique (index). Two invoices created at the same moment (a double click, or the receptionist and a
  // dental "Add to invoice" together) compute the same count — PHASE 7: the loser recounts and retries instead of failing with a 409
  // (the same strategy services/dentalBilling.ts already uses).
  for (let attempt = 0; attempt < NUMBER_ATTEMPTS; attempt++) {
    await retryPause(attempt);
    const next = await nextNumber(Invoice, req.clinicId, "invoiceNumber");
    try {
      const invoice = await Invoice.create({
        clinicId: req.clinicId,
        invoiceNumber: next,
        patientId: data.patientId,
        appointmentId: data.appointmentId,
        ...(doctorId ? { doctorId } : {}),
        createdBy: req.userId,
        items: data.items,
        discount: data.discount,
        total,
        status: total === 0 ? "paid" : "unpaid",
      });
      return res.status(201).json(invoice);
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
    }
  }
  return res.status(409).json({ message: "Could not create the invoice, please try again", code: "INVOICE_CREATE_FAILED" });
});

const updateInvoiceSchema = z.object({
  items: z
    .array(
      z.object({
        // Optional: lets the server recognise which existing line this is, so a line that was created from
        // another module (e.g. a dental treatment) keeps its provenance link when the invoice is edited.
        _id: z.string().length(24).optional(),
        description: z.string().min(1).max(200),
        price: money(100000),
        qty: z.number().finite().min(1).max(1000).default(1),
      })
    )
    .min(1)
    .max(100),
  discount: money(10_000_000).default(0),
  // PHASE 4 — only the OWNER may (re)assign the treating doctor of an existing invoice (null = back to "unassigned").
  doctorId: z.string().length(24).nullable().optional(),
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
  const scope = resolveDataScope(req, "invoices");

  // A doctor can only reach invoices attributed to them; anything else is the same 404 as an unknown id (no probing).
  const invoice = await Invoice.findOne({ _id: req.params.id, clinicId: req.clinicId, ...doctorMatch(scope) });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  let nextDoctor: string | null | undefined; // undefined = leave as it is
  if (data.doctorId !== undefined && String(data.doctorId ?? "") !== String(invoice.doctorId ?? "")) {
    if (!canManageClinic(req.role)) throw new PolicyError(403, "FORBIDDEN_ROLE", "Only the clinic owner can change an invoice's doctor");
    if (data.doctorId === null) nextDoctor = null;
    else {
      const d = await findClinicDoctor(req.clinicId, data.doctorId);
      if (!d) throw new PolicyError(404, "DOCTOR_NOT_FOUND", "Doctor not found");
      nextDoctor = String(d._id);
    }
  }

  const itemsTotal = data.items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const newTotal = round3(Math.max(0, itemsTotal - data.discount));

  const paidSoFar = round3(invoice.payments.reduce((sum, p) => sum + p.amount, 0));
  if (newTotal < paidSoFar) {
    return res.status(400).json({
      message: `Can't lower the total below what's already been paid (${paidSoFar} JD collected). Adjust items or add a note instead.`,
      code: "TOTAL_BELOW_PAID",
    });
  }

  // The whole items array is replaced below, which would silently drop the source link of lines that came
  // from another module (dental billing). Carry it over, decided ONLY by the server's stored copy:
  //   1) same _id as an existing sourced line;  2) legacy clients that don't send _id: an unchanged line
  //   (same description/price/qty) takes the source of an as-yet-unmatched sourced line.
  // A sourced line that matches nothing was really removed/changed by the user — its link is dropped.
  const existing = invoice.items as unknown as { _id: any; description: string; price: number; qty: number; sourceType?: string; sourceId?: any }[];
  const sourced = existing.filter((e) => e.sourceType && e.sourceId);
  const used = new Set<string>();
  const nextItems = data.items.map((it) => {
    const { _id, ...rest } = it;
    let hit = _id ? sourced.find((e) => String(e._id) === _id && !used.has(String(e._id))) : undefined;
    if (!hit && !_id) hit = sourced.find((e) => !used.has(String(e._id)) && e.description === it.description && e.price === it.price && e.qty === it.qty);
    if (!hit) return { ...rest };
    used.add(String(hit._id));
    return { _id: hit._id, ...rest, sourceType: hit.sourceType, sourceId: hit.sourceId };
  });

  invoice.items = nextItems as any;
  if (nextDoctor === null) invoice.doctorId = undefined;
  else if (nextDoctor) invoice.doctorId = new mongoose.Types.ObjectId(nextDoctor);
  invoice.discount = data.discount;
  invoice.total = newTotal;
  invoice.status = paidSoFar === 0 ? (newTotal === 0 ? "paid" : "unpaid") : paidSoFar >= newTotal ? "paid" : "partially_paid";

  await invoice.save();
  return res.json(invoice);
});

/** Escapes user input so it can be used safely inside a RegExp. */
const escapeRegex = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // PHASE 7 — a NUL / control character makes MongoDB reject the pattern (was a 500)

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
  // PHASE 4 — a doctor's scope is always their own id (a ?doctorId= for anyone else is a 403); owner / receptionist see the
  // whole clinic and may narrow by ?doctorId=<id> or ?doctorId=unassigned (legacy / unattributed invoices).
  const scope = resolveDataScope(req, "invoices", req.query.doctorId);
  const filter: Record<string, any> = { clinicId: req.clinicId, ...doctorMatch(scope) };
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
    .populate("patientId", "fullName phone fileNumber")
    .populate("doctorId", "name");

  return res.json(invoices);
});

const paymentSchema = z.object({
  amount: money(10_000_000, 0.001), // finite, >= 1 fils, rounded to fils

  method: z.enum(["cash", "cliq", "card", "other"]).default("cash"),
  note: z.string().trim().max(300).optional(),
  // PHASE 7 — one token per "Record payment" dialog. A double click / retry carrying the same token records ONE payment.
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
});

export const addPayment = asyncHandler(async (req: Request, res: Response) => {
  const data = paymentSchema.parse(req.body);
  const scope = resolveDataScope(req, "payments");

  const invoice = await Invoice.findOne({
    _id: req.params.id,
    clinicId: req.clinicId,
    ...doctorMatch(scope),
  });
  if (!invoice) return res.status(404).json({ message: "Invoice not found" });

  // Idempotent replay: this dialog already recorded its payment — answer with the invoice as it is (200), record nothing.
  if (data.requestId && invoice.payments.some((p) => p.requestId === data.requestId)) return res.json(invoice);

  const paidSoFar = round3(invoice.payments.reduce((sum, p) => sum + p.amount, 0));
  const remaining = round3(invoice.total - paidSoFar);

  if (data.amount > remaining) {
    return res.status(400).json({
      message: `Payment exceeds remaining balance (${remaining} JD)`,
    });
  }

  // Guard against two "Add Payment" requests for the SAME invoice landing
  // at nearly the same time (a double-click that slips past the disabled
  // button, or two staff members adding a payment from different screens
  // at once): the check above reads a snapshot that can already be stale
  // by the time this write happens. This re-applies the same "does not
  // exceed the total" rule as part of the SAME atomic database operation
  // that appends the payment — if another payment landed in between, the
  // filter no longer matches and this one is safely rejected instead of
  // silently overpaying the invoice.
  const updated = await Invoice.findOneAndUpdate(
    {
      _id: req.params.id,
      clinicId: req.clinicId,
      ...doctorMatch(scope),
      ...(data.requestId ? { "payments.requestId": { $ne: data.requestId } } : {}), // race-safe: two parallel submits of one dialog
      $expr: {
        // half a fils of tolerance: the stored amounts are fils-rounded, only IEEE-754 noise is being absorbed
        $lte: [{ $add: [{ $sum: "$payments.amount" }, data.amount] }, { $add: ["$total", 0.0005] }],
      },
    },
    {
      $push: {
        payments: { amount: data.amount, method: data.method, paidAt: new Date(), note: data.note || undefined, ...(data.requestId ? { requestId: data.requestId } : {}) },
      },
    },
    { new: true, runValidators: true }
  );

  if (!updated) {
    if (data.requestId) {
      // the losing side of a double submit: the winner's payment is already stored
      const again = await Invoice.findOne({ _id: req.params.id, clinicId: req.clinicId, ...doctorMatch(scope), "payments.requestId": data.requestId });
      if (again) return res.json(again);
    }
    return res.status(409).json({
      message: "This invoice's balance just changed — please refresh and try again",
      code: "INVOICE_CHANGED",
    });
  }

  const newPaid = round3(updated.payments.reduce((sum, p) => sum + p.amount, 0));
  const newStatus = newPaid >= updated.total ? "paid" : "partially_paid";
  if (updated.status !== newStatus) {
    await Invoice.updateOne({ _id: updated._id }, { $set: { status: newStatus } });
    updated.status = newStatus;
  }

  // ClinicOS Loyalty: this payment (identified by its own _id) may earn spending points. The hook never throws and
  // never changes the payment. The payment we just appended is the last element of the array.
  const newPayment = updated.payments[updated.payments.length - 1] as unknown as { _id?: unknown } | undefined;
  if (newPayment?._id) await onInvoicePayment(updated, String(newPayment._id), req.userId);

  return res.json(updated);
});
