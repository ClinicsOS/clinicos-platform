import { Request, Response } from "express";
import { z } from "zod";
import { Patient } from "../models/Patient";
import { asyncHandler } from "../middleware/errorHandler";
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

/** Escapes user input so it can be used safely inside a RegExp. */
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

// ===================================================================
// Handlers
// ===================================================================

export const createPatient = asyncHandler(async (req: Request, res: Response) => {
  const data = createPatientSchema.parse(req.body);
  const { set } = buildPatientWrite(data);

  if (await phoneTaken(req.clinicId, data.phone)) {
    return res.status(409).json({ message: DUPLICATE_PHONE_MSG });
  }

  const count = await Patient.countDocuments({ clinicId: req.clinicId });

  try {
    const patient = await Patient.create({
      ...set,
      clinicId: req.clinicId,
      fileNumber: count + 1,
    });
    return res.status(201).json(patient);
  } catch (err) {
    if (isDuplicatePhone(err)) return res.status(409).json({ message: DUPLICATE_PHONE_MSG });
    throw err;
  }
});

/**
 * PATCH /api/patients/:id
 * NEW — edit a patient file after it was created. Only the fields sent in
 * the body are changed; sending "" for a field clears it.
 */
export const updatePatient = asyncHandler(async (req: Request, res: Response) => {
  const data = updatePatientSchema.parse(req.body);
  const { set, unset } = buildPatientWrite(data);

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

  const filter: Record<string, any> = {
    clinicId: req.clinicId,
    isArchived: false,
  };

  if (search) {
    // Escaped so characters like "(" or "+" can't crash the query.
    const rx = new RegExp(escapeRegex(search), "i");
    const or: Record<string, unknown>[] = [{ fullName: rx }, { phone: rx }, { email: rx }];
    // Phone numbers are often stored with spaces ("079 123 4567") — match
    // the digits even when the user types them without spaces.
    const digits = search.replace(/\D/g, "");
    if (digits.length >= 3) or.push({ phone: new RegExp(digits.split("").join("\\D*")) });
    filter.$or = or;
  }

  const [patients, total] = await Promise.all([
    Patient.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Patient.countDocuments(filter),
  ]);

  return res.json({ patients, total, page, pages: Math.ceil(total / limit) });
});

export const getPatient = asyncHandler(async (req: Request, res: Response) => {
  const patient = await Patient.findOne({
    _id: req.params.id,
    clinicId: req.clinicId,
  });
  if (!patient) return res.status(404).json({ message: "Patient not found" });
  return res.json(patient);
});
