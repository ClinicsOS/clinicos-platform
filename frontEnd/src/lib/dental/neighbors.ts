/**
 * PHASE 5 — which teeth are the IMMEDIATE neighbours of a tooth in the arch (the ones that hide its Mesial / Distal surface).
 *
 * Works on the teeth the chart currently SHOWS (permanent, primary or the doctor's mixed chart): the neighbour is the next shown
 * tooth in the same jaw, so a mixed arch with a gap still isolates correctly. The mesial neighbour of the first tooth of a quadrant
 * is the first tooth of the opposite quadrant (across the midline). Pure -> unit-tested in tests/dental-p5-isolation.test.mjs.
 */
import { getToothMeta } from "./fdi";

export interface Neighbours { mesial: string | null; distal: string | null }

/** Arch order key inside one jaw, viewer-left -> viewer-right: …-3, -2, -1 | +1, +2, +3… (side × position). */
const archKey = (fdi: string): number | null => {
  const m = getToothMeta(fdi);
  return m ? m.side * m.position : null;
};

export function adjacentTeeth(shown: readonly string[], fdi: string): Neighbours {
  const me = getToothMeta(fdi);
  if (!me) return { mesial: null, distal: null };
  const row = shown
    .filter((f) => getToothMeta(f)?.jaw === me.jaw)
    .map((f) => ({ f, k: archKey(f) as number }))
    .sort((a, b) => a.k - b.k);
  const i = row.findIndex((r) => r.f === fdi);
  if (i < 0) return { mesial: null, distal: null };
  const left = row[i - 1]?.f ?? null; // viewer-left neighbour
  const right = row[i + 1]?.f ?? null; // viewer-right neighbour
  // distal = away from the midline: toward the viewer-left on side -1, toward the viewer-right on side +1
  return me.side === -1 ? { distal: left, mesial: right } : { distal: right, mesial: left };
}

/** The set a tooth isolation hides / fades: both immediate neighbours (never the tooth itself). */
export function isolationNeighbours(shown: readonly string[], fdi: string): string[] {
  const n = adjacentTeeth(shown, fdi);
  return [n.mesial, n.distal].filter((x): x is string => !!x && x !== fdi);
}

/**
 * How many teeth apart two teeth are inside the same jaw row (1 = immediate neighbours, 0 = the same tooth), counted on the teeth the
 * chart SHOWS and across the midline (11 and 21 are neighbours). null = different jaws / unknown. Drives the isolation fade rings.
 */
export function archDistance(shown: readonly string[], a: string, b: string): number | null {
  const ma = getToothMeta(a), mb = getToothMeta(b);
  if (!ma || !mb || ma.jaw !== mb.jaw) return null;
  const row = shown.filter((f) => getToothMeta(f)?.jaw === ma.jaw).map((f) => ({ f, k: archKey(f) as number })).sort((x, y) => x.k - y.k);
  const i = row.findIndex((r) => r.f === a), j = row.findIndex((r) => r.f === b);
  return i < 0 || j < 0 ? null : Math.abs(i - j);
}
