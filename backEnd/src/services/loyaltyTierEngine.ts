import {
  TIER_DEFAULT_NAMES,
  TIER_KEYS,
  TIER_LIMITS,
  TIER_METRICS,
  tierRank,
  type TierKey,
  type TierMetric,
} from "../config/loyalty";

/**
 * ClinicOS Loyalty — TIER ENGINE, pure part (Phase 7).
 *
 * No database, no clock, no side effects: everything that DECIDES a tier lives here, in one place, so it can be tested
 * exhaustively and no controller ever calculates a tier on its own. Persistence (counters, history, hooks) is in
 * services/loyaltyTiers.ts and always calls these functions.
 *
 * ── Units ──────────────────────────────────────────────────────────────────────────────────────────────
 * Every metric value and threshold INSIDE the engine is an integer in the metric's INTERNAL unit:
 *   lifetime_points   points
 *   completed_visits  visits
 *   lifetime_spending fils (1 JOD = 1000 fils — the same integer-money rule the Points Engine uses)
 * The API/UI speak DISPLAY units (points, visits, JOD with ≤ 3 decimals); `toInternal` / `toDisplay` convert.
 *
 * ── Progress formula ───────────────────────────────────────────────────────────────────────────────────
 * Progress is measured WITHIN the current tier toward the next one:
 *     progress% = floor( (value − threshold(current)) / (threshold(next) − threshold(current)) × 100 ), clamped to 0…99
 * e.g. Silver 1,000 → Gold 3,000, value 2,000  →  (2000−1000)/(3000−1000) = 50 %   (NOT 2000/3000).
 * It is capped at 99 until the next tier is actually reached, so "100 %" never appears for a member who is still not promoted.
 * The top tier has no next tier: remaining 0, progress 100 %, `isTopTier: true`.
 */

export const FILS_PER_JOD = 1000;

export const isTierKey = (v: unknown): v is TierKey => typeof v === "string" && (TIER_KEYS as readonly string[]).includes(v);
export const isTierMetric = (v: unknown): v is TierMetric => typeof v === "string" && (TIER_METRICS as readonly string[]).includes(v);

export type TierUnit = "points" | "visits" | "jod";
export const unitOf = (m: TierMetric): TierUnit => (m === "lifetime_points" ? "points" : m === "completed_visits" ? "visits" : "jod");

/** display unit → internal integer (null when not representable, e.g. 1.5 points or 0.0001 JOD). */
export function toInternal(metric: TierMetric, display: number): number | null {
  if (typeof display !== "number" || !Number.isFinite(display) || display < 0) return null;
  if (metric === "lifetime_spending") {
    const fils = Math.round(display * FILS_PER_JOD);
    if (Math.abs(display * FILS_PER_JOD - fils) > 1e-6) return null; // more than 3 decimals
    return Number.isSafeInteger(fils) ? fils : null;
  }
  return Number.isSafeInteger(display) ? display : null;
}
/** internal integer → display unit. */
export const toDisplay = (metric: TierMetric, internal: number): number => (metric === "lifetime_spending" ? Math.round(internal) / FILS_PER_JOD : internal);

/* ============================================================
 * Configuration
 * ============================================================ */

export interface TierBenefit {
  title: string;
  description: string | null;
}
export interface TierSlot {
  key: TierKey;
  name: string;
  /** internal unit; tier1 is always 0; null = not configured yet (tier2…4 before the clinic sets them) */
  threshold: number | null;
  description: string | null;
  benefits: TierBenefit[];
}
export interface TierConfig {
  enabled: boolean;
  metric: TierMetric | null;
  rulesVersion: number;
  tiers: Record<TierKey, TierSlot>;
}

/** Reads the settings document (stored or defaulted) into a clean config; never throws on a partial / legacy document. */
export function normalizeTierConfig(settings: Record<string, any> | null | undefined): TierConfig {
  const t = (settings?.tiers ?? {}) as Record<string, any>;
  const tiers = {} as Record<TierKey, TierSlot>;
  for (const key of TIER_KEYS) {
    const s = (t[key] ?? {}) as Record<string, any>;
    const rawName = typeof s.name === "string" ? s.name.trim() : "";
    tiers[key] = {
      key,
      name: rawName || TIER_DEFAULT_NAMES[key],
      threshold: key === "tier1" ? 0 : typeof s.threshold === "number" && Number.isSafeInteger(s.threshold) && s.threshold >= 0 ? s.threshold : null,
      description: typeof s.description === "string" && s.description.trim() ? s.description.trim() : null,
      benefits: Array.isArray(s.benefits)
        ? s.benefits
            .filter((b: any) => b && typeof b.title === "string" && b.title.trim())
            .map((b: any) => ({ title: String(b.title), description: typeof b.description === "string" && b.description.trim() ? b.description : null }))
        : [],
    };
  }
  return {
    enabled: !!t.enabled,
    metric: isTierMetric(t.progressionMetric) ? t.progressionMetric : null,
    rulesVersion: typeof t.rulesVersion === "number" ? t.rulesVersion : 0,
    tiers,
  };
}

/** True when the thresholds are complete and strictly ordered — i.e. the config can actually be used for calculation. */
export const isUsable = (c: TierConfig): boolean => c.enabled && c.metric !== null && validateThresholds(c.metric, thresholdList(c)) === null;

export const thresholdList = (c: TierConfig): (number | null)[] => TIER_KEYS.map((k) => c.tiers[k].threshold);

/**
 * Backend threshold validation (the UI repeats it for comfort, this is the authority).
 * Returns an error message or null.  tier1 must be 0; tier2 > tier1; tier3 > tier2; tier4 > tier3; all whole internal units
 * within the metric's technical maximum. Duplicates, descending order, negatives and fractions are all rejected.
 */
export function validateThresholds(metric: TierMetric, thresholds: (number | null)[]): string | null {
  if (thresholds.length !== TIER_KEYS.length) return "Four tier thresholds are required";
  if (thresholds[0] !== 0) return "The first tier is the base tier and must start at 0";
  const max = toInternal(metric, TIER_LIMITS.maxThreshold[metric]) as number;
  for (let i = 1; i < thresholds.length; i++) {
    const v = thresholds[i];
    if (v === null || typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) return `Set a threshold for tier ${i + 1}`;
    if (v > max) return `Tier ${i + 1} threshold is above the maximum allowed`;
    const prev = thresholds[i - 1] as number;
    if (v <= prev) return `Each tier must need MORE than the one before it (tier ${i + 1} must be greater than tier ${i})`;
  }
  return null;
}

/* ============================================================
 * Calculation
 * ============================================================ */

/** The metric value of a member, from the stored progression counters (internal unit). */
export function metricValueOf(metric: TierMetric, progress: { earnedPoints?: number; completedVisits?: number; paidFils?: number } | null | undefined): number {
  const v = metric === "lifetime_points" ? progress?.earnedPoints : metric === "completed_visits" ? progress?.completedVisits : progress?.paidFils;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** The highest tier whose threshold the value has reached. Throws if the config is not usable (callers check `isUsable`). */
export function calculateTier(config: TierConfig, value: number): TierKey {
  if (!isUsable(config)) throw new Error("Tier configuration is not usable");
  let result: TierKey = "tier1";
  for (const k of TIER_KEYS) {
    const th = config.tiers[k].threshold as number;
    if (value >= th) result = k;
  }
  return result;
}

export interface TierProgress {
  metric: TierMetric;
  unit: TierUnit;
  /** display units */
  metricValue: number;
  currentTierKey: TierKey;
  currentTierName: string;
  currentTierRank: number;
  currentTierThreshold: number;
  highestTierKey: TierKey;
  highestTierName: string;
  nextTierKey: TierKey | null;
  nextTierName: string | null;
  nextTierThreshold: number | null;
  /** display units; 0 at the top tier */
  remaining: number;
  /** integer 0…100 — WITHIN the current tier (see header) */
  progressPercent: number;
  isTopTier: boolean;
}

/**
 * Full progress picture for a member whose CURRENT tier is `currentKey` (the stored tier — tiers are never lowered by events)
 * and who has reached at most `highestKey`. `value` is internal units.
 */
export function calculateTierProgress(config: TierConfig, value: number, currentKey: TierKey, highestKey?: TierKey | null): TierProgress {
  if (!config.metric) throw new Error("Tier configuration has no progression metric");
  const metric = config.metric;
  const idx = TIER_KEYS.indexOf(currentKey);
  const cur = config.tiers[currentKey];
  const nextKey = idx < TIER_KEYS.length - 1 ? TIER_KEYS[idx + 1] : null;
  const next = nextKey ? config.tiers[nextKey] : null;
  const curTh = (cur.threshold ?? 0) as number;
  const hi = highestKey && tierRank(highestKey) > tierRank(currentKey) ? highestKey : currentKey;

  let percent = 100;
  let remaining = 0;
  if (next && next.threshold !== null) {
    const span = next.threshold - curTh;
    const ratio = span > 0 ? (value - curTh) / span : 0;
    percent = Math.max(0, Math.min(99, Math.floor(ratio * 100)));
    remaining = Math.max(0, next.threshold - value);
  }
  return {
    metric,
    unit: unitOf(metric),
    metricValue: toDisplay(metric, value),
    currentTierKey: currentKey,
    currentTierName: cur.name,
    currentTierRank: idx + 1,
    currentTierThreshold: toDisplay(metric, curTh),
    highestTierKey: hi,
    highestTierName: config.tiers[hi].name,
    nextTierKey: nextKey,
    nextTierName: next ? next.name : null,
    nextTierThreshold: next && next.threshold !== null ? toDisplay(metric, next.threshold) : null,
    remaining: toDisplay(metric, remaining),
    progressPercent: percent,
    isTopTier: !next,
  };
}

/* ============================================================
 * Display-name & text rules (clinic-controlled content — plain text only)
 * ============================================================ */

const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;
/** letters / digits / marks in any script, plus a few harmless punctuation marks. No angle brackets, quotes-as-markup, slashes, braces. */
const NAME_RX = /^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M} .'’&+\-]*$/u;
const FORBIDDEN_TEXT = /[<>\u0000-\u001f\u007f]/;

export const squeeze = (s: string) => s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();

const HAS_CONTROL = new RegExp(CONTROL.source);

export function checkTierName(raw: string): { ok: true; value: string } | { ok: false; message: string } {
  // Control / invisible / bidi-override characters are refused outright (never silently "cleaned") — plain visible text only.
  if (HAS_CONTROL.test(raw)) return { ok: false, message: "A tier name can't contain control or invisible characters" };
  const v = squeeze(raw);
  if (v.length < TIER_LIMITS.nameMin || v.length > TIER_LIMITS.nameMax) return { ok: false, message: `A tier name must be ${TIER_LIMITS.nameMin}–${TIER_LIMITS.nameMax} characters` };
  if (!NAME_RX.test(v)) return { ok: false, message: "A tier name may contain letters, numbers, spaces and - ' & + . only" };
  return { ok: true, value: v };
}

export function checkPlainText(raw: string, max: number, min = 0): { ok: true; value: string } | { ok: false; message: string } {
  if (HAS_CONTROL.test(raw)) return { ok: false, message: "Text can't contain control or invisible characters (or line breaks)" };
  const v = squeeze(raw);
  if (v.length < min || v.length > max) return { ok: false, message: `Text must be ${min}–${max} characters` };
  if (FORBIDDEN_TEXT.test(v)) return { ok: false, message: "Text can't contain < or > characters" };
  return { ok: true, value: v };
}
