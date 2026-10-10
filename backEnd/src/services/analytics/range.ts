import { PolicyError } from "../../auth/policy";
import { DEFAULT_CLINIC_TIMEZONE, addDaysYmd, clinicLocalToUtc, clinicYmdOf, isValidYmd } from "../../utils/timezone";

/**
 * PHASE 6 — the ONE place that turns "Today / This month / Custom…" into clinic-local calendar ranges.
 *
 *  • Every boundary is a clinic-local calendar day converted with utils/timezone.ts (clinicLocalToUtc) — never a raw UTC day and never
 *    a hard-coded "+03:00". A range is stored as inclusive YMD strings (`from`, `to`) AND as the half-open UTC interval [start, end),
 *    where `end` is the start of the clinic day AFTER `to`. A 00:00 record belongs to the new day, 23:59 to the old one.
 *  • The comparison ("previous") period is computed here too, so every section compares against exactly the same window.
 *  • The client may only send strings; anything else (objects from ?from[$ne]=x, arrays) is a 400.
 */

export const PRESETS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "last_30", "this_year", "custom"] as const;
export type Preset = (typeof PRESETS)[number];
export type Granularity = "day" | "week" | "month";

export const MAX_RANGE_DAYS = 366;
/** Weeks start on Sunday (the Jordanian working week is Sunday–Thursday). */
export const WEEK_STARTS_ON = 0;

export interface DateRange {
  from: string; // YYYY-MM-DD, inclusive, clinic-local
  to: string; // YYYY-MM-DD, inclusive, clinic-local
  start: Date; // UTC instant of 00:00 clinic-local on `from`
  end: Date; // UTC instant of 00:00 clinic-local on the day AFTER `to` (exclusive)
  days: number;
}
export interface ResolvedRanges {
  preset: Preset;
  timeZone: string;
  today: string;
  current: DateRange;
  previous: DateRange;
  granularity: Granularity;
  /** how the previous period was derived (shown to the user next to every comparison) */
  comparisonBasis: "previous_day" | "previous_week" | "previous_month" | "previous_year" | "preceding_days";
}

const pad = (n: number) => String(n).padStart(2, "0");
const parts = (ymd: string) => ({ y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)), d: Number(ymd.slice(8, 10)) });
const ymdOf = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${pad(m)}-${pad(d)}`;
const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const utcDay = (ymd: string) => Date.UTC(parts(ymd).y, parts(ymd).m - 1, parts(ymd).d);
const diffDays = (a: string, b: string) => Math.round((utcDay(b) - utcDay(a)) / 86_400_000);
/** 0 = Sunday … 6 = Saturday of a calendar date (pure calendar maths). */
export const weekdayOf = (ymd: string) => new Date(Date.UTC(parts(ymd).y, parts(ymd).m - 1, parts(ymd).d)).getUTCDay();
const addMonths = (ymd: string, n: number) => {
  const { y, m } = parts(ymd);
  const t = m - 1 + n;
  return { y: y + Math.floor(t / 12), m: ((t % 12) + 12) % 12 + 1 };
};
const weekStartOf = (ymd: string) => addDaysYmd(ymd, -((weekdayOf(ymd) - WEEK_STARTS_ON + 7) % 7));

function mk(from: string, to: string, tz: string): DateRange {
  return { from, to, start: clinicLocalToUtc(from, "00:00", tz), end: clinicLocalToUtc(addDaysYmd(to, 1), "00:00", tz), days: diffDays(from, to) + 1 };
}

const str = (v: unknown, name: string): string | undefined => {
  if (v === undefined || v === "") return undefined;
  if (typeof v !== "string") throw new PolicyError(400, "INVALID_DATE", `Invalid ${name}`);
  return v.trim();
};

/** Resolves a request's (preset | from+to) against the clinic-local calendar. `now` is injectable for tests. */
export function resolveRanges(q: { preset?: unknown; from?: unknown; to?: unknown }, now: Date = new Date(), tz: string = DEFAULT_CLINIC_TIMEZONE): ResolvedRanges {
  const presetIn = str(q.preset, "preset");
  const fromIn = str(q.from, "from");
  const toIn = str(q.to, "to");
  let preset: Preset;
  if (presetIn) {
    if (!(PRESETS as readonly string[]).includes(presetIn)) throw new PolicyError(400, "INVALID_PRESET", "Unknown date preset");
    preset = presetIn as Preset;
  } else preset = fromIn || toIn ? "custom" : "this_month";

  const today = clinicYmdOf(now, tz);
  const T = parts(today);
  let from: string;
  let to: string;
  let prev: { from: string; to: string };
  let basis: ResolvedRanges["comparisonBasis"] = "preceding_days";

  const preceding = (f: string, t: string) => {
    const n = diffDays(f, t) + 1;
    return { from: addDaysYmd(f, -n), to: addDaysYmd(f, -1) };
  };
  const monthSpan = (y: number, m: number, uptoDay: number) => ({ from: ymdOf(y, m, 1), to: ymdOf(y, m, Math.min(uptoDay, lastDayOf(y, m))) });

  switch (preset) {
    case "today":
      from = to = today;
      prev = { from: addDaysYmd(today, -1), to: addDaysYmd(today, -1) };
      basis = "previous_day";
      break;
    case "yesterday":
      from = to = addDaysYmd(today, -1);
      prev = { from: addDaysYmd(today, -2), to: addDaysYmd(today, -2) };
      basis = "previous_day";
      break;
    case "this_week": {
      from = weekStartOf(today);
      to = today;
      const n = diffDays(from, to); // elapsed days within the week
      const pf = addDaysYmd(from, -7);
      prev = { from: pf, to: addDaysYmd(pf, n) }; // same elapsed days of last week
      basis = "previous_week";
      break;
    }
    case "last_week": {
      const ws = addDaysYmd(weekStartOf(today), -7);
      from = ws;
      to = addDaysYmd(ws, 6);
      prev = { from: addDaysYmd(ws, -7), to: addDaysYmd(ws, -1) };
      basis = "previous_week";
      break;
    }
    case "this_month": {
      from = ymdOf(T.y, T.m, 1);
      to = today;
      const p = addMonths(from, -1);
      prev = monthSpan(p.y, p.m, T.d); // same elapsed days of the previous month
      basis = "previous_month";
      break;
    }
    case "last_month": {
      const p = addMonths(ymdOf(T.y, T.m, 1), -1);
      from = ymdOf(p.y, p.m, 1);
      to = ymdOf(p.y, p.m, lastDayOf(p.y, p.m));
      const pp = addMonths(from, -1);
      prev = monthSpan(pp.y, pp.m, 31);
      basis = "previous_month";
      break;
    }
    case "last_30":
      to = today;
      from = addDaysYmd(today, -29);
      prev = preceding(from, to);
      break;
    case "this_year": {
      from = ymdOf(T.y, 1, 1);
      to = today;
      const py = T.y - 1;
      prev = { from: ymdOf(py, 1, 1), to: ymdOf(py, T.m, Math.min(T.d, lastDayOf(py, T.m))) };
      basis = "previous_year";
      break;
    }
    default: {
      if (!fromIn || !toIn) throw new PolicyError(400, "INVALID_DATE", "A custom range needs both from and to (YYYY-MM-DD)");
      if (!isValidYmd(fromIn) || !isValidYmd(toIn)) throw new PolicyError(400, "INVALID_DATE", "Invalid date (YYYY-MM-DD)");
      if (fromIn > toIn) throw new PolicyError(400, "INVALID_DATE", "The start date is after the end date");
      from = fromIn;
      to = toIn;
      const F = parts(from);
      const fullMonth = F.d === 1 && to === ymdOf(F.y, F.m, lastDayOf(F.y, F.m));
      if (fullMonth) {
        const p = addMonths(from, -1);
        prev = monthSpan(p.y, p.m, 31);
        basis = "previous_month";
      } else prev = preceding(from, to);
    }
  }

  const current = mk(from, to, tz);
  if (current.days > MAX_RANGE_DAYS) throw new PolicyError(400, "RANGE_TOO_LARGE", `The date range is limited to ${MAX_RANGE_DAYS} days`);
  const previous = mk(prev.from, prev.to, tz);
  const granularity: Granularity = current.days <= 45 ? "day" : current.days <= 150 ? "week" : "month";
  return { preset, timeZone: tz, today, current, previous, granularity, comparisonBasis: basis };
}

// ───────────────────────────── buckets (time series) ─────────────────────────────

/** Key of the bucket a clinic-local day belongs to: the day itself, the Sunday that starts its week, or "YYYY-MM". */
export function bucketKey(ymd: string, g: Granularity): string {
  if (g === "day") return ymd;
  if (g === "week") return weekStartOf(ymd);
  return ymd.slice(0, 7);
}

/** Every bucket key of the range in order (so a series has NO gaps — an empty day is a real 0, not a missing point). */
export function bucketKeys(r: DateRange, g: Granularity): string[] {
  const keys: string[] = [];
  for (let i = 0; i < r.days; i++) {
    const k = bucketKey(addDaysYmd(r.from, i), g);
    if (keys[keys.length - 1] !== k) keys.push(k);
  }
  return keys;
}

/** Rolls per-day numbers ({ "2026-10-03": 12 }) up into the buckets of `g` and returns a gap-free series. */
export function rollup(perDay: Map<string, number>, r: DateRange, g: Granularity): { key: string; value: number }[] {
  const acc = new Map<string, number>();
  for (const k of bucketKeys(r, g)) acc.set(k, 0);
  perDay.forEach((v, day) => {
    if (day < r.from || day > r.to) return;
    const k = bucketKey(day, g);
    acc.set(k, (acc.get(k) ?? 0) + v);
  });
  return Array.from(acc.entries()).map(([key, value]) => ({ key, value }));
}

export const rangeOut = (r: DateRange) => ({ from: r.from, to: r.to, days: r.days });
