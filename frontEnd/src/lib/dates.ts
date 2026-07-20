/**
 * Date/time utilities — the app treats every appointment time as a *wall-clock*
 * time in the user's local timezone (Jordan / whatever the browser reports).
 *
 * Storage in MongoDB is always ISO UTC (that's how `toISOString()` works),
 * but every display and comparison uses local time — so a Jordan clinic's
 * "10:30" is always shown as 10:30, and "past-time" checks compare against
 * the user's local clock.
 */

/** Format an ISO date/time as "HH:mm" in the user's local timezone. */
export const fmtTime = (iso: string | Date): string => {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
};

/** Format a Date as "YYYY-MM-DD" using local timezone. */
export const ymd = (d: Date | string): string => {
  const dd = typeof d === "string" ? new Date(d) : d;
  return `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`;
};

/** Get the day-of-week (0=Sun..6=Sat) for an appointment (local). */
export const dayOfWeek = (iso: string | Date): number => {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.getDay();
};

/** Format an ISO string as a friendly date like "Sun 12 Jul" (local). */
export const fmtDate = (
  iso: string | Date,
  lang: "en" | "ar" = "en",
  opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }
): string => {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString(lang === "ar" ? "ar" : undefined, opts);
};

/** Return YYYY-MM-DD for "today" in the user's local timezone. */
export const todayLocal = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/**
 * Combine YYYY-MM-DD + HH:mm into an ISO UTC string.
 * Treats the time as WALL-CLOCK time in the user's local timezone.
 * Example: in Jordan (UTC+3), combineToUTC("2026-07-13", "12:00")
 *   returns "2026-07-13T09:00:00.000Z" (12:00 Jordan = 09:00 UTC)
 */
export const combineToUTC = (date: string, time: string): string => {
  const local = new Date(`${date}T${time}:00`);
  return local.toISOString();
};

/** Start of the current week (Sunday-based) as a local Date. */
export const weekStart = (base: Date = new Date(), offset: number = 0): Date => {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  const day = d.getDay();
  d.setDate(d.getDate() - day + offset * 7);
  return d;
};

/** True if the given YYYY-MM-DD is before today (local). */
export const isPastDate = (date: string): boolean => {
  return date < todayLocal();
};
