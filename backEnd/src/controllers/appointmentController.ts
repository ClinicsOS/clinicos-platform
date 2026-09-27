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
import { findOverlappingAppointment } from "../services/appointmentAvailability";
import { localDayOfWeek } from "../utils/workingHoursTime";

const createAppointmentSchema = z
  .object({
    patientId: z.string().length(24),
    doctorId: z.string().length(24),
    // Required for a normal scheduled/dashboard appointment. Omitted (and
    // ignored if sent) for a walk-in — FIX #3: a Walk-in's arrival time is
    // always the server's own "now", never a client-supplied time, so a
    // stale/replayed/incorrect client clock can never misrecord it.
    startAt: z.string().datetime().optional(),
    duration: z.number().min(10).max(180).optional(),
    notes: z.string().max(500).optional(),
    visitType: z.enum(["consultation", "procedure"]).default("consultation"),
    procedureNote: z.string().max(200).optional(),
    // Optional — how this appointment was created. Defaults to "dashboard"
    // (the normal New Appointment flow) when omitted, so every existing
    // caller is unaffected. "walk_in" is the only other value a client may
    // request here; "public" is reserved for the public booking endpoint
    // and can never be set through this one.
    source: z.enum(["dashboard", "walk_in"]).optional(),
    // FIX #3 — optional short note on why a walk-in patient came in.
    // Reuses the existing `visitNote` field at creation time (see below) —
    // no separate "Walk-in note" system, so Fix #2's Add/Edit Note keeps
    // working on it unchanged.
    reason: z.string().max(300).optional(),
  })
  .refine((data) => data.source === "walk_in" || !!data.startAt, {
    message: "startAt is required",
    path: ["startAt"],
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
  const isWalkIn = data.source === "walk_in";

  const clinic = await Clinic.findById(req.clinicId);
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  // FIX #3 — TRUE WALK-IN WORKFLOW.
  //
  // A Walk-in documents a patient who has ALREADY physically arrived — it
  // is a VISIT RECORD, not a schedule reservation ("we squeeze the walk-in
  // between our appointments"). Its arrival time is always the server's
  // current Jordan clock time, never a client-supplied or slot-grid-aligned
  // time, and it deliberately skips the two checks below:
  //
  //   - checkAppointmentTiming (past-time / closed-day / working-hours /
  //     break-window): these all answer "can I reserve this FUTURE slot?",
  //     which doesn't apply to an event that already happened. Reusing it
  //     here would in fact reject almost every walk-in outright — "now" is
  //     already <= Date.now() by the time this request is processed, so
  //     the past-time guard alone would fail every single one.
  //   - findOverlappingAppointment (double-booking guard): a walk-in must
  //     be allowed to coexist with an existing scheduled appointment AND
  //     with other walk-ins (doctor's own description of the workflow).
  //
  // A normal ("dashboard") appointment is completely unaffected — it still
  // requires startAt/duration and still runs both checks exactly as
  // before. Walk-ins are also made non-blocking FOR OTHERS centrally, in
  // findOverlappingAppointment (excluded by source there), so a real
  // scheduled/public appointment can never be rejected because a walk-in
  // happens to occupy that time.
  const startAt = isWalkIn ? new Date() : new Date(data.startAt!);
  const duration = isWalkIn ? clinic.slotDuration : data.duration ?? clinic.slotDuration;

  if (!isWalkIn) {
    // ==== Shared business rules: past-time, closed day, hours fit, break window ====
    const timing = checkAppointmentTiming(clinic, startAt, duration);
    if (timing) {
      return res.status(400).json({ message: timing.message, code: timing.code });
    }
  }

  // ==== Enforce trial appointment cap (shared) — a Walk-in still consumes
  // the clinic's plan quota exactly like any other appointment record. ====
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

  if (!isWalkIn) {
    // ==== Real interval-overlap conflict check ====
    // The DB's unique index only catches an identical startAt — this also
    // catches landing inside an existing LONGER appointment/block (e.g. a
    // 60-minute appointment at 10:00 already occupies 10:30, even though no
    // appointment starts exactly at 10:30).
    const conflict = await findOverlappingAppointment(req.clinicId!, data.doctorId, startAt, duration);
    if (conflict) {
      return res.status(409).json({ message: "This time overlaps another appointment", code: "SLOT_TAKEN" });
    }
  }

  const appointment = await Appointment.create({
    clinicId: req.clinicId,
    patientId: data.patientId,
    doctorId: data.doctorId,
    startAt,
    duration,
    source: data.source ?? "dashboard",
    visitType: data.visitType,
    procedureNote: data.visitType === "procedure" ? data.procedureNote?.trim() : undefined,
    visitNote: isWalkIn ? data.reason?.trim() || undefined : undefined,
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

  // Closed day — clinic-LOCAL (Asia/Amman) calendar day, not UTC (FIX #8):
  // getUTCDay() misidentifies the weekday for a block starting between
  // local 00:00 and 02:59.
  const dow = localDayOfWeek(startAt);
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

  const blockDuration = data.duration ?? clinic.slotDuration;

  // Same conflict guard as public/admin booking — a real interval-overlap
  // check, so blocking time that falls inside an existing longer appointment
  // (or vice versa) is caught even when it doesn't start at the exact same
  // instant.
  const conflict = await findOverlappingAppointment(req.clinicId!, data.doctorId, startAt, blockDuration);
  if (conflict) {
    return res.status(409).json({ message: "This time is already taken", code: "SLOT_TAKEN" });
  }

  const block = await Appointment.create({
    clinicId: req.clinicId,
    doctorId: data.doctorId,
    startAt,
    duration: blockDuration,
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
  } else if (req.query.from) {
    // FIX #11 (F-02) — an open-ended "from this point on" filter, distinct
    // from the single-day `date` filter above. Lets a caller ask for only
    // FUTURE appointments (e.g. "pending public bookings still to come")
    // without downloading the clinic's entire appointment history.
    const from = new Date(String(req.query.from));
    if (!isNaN(from.getTime())) {
      filter.startAt = { $gte: from };
    }
  }
  if (req.query.doctorId) filter.doctorId = String(req.query.doctorId);
  if (req.query.status) filter.status = String(req.query.status);
  // FIX #11 (F-02) — validated against the actual source enum (never a raw,
  // unchecked string) so this can only ever narrow the query, never be used
  // to inject an unexpected filter value.
  if (req.query.source) {
    const source = String(req.query.source);
    if (source === "dashboard" || source === "public" || source === "walk_in") {
      filter.source = source;
    }
  }
  // Used by the Patient Profile page's Visit History — always combined with
  // the clinicId filter above, so a patientId from another clinic can never
  // return that clinic's appointments (it just matches nothing).
  if (req.query.patientId) filter.patientId = String(req.query.patientId);

  const appointments = await Appointment.find(filter)
    .sort({ startAt: 1 })
    .populate("patientId", "fullName phone fileNumber")
    .populate("doctorId", "name");

  return res.json(appointments);
});

const statusSchema = z
  .object({
    status: z.enum(["scheduled", "confirmed", "completed", "cancelled", "no_show"]).optional(),
    cancelReason: z.string().max(300).optional(),
    visitNote: z.string().max(1000).optional(),
    // ==== FIX #6 — reschedule / reassignment. All optional: a caller that
    // sends none of these (every call site before this fix) still gets a
    // pure status/note update with zero behaviour change. ====
    startAt: z.string().datetime().optional(),
    duration: z.number().min(10).max(180).optional(),
    doctorId: z.string().length(24).optional(),
    visitType: z.enum(["consultation", "procedure"]).optional(),
    procedureNote: z.string().max(200).optional(),
  })
  .refine(
    (data) => data.visitType !== "procedure" || !!data.procedureNote?.trim() || data.visitType === undefined,
    { message: "Please specify the procedure", path: ["procedureNote"] }
  );

/**
 * PATCH /api/appointments/:id/status
 *
 * The ONE update path for an existing appointment/block — status changes,
 * visit notes, AND reschedule/reassignment (FIX #6) all go through here, so
 * there is only ever one place that decides whether a change is safe.
 *
 * Whenever the schedule actually changes — a new startAt, a new duration, a
 * new doctor, or REACTIVATING a cancelled/no_show appointment back to an
 * active status — the intended new interval is revalidated with the exact
 * same rules used to create an appointment (working hours, FIX #1's
 * midnight boundary, FIX #2's duration-aware overlap check). The
 * appointment being edited excludes ITSELF from that overlap check (it
 * must never conflict with its own current slot), while every other active
 * appointment/block still counts.
 *
 * A pure status/note edit that touches none of the schedule fields (e.g.
 * writing a Visit Note, or re-saving the same status) skips revalidation
 * entirely — exactly like before this fix.
 */
export const updateAppointment = asyncHandler(async (req: Request, res: Response) => {
  const data = statusSchema.parse(req.body);

  const appointment = await Appointment.findOne({
    _id: req.params.id,
    clinicId: req.clinicId,
  });
  if (!appointment) return res.status(404).json({ message: "Appointment not found" });

  const nextStartAt = data.startAt !== undefined ? new Date(data.startAt) : appointment.startAt;
  const nextDuration = data.duration ?? appointment.duration;
  const nextDoctorId = data.doctorId ?? String(appointment.doctorId);

  const scheduleChanged =
    (data.startAt !== undefined && nextStartAt.getTime() !== appointment.startAt.getTime()) ||
    (data.duration !== undefined && nextDuration !== appointment.duration) ||
    (data.doctorId !== undefined && nextDoctorId !== String(appointment.doctorId));

  // Reactivating a cancelled/no_show appointment back to an active status
  // is just as capable of double-booking as a brand-new appointment — the
  // slot may no longer be free.
  const reactivating =
    data.status !== undefined &&
    (data.status === "scheduled" || data.status === "confirmed") &&
    (appointment.status === "cancelled" || appointment.status === "no_show");

  if (scheduleChanged || reactivating) {
    // Reassigning the doctor: the NEW doctor must belong to this clinic —
    // never trust a doctorId from the frontend without checking tenant
    // ownership, exactly like appointment creation already does.
    if (data.doctorId !== undefined && data.doctorId !== String(appointment.doctorId)) {
      const newDoctor = await User.findOne({
        _id: data.doctorId,
        clinicId: req.clinicId,
        role: "doctor",
        isActive: true,
      });
      if (!newDoctor) return res.status(404).json({ message: "Doctor not found" });
    }

    const clinic = await Clinic.findById(req.clinicId);
    if (!clinic) return res.status(404).json({ message: "Clinic not found" });

    // Blocks skip the past-time/working-hours/break checks, exactly like
    // createBlock already does for new blocks.
    if (appointment.type !== "blocked") {
      const timing = checkAppointmentTiming(clinic, nextStartAt, nextDuration);
      if (timing) {
        return res.status(400).json({ message: timing.message, code: timing.code });
      }
    }

    // Real interval-overlap check against every OTHER active appointment/
    // block for the (possibly new) doctor — excluding THIS appointment, so
    // it can never conflict with its own current slot.
    const conflict = await findOverlappingAppointment(
      req.clinicId!,
      nextDoctorId,
      nextStartAt,
      nextDuration,
      appointment._id
    );
    if (conflict) {
      return res.status(409).json({ message: "This time overlaps another appointment", code: "SLOT_TAKEN" });
    }
  }

  const set: Record<string, unknown> = {};
  if (data.status !== undefined) set.status = data.status;
  if (data.cancelReason !== undefined) set.cancelReason = data.cancelReason;
  if (data.visitNote !== undefined) set.visitNote = data.visitNote;
  if (data.visitType !== undefined) set.visitType = data.visitType;
  if (data.procedureNote !== undefined) set.procedureNote = data.procedureNote;
  if (data.startAt !== undefined) set.startAt = nextStartAt;
  if (data.duration !== undefined) set.duration = nextDuration;
  if (data.doctorId !== undefined) set.doctorId = nextDoctorId;

  // Nothing was actually sent — return the current document rather than
  // attempting an empty $set (which Mongo rejects).
  if (Object.keys(set).length === 0) {
    return res.json(appointment);
  }

  const updated = await Appointment.findOneAndUpdate(
    { _id: req.params.id, clinicId: req.clinicId },
    { $set: set },
    { new: true }
  );

  if (!updated) return res.status(404).json({ message: "Appointment not found" });
  return res.json(updated);
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
