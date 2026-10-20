/**
 * PHASE 5 — ToothMarks: the ONE semantic description of "what is on this tooth", derived from the chart's ToothVisualState
 * (active clinical events + the canonical Treatment Plan). BOTH renderers read it:
 *
 *   2D  -> components/dental/ToothCross.tsx   (SVG surface geometry)
 *   3D  -> components/dental/engine/toothVisual.ts (markers / caps / ghosts on the mesh)
 *
 * so "Planned filling on D" is the same fact — same semantic state, same surface — in both views and in the Treatment Plan.
 * Selection / focus / hover are NOT inputs: they are drawn above the marks and can never erase them.
 *
 * Pure (no React, no Three.js). Unit-tested in tests/dental-p5-color-surfaces.test.mjs.
 */
import type { ToothVisualState } from "./types";
import type { SurfaceId } from "./taxonomy";
import { semanticOfStatus, strongestState, type SemanticState } from "./visualTheme";

export type SurfaceMarkKind = "filling" | "condition";
export interface SurfaceMark {
  kind: SurfaceMarkKind;
  state: SemanticState;
  /** Diagnosis code for a condition mark (caries, infection_abscess …). */
  code?: string;
}

export const SURFACE_IDS: readonly SurfaceId[] = ["M", "D", "B", "L", "O"];

/** Diagnoses that are about a tooth SURFACE: with no surface chosen they are drawn on the biting surface (same rule as the 3D chart). */
const SURFACE_DIAGNOSES = new Set(["caries", "fractured_cracked_tooth", "defective_filling", "tooth_wear"]);

export interface ToothMarks {
  fdi: string;
  surfaces: Record<SurfaceId, SurfaceMark[]>;
  /** Strongest state of a crown on this tooth (existing crown, or a Crown treatment), else null. */
  crown: SemanticState | null;
  /** Existing bridge / implant (conditions); Bridge / Implant TREATMENTS only show through the state badge. */
  restoration: "bridge" | "implant" | null;
  rootCanal: boolean;
  missing: boolean;
  unerupted: boolean;
  partiallyErupted: boolean;
  /** Diagnoses that do not belong to one surface (abscess, mobility, sensitivity…): codes, drawn as a tooth-level dot. */
  looseConditions: string[];
  /** Small status badge (any procedure): the strongest open plan state + whether something was completed. */
  badge: { plan: "planned" | "inProgress" | null; treated: boolean };
  /** The strongest semantic state anywhere on the tooth (null = nothing to show). */
  strongest: SemanticState | null;
}

export function emptyMarks(fdi: string): ToothMarks {
  return {
    fdi, surfaces: { M: [], D: [], B: [], L: [], O: [] }, crown: null, restoration: null, rootCanal: false, missing: false,
    unerupted: false, partiallyErupted: false, looseConditions: [], badge: { plan: null, treated: false }, strongest: null,
  };
}

const RANK: Record<SemanticState, number> = { inProgress: 4, planned: 3, condition: 2, completed: 1, existing: 0, cancelled: -1 };

export function deriveToothMarks(fdi: string, v: ToothVisualState | undefined | null): ToothMarks {
  const m = emptyMarks(fdi);
  if (!v) return m;
  m.missing = !!v.missing;
  m.unerupted = !!v.unerupted;
  m.partiallyErupted = !!v.partiallyErupted;
  m.rootCanal = !!v.rootCanal;
  m.restoration = v.restoration === "bridge" || v.restoration === "implant" ? v.restoration : null;

  const all: SemanticState[] = [];
  const put = (s: SurfaceId, mark: SurfaceMark) => {
    if (!m.surfaces[s].some((x) => x.kind === mark.kind && x.state === mark.state && x.code === mark.code)) m.surfaces[s].push(mark);
    all.push(mark.state);
  };

  if (v.hasFilling) for (const s of v.fillings.length ? v.fillings : (["O"] as SurfaceId[])) put(s, { kind: "filling", state: "existing" });
  const crownStates: SemanticState[] = [];
  if (v.restoration === "crown") crownStates.push("existing");
  for (const x of v.treatments) {
    const st = semanticOfStatus(x.status);
    if (x.kind === "filling") for (const s of x.surfaces.length ? x.surfaces : (["O"] as SurfaceId[])) put(s, { kind: "filling", state: st });
    else crownStates.push(st);
  }
  m.crown = crownStates.length ? strongestCrown(crownStates) : null;
  if (m.crown) all.push(m.crown);

  for (const d of v.diagnoses) {
    if (d.surfaces.length) for (const s of d.surfaces) put(s, { kind: "condition", state: "condition", code: d.code });
    else if (SURFACE_DIAGNOSES.has(d.code)) put("O", { kind: "condition", state: "condition", code: d.code });
    else { if (!m.looseConditions.includes(d.code)) m.looseConditions.push(d.code); all.push("condition"); }
  }

  for (const s of SURFACE_IDS) m.surfaces[s].sort((a, b) => RANK[b.state] - RANK[a.state] || (a.kind < b.kind ? -1 : 1));
  m.looseConditions.sort();
  m.badge = { plan: v.plan === "in_progress" ? "inProgress" : v.plan === "planned" ? "planned" : null, treated: !!v.treated };
  if (m.restoration) all.push("existing");
  if (m.rootCanal) all.push("existing");
  m.strongest = strongestState(all);
  return m;
}

/** A crown that is both planned and existing reads as the open work (in progress > planned > completed > existing). */
function strongestCrown(states: SemanticState[]): SemanticState {
  return states.slice().sort((a, b) => RANK[b] - RANK[a])[0];
}

/** Every mark of a tooth as flat text rows ("filling|planned|D") — one stable, order-independent form for tests and the screen-reader list. */
export function marksSignature(m: ToothMarks): string[] {
  const out: string[] = [];
  for (const s of SURFACE_IDS) for (const x of m.surfaces[s]) out.push(`${x.kind}|${x.state}|${s}${x.code ? `|${x.code}` : ""}`);
  if (m.crown) out.push(`crown|${m.crown}`);
  if (m.restoration) out.push(`${m.restoration}|existing`);
  if (m.rootCanal) out.push("rootCanal|existing");
  if (m.missing) out.push("missing");
  for (const c of m.looseConditions) out.push(`condition|condition|${c}`);
  return out.sort();
}
