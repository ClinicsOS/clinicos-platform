/**
 * PHASE 5 — canonical tooth-SURFACE orientation. The ONE place that knows which way Mesial / Distal point for a given tooth.
 *
 * Mesial = toward the dental MIDLINE, Distal = away from it. They are anatomical directions, not "left / right of the picture":
 * on the patient-right quadrants (1, 4, 5, 8 — drawn on the viewer's LEFT) distal is on the viewer's left, on the patient-left
 * quadrants (2, 3, 6, 7 — viewer's RIGHT) it is on the viewer's right. Primary teeth follow the same sides.
 *
 * The 2D chart (surface geometry), the 3D engine (marker anchors, camera-to-surface) and the tooth panel all derive from
 * `getSurfaceOrientation`, so there is no second copy of the quadrant logic that could disagree. Storage is unchanged: the
 * database keeps the canonical ids M, D, B, L, O (B = buccal/facial, L = lingual/palatal, O = occlusal/incisal); only the DISPLAY
 * letters / names adapt to the tooth (anterior teeth show F / P|L / I, posterior B / P|L / O).
 *
 * Pure (no React, no Three.js) -> unit-tested in tests/dental-p5-color-surfaces.test.mjs.
 */
import { getToothMeta, type ToothMeta } from "./fdi";
import { SURFACE_LABELS, type SurfaceId } from "./taxonomy";

export type ViewerHorizontal = "left" | "right";

export interface SurfaceOrientation {
  fdi: string;
  jaw: "upper" | "lower";
  /** FDI viewer side of the tooth's quadrant: -1 = viewer-left (patient right), +1 = viewer-right. */
  side: -1 | 1;
  /** Incisors + canines. They have an incisal edge (stored as "O") instead of an occlusal table. */
  anterior: boolean;
  /** In the front (facial) view: the viewer side the DISTAL surface faces (away from the midline). */
  distalSide: ViewerHorizontal;
  mesialSide: ViewerHorizontal;
  /** World X direction (+1 = viewer right) the distal / mesial surface faces — the engine's frame. */
  distalX: -1 | 1;
  mesialX: -1 | 1;
  /** Short DISPLAY letter of each canonical surface for THIS tooth. */
  letters: Record<SurfaceId, string>;
  /** i18n key of the full name of each surface for THIS tooth (dn2.s.*). */
  nameKeys: Record<SurfaceId, string>;
  /** 2D occlusal cross: which canonical surface sits on each side of the tooth drawing (centre is always O). */
  cross: { top: SurfaceId; bottom: SurfaceId; left: SurfaceId; right: SurfaceId; centre: "O" };
}

export function surfaceOrientationOf(meta: ToothMeta): SurfaceOrientation {
  const anterior = meta.family === "incisor" || meta.family === "canine";
  const upper = meta.jaw === "upper";
  const distalX = meta.side; // away from the midline = further along the tooth's own half
  const mesialX = (meta.side * -1) as -1 | 1;
  const distalSide: ViewerHorizontal = distalX === -1 ? "left" : "right";
  const mesialSide: ViewerHorizontal = distalSide === "left" ? "right" : "left";
  const letters: Record<SurfaceId, string> = {
    M: "M", D: "D",
    B: anterior ? "F" : "B",
    L: upper ? "P" : "L",
    O: anterior ? "I" : "O",
  };
  const nameKeys: Record<SurfaceId, string> = {
    M: "dn2.s.M", D: "dn2.s.D",
    B: anterior ? "dn2.s.F" : "dn2.s.B",
    L: upper ? "dn2.s.P" : "dn2.s.L",
    O: anterior ? "dn2.s.I" : "dn2.s.O",
  };
  // Outer (facial) side away from the middle of the chart: upper row -> top, lower row -> bottom.
  const cross = {
    top: (upper ? "B" : "L") as SurfaceId,
    bottom: (upper ? "L" : "B") as SurfaceId,
    left: (distalSide === "left" ? "D" : "M") as SurfaceId,
    right: (distalSide === "left" ? "M" : "D") as SurfaceId,
    centre: "O" as const,
  };
  return { fdi: meta.fdi, jaw: meta.jaw, side: meta.side, anterior, distalSide, mesialSide, distalX, mesialX, letters, nameKeys, cross };
}

/** The canonical helper: orientation of tooth `fdi` (undefined for a code that is not a tooth). */
export function getSurfaceOrientation(fdi: string): SurfaceOrientation | undefined {
  const m = getToothMeta(fdi);
  return m ? surfaceOrientationOf(m) : undefined;
}

/**
 * Sign of the DISTAL direction along the tooth's own X axis in the 3D engine's "inner" frame. Upper teeth hang crown-down, so
 * their inner frame is flipped about Z (X is mirrored): the sign flips for the upper jaw. toothVisual.anchor() uses exactly this.
 */
export const innerDistalSign = (meta: Pick<ToothMeta, "side" | "jaw">): -1 | 1 => (meta.side * (meta.jaw === "upper" ? -1 : 1)) as -1 | 1;

/** Display letters for a surface list on tooth `fdi` ("MOD" style): ["M","O","D"] -> "MOD", ordered M, O, D … canonical-stable. */
export function surfaceLetters(fdi: string, surfaces: readonly SurfaceId[]): string {
  const o = getSurfaceOrientation(fdi);
  const order: SurfaceId[] = ["M", "O", "D", "B", "L"];
  const sorted = order.filter((s) => surfaces.includes(s));
  return sorted.map((s) => o?.letters[s] ?? s).join("");
}

/** One surface's display letter ON a given tooth (posterior B/O, anterior F/I). Falls back to the generic label for a non-tooth code. */
export function surfaceLabel(fdi: string | undefined, s: SurfaceId): string {
  const o = fdi ? getSurfaceOrientation(fdi) : undefined;
  return o?.letters[s] ?? SURFACE_LABELS[s];
}

/** Surfaces a tooth can carry, in the canonical storage order. */
export const ALL_SURFACES: readonly SurfaceId[] = ["M", "D", "B", "L", "O"];
