"use client";
import { useI18n } from "@/lib/i18n";
import { STATE_TOKENS, TYPE_TOKENS, UI_TOKENS, type ObjectKind, type SemanticState } from "@/lib/dental/visualTheme";

/**
 * PHASE 5 — the ONE legend. Built from the same tokens (visualTheme.ts) the 2D tooth, the 3D scene and the Treatment Plan chips use,
 * so it can never describe colours that are not drawn. Two groups, because the chart has two independent channels:
 *   STATE (what is going on)        glyph + colour:  ● condition  ○ planned  ◆ in progress  ✓ completed  ■ existing
 *   TYPE  (what kind of work)       shape + colour:  crown cap · filling dot · bridge · implant · root-canal dot · missing ghost
 * plus the interaction layer (selected / serial selection), which is only ever an outline above the picture.
 * Not colour alone: every state has its glyph, every type its own shape; the labels are text in the active language (AR/EN, RTL-safe).
 */
const STATES: SemanticState[] = ["condition", "planned", "inProgress", "completed", "existing"];
const TYPES: ObjectKind[] = ["crown", "filling", "bridge", "implant", "rootCanal", "missing"];

function TypeSwatch({ kind }: { kind: ObjectKind }) {
  const c = TYPE_TOKENS[kind].css;
  switch (kind) {
    case "crown": return <i aria-hidden className="inline-block h-2.5 w-3 rounded-t-md" style={{ background: c }} />;
    case "filling": return <i aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />;
    case "bridge": return <i aria-hidden className="inline-block h-2 w-3 rounded-sm" style={{ background: c }} />;
    case "implant": return <i aria-hidden className="inline-block h-3 w-1.5 rounded-b-full" style={{ background: c }} />;
    case "rootCanal": return <i aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c, boxShadow: "0 0 0 1px rgba(255,255,255,.35)" }} />;
    case "missing": return <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm border border-dashed" style={{ borderColor: c }} />;
  }
}

export default function ChartLegend({ variant, compact = false }: { variant: "overlay" | "card"; compact?: boolean }) {
  const { t } = useI18n();
  const wrap = variant === "overlay"
    ? "dn-ui-in pointer-events-none absolute left-3 top-3 hidden max-w-[220px] flex-col gap-1 rounded-lg border border-white/10 bg-[#06263F]/75 px-2.5 py-2 text-[10px] text-[#CFE9F2] md:flex"
    : "flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-edge pt-2.5 text-[10px] text-mute";
  const head = variant === "overlay" ? "text-[9px] tracking-wider text-[#8FB3CC]" : "text-[9px] tracking-wider";
  const sep = variant === "overlay" ? "mt-0.5 border-t border-white/10 pt-1" : "";
  return (
    <div data-testid={variant === "card" ? "chart-legend-2d" : "chart-legend"} data-legend={variant} role="group" aria-label={t("dn.legend")} className={wrap}>
      <span className={head}>{t("dn.legend").toUpperCase()}</span>
      {STATES.map((s) => (
        <span key={s} data-legend-item={s} className="flex items-center gap-1.5">
          <span aria-hidden className="w-2.5 text-center text-[11px] leading-none" style={{ color: STATE_TOKENS[s].css }}>{STATE_TOKENS[s].glyph}</span> {t(STATE_TOKENS[s].labelKey)}
        </span>
      ))}
      {!compact && TYPES.map((k, i) => (
        <span key={k} data-legend-item={k} className={`flex items-center gap-1.5 ${i === 0 ? sep : ""}`}>
          <TypeSwatch kind={k} /> {t(TYPE_TOKENS[k].labelKey)}
        </span>
      ))}
      {!compact && (
        <span data-legend-item="selected" className={`flex items-center gap-1.5 ${sep}`}>
          <i aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm border-2" style={{ borderColor: UI_TOKENS.selected.css }} /> {t("dn2.legend.selected")}
        </span>
      )}
      {!compact && (
        <span data-legend-item="ghost" className="flex items-center gap-1.5 opacity-90">
          <i aria-hidden className="inline-block h-2 w-2.5 rounded-t-md border border-dashed bg-transparent" style={{ borderColor: TYPE_TOKENS.crown.css }} />
          <i aria-hidden className="inline-block h-2 w-2 rounded-full border bg-transparent" style={{ borderColor: TYPE_TOKENS.filling.css }} />
          {t("dn.legend.ghost")}
        </span>
      )}
    </div>
  );
}
