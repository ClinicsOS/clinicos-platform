import { Request, Response } from "express";
import { z } from "zod";
import { Clinic } from "../models/Clinic";
import { User } from "../models/User";
import { Appointment } from "../models/Appointment";
import { Patient } from "../models/Patient";
import { asyncHandler } from "../middleware/errorHandler";
import { PLANS, type Plan } from "../config/plans";

// ===== GET /api/public/clinics/:slug =====
export const getClinicBySlug = asyncHandler(async (req: Request, res: Response) => {
  const clinic = await Clinic.findOne({
    slug: req.params.slug,
    status: "active",
  }).select("name slug specialty phone address logoUrl brandColor workingHours slotDuration plan");

  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  const doctors = await User.find({
    clinicId: clinic._id,
    role: "doctor",
    isActive: true,
  }).select("name");

  const plan = clinic.plan as Plan;
  return res.json({
    clinic: {
      _id: clinic._id,
      name: clinic.name,
      slug: clinic.slug,
      specialty: clinic.specialty,
      phone: clinic.phone,
      address: clinic.address,
      logoUrl: clinic.logoUrl,
      brandColor: PLANS[plan].customBookingColor ? clinic.brandColor : undefined,
      workingHours: clinic.workingHours,
      slotDuration: clinic.slotDuration,
    },
    doctors,
    showPoweredBy: !PLANS[plan].whiteLabel,
  });
});

// ===== GET /api/public/clinics/:slug/slots =====
export const getAvailableSlots = asyncHandler(async (req: Request, res: Response) => {
  const doctorId = String(req.query.doctorId || "");
  const date = String(req.query.date || "");

  if (!doctorId || !date) {
    return res.status(400).json({ message: "doctorId and date are required" });
  }

  const clinic = await Clinic.findOne({ slug: req.params.slug, status: "active" });
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  const doctor = await User.findOne({
    _id: doctorId,
    clinicId: clinic._id,
    role: "doctor",
    isActive: true,
  });
  if (!doctor) return res.status(404).json({ message: "Doctor not found" });

  const day = new Date(date + "T00:00:00.000Z");
  if (isNaN(day.getTime())) {
    return res.status(400).json({ message: "Invalid date format, use YYYY-MM-DD" });
  }

  const dayOfWeek = day.getUTCDay();
  const hours = clinic.workingHours.find((wh) => wh.day === dayOfWeek);
  if (!hours || !hours.isOpen) {
    return res.json({ slots: [], message: "Clinic is closed on this day" });
  }

  const slotMinutes = clinic.slotDuration;
  const [fromH, fromM] = hours.from.split(":").map(Number);
  const [toH, toM] = hours.to.split(":").map(Number);
  const openMinutes = fromH * 60 + fromM;
  const closeMinutes = toH * 60 + toM;

  // Build slot list as wall-clock times (matched to the clinic's local timezone).
  // The client compares these against its LOCAL Date.now(), so we mirror that
  // logic here by treating times as local wall-clock too.
  const dateOnly = date; // "YYYY-MM-DD"
  const allSlots: { time: string; local: Date }[] = [];
  for (let m = openMinutes; m + slotMinutes <= closeMinutes; m += slotMinutes) {
    const h = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    const time = `${h}:${mm}`;
    // Interpret as WALL-CLOCK local time (no Z)
    const local = new Date(`${dateOnly}T${time}:00`);
    allSlots.push({ time, local });
  }

  const nextDay = new Date(day);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const booked = await Appointment.find({
    clinicId: clinic._id,
    doctorId,
    startAt: { $gte: day, $lt: nextDay },
    status: { $in: ["scheduled", "confirmed"] },
  }).select("startAt");

  // Build a set of booked wall-clock times ("HH:mm" in clinic local time)
  // The appointment startAt is UTC in the DB; we convert to LOCAL for match.
  const bookedTimes = new Set(
    booked.map((a) => {
      const h = String(a.startAt.getHours()).padStart(2, "0");
      const m = String(a.startAt.getMinutes()).padStart(2, "0");
      return `${h}:${m}`;
    })
  );

  const now = Date.now();
  const available = allSlots.filter(
    (s) => !bookedTimes.has(s.time) && s.local.getTime() > now
  );

  const slots = available.map((s) => s.time);

  return res.json({ date, doctorId, slotDuration: slotMinutes, slots });
});

// ===== POST /api/public/clinics/:slug/book =====
const publicBookSchema = z.object({
  doctorId: z.string().length(24),
  startAt: z.string().datetime(),
  fullName: z.string().min(2).max(100),
  phone: z.string().min(7).max(20),
  email: z.string().email().optional().or(z.literal("")),
});

const makeRefCode = () =>
  "BK-" + Math.random().toString(36).slice(2, 7).toUpperCase();

export const publicBook = asyncHandler(async (req: Request, res: Response) => {
  const data = publicBookSchema.parse(req.body);

  const clinic = await Clinic.findOne({ slug: req.params.slug, status: "active" });
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  const doctor = await User.findOne({
    _id: data.doctorId,
    clinicId: clinic._id,
    role: "doctor",
    isActive: true,
  });
  if (!doctor) return res.status(404).json({ message: "Doctor not found" });

  const startAt = new Date(data.startAt);
  if (startAt.getTime() <= Date.now()) {
    return res.status(400).json({ message: "Cannot book a time in the past" });
  }

  // Reject bookings on closed days (extra safety — client already blocks this)
  const dow = startAt.getUTCDay();
  const wh = clinic.workingHours.find((w) => w.day === dow);
  if (!wh || !wh.isOpen) {
    return res.status(400).json({
      message: "The clinic is closed on this day",
      code: "DAY_CLOSED",
    });
  }

  // Enforce trial appointment cap on public bookings too
  const limits = PLANS[clinic.plan as Plan];
  if (limits.maxAppointments !== -1) {
    const count = await Appointment.countDocuments({ clinicId: clinic._id });
    if (count >= limits.maxAppointments) {
      return res.status(402).json({
        message: "This clinic is not accepting online bookings right now",
        code: "PLAN_LIMIT",
      });
    }
  }

  // Match by phone within the clinic — same patient, same file, forever.
  let patient = await Patient.findOne({
    clinicId: clinic._id,
    phone: data.phone,
  });

  if (!patient) {
    const pCount = await Patient.countDocuments({ clinicId: clinic._id });
    patient = await Patient.create({
      clinicId: clinic._id,
      fileNumber: pCount + 1,
      fullName: data.fullName,
      phone: data.phone,
      email: data.email || undefined,
    });
  } else if (data.email && !patient.email) {
    // Progressive enrichment — capture the email if we didn't have one yet
    patient.email = data.email;
    await patient.save();
  }

  const activeBookings = await Appointment.countDocuments({
    clinicId: clinic._id,
    patientId: patient._id,
    status: { $in: ["scheduled", "confirmed"] },
    startAt: { $gte: new Date() },
  });
  if (activeBookings >= 3) {
    return res.status(429).json({
      message: "Too many active bookings for this phone number",
    });
  }

  const appointment = await Appointment.create({
    clinicId: clinic._id,
    patientId: patient._id,
    doctorId: data.doctorId,
    startAt,
    duration: clinic.slotDuration,
    source: "public",
    refCode: makeRefCode(),
  });

  return res.status(201).json({
    message: "Booking received",
    refCode: appointment.refCode,
    clinicName: clinic.name,
    clinicSlug: clinic.slug,
    doctorName: doctor.name,
    startAt: appointment.startAt,
    duration: appointment.duration,
  });
});
