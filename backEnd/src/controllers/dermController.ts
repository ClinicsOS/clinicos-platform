import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { Patient } from "../models/Patient";
import { Appointment } from "../models/Appointment";
import { DermAssessment, type IDermAssessment } from "../models/DermAssessment";
import {
  RECORD_TYPES,
  MAX_REGIONS_PER_ASSESSMENT,
  MAX_TEXT,
  MARKER_SPACE,
  REGION_REGISTRY_VERSION,
  isKnownRegion,
  validateRegionRefs,
  validateMarkers,
} from "../config/dermatology";

/**
 * SECURITY MODEL (every handler follows it):
 *  1. `protect` authenticated the user and set req.clinicId from the USER DOCUMENT (never from the client).
 *  2. `requireSpecialty("dermatology_aesthetics")` verified the clinic's stored specialty (router level, from the DB).
 *  3. `loadPatient` re-verifies the patient belongs to req.clinicId — the patientId in the URL is never trusted alone.
 *  4. Every query below carries clinicId AND patientId (tenant isolation + cross-patient safety).
 *  5. Region ids / surfaces / record types / markers are validated against the server registry (config/dermatology.ts).
 *  6. A linked visit (Appointment) must belong to the SAME clinic AND the SAME patient.
 * clinicId, createdBy, regionIds, status, rev and every timestamp are derived on the server — never read from a body.
 *
 * Clinical write access (create / edit / mark-in-error) = owner + doctor, exactly like every other clinical action
 * in ClinicOS (see routes/dermRoutes.ts). Reads are open to any authenticated role of the clinic (same as Dentistry).
 */

export const ID_RE = /^[a-f0-9]{24}$/i;
export const isKnownRegionId = (id: string) => isKnownRegion(id);

/** Same 404 for "doesn't exist" and "belongs to another clinic" — no tenant probing. */
export const loadPatient = async (req: Request, res: Response) => {
  const { patientId } = req.params;
  if (!mongoose.isValidObjectId(patientId)) {
    res.status(404).json({ message: "Patient not found" });
    return null;
  }
  const patient = await Patient.findOne({ _id: patientId, clinicId: req.clinicId }).select("_id");
  if (!patient) {
    res.status(404).json({ message: "Patient not found" });
    return null;
  }
  return patient;
};

// ---------------------------------------------------------------- serialization
const who = (u: any) => (u && u._id ? { _id: String(u._id), name: u.name } : null);

export interface VisitInfo {
  startAt: Date;
  status: string;
  source: string;
}

export const serializeAssessment = (a: any, visits?: Map<string, VisitInfo>) => ({
  _id: String(a._id),
  patientId: String(a.patientId),
  appointmentId: a.appointmentId ? String(a.appointmentId) : null,
  visit: a.appointmentId ? visits?.get(String(a.appointmentId)) ?? null : null,
  recordType: a.recordType,
  regions: (a.regions ?? []).map((r: any) => ({ id: r.id, ...(r.surface ? { surface: r.surface } : {}) })),
  markers: (a.markers ?? []).map((m: any) => ({ regionId: m.regionId, u: m.u, v: m.v, w: m.w })),
  markerSpace: a.markerSpace ?? MARKER_SPACE,
  concern: a.concern ?? "",
  findings: a.findings ?? "",
  diagnosis: a.diagnosis ?? "",
  notes: a.notes ?? "",
  status: a.status,
  rev: a.rev ?? 0,
  registryVersion: a.registryVersion,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  createdBy: who(a.createdBy),
  edited: (a.revisions ?? []).length > 0,
  lastEditedAt: (a.revisions ?? []).length ? a.revisions[a.revisions.length - 1].at : null,
  resolution: a.resolution?.reason
    ? { at: a.resolution.at, by: who(a.resolution.by), reason: a.resolution.reason, note: a.resolution.note ?? undefined }
    : undefined,
});

export const populateAssessment = (q: any) => q.populate("createdBy", "name").populate("resolution.by", "name");

/** ONE batched lookup for every linked visit of a page of assessments (no N+1). Same clinic AND same patient only. */
export async function visitsFor(req: Request, patientId: unknown, docs: any[]): Promise<Map<string, VisitInfo>> {
  const ids = Array.from(new Set(docs.filter((d) => d.appointmentId).map((d) => String(d.appointmentId))));
  const map = new Map<string, VisitInfo>();
  if (!ids.length) return map;
  const rows = (await Appointment.find({ _id: { $in: ids }, clinicId: req.clinicId, patientId })
    .select("startAt status source")
    .lean()) as any[];
  rows.forEach((v) => map.set(String(v._id), { startAt: v.startAt, status: v.status, source: v.source }));
  return map;
}

// ---------------------------------------------------------------- reads
/**
 * GET /derm/patients/:patientId/map
 * Region activity summary for the 3D history markers + patient overview — ONE indexed, tenant-scoped read of a
 * tiny projection (type / regions / date), folded in memory. No per-region queries (no N+1), and no reliance on
 * aggregation features. Only ACTIVE assessments count (entries marked in error never light up the map).
 * The cap only protects the server: a single patient will never realistically approach it.
 */
const MAP_SCAN_LIMIT = 5000;

export const getMap = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const rows = (await DermAssessment.find({ clinicId: req.clinicId, patientId: patient._id, status: "active" })
    .select("recordType regionIds createdAt")
    .sort({ createdAt: -1 })
    .limit(MAP_SCAN_LIMIT)
    .lean()) as any[];

  const regions: Record<string, { total: number; dermatology: number; aesthetic: number; lastAt: Date }> = {};
  const byType = { dermatology: 0, aesthetic: 0 };
  let lastAt: Date | null = null;
  for (const row of rows) {
    const t = row.recordType as "dermatology" | "aesthetic";
    const at = new Date(row.createdAt);
    if (t === "dermatology" || t === "aesthetic") byType[t] += 1;
    if (!lastAt || at > lastAt) lastAt = at;
    for (const id of new Set<string>(row.regionIds ?? [])) {
      const e = (regions[id] ??= { total: 0, dermatology: 0, aesthetic: 0, lastAt: at });
      if (t === "dermatology" || t === "aesthetic") e[t] += 1;
      e.total += 1;
      if (at > e.lastAt) e.lastAt = at;
    }
  }
  return res.json({ registryVersion: REGION_REGISTRY_VERSION, total: rows.length, byType, lastAt, regions });
});

const listQuery = z.object({
  regionId: z.string().max(60).optional(),
  recordType: z.enum(RECORD_TYPES).optional(),
  appointmentId: z.string().regex(ID_RE).optional(),
  includeVoided: z.enum(["0", "1", "true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.string().max(80).optional(),
});

/**
 * GET /derm/patients/:patientId/assessments?regionId=&recordType=&appointmentId=&includeVoided=&limit=&before=
 *  - no regionId  -> patient-level Dermatology & Aesthetics timeline
 *  - regionId     -> Area History (includes assessments that ALSO involve other regions)
 * Newest first. Cursor pagination on (createdAt, _id).
 */
export const listAssessments = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const q = listQuery.parse(req.query);
  if (q.regionId && !isKnownRegion(q.regionId)) return res.status(400).json({ message: "Unknown anatomical region" });

  const filter: Record<string, unknown> = { clinicId: req.clinicId, patientId: patient._id };
  if (q.recordType) filter.recordType = q.recordType;
  if (q.regionId) filter.regionIds = q.regionId;
  if (q.appointmentId) filter.appointmentId = q.appointmentId;
  if (!(q.includeVoided === "1" || q.includeVoided === "true")) filter.status = "active";

  if (q.before) {
    const [iso, id] = q.before.split("_");
    const at = new Date(iso);
    if (Number.isNaN(at.getTime()) || !id || !ID_RE.test(id)) return res.status(400).json({ message: "Invalid cursor" });
    filter.$or = [{ createdAt: { $lt: at } }, { createdAt: at, _id: { $lt: id } }];
  }

  const limit = q.limit ?? 50;
  const rows = (await populateAssessment(DermAssessment.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1)).lean()) as any[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const visits = await visitsFor(req, patient._id, page);
  const last = page[page.length - 1];
  return res.json({
    assessments: page.map((a) => serializeAssessment(a, visits)),
    hasMore,
    nextBefore: hasMore && last ? `${new Date(last.createdAt).toISOString()}_${String(last._id)}` : null,
  });
});

// ---------------------------------------------------------------- writes
const optText = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().max(max))
    .optional();

const regionRefSchema = z.object({ id: z.string().min(1).max(60), surface: z.string().max(20).nullable().optional() });
const markerSchema = z.object({ regionId: z.string().min(1).max(60), u: z.number(), v: z.number(), w: z.number() });

const createSchema = z.object({
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  recordType: z.enum(RECORD_TYPES),
  regions: z.array(regionRefSchema).min(1).max(MAX_REGIONS_PER_ASSESSMENT),
  markers: z.array(markerSchema).max(MAX_REGIONS_PER_ASSESSMENT).optional(),
  concern: optText(MAX_TEXT.concern),
  findings: optText(MAX_TEXT.findings),
  diagnosis: optText(MAX_TEXT.diagnosis),
  notes: optText(MAX_TEXT.notes),
  appointmentId: z.string().regex(ID_RE).nullable().optional(),
});

/**
 * POST /derm/patients/:patientId/assessments
 * Idempotent: a repeated `clientRequestId` returns the row that was already saved (200, duplicate:true) instead of
 * creating a second one. Never invents a visit: appointmentId is optional and, when given, must be a real,
 * non-cancelled visit of THIS patient in THIS clinic.
 */
export const createAssessment = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const body = createSchema.parse(req.body);

  const refs = validateRegionRefs(body.regions);
  if (!refs.ok) return res.status(400).json({ message: refs.message, code: "INVALID_REGION" });
  const regionIds = refs.regions.map((r) => r.id);
  const markers = validateMarkers(body.markers ?? [], regionIds);
  if (!markers.ok) return res.status(400).json({ message: markers.message, code: "INVALID_MARKER" });

  const concern = body.concern || undefined;
  const findings = body.findings || undefined;
  if (!concern && !findings) {
    return res.status(400).json({ message: "Add a concern or an assessment / findings entry", code: "EMPTY_ASSESSMENT" });
  }

  let appointmentId: string | undefined;
  if (body.appointmentId) {
    const visit = await Appointment.findOne({
      _id: body.appointmentId,
      clinicId: req.clinicId,
      patientId: patient._id,
      type: { $ne: "blocked" }, // legacy visits may have no `type` at all
    }).select("status");
    if (!visit) return res.status(404).json({ message: "Visit not found" });
    if (visit.status === "cancelled" || visit.status === "no_show") {
      return res.status(409).json({ message: "This visit was cancelled or missed", code: "VISIT_NOT_ACTIVE" });
    }
    appointmentId = String(visit._id);
  }

  try {
    const created = await DermAssessment.create({
      clinicId: req.clinicId,
      patientId: patient._id,
      appointmentId,
      recordType: body.recordType,
      regions: refs.regions,
      regionIds,
      markers: markers.markers,
      markerSpace: MARKER_SPACE,
      concern,
      findings,
      diagnosis: body.diagnosis || undefined,
      notes: body.notes || undefined,
      status: "active",
      rev: 0,
      clientRequestId: body.clientRequestId,
      registryVersion: REGION_REGISTRY_VERSION,
      createdBy: req.userId,
    });
    const fresh = (await populateAssessment(DermAssessment.findById(created._id)).lean()) as any;
    const visits = await visitsFor(req, patient._id, [fresh]);
    return res.status(201).json({ assessment: serializeAssessment(fresh, visits), duplicate: false });
  } catch (err: any) {
    if (err?.code === 11000) {
      // Lost a race / retried request: hand back what was saved — but only if it is the same patient's row.
      const existing = (await populateAssessment(
        DermAssessment.findOne({ clinicId: req.clinicId, clientRequestId: body.clientRequestId })
      ).lean()) as any;
      if (existing && String(existing.patientId) === String(patient._id)) {
        const visits = await visitsFor(req, patient._id, [existing]);
        return res.status(200).json({ assessment: serializeAssessment(existing, visits), duplicate: true });
      }
      return res.status(409).json({ message: "Duplicate request", code: "DUPLICATE_REQUEST" });
    }
    throw err;
  }
});

const editSchema = z
  .object({
    rev: z.number().int().min(0),
    concern: optText(MAX_TEXT.concern),
    findings: optText(MAX_TEXT.findings),
    diagnosis: optText(MAX_TEXT.diagnosis),
    notes: optText(MAX_TEXT.notes),
  })
  .refine((b) => ["concern", "findings", "diagnosis", "notes"].some((k) => (b as Record<string, unknown>)[k] !== undefined), {
    message: "Nothing to update",
  });

const EDITABLE = ["concern", "findings", "diagnosis", "notes"] as const;

const loadAssessment = async (req: Request, res: Response, patientId: unknown) => {
  const id = req.params.assessmentId;
  const doc = mongoose.isValidObjectId(id)
    ? await DermAssessment.findOne({ _id: id, clinicId: req.clinicId, patientId })
    : null;
  if (!doc) {
    res.status(404).json({ message: "Assessment not found" });
    return null;
  }
  return doc;
};

/**
 * PATCH /derm/patients/:patientId/assessments/:assessmentId
 * Corrects the TEXT of an assessment (concern / findings / diagnosis / notes). Regions, record type, markers and the
 * linked visit are immutable — a wrong entry is marked "entered in error" and re-documented. The previous values are
 * pushed onto `revisions` (who / when), and `rev` is an optimistic-concurrency token: a stale editor gets 409.
 */
export const editAssessment = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const body = editSchema.parse(req.body);
  const doc = await loadAssessment(req, res, patient._id);
  if (!doc) return;
  if (doc.status !== "active") {
    return res.status(409).json({ message: "This entry was marked as entered in error", code: "ENTERED_IN_ERROR" });
  }
  if (body.rev !== (doc.rev ?? 0)) {
    return res.status(409).json({ message: "This assessment was changed by someone else — reload it", code: "STALE" });
  }

  const $set: Record<string, string> = {};
  const $unset: Record<string, 1> = {};
  const previous: Record<string, string> = {};
  const next: Record<string, string> = {};
  for (const k of EDITABLE) {
    const incoming = body[k];
    if (incoming === undefined) continue;
    const old = (doc[k] as string | undefined) ?? "";
    if (incoming === old) continue;
    previous[k] = old;
    next[k] = incoming;
    if (incoming) $set[k] = incoming;
    else $unset[k] = 1;
  }
  if (!Object.keys(previous).length) {
    const same = (await populateAssessment(DermAssessment.findById(doc._id)).lean()) as any;
    return res.json({ assessment: serializeAssessment(same, await visitsFor(req, patient._id, [same])) });
  }
  const finalConcern = "concern" in next ? next.concern : doc.concern ?? "";
  const finalFindings = "findings" in next ? next.findings : doc.findings ?? "";
  if (!finalConcern && !finalFindings) {
    return res.status(400).json({ message: "Add a concern or an assessment / findings entry", code: "EMPTY_ASSESSMENT" });
  }

  const update: Record<string, unknown> = {
    $inc: { rev: 1 },
    $push: { revisions: { at: new Date(), by: req.userId, previous } },
  };
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;

  const updated = (await populateAssessment(
    DermAssessment.findOneAndUpdate(
      { _id: doc._id, clinicId: req.clinicId, patientId: patient._id, status: "active", rev: doc.rev ?? 0 },
      update,
      { new: true }
    )
  ).lean()) as any;
  if (!updated) {
    return res.status(409).json({ message: "This assessment was changed by someone else — reload it", code: "STALE" });
  }
  return res.json({ assessment: serializeAssessment(updated, await visitsFor(req, patient._id, [updated])) });
});

const voidSchema = z.object({ note: optText(MAX_TEXT.voidNote) });

/**
 * POST /derm/patients/:patientId/assessments/:assessmentId/void
 * "Entered in error": the row is kept (who / when / why) but leaves the map counts and the default history.
 */
export const voidAssessment = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const body = voidSchema.parse(req.body ?? {});
  const doc = await loadAssessment(req, res, patient._id);
  if (!doc) return;
  if (doc.status !== "active") {
    return res.status(409).json({ message: "This entry was already marked as entered in error", code: "ENTERED_IN_ERROR" });
  }
  const updated = (await populateAssessment(
    DermAssessment.findOneAndUpdate(
      { _id: doc._id, clinicId: req.clinicId, patientId: patient._id, status: "active" },
      {
        $set: { status: "entered_in_error", resolution: { at: new Date(), by: req.userId, reason: "entered_in_error", note: body.note || undefined } },
        $inc: { rev: 1 },
      },
      { new: true }
    )
  ).lean()) as any;
  if (!updated) {
    return res.status(409).json({ message: "This entry was already marked as entered in error", code: "ENTERED_IN_ERROR" });
  }
  return res.json({ assessment: serializeAssessment(updated, await visitsFor(req, patient._id, [updated])) });
});

export type { IDermAssessment };
