import type { ToothTreatmentVisual, ToothVisualState, TreatmentItem } from "./types";

/**
 * Chart <- Treatment Plan: the ONLY place where treatments are turned into what the Dental Chart draws.
 *
 * It is a pure READ-side derivation of the canonical treatment records (DentalTreatmentItem). Nothing here (or anywhere
 * else) writes a treatment into the clinical-event history or the other way round, so:
 *   - there is no second source of truth that could drift,
 *   - "chart creates plan creates chart…" loops are impossible by construction,
 *   - calling it twice with the same plan gives exactly the same result (idempotent / deterministic).
 *
 * Meaning of what it adds to a tooth:
 *   plan      "in_progress" beats "planned"   (small status badge, any procedure)
 *   treated   a completed treatment exists    (small check badge, any procedure)
 *   treatments[]  the TYPE picture for Crown and Filling only (status decides ghost vs solid in the renderer)
 * Cancelled items are never drawn (the record itself stays in the plan history).
 */
type PlanItemLike = Pick<TreatmentItem, "status" | "procedureCode" | "targetType" | "toothNumbers" | "surfaces">;

const kindOf = (procedureCode: string): ToothTreatmentVisual["kind"] | null =>
  procedureCode === "crown" ? "crown" : procedureCode === "filling" ? "filling" : null;

const treatmentKey = (x: ToothTreatmentVisual) => `${x.kind}|${x.status}|${x.surfaces.join("")}`;

export function applyPlanToVisual(
  out: Record<string, ToothVisualState>,
  items: readonly PlanItemLike[],
  empty: () => ToothVisualState
): Record<string, ToothVisualState> {
  const touched = new Set<string>();
  for (const it of items) {
    if (it.status === "cancelled") continue;
    const kind = kindOf(it.procedureCode);
    const typed = kind !== null && (it.targetType === "tooth" || it.targetType === "surface");
    for (const fdi of it.toothNumbers) {
      const cur = out[fdi] ?? empty();
      if (it.status === "completed") cur.treated = true;
      else if (it.status === "in_progress") cur.plan = "in_progress";
      else if (cur.plan !== "in_progress") cur.plan = "planned";
      if (typed) cur.treatments.push({ kind, status: it.status, surfaces: kind === "filling" ? [...it.surfaces] : [] });
      out[fdi] = cur;
      touched.add(fdi);
    }
  }
  // Same tooth + same kind/status/surfaces collapses to one picture; a fixed order keeps the engine's change signature stable.
  for (const fdi of Array.from(touched)) {
    const seen = new Map<string, ToothTreatmentVisual>();
    for (const x of out[fdi].treatments) seen.set(treatmentKey(x), x);
    out[fdi].treatments = Array.from(seen.values()).sort((a, b) => (treatmentKey(a) < treatmentKey(b) ? -1 : 1));
  }
  return out;
}
