import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { DermTreatmentItem } from "../models/DermTreatmentItem";
import { loadPatient } from "./dermController";
import { loadItem, populateItem, serializeItem } from "./dermTreatmentController";
import { billDermTreatmentItem, loadDermBillingViews } from "../services/dermBilling";

/**
 * POST /derm/patients/:patientId/treatment-plan/items/:itemId/invoice
 *
 * The single entry point for "Add to Invoice". Access = the EXISTING financial rules: protect + requireActivePlan +
 * requirePlanFeature("invoicing") — same as the invoice routes, which do not restrict by role (dermatology-only comes
 * from the router). Clinical permission is not required and does not imply financial permission.
 *
 * Nothing is trusted from the client except the price/description the user typed (validated here) and an optional
 * invoiceId (re-verified against clinic + patient in the service). sourceId always comes from the URL item.
 * The ESTIMATE only pre-fills the price in the UI; the price sent here is the ACTUAL invoice price.
 */
const billSchema = z.object({
  price: z.number().finite().min(0).max(100000),
  description: z.string().trim().min(1).max(200),
  invoiceId: z.string().length(24).optional(),
});

export const invoiceDermTreatment = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const item = await loadItem(req, res, patient._id);
  if (!item) return;
  const body = billSchema.parse(req.body);
  if (Math.abs(body.price * 1000 - Math.round(body.price * 1000)) > 1e-6) return res.status(400).json({ message: "Price can have at most 3 decimals" });

  const ctx = { clinicId: req.clinicId, userId: req.userId, patientId: patient._id };
  const result = await billDermTreatmentItem(ctx, item._id, body);
  if (!result.ok) return res.status(result.status).json({ message: result.message, code: result.code });

  const fresh: any = await populateItem(DermTreatmentItem.findOne({ _id: item._id, clinicId: req.clinicId, patientId: patient._id })).lean();
  const views = await loadDermBillingViews(ctx, [fresh]);
  return res.status(result.created ? 201 : 200).json({ item: serializeItem(fresh, views.get(String(fresh._id))), invoice: result.invoice, alreadyInvoiced: !result.created });
});
