/**
 * ClinicOS Dermatology & Aesthetic Medicine Module — server-side Anatomical Region Registry + validation.
 *
 * SOURCE OF TRUTH for what may be STORED. The frontend keeps a mirrored copy of the registry
 * (frontEnd/src/lib/derm/regions.ts) that additionally carries display labels and 3D/camera metadata.
 * The two files MUST list exactly the same ids / groups / sides / surfaces — `scripts/check-derm-registry-sync`
 * (delivered with this phase) fails if they drift. The server ALWAYS re-validates against THIS file; nothing the
 * client sends is ever trusted.
 *
 * Region ids are PERMANENT, language-neutral and independent from any 3D asset:
 *   - never a translated label,
 *   - never a mesh / node name from a GLB file,
 *   - never gendered (`left_cheek`, not `female_left_cheek`).
 * LEFT / RIGHT ALWAYS MEAN THE PATIENT'S left / right — regardless of camera angle, screen side or RTL/LTR.
 *
 * Region vs surface: a region is the anatomical area (`left_forearm`); a surface is an optional qualifier
 * (`anterior | posterior | lateral | medial`) that is only allowed where the region lists it in `surfaces`.
 *
 * Extensibility: adding a region = one line here (+ its frontend twin). Existing data never changes meaning.
 * To retire a region, set `active: false` — it can then no longer be written, but stored history stays readable.
 */

/** The stable clinic specialty id that owns this module. Never compare translated labels. */
export const DERM_SPECIALTY_ID = "dermatology_aesthetics";

/** Bump when the registry gains/renames semantics that a stored record should be able to reference. */
export const REGION_REGISTRY_VERSION = 1;

/** The two clinical workflows that share one anatomical map. They are never merged semantically. */
export const RECORD_TYPES = ["dermatology", "aesthetic"] as const;
export type DermRecordType = (typeof RECORD_TYPES)[number];

export const SURFACE_IDS = ["anterior", "posterior", "lateral", "medial"] as const;
export type SurfaceId = (typeof SURFACE_IDS)[number];

export const REGION_GROUPS = ["face", "scalp", "body"] as const;
export type RegionGroup = (typeof REGION_GROUPS)[number];

export type RegionSide = "left" | "right" | "midline";

export interface RegionDef {
  id: string;
  group: RegionGroup;
  side: RegionSide;
  /** Optional parent (for future sub-regions). Not used for validation in V1. */
  parent?: string;
  /** Surfaces this region may be qualified with. Empty = the region has no meaningful surface qualifier. */
  surfaces: readonly SurfaceId[];
  active: boolean;
}

const ALL4: readonly SurfaceId[] = ["anterior", "posterior", "lateral", "medial"];
const NONE: readonly SurfaceId[] = [];

const r = (
  id: string,
  group: RegionGroup,
  side: RegionSide,
  surfaces: readonly SurfaceId[] = NONE
): RegionDef => ({ id, group, side, surfaces, active: true });

/** Left/right pair helper — always emits `left_<x>` then `right_<x>`. */
const pair = (base: string, group: RegionGroup, surfaces: readonly SurfaceId[] = NONE): RegionDef[] => [
  r(`left_${base}`, group, "left", surfaces),
  r(`right_${base}`, group, "right", surfaces),
];

export const REGIONS: readonly RegionDef[] = [
  // ---------------- FACE (and front / sides of the neck) ----------------
  r("forehead", "face", "midline"),
  r("glabella", "face", "midline"),
  ...pair("temple", "face"),
  ...pair("brow", "face"),
  ...pair("periorbital", "face"),
  ...pair("infraorbital", "face"),
  r("nose", "face", "midline"),
  ...pair("cheek", "face"),
  ...pair("ear", "face"),
  r("upper_lip", "face", "midline"),
  r("lower_lip", "face", "midline"),
  r("perioral", "face", "midline"),
  ...pair("jawline", "face"),
  r("chin", "face", "midline"),
  r("anterior_neck", "face", "midline"),
  ...pair("lateral_neck", "face"),

  // ---------------- SCALP ----------------
  r("frontal_scalp", "scalp", "midline"),
  r("top_scalp", "scalp", "midline"),
  r("vertex_scalp", "scalp", "midline"),
  ...pair("temporal_scalp", "scalp"),
  ...pair("lateral_scalp", "scalp"),
  r("occipital_scalp", "scalp", "midline"),

  // ---------------- BODY ----------------
  r("posterior_neck", "body", "midline"),
  ...pair("shoulder", "body", ["anterior", "posterior", "lateral"]),
  ...pair("chest", "body"),
  r("abdomen", "body", "midline"),
  ...pair("flank", "body"),
  r("upper_back", "body", "midline"),
  r("lower_back", "body", "midline"),
  ...pair("upper_arm", "body", ALL4),
  ...pair("elbow", "body", ALL4),
  ...pair("forearm", "body", ALL4),
  ...pair("hand", "body", ALL4),
  ...pair("buttock", "body"),
  ...pair("thigh", "body", ALL4),
  ...pair("knee", "body", ALL4),
  ...pair("lower_leg", "body", ALL4),
  ...pair("ankle", "body", ALL4),
  ...pair("foot", "body", ALL4),
];

const byId = new Map<string, RegionDef>(REGIONS.map((x) => [x.id, x]));

export const REGION_IDS: readonly string[] = REGIONS.map((x) => x.id);
export const getRegion = (id: string): RegionDef | undefined => byId.get(id);
/** True for any id that exists in the registry (active or retired) — used for READ filters. */
export const isKnownRegion = (id: string): boolean => byId.has(id);

// ---------------- limits ----------------
export const MAX_REGIONS_PER_ASSESSMENT = 12;
export const MAX_TEXT = { concern: 500, findings: 3000, diagnosis: 300, notes: 3000, voidNote: 500 } as const;
/** Marker coordinates are region-local and normalised — see `MARKER_SPACE`. */
export const MARKER_SPACE = "region-aabb/v1";

// ---------------- pure validation (no DB; unit-tested) ----------------
export interface RegionRefInput {
  id: string;
  surface?: string | null;
}
export interface RegionRef {
  id: string;
  surface?: SurfaceId;
}
export type RegionRefsResult = { ok: true; regions: RegionRef[] } | { ok: false; message: string };

/**
 * Validates the regions of ONE assessment: 1..MAX regions, every id known + ACTIVE, no duplicates, and a surface
 * only where the registry allows it for that specific region.
 */
export function validateRegionRefs(input: readonly RegionRefInput[]): RegionRefsResult {
  if (!input.length) return { ok: false, message: "At least one anatomical region is required" };
  if (input.length > MAX_REGIONS_PER_ASSESSMENT) {
    return { ok: false, message: `At most ${MAX_REGIONS_PER_ASSESSMENT} regions can be documented in one assessment` };
  }
  const seen = new Set<string>();
  const out: RegionRef[] = [];
  for (const ref of input) {
    const def = byId.get(ref.id);
    if (!def) return { ok: false, message: `Unknown anatomical region: ${ref.id}` };
    if (!def.active) return { ok: false, message: `Anatomical region is no longer available: ${ref.id}` };
    if (seen.has(ref.id)) return { ok: false, message: `Duplicate region: ${ref.id}` };
    seen.add(ref.id);
    const surface = ref.surface ?? undefined;
    if (surface === undefined) {
      out.push({ id: ref.id });
      continue;
    }
    if (!(SURFACE_IDS as readonly string[]).includes(surface)) {
      return { ok: false, message: `Invalid surface: ${surface}` };
    }
    if (!def.surfaces.includes(surface as SurfaceId)) {
      return { ok: false, message: `Surface "${surface}" is not applicable to ${ref.id}` };
    }
    out.push({ id: ref.id, surface: surface as SurfaceId });
  }
  return { ok: true, regions: out };
}

export interface MarkerInput {
  regionId: string;
  u: number;
  v: number;
  w: number;
}
export type MarkersResult = { ok: true; markers: MarkerInput[] } | { ok: false; message: string };

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * A marker is OPTIONAL VISUAL metadata inside a region. It is expressed in MODEL-INDEPENDENT coordinates
 * (`MARKER_SPACE`): (u,v,w) ∈ [0,1]³ inside the axis-aligned bounding box of the REGION in the canonical
 * anatomical frame (x: patient right→left, y: inferior→superior, z: posterior→anterior). The clinical identity
 * stays the region id — a marker can be re-projected onto any future 3D model, and losing it never loses history.
 * At most one marker per region, and only for regions that are part of the same assessment.
 */
export function validateMarkers(input: readonly MarkerInput[], regionIds: readonly string[]): MarkersResult {
  const allowed = new Set(regionIds);
  const seen = new Set<string>();
  const out: MarkerInput[] = [];
  for (const m of input) {
    if (!allowed.has(m.regionId)) return { ok: false, message: `Marker region is not part of this assessment: ${m.regionId}` };
    if (seen.has(m.regionId)) return { ok: false, message: `Only one marker per region is allowed: ${m.regionId}` };
    seen.add(m.regionId);
    for (const k of ["u", "v", "w"] as const) {
      const n = m[k];
      if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) {
        return { ok: false, message: `Marker coordinate ${k} must be a number between 0 and 1` };
      }
    }
    out.push({ regionId: m.regionId, u: round4(m.u), v: round4(m.v), w: round4(m.w) });
  }
  return { ok: true, markers: out };
}
