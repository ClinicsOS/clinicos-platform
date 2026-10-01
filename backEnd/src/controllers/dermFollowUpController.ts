import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { DermAssessment } from "../models/DermAssessment";
import { DermTreatmentItem } from "../models/DermTreatmentItem";
import { DermTreatmentSession } from "../models/DermTreatmentSession";
import { DermFollowUp } from "../models/DermFollowUp";
import { loadPatient, ID_RE, isKnownRegionId } from "./dermController";
import { MAX_REGIONS_PER_ASSESSMENT, RECORD_TYPES, validateRegionRefs } from "../config/dermatology";
import { FOLLOWUP_OUTCOMES, MAX_FOLLOWUP_TEXT } from "../config/dermProcedures";
import { loadVisit } from "./dermTreatmentController";

/**
 * Follow-Up = a clinical REVIEW after an assessment / treatment / session. Clinician-entered only: the system never
 * interprets, scores or picks an outcome. Same security model as the rest of the module (tenant + patient scoped, visit
 * re-verified, server-derived identity). Corrections keep the row (revisions + "entered in error"); nothing is deleted.
 */
const who = (u: any) => (u && u._id ? { _id: String(u._id), name: u.name } : null);
const regionsOut = (rs: any[] | undefined) => (rs ?? []).map((r) => ({ id: r.id, ...(r.surface ? { surface: r.surface } : {}) }));
export const populateFollowUp = (q: any) => q.populate("createdBy", "name").populate("resolution.by", "name");

export const serializeFollowUp = (f: any) => ({
  _id: String(f._id),
  patientId: String(f.patientId),
  recordType: f.recordType,
  itemId: f.itemId ? String(f.itemId) : null,
  sessionId: f.sessionId ? String(f.sessionId) : null,
  assessmentId: f.assessmentId ? String(f.assessmentId) : null,
  appointmentId: f.appointmentId ? String(f.appointmentId) : null,
  regions: regionsOut(f.regions),
  outcome: f.outcome ?? undefined,
  clinicianAssessment: f.clinicianAssessment ?? "",
  progress: f.progress ?? "",
  complications: f.complications ?? "",
  notes: f.notes ?? "",
  nextStep: f.nextStep ?? "",
  status: f.status,
  rev: f.rev ?? 0,
  edited: (f.revisions ?? []).length > 0,
  createdBy: who(f.createdBy),
  createdAt: f.createdAt,
  updatedAt: f.updatedAt,
  resolution: f.resolution?.reason ? { at: f.resolution.at, by: who(f.resolution.by), reason: f.resolution.reason, note: f.resolution.note ?? undefined } : undefined,
});

const regionRefSchema = z.object({ id: z.string().min(1).max(60), surface: z.string().max(20).nullable().optional() });
const textField = (max: number) => z.string().max(max).optional();
const createSchema = z.object({
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  assessmentId: z.string().regex(ID_RE).nullable().optional(),
  itemId: z.string().regex(ID_RE).nullable().optional(),
  sessionId: z.string().regex(ID_RE).nullable().optional(),
  appointmentId: z.string().regex(ID_RE).nullable().optional(),
  regions: z.array(regionRefSchema).max(MAX_REGIONS_PER_ASSESSMENT).optional(),
  outcome: z.enum(FOLLOWUP_OUTCOMES).nullable().optional(),
  clinicianAssessment: textField(MAX_FOLLOWUP_TEXT.assessment),
  progress: textField(MAX_FOLLOWUP_TEXT.progress),
  complications: textField(MAX_FOLLOWUP_TEXT.complications),
  notes: textField(MAX_FOLLOWUP_TEXT.notes),
  nextStep: textField(MAX_FOLLOWUP_TEXT.nextStep),
});

const TEXTS = ["clinicianAssessment", "progress", "complications", "notes", "nextStep"] as const;

/**
 * POST /derm/patients/:patientId/follow-ups — idempotent per clientRequestId.
 * At least ONE link (assessment / treatment / session) is required; the treatment is always derived from the session.
 * Recording a follow-up also settles the review date the clinician set on the treatment's sessions (dashboard list).
 */
export const createFollowUp = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const body = createSchema.parse(req.body);
  const scope = { clinicId: req.clinicId, patientId: patient._id };

  const dup: any = await populateFollowUp(DermFollowUp.findOne({ clinicId: req.clinicId, clientRequestId: body.clientRequestId })).lean();
  if (dup) {
    if (String(dup.patientId) !== String(patient._id)) return res.status(409).json({ message: "Duplicate request", code: "DUPLICATE_REQUEST" });
    return res.status(200).json({ followUp: serializeFollowUp(dup), duplicate: true });
  }
  if (!body.assessmentId && !body.itemId && !body.sessionId) return res.status(400).json({ message: "A follow-up must relate to an assessment, a treatment or a session", code: "MISSING_LINK" });
  const hasContent = !!body.outcome || TEXTS.some((k) => (body[k] ?? "").trim());
  if (!hasContent) return res.status(400).json({ message: "Add an outcome or a note", code: "EMPTY_FOLLOWUP" });

  let session: any = null, item: any = null, assessment: any = null;
  if (body.sessionId) {
    session = await DermTreatmentSession.findOne({ _id: body.sessionId, ...scope }).lean();
    if (!session) return res.status(404).json({ message: "Session not found" });
    if (body.itemId && String(session.itemId) !== body.itemId) return res.status(400).json({ message: "The session does not belong to that treatment", code: "LINK_MISMATCH" });
  }
  const itemId = session ? String(session.itemId) : body.itemId ?? null;
  if (itemId) {
    item = await DermTreatmentItem.findOne({ _id: itemId, ...scope }).lean();
    if (!item) return res.status(404).json({ message: "Treatment not found" });
  }
  if (body.assessmentId) {
    assessment = await DermAssessment.findOne({ _id: body.assessmentId, ...scope, status: "active" }).select("recordType regions").lean();
    if (!assessment) return res.status(404).json({ message: "Assessment not found" });
  }
  if (item && assessment && item.recordType !== assessment.recordType) return res.status(400).json({ message: "The linked records have different record types", code: "RECORD_TYPE_MISMATCH" });
  const recordType = (item ?? assessment).recordType as (typeof RECORD_TYPES)[number];

  let visitId: string | undefined;
  if (body.appointmentId) {
    const visit = await loadVisit(req, res, patient._id, body.appointmentId, { requireActive: true });
    if (!visit) return;
    visitId = String(visit._id);
  }

  // regions: explicit (validated) or the context of what it relates to (already validated when it was stored)
  let regions: { id: string; surface?: string }[];
  if (body.regions !== undefined) {
    if (body.regions.length === 0) regions = [];
    else {
      const refs = validateRegionRefs(body.regions);
      if (!refs.ok) return res.status(400).json({ message: refs.message, code: "INVALID_REGION" });
      regions = refs.regions;
    }
  } else {
    const ctx = (session?.treatedRegions?.length ? session.treatedRegions : item?.regions?.length ? item.regions : assessment?.regions) ?? [];
    regions = regionsOut(ctx);
  }

  try {
    const created = await DermFollowUp.create({
      ...scope, recordType,
      itemId: item?._id, sessionId: session?._id, assessmentId: assessment?._id, appointmentId: visitId,
      regions, regionIds: regions.map((r) => r.id),
      outcome: body.outcome || undefined,
      ...Object.fromEntries(TEXTS.map((k) => [k, (body[k] ?? "").trim() || undefined])),
      status: "active", rev: 0, clientRequestId: body.clientRequestId, createdBy: req.userId,
    });
    if (item) {
      // the clinician's chosen review date is now documented -> it leaves the dashboard "Follow-Ups" list
      await DermTreatmentSession.updateMany({ ...scope, itemId: item._id, followUpDueAt: { $exists: true }, followUpResolvedAt: { $exists: false } }, { $set: { followUpResolvedAt: new Date() } });
    }
    const fresh = await populateFollowUp(DermFollowUp.findOne({ _id: created._id, ...scope })).lean();
    return res.status(201).json({ followUp: serializeFollowUp(fresh), duplicate: false });
  } catch (err: any) {
    if (err?.code === 11000) {
      const again: any = await populateFollowUp(DermFollowUp.findOne({ ...scope, clientRequestId: body.clientRequestId })).lean();
      if (again) return res.status(200).json({ followUp: serializeFollowUp(again), duplicate: true });
    }
    throw err;
  }
});

const listQuery = z.object({
  itemId: z.string().regex(ID_RE).optional(),
  sessionId: z.string().regex(ID_RE).optional(),
  assessmentId: z.string().regex(ID_RE).optional(),
  regionId: z.string().max(60).optional(),
  includeVoided: z.enum(["0", "1", "true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** GET /derm/patients/:patientId/follow-ups — newest first, bounded. */
export const listFollowUps = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const q = listQuery.parse(req.query);
  if (q.regionId && !isKnownRegionId(q.regionId)) return res.status(400).json({ message: "Unknown anatomical region" });
  const filter: Record<string, unknown> = { clinicId: req.clinicId, patientId: patient._id };
  if (!(q.includeVoided === "1" || q.includeVoided === "true")) filter.status = "active";
  if (q.itemId) filter.itemId = q.itemId;
  if (q.sessionId) filter.sessionId = q.sessionId;
  if (q.assessmentId) filter.assessmentId = q.assessmentId;
  if (q.regionId) filter.regionIds = q.regionId;
  const rows = await populateFollowUp(DermFollowUp.find(filter).sort({ createdAt: -1, _id: -1 }).limit(q.limit ?? 50)).lean();
  return res.json({ followUps: (rows as any[]).map(serializeFollowUp) });
});

const editSchema = z.object({
  rev: z.number().int().min(0),
  outcome: z.enum(FOLLOWUP_OUTCOMES).nullable().optional(),
  clinicianAssessment: textField(MAX_FOLLOWUP_TEXT.assessment),
  progress: textField(MAX_FOLLOWUP_TEXT.progress),
  complications: textField(MAX_FOLLOWUP_TEXT.complications),
  notes: textField(MAX_FOLLOWUP_TEXT.notes),
  nextStep: textField(MAX_FOLLOWUP_TEXT.nextStep),
}).refine((b) => b.outcome !== undefined || TEXTS.some((k) => b[k] !== undefined), { message: "Nothing to update" });

const loadFollowUp = async (req: Request, res: Response, patientId: unknown) => {
  const id = req.params.followUpId;
  const doc = mongoose.isValidObjectId(id) ? await DermFollowUp.findOne({ _id: id, clinicId: req.clinicId, patientId }) : null;
  if (!doc) { res.status(404).json({ message: "Follow-up not found" }); return null; }
  return doc;
};

/** PATCH /derm/patients/:patientId/follow-ups/:followUpId — text / outcome only (links & regions are immutable). rev = optimistic concurrency. */
export const editFollowUp = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const body = editSchema.parse(req.body);
  const doc: any = await loadFollowUp(req, res, patient._id);
  if (!doc) return;
  if (doc.status !== "active") return res.status(409).json({ message: "This entry was marked as entered in error", code: "ENTERED_IN_ERROR" });
  if (body.rev !== (doc.rev ?? 0)) return res.status(409).json({ message: "This follow-up was changed by someone else — reload it", code: "STALE" });

  const $set: Record<string, unknown> = {};
  const $unset: Record<string, 1> = {};
  const previous: Record<string, string> = {};
  const fields: [string, string | null | undefined][] = [["outcome", body.outcome], ...TEXTS.map((k) => [k, body[k]] as [string, string | undefined])];
  for (const [k, incoming] of fields) {
    if (incoming === undefined) continue;
    const norm = incoming === null ? "" : incoming.trim();
    const old = (doc[k] as string | undefined) ?? "";
    if (norm === old) continue;
    previous[k] = old;
    if (norm) $set[k] = norm; else $unset[k] = 1;
  }
  if (!Object.keys(previous).length) return res.json({ followUp: serializeFollowUp(await populateFollowUp(DermFollowUp.findById(doc._id)).lean()) });
  const finalHas = (k: string) => (k in $set ? true : k in $unset ? false : !!doc[k]);
  if (!finalHas("outcome") && !TEXTS.some((k) => finalHas(k))) return res.status(400).json({ message: "Add an outcome or a note", code: "EMPTY_FOLLOWUP" });

  const update: Record<string, unknown> = { $inc: { rev: 1 }, $push: { revisions: { at: new Date(), by: req.userId, previous } } };
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  const updated = await populateFollowUp(
    DermFollowUp.findOneAndUpdate({ _id: doc._id, clinicId: req.clinicId, patientId: patient._id, status: "active", rev: doc.rev ?? 0 }, update, { new: true })
  ).lean();
  if (!updated) return res.status(409).json({ message: "This follow-up was changed by someone else — reload it", code: "STALE" });
  return res.json({ followUp: serializeFollowUp(updated) });
});

/** POST /derm/patients/:patientId/follow-ups/:followUpId/void — "entered in error". The row is kept. */
export const voidFollowUp = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const { note } = z.object({ note: z.string().trim().max(MAX_FOLLOWUP_TEXT.voidNote).optional() }).parse(req.body ?? {});
  const doc: any = await loadFollowUp(req, res, patient._id);
  if (!doc) return;
  const updated = await populateFollowUp(
    DermFollowUp.findOneAndUpdate(
      { _id: doc._id, clinicId: req.clinicId, patientId: patient._id, status: "active" },
      { $set: { status: "entered_in_error", resolution: { at: new Date(), by: req.userId, reason: "entered_in_error", note: note || undefined } } },
      { new: true }
    )
  ).lean();
  if (!updated) return res.status(409).json({ message: "This entry was already marked as entered in error", code: "ENTERED_IN_ERROR" });
  return res.json({ followUp: serializeFollowUp(updated) });
});
