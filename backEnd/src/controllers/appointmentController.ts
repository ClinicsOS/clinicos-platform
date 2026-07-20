import { Request, Response } from "express";
import { z } from "zod";
import { Appointment } from "../models/Appointment";
import { Patient } from "../models/Patient";
import { User } from "../models/User";
import { Clinic } from "../models/Clinic";
import { asyncHandler } from "../middleware/errorHandler";
import { PLANS, type Plan } from "../config/plans";

const createAppointmentSchema = z.object({
  patientId: z.string().length(24),
  doctorId: z.string().length(24),
  startAt: z.string().datetime(),
  duration: z.number().min(10).max(180).optional(),
  notes: z.string().max(500).optional(),
});

export const createAppointment = asyncHandler(async (req: Request, res: Response) => {
  const data = createAppointmentSchema.parse(req.body);

  // ==== Layer 1 defence: reject any past time ====
  const startAt = new Date(data.startAt);
  if (startAt.getTime() <= Date.now()) {
    return res.status(400).json({
      message: "Cannot book a time in the past",
      code: "PAST_TIME",
    });
  }

  const clinic = await Clinic.findById(req.clinicId);
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  // ==== Layer 2 defence: reject appointments on closed days ====
  const dow = startAt.getUTCDay();
  const wh = clinic.workingHours.find((w) => w.day === dow);
  if (!wh || !wh.isOpen) {
    return res.status(400).json({
      message: "The clinic is closed on this day",
      code: "DAY_CLOSED",
    });
  }

  // Enforce trial appointment cap
  const limits = PLANS[clinic.plan as Plan];
  if (limits.maxAppointments !== -1) {
    const count = await Appointment.countDocuments({ clinicId: req.clinicId });
    if (count >= limits.maxAppointments) {
      return res.status(402).json({
        message: `Trial limit reached (${limits.maxAppointments} appointments) — upgrade to continue`,
        code: "PLAN_LIMIT",
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
  });

  return res.status(201).json(appointment);
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
