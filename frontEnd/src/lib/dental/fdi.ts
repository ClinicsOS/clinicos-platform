/**
 * FDI tooth registry — the ONE place where tooth identity, jaw, quadrant and viewer-side
 * are defined. Everything else (3D layout, chart, panel, API calls) refers to a tooth by its
 * FDI string ("16"). Array position / mesh index is NEVER identity.
 *
 * CLINICAL VIEW: standing in front of the patient, PATIENT RIGHT = VIEWER LEFT.
 *   Q1 upper-right & Q4 lower-right  -> viewer-LEFT  (side = -1)
 *   Q2 upper-left  & Q3 lower-left   -> viewer-RIGHT (side = +1)
 * Primary dentition (quadrants 5-8) follows the same sides: 5=UR, 6=UL, 7=LL, 8=LR.
 */
export type DentitionType = "primary" | "mixed" | "permanent";
export type Jaw = "upper" | "lower";
export type ToothFamily = "incisor" | "canine" | "premolar" | "molar";
export type ViewerSide = -1 | 1;

export interface ToothMeta {
  fdi: string;
  dentition: "permanent" | "primary";
  quadrant: number; // 1-4 permanent, 5-8 primary
  position: number; // 1 = closest to the midline
  jaw: Jaw;
  side: ViewerSide;
  family: ToothFamily;
  isThirdMolar: boolean;
}

const QUADRANTS: Record<number, { jaw: Jaw; side: ViewerSide; dentition: "permanent" | "primary" }> = {
  1: { jaw: "upper", side: -1, dentition: "permanent" },
  2: { jaw: "upper", side: 1, dentition: "permanent" },
  3: { jaw: "lower", side: 1, dentition: "permanent" },
  4: { jaw: "lower", side: -1, dentition: "permanent" },
  5: { jaw: "upper", side: -1, dentition: "primary" },
  6: { jaw: "upper", side: 1, dentition: "primary" },
  7: { jaw: "lower", side: 1, dentition: "primary" },
  8: { jaw: "lower", side: -1, dentition: "primary" },
};

const permanentFamily = (p: number): ToothFamily =>
  p <= 2 ? "incisor" : p === 3 ? "canine" : p <= 5 ? "premolar" : "molar";
const primaryFamily = (p: number): ToothFamily => (p <= 2 ? "incisor" : p === 3 ? "canine" : "molar");

function make(quadrant: number, position: number): ToothMeta {
  const q = QUADRANTS[quadrant];
  return {
    fdi: `${quadrant}${position}`,
    dentition: q.dentition,
    quadrant,
    position,
    jaw: q.jaw,
    side: q.side,
    family: q.dentition === "permanent" ? permanentFamily(position) : primaryFamily(position),
    isThirdMolar: q.dentition === "permanent" && position === 8,
  };
}

const seq = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

/** 32 permanent teeth, in quadrant order 1,2,3,4 and position order 1..8 (midline outward). */
export const PERMANENT_TEETH: readonly ToothMeta[] = [1, 2, 3, 4].flatMap((q) => seq(8).map((p) => make(q, p)));
/** 20 primary teeth (51-55, 61-65, 71-75, 81-85). */
export const PRIMARY_TEETH: readonly ToothMeta[] = [5, 6, 7, 8].flatMap((q) => seq(5).map((p) => make(q, p)));

export const TEETH_BY_FDI: ReadonlyMap<string, ToothMeta> = new Map(
  [...PERMANENT_TEETH, ...PRIMARY_TEETH].map((t) => [t.fdi, t])
);

export const getToothMeta = (fdi: string): ToothMeta | undefined => TEETH_BY_FDI.get(fdi);

/** Which teeth the chart shows for a dentition type. */
export function teethForDentition(d: DentitionType): readonly ToothMeta[] {
  if (d === "permanent") return PERMANENT_TEETH;
  if (d === "primary") return PRIMARY_TEETH;
  return [...PERMANENT_TEETH, ...PRIMARY_TEETH];
}

export const isValidFdiFor = (fdi: string, d: DentitionType): boolean =>
  teethForDentition(d).some((t) => t.fdi === fdi);

/** Display order (viewer-left -> viewer-right) for a jaw row of a given dentition. */
export function jawRowFdis(jaw: Jaw, dentition: "permanent" | "primary"): string[] {
  const perm = dentition === "permanent";
  const n = perm ? 8 : 5;
  const [qLeft, qRight] =
    jaw === "upper" ? (perm ? [1, 2] : [5, 6]) : perm ? [4, 3] : [8, 7];
  const left = seq(n).reverse().map((p) => `${qLeft}${p}`); // e.g. 18..11 (distal -> mesial)
  const right = seq(n).map((p) => `${qRight}${p}`); //           e.g. 21..28 (mesial -> distal)
  return [...left, ...right];
}

/** Localised tooth name, e.g. "Upper Right First Molar". */
export function toothName(meta: ToothMeta, t: (key: string) => string): string {
  const pos = meta.dentition === "permanent" ? `dn.pos${meta.position}` : `dn.pp${meta.position}`;
  return `${t(`dn.q${meta.quadrant}`)} ${t(pos)}`;
}

// ---------- Mixed dentition: which teeth are CURRENTLY charted ----------
/**
 * A "slot" is one physical position in the arch: (permanent quadrant, position). Primary quadrant 5-8 maps onto
 * permanent quadrant 1-4 (55 and 15 share slot "1-5"). At most ONE tooth occupies a slot in the current chart.
 * This is only what the chart DISPLAYS: clinical history is kept per FDI and is never touched by these choices.
 */
export const slotKey = (fdi: string): string => {
  const q = Number(fdi[0]);
  return `${q >= 5 ? q - 4 : q}-${fdi[1]}`;
};

/**
 * DEFAULT mixed chart for a NEW record: permanent incisors + permanent first molars, primary canines + primary molars.
 * It is a visual starting point ONLY — not a claim about any patient's real eruption pattern. The doctor decides.
 */
export const DEFAULT_MIXED_TEETH: readonly string[] = [1, 2, 3, 4].flatMap((q) => [
  `${q}1`, `${q}2`, `${q + 4}3`, `${q + 4}4`, `${q + 4}5`, `${q}6`,
]);

/** The teeth the 3D chart displays for a dentition. `current` is only used by mixed (null => default chart). */
export function resolveCurrentTeeth(type: DentitionType, current?: readonly string[] | null): ToothMeta[] {
  if (type === "permanent") return [...PERMANENT_TEETH];
  if (type === "primary") return [...PRIMARY_TEETH];
  const list = current && current.length ? current : DEFAULT_MIXED_TEETH;
  const seen = new Set<string>();
  const out: ToothMeta[] = [];
  list.forEach((fdi) => {
    const m = TEETH_BY_FDI.get(fdi);
    if (m && !seen.has(fdi)) { seen.add(fdi); out.push(m); }
  });
  return out.sort((a, b) => (a.fdi < b.fdi ? -1 : 1));
}

/** The teeth that can occupy the same arch position: the permanent tooth and (positions 1-5) its primary tooth. */
export function slotVariants(meta: ToothMeta): ToothMeta[] {
  const pq = meta.quadrant >= 5 ? meta.quadrant - 4 : meta.quadrant;
  const out: ToothMeta[] = [];
  const perm = TEETH_BY_FDI.get(`${pq}${meta.position}`);
  const prim = meta.position <= 5 ? TEETH_BY_FDI.get(`${pq + 4}${meta.position}`) : undefined;
  if (prim) out.push(prim);
  if (perm) out.push(perm);
  return out;
}
