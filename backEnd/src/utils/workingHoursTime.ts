/**
 * Minute-of-day helpers for working-hours interval math.
 *
 * A working-hours "to" of "00:00" is ambiguous on its own: as a plain
 * time-of-day it means the START of the day (0 minutes), but a doctor who
 * types "00:00" as a CLOSING time means "open until the end of this day"
 * (1440 minutes / the 24:00 boundary), not "closes at the moment the day
 * begins".
 *
 * `timeToMinutes` keeps that distinction explicit instead of scattering
 * `if (time === "00:00")` checks through the codebase: callers opt in to the
 * end-of-day interpretation with `{ endOfDay: true }` only where "00:00"
 * genuinely represents the end boundary of a working interval (a working-hours
 * `to`). Every other use (a `from`, a break time, "00:00" as a start time)
 * calls it with no options and keeps the normal meaning (0 minutes).
 *
 * This is deliberately simple minute-of-day arithmetic — no Date/timezone
 * conversion — so it can't introduce UTC/local-time bugs into what is always
 * a wall-clock comparison.
 */
export function timeToMinutes(
  time: string,
  opts?: { endOfDay?: boolean }
): number {
  const [h, m] = time.split(":").map(Number);
  const minutes = h * 60 + m;
  if (opts?.endOfDay && minutes === 0) return 1440;
  return minutes;
}

/**
 * Validates a working-hours `from`/`to` pair for a single day.
 *
 * `to` is interpreted as the END boundary of the interval (so "00:00" means
 * midnight at the end of that day, i.e. 1440), which lets a clinic configure
 * "18:00" -> "00:00" as a valid same-day range ending exactly at midnight.
 *
 * This does NOT enable arbitrary overnight ranges: "09:00" -> "08:00" is
 * still invalid, because 08:00 (not being "00:00") stays 480 minutes, and
 * 540 (09:00) is not before 480. Only an explicit "00:00" end time gets the
 * end-of-day treatment.
 */
export function isValidWorkingRange(from: string, to: string): boolean {
  return timeToMinutes(from) < timeToMinutes(to, { endOfDay: true });
}

/**
 * True when interval [aStart, aEnd) genuinely overlaps [bStart, bEnd).
 *
 * Touching boundaries are NOT an overlap: an appointment ending at 11:00 and
 * one starting at 11:00 are back-to-back, not conflicting (this matters for
 * multi-slot appointments, where "does this occupy that grid cell" and
 * "do these two appointments collide" are both answered by this same check).
 *
 * Deliberately unit-agnostic — the same formula works whether aStart/aEnd/
 * bStart/bEnd are minutes-since-midnight (working-hours/break checks) or
 * absolute millisecond timestamps (appointment-vs-appointment conflict
 * checks), so this one function covers both instead of two near-duplicates.
 */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

const WEEKDAY_SHORT_TO_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * The day-of-week (0=Sun..6=Sat) of `date` in the clinic's local timezone
 * (Asia/Amman) — deliberately NOT `date.getUTCDay()`.
 *
 * getUTCDay() answers "what UTC calendar day is this instant on", which is
 * the wrong question for a wall-clock weekday lookup. Asia/Amman is UTC+3,
 * so any appointment between local 00:00 and 02:59 falls on a UTC calendar
 * date that is still the PREVIOUS day — e.g. Monday 01:00 Amman time is
 * Sunday 22:00 UTC, so `getUTCDay()` on that instant incorrectly reports
 * Sunday(0) instead of Monday(1). Verified concretely: for any instant
 * between UTC 21:00 and 23:59 on a given UTC date, the Amman-local date has
 * already rolled over to the next day while `getUTCDay()` still reports the
 * earlier one. This matters for a clinic configured to open at/near
 * midnight (a working-hours `from` of "00:00"), where exactly this window
 * is the clinic's opening hours.
 */
export function localDayOfWeek(date: Date): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Amman",
    weekday: "short",
  }).format(date);
  return WEEKDAY_SHORT_TO_INDEX[weekday];
}
