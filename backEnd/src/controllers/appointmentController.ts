import { Request, Response } from "express";
import { z } from "zod";
import { Appointment } from "../models/Appointment";
import { Patient } from "../models/Patient";
import { User } from "../models/User";
import { Clinic } from "../models/Clinic";
import { asyncHandler } from "../middleware/errorHandler";
import { PLANS, type Plan } from "../config/plans";
import {
  checkAppointmentTiming,
  checkAppointmentPlanCap,
} from "../services/appointmentRules";

const createAppointmentSchema = z
  .object({
    patientId: z.string().length(24),
    doctorId: z.string().length(24),
    startAt: z.string().datetime(),
    duration: z.number().min(10).max(180).optional(),
    notes: z.string().max(500).optional(),
    visitType: z.enum(["consultation", "procedure"]).default("consultation"),
    procedureNote: z.string().max(200).optional(),
  })
  .refine(
    (data) => data.visitType !== "procedure" || !!data.procedureNote?.trim(),
    { message: "Please specify the procedure", path: ["procedureNote"] }
  );

const createBlockSchema = z.object({
  doctorId: z.string().length(24),
  startAt: z.string().datetime(),
  duration: z.number().min(10).max(480).optional(),
  note: z.string().max(200).optional(),
});

export const createAppointment = asyncHandler(async (req: Request, res: Response) => {
  const data = createAppointmentSchema.parse(req.body);

  const startAt = new Date(data.startAt);

  const clinic = await Clinic.findById(req.clinicId);
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  // ==== Shared business rules: past-time, closed day, break window ====
  const timing = checkAppointmentTiming(clinic, startAt);
  if (timing) {
    return res.status(400).json({ message: timing.message, code: timing.code });
  }

  // ==== Enforce trial appointment cap (shared) ====
  const limits = PLANS[clinic.plan as Plan];
  if (limits.maxAppointments !== -1) {
    const count = await Appointment.countDocuments({ clinicId: req.clinicId });
    const cap = checkAppointmentPlanCap(clinic, count);
    if (cap) {
      return res.status(402).json({
        message: cap.message,
        code: cap.code,
        feature: "maxAppointments",
      });
    }
  }

  const [patient, doctor] = await Promise.all([
    Patient.findOne({ _id: data.patientId, clinicId: req.clinicId }),
    User.findOne({
      _id: data.doctorId,
      clinicId: req.clinicId,
      role: "doctor",
      isActive: true,
    }),
  ]);
  if (!patient) return res.status(404).json({ message: "Patient not found" });
  if (!doctor) return res.status(404).json({ message: "Doctor not found" });

  const appointment = await Appointment.create({
    clinicId: req.clinicId,
    patientId: data.patientId,
    doctorId: data.doctorId,
    startAt: new Date(data.startAt),
    duration: data.duration ?? clinic.slotDuration,
    source: "dashboard",
    visitType: data.visitType,
    procedureNote: data.visitType === "procedure" ? data.procedureNote?.trim() : undefined,
  });

  return res.status(201).json(appointment);
});

/**
 * POST /api/appointments/block
 * Lets a doctor/owner reserve a slot for themselves (personal errand, meeting,
 * etc.) without a real patient. To the public booking page and every stats
 * query, this behaves exactly like a normal booked appointment — patients
 * just see the slot as "already booked" with no indication why.
 */
export const createBlock = asyncHandler(async (req: Request, res: Response) => {
  const data = createBlockSchema.parse(req.body);

  const startAt = new Date(data.startAt);
  if (startAt.getTime() <= Date.now()) {
    return res.status(400).json({ message: "Cannot block a time in the past", code: "PAST_TIME" });
  }

  const clinic = await Clinic.findById(req.clinicId);
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  const dow = startAt.getUTCDay();
  const wh = clinic.workingHours.find((w) => w.day === dow);
  if (!wh || !wh.isOpen) {
    return res.status(400).json({ message: "The clinic is closed on this day", code: "DAY_CLOSED" });
  }

  const doctor = await User.findOne({
    _id: data.doctorId,
    clinicId: req.clinicId,
    role: "doctor",
    isActive: true,
  });
  if (!doctor) return res.status(404).json({ message: "Doctor not found" });

  // Same conflict guard as public/admin booking — the unique DB index also
  // enforces this, but checking here gives a clean 409 instead of a raw
  // duplicate-key error.
  const conflict = await Appointment.findOne({
    clinicId: req.clinicId,
    doctorId: data.doctorId,
    startAt,
    status: { $in: ["scheduled", "confirmed"] },
  });
  if (conflict) {
    return res.status(409).json({ message: "This time is already taken", code: "SLOT_TAKEN" });
  }

  const block = await Appointment.create({
    clinicId: req.clinicId,
    doctorId: data.doctorId,
    startAt,
    duration: data.duration ?? clinic.slotDuration,
    source: "dashboard",
    type: "blocked",
    blockNote: data.note,
    status: "confirmed",
  });

  return res.status(201).json(block);
});

export const listAppointments = asyncHandler(async (req: Request, res: Response) => {
  const filter: Record<string, any> = { clinicId: req.clinicId };

  if (req.query.date) {
    const day = new Date(String(req.query.date));
    const next = new Date(day);
    next.setDate(next.getDate() + 1);
    filter.startAt = { $gte: day, $lt: next };
  }
  if (req.query.doctorId) filter.doctorId = String(req.query.doctorId);
  if (req.query.status) filter.status = String(req.query.status);

  const appointments = await Appointment.find(filter)
    .sort({ startAt: 1 })
    .populate("patientId", "fullName phone fileNumber")
    .populate("doctorId", "name");

  return res.json(appointments);
});

const statusSchema = z.object({
  status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]),
  cancelReason: z.string().max(300).optional(),
  visitNote: z.string().max(1000).optional(),
});

export const updateStatus = asyncHandler(async (req: Request, res: Response) => {
  const data = statusSchema.parse(req.body);

  const appointment = await Appointment.findOneAndUpdate(
    { _id: req.params.id, clinicId: req.clinicId },
    { $set: data },
    { new: true }
  );

  if (!appointment) return res.status(404).json({ message: "Appointment not found" });
  return res.json(appointment);
});

/**
 * PATCH /api/appointments/:id/read — mark a single notification as read
 * for the current user.
 */
export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const appointment = await Appointment.findOneAndUpdate(
    { _id: req.params.id, clinicId: req.clinicId },
    { $addToSet: { readBy: req.userId } },
    { new: true }
  );
  if (!appointment) return res.status(404).json({ message: "Appointment not found" });
  return res.json({ id: appointment._id, readBy: appointment.readBy });
});

/**
 * PATCH /api/appointments/read-all — mark ALL pending public notifications
 * as read by the current user in one shot.
 */
export const markAllRead = asyncHandler(async (req: Request, res: Response) => {
  const result = await Appointment.updateMany(
    {
      clinicId: req.clinicId,
      source: "public",
      status: "scheduled",
      readBy: { $ne: req.userId },
    },
    { $addToSet: { readBy: req.userId } }
  );
  return res.json({ modifiedCount: result.modifiedCount });
});
