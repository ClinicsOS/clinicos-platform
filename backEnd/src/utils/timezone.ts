/**
 * Small helpers to work with "today" and wall-clock times in Asia/Amman,
 * regardless of what timezone the server PROCESS itself runs in (Render
 * runs in UTC). Jordan has used a fixed UTC+3 offset with no DST since
 * 2022, so hardcoding "+03:00" here is safe and avoids depending on a
 * server TZ environment variable.
 *
 * NEW FILE — does not touch any existing code.
 */

/**
 * Returns the UTC instants that bound "today" in Asia/Amman, plus the
 * "YYYY-MM-DD" date string, given a reference instant (defaults to now).
 */
export function getAmmanTodayRange(referenceDate: Date = new Date()): {
  start: Date;
  end: Date;
  dateStr: string;
} {
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Amman",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(referenceDate); // "YYYY-MM-DD"

  // PHASE 7 — the day bounds come from the zone's real offset at that date (clinicDayRange), not a hard-coded "+03:00".
  // `end` keeps its historical meaning: the LAST millisecond of the clinic day (callers use $lte / <=).
  const { start, end: nextStart } = clinicDayRange(dateStr);
  const end = new Date(nextStart.getTime() - 1);

  return { start, end, dateStr };
}

// ---------------------------------------------------------------------------
// Clinic-local calendar semantics (appointments core)
// ---------------------------------------------------------------------------
//
// An appointment is an absolute instant (stored as a UTC `Date`). "The
// appointments of October 9" however means October 9 on the CLINIC'S wall
// calendar — never the server's calendar and never the browser's. The helpers
// below are the single place that turns a clinic-local calendar day / wall-clock
// time into UTC instants, so no controller has to hand-roll `new Date("YYYY-MM-DD")`
// (which JavaScript parses as UTC midnight) or `setDate()` (which works in the
// server's timezone).
//
// The clinic timezone is a single constant today. When a per-clinic timezone
// setting is added later, callers only need to pass it as the optional `timeZone`
// argument — nothing else here has to change.

/** Default clinic timezone (Jordan). The only place this literal should live for appointment logic. */
export const DEFAULT_CLINIC_TIMEZONE = "Asia/Amman";

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^(\d{2}):(\d{2})$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23", // never "24:00" at midnight
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of `instant` in `timeZone`. */
function zonedParts(instant: Date, timeZone: string) {
  const parts = zonedFormatter(timeZone).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset (ms) of `timeZone` from UTC at `instant`: local wall clock minus UTC. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSecond = instant.getTime() - instant.getUTCMilliseconds();
  return localAsUtc - wholeSecond;
}

/** True only for a real calendar date written exactly as "YYYY-MM-DD" (rejects "2026-02-30"). */
export function isValidYmd(value: string): boolean {
  const m = YMD_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

/** "YYYY-MM-DD" + `days` (pure calendar arithmetic — no timezone involved). Month/year rollover safe. */
export function addDaysYmd(ymd: string, days: number): string {
  const m = YMD_RE.exec(ymd);
  if (!m || !isValidYmd(ymd)) throw new RangeError(`Invalid date "${ymd}"`);
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads `ymd` `hhmm`
 * (default midnight). Uses the zone's real offset at that moment (guess,
 * measure, correct) instead of a hard-coded "+03:00".
 */
export function clinicLocalToUtc(
  ymd: string,
  hhmm: string = "00:00",
  timeZone: string = DEFAULT_CLINIC_TIMEZONE
): Date {
  const d = YMD_RE.exec(ymd);
  const t = HHMM_RE.exec(hhmm);
  if (!d || !t || !isValidYmd(ymd)) throw new RangeError(`Invalid clinic-local date/time "${ymd} ${hhmm}"`);
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  let utc = wall - zoneOffsetMs(new Date(wall), timeZone);
  const corrected = wall - zoneOffsetMs(new Date(utc), timeZone);
  if (corrected !== utc) utc = corrected; // landed on the other side of a DST change
  return new Date(utc);
}

/**
 * [start, end) UTC bounds of the clinic-local calendar day `ymd`. `end` is the
 * start of the NEXT clinic day (exclusive), so a 00:00 appointment belongs to
 * the new day and 23:59 to the old one — with no 23:59:59.999 off-by-one.
 */
export function clinicDayRange(
  ymd: string,
  timeZone: string = DEFAULT_CLINIC_TIMEZONE
): { start: Date; end: Date } {
  return {
    start: clinicLocalToUtc(ymd, "00:00", timeZone),
    end: clinicLocalToUtc(addDaysYmd(ymd, 1), "00:00", timeZone),
  };
}

/** The clinic-local calendar day ("YYYY-MM-DD") that `instant` falls on. */
export function clinicYmdOf(instant: Date, timeZone: string = DEFAULT_CLINIC_TIMEZONE): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.year).padStart(4, "0")}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/**
 * Formats a Date as "HH:mm" wall-clock time in Asia/Amman.
 * Same technique already used in publicController.ts / appointmentController.ts.
 */
export function formatAmmanTime(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Amman",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = parts.find((p) => p.type === "hour")!.value;
  const m = parts.find((p) => p.type === "minute")!.value;
  return `${h}:${m}`;
}

// ---------------------------------------------------------------------------
// PHASE 7 — "today" / "this month" for the dashboard, the AI assistant and the legacy monthly report.
// ---------------------------------------------------------------------------
// These used to be computed with setUTCHours / Date.UTC, i.e. on the UTC calendar: in Jordan (UTC+3) a payment taken at 00:30 was
// counted on the PREVIOUS day and the dashboard disagreed with the Analytics Center. Everything now goes through the clinic
// timezone helpers above.

/** [start, end) of the clinic-local day that `now` falls on, plus its "YYYY-MM-DD". */
export function clinicTodayRange(now: Date = new Date(), timeZone: string = DEFAULT_CLINIC_TIMEZONE): { start: Date; end: Date; ymd: string } {
  const ymd = clinicYmdOf(now, timeZone);
  return { ...clinicDayRange(ymd, timeZone), ymd };
}

/** [start, end) of clinic-local calendar month `month` (1-12) of `year`. */
export function clinicMonthRange(year: number, month: number, timeZone: string = DEFAULT_CLINIC_TIMEZONE): { start: Date; end: Date } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ny = month === 12 ? year + 1 : year;
  const nm = month === 12 ? 1 : month + 1;
  return {
    start: clinicLocalToUtc(`${String(year).padStart(4, "0")}-${pad(month)}-01`, "00:00", timeZone),
    end: clinicLocalToUtc(`${String(ny).padStart(4, "0")}-${pad(nm)}-01`, "00:00", timeZone),
  };
}

/** The clinic-local { year, month } that `now` falls in. */
export function clinicMonthOf(now: Date = new Date(), timeZone: string = DEFAULT_CLINIC_TIMEZONE): { year: number; month: number } {
  const ymd = clinicYmdOf(now, timeZone);
  return { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)) };
}
