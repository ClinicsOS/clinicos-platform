import type { DentalEvent, TreatmentItem } from "./types";

/**
 * Dental Chart <- Treatment Plan, READ side for the per-tooth SUMMARY (hover preview + selected-tooth details).
 *
 * There is exactly one treatment record in ClinicOS (DentalTreatmentItem, delivered by the existing
 * `["dental-treatment", patientId]` query). This module only INDEXES that already-loaded list by tooth so that a hover is an
 * O(1) map lookup — it never copies a treatment anywhere, never stores anything, never calls the network, and it is recomputed
 * from the query data (so a change made anywhere in the app, which refreshes that query, changes the summary with it).
 *
 * Tooth identity is the FDI string ("16") the rest of the chart already uses; a treatment is attached to a tooth ONLY when that
 * exact string is in the item's `toothNumbers` (never a numeric / prefix match, so 16 can never land on 15, 116 or primary 56).
 * Whole-mouth ("general") items have no tooth numbers and therefore belong to no tooth.
 *
 * Cancelled items are left out, exactly like the chart pictures (planVisual.ts) and the tooth panel already do; completed items
 * are KEPT (the doctor must see what was done to the tooth). Order = the Treatment Plan's own order (the server sorts by phase,
 * then creation time); it is preserved here.
 */

export type ToothTreatment = TreatmentItem & { status: Exclude<TreatmentItem["status"], "cancelled"> };
export type TreatmentsByTooth = ReadonlyMap<string, readonly ToothTreatment[]>;

const NONE: readonly ToothTreatment[] = Object.freeze([]);

export function indexTreatmentsByTooth(items: readonly TreatmentItem[] | undefined | null): TreatmentsByTooth {
  const map = new Map<string, ToothTreatment[]>();
  for (const it of items ?? []) {
    if (it.status === "cancelled") continue;
    for (const fdi of Array.from(new Set(it.toothNumbers ?? []))) {
      const list = map.get(fdi);
      if (list) list.push(it as ToothTreatment);
      else map.set(fdi, [it as ToothTreatment]);
    }
  }
  return map;
}

export const treatmentsOf = (index: TreatmentsByTooth, fdi: string): readonly ToothTreatment[] => index.get(fdi) ?? NONE;

/** The hover preview is deliberately small: at most this many treatments are listed, the rest is "+ N more". */
export const HOVER_MAX_TREATMENTS = 3;

export interface ToothSummary {
  fdi: string;
  /** ACTIVE diagnoses of this tooth (clinical events) — a different record from treatments, never merged with them. */
  diagnoses: { code: string; surfaces: string[] }[];
  /** The treatments shown (open work first), at most `max`. */
  shown: readonly ToothTreatment[];
  /** How many more treatments exist for this tooth than are shown. */
  hidden: number;
  total: number;
}

/** Open work (in progress, planned) is the most relevant for a quick look; completed work follows. Stable: plan order inside each group. */
const RANK: Record<ToothTreatment["status"], number> = { in_progress: 0, planned: 1, completed: 2 };

export function buildToothSummary(
  fdi: string,
  /** The ACTIVE diagnosis events of this tooth — already indexed per tooth by deriveToothStates (toothStates.ts), so no scan happens here. */
  diagnosisEvents: readonly Pick<DentalEvent, "code" | "surfaces">[] | undefined,
  index: TreatmentsByTooth,
  max = HOVER_MAX_TREATMENTS
): ToothSummary {
  const all = treatmentsOf(index, fdi);
  const ordered = all.length > 1 ? all.map((x, i) => ({ x, i })).sort((a, b) => RANK[a.x.status] - RANK[b.x.status] || a.i - b.i).map((r) => r.x) : all;
  const shown = ordered.slice(0, max);
  return {
    fdi,
    diagnoses: (diagnosisEvents ?? []).map((d) => ({ code: d.code, surfaces: [...d.surfaces] })),
    shown,
    hidden: Math.max(0, all.length - shown.length),
    total: all.length,
  };
}
