import { Request, Response } from "express";
import { z } from "zod";
import { Patient } from "../models/Patient";
import { asyncHandler } from "../middleware/errorHandler";

const createPatientSchema = z.object({
  fullName: z.string().min(2).max(100),
  phone: z.string().min(7).max(20),
  email: z.string().email().optional().or(z.literal("")),
  gender: z.enum(["male", "female"]).optional(),
  birthDate: z.string().optional(),
  medicalNotes: z.string().max(1000).optional(),
});

export const createPatient = asyncHandler(async (req: Request, res: Response) => {
  const data = createPatientSchema.parse(req.body);

  const count = await Patient.countDocuments({ clinicId: req.clinicId });

  const patient = await Patient.create({
    ...data,
    email: data.email || undefined,
    birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
    clinicId: req.clinicId,
    fileNumber: count + 1,
  });

  return res.status(201).json(patient);
});

export const listPatients = asyncHandler(async (req: Request, res: Response) => {
  const search = String(req.query.search || "").trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 20;

  const filter: Record<string, any> = {
    clinicId: req.clinicId,
    isArchived: false,
  };

  if (search) {
    filter.$or = [
      { fullName: { $regex: search, $options: "i" } },
      { phone: { $regex: search } },
      { email: { $regex: search, $options: "i" } },
    ];
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
