import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { Appointment } from "../models/Appointment";
import { DentalToothEvent } from "../models/DentalToothEvent";
import { DentalTreatmentPlan, type IDentalTreatmentPlan } from "../models/DentalTreatmentPlan";
import { DentalTreatmentItem } from "../models/DentalTreatmentItem";
import { DentalTreatmentSession } from "../models/DentalTreatmentSession";
import { getOrCreateRecord, loadPatient } from "./dentalController";
import {
  MAX_PHASE, PRIORITIES, PROCEDURE_CATALOG_VERSION, TARGET_TYPES, validateTarget, type PlanStatus,
} from "../config/dentalProcedures";
import { buildTimeline } from "../utils/dentalTimeline";
import { loadBillingViews, type BillingView } from "../services/dentalBilling";

/**
 * SECURITY (same model as dentalController): `protect` -> `requireSpecialty("dentistry")` (router level) ->
 * loadPatient re-verifies tenant ownership -> every query below carries clinicId AND patientId.
 * clinicId / specialty are never read from the client. Visits (Appointments) are re-verified against the SAME
 * clinic AND the SAME patient before any session is linked to them.
 *
 * CONSISTENCY (no Mongo transaction assumed): every state change is a GUARDED atomic update
 * (the expected current status is part of the filter) and the order of operations is chosen so that retrying
 * any request after a crash converges to the correct state. Unique indexes on sessions make duplicates impossible.
 */

const who = (u: any) => (u && u._id ? { _id: String(u._id), name: u.name } : null);
const oid = (v: unknown) => (mongoose.isValidObjectId(v) ? String(v) : null);

export const serializeItem = (i: any, billing?: BillingView) => ({
  _id: String(i._id),
  planId: String(i.planId),
  procedureCode: i.procedureCode,
  targetType: i.targetType,
  toothNumbers: i.toothNumbers ?? [],
  surfaces: i.surfaces ?? [],
  status: i.status as PlanStatus,
  priority: i.priority,
  phase: i.phase ?? 1,
  estimatedPrice: typeof i.estimatedPrice === "number" ? i.estimatedPrice : null,
  notes: i.notes ?? undefined,
  sourceDiagnosisIds: (i.sourceDiagnosisIds ?? []).map(String),
  dentitionType: i.dentitionType,
  cancelReason: i.cancelReason ?? undefined,
  statusHistory: (i.statusHistory ?? []).map((h: any) => ({
    status: h.status, at: h.at, by: who(h.by), appointmentId: h.appointmentId ? String(h.appointmentId) : undefined, note: h.note ?? undefined,
  })),
  createdBy: who(i.createdBy),
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
  // FINANCIAL LINK only (estimatedPrice above is never overwritten by what was actually invoiced).
  billing: billing ?? ({ state: "none" } as BillingView),
});

const serializeSession = (s: any, itemStatus?: PlanStatus) => ({
  _id: String(s._id),
  itemId: String(s.itemId),
  appointmentId: String(s.appointmentId),
  sessionNumber: s.sessionNumber,
  procedureCode: s.procedureCode,
  targetType: s.targetType,
  toothNumbers: s.toothNumbers ?? [],
  surfaces: s.surfaces ?? [],
  status: s.status,
  autoClosed: !!s.autoClosed,
  notes: s.notes ?? undefined,
  performedBy: who(s.performedBy),
  startedAt: s.startedAt,
  completedAt: s.completedAt ?? undefined,
  itemStatus,
});

const scopeOf = (req: Request, patient: any) => ({ clinicId: req.clinicId, patientId: patient._id });

const getPlan = (req: Request, patientId: unknown) => DentalTreatmentPlan.findOne({ clinicId: req.clinicId, patientId });
const getOrCreatePlan = async (req: Request, patientId: unknown): Promise<IDentalTreatmentPlan> => {
  const filter = { clinicId: req.clinicId, patientId };
  try {
    return (await DentalTreatmentPlan.findOneAndUpdate(
      filter, { $setOnInsert: { ...filter, phases: [{ number: 1 }], createdBy: req.userId } }, { upsert: true, new: true, setDefaultsOnInsert: true }
    ))!;
  } catch (err: any) {
    if (err?.code === 11000) return (await DentalTreatmentPlan.findOne(filter))!; // lost the race
    throw err;
  }
};

export const populateItem = (q: any) => q.populate("createdBy", "name").populate("statusHistory.by", "name").populate("billingHistory.by", "name").populate("billing.by", "name");
const populateSession = (q: any) => q.populate("performedBy", "name");

/** NOTE: `type: { $ne: "blocked" }` (as in reports/dashboard) because legacy visits may have no `type` field at all.
 * Verifies a visit exists in THIS clinic and belongs to THIS patient. Same 404 for "missing" and "someone else's". */
const loadVisit = async (req: Request, res: Response, patientId: unknown, appointmentId: unknown, opts: { requireActive: boolean }) => {
  const id = oid(appointmentId);
  const visit = id ? await Appointment.findOne({ _id: id, clinicId: req.clinicId, patientId, type: { $ne: "blocked" } }) : null;
  if (!visit) { res.status(404).json({ message: "Visit not found" }); return null; }
  // Cancelled / no-show visits cannot hold performed work. Any other status (incl. completed, walk-in) is fine.
  if (opts.requireActive && (visit.status === "cancelled" || visit.status === "no_show")) {
    res.status(409).json({ message: "This visit was cancelled or missed", code: "VISIT_NOT_ACTIVE" });
    return null;
  }
  return visit;
};

export const loadItem = async (req: Request, res: Response, patientId: unknown) => {
  const id = oid(req.params.itemId);
  const item = id ? await DentalTreatmentItem.findOne({ _id: id, clinicId: req.clinicId, patientId }) : null;
  if (!item) { res.status(404).json({ message: "Treatment item not found" }); return null; }
  return item;
};

// ------------------------------------------------------------------ read
export async function planPayload(req: Request, patient: any) {
  const scope = scopeOf(req, patient);
  const [plan, items, sessions] = await Promise.all([
    getPlan(req, patient._id),
    populateItem(DentalTreatmentItem.find(scope).sort({ phase: 1, createdAt: 1 })).lean(),
    populateSession(DentalTreatmentSession.find(scope).sort({ startedAt: 1 })).lean(),
  ]);
  const itemList = items as any[], sessionList = sessions as any[];
  const status = new Map(itemList.map((i) => [String(i._id), i.status as PlanStatus]));

  // dates of the existing visits referenced by sessions / status history (for display only)
  const visitIds = new Set<string>();
  sessionList.forEach((s) => visitIds.add(String(s.appointmentId)));
  itemList.forEach((i) => (i.statusHistory ?? []).forEach((h: any) => h.appointmentId && visitIds.add(String(h.appointmentId))));
  const visitDocs = visitIds.size
    ? ((await Appointment.find({ _id: { $in: [...visitIds] }, clinicId: req.clinicId, patientId: patient._id }).select("startAt source status").lean()) as any[])
    : [];
  const visits: Record<string, { startAt: Date; source: string; status: string }> = {};
  visitDocs.forEach((v) => (visits[String(v._id)] = { startAt: v.startAt, source: v.source, status: v.status }));

  const round = (n: number) => Math.round(n * 1000) / 1000;
  // billing links -> live invoice state (read from the invoice lines themselves; the Invoice system is authoritative)
  const views = await loadBillingViews({ clinicId: req.clinicId, userId: req.userId, patientId: patient._id }, itemList);
  const invoicedTotal = round(itemList.reduce((t, i) => t + (views.get(String(i._id))?.state === "invoiced" ? views.get(String(i._id))!.amount ?? 0 : 0), 0));
  const count = (s: PlanStatus) => itemList.filter((i) => i.status === s).length;
  const sum = (list: any[]) => list.reduce((t, i) => t + (typeof i.estimatedPrice === "number" ? i.estimatedPrice : 0), 0);
  return {
    plan: { phases: plan?.phases?.length ? plan.phases.map((p: any) => ({ number: p.number, name: p.name ?? undefined })) : [{ number: 1 }] },
    items: itemList.map((i) => serializeItem(i, views.get(String(i._id)))),
    sessions: sessionList.map((s) => serializeSession(s, status.get(String(s.itemId)))),
    visits,
    timeline: buildTimeline(itemList, sessionList),
    // ESTIMATES ONLY — not Amount Due / Paid / Balance / Revenue. Those belong to the Invoice + Payment system.
    summary: {
      planned: count("planned"), inProgress: count("in_progress"), completed: count("completed"), cancelled: count("cancelled"),
      estimatedTotal: round(sum(itemList.filter((i) => i.status !== "cancelled"))),
      estimatedRemaining: round(sum(itemList.filter((i) => i.status === "planned" || i.status === "in_progress"))),
      // What has ACTUALLY been put on invoices (live from the invoice lines). Still not Paid / Balance — see the invoice.
      invoicedTotal,
      invoicedCount: itemList.filter((i) => views.get(String(i._id))?.state === "invoiced").length,
    },
  };
}

/** GET /dental/patients/:patientId/treatment-plan */
export const getTreatmentPlan = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  return res.json(await planPayload(req, patient));
});

/** GET /dental/patients/:patientId/visits/:appointmentId/treatments — the Dental section of one existing visit. */
export const getVisitTreatments = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const visit = await loadVisit(req, res, patient._id, req.params.appointmentId, { requireActive: false });
  if (!visit) return;
  const scope = scopeOf(req, patient);
  const [pending, here] = await Promise.all([
    populateItem(DentalTreatmentItem.find({ ...scope, status: { $in: ["planned", "in_progress"] } }).sort({ phase: 1, createdAt: 1 })).lean(),
    populateSession(DentalTreatmentSession.find({ ...scope, appointmentId: visit._id }).sort({ startedAt: 1 })).lean(),
  ]);
  const sessions = here as any[];
  const doneIds = [...new Set(sessions.map((s) => String(s.itemId)))];
  const doneItems = doneIds.length ? ((await DentalTreatmentItem.find({ ...scope, _id: { $in: doneIds } }).populate("billing.by", "name").lean()) as any[]) : [];
  const st = new Map(doneItems.map((i) => [String(i._id), i.status as PlanStatus]));
  const doneById = new Map(doneItems.map((i) => [String(i._id), i]));
  const views = await loadBillingViews({ clinicId: req.clinicId, userId: req.userId, patientId: patient._id }, doneItems);
  const byItem = new Map(sessions.map((s) => [String(s.itemId), s]));
  return res.json({
    visit: { _id: String(visit._id), status: visit.status, source: visit.source, startAt: visit.startAt },
    pending: (pending as any[]).map((i) => ({ ...serializeItem(i), sessionInVisit: byItem.has(String(i._id)) ? serializeSession(byItem.get(String(i._id)), i.status) : null })),
    performed: sessions.map((s) => ({
      ...serializeSession(s, st.get(String(s.itemId))),
      estimatedPrice: typeof doneById.get(String(s.itemId))?.estimatedPrice === "number" ? doneById.get(String(s.itemId)).estimatedPrice : null,
      billing: views.get(String(s.itemId)) ?? { state: "none" },
    })),
  });
});

// ------------------------------------------------------------------ create / edit
const targetFields = {
  procedureCode: z.string().min(1).max(40),
  targetType: z.enum(TARGET_TYPES),
  toothNumbers: z.array(z.string().min(1).max(3)).max(32).optional(),
  surfaces: z.array(z.string().min(1).max(2)).max(5).optional(),
};
const metaFields = {
  priority: z.enum(PRIORITIES).optional(),
  phase: z.number().int().min(1).max(MAX_PHASE).optional(),
  estimatedPrice: z.number().finite().min(0).max(1_000_000).nullable().optional(),
  notes: z.string().max(1000).optional(),
  sourceDiagnosisIds: z.array(z.string()).max(10).optional(),
};
const createSchema = z.object({ ...targetFields, ...metaFields });
const updateSchema = z.object({ ...targetFields, ...metaFields }).partial();

const roundPrice = (n: number) => Math.round(n * 1000) / 1000;

/** Source diagnoses must be diagnosis events of THIS clinic and THIS patient (provenance only — never auto-created). */
async function checkSourceDiagnoses(req: Request, patientId: unknown, ids: string[]): Promise<string | null> {
  const uniq = [...new Set(ids)];
  if (uniq.some((x) => !oid(x))) return "Invalid source diagnosis";
  if (!uniq.length) return null;
  const n = await DentalToothEvent.countDocuments({ _id: { $in: uniq }, clinicId: req.clinicId, patientId, category: "diagnosis" });
  return n === uniq.length ? null : "Source diagnosis not found";
}

/** POST /dental/patients/:patientId/treatment-plan/items — always created as PLANNED (intent, not performed work). */
export const createItem = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const body = createSchema.parse(req.body);
  const record = await getOrCreateRecord(req, patient._id);
  const v = validateTarget(body, record.dentitionType);
  if (!v.ok) return res.status(400).json({ message: v.message });
  const srcErr = await checkSourceDiagnoses(req, patient._id, body.sourceDiagnosisIds ?? []);
  if (srcErr) return res.status(400).json({ message: srcErr });

  const plan = await getOrCreatePlan(req, patient._id);
  const now = new Date();
  const created = await DentalTreatmentItem.create({
    clinicId: req.clinicId, patientId: patient._id, planId: plan._id,
    procedureCode: v.procedureCode, catalogVersion: PROCEDURE_CATALOG_VERSION,
    targetType: v.targetType, toothNumbers: v.toothNumbers, surfaces: v.surfaces,
    status: "planned", priority: body.priority ?? "normal", phase: body.phase ?? 1,
    estimatedPrice: typeof body.estimatedPrice === "number" ? roundPrice(body.estimatedPrice) : undefined,
    notes: body.notes?.trim() || undefined,
    sourceDiagnosisIds: [...new Set(body.sourceDiagnosisIds ?? [])],
    dentitionType: record.dentitionType,
    statusHistory: [{ status: "planned", at: now, by: req.userId }],
    createdBy: req.userId,
  });
  // Re-read through a Query (Document#populate returns a Promise in Mongoose, so it can't be chained like a Query).
  const fresh = await populateItem(DentalTreatmentItem.findOne({ _id: created._id, clinicId: req.clinicId, patientId: patient._id })).lean();
  return res.status(201).json({ item: serializeItem(fresh) });
});

/**
 * PUT /dental/patients/:patientId/treatment-plan/items/:itemId
 *  planned      -> everything editable (procedure, target, surfaces, price, priority, phase, notes, sources)
 *  in_progress  -> ONLY priority / phase / price / notes (sessions exist: procedure & target are locked — cancel + recreate)
 *  completed / cancelled -> read-only (409)
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
  const touchesTarget = body.procedureCode !== undefined || body.targetType !== undefined || body.toothNumbers !== undefined || body.surfaces !== undefined;
  if (touchesTarget && item.status !== "planned") {
    return res.status(409).json({ message: "The procedure and target can't be changed once treatment has started. Cancel it and add a corrected one.", code: "ITEM_LOCKED" });
  }

  const set: Record<string, unknown> = {};
  const unset: Record<string, 1> = {};
  if (touchesTarget) {
    const record = await getOrCreateRecord(req, patient._id);
    const v = validateTarget(
      {
        procedureCode: body.procedureCode ?? item.procedureCode,
        targetType: body.targetType ?? item.targetType,
        toothNumbers: body.toothNumbers ?? item.toothNumbers,
        surfaces: body.surfaces ?? item.surfaces,
      },
      record.dentitionType
    );
    if (!v.ok) return res.status(400).json({ message: v.message });
    Object.assign(set, { procedureCode: v.procedureCode, targetType: v.targetType, toothNumbers: v.toothNumbers, surfaces: v.surfaces });
  }
  if (body.priority !== undefined) set.priority = body.priority;
  if (body.phase !== undefined) set.phase = body.phase;
  if (body.notes !== undefined) set.notes = body.notes.trim();
  if (body.estimatedPrice !== undefined) {
    if (body.estimatedPrice === null) unset.estimatedPrice = 1; else set.estimatedPrice = roundPrice(body.estimatedPrice);
  }
  if (body.sourceDiagnosisIds !== undefined) {
    const srcErr = await checkSourceDiagnoses(req, patient._id, body.sourceDiagnosisIds);
    if (srcErr) return res.status(400).json({ message: srcErr });
    set.sourceDiagnosisIds = [...new Set(body.sourceDiagnosisIds)];
  }
  if (!Object.keys(set).length && !Object.keys(unset).length) return res.json({ item: serializeItem(await populateItem(DentalTreatmentItem.findOne({ _id: item._id })).lean()) });

  // Guarded: only applies while the status is still the one we validated against (a concurrent Start can't be bypassed).
  const update: Record<string, unknown> = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  const updated = await populateItem(
    DentalTreatmentItem.findOneAndUpdate({ _id: item._id, clinicId: req.clinicId, patientId: patient._id, status: item.status }, update, { new: true })
  );
  if (!updated) return res.status(409).json({ message: "This treatment changed while you were editing. Reload and try again.", code: "ITEM_CHANGED" });
  return res.json({ item: serializeItem(updated) });
});

const phasesSchema = z.object({ phases: z.array(z.object({ number: z.number().int().min(1).max(MAX_PHASE), name: z.string().trim().max(60).optional() })).max(MAX_PHASE) });
/** PUT /dental/patients/:patientId/treatment-plan/phases — optional phase names ("Phase 1 — Initial Treatment"). */
export const setPhases = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const { phases } = phasesSchema.parse(req.body);
  if (new Set(phases.map((p) => p.number)).size !== phases.length) return res.status(400).json({ message: "Duplicate phase number" });
  const plan = await getOrCreatePlan(req, patient._id);
  const clean = phases.map((p) => ({ number: p.number, name: p.name || undefined })).sort((a, b) => a.number - b.number);
  await DentalTreatmentPlan.findOneAndUpdate({ _id: plan._id, clinicId: req.clinicId, patientId: patient._id }, { $set: { phases: clean } });
  return res.json({ plan: { phases: clean } });
});

// ------------------------------------------------------------------ lifecycle
const visitBody = z.object({ appointmentId: z.string().min(1), notes: z.string().max(1000).optional() });
const cancelBody = z.object({ reason: z.string().trim().max(300).optional() });

/**
 * POST .../items/:itemId/cancel — planned or in-progress only. Nothing is deleted: the item, its sessions and its
 * status history (with reason / who / when) all stay. Open sessions are closed by the system.
 */
export const cancelItem = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const item = await loadItem(req, res, patient._id);
  if (!item) return;
  const { reason } = cancelBody.parse(req.body ?? {});
  const now = new Date();
  const updated = await populateItem(
    DentalTreatmentItem.findOneAndUpdate(
      { _id: item._id, clinicId: req.clinicId, patientId: patient._id, status: { $in: ["planned", "in_progress"] } },
      { $set: { status: "cancelled", cancelReason: reason || undefined }, $push: { statusHistory: { status: "cancelled", at: now, by: req.userId, note: reason || undefined } } },
      { new: true }
    )
  );
  if (!updated) {
    const cur = await DentalTreatmentItem.findOne({ _id: item._id, clinicId: req.clinicId, patientId: patient._id });
    if (cur?.status === "cancelled") return res.json({ item: serializeItem(await populateItem(DentalTreatmentItem.findOne({ _id: item._id })).lean()), alreadyCancelled: true });
    return res.status(409).json({ message: "A completed treatment can't be cancelled", code: "ITEM_LOCKED" });
  }
  await DentalTreatmentSession.updateMany(
    { itemId: item._id, clinicId: req.clinicId, status: "in_progress" },
    { $set: { status: "completed", autoClosed: true, completedAt: now } }
  );
  return res.json({ item: serializeItem(updated) });
});

/**
 * POST .../items/:itemId/start  { appointmentId }   (also "Continue Treatment" on a later visit)
 *
 * Idempotent per (item, visit): a double click / retry returns the SAME session (unique index + lookup).
 * Order: 1) create the session  2) planned -> in_progress (guarded)  — so a crash between them is repaired by retrying.
 * Starting is NOT completing.
 */
export const startItem = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const item = await loadItem(req, res, patient._id);
  if (!item) return;
  const { appointmentId } = visitBody.parse(req.body);
  const visit = await loadVisit(req, res, patient._id, appointmentId, { requireActive: true });
  if (!visit) return;
  if (item.status !== "planned" && item.status !== "in_progress") {
    return res.status(409).json({ message: "This treatment is already completed or cancelled", code: "ITEM_NOT_STARTABLE" });
  }

  const scope = { clinicId: req.clinicId, patientId: patient._id };
  let session: any = await DentalTreatmentSession.findOne({ ...scope, itemId: item._id, appointmentId: visit._id });
  let created = false;
  for (let attempt = 0; !session && attempt < 4; attempt++) {
    const last: any = await DentalTreatmentSession.findOne({ itemId: item._id }).sort({ sessionNumber: -1 }).select("sessionNumber");
    try {
      session = await DentalTreatmentSession.create({
        ...scope, itemId: item._id, appointmentId: visit._id, sessionNumber: (last?.sessionNumber ?? 0) + 1,
        procedureCode: item.procedureCode, targetType: item.targetType, toothNumbers: item.toothNumbers, surfaces: item.surfaces, // SNAPSHOT
        status: "in_progress", performedBy: req.userId, startedAt: new Date(),
      });
      created = true;
    } catch (err: any) {
      if (err?.code !== 11000) throw err;
      // Lost a race: either the same visit already has its session (double click) or the number was taken.
      session = await DentalTreatmentSession.findOne({ ...scope, itemId: item._id, appointmentId: visit._id });
    }
  }
  if (!session) return res.status(409).json({ message: "Could not start the session, please retry", code: "SESSION_CONFLICT" });

  const now = new Date();
  if (created) {
    // a session from an earlier visit that nobody finished is closed by the system (flagged autoClosed)
    await DentalTreatmentSession.updateMany(
      { itemId: item._id, clinicId: req.clinicId, status: "in_progress", _id: { $ne: session._id } },
      { $set: { status: "completed", autoClosed: true, completedAt: now } }
    );
  }
  await DentalTreatmentItem.findOneAndUpdate(
    { _id: item._id, ...scope, status: "planned" },
    { $set: { status: "in_progress" }, $push: { statusHistory: { status: "in_progress", at: now, by: req.userId, appointmentId: visit._id } } }
  );
  const fresh: any = await populateItem(DentalTreatmentItem.findOne({ _id: item._id, ...scope })).lean();
  if (!fresh || fresh.status !== "in_progress") {
    // cancelled/completed by someone else in the meantime: don't leave a stray session behind
    if (created) await DentalTreatmentSession.deleteOne({ _id: session._id, ...scope });
    return res.status(409).json({ message: "This treatment is no longer available", code: "ITEM_NOT_STARTABLE" });
  }
  const populated: any = await populateSession(DentalTreatmentSession.findOne({ _id: session._id })).lean();
  return res.status(created ? 201 : 200).json({ item: serializeItem(fresh), session: serializeSession(populated, "in_progress"), alreadyStarted: !created });
});

const closeSession = (scope: any, sessionId: unknown, notes: string | undefined, now: Date) =>
  DentalTreatmentSession.findOneAndUpdate(
    { _id: sessionId, ...scope, status: "in_progress" },
    { $set: { status: "completed", completedAt: now, ...(notes !== undefined ? { notes: notes.trim() } : {}) } },
    { new: true }
  );

/**
 * POST .../items/:itemId/finish-session  { appointmentId, notes? }
 * Ends THIS visit's session (e.g. one root-canal appointment) while the treatment stays IN_PROGRESS.
 */
export const finishSession = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const item = await loadItem(req, res, patient._id);
  if (!item) return;
  const { appointmentId, notes } = visitBody.parse(req.body);
  const visit = await loadVisit(req, res, patient._id, appointmentId, { requireActive: false });
  if (!visit) return;
  const scope = { clinicId: req.clinicId, patientId: patient._id };
  const session: any = await DentalTreatmentSession.findOne({ ...scope, itemId: item._id, appointmentId: visit._id });
  if (!session) return res.status(409).json({ message: "Start the treatment in this visit first", code: "NO_SESSION_IN_VISIT" });
  const closed = await closeSession(scope, session._id, notes, new Date());
  const out: any = await populateSession(DentalTreatmentSession.findOne({ _id: session._id })).lean();
  return res.json({ session: serializeSession(out, item.status), alreadyFinished: !closed });
});

/**
 * POST .../items/:itemId/complete  { appointmentId, notes? }
 * Needs a session in THIS visit (Start / Continue first). Order: 1) close the session  2) in_progress -> completed
 * (guarded). A double click / retry finds the item already completed and returns it WITHOUT a second history entry.
 */
export const completeItem = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const item = await loadItem(req, res, patient._id);
  if (!item) return;
  const { appointmentId, notes } = visitBody.parse(req.body);
  const visit = await loadVisit(req, res, patient._id, appointmentId, { requireActive: false });
  if (!visit) return;
  const scope = { clinicId: req.clinicId, patientId: patient._id };
  const respondDone = async (alreadyCompleted: boolean) => {
    const [it, se]: any[] = await Promise.all([
      populateItem(DentalTreatmentItem.findOne({ _id: item._id, ...scope })).lean(),
      populateSession(DentalTreatmentSession.findOne({ ...scope, itemId: item._id, appointmentId: visit._id })).lean(),
    ]);
    return res.json({ item: serializeItem(it), session: se ? serializeSession(se, it.status) : null, alreadyCompleted });
  };

  if (item.status === "completed") return respondDone(true);
  if (item.status !== "in_progress") return res.status(409).json({ message: "Start the treatment before completing it", code: "ITEM_NOT_IN_PROGRESS" });
  const session: any = await DentalTreatmentSession.findOne({ ...scope, itemId: item._id, appointmentId: visit._id });
  if (!session) return res.status(409).json({ message: "Start or continue the treatment in this visit first", code: "NO_SESSION_IN_VISIT" });

  const now = new Date();
  await closeSession(scope, session._id, notes, now); // no-op if already closed
  const done = await DentalTreatmentItem.findOneAndUpdate(
    { _id: item._id, ...scope, status: "in_progress" },
    { $set: { status: "completed" }, $push: { statusHistory: { status: "completed", at: now, by: req.userId, appointmentId: visit._id } } },
    { new: true }
  );
  if (!done) {
    const cur = await DentalTreatmentItem.findOne({ _id: item._id, ...scope });
    if (cur?.status === "completed") return respondDone(true); // the other click won
    return res.status(409).json({ message: "This treatment is no longer in progress", code: "ITEM_NOT_IN_PROGRESS" });
  }
  return respondDone(false);
});

const notesBody = z.object({ notes: z.string().max(1000) });
/** PUT /dental/patients/:patientId/treatment-sessions/:sessionId/notes — session notes, while the session is open. */
export const updateSessionNotes = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const id = oid(req.params.sessionId);
  const { notes } = notesBody.parse(req.body);
  const updated = id
    ? await DentalTreatmentSession.findOneAndUpdate({ _id: id, clinicId: req.clinicId, patientId: patient._id, status: "in_progress" }, { $set: { notes: notes.trim() } }, { new: true })
    : null;
  if (!updated) {
    const exists = id ? await DentalTreatmentSession.findOne({ _id: id, clinicId: req.clinicId, patientId: patient._id }) : null;
    return exists ? res.status(409).json({ message: "This session is already finished", code: "SESSION_CLOSED" }) : res.status(404).json({ message: "Session not found" });
  }
  const out: any = await populateSession(DentalTreatmentSession.findOne({ _id: id })).lean();
  return res.json({ session: serializeSession(out) });
});
