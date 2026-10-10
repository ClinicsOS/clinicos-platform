"use client";
// PHASE 6 — Analytics Center: types, filter → query-string, fetch hook, formatting. PRESENTATION ONLY.
// Every number shown comes from /api/analytics/* (backend aggregations over ClinicOS source data). Nothing here sums, averages or
// attributes money / visits in the browser; the only arithmetic is formatting (rounding, sign, percent text).
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { procedureLabel as dermLabel } from "@/lib/derm/procedures";

export const PRESETS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "last_30", "this_year", "custom"] as const;
export type Preset = (typeof PRESETS)[number];
export type SectionId = "overview" | "financial" | "appointments" | "patients" | "treatments" | "doctors" | "expenses" | "loyalty";

export interface Filters {
  preset: Preset;
  from: string; // YYYY-MM-DD (custom only)
  to: string;
  doctorId: string; // "" = whole clinic (owner only; ignored for doctors — the server uses their own id)
  compare: boolean;
}
export const DEFAULT_FILTERS: Filters = { preset: "this_month", from: "", to: "", doctorId: "", compare: true };

export type ChangeState = "new" | "none" | "up" | "down" | "flat";
export interface Cmp { current: number | null; previous: number | null; diff: number | null; pct: number | null; state: ChangeState }
export type Json = Record<string, any>;

export interface Meta {
  sections: SectionId[];
  role: string;
  scope: { level: "clinic" | "self"; doctorId: string | null; clinicWide: boolean };
  canCompareDoctors: boolean;
  treatmentKind: "dental" | "derm" | null;
  presets: Preset[];
  maxRangeDays: number;
  timeZone: string;
  today: string;
  range: { from: string; to: string };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** true when the custom range is something the server will accept (it re-validates; this only avoids pointless requests). */
export function filtersValid(f: Filters): boolean {
  if (f.preset !== "custom") return true;
  if (!YMD.test(f.from) || !YMD.test(f.to) || f.from > f.to) return false;
  const days = (Date.parse(f.to + "T00:00:00Z") - Date.parse(f.from + "T00:00:00Z")) / 86_400_000 + 1;
  return days <= 366;
}

export function filterQuery(f: Filters, owner: boolean): string {
  const p = new URLSearchParams();
  p.set("preset", f.preset);
  if (f.preset === "custom") { p.set("from", f.from); p.set("to", f.to); }
  if (owner && f.doctorId) p.set("doctorId", f.doctorId);
  p.set("compare", f.compare ? "1" : "0");
  return p.toString();
}

export function useAnalytics<T = Json>(section: SectionId, f: Filters, owner: boolean, enabled = true) {
  const qs = filterQuery(f, owner);
  return useQuery({
    queryKey: ["analytics", section, qs],
    queryFn: async () => (await api.get<T>(`/analytics/${section}?${qs}`)).data,
    enabled: enabled && filtersValid(f),
    retry: false,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

export function useAnalyticsMeta(enabled = true) {
  return useQuery({
    queryKey: ["analytics", "meta"],
    queryFn: async () => (await api.get<Meta>("/analytics/meta")).data,
    enabled,
    retry: false,
    staleTime: 60_000,
  });
}

/** Authenticated CSV download of the SAME section / filters the screen shows (the server builds it from the same payload). */
export async function downloadExport(section: SectionId, f: Filters, owner: boolean): Promise<void> {
  const res = await api.get<Blob>(`/analytics/export?section=${section}&format=csv&${filterQuery(f, owner)}`, { responseType: "blob" });
  const disposition = String(res.headers["content-disposition"] ?? "");
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `clinicos-${section}.csv`;
  const url = URL.createObjectURL(res.data);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ───────────────────────────── formatting ─────────────────────────────
const nf = (max: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: max });
export const num = (n: number | null | undefined, max = 0) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : nf(max).format(n));
/** JD with up to 3 decimals (fils), no trailing zeros — matches the Expenses page. */
export const jd = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : nf(3).format(Math.round(n * 1000) / 1000));
export const pct = (n: number | null | undefined, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${nf(d).format(n)}%`);

/** "2026-09" / "2026-W36"-free keys: day "2026-09-05", week "2026-08-30" (week start), month "2026-09". */
export function bucketLabel(key: string, granularity: string, lang: "en" | "ar"): string {
  const loc = lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB";
  if (granularity === "month" || /^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split("-").map(Number);
    return new Intl.DateTimeFormat(loc, { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
  }
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** A chart is only worth drawing when something is non-zero. */
export const hasSignal = (rows: Json[] | undefined | null, keys: string[]) => !!rows && rows.some((r) => keys.some((k) => Number(r[k]) > 0 || Number(r[k]) < 0));

export const CHART = { teal: "#4FC3B8", blue: "#3B9DE8", sky: "#6FBDF5", amber: "#F2B44E", red: "#E5645E", violet: "#9B8AE6", grey: "#8FB3CC" };

/** Human name of a treatment code for the clinic's specialty (dental → dn.p.<code> in i18n, dermatology → its catalogue label). */
export function procName(kind: "dental" | "derm" | null | undefined, code: string, t: (k: string) => string, lang: "en" | "ar"): string {
  if (kind === "derm") return dermLabel(code, lang);
  const s = t(`dn.p.${code}`);
  return s === `dn.p.${code}` ? code : s;
}
