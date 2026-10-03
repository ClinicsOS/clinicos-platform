import { getToothMeta, jawRowFdis, type Jaw } from "./fdi";

/**
 * Pure helpers for LONG tooth lists (a veneer case can be 16 teeth) and for the tooth picker's quick selections.
 * No React, no three.js — headless-testable.
 *
 * The four chart rows in clinical view order (viewer-left -> viewer-right):
 *   permanent upper 18…11 | 21…28      permanent lower 48…41 | 31…38
 *   primary   upper 55…51 | 61…65      primary   lower 85…81 | 71…75
 */
interface ChartRow { id: "pu" | "pl" | "du" | "dl"; jaw: Jaw; primary: boolean; fdis: string[] }

export const CHART_ROWS: readonly ChartRow[] = [
  { id: "pu", jaw: "upper", primary: false, fdis: jawRowFdis("upper", "permanent") },
  { id: "pl", jaw: "lower", primary: false, fdis: jawRowFdis("lower", "permanent") },
  { id: "du", jaw: "upper", primary: true, fdis: jawRowFdis("upper", "primary") },
  { id: "dl", jaw: "lower", primary: true, fdis: jawRowFdis("lower", "primary") },
];

const ORDER = new Map<string, number>();
CHART_ROWS.forEach((r, ri) => r.fdis.forEach((f, i) => ORDER.set(f, ri * 100 + i)));

/** Stable chart order (permanent upper, permanent lower, primary upper, primary lower; viewer-left -> right). */
export const sortByChart = (fdis: readonly string[]): string[] =>
  Array.from(new Set(fdis)).sort((a, b) => (ORDER.get(a) ?? 9999) - (ORDER.get(b) ?? 9999));

/** Wraps a range in left-to-right isolates so "14–24" is never visually reversed inside Arabic text. */
const ltr = (s: string) => `\u2066${s}\u2069`;

/**
 * "Upper 14–24 · Lower 34–44", "Upper arch", "All teeth", "12, 22". Runs are contiguous in CHART order, so a range
 * across the midline (14–24) reads the way the doctor draws it. Short lists (<= 3 teeth in a row) stay as plain numbers.
 */
export function teethSummary(fdis: readonly string[], t: (k: string) => string): string {
  const set = new Set(fdis);
  if (!set.size) return "";
  const parts: string[] = [];
  const full: Record<string, boolean> = {};
  const rowSel = CHART_ROWS.map((r) => ({ r, sel: r.fdis.filter((f) => set.has(f)) }));
  rowSel.forEach(({ r, sel }) => { full[r.id] = sel.length === r.fdis.length; });
  const handled = new Set<string>();

  if (full.pu && full.pl) {
    parts.push(t("dn.pick.all"));
    rowSel.filter(({ r }) => r.id === "pu" || r.id === "pl").forEach(({ sel }) => sel.forEach((f) => handled.add(f)));
  }
  for (const { r, sel } of rowSel) {
    if (!sel.length || sel.every((f) => handled.has(f))) continue;
    const jawWord = t(r.jaw === "upper" ? "dn.pick.upper" : "dn.pick.lower") + (r.primary ? ` ${t("dn.pick.primaryShort")}` : "");
    if (full[r.id]) { parts.push(t(r.jaw === "upper" ? "dn.pick.upperArch" : "dn.pick.lowerArch") + (r.primary ? ` ${t("dn.pick.primaryShort")}` : "")); continue; }
    const runs: string[] = [];
    let i = 0;
    while (i < r.fdis.length) {
      if (!set.has(r.fdis[i])) { i++; continue; }
      let j = i;
      while (j + 1 < r.fdis.length && set.has(r.fdis[j + 1])) j++;
      const len = j - i + 1;
      if (len >= 3) {
        // A range across the midline is written the way clinicians say it (lower: 34–44, not 44–34): lower quadrant number first.
        let a = r.fdis[i], b = r.fdis[j];
        if (a[0] !== b[0] && Number(a[0]) > Number(b[0])) [a, b] = [b, a];
        runs.push(ltr(`${a}–${b}`));
      }
      else for (let k = i; k <= j; k++) runs.push(ltr(r.fdis[k]));
      i = j + 1;
    }
    parts.push(`${jawWord} ${runs.join(", ")}`);
  }
  // anything that is not on a chart row (should never happen) is still shown, never silently dropped
  const stray = Array.from(set).filter((f) => !ORDER.has(f));
  if (stray.length) parts.push(stray.map(ltr).join(", "));
  return parts.join(" · ");
}

// ---------------------------------------------------------------- quick selections
export type PickPreset = "upperArch" | "lowerArch" | "all" | "smileUpper" | "smileLower";

const SMILE_UPPER = ["14", "13", "12", "11", "21", "22", "23", "24"];
const SMILE_LOWER = ["34", "33", "32", "31", "41", "42", "43", "44"];

const jawOf = (fdi: string) => getToothMeta(fdi)?.jaw;

/** The teeth a preset stands for, restricted to the teeth the chart actually has (`available`). */
export function presetTeeth(p: PickPreset, available: readonly string[]): string[] {
  const have = new Set(available);
  switch (p) {
    case "upperArch": return sortByChart(available.filter((f) => jawOf(f) === "upper"));
    case "lowerArch": return sortByChart(available.filter((f) => jawOf(f) === "lower"));
    case "all": return sortByChart(available);
    case "smileUpper": return sortByChart(SMILE_UPPER.filter((f) => have.has(f)));
    case "smileLower": return sortByChart(SMILE_LOWER.filter((f) => have.has(f)));
  }
}

/** Preset button behaviour: if every tooth of the preset is already selected it is removed, otherwise it is added. */
export function togglePreset(current: readonly string[], p: PickPreset, available: readonly string[]): string[] {
  const target = presetTeeth(p, available);
  if (!target.length) return sortByChart(current);
  const cur = new Set(current);
  const allIn = target.every((f) => cur.has(f));
  if (allIn) target.forEach((f) => cur.delete(f)); else target.forEach((f) => cur.add(f));
  return sortByChart(Array.from(cur));
}

export const presetAvailable = (p: PickPreset, available: readonly string[]) => presetTeeth(p, available).length > 0;
