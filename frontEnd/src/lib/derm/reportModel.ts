import type { DermRegionRef } from "./types";
import type { DermReportData, FollowUp, TreatmentItem, TreatmentSession } from "./treatmentTypes";
import { DOC_FIELDS, groupsFor, type DocGroup } from "./documentation";
import { getProcedure, procedureLabel } from "./procedures";

/**
 * PURE report model for the printable Dermatology & Aesthetic documents (no React, no DOM, no network -> unit-testable).
 * It only ARRANGES what the server-authorized report payload already contains. It never interprets clinical data, never
 * generates a diagnosis / conclusion / recommendation, and never computes money (the optional financial block is shown exactly
 * as the Invoice + Payment documents report it).
 */
export type ReportType = "full" | "plan" | "session" | "history";

export interface ReportOptions {
  assessments: boolean; diagnoses: boolean; plan: boolean; sessions: boolean; followUps: boolean; history: boolean; financial: boolean;
}
export const OPTION_KEYS: readonly (keyof ReportOptions)[] = ["assessments", "diagnoses", "plan", "sessions", "followUps", "history", "financial"];
/** Sensible defaults: everything clinical on, the financial summary OFF (it is opt-in). */
export const DEFAULT_OPTIONS: ReportOptions = { assessments: true, diagnoses: true, plan: true, sessions: true, followUps: true, history: true, financial: false };

/** `inc` = comma list of enabled clinical sections (absent -> defaults). Financial comes ONLY from the explicit flag. */
export function parseOptions(inc: string | null | undefined, financial: boolean): ReportOptions {
  const o: ReportOptions = { ...DEFAULT_OPTIONS, financial };
  if (inc !== null && inc !== undefined) {
    const set = new Set(inc.split(",").map((s) => s.trim()).filter(Boolean));
    for (const k of OPTION_KEYS) if (k !== "financial") o[k] = set.has(k);
  }
  return o;
}
export function optionsToQuery(o: ReportOptions): string {
  const inc = OPTION_KEYS.filter((k) => k !== "financial" && o[k]).join(",");
  return `inc=${encodeURIComponent(inc)}${o.financial ? "&financial=1" : ""}`;
}

export const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
export const AMMAN = "Asia/Amman";

// Latin digits in Arabic too: a medical document mixes dates with phone / file / lot numbers, which are always Latin
const locale = (lang: string) => (lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB");
/** Dates are always shown in the clinic's local day (Asia/Amman), never in the viewer's browser zone. */
export function fmtDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale(lang), { timeZone: AMMAN, year: "numeric", month: "short", day: "numeric" });
}
export function fmtDateTime(iso: string | null | undefined, lang: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${fmtDate(iso, lang)} ${d.toLocaleTimeString(locale(lang), { timeZone: AMMAN, hour: "2-digit", minute: "2-digit" })}`;
}
/** A YYYY-MM-DD label printed on a product (not an instant): never shifted by a time zone. */
export function fmtYmd(ymd: string | undefined, lang: string): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd ?? "";
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString(locale(lang), { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
}
export function ageYears(birthDate: string | null | undefined, now = Date.now()): number | null {
  if (!birthDate) return null;
  const b = new Date(birthDate).getTime();
  if (Number.isNaN(b) || b > now) return null;
  return Math.floor((now - b) / 3.15576e10);
}

/** The procedure name AS DOCUMENTED when the session started (snapshot); sessions from before Phase 3 use the live catalog. */
export function sessionProcedureName(s: Pick<TreatmentSession, "procedureCode" | "procedureSnapshot">, lang: string): string {
  const snap = s.procedureSnapshot;
  if (snap && nonEmpty(lang === "ar" ? snap.labelAr : snap.labelEn)) return lang === "ar" ? snap.labelAr : snap.labelEn;
  return procedureLabel(s.procedureCode, lang === "ar" ? "ar" : "en");
}

/** Non-empty fields of a documentation group, in the configured order (empty ones are never printed). */
export function traceRows(group: DocGroup, obj: Record<string, string | undefined> | undefined): { key: string; kind: string; value: string }[] {
  if (!obj) return [];
  return DOC_FIELDS[group].filter((f) => nonEmpty(obj[f.key])).map((f) => ({ key: f.key, kind: f.kind, value: (obj[f.key] as string).trim() }));
}
/** Which groups to print for a session: the groups that hold data (a session keeps its data even if the catalog changes later). */
export function sessionGroups(s: TreatmentSession): { group: DocGroup; rows: ReturnType<typeof traceRows> }[] {
  const out: { group: DocGroup; rows: ReturnType<typeof traceRows> }[] = [];
  for (const g of ["product", "device"] as DocGroup[]) {
    const rows = traceRows(g, (g === "product" ? s.product : s.device) as Record<string, string | undefined> | undefined);
    if (rows.length) out.push({ group: g, rows });
  }
  return out;
}
export const proceduresGroups = (code: string): DocGroup[] => { const p = getProcedure(code); return p ? groupsFor(p.metadata) : []; };

// ---------------------------------------------------------------- sections
export function visibleAssessments(data: DermReportData) {
  const active = data.assessments.filter((a) => a.status === "active").sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  return { active, voidedCount: data.assessments.length - active.length };
}
export const diagnosesOf = (active: DermReportData["assessments"]) => active.filter((a) => nonEmpty(a.diagnosis));
export const activeFollowUps = (data: DermReportData): FollowUp[] => data.followUps.filter((f) => f.status === "active").sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
export const sessionsSorted = (data: DermReportData): TreatmentSession[] => [...data.sessions].sort((a, b) => +new Date(a.startedAt) - +new Date(b.startedAt));
export const sessionsOfItem = (data: DermReportData, itemId: string) => sessionsSorted(data).filter((s) => s.itemId === itemId);
export function itemsByPhase(data: DermReportData): { phase: number; name?: string; items: TreatmentItem[] }[] {
  const names = new Map(data.plan.phases.map((p) => [p.number, p.name]));
  const phases = Array.from(new Set(data.items.map((i) => i.phase))).sort((a, b) => a - b);
  return phases.map((n) => ({ phase: n, name: names.get(n), items: data.items.filter((i) => i.phase === n).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)) }));
}
export function planEstimate(data: DermReportData) {
  // ESTIMATES only (cancelled items excluded) — these numbers are never "paid" or "owed"
  const live = data.items.filter((i) => i.status !== "cancelled");
  return { total: Math.round(live.reduce((s, i) => s + (typeof i.estimatedPrice === "number" ? i.estimatedPrice : 0), 0) * 1000) / 1000, hasAny: live.some((i) => typeof i.estimatedPrice === "number") };
}

export function overviewStats(data: DermReportData) {
  const { active } = visibleAssessments(data);
  const dates = [...active.map((a) => a.createdAt), ...data.sessions.map((s) => s.startedAt), ...activeFollowUps(data).map((f) => f.createdAt), ...data.items.map((i) => i.createdAt)];
  return {
    assessments: active.length,
    diagnoses: diagnosesOf(active).length,
    activeTreatments: data.items.filter((i) => i.status === "planned" || i.status === "in_progress").length,
    completedTreatments: data.items.filter((i) => i.status === "completed").length,
    sessions: data.sessions.length,
    followUps: activeFollowUps(data).length,
    lastActivity: dates.length ? dates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null,
  };
}
export const hasAnyClinicalData = (data: DermReportData) => data.assessments.length + data.items.length + data.sessions.length + data.followUps.length > 0;

// ---------------------------------------------------------------- clinical history (chronological)
export type HistoryKind = "assessment" | "planned" | "started" | "session" | "follow_up" | "completed" | "cancelled" | "invoiced";
export interface HistoryEvent {
  key: string; at: string; kind: HistoryKind;
  regions: DermRegionRef[]; targetType?: string; generalArea?: string;
  procedureName?: string; recordType?: string;
  detail?: string; diagnosis?: string; sessionNumber?: number; outcome?: string; invoiceNumber?: number; by?: string;
}
const KIND_ORDER: Record<HistoryKind, number> = { assessment: 0, planned: 1, started: 2, session: 3, follow_up: 4, completed: 5, cancelled: 5, invoiced: 6 };

export function buildHistory(data: DermReportData, lang: string, opts: { financial: boolean }): HistoryEvent[] {
  const ev: HistoryEvent[] = [];
  for (const a of visibleAssessments(data).active) {
    ev.push({ key: `a:${a._id}`, at: a.createdAt, kind: "assessment", regions: a.regions, recordType: a.recordType, detail: nonEmpty(a.concern) ? a.concern.trim() : undefined, diagnosis: nonEmpty(a.diagnosis) ? a.diagnosis.trim() : undefined, by: a.createdBy?.name });
  }
  const proc = (code: string) => procedureLabel(code, lang === "ar" ? "ar" : "en");
  for (const i of data.items) {
    const base = { regions: i.regions, targetType: i.targetType, generalArea: i.generalArea, procedureName: proc(i.procedureCode), recordType: i.recordType };
    ev.push({ key: `i:${i._id}:planned`, at: i.createdAt, kind: "planned", by: i.createdBy?.name, ...base });
    for (const h of i.statusHistory) {
      if (h.status === "in_progress") ev.push({ key: `i:${i._id}:started:${h.at}`, at: h.at, kind: "started", by: h.by?.name, ...base });
      else if (h.status === "completed") ev.push({ key: `i:${i._id}:completed:${h.at}`, at: h.at, kind: "completed", by: h.by?.name, ...base });
      else if (h.status === "cancelled") ev.push({ key: `i:${i._id}:cancelled:${h.at}`, at: h.at, kind: "cancelled", by: h.by?.name, detail: nonEmpty(h.note) ? h.note : i.cancelReason, ...base });
    }
    if (opts.financial && i.billing?.state === "invoiced" && i.billing.at && typeof i.billing.invoiceNumber === "number") {
      ev.push({ key: `i:${i._id}:invoiced`, at: i.billing.at, kind: "invoiced", invoiceNumber: i.billing.invoiceNumber, by: i.billing.by?.name, ...base });
    }
  }
  const itemById = new Map(data.items.map((i) => [i._id, i]));
  for (const s of data.sessions) {
    ev.push({ key: `s:${s._id}`, at: s.startedAt, kind: "session", regions: s.treatedRegions.length ? s.treatedRegions : s.regions, targetType: s.targetType, generalArea: s.generalArea, procedureName: sessionProcedureName(s, lang), recordType: s.recordType, sessionNumber: s.sessionNumber, by: s.performedBy?.name });
  }
  for (const f of activeFollowUps(data)) {
    const item = f.itemId ? itemById.get(f.itemId) : undefined;
    ev.push({ key: `f:${f._id}`, at: f.createdAt, kind: "follow_up", regions: f.regions, targetType: item?.targetType, generalArea: item?.generalArea, procedureName: item ? proc(item.procedureCode) : undefined, recordType: f.recordType, outcome: f.outcome, by: f.createdBy?.name });
  }
  return ev.sort((a, b) => (+new Date(a.at) - +new Date(b.at)) || (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.key.localeCompare(b.key));
}
