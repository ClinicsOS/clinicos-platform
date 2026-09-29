import { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { Clinic } from "../models/Clinic";
import { Patient } from "../models/Patient";
import { Invoice } from "../models/Invoice";
import { DentalRecord } from "../models/DentalRecord";
import { requireActivePlan, requirePlanFeature } from "../middleware/auth";
import { loadPatient, populateEvents, serializeEvent, serializeRecord } from "./dentalController";
import { planPayload } from "./dentalTreatmentController";
import { DentalToothEvent } from "../models/DentalToothEvent";

/**
 * GET /dental/patients/:patientId/report?financial=1
 *
 * One server-authorized data source for every printable Dental document (Full Dental File / Treatment Plan /
 * Dental History) — the frontend only decides which SECTIONS of this payload to lay out for print; it never
 * assembles a report from a raw patient object handed to it by the client. Read-only (any clinic role, same as
 * getRecord / getTreatmentPlan). The clinical data is reused as-is from the same authoritative builders those
 * endpoints use (planPayload, event/record serializers) — nothing here re-derives clinical or billing logic.
 *
 * The optional financial section is gated behind the SAME real middleware the Invoice routes use
 * (requireActivePlan + requirePlanFeature("invoicing")), invoked programmatically — not a parallel permission
 * check — so "financial permission" can never drift from what /api/invoices itself enforces.
 */

/** Runs an existing (req,res,next) middleware and reports whether it would have rejected the request, without
 *  ever letting it write to the real response. Reuses the exact same authorization code path as its normal use. */
function runGate(req: Request, mw: (req: Request, res: Response, next: (err?: unknown) => void) => unknown): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  return new Promise((resolve) => {
    let settled = false;
    let code = 200;
    const fakeRes = {
      status(c: number) { code = c; return fakeRes; },
      json(body: unknown) { if (!settled) { settled = true; resolve({ ok: false, status: code, body }); } return fakeRes; },
    } as unknown as Response;
    Promise.resolve(mw(req, fakeRes, (err) => { if (!settled) { settled = true; resolve(err ? { ok: false, status: 500, body: { message: "Server error" } } : { ok: true }); } }))
      .catch(() => { if (!settled) { settled = true; resolve({ ok: false, status: 500, body: { message: "Server error" } }); } });
  });
}

export const getDentalReport = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;

  const wantFinancial = req.query.financial === "1" || req.query.financial === "true";
  let financial: { totalInvoiced: number; totalPaid: number; outstandingBalance: number } | null = null;
  if (wantFinancial) {
    const gate1 = await runGate(req, requireActivePlan);
    if (!gate1.ok) return res.status(gate1.status).json(gate1.body);
    const gate2 = await runGate(req, requirePlanFeature("invoicing"));
    if (!gate2.ok) return res.status(gate2.status).json(gate2.body);
    // Patient-level financial summary, from the SAME source the profile page's financial history already uses —
    // never derived from Treatment Plan estimates. Every dental Invoice item is still a normal Invoice item.
    const invoices = (await Invoice.find({ clinicId: req.clinicId, patientId: patient._id }).select("total payments").lean()) as any[];
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const totalInvoiced = round(invoices.reduce((s, i) => s + i.total, 0));
    const totalPaid = round(invoices.reduce((s, i) => s + i.payments.reduce((ps: number, p: any) => ps + p.amount, 0), 0));
    financial = { totalInvoiced, totalPaid, outstandingBalance: round(Math.max(0, totalInvoiced - totalPaid)) };
  }

  const [clinic, record, events, plan] = await Promise.all([
    Clinic.findById(req.clinicId).select("name phone address logoUrl").lean(),
    DentalRecord.findOne({ clinicId: req.clinicId, patientId: patient._id }),
    populateEvents(DentalToothEvent.find({ clinicId: req.clinicId, patientId: patient._id }).sort({ createdAt: -1 }).limit(2000)).lean(),
    planPayload(req, patient),
  ]);
  const patientDoc = await Patient.findById(patient._id).select("fullName fileNumber phone gender birthDate").lean();

  return res.json({
    generatedAt: new Date(),
    clinic: clinic ? { name: (clinic as any).name, phone: (clinic as any).phone ?? null, address: (clinic as any).address ?? null, logoUrl: (clinic as any).logoUrl ?? null } : null,
    patient: patientDoc ? { fullName: (patientDoc as any).fullName, fileNumber: (patientDoc as any).fileNumber, phone: (patientDoc as any).phone, gender: (patientDoc as any).gender ?? null, birthDate: (patientDoc as any).birthDate ?? null } : null,
    record: serializeRecord(record),
    events: (events as any[]).map(serializeEvent),
    planItems: plan.items,
    sessions: plan.sessions,
    timeline: plan.timeline,
    summary: plan.summary, // estimates + invoicedTotal only — never Paid/Balance/Due (see `financial` below for that)
    financial, // null unless explicitly requested AND permitted
  });
});
