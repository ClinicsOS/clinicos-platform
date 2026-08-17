import { Request, Response } from "express";
import { z } from "zod";
import { Clinic } from "../models/Clinic";
import { User } from "../models/User";
import { Appointment } from "../models/Appointment";
import { Patient } from "../models/Patient";
import { asyncHandler } from "../middleware/errorHandler";
import { PLANS, type Plan } from "../config/plans";
import { sendNewBookingNotification } from "../services/mailer";

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

  // Optional break window (e.g. lunch break) — slots starting inside
  // [breakStart, breakEnd) are excluded, same as closed-day handling.
  let breakStart = -1;
  let breakEnd = -1;
  if (hours.breakFrom && hours.breakTo) {
    const [bfH, bfM] = hours.breakFrom.split(":").map(Number);
    const [btH, btM] = hours.breakTo.split(":").map(Number);
    breakStart = bfH * 60 + bfM;
    breakEnd = btH * 60 + btM;
  }

  // Build slot list as wall-clock times (matched to the clinic's local timezone).
  // The client compares these against its LOCAL Date.now(), so we mirror that
  // logic here by treating times as local wall-clock too.
  const dateOnly = date; // "YYYY-MM-DD"
  const allSlots: { time: string; local: Date }[] = [];
  for (let m = openMinutes; m + slotMinutes <= closeMinutes; m += slotMinutes) {
    if (breakStart !== -1 && m >= breakStart && m < breakEnd) continue; // skip break slots
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

  // Build a set of booked wall-clock times ("HH:mm" in clinic local time).
  // IMPORTANT: appointment.startAt is stored as UTC, and the server process
  // itself may run in UTC (Render) — so we must explicitly convert to
  // Asia/Amman here rather than using .getHours()/.getMinutes(), which
  // return time in whatever timezone the SERVER happens to run in.
  const bookedTimes = new Set(
    booked.map((a) => {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Amman",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(a.startAt);
      const h = parts.find((p) => p.type === "hour")!.value;
      const m = parts.find((p) => p.type === "minute")!.value;
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
const publicBookSchema = z
  .object({
    doctorId: z.string().length(24),
    startAt: z.string().datetime(),
    fullName: z.string().min(2).max(100),
    phone: z.string().min(7).max(20),
    email: z.string().email().optional().or(z.literal("")),
    visitType: z.enum(["consultation", "procedure"]).default("consultation"),
    procedureNote: z.string().max(200).optional(),
  })
  .refine(
    (data) => data.visitType !== "procedure" || !!data.procedureNote?.trim(),
    { message: "Please specify the procedure", path: ["procedureNote"] }
  );

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

  // Reject bookings that fall inside the clinic's break window (extra
  // safety — client already blocks this, same as day-closed above).
  if (wh.breakFrom && wh.breakTo) {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Amman",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(startAt);
    const wallTime = `${parts.find((p) => p.type === "hour")!.value}:${
      parts.find((p) => p.type === "minute")!.value
    }`;
    if (wallTime >= wh.breakFrom && wallTime < wh.breakTo) {
      return res.status(400).json({
        message: "This time falls within the clinic's break — please pick another slot",
        code: "BREAK_TIME",
      });
    }
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

  // Guard against double-booking the same doctor/slot (race conditions,
  // stale client cache, or the client sending an already-taken time).
  const conflict = await Appointment.findOne({
    clinicId: clinic._id,
    doctorId: data.doctorId,
    startAt,
    status: { $in: ["scheduled", "confirmed"] },
  });
  if (conflict) {
    return res.status(409).json({
      message: "This time slot was just booked. Please pick another one.",
      code: "SLOT_TAKEN",
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
    visitType: data.visitType,
    procedureNote: data.visitType === "procedure" ? data.procedureNote?.trim() : undefined,
  });

  // نبعت إشعار للـ owner، بس ما نوقف الـ response لو الإيميل فشل
  const owner = await User.findOne({ clinicId: clinic._id, role: "owner", isActive: true });
  if (owner) {
    sendNewBookingNotification(owner.email, owner.name, {
      patientName: patient.fullName,
      patientPhone: patient.phone,
      doctorName: doctor.name,
      startAt: appointment.startAt,
      refCode: appointment.refCode ?? "",
    }).catch((err) => console.error("[publicBook] notify owner failed:", err));
  }

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
