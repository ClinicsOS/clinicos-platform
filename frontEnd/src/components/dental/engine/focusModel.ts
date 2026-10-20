/**
 * PHASE 5 — Tooth Focus model (pure: no Three.js, no DOM, so it is unit-tested headlessly).
 *
 * One function answers "how should EVERY tooth look right now?" from four facts: which tooth is selected, whether the camera is in
 * Focus, whether the doctor asked for Isolation, and which SURFACE is selected. The engine only applies the answer to each ToothVisual
 * (per-tooth opacity / emphasis / lift) — nothing here mutates a material, a geometry or a transform, which is exactly why neighbours can
 * go see-through and come back to EXACTLY their original look: the targets are absolute values, never deltas.
 *
 *   none     nothing selected                                   -> whole jaw as charted
 *   select   a tooth is selected                                -> jaw softly de-emphasised, neighbours a little see-through, tooth lifted a hair
 *   focus    close-up on the tooth                              -> stronger, neighbours more see-through
 *   isolate  doctor pressed "Isolate Tooth"                     -> the two neighbours (and, fainter, the ones next to them) almost vanish so
 *                                                                  Mesial and Distal are fully visible; the tooth moves slightly outward
 * A selected M or D surface additionally lets the neighbour on THAT side go see-through even without isolation (you can see what you picked).
 * Serial (multi) selection never lifts or isolates: pulling several teeth out of the arch would be clinically misleading.
 */
import { adjacentTeeth, archDistance } from "@/lib/dental/neighbors";
import type { SurfaceId } from "@/lib/dental/taxonomy";

export type FocusLevel = "none" | "select" | "focus" | "isolate";
export type HeroLevel = 0 | 1 | 2 | 3;

export interface FocusTuning {
  /** Emphasis (darker/desaturated) of teeth that are not the selected one. */
  others: number;
  /** Opacity of the two immediate neighbours. */
  neighbour: number;
  /** Opacity of the teeth one further away (isolation only). */
  ring2: number;
  hero: HeroLevel;
  gum: number;
  fog: number;
}

export const FOCUS_TUNING: Readonly<Record<FocusLevel, FocusTuning>> = {
  none: { others: 1, neighbour: 1, ring2: 1, hero: 0, gum: 1, fog: 0 },
  select: { others: 0.45, neighbour: 0.55, ring2: 1, hero: 1, gum: 0.42, fog: 0.6 },
  focus: { others: 0.25, neighbour: 0.32, ring2: 1, hero: 2, gum: 0.25, fog: 1 },
  isolate: { others: 0.18, neighbour: 0.04, ring2: 0.15, hero: 3, gum: 0.2, fog: 1 },
};
/** A selected M/D surface reveals itself by fading the neighbour on that side to at most this. */
export const SURFACE_REVEAL_ALPHA = 0.2;
/** Emphasis of every tooth NOT in a serial selection (so the picked ones read clearly) — still fully visible. */
export const MULTI_OTHERS = 0.72;

export function focusLevelOf(selected: string | null, focusing: boolean, isolated: boolean): FocusLevel {
  if (!selected) return "none";
  if (isolated) return "isolate";
  return focusing ? "focus" : "select";
}

export interface ToothFocusTarget { emphasis: number; neighbourAlpha: number; hero: HeroLevel; multi: boolean }

export interface FocusInput {
  shown: readonly string[];
  selected: string | null;
  focusing: boolean;
  isolated: boolean;
  surface?: SurfaceId | null;
  multiSelected?: ReadonlySet<string>;
}

export function computeFocusTargets(inp: FocusInput): { level: FocusLevel; tuning: FocusTuning; teeth: Map<string, ToothFocusTarget> } {
  const multiSel = inp.multiSelected ?? new Set<string>();
  const multiOn = multiSel.size > 0 && !inp.selected;
  const level = multiOn ? "none" : focusLevelOf(inp.selected, inp.focusing, inp.isolated);
  const tuning = FOCUS_TUNING[level];
  const teeth = new Map<string, ToothFocusTarget>();
  const nb = inp.selected ? adjacentTeeth(inp.shown, inp.selected) : { mesial: null, distal: null };
  const revealSide = inp.selected && (inp.surface === "M" || inp.surface === "D") ? (inp.surface === "M" ? nb.mesial : nb.distal) : null;
  for (const f of inp.shown) {
    const isSel = !!inp.selected && f === inp.selected;
    let emphasis = 1, alpha = 1;
    let hero: HeroLevel = 0;
    if (multiOn) {
      emphasis = multiSel.has(f) ? 1 : MULTI_OTHERS;
    } else if (inp.selected) {
      if (isSel) { hero = tuning.hero; }
      else {
        emphasis = tuning.others;
        const dist = archDistance(inp.shown, inp.selected, f);
        if (dist === 1) alpha = tuning.neighbour;
        else if (dist === 2) alpha = tuning.ring2;
      }
      if (revealSide && f === revealSide) alpha = Math.min(alpha, SURFACE_REVEAL_ALPHA);
    }
    teeth.set(f, { emphasis, neighbourAlpha: alpha, hero, multi: multiSel.has(f) });
  }
  return { level, tuning, teeth };
}

/** Stable text form for the `data-focus` attribute / diagnostics: "isolate|26|M|nb=25:0.04,27:0.04". */
export function focusSummaryOf(level: FocusLevel, selected: string | null, surface: SurfaceId | null, teeth: Map<string, ToothFocusTarget>): string {
  const faded = Array.from(teeth.entries()).filter(([, v]) => v.neighbourAlpha < 1).map(([f, v]) => `${f}:${v.neighbourAlpha}`).sort();
  return `${level}|${selected ?? ""}|${surface ?? ""}|${faded.join(",")}`;
}

/** What the engine needs from a tooth to apply a focus result (ToothVisual implements it; tests use the real ToothVisual too). */
export interface FocusableTooth {
  setEmphasisTarget(v: number): void;
  setNeighborAlpha(a: number): void;
  setHero(level: number): void;
  setMultiSelected(on: boolean): void;
}

/** Applies a computeFocusTargets() result to the teeth. The ONE place that turns the model into per-tooth targets (engine + headless tests). */
export function applyFocusTargets(teeth: ReadonlyMap<string, FocusableTooth>, targets: ReadonlyMap<string, ToothFocusTarget>) {
  teeth.forEach((v, f) => {
    const tg = targets.get(f);
    if (!tg) return;
    v.setEmphasisTarget(tg.emphasis);
    v.setNeighborAlpha(tg.neighbourAlpha);
    v.setHero(tg.hero);
    v.setMultiSelected(tg.multi);
  });
}
