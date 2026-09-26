/**
 * Minute-of-day helper for working-hours interval math — mirrors
 * backEnd/src/utils/workingHoursTime.ts so the dashboard timeline, the
 * "new appointment" time picker, and the public booking grid all agree with
 * the backend on what a working-hours "to" of "00:00" means.
 *
 * A working-hours "to" of "00:00" is ambiguous on its own: as a plain
 * time-of-day it means the START of the day (0 minutes), but a doctor who
 * types "00:00" as a CLOSING time means "open until the end of this day"
 * (1440 minutes / the 24:00 boundary).
 *
 * Callers opt in to that end-of-day interpretation with `{ endOfDay: true }`
 * only where "00:00" genuinely represents the end boundary of a working
 * interval (a working-hours `to`). Every other use (a `from`, a break time)
 * calls it with no options and keeps the normal meaning (0 minutes).
 *
 * Deliberately plain minute-of-day arithmetic — no Date/timezone conversion —
 * so it can't introduce timezone bugs into what is always a wall-clock
 * comparison local to the clinic.
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
 * True when interval [aStart, aEnd) genuinely overlaps [bStart, bEnd).
 * Touching boundaries are NOT an overlap (an appointment ending at 11:00 and
 * one starting at 11:00 are back-to-back, not conflicting). Mirrors the
 * backend's utils/workingHoursTime.ts so the dashboard timeline, the "new
 * appointment" time picker, and the public booking grid agree on this.
 */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
