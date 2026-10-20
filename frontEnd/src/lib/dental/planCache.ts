/* PHASE 4 — pure helpers for the ONE canonical treatment cache (`["dental-treatment", patientId]`).
   Treatment Plan, Dental Chart (2D + 3D), Overview card and tooth panel all read that single payload, so patching it once updates every
   mounted view in the same render. No React, no network: unit-tested in tests/dental/treatment-sync.test.mjs. */
import type { TreatmentItem, TreatmentPlanResponse } from "./types";

/** Counters and ESTIMATES re-derived from the items with the same formulas the server uses (planPayload). Invoice figures are server-only and left untouched. */
export function recomputeSummary(plan: TreatmentPlanResponse): TreatmentPlanResponse["summary"] {
  const items = plan.items;
  const count = (s: string) => items.filter((i) => i.status === s).length;
  const sum = (list: TreatmentItem[]) => list.reduce((t, i) => t + (typeof i.estimatedPrice === "number" ? i.estimatedPrice : 0), 0);
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    ...plan.summary,
    planned: count("planned"), inProgress: count("in_progress"), completed: count("completed"), cancelled: count("cancelled"),
    estimatedTotal: round(sum(items.filter((i) => i.status !== "cancelled"))),
    estimatedRemaining: round(sum(items.filter((i) => i.status === "planned" || i.status === "in_progress"))),
  };
}

const withSummary = (plan: TreatmentPlanResponse, items: TreatmentItem[]): TreatmentPlanResponse => {
  const next = { ...plan, items };
  return { ...next, summary: recomputeSummary(next) };
};

/** Server-confirmed item -> replace the SAME record (by id) or append it (a new record). Never adds a second copy of an id. */
export function upsertItem(plan: TreatmentPlanResponse | undefined, item: TreatmentItem): TreatmentPlanResponse | undefined {
  if (!plan) return plan;
  const exists = plan.items.some((i) => i._id === item._id);
  const items = exists
    ? plan.items.map((i) => (i._id === item._id ? { ...i, ...item, toothSurfaces: item.toothSurfaces } : i)) // the server item is complete: an ABSENT toothSurfaces means "none", never "keep the old one"
    : [...plan.items, item].sort((a, b) => a.phase - b.phase || a.createdAt.localeCompare(b.createdAt));
  return withSummary(plan, items);
}

/** Optimistic local change of an existing record (rolled back by the caller if the server refuses). */
export function patchItem(plan: TreatmentPlanResponse | undefined, id: string, patch: Partial<TreatmentItem>): TreatmentPlanResponse | undefined {
  if (!plan || !plan.items.some((i) => i._id === id)) return plan;
  return withSummary(plan, plan.items.map((i) => (i._id === id ? { ...i, ...patch } : i)));
}

export interface PlanChange {
  addedIds: string[];
  changedIds: string[];
  /** FDI codes whose drawing changed (target teeth of an added / edited / status-changed treatment, old AND new). */
  teeth: string[];
}
const sigOf = (i: TreatmentItem) => [i.status, i.procedureCode, i.targetType, i.toothNumbers.join(","), i.surfaces.join(","), JSON.stringify(i.toothSurfaces ?? null), i.priority, i.phase, i.notes ?? "", i.estimatedPrice ?? ""].join("|");

/** What changed between two versions of the plan (used for the gentle "this tooth just changed" feedback). The first load is NOT a change. */
export function diffPlanItems(prev: TreatmentItem[] | undefined, next: TreatmentItem[]): PlanChange {
  const out: PlanChange = { addedIds: [], changedIds: [], teeth: [] };
  if (!prev) return out;
  const before = new Map(prev.map((i) => [i._id, i]));
  const teeth = new Set<string>();
  for (const n of next) {
    const o = before.get(n._id);
    if (!o) { out.addedIds.push(n._id); n.toothNumbers.forEach((f) => teeth.add(f)); continue; }
    if (sigOf(o) !== sigOf(n)) { out.changedIds.push(n._id); [...o.toothNumbers, ...n.toothNumbers].forEach((f) => teeth.add(f)); }
  }
  out.teeth = Array.from(teeth).sort();
  return out;
}

/** A fresh idempotency key per "Save" intent: a double click / retry of the SAME save carries the same key, a new save a new one. */
export function newRequestId(): string {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
