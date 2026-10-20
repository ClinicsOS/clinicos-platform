import { Request, Response } from "express";
import { z } from "zod";
import { Patient } from "../models/Patient";
import { nextNumber, retryPause, NUMBER_ATTEMPTS } from "../services/numbering";
import { asyncHandler } from "../middleware/errorHandler";
import { patientSearchFilter } from "../services/patientSearch";
import { PatientDoctorAccess } from "../models/PatientDoctorAccess";
import { activeAccessFilter, accessiblePatientIdsByKind, canAccessPatient, describeAccess, viewerOf } from "../auth/patientAccess";
import { isOid } from "../auth/policy";
import { grantNewPatientAccess } from "../services/patientAccess";
import {
  MEDICAL_KEYS,
  BLOOD_TYPES,
  MARITAL_STATUSES,
  REFERRAL_SOURCES,
  type MedicalHistory,
} from "../config/medicalHistory";

// ===================================================================
// Validation
// ===================================================================

const optText = (max: number) => z.string().trim().max(max).optional();

const medicalFlagSchema = z.object({
  has: z.boolean(),
  details: z.string().trim().max(500).optional(),
});

// Keys are validated against the shared MEDICAL_KEYS list — unknown
// questions are rejected instead of silently stored.
const medicalHistorySchema = z.record(z.enum(MEDICAL_KEYS), medicalFlagSchema);

const birthDateSchema = z
  .string()
  .optional()
  .refine(
    (v) => {
      if (v === undefined || v === "") return true;
      const d = new Date(v);
      return !Number.isNaN(d.getTime()) && d.getTime() <= Date.now();
    },
    { message: "Invalid birth date" }
  );

const patientFields = {
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(7).max(20),
  email: z.string().trim().email().or(z.literal("")).optional(),
  gender: z.enum(["male", "female"]).or(z.literal("")).optional(),
  birthDate: birthDateSchema,
  medicalNotes: z.string().max(2000).optional(),
  whatsappOptIn: z.boolean().optional(),

  nationalId: optText(30),
  address: optText(200),
  occupation: optText(100),
  maritalStatus: z.enum(MARITAL_STATUSES).or(z.literal("")).optional(),
  bloodType: z.enum(BLOOD_TYPES).or(z.literal("")).optional(),
  referralSource: z.enum(REFERRAL_SOURCES).or(z.literal("")).optional(),
  emergencyContact: z
    .object({ name: optText(100), relation: optText(50), phone: optText(20) })
    .optional(),
  insurance: z.object({ provider: optText(100), policyNumber: optText(60) }).optional(),
  medicalHistory: medicalHistorySchema.optional(),
};

const createPatientSchema = z.object(patientFields);
// PATCH: every field optional — only what's sent gets changed.
const updatePatientSchema = z.object(patientFields).partial();

type PatientPayload = z.infer<typeof updatePatientSchema>;

// ===================================================================
// Helpers
// ===================================================================

/** Drops empty strings from a small nested object; returns undefined if nothing is left. */
function cleanNested<T extends Record<string, string | undefined>>(obj: T): Partial<T> | undefined {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && v.trim() !== "") (out as Record<string, string>)[k] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Normalises the medical checklist:
 *  - details are only kept when the checkbox is on
 *  - pregnancy / breastfeeding are dropped for male patients
 */
function cleanMedical(history: MedicalHistory, gender?: string): MedicalHistory {
  const out: MedicalHistory = {};
  for (const key of MEDICAL_KEYS) {
    const flag = history[key];
    if (!flag) continue;
    if (gender === "male" && (key === "pregnant" || key === "breastfeeding")) continue;
    const details = flag.has && flag.details ? flag.details.trim() : "";
    out[key] = details ? { has: flag.has, details } : { has: flag.has };
  }
  return out;
}

/**
 * Turns a validated payload into Mongo $set / $unset maps.
 * An empty string ("") means "clear this field".
 */
function buildPatientWrite(data: PatientPayload) {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};

  const put = (key: string, value: unknown) => {
    if (value === undefined) return;
    if (value === "" || value === null) unset[key] = "";
    else set[key] = value;
  };

  put("fullName", data.fullName);
  put("phone", data.phone);
  put("email", data.email);
  put("gender", data.gender);
  put("medicalNotes", data.medicalNotes?.trim());
  put("nationalId", data.nationalId);
  put("address", data.address);
  put("occupation", data.occupation);
  put("maritalStatus", data.maritalStatus);
  put("bloodType", data.bloodType);
  put("referralSource", data.referralSource);
  if (data.whatsappOptIn !== undefined) set.whatsappOptIn = data.whatsappOptIn;

  if (data.birthDate !== undefined) {
    if (data.birthDate === "") unset.birthDate = "";
    else set.birthDate = new Date(data.birthDate);
  }

  if (data.emergencyContact !== undefined) {
    const ec = cleanNested(data.emergencyContact);
    if (ec) set.emergencyContact = ec;
    else unset.emergencyContact = "";
  }

  if (data.insurance !== undefined) {
    const ins = cleanNested(data.insurance);
    if (ins) set.insurance = ins;
    else unset.insurance = "";
  }

  if (data.medicalHistory !== undefined) {
    set.medicalHistory = cleanMedical(data.medicalHistory, data.gender);
    set.medicalUpdatedAt = new Date();
  }

  return { set, unset };
}

/** Mongo's duplicate-key error on the (clinicId, phone) unique index. */
const isDuplicatePhone = (err: unknown) => {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: number; keyPattern?: unknown; keyValue?: unknown; message?: string };
  if (e.code !== 11000) return false;
  return JSON.stringify([e.keyPattern ?? {}, e.keyValue ?? {}, e.message ?? ""]).includes("phone");
};

/** Friendly check before writing, so staff get a clear message instead of a generic error. */
const phoneTaken = async (clinicId: string | undefined, phone: string, exceptId?: string) => {
  const filter: Record<string, unknown> = { clinicId, phone };
  if (exceptId) filter._id = { $ne: exceptId };
  return !!(await Patient.exists(filter));
};

const DUPLICATE_PHONE_MSG = "A patient with this phone number already exists in your clinic";

/**
 * PHASE 1 — every handler that takes a patient id goes through this ONE guard (auth/patientAccess.ts: canAccessPatient).
 * A well-formed id the caller may not open — another doctor's patient, another clinic's, an unknown one — gets the same 404
 * "Patient not found" (no existence oracle). A malformed id keeps its historical 400 (the query below raises a CastError for it).
 */
const guardPatient = async (req: Request, res: Response): Promise<boolean> => {
  const id = req.params.id;
  if (!isOid(id)) return true;
  if (await canAccessPatient(viewerOf(req), id)) return true;
  res.status(404).json({ message: "Patient not found" });
  return false;
};

// ===================================================================
// Handlers
// ===================================================================

export const createPatient = asyncHandler(async (req: Request, res: Response) => {
  const data = createPatientSchema.parse(req.body);
  const { set } = buildPatientWrite(data);

  if (await phoneTaken(req.clinicId, data.phone)) {
    return res.status(409).json({ message: DUPLICATE_PHONE_MSG });
  }

  // fileNumber is clinic-unique (index). Two receptionists registering at the same moment compute the same count; PHASE 7: the one
  // that loses on THAT index recounts and retries instead of failing with a confusing "duplicate" error. A duplicate PHONE still
  // answers 409 with the friendly message.
  for (let attempt = 0; attempt < NUMBER_ATTEMPTS; attempt++) {
    await retryPause(attempt);
    const next = await nextNumber(Patient, req.clinicId, "fileNumber");
    try {
      const patient = await Patient.create({
        ...set,
        clinicId: req.clinicId,
        fileNumber: next,
      });
      // PHASE 1 — a doctor owns the files he registers; for the front desk / owner the clinic's only active doctor (if exactly one)
      // gets the patient, otherwise the patient is unassigned (owner / front desk see him; the owner assigns a doctor).
      await grantNewPatientAccess(req.clinicId, patient._id, { userId: req.userId, role: req.role });
      return res.status(201).json(patient);
    } catch (err) {
      if (isDuplicatePhone(err)) return res.status(409).json({ message: DUPLICATE_PHONE_MSG });
      if ((err as { code?: number })?.code !== 11000) throw err;
    }
  }
  return res.status(409).json({ message: "Could not register the patient, please try again", code: "PATIENT_CREATE_FAILED" });
});

/**
 * PATCH /api/patients/:id
 * NEW — edit a patient file after it was created. Only the fields sent in
 * the body are changed; sending "" for a field clears it.
 */
export const updatePatient = asyncHandler(async (req: Request, res: Response) => {
  const data = updatePatientSchema.parse(req.body);
  const { set, unset } = buildPatientWrite(data);
  if (!(await guardPatient(req, res))) return;

  const filter = { _id: req.params.id, clinicId: req.clinicId };

  const update: Record<string, Record<string, unknown>> = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;

  // Nothing to change — just return the current document.
  if (!update.$set && !update.$unset) {
    const current = await Patient.findOne(filter);
    if (!current) return res.status(404).json({ message: "Patient not found" });
    return res.json(current);
  }

  if (data.phone && (await phoneTaken(req.clinicId, data.phone, req.params.id))) {
    return res.status(409).json({ message: DUPLICATE_PHONE_MSG });
  }

  try {
    const patient = await Patient.findOneAndUpdate(filter, update, {
      new: true,
      runValidators: true,
    });
    if (!patient) return res.status(404).json({ message: "Patient not found" });
    return res.json(patient);
  } catch (err) {
    if (isDuplicatePhone(err)) return res.status(409).json({ message: DUPLICATE_PHONE_MSG });
    throw err;
  }
});

export const listPatients = asyncHandler(async (req: Request, res: Response) => {
  const search = String(req.query.search || "").trim().slice(0, 60);
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 20;
  const viewer = viewerOf(req);

  const filter = patientSearchFilter(req.clinicId, search);

  // PHASE 1 — the list and the search obey the SAME scope as opening a file: a doctor sees (and can find by name / phone) only his
  // own patients and the ones he currently covers; the owner and the front desk see the whole clinic. This is a server-side filter on
  // the query itself, so a patient outside the scope never reaches the response — not in the page, not in the count.
  const kinds = await accessiblePatientIdsByKind(viewer);
  if (kinds) {
    // ?scope=mine | delegated | all (default all = both)
    const scope = String(req.query.scope || "all");
    const ids = scope === "mine" ? kinds.own : scope === "delegated" ? kinds.delegated : [...kinds.own, ...kinds.delegated];
    filter._id = { $in: ids };
  } else if (req.query.doctorId) {
    // owner / front desk: ?doctorId=<id> (that doctor's primary patients) or ?doctorId=unassigned (patients nobody is linked to)
    const raw = String(req.query.doctorId);
    const rows = (await PatientDoctorAccess.find({
      clinicId: req.clinicId,
      accessType: "primary",
      ...activeAccessFilter(),
      ...(raw === "unassigned" ? {} : { doctorId: isOid(raw) ? raw : "000000000000000000000000" }),
    })
      .select("patientId")
      .lean()) as { patientId: unknown }[];
    filter._id = raw === "unassigned" ? { $nin: rows.map((r) => r.patientId) } : { $in: rows.map((r) => r.patientId) };
  }

  const [patients, total] = await Promise.all([
    Patient.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Patient.countDocuments(filter),
  ]);

  const info = await describeAccess(viewer, patients.map((p) => p._id));
  return res.json({
    // documents (not lean objects) so schema defaults such as whatsappOptIn / isArchived still apply to legacy patients
    patients: patients.map((p) => ({ ...p.toObject(), access: info.get(String(p._id)) ?? null })),
    total,
    page,
    pages: Math.ceil(total / limit),
  });
});

export const getPatient = asyncHandler(async (req: Request, res: Response) => {
  if (!(await guardPatient(req, res))) return;
  const patient = await Patient.findOne({
    _id: req.params.id,
    clinicId: req.clinicId,
  });
  if (!patient) return res.status(404).json({ message: "Patient not found" });
  const info = await describeAccess(viewerOf(req), [patient._id]);
  return res.json({ ...patient.toObject(), access: info.get(String(patient._id)) ?? null });
});
