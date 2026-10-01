/**
 * ClinicOS Dermatology & Aesthetics — the ONE Anatomical Region Registry (frontend).
 *
 * Mirrors backEnd/src/config/dermatology.ts (ids / group / side / surfaces / active MUST match exactly — the
 * `check-derm-registry-sync` script fails if the two files drift). This copy additionally carries the display labels
 * and the camera-composition metadata. NOTHING else in the frontend defines regions: the 3D engine, the panel, the
 * accessible selector, the history and the timeline all read from here.
 *
 * RULES (never break these):
 *  - `id` is the ONLY thing that is ever stored / sent to the API. It is language-neutral and independent of the
 *    3D asset: never a translated label, never a GLB mesh name, never gendered (`left_cheek`, not `female_left_cheek`).
 *  - LEFT / RIGHT ALWAYS MEAN THE PATIENT'S left / right — regardless of camera angle, screen side, RTL or LTR.
 *  - Region vs surface: `left_forearm` is the region; `anterior | posterior | lateral | medial` is an optional
 *    qualifier, only where `surfaces` lists it.
 *  - Adding a sub-region later = one new line here (+ backend twin) — existing records keep their meaning.
 *
 * Canonical 3D frame used by every visual asset (procedural or GLB):  +X = patient's LEFT, +Y = up (superior),
 * +Z = anterior (the direction the patient faces), origin on the floor between the feet, 1 unit = 1 metre.
 */

export type RegionGroup = "face" | "scalp" | "body";
export type RegionSide = "left" | "right" | "midline";
export type SurfaceId = "anterior" | "posterior" | "lateral" | "medial";
export type RecordType = "dermatology" | "aesthetic";

export const RECORD_TYPES: readonly RecordType[] = ["dermatology", "aesthetic"];
export const SURFACE_IDS: readonly SurfaceId[] = ["anterior", "posterior", "lateral", "medial"];
export const REGION_GROUPS: readonly RegionGroup[] = ["face", "scalp", "body"];
export const MAX_REGIONS_PER_ASSESSMENT = 12;

/**
 * Preferred camera composition for a region, in the PATIENT frame.
 *  az: 0 = looking at the patient's front, +90 = from the patient's LEFT, -90 = from the patient's RIGHT, 180 = back.
 *  el: elevation above the horizon in degrees (positive = looking down on the region).
 *  fill: fraction of the viewport height the region should occupy (rest stays visible as context).
 */
export interface RegionFocus {
  az: number;
  el: number;
  fill: number;
}

export interface RegionDef {
  id: string;
  group: RegionGroup;
  side: RegionSide;
  parent?: string;
  surfaces: readonly SurfaceId[];
  active: boolean;
  labels: { en: string; ar: string };
  focus: RegionFocus;
}

const ALL4: readonly SurfaceId[] = ["anterior", "posterior", "lateral", "medial"];
const NONE: readonly SurfaceId[] = [];

interface Spec {
  id: string;
  group: RegionGroup;
  side: RegionSide;
  surfaces?: readonly SurfaceId[];
  en: string;
  ar: string;
  az: number;
  el?: number;
  fill?: number;
}

const def = (s: Spec): RegionDef => ({
  id: s.id,
  group: s.group,
  side: s.side,
  surfaces: s.surfaces ?? NONE,
  active: true,
  labels: { en: s.en, ar: s.ar },
  focus: { az: s.az, el: s.el ?? 4, fill: s.fill ?? 0.42 },
});

/** A left/right pair. `az` is given for the LEFT region; the right one is mirrored (-az). */
const pair = (
  base: string,
  group: RegionGroup,
  en: string,
  arL: string,
  arR: string,
  o: { surfaces?: readonly SurfaceId[]; az: number; el?: number; fill?: number }
): RegionDef[] => [
  def({ id: `left_${base}`, group, side: "left", en: `Left ${en}`, ar: arL, ...o }),
  def({ id: `right_${base}`, group, side: "right", en: `Right ${en}`, ar: arR, ...o, az: -o.az }),
];

export const REGIONS: readonly RegionDef[] = [
  // ------------------------------------------------ FACE (+ front / sides of the neck)
  def({ id: "forehead", group: "face", side: "midline", en: "Forehead", ar: "الجبهة", az: 0, fill: 0.34 }),
  def({ id: "glabella", group: "face", side: "midline", en: "Glabella (between the brows)", ar: "ما بين الحاجبين", az: 0, fill: 0.22 }),
  ...pair("temple", "face", "Temple", "الصدغ الأيسر", "الصدغ الأيمن", { az: 58, fill: 0.3 }),
  ...pair("brow", "face", "Brow", "الحاجب الأيسر", "الحاجب الأيمن", { az: 28, fill: 0.24 }),
  ...pair("periorbital", "face", "Periorbital Area", "المنطقة حول العين اليسرى", "المنطقة حول العين اليمنى", { az: 28, fill: 0.24 }),
  ...pair("infraorbital", "face", "Under-eye (Infraorbital) Area", "تحت العين اليسرى", "تحت العين اليمنى", { az: 28, fill: 0.24 }),
  def({ id: "nose", group: "face", side: "midline", en: "Nose", ar: "الأنف", az: 0, fill: 0.3 }),
  ...pair("cheek", "face", "Cheek", "الخد الأيسر", "الخد الأيمن", { az: 38, fill: 0.34 }),
  ...pair("ear", "face", "Ear", "الأذن اليسرى", "الأذن اليمنى", { az: 88, fill: 0.24 }),
  def({ id: "upper_lip", group: "face", side: "midline", en: "Upper Lip", ar: "الشفة العليا", az: 0, fill: 0.2 }),
  def({ id: "lower_lip", group: "face", side: "midline", en: "Lower Lip", ar: "الشفة السفلى", az: 0, fill: 0.2 }),
  def({ id: "perioral", group: "face", side: "midline", en: "Perioral Area", ar: "حول الفم", az: 0, fill: 0.3 }),
  ...pair("jawline", "face", "Jawline", "خط الفك الأيسر", "خط الفك الأيمن", { az: 48, fill: 0.34 }),
  def({ id: "chin", group: "face", side: "midline", en: "Chin", ar: "الذقن", az: 0, el: 8, fill: 0.24 }),
  def({ id: "anterior_neck", group: "face", side: "midline", en: "Anterior Neck", ar: "مقدمة الرقبة", az: 0, el: 0, fill: 0.34 }),
  ...pair("lateral_neck", "face", "Lateral Neck", "الجانب الأيسر من الرقبة", "الجانب الأيمن من الرقبة", { az: 72, el: 0, fill: 0.34 }),

  // ------------------------------------------------ SCALP
  def({ id: "frontal_scalp", group: "scalp", side: "midline", en: "Frontal Scalp", ar: "فروة الرأس الأمامية", az: 0, el: 42, fill: 0.36 }),
  def({ id: "top_scalp", group: "scalp", side: "midline", en: "Top of Scalp", ar: "أعلى فروة الرأس", az: 0, el: 68, fill: 0.4 }),
  def({ id: "vertex_scalp", group: "scalp", side: "midline", en: "Vertex / Crown", ar: "قمة الرأس", az: 180, el: 66, fill: 0.36 }),
  ...pair("temporal_scalp", "scalp", "Temporal Scalp", "فروة الرأس الصدغية اليسرى", "فروة الرأس الصدغية اليمنى", { az: 72, el: 14, fill: 0.34 }),
  ...pair("lateral_scalp", "scalp", "Lateral Scalp", "فروة الرأس الجانبية اليسرى", "فروة الرأس الجانبية اليمنى", { az: 82, el: 36, fill: 0.38 }),
  def({ id: "occipital_scalp", group: "scalp", side: "midline", en: "Occipital (Back of) Scalp", ar: "مؤخرة فروة الرأس", az: 180, el: 14, fill: 0.4 }),

  // ------------------------------------------------ BODY
  def({ id: "posterior_neck", group: "body", side: "midline", en: "Posterior Neck", ar: "خلف الرقبة", az: 180, el: 4, fill: 0.34 }),
  ...pair("shoulder", "body", "Shoulder", "الكتف الأيسر", "الكتف الأيمن", { surfaces: ["anterior", "posterior", "lateral"], az: 50, fill: 0.3 }),
  ...pair("chest", "body", "Chest", "الصدر الأيسر", "الصدر الأيمن", { az: 12, fill: 0.36 }),
  def({ id: "abdomen", group: "body", side: "midline", en: "Abdomen", ar: "البطن", az: 0, fill: 0.4 }),
  ...pair("flank", "body", "Flank", "الخاصرة اليسرى", "الخاصرة اليمنى", { az: 90, fill: 0.36 }),
  def({ id: "upper_back", group: "body", side: "midline", en: "Upper Back", ar: "أعلى الظهر", az: 180, fill: 0.4 }),
  def({ id: "lower_back", group: "body", side: "midline", en: "Lower Back", ar: "أسفل الظهر", az: 180, fill: 0.4 }),
  ...pair("upper_arm", "body", "Upper Arm", "العضد الأيسر", "العضد الأيمن", { surfaces: ALL4, az: 42, fill: 0.36 }),
  ...pair("elbow", "body", "Elbow", "المرفق الأيسر", "المرفق الأيمن", { surfaces: ALL4, az: 42, fill: 0.28 }),
  ...pair("forearm", "body", "Forearm", "الساعد الأيسر", "الساعد الأيمن", { surfaces: ALL4, az: 42, fill: 0.36 }),
  ...pair("hand", "body", "Hand", "اليد اليسرى", "اليد اليمنى", { surfaces: ALL4, az: 28, fill: 0.3 }),
  ...pair("buttock", "body", "Buttock", "الإلية اليسرى", "الإلية اليمنى", { az: 158, fill: 0.34 }),
  ...pair("thigh", "body", "Thigh", "الفخذ الأيسر", "الفخذ الأيمن", { surfaces: ALL4, az: 26, fill: 0.4 }),
  ...pair("knee", "body", "Knee", "الركبة اليسرى", "الركبة اليمنى", { surfaces: ALL4, az: 26, fill: 0.3 }),
  ...pair("lower_leg", "body", "Lower Leg", "الساق اليسرى", "الساق اليمنى", { surfaces: ALL4, az: 26, fill: 0.4 }),
  ...pair("ankle", "body", "Ankle", "الكاحل الأيسر", "الكاحل الأيمن", { surfaces: ALL4, az: 30, el: 8, fill: 0.26 }),
  ...pair("foot", "body", "Foot", "القدم اليسرى", "القدم اليمنى", { surfaces: ALL4, az: 28, el: 26, fill: 0.3 }),
];

// ------------------------------------------------ lookups (the only way the app reads the registry)
const byId = new Map<string, RegionDef>(REGIONS.map((r) => [r.id, r]));

export const REGION_IDS: readonly string[] = REGIONS.map((r) => r.id);
export const getRegion = (id: string): RegionDef | undefined => byId.get(id);
export const isKnownRegion = (id: string): boolean => byId.has(id);

/** Localized display label. Unknown ids (a future region seen by an old client) fall back to the raw id — never crash. */
export const regionLabel = (id: string, lang: "en" | "ar"): string => byId.get(id)?.labels[lang] ?? id;

export const regionsOfGroup = (g: RegionGroup): RegionDef[] => REGIONS.filter((r) => r.group === g && r.active);

/** Case-insensitive search across BOTH languages (used by the accessible region selector). */
export function searchRegions(query: string): RegionDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return REGIONS.filter((r) => r.active);
  return REGIONS.filter((r) => r.active && (r.labels.en.toLowerCase().includes(q) || r.labels.ar.includes(q) || r.id.includes(q.replace(/\s+/g, "_"))));
}

/**
 * Camera azimuth (patient frame, degrees) that best shows a SURFACE of a region. Lateral = facing away from the
 * midline on the region's own side; medial = toward the midline (slightly from the front so the view isn't occluded).
 */
export function surfaceAzimuth(region: RegionDef, surface: SurfaceId): number {
  const s = region.side === "left" ? 1 : region.side === "right" ? -1 : 0;
  switch (surface) {
    case "anterior": return 0;
    case "posterior": return 180;
    case "lateral": return s === 0 ? 90 : 90 * s;
    case "medial": return s === 0 ? -90 : -62 * s;
  }
}
