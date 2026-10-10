import type { DataScope } from "../../auth/policy";
import type { AnalyticsScope } from "./scope";
import type { ResolvedRanges } from "./range";
import { rangeOut } from "./range";
import { DENTAL_SPECIALTY_ID } from "../../config/dental";
import { DERM_SPECIALTY_ID } from "../../config/dermatology";
import type { TreatmentKind } from "./treatments";

/** Everything a section builder needs — all of it server-derived (identity from `protect`, ranges from resolveRanges, specialty / add-on from the clinic document). */
export interface Ctx {
  s: AnalyticsScope;
  es: DataScope; // the Phase 5 expense scope for the same request
  ranges: ResolvedRanges;
  clinic: { specialty: string; loyaltyEntitled: boolean };
  compare: boolean;
}

export const treatmentKindOf = (specialty: string): TreatmentKind | null =>
  specialty === DENTAL_SPECIALTY_ID ? "dental" : specialty === DERM_SPECIALTY_ID ? "derm" : null;

/** The response envelope shared by every section. */
export const envelope = (section: string, c: Ctx) => ({
  section,
  timeZone: c.ranges.timeZone,
  generatedAt: new Date().toISOString(),
  preset: c.ranges.preset,
  range: rangeOut(c.ranges.current),
  comparison: c.compare ? { range: rangeOut(c.ranges.previous), basis: c.ranges.comparisonBasis } : null,
  granularity: c.ranges.granularity,
  scope: { level: c.s.level, doctorId: c.s.doctorId ?? null, clinicWide: c.s.clinicWide },
});

/** Sections this caller can open (the UI renders tabs from this; every endpoint re-checks on its own). */
export function availableSections(c: Pick<Ctx, "s" | "clinic">): string[] {
  const out = ["overview", "financial", "appointments", "patients"];
  if (treatmentKindOf(c.clinic.specialty)) out.push("treatments");
  out.push("doctors", "expenses");
  if (c.s.level === "clinic" && c.clinic.loyaltyEntitled) out.push("loyalty");
  return out;
}
