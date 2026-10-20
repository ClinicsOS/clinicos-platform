"use client";
import { useId, type KeyboardEvent, type MouseEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { getSurfaceOrientation } from "@/lib/dental/surfaces";
import type { SurfaceId } from "@/lib/dental/taxonomy";
import type { ToothMarks, SurfaceMark } from "@/lib/dental/toothMarks";
import { ABSCESS_CSS, STATE_TOKENS, TYPE_TOKENS, UI_TOKENS } from "@/lib/dental/visualTheme";

/**
 * PHASE 5 — the 2D tooth with REAL SURFACE GEOMETRY (crisp SVG, no raster).
 *
 *        ┌──────────────┐        top / bottom = facial vs lingual-palatal side (the outer side points away from the chart centre)
 *        │ ╲    top   ╱ │        left / right = MESIAL vs DISTAL — assigned by getSurfaceOrientation(), i.e. by QUADRANT,
 *        │  ┌────────┐  │        never by "left = M". Mesial always faces the midline.
 *        │L │ centre │ R│        centre = occlusal (posterior) / incisal (anterior) — stored as "O".
 *        │  └────────┘  │
 *        │ ╱  bottom  ╲ │        Each of the five regions is its own hit area (≥ 12 viewBox units wide, ≈ 13 px at 40 px).
 *        └──────────────┘
 *
 * Layers (bottom -> top): base · mark fills (what is on the surface) · separators · state strokes · crown outline · tooth-level glyphs ·
 * SELECTION / LINK ring · invisible hit areas. Selection, hover and focus are drawn ABOVE the marks and only as outlines, so they can
 * never hide the clinical picture. State is carried by colour AND pattern (solid = done, stripes = in progress, dashed tint = planned,
 * dots = condition) so the chart stays readable without colour vision.
 */
const REGION: Record<"top" | "bottom" | "left" | "right" | "centre", string> = {
  top: "M0,0H40L27,13H13Z",
  bottom: "M0,40H40L27,27H13Z",
  left: "M0,0L13,13V27L0,40Z",
  right: "M40,0L27,13V27L40,40Z",
  centre: "M13,13H27V27H13Z",
};
const LETTER_AT: Record<keyof typeof REGION, [number, number]> = { top: [20, 7.2], bottom: [20, 34.2], left: [6.2, 20.8], right: [33.8, 20.8], centre: [20, 21] };

export interface ToothCrossProps {
  fdi: string;
  marks: ToothMarks;
  /** CSS pixel size of the square drawing. */
  size?: number;
  selected?: boolean;
  /** Serial-teeth selection (drawn as ring + check, never colour alone). */
  multiSelected?: boolean;
  /** Highlight from a deep link / treatment (dashed ring). */
  linked?: boolean;
  selectedSurface?: SurfaceId | null;
  /** Show the surface letters inside the regions (tooth inspector). */
  letters?: boolean;
  interactive?: boolean;
  onSurface?: (s: SurfaceId, fdi: string) => void;
  /** Tooth-level hover/keyboard title (the surface regions append their own). */
  title?: string;
  className?: string;
}

const dash = (state: string | null): string | undefined => (state === "planned" ? "4 3.5" : state === "inProgress" ? "10 3" : undefined);

export default function ToothCross({ fdi, marks, size = 38, selected, multiSelected, linked, selectedSurface, letters, interactive = true, onSurface, title, className }: ToothCrossProps) {
  const { t } = useI18n();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const o = getSurfaceOrientation(fdi);
  if (!o) return null;
  const regionOf: Record<SurfaceId, keyof typeof REGION> = { O: "centre", B: "top", L: "bottom", M: "left", D: "right" };
  // cross.{top,bottom,left,right} hold the canonical surface at that side of THIS tooth
  const sideOf = (side: "top" | "bottom" | "left" | "right") => o.cross[side];
  (["top", "bottom", "left", "right"] as const).forEach((side) => { regionOf[sideOf(side)] = side; });

  const name = (s: SurfaceId) => `${t(o.nameKeys[s])} (${o.letters[s]})`;
  const conditionFill = (code?: string) => (code === "infection_abscess" ? ABSCESS_CSS : STATE_TOKENS.condition.css);
  const fillCss = TYPE_TOKENS.filling.css;
  const fade = marks.missing ? 0.42 : 1;

  const fillLayer: JSX.Element[] = [];
  const strokeLayer: JSX.Element[] = [];
  (Object.keys(regionOf) as SurfaceId[]).forEach((s) => {
    const d = REGION[regionOf[s]];
    marks.surfaces[s].forEach((mk: SurfaceMark, i) => {
      const key = `${s}${i}`;
      const attr = { "data-mark": `${mk.kind}:${mk.state}`, "data-surface": s };
      if (mk.kind === "condition") {
        fillLayer.push(<path key={`c${key}`} d={d} fill={`url(#${uid}d${mk.code === "infection_abscess" ? "a" : "c"})`} {...attr} />);
        strokeLayer.push(<path key={`cs${key}`} d={d} fill="none" stroke={conditionFill(mk.code)} strokeWidth={1.4} strokeOpacity={0.9} />);
        return;
      }
      // filling: the object colour is always the filling colour; the STATE decides solid / stripes / tint, plus its own outline
      if (mk.state === "existing" || mk.state === "completed") fillLayer.push(<path key={`f${key}`} d={d} fill={fillCss} {...attr} />);
      else if (mk.state === "inProgress") fillLayer.push(<path key={`f${key}`} d={d} fill={`url(#${uid}s)`} {...attr} />);
      else fillLayer.push(<path key={`f${key}`} d={d} fill={fillCss} fillOpacity={0.2} {...attr} />);
      if (mk.state !== "existing") {
        const tok = STATE_TOKENS[mk.state];
        strokeLayer.push(<path key={`fs${key}`} d={d} fill="none" stroke={tok.css} strokeWidth={mk.state === "completed" ? 1.6 : 1.8} strokeDasharray={mk.state === "planned" ? "3 2.5" : undefined} />);
      }
    });
  });

  const crownState = marks.crown;
  const badge = marks.badge;
  const ring = selected || multiSelected;

  const hit = (s: SurfaceId) => {
    const act = (e: MouseEvent | KeyboardEvent) => { e.stopPropagation(); onSurface?.(s, fdi); };
    return (
      <path
        key={`h${s}`} d={REGION[regionOf[s]]} className={interactive ? "dn-hit" : undefined} fill="transparent" data-testid="surface-2d" data-fdi={fdi} data-surface-hit={s}
        aria-label={`${t("dn.tooth")} ${fdi} — ${name(s)}`} role={interactive ? "button" : undefined} aria-pressed={interactive ? selectedSurface === s : undefined}
        onClick={interactive ? act : undefined}
      >
        <title>{`${t("dn.tooth")} ${fdi} · ${name(s)}`}</title>
      </path>
    );
  };

  return (
    <svg
      viewBox="-2 -2 44 44" width={size} height={size} className={className} role="img" aria-label={title ?? `${t("dn.tooth")} ${fdi}`}
      data-testid="tooth-cross" data-fdi={fdi} data-crown={crownState ?? ""} data-selected={selected ? "true" : undefined} data-multi={multiSelected ? "true" : undefined}
      style={{ overflow: "visible" }}
    >
      <defs>
        <clipPath id={`${uid}k`}><rect x="0" y="0" width="40" height="40" rx="8" /></clipPath>
        <pattern id={`${uid}s`} width="4.2" height="4.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4.2" height="4.2" fill={fillCss} fillOpacity="0.28" /><rect width="2.1" height="4.2" fill={fillCss} />
        </pattern>
        <pattern id={`${uid}dc`} width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill={STATE_TOKENS.condition.css} fillOpacity="0.28" /><circle cx="2.5" cy="2.5" r="1.45" fill={STATE_TOKENS.condition.css} />
        </pattern>
        <pattern id={`${uid}da`} width="5" height="5" patternUnits="userSpaceOnUse">
          <rect width="5" height="5" fill={ABSCESS_CSS} fillOpacity="0.3" /><circle cx="2.5" cy="2.5" r="1.45" fill={ABSCESS_CSS} />
        </pattern>
      </defs>
      <g opacity={fade} clipPath={`url(#${uid}k)`}>
        <rect width="40" height="40" fill="#16314a" />
        {(Object.keys(REGION) as (keyof typeof REGION)[]).map((r) => <path key={r} d={REGION[r]} fill="#F0E6D0" fillOpacity={r === "centre" ? 0.2 : 0.11} />)}
        {fillLayer}
        {marks.rootCanal && <circle cx="20" cy="20" r="3.4" fill={TYPE_TOKENS.rootCanal.css} stroke="#fff" strokeOpacity="0.75" strokeWidth="1" />}
        {(Object.keys(REGION) as (keyof typeof REGION)[]).map((r) => <path key={`sep${r}`} d={REGION[r]} fill="none" stroke="#9FB8CC" strokeOpacity="0.5" strokeWidth="0.9" />)}
        {strokeLayer}
        {selectedSurface && <path d={REGION[regionOf[selectedSurface]]} fill="none" stroke={UI_TOKENS.focused.css} strokeWidth="2.6" data-testid="surface-selected" data-surface-selected={selectedSurface} />}
      </g>

      {letters && (Object.keys(regionOf) as SurfaceId[]).map((s) => {
        const [x, y] = LETTER_AT[regionOf[s]];
        return <text key={`l${s}`} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="8.4" fontWeight="700" fontFamily="ui-monospace,monospace" fill="#EAF4FA" stroke="#06263F" strokeWidth="2.2" paintOrder="stroke" pointerEvents="none">{o.letters[s]}</text>;
      })}

      {crownState && (
        <rect x="1.6" y="1.6" width="36.8" height="36.8" rx="7.2" fill="none" stroke={TYPE_TOKENS.crown.css} strokeWidth="3" strokeDasharray={dash(crownState)} opacity={marks.missing ? 0.42 : 1} data-crown-state={crownState} />
      )}
      {marks.restoration === "bridge" && <rect x="12" y="35.6" width="16" height="3.6" rx="1.4" fill={TYPE_TOKENS.bridge.css} stroke="#fff" strokeOpacity="0.7" strokeWidth="0.7" data-restoration="bridge" />}
      {marks.restoration === "implant" && <polygon points="20,33.2 24.2,37.4 20,41.6 15.8,37.4" fill={TYPE_TOKENS.implant.css} stroke="#fff" strokeOpacity="0.8" strokeWidth="0.8" data-restoration="implant" />}
      {marks.looseConditions.length > 0 && <circle cx="6" cy="34.5" r="3.3" fill={marks.looseConditions.includes("infection_abscess") ? ABSCESS_CSS : STATE_TOKENS.condition.css} stroke="#fff" strokeOpacity="0.85" strokeWidth="0.9" data-loose="true" />}
      {marks.missing && <path d="M3,3L37,37M37,3L3,37" stroke={TYPE_TOKENS.missing.css} strokeWidth="1.8" strokeDasharray="3 3" opacity="0.9" pointerEvents="none" />}

      {(badge.plan || badge.treated) && (
        <g transform="translate(35,5)" pointerEvents="none" data-badge={`${badge.plan ?? ""}${badge.treated ? "+treated" : ""}`}>
          <circle r={badge.plan && badge.treated ? 6.6 : 5.4} cx={badge.plan && badge.treated ? -1 : 0} fill="#06263F" fillOpacity="0.92" />
          {badge.plan === "planned" && <circle cx={badge.treated ? -3.2 : 0} r="2.9" fill="none" stroke={STATE_TOKENS.planned.css} strokeWidth="1.5" />}
          {badge.plan === "inProgress" && <polygon points={badge.treated ? "-3.2,-3.4 -0.1,0 -3.2,3.4 -6.3,0" : "0,-3.6 3.3,0 0,3.6 -3.3,0"} fill={STATE_TOKENS.inProgress.css} />}
          {badge.treated && <path d={badge.plan ? "M0.6,0.2L2.3,2L5,-1.6" : "M-2.5,0.2L-0.7,2.1L2.7,-2.1"} fill="none" stroke={STATE_TOKENS.completed.css} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />}
        </g>
      )}

      {ring && <rect x="-0.4" y="-0.4" width="40.8" height="40.8" rx="8.6" fill="none" stroke={UI_TOKENS.selected.css} strokeWidth="2.6" data-testid="selection-ring" />}
      {multiSelected && (
        <g transform="translate(35,35)" pointerEvents="none" data-testid="multi-check">
          <circle r="5.6" fill={UI_TOKENS.multi.css} stroke="#06263F" strokeWidth="1" />
          <path d="M-2.6,0.2L-0.7,2.2L2.8,-1.9" fill="none" stroke="#06263F" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
      {linked && <rect x="-1.4" y="-1.4" width="42.8" height="42.8" rx="9.6" fill="none" stroke={UI_TOKENS.focused.css} strokeWidth="2" strokeDasharray="5 3" className="dn-linked" data-testid="linked-ring" />}

      {interactive && <g>{(Object.keys(regionOf) as SurfaceId[]).map(hit)}</g>}
    </svg>
  );
}
