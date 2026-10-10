/**
 * Date/time utilities — the app treats every appointment time as a *wall-clock*
 * time on the CLINIC'S calendar (Asia/Amman today), never the browser's.
 *
 * Storage in MongoDB is always an absolute UTC instant (`toISOString()`), and
 * "appointments on October 9" means October 9 on the clinic's wall clock. So
 * every conversion between an instant and a clinic-local day / time goes through
 * the helpers in THIS file, which use the clinic timezone explicitly through
 * `Intl` — a doctor travelling, or a laptop set to another timezone, must not
 * move an appointment to a different hour or day. Mirrors
 * backEnd/src/utils/timezone.ts.
 *
 * The clinic timezone is a single constant today; when it becomes a per-clinic
 * setting only `CLINIC_TIMEZONE` (or the optional `timeZone` arguments) changes.
 */

/** Default clinic timezone (Jordan). The only place this literal lives on the frontend. */
export const CLINIC_TIMEZONE = "Asia/Amman";

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^(\d{2}):(\d{2})$/;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone);
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
    fmtCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in `timeZone`. */
function zonedParts(d: Date, timeZone: string) {
  const parts = zonedFormatter(timeZone).formatToParts(d);
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

const toDate = (iso: string | Date): Date => (typeof iso === "string" ? new Date(iso) : iso);

/** True only for a real calendar date written exactly "YYYY-MM-DD" (rejects "2026-02-30"). */
export const isValidYmd = (value: string): boolean => {
  const m = YMD_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
};

/** Splits a valid "YYYY-MM-DD" into numbers (month is 1-12). */
export const parseYmd = (value: string): { y: number; m: number; d: number } => {
  if (!isValidYmd(value)) throw new RangeError(`Invalid date "${value}"`);
  const m = YMD_RE.exec(value)!;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
};

/** Builds "YYYY-MM-DD" from numbers (month 1-12). Does not validate or roll over. */
export const makeYmd = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** "YYYY-MM-DD" + `days` — pure calendar arithmetic (no timezone involved); month/year rollover safe. */
export const addDaysYmd = (value: string, days: number): string => {
  const { y, m, d } = parseYmd(value);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return makeYmd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};

/** "YYYY-MM-DD" + `months`, clamping the day to the target month's length (Jan 31 + 1 month = Feb 28/29). */
export const addMonthsYmd = (value: string, months: number): string => {
  const { y, m, d } = parseYmd(value);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return makeYmd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
};

/** Number of days in month `m` (1-12) of year `y`. */
export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Day of week (0=Sun..6=Sat) of a calendar date — independent of any timezone. */
export const weekdayOfYmd = (value: string): number => {
  const { y, m, d } = parseYmd(value);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

/**
 * A `Date` that represents the calendar day `value` for DISPLAY purposes only:
 * UTC midnight of that date. Always format it with `timeZone: "UTC"` (see
 * `fmtCalendarDate`) so the browser's own timezone can never shift the day.
 */
export const calendarDate = (value: string): Date => {
  const { y, m, d } = parseYmd(value);
  return new Date(Date.UTC(y, m - 1, d));
};

/** Locale-formatted calendar date for a "YYYY-MM-DD" string, e.g. "October 2026" — immune to the browser timezone. */
export const fmtCalendarDate = (
  value: string,
  lang: "en" | "ar" = "en",
  opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }
): string => calendarDate(value).toLocaleDateString(lang === "ar" ? "ar" : undefined, { ...opts, timeZone: "UTC" });

/**
 * The UTC instant at which the clinic wall clock reads `date` `time`.
 * Uses the zone's real offset at that moment (guess, measure, correct) rather
 * than a hard-coded "+03:00", and never relies on how the BROWSER parses a
 * zone-less date string.
 */
export const clinicLocalToUtc = (date: string, time: string = "00:00", timeZone: string = CLINIC_TIMEZONE): Date => {
  const d = YMD_RE.exec(date);
  const t = HHMM_RE.exec(time);
  if (!d || !t || !isValidYmd(date)) throw new RangeError(`Invalid clinic-local date/time "${date} ${time}"`);
  const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2]));
  const offsetAt = (instant: Date) => {
    const p = zonedParts(instant, timeZone);
    const whole = instant.getTime() - instant.getUTCMilliseconds();
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - whole;
  };
  let utc = wall - offsetAt(new Date(wall));
  const corrected = wall - offsetAt(new Date(utc));
  if (corrected !== utc) utc = corrected; // landed on the other side of a DST change
  return new Date(utc);
};

/** Format an ISO date/time as "HH:mm" on the clinic's wall clock. */
export const fmtTime = (iso: string | Date): string => {
  const p = zonedParts(toDate(iso), CLINIC_TIMEZONE);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

/**
 * DISPLAY-ONLY: format an ISO date/time as 12-hour clock with AM/PM,
 * e.g. "2:30 PM", on the clinic's wall clock. Never use this for
 * comparisons/matching — use fmtTime (24h "HH:mm") for that, since slot
 * matching relies on that exact format.
 */
export const fmtTime12 = (iso: string | Date): string => {
  return toDate(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true, timeZone: CLINIC_TIMEZONE });
};

/**
 * DISPLAY-ONLY: convert a raw 24h "HH:mm" string (like the ones used
 * internally for slot grids) into a 12-hour "h:mm AM/PM" string.
 * The underlying "HH:mm" value should still be used for state/matching —
 * only wrap the rendered label with this.
 */
export const to12h = (hhmm: string): string => {
  const [hStr, mStr] = hhmm.split(":");
  const h24 = Number(hStr);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const period = h24 < 12 ? "AM" : "PM";
  return `${h12}:${mStr} ${period}`;
};

/** Format an instant as the clinic-local calendar date "YYYY-MM-DD". */
export const ymd = (d: Date | string): string => {
  const p = zonedParts(toDate(d), CLINIC_TIMEZONE);
  return makeYmd(p.year, p.month, p.day);
};

/** Get the day-of-week (0=Sun..6=Sat) of an appointment on the clinic's calendar. */
export const dayOfWeek = (iso: string | Date): number => weekdayOfYmd(ymd(iso));

/** Format an ISO string as a friendly date like "Sun 12 Jul" (clinic calendar). */
export const fmtDate = (
  iso: string | Date,
  lang: "en" | "ar" = "en",
  opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }
): string => {
  return toDate(iso).toLocaleDateString(lang === "ar" ? "ar" : undefined, { timeZone: CLINIC_TIMEZONE, ...opts });
};

/** Return YYYY-MM-DD for "today" on the clinic's calendar. */
export const todayLocal = (): string => ymd(new Date());

/**
 * Combine YYYY-MM-DD + HH:mm into an ISO UTC string.
 * Treats the time as WALL-CLOCK time on the clinic's calendar.
 * Example: for the Jordan clinic (UTC+3), combineToUTC("2026-07-13", "12:00")
 *   returns "2026-07-13T09:00:00.000Z" (12:00 Jordan = 09:00 UTC)
 */
export const combineToUTC = (date: string, time: string): string => clinicLocalToUtc(date, time).toISOString();

/** Start of the current week (Sunday-based) as a local Date. */
export const weekStart = (base: Date = new Date(), offset: number = 0): Date => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const day = d.getDay();
  d.setDate(d.getDate() - day + offset * 7);
  return d;
};

/** True if the given YYYY-MM-DD is before today (clinic calendar). */
export const isPastDate = (date: string): boolean => {
  return date < todayLocal();
};
