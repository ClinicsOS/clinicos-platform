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
import { onAppointmentStatusChange } from "../services/loyaltyPoints";
import { localDayOfWeek } from "../utils/workingHoursTime";
import { isValidYmd, clinicYmdOf, clinicDayRange } from "../utils/timezone";
import { resolveDataScope, doctorMatch, assertWritableDoctor, PolicyError } from "../auth/policy";
import { checkDoctorTiming } from "../services/doctorSchedule";

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
    // PHASE 3.5 — optional idempotency token for a walk-in (one per "Register walk-in" dialog). A double click / network
    // retry carrying the same token can never create a second record. Ignored for scheduled appointments.
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
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
  // PHASE 4 — a doctor books / registers only for themself; owner and receptionist may choose any doctor of the clinic.
  assertWritableDoctor(resolveDataScope(req, "appointments"), data.doctorId);

  const clinic = await Clinic.findById(req.clinicId);
  if (!clinic) return res.status(404).json({ message: "Clinic not found" });

  // PHASE 3.5 — a walk-in is idempotent per request: the key is scoped by the AUTHENTICATED clinic (never a client clinic
  // id), so a replay can only ever return this clinic's own record. A retry/double click gets the original back (200).
  const walkInKey =
    isWalkIn && data.requestId ? `${req.clinicId}:${data.patientId}:${data.doctorId}:${data.requestId}` : undefined;
  if (walkInKey) {
    const existing = await Appointment.findOne({ clinicId: req.clinicId, requestKey: walkInKey });
    if (existing) return res.status(200).json(existing);
  }

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
    // PHASE 4 — the doctor's OWN working hours (optional; narrower than the clinic's, which were already checked above).
    const doctorTiming = checkDoctorTiming(doctor.workingHours, startAt, duration);
    if (doctorTiming) return res.status(400).json({ message: doctorTiming.message, code: doctorTiming.code });
  }

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

  const doc = {
    clinicId: req.clinicId,
    patientId: data.patientId,
    doctorId: data.doctorId,
    startAt,
    duration,
    source: data.source ?? "dashboard",
    visitType: data.visitType,
    procedureNote: data.visitType === "procedure" ? data.procedureNote?.trim() : undefined,
    visitNote: isWalkIn ? data.reason?.trim() || undefined : undefined,
  };

  if (!isWalkIn) {
    // PHASE 4 — createdBy is recorded for every appointment (who booked it); it is audit data, never the treating doctor.
    const appointment = await Appointment.create({ ...doc, createdBy: req.userId });
    return res.status(201).json(appointment);
  }

  // ==== PHASE 3.5 — Walk-in persistence ====
  // `startAt` is the EXACT check-in instant (server clock, millisecond precision) — never rounded to the slot grid.
  // `source: "walk_in"` is the explicit marker; `createdBy` is the receptionist/doctor who registered it.
  //
  // Double-submit protection, in two layers:
  //   1. requestKey (unique, sparse): the same dialog submitting twice — even truly in parallel — can only insert once;
  //      the loser of the race gets the winner's record back.
  //   2. no token (older client): the same patient + doctor registered as a walk-in within the last 10 seconds is the
  //      same click, not a new visit. Anything later is a legitimate repeat visit and is NOT blocked.
  if (!walkInKey) {
    const recent = await Appointment.findOne({
      clinicId: req.clinicId,
      patientId: data.patientId,
      doctorId: data.doctorId,
      source: "walk_in",
      status: { $in: ["scheduled", "confirmed"] },
      createdAt: { $gte: new Date(Date.now() - 10_000) },
    });
    if (recent) return res.status(200).json(recent);
  }

  // The partial unique index (clinic, doctor, startAt) also covers walk-ins; two walk-ins for one doctor landing in the
  // very same millisecond would collide on it, so a collision on THAT index nudges the instant by 1 ms (invisible).
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const appointment = await Appointment.create({
        ...doc,
        startAt: new Date(startAt.getTime() + attempt),
        createdBy: req.userId,
        ...(walkInKey ? { requestKey: walkInKey } : {}),
      });
      return res.status(201).json(appointment);
    } catch (err) {
      if ((err as { code?: number })?.code !== 11000) throw err;
      if (walkInKey) {
        const winner = await Appointment.findOne({ clinicId: req.clinicId, requestKey: walkInKey });
        if (winner) return res.status(200).json(winner);
      }
    }
  }
  return res.status(409).json({ message: "Could not register the walk-in, please try again", code: "WALKIN_RETRY" });
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
  assertWritableDoctor(resolveDataScope(req, "appointments"), data.doctorId); // a doctor blocks only their own time

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
    createdBy: req.userId,
  });

  return res.status(201).json(block);
});

export const listAppointments = asyncHandler(async (req: Request, res: Response) => {
  // PHASE 4 — the schedule board: a doctor sees their own appointments; owner / receptionist see the clinic and may narrow with
  // ?doctorId=. (A doctor asking for another doctor's id is a 403.) A request scoped to ONE PATIENT (?patientId=) is the patient
  // file's visit history — shared clinical data per clinic (Phase 3) — so it is not narrowed by doctor.
  const scope = resolveDataScope(req, "appointments", req.query.doctorId);
  if (scope.unassigned) throw new PolicyError(400, "INVALID_DOCTOR", "Invalid doctor id");
  const filter: Record<string, any> = { clinicId: req.clinicId };
  if (!(scope.level === "self" && req.query.patientId)) Object.assign(filter, doctorMatch(scope));

  if (req.query.date) {
    // "?date=YYYY-MM-DD" means that calendar day on the CLINIC's wall clock
    // (Asia/Amman), converted to UTC bounds — never `new Date("YYYY-MM-DD")`
    // (UTC midnight) plus server-local `setDate`, which shifted the window by
    // the clinic's UTC offset and put e.g. Oct 9 00:30 under Oct 8.
    // A full ISO instant is still accepted (resolved to the clinic day it
    // falls on) so any older caller keeps working; anything else is a 400
    // instead of the previous cast error.
    const raw = String(req.query.date);
    let ymd: string | null = null;
    if (isValidYmd(raw)) {
      ymd = raw;
    } else if (raw.includes("T")) {
      // Only a full ISO date-time is treated as an instant. A bare date-like
      // string that failed isValidYmd (e.g. "2026-02-30") must NOT reach
      // `new Date()`, because V8 silently rolls it over to March 2.
      const instant = new Date(raw);
      if (!isNaN(instant.getTime())) ymd = clinicYmdOf(instant);
    }
    if (!ymd) {
      return res.status(400).json({ message: "Invalid date, use YYYY-MM-DD" });
    }
    const { start, end } = clinicDayRange(ymd);
    filter.startAt = { $gte: start, $lt: end };
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

  // PHASE 4 — a doctor can change only their own appointments (another doctor's is the same 404 as an unknown id) and cannot
  // hand one to a different doctor; reassignment is for the owner / receptionist.
  const scope = resolveDataScope(req, "appointments");
  if (scope.level === "self" && String(appointment.doctorId) !== scope.userId) return res.status(404).json({ message: "Appointment not found" });
  assertWritableDoctor(scope, data.doctorId);

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

    // PHASE 3.5 — a WALK-IN is a visit that already happened/is happening: its check-in time is a fact, not a
    // reservation. Assigning / changing its doctor, or reactivating it (cancelled -> scheduled), must not be judged by
    // "can this FUTURE slot be booked?" (that rejected every such edit with PAST_TIME). Only an attempt to actually MOVE
    // it in time (new startAt / duration) still goes through the full scheduling rules below, exactly as before.
    const timeMoved =
      (data.startAt !== undefined && nextStartAt.getTime() !== appointment.startAt.getTime()) ||
      (data.duration !== undefined && nextDuration !== appointment.duration);
    const walkInKeepsItsTime = appointment.source === "walk_in" && !timeMoved;

    if (!walkInKeepsItsTime) {
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
      // PHASE 4 — the (possibly new) doctor's own working hours, for a real appointment being moved / reassigned / reactivated.
      if (appointment.type !== "blocked") {
        const target = await User.findOne({ _id: nextDoctorId, clinicId: req.clinicId, role: "doctor" }).select("workingHours");
        const doctorTiming = checkDoctorTiming(target?.workingHours, nextStartAt, nextDuration);
        if (doctorTiming) return res.status(400).json({ message: doctorTiming.message, code: doctorTiming.code });
      }

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
    { _id: req.params.id, clinicId: req.clinicId, ...doctorMatch(scope) },
    { $set: set },
    { new: true }
  );

  if (!updated) return res.status(404).json({ message: "Appointment not found" });

  // ClinicOS Loyalty: entering "completed" may earn visit points; leaving it reverses them. The hook never throws
  // and never changes the appointment — it only reacts to a status change that really happened.
  if (data.status !== undefined && data.status !== appointment.status) {
    await onAppointmentStatusChange(appointment.status, updated, req.userId);
  }
  return res.json(updated);
});

/**
 * PATCH /api/appointments/:id/read — mark a single notification as read
 * for the current user.
 */
export const markRead = asyncHandler(async (req: Request, res: Response) => {
  const scope = resolveDataScope(req, "appointments");
  const appointment = await Appointment.findOneAndUpdate(
    { _id: req.params.id, clinicId: req.clinicId, ...doctorMatch(scope) },
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
  const scope = resolveDataScope(req, "appointments");
  const result = await Appointment.updateMany(
    {
      clinicId: req.clinicId,
      ...doctorMatch(scope),
      source: "public",
      status: "scheduled",
      readBy: { $ne: req.userId },
    },
    { $addToSet: { readBy: req.userId } }
  );
  return res.json({ modifiedCount: result.modifiedCount });
});
