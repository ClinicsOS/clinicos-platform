import { Request, Response } from "express";
import { z } from "zod";
import { Appointment } from "../models/Appointment";
import { Patient } from "../models/Patient";
import { Clinic } from "../models/Clinic";
import { asyncHandler } from "../middleware/errorHandler";

const trackSchema = z.object({
  refCode: z.string().min(3).max(20),
  phone: z.string().min(7).max(20),
});

/**
 * POST /api/public/track — look up your booking by ref code + phone.
 * The phone must match the patient the booking was made for — otherwise
 * anyone with a leaked ref code could see the appointment.
 */
export const trackBooking = asyncHandler(async (req: Request, res: Response) => {
  const data = trackSchema.parse(req.body);

  const appt = await Appointment.findOne({ refCode: data.refCode.toUpperCase() });
  if (!appt) return res.status(404).json({ message: "Booking not found" });

  const patient = await Patient.findById(appt.patientId);
  if (!patient || patient.phone !== data.phone) {
    // Return 404 (not 403) so we don't confirm ref code existence to attackers
    return res.status(404).json({ message: "Booking not found" });
  }

  const clinic = await Clinic.findById(appt.clinicId).select("name slug");
  if (!clinic) return res.status(404).json({ message: "Booking not found" });

  return res.json({
    refCode: appt.refCode,
    status: appt.status,
    startAt: appt.startAt,
    duration: appt.duration,
    clinicName: clinic.name,
    clinicSlug: clinic.slug,
    patientName: patient.fullName,
    canCancel: ["scheduled", "confirmed"].includes(appt.status) && new Date(appt.startAt) > new Date(),
  });
});

/**
 * POST /api/public/track/cancel — cancel your own booking.
 */
export const cancelBooking = asyncHandler(async (req: Request, res: Response) => {
  const data = trackSchema.parse(req.body);

  const appt = await Appointment.findOne({ refCode: data.refCode.toUpperCase() });
  if (!appt) return res.status(404).json({ message: "Booking not found" });

  const patient = await Patient.findById(appt.patientId);
  if (!patient || patient.phone !== data.phone) {
    return res.status(404).json({ message: "Booking not found" });
  }

  if (!["scheduled", "confirmed"].includes(appt.status)) {
    return res.status(400).json({ message: "This booking cannot be cancelled" });
  }
  if (new Date(appt.startAt) <= new Date()) {
    return res.status(400).json({ message: "Cannot cancel a past booking" });
  }

  appt.status = "cancelled";
  appt.cancelReason = "Cancelled by patient";
  await appt.save();

  return res.json({ message: "Booking cancelled", refCode: appt.refCode });
});
