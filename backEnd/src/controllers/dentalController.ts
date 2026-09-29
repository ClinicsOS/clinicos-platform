import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { Patient } from "../models/Patient";
import { DentalRecord, type IDentalRecord } from "../models/DentalRecord";
import { DentalToothEvent } from "../models/DentalToothEvent";
import { DentalTreatmentItem } from "../models/DentalTreatmentItem";
import { DentalTreatmentSession } from "../models/DentalTreatmentSession";
import { buildTimeline } from "../utils/dentalTimeline";
import {
  ALL_FDI,
  DENTITION_TYPES,
  TAXONOMY_VERSION,
  validateEventInput,
  validateCurrentTeeth,
  type EventCategory,
} from "../config/dental";

/**
 * SECURITY MODEL (every handler follows it):
 *  1. `protect` authenticated the user and set req.clinicId from the USER DOCUMENT.
 *  2. `requireSpecialty("dentistry")` verified the clinic's stored specialty (router-level).
 *  3. `loadPatient` re-verifies the patient belongs to req.clinicId — the patientId in the
 *     URL is never trusted on its own.
 *  4. Every Dental query below includes clinicId AND patientId.
 * clinicId / specialty are never read from the request body or URL.
 */

export const loadPatient = async (req: Request, res: Response) => {
  const { patientId } = req.params;
  if (!mongoose.isValidObjectId(patientId)) {
    res.status(404).json({ message: "Patient not found" });
    return null;
  }
  const patient = await Patient.findOne({ _id: patientId, clinicId: req.clinicId }).select("_id");
  if (!patient) {
    // Same response for "doesn't exist" and "belongs to another clinic" — no tenant probing.
    res.status(404).json({ message: "Patient not found" });
    return null;
  }
  return patient;
};

/** Race-safe get-or-create (unique index on clinicId+patientId backs this up). */
export const getOrCreateRecord = async (req: Request, patientId: unknown): Promise<IDentalRecord> => {
  const filter = { clinicId: req.clinicId, patientId };
  const create = () =>
    DentalRecord.findOneAndUpdate(
      filter,
      { $setOnInsert: { ...filter, dentitionType: "permanent", createdBy: req.userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  try {
    return (await create())!;
  } catch (err: any) {
    if (err?.code === 11000) return (await DentalRecord.findOne(filter))!; // lost the race
    throw err;
  }
};

export const serializeEvent = (e: any) => ({
  _id: String(e._id),
  fdi: e.fdi,
  dentitionType: e.dentitionType,
  category: e.category,
  code: e.code,
  surfaces: e.surfaces ?? [],
  note: e.note ?? undefined,
  status: e.status,
  createdAt: e.createdAt,
  createdBy: e.createdBy && e.createdBy._id ? { _id: String(e.createdBy._id), name: e.createdBy.name } : null,
  resolution: e.resolution?.reason
    ? {
        at: e.resolution.at,
        reason: e.resolution.reason,
        note: e.resolution.note ?? undefined,
        by: e.resolution.by && e.resolution.by._id ? { _id: String(e.resolution.by._id), name: e.resolution.by.name } : null,
      }
    : undefined,
});

export const serializeRecord = (r: IDentalRecord | null) => ({
  exists: !!r,
  dentitionType: r?.dentitionType ?? "permanent",
  currentTeeth: r?.currentTeeth && r.currentTeeth.length ? r.currentTeeth : null,
  dentitionLog: (r?.dentitionLog ?? []).map((l) => ({ from: l.from, to: l.to, changedAt: l.changedAt })),
});

export const populateEvents = (q: any) => q.populate("createdBy", "name").populate("resolution.by", "name");

/** GET /dental/patients/:patientId/record — record settings + full event history. */
export const getRecord = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const scope = { clinicId: req.clinicId, patientId: patient._id };
  const [record, events] = await Promise.all([
    DentalRecord.findOne(scope),
    populateEvents(DentalToothEvent.find(scope).sort({ createdAt: -1 }).limit(2000)).lean(),
  ]);
  return res.json({ record: serializeRecord(record), events: (events as any[]).map(serializeEvent) });
});

/** GET /dental/patients/:patientId/teeth/:fdi/history */
export const getToothHistory = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  // History of ANY known FDI code is readable regardless of current dentition (preserves primary history).
  if (!ALL_FDI.has(req.params.fdi)) return res.status(400).json({ message: "Invalid FDI tooth code" });
  const events = await populateEvents(
    DentalToothEvent.find({ clinicId: req.clinicId, patientId: patient._id, fdi: req.params.fdi }).sort({ createdAt: -1 })
  ).lean();
  // Treatment history for this tooth (plan created / started / sessions / completed / cancelled), derived from the
  // treatment items + sessions that target this FDI — same source of truth as the Treatment Plan page.
  const scope = { clinicId: req.clinicId, patientId: patient._id };
  const items = (await DentalTreatmentItem.find({ ...scope, toothNumbers: req.params.fdi }).populate("createdBy", "name").populate("statusHistory.by", "name").populate("billingHistory.by", "name").lean()) as any[];
  const sessions = items.length
    ? ((await DentalTreatmentSession.find({ ...scope, itemId: { $in: items.map((i) => i._id) } }).populate("performedBy", "name").lean()) as any[])
    : [];
  return res.json({ fdi: req.params.fdi, events: (events as any[]).map(serializeEvent), treatment: buildTimeline(items, sessions) });
});

const dentitionSchema = z.object({ dentitionType: z.enum(DENTITION_TYPES) });

/** PUT /dental/patients/:patientId/dentition — a doctor's decision; never touches existing events. */
export const setDentition = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const { dentitionType } = dentitionSchema.parse(req.body);
  const record = await getOrCreateRecord(req, patient._id);
  if (record.dentitionType === dentitionType) return res.json({ record: serializeRecord(record) });
  const updated = await DentalRecord.findOneAndUpdate(
    { _id: record._id, clinicId: req.clinicId, patientId: patient._id },
    {
      $set: { dentitionType },
      $push: { dentitionLog: { from: record.dentitionType, to: dentitionType, changedAt: new Date(), changedBy: req.userId } },
    },
    { new: true }
  );
  return res.json({ record: serializeRecord(updated) });
});

const currentTeethSchema = z.object({ teeth: z.array(z.string()).min(1).max(52) });

/**
 * PUT /dental/patients/:patientId/current-teeth — mixed dentition only. Chooses which teeth the chart
 * DISPLAYS. Never touches clinical events (history of every FDI is preserved).
 */
export const setCurrentTeeth = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const { teeth } = currentTeethSchema.parse(req.body);
  const record = await getOrCreateRecord(req, patient._id);
  if (record.dentitionType !== "mixed") {
    return res.status(409).json({ message: "The current teeth can only be chosen for a mixed dentition" });
  }
  const v = validateCurrentTeeth(teeth);
  if (!v.ok) return res.status(400).json({ message: v.message });
  const updated = await DentalRecord.findOneAndUpdate(
    { _id: record._id, clinicId: req.clinicId, patientId: patient._id },
    { $set: { currentTeeth: v.teeth } },
    { new: true }
  );
  return res.json({ record: serializeRecord(updated) });
});

const eventBodySchema = z.object({
  code: z.string().min(1).max(60),
  surfaces: z.array(z.string()).max(10).optional(),
  note: z.string().max(500).optional(),
});

const addEvent = (category: EventCategory) =>
  asyncHandler(async (req: Request, res: Response) => {
    const patient = await loadPatient(req, res);
    if (!patient) return;
    const body = eventBodySchema.parse(req.body);
    const record = await getOrCreateRecord(req, patient._id);
    const fdi = req.params.fdi;

    const v = validateEventInput(category, body, fdi, record.dentitionType);
    if (!v.ok) return res.status(400).json({ message: v.message });

    // Guard against double-submits: same active fact on the same tooth -> 409.
    const scope = { clinicId: req.clinicId, patientId: patient._id, fdi, category, code: v.code, status: "active" };
    const existing = await DentalToothEvent.find(scope).select("surfaces").lean();
    const dup = existing.some(
      (e: any) => e.surfaces.length === v.surfaces.length && v.surfaces.every((s) => e.surfaces.includes(s))
    );
    if (dup) return res.status(409).json({ message: "This entry is already recorded for this tooth" });

    const created = await DentalToothEvent.create({
      clinicId: req.clinicId,
      patientId: patient._id,
      dentalRecordId: record._id,
      fdi,
      dentitionType: record.dentitionType,
      category,
      code: v.code,
      surfaces: v.surfaces,
      note: v.note,
      status: "active",
      taxonomyVersion: TAXONOMY_VERSION,
      createdBy: req.userId,
    });
    await created.populate("createdBy", "name");
    return res.status(201).json({ event: serializeEvent(created) });
  });

export const addExistingCondition = addEvent("existing_condition");
export const addDiagnosis = addEvent("diagnosis");

const resolveSchema = z.object({
  reason: z.enum(["resolved", "entered_in_error"]),
  note: z.string().max(500).optional(),
});

/**
 * POST /dental/patients/:patientId/events/:eventId/resolve
 * The ONLY mutation of an existing entry: active -> resolved, with reason/who/when.
 * Nothing is deleted or rewritten, so history stays fully traceable.
 */
export const resolveEvent = asyncHandler(async (req: Request, res: Response) => {
  const patient = await loadPatient(req, res);
  if (!patient) return;
  const { eventId } = req.params;
  if (!mongoose.isValidObjectId(eventId)) return res.status(404).json({ message: "Entry not found" });
  const body = resolveSchema.parse(req.body);
  const updated = await populateEvents(
    DentalToothEvent.findOneAndUpdate(
      { _id: eventId, clinicId: req.clinicId, patientId: patient._id, status: "active" },
      { $set: { status: "resolved", resolution: { at: new Date(), by: req.userId, reason: body.reason, note: body.note?.trim() || undefined } } },
      { new: true }
    )
  );
  if (!updated) return res.status(404).json({ message: "Active entry not found" });
  return res.json({ event: serializeEvent(updated) });
});
