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

  const start = new Date(`${dateStr}T00:00:00+03:00`);
  const end = new Date(`${dateStr}T23:59:59.999+03:00`);

  return { start, end, dateStr };
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
