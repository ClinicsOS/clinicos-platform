import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { Clinic } from "../models/Clinic";
import { loadNotePatient } from "./clinicalNoteController";
import { HISTORY_SOURCES, getClinicalHistory, parseCursor } from "../services/clinicalHistory";

/**
 * PHASE 3 — GET /api/patients/:id/clinical-history  (the unified clinical timeline of the Patient Profile → History).
 *
 * Authorization = the SAME canonical rule as every other clinical read (Phase 1): `loadNotePatient` -> canAccessPatient(viewer, id, "patientClinical").
 * A doctor gets his own + validly-delegated patients, the owner the whole clinic, nobody another clinic's patient; anything else is the SAME 404
 * ("Patient not found") as an unknown id — the endpoint is no existence oracle. A revoked / expired delegation stops working on the very next call
 * (the rule is evaluated per request). Nothing about scope comes from the client: clinicId is the authenticated user's.
 *
 * Query:  source = all | appointment | treatment_plan | dental_chart | clinical_map | clinical_note   (default all)
 *         q      = free text (note text, tooth number, treatment, doctor), max 80 chars
 *         limit  = 1..50 (default 20)        before = opaque cursor from the previous page's `nextCursor`
 */
const query = z.object({
  source: z.enum(["all", ...HISTORY_SOURCES]).optional(),
  q: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  before: z.string().max(200).optional(),
});

export const getClinicalHistoryHandler = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadNotePatient(req, res);
  if (!patient) return;
  const parsed = query.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ message: "Invalid history filter" });
  const q = parsed.data;
  const cursor = parseCursor(q.before);
  if (cursor === "invalid") return res.status(400).json({ message: "Invalid cursor" });

  const clinic = await Clinic.findById(req.clinicId).select("specialty").lean<{ specialty?: string } | null>();
  const page = await getClinicalHistory({
    clinicId: req.clinicId as string,
    patientId: patient._id,
    specialty: clinic?.specialty,
    source: q.source ?? "all",
    q: q.q,
    limit: q.limit ?? 20,
    cursor,
  });
  res.setHeader("Cache-Control", "no-store"); // clinical data: never cached by a proxy / browser
  return res.json(page);
});
