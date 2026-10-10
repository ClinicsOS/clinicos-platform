import { timeToMinutes, intervalsOverlap, isValidWorkingRange, localDayOfWeek } from "../utils/workingHoursTime";
import { DEFAULT_CLINIC_TIMEZONE } from "../utils/timezone";
import type { RuleViolation } from "./appointmentRules";

/**
 * PHASE 4 — per-doctor working hours (OPTIONAL; extends the Phase 1 availability rules, replaces nothing).
 *
 * A doctor may have their own weekly hours (User.workingHours, 7 entries). They only ever NARROW the clinic's hours:
 *   - the clinic's rules (closed day, working hours, break) always still apply — checkAppointmentTiming runs first, unchanged;
 *   - these doctor rules are checked IN ADDITION, so the effective availability is the intersection of the two;
 *   - a doctor without their own hours simply follows the clinic (every function here returns null = "no extra restriction").
 * One implementation serves the dashboard create/reschedule, public booking, the public slot list and the AI booking tool.
 * A walk-in is a visit that already happened and never goes through these checks (Phase 3.5).
 */
export interface DayHours { day: number; isOpen: boolean; from: string; to: string; breakFrom?: string; breakTo?: string }

const wallMinutes = (at: Date): number => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: DEFAULT_CLINIC_TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
  return timeToMinutes(`${parts.find((p) => p.type === "hour")!.value}:${parts.find((p) => p.type === "minute")!.value}`);
};

/** Does the doctor's own schedule allow [startMin, endMin) on weekday `dow` (clinic-local)? null = yes / no restriction. */
export function doctorAllowsInterval(hours: DayHours[] | undefined | null, dow: number, startMin: number, endMin: number): RuleViolation | null {
  if (!hours || !hours.length) return null;
  const day = hours.find((d) => d.day === dow);
  if (!day) return null;
  if (!day.isOpen) return { code: "DOCTOR_DAY_OFF", message: "This doctor is not available on this day" };
  if (startMin < timeToMinutes(day.from) || endMin > timeToMinutes(day.to, { endOfDay: true })) {
    return { code: "DOCTOR_OUTSIDE_HOURS", message: "This appointment does not fit within the doctor's working hours" };
  }
  if (day.breakFrom && day.breakTo) {
    const bs = timeToMinutes(day.breakFrom);
    const be = timeToMinutes(day.breakTo, { endOfDay: true });
    if (bs < be && intervalsOverlap(startMin, endMin, bs, be)) {
      return { code: "DOCTOR_BREAK_TIME", message: "This time falls within the doctor's break — please pick another slot" };
    }
  }
  return null;
}

/** The instant-based form used by create / reschedule / public booking. */
export function checkDoctorTiming(hours: DayHours[] | undefined | null, startAt: Date, duration: number): RuleViolation | null {
  if (!hours || !hours.length || isNaN(startAt.getTime())) return null;
  const start = wallMinutes(startAt);
  return doctorAllowsInterval(hours, localDayOfWeek(startAt), start, start + duration);
}

/**
 * Validates a doctor's weekly hours before saving. Same rules as the clinic's hours (valid ranges, break inside the day) plus:
 * a doctor can only be available when the clinic is open, inside the clinic's window for that day. Returns an error text or null.
 */
export function validateDoctorHours(hours: DayHours[], clinicHours: DayHours[]): string | null {
  if (hours.length !== 7 || new Set(hours.map((h) => h.day)).size !== 7) return "Working hours must have exactly one entry for each day of the week";
  for (const h of hours) {
    if (!h.isOpen) continue;
    if (!isValidWorkingRange(h.from, h.to)) return `Invalid hours for day ${h.day}: 'from' must be before 'to'`;
    if ((h.breakFrom && !h.breakTo) || (!h.breakFrom && h.breakTo)) return `Invalid break for day ${h.day}: both break start and break end are required`;
    const open = timeToMinutes(h.from), close = timeToMinutes(h.to, { endOfDay: true });
    if (h.breakFrom && h.breakTo) {
      const bs = timeToMinutes(h.breakFrom), be = timeToMinutes(h.breakTo, { endOfDay: true });
      if (!(open <= bs && bs < be && be <= close)) return `Invalid break for day ${h.day}: break must fall within working hours`;
    }
    const c = clinicHours.find((x) => x.day === h.day);
    if (!c || !c.isOpen) return `The clinic is closed on day ${h.day}`;
    if (open < timeToMinutes(c.from) || close > timeToMinutes(c.to, { endOfDay: true })) return `Day ${h.day}: the doctor's hours must be within the clinic's opening hours (${c.from}–${c.to})`;
  }
  return null;
}
