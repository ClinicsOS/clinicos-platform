import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { User } from "../models/User";
import { Patient } from "../models/Patient";
import { MAX_SELECTED_PATIENTS } from "../models/DoctorDelegation";
import { PolicyError, canManageClinic, isOid } from "../auth/policy";
import { logActivity } from "../services/activityLogger";
import { patientSearchFilter } from "../services/patientSearch";
import { addDaysYmd, clinicLocalToUtc, isValidYmd } from "../utils/timezone";
import { assignPrimary, createDelegation, listDelegations, primaryPatientIds, removePrimary, revokeDelegation } from "../services/patientAccess";

/**
 * PHASE 1 (multi-doctor patient isolation) — /api/patient-access
 *
 *   GET  /delegations?status=active|scheduled|expired|revoked|all   owner: every coverage of the clinic · doctor: only the ones he gives or receives
 *   POST /delegations                                              owner: Dr A covers Dr B's patients (all, or selected), until revoked or until a date
 *   POST /delegations/:id/revoke                                   owner: switches the coverage off immediately
 *   GET  /doctors/:doctorId/patients?search=&page=                 owner: a doctor's primary patients (to pick "selected" ones / review)
 *   POST /assign   { patientId, doctorId }                          owner: make a doctor a primary doctor of a patient (unassigned patients, hand-over)
 *   POST /unassign { patientId, doctorId }                          owner: take that primary link away (the patient file itself is untouched)
 *
 * Writes are owner-only (canManageClinic) and need an active plan; reads are owner + doctor (the front desk has no use for them). The clinic
 * comes from the signed-in user, every id is looked up INSIDE that clinic, and a doctor / patient of another clinic is "not found".
 * Audit rows carry ids only — no names, phones or clinical content.
 */

const PAGE = 20;
const ymdOrIso = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().datetime({ offset: true })]).nullable().optional();

/** A date-only value is a clinic-local calendar day: a start means 00:00 of that day, an end is INCLUSIVE (until the end of that day). */
function parseWhen(v: string | null | undefined, edge: "start" | "end"): Date | null {
  if (v == null || v === "") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    if (!isValidYmd(v)) throw new PolicyError(400, "INVALID_PERIOD", "Invalid date");
    return clinicLocalToUtc(edge === "start" ? v : addDaysYmd(v, 1), "00:00");
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new PolicyError(400, "INVALID_PERIOD", "Invalid date");
  return d;
}

const requireManager = (req: Request) => {
  if (!canManageClinic(req.role)) throw new PolicyError(403, "FORBIDDEN_ROLE", "Forbidden");
};
const requireReader = (req: Request) => {
  if (req.role !== "owner" && req.role !== "doctor") throw new PolicyError(403, "FORBIDDEN_ROLE", "Forbidden");
};

async function audit(req: Request, action: string, details: Record<string, unknown>) {
  const actor = await User.findById(req.userId).select("email").lean();
  await logActivity({
    action,
    actorEmail: actor?.email || "unknown",
    targetType: "clinic",
    targetId: req.clinicId as string,
    details: { ...details, actorType: "clinic_user", actorUserId: req.userId, actorRole: req.role },
  });
}

const listQuery = z.object({ status: z.enum(["active", "scheduled", "expired", "revoked", "all"]).default("all") });

export const getDelegations = asyncHandler(async (req: Request, res: Response) => {
  requireReader(req);
  const q = listQuery.parse(req.query);
  const delegations = await listDelegations(req.clinicId as string, {
    status: q.status,
    involvingDoctorId: req.role === "doctor" ? (req.userId as string) : undefined,
  });
  return res.json({ delegations, canManage: canManageClinic(req.role) });
});

const createSchema = z
  .object({
    fromDoctorId: z.string().regex(/^[a-fA-F0-9]{24}$/),
    toDoctorId: z.string().regex(/^[a-fA-F0-9]{24}$/),
    scope: z.enum(["all", "selected"]),
    patientIds: z.array(z.string().regex(/^[a-fA-F0-9]{24}$/)).max(MAX_SELECTED_PATIENTS).optional(),
    startsAt: ymdOrIso,
    expiresAt: ymdOrIso,
    note: z.string().trim().max(200).optional(),
  })
  .strict();

export const postDelegation = asyncHandler(async (req: Request, res: Response) => {
  requireManager(req);
  const body = createSchema.parse(req.body);
  const { delegation, granted, alreadyPrimary } = await createDelegation(req.clinicId as string, req.userId as string, {
    fromDoctorId: body.fromDoctorId,
    toDoctorId: body.toDoctorId,
    scope: body.scope,
    patientIds: body.patientIds,
    startsAt: parseWhen(body.startsAt, "start"),
    expiresAt: parseWhen(body.expiresAt, "end"),
    note: body.note || undefined,
  });
  await audit(req, "patient_access.delegation_created", {
    delegationId: String(delegation._id),
    fromDoctorId: body.fromDoctorId,
    toDoctorId: body.toDoctorId,
    scope: body.scope,
    patients: granted + alreadyPrimary,
    startsAt: delegation.startsAt ?? null,
    expiresAt: delegation.expiresAt ?? null,
  });
  const [dto] = (await listDelegations(req.clinicId as string, { status: "all", limit: 500 })).filter((d) => d._id === String(delegation._id));
  return res.status(201).json({ delegation: dto ?? null, granted, alreadyPrimary, message: "Coverage created" });
});

export const postRevokeDelegation = asyncHandler(async (req: Request, res: Response) => {
  requireManager(req);
  const del = await revokeDelegation(req.clinicId as string, req.params.id, req.userId as string);
  await audit(req, "patient_access.delegation_revoked", { delegationId: String(del._id), fromDoctorId: String(del.fromDoctorId), toDoctorId: String(del.toDoctorId) });
  return res.json({ ok: true, message: "Coverage revoked" });
});

export const getDoctorPatients = asyncHandler(async (req: Request, res: Response) => {
  requireManager(req);
  const clinicId = req.clinicId as string;
  const doctorId = req.params.doctorId;
  if (!isOid(doctorId) || !(await User.exists({ _id: doctorId, clinicId, role: "doctor" }))) throw new PolicyError(404, "DOCTOR_NOT_FOUND", "Doctor not found");
  const page = Math.max(1, Number(req.query.page) || 1);
  const filter = patientSearchFilter(clinicId, String(req.query.search || ""), { fileNumber: true });
  filter._id = { $in: await primaryPatientIds(clinicId, doctorId) };
  const [rows, total] = await Promise.all([
    Patient.find(filter).select("fullName phone fileNumber").sort({ fullName: 1, _id: 1 }).skip((page - 1) * PAGE).limit(PAGE).lean(),
    Patient.countDocuments(filter),
  ]);
  return res.json({
    patients: rows.map((p) => ({ _id: String(p._id), fullName: p.fullName, phone: p.phone, fileNumber: p.fileNumber })),
    total,
    page,
    pages: Math.ceil(total / PAGE),
  });
});

const linkSchema = z.object({ patientId: z.string().regex(/^[a-fA-F0-9]{24}$/), doctorId: z.string().regex(/^[a-fA-F0-9]{24}$/) }).strict();

export const postAssign = asyncHandler(async (req: Request, res: Response) => {
  requireManager(req);
  const b = linkSchema.parse(req.body);
  await assignPrimary(req.clinicId as string, b.patientId, b.doctorId, req.userId as string);
  await audit(req, "patient_access.assigned", { patientId: b.patientId, doctorId: b.doctorId });
  return res.json({ ok: true, message: "Patient assigned" });
});

export const postUnassign = asyncHandler(async (req: Request, res: Response) => {
  requireManager(req);
  const b = linkSchema.parse(req.body);
  const clinicId = req.clinicId as string;
  // both ids must belong to this clinic (otherwise "not found" — a foreign id is indistinguishable from a missing one)
  const [p, d] = await Promise.all([Patient.exists({ _id: b.patientId, clinicId }), User.exists({ _id: b.doctorId, clinicId, role: "doctor" })]);
  if (!p) throw new PolicyError(404, "PATIENT_NOT_FOUND", "Patient not found");
  if (!d) throw new PolicyError(404, "DOCTOR_NOT_FOUND", "Doctor not found");
  const removed = await removePrimary(clinicId, b.patientId, b.doctorId, req.userId as string);
  if (removed) await audit(req, "patient_access.unassigned", { patientId: b.patientId, doctorId: b.doctorId });
  return res.json({ ok: true, removed, message: removed ? "Patient unassigned" : "Nothing to change" });
});
