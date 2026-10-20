"use client";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/lib/i18n";
import { getToothMeta, jawRowFdis, toothName, type DentitionType } from "@/lib/dental/fdi";
import type { SurfaceId } from "@/lib/dental/taxonomy";
import type { ToothVisualState } from "@/lib/dental/types";
import { deriveToothMarks, marksSignature, type ToothMarks } from "@/lib/dental/toothMarks";
import ToothCross from "./ToothCross";

/**
 * PHASE 5 — the 2D Dental Chart: a first-class VIEW of exactly the same data as the 3D chart (it reads the same `visual` map, so a
 * status change or an edited surface appears here and in 3D in the same render). Rows are in clinical view order (viewer-left ->
 * viewer-right): 18…11 | 21…28 and 48…41 | 31…38. Every tooth is a ToothCross with five real surface hit areas, M/D assigned by quadrant.
 *
 * Selection model (shared with 3D through DentalChartTab, ONE selectedTooth):
 *   single mode  : click a tooth -> select it; click a SURFACE -> select the tooth AND that surface; click again -> deselect the surface
 *   multi  mode  : click a tooth (or any of its surfaces) -> toggle it in the serial-teeth selection. No Ctrl/Cmd needed, touch works.
 * Keyboard: the tooth number is the tab stop; ← → move between teeth of the row, Enter/Space selects (surfaces: tooth panel buttons).
 */
export interface Grid2DProps {
  dentition: DentitionType;
  /** The chart's derived per-tooth state (clinical events + Treatment Plan). */
  visual: Record<string, ToothVisualState>;
  selected: string | null;
  selectedSurface?: SurfaceId | null;
  onSelect: (fdi: string, surface?: SurfaceId | null) => void;
  /** Serial-teeth mode. */
  multi?: { on: boolean; selected: ReadonlySet<string>; onToggle: (fdi: string) => void };
  /** Teeth highlighted by a deep link (multi-tooth treatment). */
  linked?: ReadonlySet<string>;
  /** Mixed dentition: the teeth currently charted (others are dimmed — their history still exists). Undefined = all shown. */
  shown?: ReadonlySet<string>;
  titleFor?: (fdi: string) => string;
  glow?: ReadonlySet<string>;
  /** Pixel size of one tooth drawing. */
  cell?: number;
}

interface CellProps {
  fdi: string;
  marks: ToothMarks;
  sig: string;
  /** Phase 4 contract (kept): "kind/status/surfaces" per plan treatment, joined by "+". */
  tx: string;
  plan: ToothVisualState["plan"] | null;
  upper: boolean;
  selected: boolean;
  surface: SurfaceId | null;
  multiOn: boolean;
  multiSel: boolean;
  linked: boolean;
  dim: boolean;
  glow: boolean;
  title: string;
  cell: number;
  onPick: (fdi: string, surface?: SurfaceId | null) => void;
}

const Cell = memo(function Cell({ fdi, marks, sig, tx, plan, upper, selected, surface, multiOn, multiSel, linked, dim, glow, title, cell, onPick }: CellProps) {
  const { t } = useI18n();
  const meta = getToothMeta(fdi)!;
  const num = (
    <button
      type="button" data-testid="tooth-2d" data-fdi={fdi} data-plan={plan ?? ""} data-tx={tx} data-marks={sig} data-selected={selected || multiSel ? "true" : "false"}
      aria-pressed={multiOn ? multiSel : selected}
      aria-label={`${t("dn.tooth")} ${fdi} — ${toothName(meta, t)}${multiSel ? ` — ${t("dn2.multi.picked")}` : ""}`}
      title={title}
      onKeyDown={(e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        const row = e.currentTarget.closest("[data-arch-row]");
        if (!row) return;
        const all = Array.from(row.querySelectorAll<HTMLButtonElement>("button[data-fdi]"));
        const i = all.indexOf(e.currentTarget);
        all[i + (e.key === "ArrowRight" ? 1 : -1)]?.focus();
        e.preventDefault();
      }}
      className={`${glow ? "dn-tooth-glow-flag " : ""}rounded-md px-1 font-mono text-[10px] leading-4 transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${
        selected || multiSel ? "bg-teal font-semibold text-navy" : "text-mute hover:text-ink"
      }`}
    >
      {fdi}
    </button>
  );
  return (
    <div
      role="group" aria-label={`${t("dn.tooth")} ${fdi}`}
      onClick={() => onPick(fdi)}
      className={`relative flex shrink-0 cursor-pointer flex-col items-center gap-0.5 rounded-lg px-px py-0.5 transition-opacity duration-200 ${glow ? "dn-tooth-glow" : ""} ${dim ? "opacity-40" : ""} ${marks.missing ? "dn-missing" : ""}`}
      style={{ width: cell + 6 }}
    >
      {upper && num}
      <ToothCross
        fdi={fdi} marks={marks} size={cell} selected={selected && !multiOn} multiSelected={multiOn && multiSel} linked={linked}
        selectedSurface={selected && !multiOn ? surface : null} title={title}
        onSurface={(s) => onPick(fdi, s)}
      />
      {!upper && num}
    </div>
  );
});

function ArchRow({ fdis, props, upper, cell }: { fdis: string[]; props: Grid2DProps; upper: boolean; cell: number }) {
  const { t } = useI18n();
  const half = fdis.length / 2;
  const multiOn = !!props.multi?.on;
  const onPick = (fdi: string, surface?: SurfaceId | null) => {
    if (multiOn) { props.multi!.onToggle(fdi); return; }
    // clicking the selected surface of the selected tooth again clears the surface (the tooth stays selected)
    if (surface && props.selected === fdi && props.selectedSurface === surface) { props.onSelect(fdi, null); return; }
    props.onSelect(fdi, surface ?? undefined);
  };
  return (
    <div className="flex items-start justify-center gap-0.5" dir="ltr" data-arch-row={upper ? "upper" : "lower"}>
      {fdis.map((f, i) => {
        const marks = deriveToothMarks(f, props.visual[f]);
        return (
          <span key={f} className={`flex ${i === half ? "ms-2 border-s border-edge ps-2" : ""}`}>
            <Cell
              fdi={f} marks={marks} sig={marksSignature(marks).join("+")} tx={(props.visual[f]?.treatments ?? []).map((x) => `${x.kind}/${x.status}/${(x.surfaces ?? []).join("")}`).join("+")} plan={props.visual[f]?.plan ?? null} upper={upper}
              selected={props.selected === f} surface={props.selected === f ? props.selectedSurface ?? null : null}
              multiOn={multiOn} multiSel={!!props.multi?.selected.has(f)} linked={!!props.linked?.has(f)}
              dim={!!props.shown && !props.shown.has(f)} glow={!!props.glow?.has(f)}
              title={props.titleFor ? props.titleFor(f) : `${f} — ${toothName(getToothMeta(f)!, t)}`} cell={cell} onPick={onPick}
            />
          </span>
        );
      })}
    </div>
  );
}

export default function ToothGrid2D(props: Grid2DProps) {
  const { t } = useI18n();
  // Fit the 16-tooth rows into the space the chart really has (the tooth panel takes a third of the width on desktop): all 32 teeth must be
  // visible without scrolling where that is possible. Never below the touch-friendly minimum; below that the rows scroll.
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const want = props.cell ?? 38;
  const perRow = props.dentition === "primary" ? 10 : 16;
  const cell = width > 0 ? Math.max(Math.min(want, 34), Math.min(want, Math.floor((width - 20) / perRow) - 8)) : want;
  const sets = useMemo(() => {
    const out: Array<{ key: "permanent" | "primary"; label: string }> = [];
    if (props.dentition !== "primary") out.push({ key: "permanent", label: t("dn.permanentTeeth") });
    if (props.dentition !== "permanent") out.push({ key: "primary", label: t("dn.primaryTeeth") });
    return out;
  }, [props.dentition, t]);
  return (
    <div ref={wrap} className="space-y-5 overflow-x-auto py-1" data-testid="chart-2d" data-multi={props.multi?.on ? "true" : "false"}>
      {sets.map((s) => (
        <div key={s.key} className="min-w-max space-y-2" data-dentition-set={s.key}>
          {sets.length > 1 && <div className="text-center text-[10px] font-medium tracking-wide text-mute">{s.label}</div>}
          <ArchRow fdis={jawRowFdis("upper", s.key)} props={props} upper cell={cell} />
          <div className="mx-auto h-px w-[96%] bg-gradient-to-r from-transparent via-edge to-transparent" aria-hidden />
          <ArchRow fdis={jawRowFdis("lower", s.key)} props={props} upper={false} cell={cell} />
        </div>
      ))}
    </div>
  );
}
