import { round3 } from "./agg";

/**
 * PHASE 6 — shared metric helpers.
 *
 * `compare()` is the single implementation of "current vs previous period" used by every section. Division by zero is handled here
 * once: when the previous value is 0 there is NO percentage (never Infinity / NaN) — the state says why instead.
 *   state: "new"   previous was 0 and current > 0          (a percentage would be meaningless)
 *          "none"  both are 0 / not comparable
 *          "up" | "down" | "flat"   previous > 0 (pct is a real number)
 */
export type ChangeState = "new" | "none" | "up" | "down" | "flat";
export interface Comparison {
  current: number | null;
  previous: number | null;
  /** current − previous (absolute) */
  diff: number | null;
  /** percent change, one decimal; null whenever it is not defined */
  pct: number | null;
  state: ChangeState;
}

export function compare(current: number | null, previous: number | null, decimals = 3): Comparison {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) {
    return { current: current === null ? null : round(current, decimals), previous: previous === null ? null : round(previous, decimals), diff: null, pct: null, state: "none" };
  }
  const c = round(current, decimals), p = round(previous, decimals);
  const diff = round(c - p, decimals);
  if (p === 0) return { current: c, previous: p, diff, pct: null, state: c > 0 ? "new" : "none" };
  const pct = Math.round(((c - p) / Math.abs(p)) * 1000) / 10;
  return { current: c, previous: p, diff, pct, state: pct > 0 ? "up" : pct < 0 ? "down" : "flat" };
}
const round = (n: number, d: number) => { const f = 10 ** d; return Math.round(n * f) / f; };

/** a / b as a percentage with one decimal, or null when the denominator is 0 (never NaN / Infinity). */
export const ratePct = (num: number, den: number): number | null => (den > 0 && Number.isFinite(num) ? Math.round((num / den) * 1000) / 10 : null);
/** a / b rounded to 3 decimals (money per unit), or null when b is 0. */
export const perUnit = (num: number, den: number): number | null => (den > 0 ? round3(num / den) : null);

/** Deterministic "largest" pick: highest value wins; ties go to the smallest key so the answer never flips between requests. */
export function topOf<T>(rows: T[], value: (r: T) => number, key: (r: T) => string): T | null {
  let best: T | null = null;
  for (const r of rows) {
    if (value(r) <= 0) continue;
    if (!best || value(r) > value(best) || (value(r) === value(best) && key(r) < key(best))) best = r;
  }
  return best;
}
