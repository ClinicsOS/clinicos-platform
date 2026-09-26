import { PLANS, type Plan } from "../config/plans";
import type { IClinic } from "../models/Clinic";
import { timeToMinutes, intervalsOverlap, localDayOfWeek } from "../utils/workingHoursTime";

/**
 * Single source of truth for appointment business rules, so the human
 * dashboard flow (controllers/appointmentController.ts), public booking
 * (controllers/publicController.ts) and the AI tool
 * (services/ai/tools/dashboard/createAppointment.ts) can never drift apart.
 *
 * Each check returns `null` when the slot is fine, or `{ code, message }`
 * describing the first violation. The messages/codes match what the dashboard
 * controller already returned, so existing frontend handling is unaffected.
 */

export interface RuleViolation {
  code: string;
  message: string;
}

/**
 * Validates the *timing* of a proposed appointment against the clinic's
 * schedule: not in the past, not on a closed day, fits within working hours
 * for its FULL duration (not just its start time), and doesn't overlap a
 * break window.
 *
 * `duration` (minutes) is required — FIX #2 (appointment duration/multi-slot
 * appointments): a 60-minute appointment starting at 23:30 in a clinic that
 * closes at midnight must be rejected even though 23:30 itself is inside
 * working hours, because it would finish at 00:30. The end-of-day boundary
 * ("00:00" as a working-hours `to` meaning 1440, not 0) reuses FIX #1's
 * `timeToMinutes` — this file never recreates that logic independently.
 *
 * The break-window check uses the clinic's local timezone (Asia/Amman) exactly
 * like the public booking + dashboard controllers do.
 */
export function checkAppointmentTiming(
  clinic: IClinic,
  startAt: Date,
  duration: number
): RuleViolation | null {
  // Past time
  if (isNaN(startAt.getTime()) || startAt.getTime() <= Date.now()) {
    return { code: "PAST_TIME", message: "Cannot book a time in the past" };
  }

  // Closed day — uses the clinic's LOCAL (Asia/Amman) calendar day, not the
  // UTC one (FIX #8): getUTCDay() would misidentify the weekday for any
  // appointment between local 00:00 and 02:59.
  const dow = localDayOfWeek(startAt);
  const wh = clinic.workingHours.find((w) => w.day === dow);
  if (!wh || !wh.isOpen) {
    return { code: "DAY_CLOSED", message: "The clinic is closed on this day" };
  }

  // Wall-clock minute-of-day for this appointment's start, in the clinic's
  // local timezone — used for both the hours-fit and break checks below.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Amman",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(startAt);
  const wallTime = `${parts.find((p) => p.type === "hour")!.value}:${
    parts.find((p) => p.type === "minute")!.value
  }`;
  const startMinutes = timeToMinutes(wallTime);
  const endMinutes = startMinutes + duration;

  // Must start at/after opening and finish at/before closing — using FIX #1's
  // end-of-day-aware boundary, so "18:00" -> "00:00" still means 1440, not 0.
  const openMinutes = timeToMinutes(wh.from);
  const closeMinutes = timeToMinutes(wh.to, { endOfDay: true });
  if (startMinutes < openMinutes || endMinutes > closeMinutes) {
    return {
      code: "OUTSIDE_HOURS",
      message:
        "This appointment does not fit within the clinic's working hours",
    };
  }

  // Break window — the FULL appointment interval must not overlap it, not
  // just its start instant (a long appointment can straddle a break even if
  // it doesn't start inside one). Guard against a malformed persisted break
  // (breakFrom >= breakTo) — the settings save path now rejects saving one
  // (FIX #8), but a defensive skip here means a reversed/zero-length pair
  // can never cause an incorrect rejection of an unrelated appointment.
  if (wh.breakFrom && wh.breakTo) {
    const breakStart = timeToMinutes(wh.breakFrom);
    const breakEnd = timeToMinutes(wh.breakTo);
    if (
      breakStart < breakEnd &&
      intervalsOverlap(startMinutes, endMinutes, breakStart, breakEnd)
    ) {
      return {
        code: "BREAK_TIME",
        message:
          "This time falls within the clinic's break — please pick another slot",
      };
    }
  }

  return null;
}

/**
 * Enforces the plan's appointment cap (e.g. the trial's limited number of
 * appointments). `currentCount` is the clinic's current total appointment
 * count, passed in by the caller so this stays a pure function.
 */
export function checkAppointmentPlanCap(
  clinic: IClinic,
  currentCount: number
): RuleViolation | null {
  const limits = PLANS[clinic.plan as Plan];
  if (limits.maxAppointments !== -1 && currentCount >= limits.maxAppointments) {
    return {
      code: "PLAN_LIMIT",
      message: `Trial limit reached (${limits.maxAppointments} appointments) — upgrade to continue`,
    };
  }
  return null;
}
