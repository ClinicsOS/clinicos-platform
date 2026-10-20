/**
 * PHASE 5 — DentalVisualTheme: the ONE semantic colour / shape language of the Dental Chart.
 *
 * Every screen that paints a clinical meaning (3D engine, 2D chart, Treatment Plan chips, tooth panel, hover card, legend)
 * reads THIS file — there are no hard-coded clinical hex values anywhere else. Pure data + tiny pure helpers: no React,
 * no Three.js, so it is unit-tested (tests/dental-p5-color-surfaces.test.mjs).
 *
 * TWO ORTHOGONAL CHANNELS (this is what keeps the chart readable when a tooth carries many things):
 *
 *   STATE  — "where is this in its life?"  condition / planned / inProgress / completed / existing / cancelled
 *            -> colour of the small state badge, the outline style (dashed = intent, solid = done) and the glyph
 *   TYPE   — "what object is it?"          crown / filling / bridge / implant / rootCanal / missing
 *            -> colour + shape of the object itself (gold cap over the whole crown, cobalt dot on ONE surface …)
 *
 * Colour is never the only cue: every state also has a GLYPH (● ○ ◆ ✓ ■ ✕) and a PATTERN (dot / dashed / striped / solid),
 * and every type has a SHAPE (cap, local dome, bar…), so the chart is readable without colour vision.
 *
 * Palette audit (Phase 5): the Phase 4 palette had a near-collision between the Crown gold (#D9A21B) and the diagnosis amber
 * (#E8A93C, ΔE76 = 8.7: a *diagnosis* looked like a *crown*) and between the Bridge metal (#E1CC98) and enamel (#EADFC8, ΔE76 = 17).
 * A CONDITION is now coral-red (the universal "pathology" colour in dental charting) and an abscess a deeper crimson; the bridge is a
 * bronze alloy. tests/dental-p5-color-surfaces.test.mjs keeps every pair that can sit on the same tooth apart (CIE ΔE76 ≥ 20).
 */

export type SemanticState = "condition" | "planned" | "inProgress" | "completed" | "existing" | "cancelled";
export type StatePattern = "dot" | "dashed" | "striped" | "solid" | "none";

export interface StateToken {
  id: SemanticState;
  hex: number;
  css: string;
  /** Text twin of the colour (never colour alone). */
  glyph: string;
  pattern: StatePattern;
  /** i18n key of the legend / badge label. */
  labelKey: string;
  /** 0..1 — how "solid" the object of this state is drawn (ghost = intent, not yet done). */
  weight: number;
}

export const hexCss = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const state = (id: SemanticState, hex: number, glyph: string, pattern: StatePattern, labelKey: string, weight: number): StateToken => ({ id, hex, css: hexCss(hex), glyph, pattern, labelKey, weight });

/** A. condition  B. planned  C. in progress  D. completed  E. existing / history  (+ cancelled, which is never drawn on the chart). */
export const STATE_TOKENS: Readonly<Record<SemanticState, StateToken>> = {
  condition: state("condition", 0xef6a5a, "●", "dot", "dn.legend.diagnosis", 0.62),
  planned: state("planned", 0x6cb6e8, "○", "dashed", "dn.legend.planned", 0.3),
  inProgress: state("inProgress", 0xb49bff, "◆", "striped", "dn.legend.inprogress", 0.55),
  completed: state("completed", 0x62d39a, "✓", "solid", "dn.legend.done", 1),
  existing: state("existing", 0x8e9aaf, "■", "solid", "dn.legend.existing", 1),
  cancelled: state("cancelled", 0x7c8a99, "✕", "none", "dn.ps.cancelled", 0),
};
export const ABSCESS_HEX = 0xa3284a;
export const ABSCESS_CSS = hexCss(ABSCESS_HEX);

export type ObjectKind = "crown" | "filling" | "bridge" | "implant" | "rootCanal" | "missing";
export interface TypeToken { id: ObjectKind; hex: number; css: string; labelKey: string }
const type = (id: ObjectKind, hex: number, labelKey: string): TypeToken => ({ id, hex, css: hexCss(hex), labelKey });
export const TYPE_TOKENS: Readonly<Record<ObjectKind, TypeToken>> = {
  crown: type("crown", 0xd9a21b, "dn.legend.crownWhole"), // gold cap over the WHOLE crown
  filling: type("filling", 0x2f6fe4, "dn.legend.fillingLocal"), // cobalt dome on ONE surface
  bridge: type("bridge", 0xa9683a, "dn.legend.bridge"), // bronze alloy
  implant: type("implant", 0x4a5e75, "dn.legend.implant"), // titanium
  rootCanal: type("rootCanal", 0x3a3f45, "dn.legend.rootCanal"), // dark gutta-percha dot
  missing: type("missing", 0xd3dbe6, "dn.legend.missing"), // dashed pale ghost
};

/** Interaction layers. They are drawn as an OUTLINE / glow ABOVE the clinical picture — never as a fill that would hide it. */
export const UI_TOKENS = {
  selected: { hex: 0x4fc3b8, css: hexCss(0x4fc3b8) }, // brand teal rim on the selected tooth
  focused: { hex: 0x9ef2e6, css: hexCss(0x9ef2e6) }, // brighter rim while a tooth is focused / isolated
  hover: { hex: 0xffffff, css: "#ffffff" }, // faint white lift
  multi: { hex: 0x4fc3b8, css: hexCss(0x4fc3b8) }, // serial-teeth selection: same teal, numbered + check (never colour alone)
} as const;

/** Enamel / outline constants shared by 2D and 3D. */
export const ENAMEL_HEX = 0xeadfc8;
export const ENAMEL_CSS = hexCss(ENAMEL_HEX);

/** Backwards-compatible aliases (Phase 3/4 imported these names from visualTokens.ts). */
export const CROWN_HEX = TYPE_TOKENS.crown.hex;
export const FILLING_HEX = TYPE_TOKENS.filling.hex;
export const CROWN_CSS = TYPE_TOKENS.crown.css;
export const FILLING_CSS = TYPE_TOKENS.filling.css;

// ---------------------------------------------------------------- semantic resolution (the SAME function feeds 2D, 3D and the Plan)
export type PlanStatusLike = "planned" | "in_progress" | "completed" | "cancelled";

/** Treatment status (Treatment Plan vocabulary) -> semantic state. The ONE mapping every renderer uses. */
export function semanticOfStatus(status: PlanStatusLike): SemanticState {
  switch (status) {
    case "planned": return "planned";
    case "in_progress": return "inProgress";
    case "completed": return "completed";
    default: return "cancelled";
  }
}
export const tokenOfStatus = (status: PlanStatusLike): StateToken => STATE_TOKENS[semanticOfStatus(status)];

/**
 * Deterministic visual PRIORITY when one tooth carries several things (highest first). A tooth always shows its strongest
 * open work in the badge; selection / focus / hover never appear here because they are drawn ABOVE the clinical layers.
 *   inProgress > planned > condition > completed > existing
 */
export const STATE_PRIORITY: readonly SemanticState[] = ["inProgress", "planned", "condition", "completed", "existing"];
export function strongestState(states: readonly SemanticState[]): SemanticState | null {
  for (const s of STATE_PRIORITY) if (states.includes(s)) return s;
  return null;
}

/** Inline style for a status chip: identical colours in the Treatment Plan, tooth panel, hover card and the chart badge. */
export function stateChipStyle(s: SemanticState): { color: string; borderColor: string; background: string } {
  const c = STATE_TOKENS[s].css;
  return { color: c, borderColor: `${c}66`, background: `${c}1a` };
}

// ---------------------------------------------------------------- colour maths (used by the unit test and by the contrast guard)
const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
export function hexToLab(hex: number): [number, number, number] {
  const r = lin((hex >> 16) & 255), g = lin((hex >> 8) & 255), b = lin(hex & 255);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
/** CIE76 colour difference — below ~20 two colours are hard to tell apart at a glance. */
export function deltaE(a: number, b: number): number {
  const A = hexToLab(a), B = hexToLab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}
