import { Request, Response } from "express";
import crypto from "crypto";
import { z } from "zod";
import { Clinic } from "../models/Clinic";
import { User } from "../models/User";
import { Appointment } from "../models/Appointment";
import { Patient } from "../models/Patient";
import { asyncHandler } from "../middleware/errorHandler";
import { PLANS, type Plan } from "../config/plans";
import { sendNewBookingNotification } from "../services/mailer";
import { timeToMinutes, intervalsOverlap } from "../utils/workingHoursTime";
import { checkAppointmentTiming } from "../services/appointmentRules";
import { findOverlappingAppointment } from "../services/appointmentAvailability";

// ===== GET /api/public/clinics/search?q= =====
// Added for mobile clinic discovery (patient no longer needs a direct link).
// Public-safe fields only — mirrors the field selection already used in
// getClinicBySlug above. No owner email, no subscription/billing data.
export const searchClinics = asyncHandler(
  async (req: Request, res: Response) => {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      return res.json({ results: [] });
    }

    // Case-insensitive partial match. Mongo regex on a modest clinic
    // collection is fine here; a text index would be the next step if this
    // ever needs to scale beyond that.
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");

    const clinics = await Clinic.find({
      status: "active",
      name: regex,
    })
      .select("name slug specialty logoUrl brandColor plan")
      .limit(20);

    // Also match clinics via a doctor's name, in case the clinic itself
    // didn't match (e.g. searching "Mahmoud" for "Dr. Mahmoud" at a clinic
    // named something else entirely).
    const matchingDoctors = await User.find({
      role: "doctor",
      isActive: true,
      name: regex,
    }).select("clinicId name");

    const doctorClinicIds = matchingDoctors.map((d) => String(d.clinicId));
    const alreadyIncluded = new Set(clinics.map((c) => String(c._id)));
    const extraClinicIds = doctorClinicIds.filter(
      (id) => !alreadyIncluded.has(id),
    );

    const clinicsByDoctor = extraClinicIds.length
      ? await Clinic.find({ _id: { $in: extraClinicIds }, status: "active" })
          .select("name slug specialty logoUrl brandColor plan")
          .limit(20)
      : [];

    const doctorNameByClinic = new Map<string, string>();
    for (const d of matchingDoctors) {
      doctorNameByClinic.set(String(d.clinicId), d.name);
    }

    const toResult = (c: (typeof clinics)[number]) => {
      const plan = c.plan as Plan;
      return {
        _id: c._id,
        name: c.name,
        slug: c.slug,
        specialty: c.specialty,
        logoUrl: c.logoUrl,
        brandColor: PLANS[plan].customBookingColor ? c.brandColor : undefined,
        matchedDoctorName: doctorNameByClinic.get(String(c._id)) || undefined,
      };
    };

    // Rank: exact name match, then starts-with, then partial name match,
    // then doctor-name matches.
    const lower = q.toLowerCase();
    const nameMatches = clinics.map(toResult).sort((a, b) => {
      const rank = (name: string) => {
        const n = name.toLowerCase();
        if (n === lower) return 0;
        if (n.startsWith(lower)) return 1;
        return 2;
      };
      return rank(a.name) - rank(b.name);
    });

    const doctorMatches = clinicsByDoctor.map(toResult);

    return res.json({
      results: [...nameMatches, ...doctorMatches].slice(0, 20),
    });
  },
);

// ===== GET /api/public/clinics/:slug =====
export const getClinicBySlug = asyncHandler(
  async (req: Request, res: Response) => {
    const clinic = await Clinic.findOne({
      slug: req.params.slug,
      status: "active",
    }).select(
      "name slug specialty phone address logoUrl brandColor workingHours slotDuration plan",
    );

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
        brandColor: PLANS[plan].customBookingColor
          ? clinic.brandColor
          : undefined,
        workingHours: clinic.workingHours,
        slotDuration: clinic.slotDuration,
      },
      doctors,
      showPoweredBy: !PLANS[plan].whiteLabel,
    });
  },
);

// ===== GET /api/public/clinics/:slug/slots =====
export const getAvailableSlots = asyncHandler(
  async (req: Request, res: Response) => {
    const doctorId = String(req.query.doctorId || "");
    const date = String(req.query.date || "");

    if (!doctorId || !date) {
      return res
        .status(400)
        .json({ message: "doctorId and date are required" });
    }

    const clinic = await Clinic.findOne({
      slug: req.params.slug,
      status: "active",
    });
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
      return res
        .status(400)
        .json({ message: "Invalid date format, use YYYY-MM-DD" });
    }

    const dayOfWeek = day.getUTCDay();
    const hours = clinic.workingHours.find((wh) => wh.day === dayOfWeek);
    if (!hours || !hours.isOpen) {
      return res.json({ slots: [], message: "Clinic is closed on this day" });
    }

    const slotMinutes = clinic.slotDuration;
    const openMinutes = timeToMinutes(hours.from);
    const closeMinutes = timeToMinutes(hours.to, { endOfDay: true });

    // Optional break window (e.g. lunch break) — a candidate slot is
    // excluded when its FULL occupied interval [m, m+slotMinutes) overlaps
    // the break, not just when its start instant falls inside the break
    // (FIX #8: a break that isn't grid-aligned, e.g. "12:15"-"12:45" with
    // 30-minute slots, was previously letting the 12:00 slot show as
    // available even though it actually runs 15 minutes into the break —
    // the authoritative check in publicBook already rejected it at booking
    // time, but the preview list shouldn't offer a slot that can never
    // succeed). A malformed reversed/zero-length break (breakStart >=
    // breakEnd) is ignored defensively rather than risk excluding slots it
    // was never meant to.
    let breakStart = -1;
    let breakEnd = -1;
    if (hours.breakFrom && hours.breakTo) {
      const bStart = timeToMinutes(hours.breakFrom);
      const bEnd = timeToMinutes(hours.breakTo);
      if (bStart < bEnd) {
        breakStart = bStart;
        breakEnd = bEnd;
      }
    }

    // Build slot list as wall-clock times (matched to the clinic's local timezone).
    // The client compares these against its LOCAL Date.now(), so we mirror that
    // logic here by treating times as local wall-clock too.
    const dateOnly = date; // "YYYY-MM-DD"
    const allSlots: { time: string; local: Date }[] = [];
    for (
      let m = openMinutes;
      m + slotMinutes <= closeMinutes;
      m += slotMinutes
    ) {
      if (breakStart !== -1 && intervalsOverlap(m, m + slotMinutes, breakStart, breakEnd)) continue; // skip break slots
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
    }).select("startAt duration");

    // Build each booked appointment's OCCUPIED INTERVAL as minute-of-day
    // (clinic local time), using its own duration — not just its exact start
    // time. A public slot must be rejected if it overlaps ANY of these, even
    // one created on the dashboard with a longer (e.g. 60-minute) duration
    // whose exact start time this slot never matches.
    // IMPORTANT: appointment.startAt is stored as UTC, and the server process
    // itself may run in UTC (Render) — so we must explicitly convert to
    // Asia/Amman here rather than using .getHours()/.getMinutes(), which
    // return time in whatever timezone the SERVER happens to run in.
    const occupied = booked.map((a) => {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Amman",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(a.startAt);
      const h = parts.find((p) => p.type === "hour")!.value;
      const m = parts.find((p) => p.type === "minute")!.value;
      const start = timeToMinutes(`${h}:${m}`);
      return { start, end: start + a.duration };
    });

    const now = Date.now();
    const available = allSlots.filter((s) => {
      const slotStart = timeToMinutes(s.time);
      const slotEnd = slotStart + slotMinutes;
      const overlapsExisting = occupied.some((o) =>
        intervalsOverlap(slotStart, slotEnd, o.start, o.end),
      );
      return !overlapsExisting && s.local.getTime() > now;
    });

    const slots = available.map((s) => s.time);

    return res.json({ date, doctorId, slotDuration: slotMinutes, slots });
  },
);

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
    { message: "Please specify the procedure", path: ["procedureNote"] },
  );

// FIX #11 (F-05) — cryptographically random, collision-checked booking
// reference. Uses the standard Crockford Base32 alphabet (excludes I/L/O/U,
// which are easily confused with 1/1/0/V) so a patient reading it aloud or
// typing it on the tracking page can't mistake similar-looking characters.
// 8 characters from this 32-symbol alphabet is 2^40 (~1.1 trillion)
// combinations — a large increase over the previous 5 base-36 characters
// (~60 million) — generated with crypto.randomBytes, not Math.random().
// Old "BK-XXXXX" codes already stored keep working exactly as before: this
// only changes how NEW codes are generated, never how an existing one is
// looked up.
const REF_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford Base32, 32 chars
const REF_CODE_LENGTH = 8;

function makeRefCode(): string {
  const bytes = crypto.randomBytes(REF_CODE_LENGTH);
  let code = "";
  // 256 (byte range) is an exact multiple of 32 (alphabet length), so this
  // mapping is uniform — no modulo bias.
  for (let i = 0; i < bytes.length; i++) {
    code += REF_CODE_ALPHABET[bytes[i] % REF_CODE_ALPHABET.length];
  }
  return "BK-" + code;
}

/**
 * Generates a refCode and confirms it isn't already in use before handing
 * it back — belt-and-suspenders alongside the new sparse unique index on
 * Appointment.refCode (see models/Appointment.ts), so a collision can never
 * silently create two bookings sharing the same reference.
 */
async function generateUniqueRefCode(): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeRefCode();
    const exists = await Appointment.exists({ refCode: code });
    if (!exists) return code;
  }
  // Effectively unreachable at this entropy level — fail loudly rather than
  // ever risk returning a colliding code.
  throw new Error("Could not generate a unique booking reference — please try again");
}

export const publicBook = asyncHandler(async (req: Request, res: Response) => {
  const data = publicBookSchema.parse(req.body);

  const clinic = await Clinic.findOne({
    slug: req.params.slug,
    status: "active",
  });
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

  // Same business rules as the dashboard flow — closed day, working-hours
  // fit (including FIX #1's end-of-day midnight boundary), and break-window
  // overlap — using the single shared source of truth instead of a second,
  // separately-maintained copy of this logic.
  const timing = checkAppointmentTiming(clinic, startAt, clinic.slotDuration);
  if (timing) {
    return res.status(400).json({ message: timing.message, code: timing.code });
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
  // stale client cache, or the client sending an already-taken time) — a
  // real interval-overlap check, so this also catches landing inside an
  // existing LONGER appointment/block that doesn't start at this exact time.
  const conflict = await findOverlappingAppointment(
    clinic._id,
    data.doctorId,
    startAt,
    clinic.slotDuration,
  );
  if (conflict) {
    return res.status(409).json({
      message: "This time slot was just booked. Please pick another one.",
      code: "SLOT_TAKEN",
    });
  }

  const refCode = await generateUniqueRefCode();

  const appointment = await Appointment.create({
    clinicId: clinic._id,
    patientId: patient._id,
    doctorId: data.doctorId,
    startAt,
    duration: clinic.slotDuration,
    source: "public",
    refCode,
    visitType: data.visitType,
    procedureNote:
      data.visitType === "procedure" ? data.procedureNote?.trim() : undefined,
  });

  // نبعت إشعار للـ owner، بس ما نوقف الـ response لو الإيميل فشل
  const owner = await User.findOne({
    clinicId: clinic._id,
    role: "owner",
    isActive: true,
  });
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
    visitType: appointment.visitType,
    procedureNote: appointment.procedureNote,
  });
});
