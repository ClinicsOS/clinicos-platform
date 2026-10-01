import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { Appointment } from "../models/Appointment";
import { DermAssessment } from "../models/DermAssessment";
import { DermTreatmentPlan, type IDermTreatmentPlan } from "../models/DermTreatmentPlan";
import { DermTreatmentItem } from "../models/DermTreatmentItem";
import { DermTreatmentSession } from "../models/DermTreatmentSession";
import { DermFollowUp } from "../models/DermFollowUp";
import { loadPatient, ID_RE } from "./dermController";
import { MAX_REGIONS_PER_ASSESSMENT, RECORD_TYPES, validateRegionRefs } from "../config/dermatology";
import {
  MAX_ITEMS_PER_PATIENT, MAX_PHASE, MAX_SESSION_TEXT, MAX_TRACE_TEXT, MAX_TREATMENT_TEXT, PRIORITIES, PROCEDURE_CATALOG_VERSION, PROCEDURE_LABELS, TARGET_TYPES,
  getProcedure, validateTarget, type PlanStatus,
} from "../config/dermProcedures";
import { DOC_SCHEMA_VERSION, groupsFor } from "../config/dermDocumentation";
import { loadDermBillingViews, type BillingView } from "../services/dermBilling";

/**
 * SECURITY (same model as Phase 1): `protect` -> `requireSpecialty("dermatology_aesthetics")` (router level, from the DB)
 * -> loadPatient re-verifies tenant ownership -> every query below carries clinicId AND patientId. clinicId, createdBy,
 * performedBy, regionIds, status, statusHistory, sessionNumber and every timestamp are derived on the server — never
 * read from a body. A visit (Appointment) is re-verified against the SAME clinic AND the SAME patient before a session is
 * linked to it. There is no DermVisit model: the existing Appointment is the only visit.
 *
 * CONSISTENCY (no Mongo transaction assumed): every state change is a GUARDED atomic update (the expected current status
 * is part of the filter) and the order of operations lets a retry converge to the right state. Unique indexes make
 * duplicate sessions / duplicate creates impossible at the database level.
 */
const who = (u: any) => (u && u._id ? { _id: String(u._id), name: u.name } : null);
const oid = (v: unknown) => (mongoose.isValidObjectId(v) ? String(v) : null);
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const ymd = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

const regionsOut = (rs: any[] | undefined) => (rs ?? []).map((r) => ({ id: r.id, ...(r.surface ? { surface: r.surface } : {}) }));

export interface ItemStats { sessionCount: number; lastSessionAt: Date | null; nextFollowUpDueAt: Date | null; followUpCount: number }

export const serializeItem = (i: any, billing?: BillingView, stats?: ItemStats) => ({
  _id: String(i._id),
  planId: String(i.planId),
  recordType: i.recordType,
  procedureCode: i.procedureCode,
  targetType: i.targetType,
  regions: regionsOut(i.regions),
  generalArea: i.generalArea ?? undefined,
  status: i.status as PlanStatus,
  priority: i.priority,
  phase: i.phase ?? 1,
  estimatedPrice: typeof i.estimatedPrice === "number" ? i.estimatedPrice : null, // an ESTIMATE — never a charge
  notes: i.notes ?? undefined,
  sourceAssessmentId: i.sourceAssessmentId ? String(i.sourceAssessmentId) : null,
  sourceDiagnosis: i.sourceDiagnosis ?? undefined,
  cancelReason: i.cancelReason ?? undefined,
  statusHistory: (i.statusHistory ?? []).map((h: any) => ({
    status: h.status, at: h.at, by: who(h.by), appointmentId: h.appointmentId ? String(h.appointmentId) : undefined, note: h.note ?? undefined,
  })),
  createdBy: who(i.createdBy),
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
  billing: billing ?? ({ state: "none" } as BillingView), // FINANCIAL LINK only; the invoice is authoritative
  stats: stats ?? { sessionCount: 0, lastSessionAt: null, nextFollowUpDueAt: null, followUpCount: 0 },
});

/** The procedure identity stored on a session when it starts (see IDermTreatmentSession.procedureSnapshot). */
export const procedureSnapshotFor = (code: string) => {
  const p = getProcedure(code);
  const l = PROCEDURE_LABELS[code];
  return { catalogVersion: PROCEDURE_CATALOG_VERSION, docSchemaVersion: DOC_SCHEMA_VERSION, metadata: p?.metadata ?? "none", labelEn: l?.en ?? code, labelAr: l?.ar ?? code };
};

export const serializeSession = (s: any, itemStatus?: PlanStatus) => ({
  _id: String(s._id),
  itemId: String(s.itemId),
  appointmentId: String(s.appointmentId),
  sessionNumber: s.sessionNumber,
  recordType: s.recordType,
  procedureCode: s.procedureCode,
  targetType: s.targetType,
  regions: regionsOut(s.regions),
  generalArea: s.generalArea ?? undefined,
  treatedRegions: regionsOut(s.treatedRegions),
  status: s.status as "in_progress" | "ended",
  autoClosed: !!s.autoClosed,
  procedureNotes: s.procedureNotes ?? undefined,
  observations: s.observations ?? undefined,
  outcome: s.outcome ?? undefined,
  followUpInstructions: s.followUpInstructions ?? undefined,
  followUpDueAt: s.followUpDueAt ?? undefined,
  followUpResolvedAt: s.followUpResolvedAt ?? undefined,
  product: s.product && Object.keys(s.product).length ? s.product : undefined,
  device: s.device && Object.keys(s.device).length ? s.device : undefined,
  procedureSnapshot: s.procedureSnapshot?.labelEn ? { catalogVersion: s.procedureSnapshot.catalogVersion, docSchemaVersion: s.procedureSnapshot.docSchemaVersion, metadata: s.procedureSnapshot.metadata, labelEn: s.procedureSnapshot.labelEn, labelAr: s.procedureSnapshot.labelAr } : undefined,
  performedBy: who(s.performedBy),
  startedAt: s.startedAt,
  endedAt: s.endedAt ?? undefined,
  itemStatus,
});

const scopeOf = (req: Request, patient: any) => ({ clinicId: req.clinicId, patientId: patient._id });

const getPlan = (req: Request, patientId: unknown) => DermTreatmentPlan.findOne({ clinicId: req.clinicId, patientId });
const getOrCreatePlan = async (req: Request, patientId: unknown): Promise<IDermTreatmentPlan> => {
  const filter = { clinicId: req.clinicId, patientId };
  try {
    return (await DermTreatmentPlan.findOneAndUpdate(filter, { $setOnInsert: { ...filter, phases: [{ number: 1 }], createdBy: req.userId } }, { upsert: true, new: true, setDefaultsOnInsert: true }))!;
  } catch (err: any) {
    if (err?.code === 11000) return (await DermTreatmentPlan.findOne(filter))!; // lost the race
    throw err;
  }
};

export const populateItem = (q: any) => q.populate("createdBy", "name").populate("statusHistory.by", "name").populate("billingHistory.by", "name").populate("billing.by", "name");
export const populateSession = (q: any) => q.populate("performedBy", "name");

/** NOTE: `type: { $ne: "blocked" }` because legacy visits may have no `type` field. Same 404 for "missing" and "someone else's". */
export const loadVisit = async (req: Request, res: Response, patientId: unknown, appointmentId: unknown, opts: { requireActive: boolean }) => {
  const id = oid(appointmentId);
  const visit = id ? await Appointment.findOne({ _id: id, clinicId: req.clinicId, patientId, type: { $ne: "blocked" } }) : null;
  if (!visit) { res.status(404).json({ message: "Visit not found" }); return null; }
  if (opts.requireActive && (visit.status === "cancelled" || visit.status === "no_show")) {
    res.status(409).json({ message: "This visit was cancelled or missed", code: "VISIT_NOT_ACTIVE" });
    return null;
  }
  return visit;
};

export const loadItem = async (req: Request, res: Response, patientId: unknown) => {
  const id = oid(req.params.itemId);
  const item = id ? await DermTreatmentItem.findOne({ _id: id, clinicId: req.clinicId, patientId }) : null;
  if (!item) { res.status(404).json({ message: "Treatment not found" }); return null; }
  return item;
};

/** Per-item display stats from the patient's sessions + follow-ups (one pass, no per-item queries). */
export function buildStats(itemIds: string[], sessions: any[], followUps: any[]): Map<string, ItemStats> {
  const m = new Map<string, ItemStats>(itemIds.map((id) => [id, { sessionCount: 0, lastSessionAt: null, nextFollowUpDueAt: null, followUpCount: 0 }]));
  for (const s of sessions) {
    const st = m.get(String(s.itemId));
    if (!st) continue;
    st.sessionCount += 1;
    if (!st.lastSessionAt || new Date(s.startedAt) > st.lastSessionAt) st.lastSessionAt = new Date(s.startedAt);
    if (s.followUpDueAt && !s.followUpResolvedAt && (!st.nextFollowUpDueAt || new Date(s.followUpDueAt) < st.nextFollowUpDueAt)) st.nextFollowUpDueAt = new Date(s.followUpDueAt);
  }
  for (const f of followUps) { const st = f.itemId ? m.get(String(f.itemId)) : undefined; if (st) st.followUpCount += 1; }
  return m;
}

// ------------------------------------------------------------------ read
export async function planPayload(req: Request, patient: any) {
  const scope = scopeOf(req, patient);
  const [plan, items, sessions, followUps] = await Promise.all([
    getPlan(req, patient._id),
    populateItem(DermTreatmentItem.find(scope).sort({ phase: 1, createdAt: 1 }).limit(MAX_ITEMS_PER_PATIENT + 50)).lean(),
    populateSession(DermTreatmentSession.find(scope).sort({ startedAt: 1 }).limit(2000)).lean(),
    DermFollowUp.find({ ...scope, status: "active" }).select("itemId").limit(2000).lean(),
  ]);
  const itemList = items as any[], sessionList = sessions as any[];
  const status = new Map(itemList.map((i) => [String(i._id), i.status as PlanStatus]));

  const visitIds = new Set<string>();
  sessionList.forEach((s) => visitIds.add(String(s.appointmentId)));
  itemList.forEach((i) => (i.statusHistory ?? []).forEach((h: any) => h.appointmentId && visitIds.add(String(h.appointmentId))));
  const visitDocs = visitIds.size
    ? ((await Appointment.find({ _id: { $in: [...visitIds] }, clinicId: req.clinicId, patientId: patient._id }).select("startAt source status").lean()) as any[])
    : [];
  const visits: Record<string, { startAt: Date; source: string; status: string }> = {};
  visitDocs.forEach((v) => (visits[String(v._id)] = { startAt: v.startAt, source: v.source, status: v.status }));

  const views = await loadDermBillingViews({ clinicId: req.clinicId, userId: req.userId, patientId: patient._id }, itemList);
  const stats = buildStats(itemList.map((i) => String(i._id)), sessionList, followUps as any[]);
  const count = (s: PlanStatus) => itemList.filter((i) => i.status === s).length;
  const sum = (list: any[]) => list.reduce((t, i) => t + (typeof i.estimatedPrice === "number" ? i.estimatedPrice : 0), 0);
  const needsBilling = itemList.filter((i) => i.status === "completed" && views.get(String(i._id))?.state === "none").length;
  return {
    plan: { phases: plan?.phases?.length ? plan.phases.map((p: any) => ({ number: p.number, name: p.name ?? undefined })) : [{ number: 1 }] },
    items: itemList.map((i) => serializeItem(i, views.get(String(i._id)), stats.get(String(i._id)))),
    sessions: sessionList.map((s) => serializeSession(s, status.get(String(s.itemId)))),
    visits,
    // ESTIMATES ONLY — never Amount Due / Paid / Balance. Those belong to the Invoice + Payment system.
    summary: {
      planned: count("planned"), inProgress: count("in_progress"), completed: count("completed"), cancelled: count("cancelled"),
      needsBilling, // COMPLETED and not yet linked to an invoice line. It does NOT mean the patient owes anything.
      estimatedTotal: round3(sum(itemList.filter((i) => i.status !== "cancelled"))),
      estimatedRemaining: round3(sum(itemList.filter((i) => i.status === "planned" || i.status === "in_progress"))),
    },
  };
}

/** GET /derm/patients/:patientId/treatment-plan */
export const getTreatmentPlan = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  return res.json(await planPayload(req, patient));
});

// ------------------------------------------------------------------ create / edit
const regionRefSchema = z.object({ id: z.string().min(1).max(60), surface: z.string().max(20).nullable().optional() });
const targetFields = {
  recordType: z.enum(RECORD_TYPES),
  procedureCode: z.string().min(1).max(40),
  targetType: z.enum(TARGET_TYPES),
  regions: z.array(regionRefSchema).max(MAX_REGIONS_PER_ASSESSMENT).optional(),
  generalArea: z.string().max(10).nullable().optional(),
};
const metaFields = {
  priority: z.enum(PRIORITIES).optional(),
  phase: z.number().int().min(1).max(MAX_PHASE).optional(),
  estimatedPrice: z.number().finite().min(0).max(1_000_000).nullable().optional(),
  notes: z.string().max(MAX_TREATMENT_TEXT.notes).optional(),
};
const createSchema = z.object({
  clientRequestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  ...targetFields,
  ...metaFields,
  sourceAssessmentId: z.string().regex(ID_RE).nullable().optional(),
});
const updateSchema = z.object({ ...targetFields, ...metaFields }).partial();

/**
 * POST /derm/patients/:patientId/treatment-plan/items — always created as PLANNED (intent, not performed work).
 * Idempotent per `clientRequestId`. The optional source assessment must be an ACTIVE assessment of this clinic + patient
 * with the SAME record type; its diagnosis text is copied as a read-only snapshot (never inferred).
 */
export const createItem = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const body = createSchema.parse(req.body);

  const dup: any = await populateItem(DermTreatmentItem.findOne({ clinicId: req.clinicId, clientRequestId: body.clientRequestId })).lean();
  if (dup) {
    if (String(dup.patientId) !== String(patient._id)) return res.status(409).json({ message: "Duplicate request", code: "DUPLICATE_REQUEST" });
    return res.status(200).json({ item: serializeItem(dup), duplicate: true });
  }

  const v = validateTarget({ procedureCode: body.procedureCode, recordType: body.recordType, targetType: body.targetType, regions: body.regions, generalArea: body.generalArea });
  if (!v.ok) return res.status(400).json({ message: v.message, code: "INVALID_TARGET" });

  let sourceDiagnosis: string | undefined;
  let sourceAssessmentId: string | undefined;
  if (body.sourceAssessmentId) {
    const a: any = await DermAssessment.findOne({ _id: body.sourceAssessmentId, clinicId: req.clinicId, patientId: patient._id, status: "active" }).select("recordType diagnosis").lean();
    if (!a) return res.status(404).json({ message: "Source assessment not found" });
    if (a.recordType !== body.recordType) return res.status(400).json({ message: "The treatment and its source assessment must have the same record type", code: "RECORD_TYPE_MISMATCH" });
    sourceAssessmentId = String(a._id);
    sourceDiagnosis = a.diagnosis ? String(a.diagnosis).slice(0, MAX_TREATMENT_TEXT.sourceDiagnosis) : undefined;
  }

  const existing = await DermTreatmentItem.countDocuments({ clinicId: req.clinicId, patientId: patient._id });
  if (existing >= MAX_ITEMS_PER_PATIENT) return res.status(409).json({ message: "This patient has reached the maximum number of treatments", code: "ITEM_LIMIT" });

  const plan = await getOrCreatePlan(req, patient._id);
  const now = new Date();
  try {
    const created = await DermTreatmentItem.create({
      clinicId: req.clinicId, patientId: patient._id, planId: plan._id,
      recordType: body.recordType, procedureCode: v.procedure.code, catalogVersion: PROCEDURE_CATALOG_VERSION,
      targetType: v.targetType, regions: v.regions, regionIds: v.regions.map((r) => r.id), generalArea: v.generalArea,
      status: "planned", priority: body.priority ?? "normal", phase: body.phase ?? 1,
      estimatedPrice: typeof body.estimatedPrice === "number" ? round3(body.estimatedPrice) : undefined,
      notes: body.notes?.trim() || undefined,
      sourceAssessmentId, sourceDiagnosis,
      statusHistory: [{ status: "planned", at: now, by: req.userId }],
      clientRequestId: body.clientRequestId, createdBy: req.userId,
    });
    const fresh = await populateItem(DermTreatmentItem.findOne({ _id: created._id, clinicId: req.clinicId, patientId: patient._id })).lean();
    return res.status(201).json({ item: serializeItem(fresh), duplicate: false });
  } catch (err: any) {
    if (err?.code === 11000) {
      const again: any = await populateItem(DermTreatmentItem.findOne({ clinicId: req.clinicId, patientId: patient._id, clientRequestId: body.clientRequestId })).lean();
      if (again) return res.status(200).json({ item: serializeItem(again), duplicate: true });
    }
    throw err;
  }
});

/**
 * PUT /derm/patients/:patientId/treatment-plan/items/:itemId
 *  planned      -> everything about the treatment is editable (record type, procedure, target, price, priority, phase, notes)
 *  in_progress  -> ONLY priority / phase / estimate / notes (sessions exist: procedure & target are locked — cancel + recreate)
 *  completed / cancelled -> read-only (409)
 * The source assessment / diagnosis snapshot is provenance and is never editable.
 */
export const updateItem = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const item = await loadItem(req, res, patient._id);
  if (!item) return;
  const body = updateSchema.parse(req.body);
  if (item.status === "completed" || item.status === "cancelled") {
    return res.status(409).json({ message: "A completed or cancelled treatment can no longer be edited", code: "ITEM_LOCKED" });
  }
  const touchesTarget = body.recordType !== undefined || body.procedureCode !== undefined || body.targetType !== undefined || body.regions !== undefined || body.generalArea !== undefined;
  if (touchesTarget && item.status !== "planned") {
    return res.status(409).json({ message: "The procedure and target can't be changed once treatment has started. Cancel it and add a corrected one.", code: "ITEM_LOCKED" });
  }

  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (touchesTarget) {
    const v = validateTarget({
      procedureCode: body.procedureCode ?? item.procedureCode,
      recordType: body.recordType ?? item.recordType,
      targetType: body.targetType ?? item.targetType,
      regions: body.regions ?? (item.regions as any[]),
      generalArea: body.generalArea !== undefined ? body.generalArea : item.generalArea,
    });
    if (!v.ok) return res.status(400).json({ message: v.message, code: "INVALID_TARGET" });
    // a treatment that came from an assessment keeps the same record type as that assessment
    if (item.sourceAssessmentId && v.procedure.recordType !== item.recordType) {
      return res.status(400).json({ message: "The record type of a treatment created from an assessment can't be changed", code: "RECORD_TYPE_MISMATCH" });
    }
    Object.assign(set, { recordType: v.procedure.recordType, procedureCode: v.procedure.code, targetType: v.targetType, regions: v.regions, regionIds: v.regions.map((r) => r.id) });
    if (v.generalArea) set.generalArea = v.generalArea; else unset.generalArea = 1;
  }
  if (body.priority !== undefined) set.priority = body.priority;
  if (body.phase !== undefined) set.phase = body.phase;
  if (body.notes !== undefined) { if (body.notes.trim()) set.notes = body.notes.trim(); else unset.notes = 1; }
  if (body.estimatedPrice !== undefined) { if (body.estimatedPrice === null) unset.estimatedPrice = 1; else set.estimatedPrice = round3(body.estimatedPrice); }
  if (!Object.keys(set).length && !Object.keys(unset).length) {
    return res.json({ item: serializeItem(await populateItem(DermTreatmentItem.findOne({ _id: item._id, clinicId: req.clinicId, patientId: patient._id })).lean()) });
  }
  const update: Record<string, unknown> = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  // Guarded: only applies while the status is still the one we validated against (a concurrent Start can't be bypassed).
  const updated = await populateItem(DermTreatmentItem.findOneAndUpdate({ _id: item._id, clinicId: req.clinicId, patientId: patient._id, status: item.status }, update, { new: true })).lean();
  if (!updated) return res.status(409).json({ message: "This treatment changed while you were editing. Reload and try again.", code: "ITEM_CHANGED" });
  return res.json({ item: serializeItem(updated) });
});

const phasesSchema = z.object({ phases: z.array(z.object({ number: z.number().int().min(1).max(MAX_PHASE), name: z.string().trim().max(60).optional() })).max(MAX_PHASE) });
/** PUT /derm/patients/:patientId/treatment-plan/phases — optional phase names ("Phase 1 — Initial Treatment"). */
export const setPhases = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const { phases } = phasesSchema.parse(req.body);
  if (new Set(phases.map((p) => p.number)).size !== phases.length) return res.status(400).json({ message: "Duplicate phase number" });
  const plan = await getOrCreatePlan(req, patient._id);
  const clean = phases.map((p) => ({ number: p.number, name: p.name || undefined })).sort((a, b) => a.number - b.number);
  await DermTreatmentPlan.findOneAndUpdate({ _id: plan._id, clinicId: req.clinicId, patientId: patient._id }, { $set: { phases: clean } });
  return res.json({ plan: { phases: clean } });
});

// ------------------------------------------------------------------ session fields (shared by update / end-session / complete)
const productSchema = z.object({
  name: z.string().max(MAX_TRACE_TEXT.name), brand: z.string().max(MAX_TRACE_TEXT.brand), lotNumber: z.string().max(MAX_TRACE_TEXT.lot),
  expiryDate: z.string().max(10), quantity: z.string().max(MAX_TRACE_TEXT.quantity),
  unit: z.string().max(MAX_TRACE_TEXT.unit), notes: z.string().max(MAX_TRACE_TEXT.productNotes),
}).partial();
const deviceSchema = z.object({
  name: z.string().max(MAX_TRACE_TEXT.device), identifier: z.string().max(MAX_TRACE_TEXT.deviceId),
  settingsSummary: z.string().max(MAX_TRACE_TEXT.settings), notes: z.string().max(MAX_TRACE_TEXT.notes),
}).partial();
const sessionFields = {
  procedureNotes: z.string().max(MAX_SESSION_TEXT.procedureNotes).optional(),
  observations: z.string().max(MAX_SESSION_TEXT.observations).optional(),
  outcome: z.string().max(MAX_SESSION_TEXT.outcome).optional(),
  followUpInstructions: z.string().max(MAX_SESSION_TEXT.followUpInstructions).optional(),
  followUpDueAt: z.string().max(10).nullable().optional(), // YYYY-MM-DD, chosen by the clinician (never computed)
  treatedRegions: z.array(regionRefSchema).max(MAX_REGIONS_PER_ASSESSMENT).optional(),
  product: productSchema.nullable().optional(),
  device: deviceSchema.nullable().optional(),
};
const sessionFieldsSchema = z.object(sessionFields);
type SessionFieldsBody = z.infer<typeof sessionFieldsSchema>;

const validYmd = (s: string) => {
  if (!ymd(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

type Built = { ok: true; set: Record<string, unknown>; unset: Record<string, 1> } | { ok: false; message: string; code: string };

/** Validates + normalises the optional session fields against the item (a block the procedure doesn't allow is rejected). */
export function buildSessionChanges(body: SessionFieldsBody, item: any): Built {
  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  const proc = getProcedure(item.procedureCode);
  for (const k of ["procedureNotes", "observations", "outcome", "followUpInstructions"] as const) {
    const v = body[k];
    if (v === undefined) continue;
    if (v.trim()) set[k] = v.trim(); else unset[k] = 1;
  }
  if (body.followUpDueAt !== undefined) {
    if (body.followUpDueAt === null || body.followUpDueAt === "") { unset.followUpDueAt = 1; unset.followUpResolvedAt = 1; }
    else {
      if (!validYmd(body.followUpDueAt)) return { ok: false, message: "Invalid follow-up date", code: "INVALID_DATE" };
      const at = new Date(`${body.followUpDueAt}T00:00:00+03:00`);
      const now = Date.now();
      if (at.getTime() < now - 2 * 86_400_000 || at.getTime() > now + 5 * 365 * 86_400_000) return { ok: false, message: "The follow-up date is out of range", code: "INVALID_DATE" };
      set.followUpDueAt = at;
      unset.followUpResolvedAt = 1; // a new review date re-opens the follow-up
    }
  }
  if (body.treatedRegions !== undefined) {
    if (item.targetType === "general" && body.treatedRegions.length === 0) { set.treatedRegions = []; }
    else {
      const refs = validateRegionRefs(body.treatedRegions);
      if (!refs.ok) return { ok: false, message: refs.message, code: "INVALID_REGION" };
      if (item.targetType !== "general") {
        const allowed = new Set((item.regions as any[]).map((r) => r.id));
        if (refs.regions.some((r) => !allowed.has(r.id))) return { ok: false, message: "A treated region is not part of this treatment", code: "REGION_NOT_IN_TREATMENT" };
      }
      set.treatedRegions = refs.regions;
    }
  }
  const trace = (key: "product" | "device", val: Record<string, string | undefined> | null | undefined, allowed: boolean): Built | null => {
    if (val === undefined) return null;
    if (val === null) { unset[key] = 1; return null; }
    const clean: Record<string, string> = {};
    for (const [f, x] of Object.entries(val)) if (typeof x === "string" && x.trim()) clean[f] = x.trim();
    if (!Object.keys(clean).length) { unset[key] = 1; return null; }
    if (!allowed) return { ok: false, message: `This procedure does not use ${key} information`, code: "METADATA_NOT_ALLOWED" };
    if (key === "product" && clean.expiryDate && !validYmd(clean.expiryDate)) return { ok: false, message: "Invalid product expiry date", code: "INVALID_DATE" };
    set[key] = clean;
    return null;
  };
  // which documentation groups this procedure may carry comes from the ONE central config (dermDocumentation.ts)
  const groups = proc ? groupsFor(proc.metadata) : [];
  const e1 = trace("product", body.product as any, groups.includes("product")); if (e1) return e1;
  const e2 = trace("device", body.device as any, groups.includes("device")); if (e2) return e2;
  return { ok: true, set, unset };
}

const toUpdate = (b: { set: Record<string, unknown>; unset: Record<string, 1> }, extraSet: Record<string, unknown> = {}, editor?: unknown) => {
  // `updatedBy` = the last user who actually changed the documentation (audit); a no-op autosave does not touch it
  const changed = Object.keys(b.set).length > 0 || Object.keys(b.unset).length > 0;
  const $set = { ...b.set, ...extraSet, ...(changed && editor ? { updatedBy: editor } : {}) };
  const u: Record<string, unknown> = {};
  if (Object.keys($set).length) u.$set = $set;
  if (Object.keys(b.unset).length) u.$unset = b.unset;
  return u;
};

// ------------------------------------------------------------------ lifecycle
const visitBody = z.object({ appointmentId: z.string().min(1), ...sessionFields });
const cancelBody = z.object({ reason: z.string().trim().max(MAX_TREATMENT_TEXT.cancelReason).optional() });

/**
 * POST .../items/:itemId/cancel — planned or in-progress only. Nothing is deleted: the item, its sessions and its status
 * history (with reason / who / when) stay. Open sessions are closed by the system (flagged autoClosed).
 */
export const cancelItem = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const item = await loadItem(req, res, patient._id);
  if (!item) return;
  const { reason } = cancelBody.parse(req.body ?? {});
  const now = new Date();
  const updated = await populateItem(
    DermTreatmentItem.findOneAndUpdate(
      { _id: item._id, clinicId: req.clinicId, patientId: patient._id, status: { $in: ["planned", "in_progress"] } },
      { $set: { status: "cancelled", cancelReason: reason || undefined }, $push: { statusHistory: { status: "cancelled", at: now, by: req.userId, note: reason || undefined } } },
      { new: true }
    )
  ).lean();
  if (!updated) {
    const cur = await DermTreatmentItem.findOne({ _id: item._id, clinicId: req.clinicId, patientId: patient._id });
    if (cur?.status === "cancelled") return res.json({ item: serializeItem(await populateItem(DermTreatmentItem.findOne({ _id: item._id, clinicId: req.clinicId, patientId: patient._id })).lean()), alreadyCancelled: true });
    return res.status(409).json({ message: "A completed treatment can't be cancelled", code: "ITEM_LOCKED" });
  }
  await DermTreatmentSession.updateMany({ itemId: item._id, clinicId: req.clinicId, patientId: patient._id, status: "in_progress" }, { $set: { status: "ended", autoClosed: true, endedAt: now } });
  await DermTreatmentSession.updateMany({ itemId: item._id, clinicId: req.clinicId, patientId: patient._id, followUpDueAt: { $exists: true }, followUpResolvedAt: { $exists: false } }, { $set: { followUpResolvedAt: now } });
  return res.json({ item: serializeItem(updated) });
});

/**
 * POST .../items/:itemId/start  { appointmentId }   (also "Continue Treatment" on a later visit)
 * The visit must be an EXISTING, active visit of this patient (scheduled or walk-in). Idempotent per (item, visit).
 * Order: 1) create the session  2) planned -> in_progress (guarded) — so a crash between them is repaired by retrying.
 * Starting is NOT completing.
 */
export const startItem = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const item = await loadItem(req, res, patient._id);
  if (!item) return;
  const { appointmentId } = z.object({ appointmentId: z.string().min(1) }).parse(req.body);
  const visit = await loadVisit(req, res, patient._id, appointmentId, { requireActive: true });
  if (!visit) return;
  if (item.status !== "planned" && item.status !== "in_progress") {
    return res.status(409).json({ message: "This treatment is already completed or cancelled", code: "ITEM_NOT_STARTABLE" });
  }

  const scope = { clinicId: req.clinicId, patientId: patient._id };
  let session: any = await DermTreatmentSession.findOne({ ...scope, itemId: item._id, appointmentId: visit._id });
  let created = false;
  for (let attempt = 0; !session && attempt < 4; attempt++) {
    const last: any = await DermTreatmentSession.findOne({ itemId: item._id }).sort({ sessionNumber: -1 }).select("sessionNumber");
    try {
      session = await DermTreatmentSession.create({
        ...scope, itemId: item._id, appointmentId: visit._id, sessionNumber: (last?.sessionNumber ?? 0) + 1,
        recordType: item.recordType, procedureCode: item.procedureCode, targetType: item.targetType, // SNAPSHOT
        procedureSnapshot: procedureSnapshotFor(item.procedureCode),
        regions: item.regions, regionIds: item.regionIds, generalArea: item.generalArea, treatedRegions: item.regions,
        status: "in_progress", performedBy: req.userId, startedAt: new Date(),
      });
      created = true;
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      session = await DermTreatmentSession.findOne({ ...scope, itemId: item._id, appointmentId: visit._id }); // double click or number taken
    }
  }
  if (!session) return res.status(409).json({ message: "Could not start the session, please retry", code: "SESSION_CONFLICT" });

  const now = new Date();
  if (created) {
    // a session from an earlier visit that nobody ended is closed by the system (flagged autoClosed)
    await DermTreatmentSession.updateMany({ itemId: item._id, ...scope, status: "in_progress", _id: { $ne: session._id } }, { $set: { status: "ended", autoClosed: true, endedAt: now } });
  }
  await DermTreatmentItem.findOneAndUpdate(
    { _id: item._id, ...scope, status: "planned" },
    { $set: { status: "in_progress" }, $push: { statusHistory: { status: "in_progress", at: now, by: req.userId, appointmentId: visit._id } } }
  );
  const fresh: any = await populateItem(DermTreatmentItem.findOne({ _id: item._id, ...scope })).lean();
  if (!fresh || fresh.status !== "in_progress") {
    if (created) await DermTreatmentSession.deleteOne({ _id: session._id, ...scope }); // cancelled/completed meanwhile: no stray session
    return res.status(409).json({ message: "This treatment is no longer available", code: "ITEM_NOT_STARTABLE" });
  }
  const populated: any = await populateSession(DermTreatmentSession.findOne({ _id: session._id, ...scope })).lean();
  return res.status(created ? 201 : 200).json({ item: serializeItem(fresh), session: serializeSession(populated, "in_progress"), alreadyStarted: !created });
});

/** PUT .../treatment-sessions/:sessionId — save the session's fields while it is open (autosave-friendly). */
export const updateSession = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const id = oid(req.params.sessionId);
  const body = sessionFieldsSchema.parse(req.body ?? {});
  const scope = { clinicId: req.clinicId, patientId: patient._id };
  const session: any = id ? await DermTreatmentSession.findOne({ _id: id, ...scope }) : null;
  if (!session) return res.status(404).json({ message: "Session not found" });
  if (session.status !== "in_progress") return res.status(409).json({ message: "This session is already ended", code: "SESSION_CLOSED" });
  const item: any = await DermTreatmentItem.findOne({ _id: session.itemId, ...scope });
  if (!item) return res.status(404).json({ message: "Treatment not found" });
  const built = buildSessionChanges(body, item);
  if (!built.ok) return res.status(400).json({ message: built.message, code: built.code });
  const upd = toUpdate(built, {}, req.userId);
  const updated = Object.keys(upd).length
    ? await DermTreatmentSession.findOneAndUpdate({ _id: id, ...scope, status: "in_progress" }, upd, { new: true })
    : session;
  if (!updated) return res.status(409).json({ message: "This session is already ended", code: "SESSION_CLOSED" });
  const out: any = await populateSession(DermTreatmentSession.findOne({ _id: id, ...scope })).lean();
  return res.json({ session: serializeSession(out, item.status) });
});

/**
 * Validates the fields, applies them AND ends the visit's session in one guarded update. Returns the session (or an
 * error already sent). A session that is already ended is left untouched (`alreadyEnded`) — a retry never rewrites it.
 */
async function applyAndEnd(req: Request, res: Response, item: any, visit: any, body: SessionFieldsBody, now: Date, opts: { editEnded?: boolean } = {}) {
  const scope = { clinicId: req.clinicId, patientId: item.patientId };
  const session: any = await DermTreatmentSession.findOne({ ...scope, itemId: item._id, appointmentId: visit._id });
  if (!session) { res.status(409).json({ message: "Start the treatment in this visit first", code: "NO_SESSION_IN_VISIT" }); return null; }
  if (session.status === "ended") {
    // "Complete treatment" right after "End this session" in the same visit: what the clinician typed now is still saved
    // (only on that first completion — a retry finds the item completed and returns before reaching here).
    if (opts.editEnded) {
      const b = buildSessionChanges(body, item);
      if (!b.ok) { res.status(400).json({ message: b.message, code: b.code }); return null; }
      const upd = toUpdate(b, {}, req.userId);
      if (Object.keys(upd).length) await DermTreatmentSession.findOneAndUpdate({ _id: session._id, ...scope, status: "ended" }, upd);
    }
    return { session, alreadyEnded: true };
  }
  const built = buildSessionChanges(body, item);
  if (!built.ok) { res.status(400).json({ message: built.message, code: built.code }); return null; }
  const ended = await DermTreatmentSession.findOneAndUpdate({ _id: session._id, ...scope, status: "in_progress" }, toUpdate(built, { status: "ended", endedAt: now }, req.userId), { new: true });
  return { session: ended ?? (await DermTreatmentSession.findOne({ _id: session._id, ...scope })), alreadyEnded: !ended };
}

/**
 * POST .../items/:itemId/end-session  { appointmentId, ...fields }
 * ENDS THIS VISIT'S SESSION. The treatment stays IN_PROGRESS — use it when more sessions are expected. It never
 * completes the treatment.
 */
export const endSession = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const item = await loadItem(req, res, patient._id);
  if (!item) return;
  const { appointmentId, ...fields } = visitBody.parse(req.body);
  const visit = await loadVisit(req, res, patient._id, appointmentId, { requireActive: false });
  if (!visit) return;
  const r = await applyAndEnd(req, res, item, visit, fields, new Date());
  if (!r) return;
  const [it, se]: any[] = await Promise.all([
    populateItem(DermTreatmentItem.findOne({ _id: item._id, clinicId: req.clinicId, patientId: patient._id })).lean(),
    populateSession(DermTreatmentSession.findOne({ _id: r.session._id, clinicId: req.clinicId, patientId: patient._id })).lean(),
  ]);
  return res.json({ item: serializeItem(it), session: serializeSession(se, it.status), alreadyEnded: r.alreadyEnded });
});

/**
 * POST .../items/:itemId/complete  { appointmentId, ...fields }
 * COMPLETES THE TREATMENT (the whole plan item). Needs a session in THIS visit (Start / Continue first): its fields are
 * saved, the session is ended, then in_progress -> completed (guarded). A double click / retry finds the item already
 * completed and returns it WITHOUT a second history entry. Ending a session never completes a treatment by itself.
 */
export const completeItem = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const item = await loadItem(req, res, patient._id);
  if (!item) return;
  const { appointmentId, ...fields } = visitBody.parse(req.body);
  const visit = await loadVisit(req, res, patient._id, appointmentId, { requireActive: false });
  if (!visit) return;
  const scope = { clinicId: req.clinicId, patientId: patient._id };
  const respondDone = async (alreadyCompleted: boolean) => {
    const [it, se]: any[] = await Promise.all([
      populateItem(DermTreatmentItem.findOne({ _id: item._id, ...scope })).lean(),
      populateSession(DermTreatmentSession.findOne({ ...scope, itemId: item._id, appointmentId: visit._id })).lean(),
    ]);
    return res.json({ item: serializeItem(it), session: se ? serializeSession(se, it.status) : null, alreadyCompleted });
  };

  if (item.status === "completed") return respondDone(true);
  if (item.status !== "in_progress") return res.status(409).json({ message: "Start the treatment before completing it", code: "ITEM_NOT_IN_PROGRESS" });
  const now = new Date();
  const r = await applyAndEnd(req, res, item, visit, fields, now, { editEnded: true });
  if (!r) return;
  const done = await DermTreatmentItem.findOneAndUpdate(
    { _id: item._id, ...scope, status: "in_progress" },
    { $set: { status: "completed" }, $push: { statusHistory: { status: "completed", at: now, by: req.userId, appointmentId: visit._id } } },
    { new: true }
  );
  if (!done) {
    const cur = await DermTreatmentItem.findOne({ _id: item._id, ...scope });
    if (cur?.status === "completed") return respondDone(true); // the other click won
    return res.status(409).json({ message: "This treatment is no longer in progress", code: "ITEM_NOT_IN_PROGRESS" });
  }
  return respondDone(false);
});
