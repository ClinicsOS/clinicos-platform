import type { DentalEvent, ToothVisualState } from "./types";
import type { SurfaceId } from "./taxonomy";

export interface ToothClinicalState {
  fdi: string;
  existing: DentalEvent[]; // active existing conditions
  diagnoses: DentalEvent[]; // active diagnoses
  missing: boolean;
}

/** Current chart state = ACTIVE events only. Resolved entries stay in history, not on the chart. */
export function deriveToothStates(events: readonly DentalEvent[]): Record<string, ToothClinicalState> {
  const out: Record<string, ToothClinicalState> = {};
  for (const e of events) {
    if (e.status !== "active") continue;
    const s = (out[e.fdi] ??= { fdi: e.fdi, existing: [], diagnoses: [], missing: false });
    if (e.category === "existing_condition") {
      s.existing.push(e);
      if (e.code === "missing_tooth") s.missing = true;
    } else {
      s.diagnoses.push(e);
    }
  }
  return out;
}

export function toVisualState(s: ToothClinicalState): ToothVisualState {
  const has = (code: string) => s.existing.some((e) => e.code === code);
  const fillings = new Set<SurfaceId>();
  s.existing.filter((e) => e.code === "existing_filling").forEach((e) => e.surfaces.forEach((x) => fillings.add(x)));
  return {
    missing: s.missing,
    restoration: has("existing_implant") ? "implant" : has("existing_bridge") ? "bridge" : has("existing_crown") ? "crown" : null,
    fillings: Array.from(fillings),
    hasFilling: has("existing_filling"),
    rootCanal: has("root_canal_treated"),
    partiallyErupted: has("partially_erupted"),
    unerupted: has("unerupted"),
    plan: null, // filled in from the treatment plan by the chart (not from diagnosis / condition events)
    treated: false,
    diagnoses: s.diagnoses.map((d) => ({ code: d.code, surfaces: d.surfaces })),
  };
}

export const emptyVisualState = (): ToothVisualState => ({
  missing: false, restoration: null, fillings: [], hasFilling: false, rootCanal: false, partiallyErupted: false, unerupted: false, plan: null, treated: false, diagnoses: [],
});
