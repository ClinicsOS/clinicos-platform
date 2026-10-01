import { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { Clinic } from "../models/Clinic";
import { Patient } from "../models/Patient";
import { Invoice } from "../models/Invoice";
import { DermAssessment } from "../models/DermAssessment";
import { DermFollowUp } from "../models/DermFollowUp";
import { requireActivePlan, requirePlanFeature } from "../middleware/auth";
import { runGate } from "../utils/runGate";
import { loadPatient, populateAssessment, serializeAssessment, visitsFor } from "./dermController";
import { planPayload } from "./dermTreatmentController";
import { populateFollowUp, serializeFollowUp } from "./dermFollowUpController";

/**
 * GET /derm/patients/:patientId/report[?financial=1]
 *
 * ONE server-authorized data source for every printable Dermatology & Aesthetic document (Patient File / Treatment Plan /
 * Procedure-Session report / Clinical History). The frontend only decides which SECTIONS of this payload to lay out; it
 * never assembles a report from client-held data.
 *
 * Authorization (nothing here trusts the UI):
 *   - router level: authenticated + the clinic's specialty is dermatology_aesthetics (read fresh from the DB);
 *   - `loadPatient`: the patient must belong to THIS clinic (a foreign / unknown id is the same 404 — no tenant probing);
 *   - every query below is scoped by { clinicId, patientId };
 *   - READ-ONLY, same visibility rule as the other Derm reads (any role of the clinic). A report endpoint therefore grants
 *     a receptionist nothing she could not already read, and no write.
 *   - the optional financial section runs the SAME middleware the invoice routes use (requireActivePlan +
 *     requirePlanFeature("invoicing")); it reads ONLY the existing Invoice / Payment documents. There is no specialty
 *     balance: Treatment Plan estimates are never debt.
 * Clinical content is reused from the authoritative serializers of Phase 1 / 2 — no clinical or billing logic is re-derived.
 * Queries are bounded (see the LIMITS) so a report payload can never grow without bound.
 */
const LIMITS = { assessments: 500, followUps: 1000, invoices: 200 } as const;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

export const getDermReport = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;

  const wantFinancial = req.query.financial === "1" || req.query.financial === "true";
  if (wantFinancial) {
    const g1 = await runGate(req, requireActivePlan);
    if (!g1.ok) return res.status(g1.status).json(g1.body);
    const g2 = await runGate(req, requirePlanFeature("invoicing"));
    if (!g2.ok) return res.status(g2.status).json(g2.body);
  }

  const scope = { clinicId: req.clinicId, patientId: patient._id };
  const [clinic, patientDoc, assessmentDocs, followUpDocs, plan] = await Promise.all([
    Clinic.findById(req.clinicId).select("name phone address logoUrl").lean(),
    Patient.findOne({ _id: patient._id, clinicId: req.clinicId }).select("fullName fileNumber phone gender birthDate").lean(),
    populateAssessment(DermAssessment.find(scope).sort({ createdAt: -1 }).limit(LIMITS.assessments)).lean(),
    populateFollowUp(DermFollowUp.find(scope).sort({ createdAt: -1 }).limit(LIMITS.followUps)).lean(),
    planPayload(req, patient),
  ]);
  const visits = await visitsFor(req, patient._id, assessmentDocs as any[]);

  let financial: null | {
    invoices: { invoiceNumber: number; createdAt: Date; total: number; paid: number; status: string }[];
    totalInvoiced: number; totalPaid: number; outstandingBalance: number;
  } = null;
  if (wantFinancial) {
    const rows = (await Invoice.find(scope).select("invoiceNumber total payments status createdAt").sort({ createdAt: -1 }).limit(LIMITS.invoices).lean()) as any[];
    const invoices = rows.map((i) => ({
      invoiceNumber: i.invoiceNumber, createdAt: i.createdAt, total: i.total,
      paid: round3((i.payments ?? []).reduce((s: number, p: any) => s + p.amount, 0)), status: i.status,
    }));
    const totalInvoiced = round3(invoices.reduce((s, i) => s + i.total, 0));
    const totalPaid = round3(invoices.reduce((s, i) => s + i.paid, 0));
    // Same arithmetic as the Dentistry report / the Patient profile's financial history: it comes from Invoice + Payment only.
    financial = { invoices, totalInvoiced, totalPaid, outstandingBalance: round3(Math.max(0, totalInvoiced - totalPaid)) };
  }

  const c: any = clinic, p: any = patientDoc;
  return res.json({
    generatedAt: new Date(),
    clinic: c ? { name: c.name, phone: c.phone ?? null, address: c.address ?? null, logoUrl: c.logoUrl ?? null } : null,
    patient: p ? { fullName: p.fullName, fileNumber: p.fileNumber, phone: p.phone ?? null, gender: p.gender ?? null, birthDate: p.birthDate ?? null } : null,
    // markers (3D point placement) are navigation data, not report content: they are left out of the print payload
    assessments: (assessmentDocs as any[]).map((a) => { const { markers, markerSpace, ...rest } = serializeAssessment(a, visits); void markers; void markerSpace; return rest; }),
    followUps: (followUpDocs as any[]).map(serializeFollowUp),
    plan: plan.plan,
    items: plan.items,
    sessions: plan.sessions,
    visits: plan.visits,
    summary: plan.summary, // ESTIMATES + counts only — never Paid / Balance / Due (see `financial`, which is opt-in and permission-gated)
    financial,
    limits: LIMITS,
  });
});
