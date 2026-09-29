/**
 * ClinicOS Dentistry Module — server-side taxonomy + validation (source of truth).
 *
 * The frontend keeps a mirrored copy of the *codes* (frontEnd/src/lib/dental/taxonomy.ts)
 * purely for rendering labels/icons; the server ALWAYS re-validates against this file.
 *
 * Extensibility: clinical `code` values are stored as plain strings (NOT a Mongo enum),
 * so adding a condition/diagnosis is a one-line change here + a label in the frontend
 * i18n — no schema migration. Every stored event records the TAXONOMY_VERSION it was
 * validated against. This is an INITIAL product taxonomy, not a complete authoritative
 * dental nomenclature.
 */

/** The stable clinic specialty id that owns this module. Never compare translated labels. */
export const DENTAL_SPECIALTY_ID = "dentistry";

export const TAXONOMY_VERSION = 1;

// ---------- Dentition / FDI ----------
export const DENTITION_TYPES = ["primary", "mixed", "permanent"] as const;
export type DentitionType = (typeof DENTITION_TYPES)[number];

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Permanent: quadrants 1-4, positions 1-8 => 11-18, 21-28, 31-38, 41-48 (32 teeth). */
export const PERMANENT_FDI: readonly string[] = [1, 2, 3, 4].flatMap((q) =>
  range(1, 8).map((p) => `${q}${p}`)
);
/** Primary: quadrants 5-8, positions 1-5 => 51-55, 61-65, 71-75, 81-85 (20 teeth). */
export const PRIMARY_FDI: readonly string[] = [5, 6, 7, 8].flatMap((q) =>
  range(1, 5).map((p) => `${q}${p}`)
);
export const ALL_FDI: ReadonlySet<string> = new Set([...PERMANENT_FDI, ...PRIMARY_FDI]);

const PERMANENT_SET = new Set(PERMANENT_FDI);
const PRIMARY_SET = new Set(PRIMARY_FDI);

/** Which FDI codes may be WRITTEN for a record's current dentition type. */
export function isValidFdiFor(fdi: string, dentition: DentitionType): boolean {
  if (dentition === "permanent") return PERMANENT_SET.has(fdi);
  if (dentition === "primary") return PRIMARY_SET.has(fdi);
  return PERMANENT_SET.has(fdi) || PRIMARY_SET.has(fdi); // mixed
}

// ---------- Surfaces ----------
// Canonical ids. B = Buccal/Facial, L = Lingual/Palatal, O = Occlusal/Incisal.
export const SURFACES = ["M", "D", "B", "L", "O"] as const;
export type SurfaceId = (typeof SURFACES)[number];

// ---------- Clinical taxonomy ----------
export type EventCategory = "existing_condition" | "diagnosis";
/** none = whole-tooth (surfaces rejected). optional = surfaces allowed, never forced. */
export type SurfaceMode = "none" | "optional";

export interface TaxonomyItem {
  code: string;
  category: EventCategory;
  surfaces: SurfaceMode;
}

// EXISTING CONDITION = something already present. NOT a diagnosis, NOT treatment intent.
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

// DIAGNOSIS = what the dentist identifies clinically. Treatment intent ("needs filling")
// is deliberately NOT here — that belongs to the future Treatment Plan.
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

export function findTaxonomyItem(category: EventCategory, code: string): TaxonomyItem | undefined {
  const list = category === "existing_condition" ? EXISTING_CONDITIONS : DIAGNOSES;
  return list.find((i) => i.code === code);
}

// ---------- Pure input validation (unit-tested; no DB) ----------
export interface RawEventInput {
  code: string;
  surfaces?: string[];
  note?: string;
}
export type ValidatedEvent =
  | { ok: true; code: string; surfaces: SurfaceId[]; note?: string }
  | { ok: false; message: string };

export function validateEventInput(
  category: EventCategory,
  input: RawEventInput,
  fdi: string,
  dentition: DentitionType
): ValidatedEvent {
  if (!isValidFdiFor(fdi, dentition)) {
    return {
      ok: false,
      message: `Tooth ${fdi} is not valid for this record's ${dentition} dentition`,
    };
  }
  const item = findTaxonomyItem(category, input.code);
  if (!item) return { ok: false, message: `Unsupported ${category.replace("_", " ")}: ${input.code}` };

  const given = input.surfaces ?? [];
  const bad = given.filter((s) => !(SURFACES as readonly string[]).includes(s));
  if (bad.length) return { ok: false, message: `Invalid surface(s): ${bad.join(", ")}` };
  // de-duplicate + canonical order so the same clinical fact always serialises the same way
  const surfaces = SURFACES.filter((s) => given.includes(s));
  if (surfaces.length && item.surfaces === "none") {
    return { ok: false, message: `${item.code} applies to the whole tooth — surfaces are not allowed` };
  }
  const note = input.note?.trim();
  return { ok: true, code: item.code, surfaces, ...(note ? { note } : {}) };
}

// ---------- Mixed dentition: which teeth are CURRENTLY charted ----------
/**
 * A "slot" is one physical position in the arch: (permanent quadrant, position). Primary quadrant 5-8 maps to
 * permanent quadrant 1-4 (55 and 15 share slot "1-5"). At most ONE tooth may occupy a slot in the current chart.
 * This is only about what the chart DISPLAYS — clinical events for every FDI are always kept.
 */
export const slotKey = (fdi: string): string => {
  const q = Number(fdi[0]);
  return `${q >= 5 ? q - 4 : q}-${fdi[1]}`;
};

export type CurrentTeethResult = { ok: true; teeth: string[] } | { ok: false; message: string };

export function validateCurrentTeeth(list: string[]): CurrentTeethResult {
  if (!list.length) return { ok: false, message: "At least one tooth is required" };
  const seen = new Set<string>();
  const slots = new Map<string, string>();
  for (const fdi of list) {
    if (!ALL_FDI.has(fdi)) return { ok: false, message: `Invalid FDI tooth code: ${fdi}` };
    if (seen.has(fdi)) return { ok: false, message: `Duplicate tooth: ${fdi}` };
    seen.add(fdi);
    const k = slotKey(fdi);
    const other = slots.get(k);
    if (other) return { ok: false, message: `Teeth ${other} and ${fdi} occupy the same position` };
    slots.set(k, fdi);
  }
  return { ok: true, teeth: [...list].sort() };
}
