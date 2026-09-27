import { Types } from "mongoose";
import { Appointment, IAppointment } from "../models/Appointment";
import { intervalsOverlap } from "../utils/workingHoursTime";

/**
 * Finds an existing ACTIVE appointment or block for the same doctor whose
 * real interval — [startAt, startAt + duration) — overlaps the proposed one.
 *
 * This replaces relying on an exact-startAt match (the DB's unique index,
 * and the old `Appointment.findOne({ ..., startAt })` conflict checks):
 * that only ever caught two appointments starting at the identical instant.
 * It missed the actual double-booking hole multi-slot appointments create —
 * e.g. an existing 10:00 appointment with duration=60 occupies 10:00-11:00,
 * but a naive exact-match check happily lets someone else book 10:30, since
 * nothing else starts exactly at 10:30.
 *
 * `startAt`/`duration` are compared as absolute timestamps (milliseconds),
 * not minute-of-day wall-clock — so this needs no midnight-boundary handling
 * of its own; two real time ranges either overlap or they don't, regardless
 * of what calendar day they fall on. (Working-hours/break boundary math,
 * where "00:00" as an end time needs FIX #1's end-of-day treatment, stays in
 * services/appointmentRules.ts — this file only compares appointments to
 * each other.)
 *
 * `excludeAppointmentId` is for a future "reschedule this appointment" flow
 * to exclude the appointment being edited from the check; unused today but
 * kept so this stays correct if that's ever added.
 *
 * FIX #3 — a Walk-in (`source: "walk_in"`) is a VISIT RECORD, not a
 * schedule reservation: the clinic "squeezes it in" between real
 * appointments, so it must never be treated as a blocker here. This is the
 * ONE centralized place that answers "does something else occupy this
 * time?" for every caller (dashboard create/reschedule, public booking,
 * blocks, the AI tool) — excluding walk-ins here is what makes them
 * non-blocking everywhere at once, without scattering source checks across
 * every call site.
 */
export async function findOverlappingAppointment(
  clinicId: Types.ObjectId | string,
  doctorId: Types.ObjectId | string,
  startAt: Date,
  duration: number,
  excludeAppointmentId?: Types.ObjectId | string
): Promise<IAppointment | null> {
  const proposedStart = startAt.getTime();
  const proposedEnd = proposedStart + duration * 60_000;

  // Narrow to a generous window first (cheap, hits the existing
  // {clinicId, doctorId, startAt} index) — no clinic's working day spans
  // more than 24h, so anything starting outside a padded +/-24h window
  // around the proposed appointment can never actually overlap it.
  const windowStart = new Date(proposedStart - 24 * 60 * 60_000);
  const windowEnd = new Date(proposedEnd + 24 * 60 * 60_000);

  const filter: Record<string, unknown> = {
    clinicId,
    doctorId,
    status: { $in: ["scheduled", "confirmed"] },
    // FIX #3 — walk-ins never block; see note above.
    source: { $ne: "walk_in" },
    startAt: { $gte: windowStart, $lt: windowEnd },
  };
  if (excludeAppointmentId) {
    filter._id = { $ne: excludeAppointmentId };
  }

  const candidates = await Appointment.find(filter).select("startAt duration");

  for (const candidate of candidates) {
    const candidateStart = candidate.startAt.getTime();
    const candidateEnd = candidateStart + candidate.duration * 60_000;
    if (intervalsOverlap(proposedStart, proposedEnd, candidateStart, candidateEnd)) {
      return candidate;
    }
  }

  return null;
}
