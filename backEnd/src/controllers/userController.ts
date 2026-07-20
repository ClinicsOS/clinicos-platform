import { Request, Response } from "express";
import { z } from "zod";
import { User } from "../models/User";
import { Clinic } from "../models/Clinic";
import { asyncHandler } from "../middleware/errorHandler";
import { PLANS, type Plan } from "../config/plans";

const createStaffSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(6).max(100),
  role: z.enum(["doctor", "receptionist"]),
  phone: z.string().optional(),
});

export const createStaff = asyncHandler(async (req: Request, res: Response) => {
  const data = createStaffSchema.parse(req.body);

  // Enforce plan limits
  const clinic = await Clinic.findById(req.clinicId);
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  const limits = PLANS[clinic.plan as Plan];
  const existingCount = await User.countDocuments({
    clinicId: req.clinicId,
    role: data.role,
    isActive: true,
  });
  const max = data.role === "doctor" ? limits.maxDoctors : limits.maxReceptionists;
  if (max !== -1 && existingCount >= max) {
    return res.status(402).json({
      message: `Your plan allows up to ${max} ${data.role}${max === 1 ? "" : "s"} — upgrade to add more`,
      code: "PLAN_LIMIT",
      feature: data.role === "doctor" ? "maxDoctors" : "maxReceptionists",
    });
  }

  const emailTaken = await User.exists({ email: data.email.toLowerCase() });
  if (emailTaken) {
    return res.status(409).json({ message: "Email already registered" });
  }

  const staff = await User.create({
    ...data,
    clinicId: req.clinicId,
  });

  return res.status(201).json({
    id: String(staff._id),
    name: staff.name,
    email: staff.email,
    role: staff.role,
    isActive: staff.isActive,
  });
});

export const listStaff = asyncHandler(async (req: Request, res: Response) => {
  const staff = await User.find({ clinicId: req.clinicId })
    .select("name email role phone isActive createdAt")
    .sort({ createdAt: 1 });
  return res.json(staff);
});

const activeSchema = z.object({ isActive: z.boolean() });

export const toggleActive = asyncHandler(async (req: Request, res: Response) => {
  const data = activeSchema.parse(req.body);

  if (req.params.id === req.userId) {
    return res.status(400).json({ message: "You cannot deactivate yourself" });
  }

  const staff = await User.findOneAndUpdate(
    { _id: req.params.id, clinicId: req.clinicId },
    { $set: { isActive: data.isActive } },
    { new: true }
  ).select("name email role isActive");

  if (!staff) return res.status(404).json({ message: "Staff member not found" });
  return res.json(staff);
});

// ===== PATCH /api/users/:id — edit staff info (name, email, role, password) =====
const editSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(["doctor", "receptionist"]).optional(),
  phone: z.string().max(20).optional(),
  password: z.string().min(6).max(100).optional(),
});

export const editStaff = asyncHandler(async (req: Request, res: Response) => {
  const data = editSchema.parse(req.body);

  const staff = await User.findOne({ _id: req.params.id, clinicId: req.clinicId });
  if (!staff) return res.status(404).json({ message: "Staff member not found" });

  // Guard: can't edit owner (only one owner per clinic)
  if (staff.role === "owner") {
    return res.status(400).json({ message: "The owner account cannot be edited from here" });
  }

  // Guard: email must be unique across the platform
  if (data.email && data.email !== staff.email) {
    const taken = await User.exists({ email: data.email.toLowerCase() });
    if (taken) return res.status(409).json({ message: "Email already registered" });
    staff.email = data.email;
  }

  if (data.name) staff.name = data.name;
  if (data.role) staff.role = data.role;
  if (data.phone !== undefined) staff.phone = data.phone;
  if (data.password) staff.password = data.password; // pre-save hook will hash it

  await staff.save();

  return res.json({
    id: String(staff._id),
    name: staff.name,
    email: staff.email,
    role: staff.role,
    phone: staff.phone,
    isActive: staff.isActive,
  });
});
