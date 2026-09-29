/**
 * Dental clinical taxonomy — frontend mirror of backEnd/src/config/dental.ts.
 * Only CODES + surface support live here; user-facing labels come from i18n (dn.c.<code>).
 * The server re-validates everything; this is INITIAL product taxonomy, not an authoritative
 * dental nomenclature — extend by adding an entry here, on the server, and an i18n label.
 * Keep the two files in sync (same approach as specialties.ts / plans.ts in this project).
 */
export type EventCategory = "existing_condition" | "diagnosis";
export type SurfaceId = "M" | "D" | "B" | "L" | "O";
export type SurfaceMode = "none" | "optional";

/** Canonical ids. UI shows M, D, B/F, L/P, O/I (facial=buccal, palatal=lingual, incisal=occlusal). */
export const SURFACES: readonly SurfaceId[] = ["M", "D", "B", "L", "O"];
export const SURFACE_LABELS: Record<SurfaceId, string> = { M: "M", D: "D", B: "B/F", L: "L/P", O: "O/I" };

export interface TaxonomyItem {
  code: string;
  category: EventCategory;
  surfaces: SurfaceMode;
}

export const EXISTING_CONDITIONS: readonly TaxonomyItem[] = [
  { code: "existing_filling", category: "existing_condition", surfaces: "optional" },
  { code: "existing_crown", category: "existing_condition", surfaces: "none" },
  { code: "existing_bridge", category: "existing_condition", surfaces: "none" },
  { code: "existing_implant", category: "existing_condition", surfaces: "none" },
  { code: "root_canal_treated", category: "existing_condition", surfaces: "none" },
  { code: "missing_tooth", category: "existing_condition", surfaces: "none" },
  { code: "partially_erupted", category: "existing_condition", surfaces: "none" },
  { code: "unerupted", category: "existing_condition", surfaces: "none" },
];

export const DIAGNOSES: readonly TaxonomyItem[] = [
  { code: "caries", category: "diagnosis", surfaces: "optional" },
  { code: "fractured_cracked_tooth", category: "diagnosis", surfaces: "optional" },
  { code: "defective_filling", category: "diagnosis", surfaces: "optional" },
  { code: "defective_crown", category: "diagnosis", surfaces: "none" },
  { code: "tooth_wear", category: "diagnosis", surfaces: "optional" },
  { code: "sensitivity", category: "diagnosis", surfaces: "none" },
  { code: "mobility", category: "diagnosis", surfaces: "none" },
  { code: "infection_abscess", category: "diagnosis", surfaces: "none" },
];

export const taxonomyFor = (c: EventCategory) => (c === "existing_condition" ? EXISTING_CONDITIONS : DIAGNOSES);
export const findItem = (c: EventCategory, code: string) => taxonomyFor(c).find((i) => i.code === code);
