// CLINICOS CONNECT (C2) — display times on the CLINIC's wall clock (same rule as the rest of ClinicOS, lib/dates.ts).
import { CLINIC_TIMEZONE, ymd, addDaysYmd } from "../dates";

type Lang = "en" | "ar";
const locale = (lang: Lang) => (lang === "ar" ? "ar-u-nu-latn" : "en-US"); // Latin digits in Arabic, like the rest of the app's numbers

const clockCache = new Map<string, Intl.DateTimeFormat>();
function clockFmt(lang: Lang): Intl.DateTimeFormat {
  let f = clockCache.get(lang);
  if (!f) {
    f = new Intl.DateTimeFormat(locale(lang), { timeZone: CLINIC_TIMEZONE, hour: "numeric", minute: "2-digit", hour12: true });
    clockCache.set(lang, f);
  }
  return f;
}

/** "2:30 PM" / "2:30 م" */
export const fmtClock = (iso: string | Date, lang: Lang): string => clockFmt(lang).format(typeof iso === "string" ? new Date(iso) : iso);

export type DayKind = "today" | "yesterday" | "date";

/** Which calendar day (clinic time) an instant is, relative to `now`. */
export function dayKind(iso: string | Date, now: Date = new Date()): DayKind {
  const day = ymd(iso);
  const today = ymd(now);
  if (day === today) return "today";
  if (day === addDaysYmd(today, -1)) return "yesterday";
  return "date";
}

export const dayKey = (iso: string | Date): string => ymd(iso);

/** "Mon, Oct 5" / the Arabic equivalent, with the year when it is not the current one. */
export function fmtDay(iso: string | Date, lang: Lang, now: Date = new Date()): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const sameYear = ymd(d).slice(0, 4) === ymd(now).slice(0, 4);
  return d.toLocaleDateString(locale(lang), {
    timeZone: CLINIC_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Conversation-list time: the clock for today, otherwise a short date. Labels come from the caller (they live in the i18n dictionary). */
export function fmtListTime(iso: string | Date, lang: Lang, labels: { yesterday: string }, now: Date = new Date()): string {
  const kind = dayKind(iso, now);
  if (kind === "today") return fmtClock(iso, lang);
  if (kind === "yesterday") return labels.yesterday;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString(locale(lang), { timeZone: CLINIC_TIMEZONE, month: "short", day: "numeric" });
}
