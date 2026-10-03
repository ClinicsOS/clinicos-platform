"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconCube, IconEraser, IconLayoutGrid } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { getToothMeta, isValidFdiFor, resolveCurrentTeeth, toothName, type DentitionType } from "@/lib/dental/fdi";
import { presetAvailable, presetTeeth, sortByChart, teethSummary, togglePreset, type PickPreset } from "@/lib/dental/teethFormat";
import { detectWebGL } from "../engine/webgl";
import ToothPicker3D from "./ToothPicker3D";
import ToothPickerChips from "./ToothPickerChips";

/**
 * The tooth picker used by the treatment editor: a small 3D chart (two straight rows, the doctor's layout) with quick
 * selections, a 2D twin for keyboard / screen readers / no-WebGL devices, and a type-a-number box.
 * It only EDITS a list of FDI codes — validation stays in the editor and on the server.
 */
const STUDIO_BG = "radial-gradient(ellipse at 50% 38%, #14324d 0%, #0b1e31 55%, #071522 100%)";

const chip = (on: boolean, disabled = false) =>
  `rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${on ? "border-teal bg-teal/15 text-teal" : "border-edge bg-card2 text-ink hover:border-sky"} ${disabled ? "pointer-events-none opacity-50" : ""}`;

const PRESETS: Array<{ id: PickPreset; key: string; range?: string }> = [
  { id: "upperArch", key: "dn.pick.upperArch" },
  { id: "lowerArch", key: "dn.pick.lowerArch" },
  { id: "all", key: "dn.pick.all" },
  { id: "smileUpper", key: "dn.pick.smileUpper", range: "14–24" },
  { id: "smileLower", key: "dn.pick.smileLower", range: "34–44" },
];

function useReducedMotion() {
  const [m, setM] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return m;
}

export default function ToothPicker(p: {
  value: string[];
  onChange: (next: string[]) => void;
  dentition: DentitionType;
  current?: string[] | null;
  mode: "multi" | "single";
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [gl, setGl] = useState<"checking" | "ok" | "failed">("checking");
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [ready, setReady] = useState(false);
  const [hover, setHover] = useState<{ fdi: string; x: number; y: number } | null>(null);
  const [manual, setManual] = useState("");
  const [manualErr, setManualErr] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const current = p.current ?? null;
  const multi = p.mode === "multi";

  useEffect(() => { setGl(detectWebGL().ok ? "ok" : "failed"); }, []);
  const use3d = gl === "ok" && view === "3d";

  const available = useMemo(() => resolveCurrentTeeth(p.dentition, current).map((m) => m.fdi), [p.dentition, current]);
  const value = useMemo(() => sortByChart(p.value), [p.value]);
  const summary = teethSummary(value, t);

  const toggle = (fdi: string) => {
    if (p.disabled) return;
    const has = value.includes(fdi);
    if (!multi) { p.onChange(has ? [] : [fdi]); return; }
    p.onChange(sortByChart(has ? value.filter((f) => f !== fdi) : [...value, fdi]));
  };

  const addManual = () => {
    const v = manual.trim();
    if (v.length !== 2 || !isValidFdiFor(v, p.dentition)) { setManualErr(true); return; }
    setManualErr(false); setManual("");
    if (!multi) p.onChange([v]); else if (!value.includes(v)) p.onChange(sortByChart([...value, v]));
  };

  const hoverMeta = hover ? getToothMeta(hover.fdi) : undefined;
  const tipPos = (() => {
    if (!hover || !stage.current) return null;
    const r = stage.current.getBoundingClientRect();
    return { left: Math.min(Math.max(hover.x - r.left + 12, 4), Math.max(r.width - 150, 4)), top: Math.max(hover.y - r.top - 38, 4) };
  })();

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-mute">{t("dn.pick.title")}</span>
          <span key={value.length} className="dn-fade-in rounded-full border border-teal/40 bg-teal/10 px-2 py-0.5 text-[10px] font-medium text-teal" aria-live="polite">
            {value.length ? `${value.length} ${t("dn.pick.selected")}` : t("dn.pick.none")}
          </span>
        </div>
        {gl === "ok" && (
          <div className="flex gap-1" role="group" aria-label={t("dn.pick.view")}>
            <button type="button" aria-pressed={view === "3d"} className={`${chip(view === "3d")} inline-flex items-center gap-1`} onClick={() => setView("3d")}><IconCube size={13} />3D</button>
            <button type="button" aria-pressed={view === "2d"} className={`${chip(view === "2d")} inline-flex items-center gap-1`} onClick={() => setView("2d")}><IconLayoutGrid size={13} />2D</button>
          </div>
        )}
      </div>

      {multi && (
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.filter((x) => presetAvailable(x.id, available)).map((x) => {
            const tgt = presetTeeth(x.id, available);
            const on = tgt.length > 0 && tgt.every((f) => value.includes(f)); // every tooth of the preset is already picked
            return (
              <button key={x.id} type="button" aria-pressed={on} disabled={p.disabled} className={chip(on, p.disabled)} onClick={() => p.onChange(togglePreset(value, x.id, available))}>
                {t(x.key)}{x.range && <> <bdi dir="ltr" className="font-mono">{x.range}</bdi></>}
              </button>
            );
          })}
          <button type="button" disabled={p.disabled || !value.length} className={`${chip(false, p.disabled || !value.length)} inline-flex items-center gap-1`} onClick={() => p.onChange([])}>
            <IconEraser size={13} />{t("dn.pick.clear")}
          </button>
        </div>
      )}

      {gl === "failed" && <p className="text-[10px] text-mute">{t("dn.pick.webgl")}</p>}

      {use3d ? (
        <div className="overflow-x-auto rounded-xl border border-edge">
          <div ref={stage} dir="ltr" className="relative min-w-[560px]" style={{ height: 196, background: STUDIO_BG }}>
            <ToothPicker3D
              selected={value} onChange={p.onChange} dentition={p.dentition} current={current} mode={p.mode} disabled={!!p.disabled} reducedMotion={reduced}
              onHover={(fdi, x, y) => setHover(fdi ? { fdi, x, y } : null)}
              onReady={() => setReady(true)}
              onFailure={() => setGl("failed")}
            />
            {!ready && <div className="absolute inset-0 flex items-center justify-center text-[11px] text-[#8FB3CC] animate-pulse">{t("dn.loading3d")}</div>}
            {hoverMeta && tipPos && (
              <div className="pointer-events-none absolute z-10 rounded-lg border border-white/10 bg-[#06263F]/90 px-2 py-1 text-[11px] text-[#E6F3FA] shadow-lg" style={{ left: tipPos.left, top: tipPos.top }}>
                <span className="font-mono text-teal">{hoverMeta.fdi}</span> · {toothName(hoverMeta, t)}
              </div>
            )}
          </div>
          {/* clinical orientation, outside the canvas so it can never sit on top of a tooth number */}
          <div dir="ltr" className="flex min-w-[560px] justify-between border-t border-edge bg-card2 px-3 py-1 text-[9px] text-mute">
            <span>← {t("dn.pick.right")}</span><span>{t("dn.pick.left")} →</span>
          </div>
        </div>
      ) : (
        <ToothPickerChips dentition={p.dentition} current={current} selected={value} onToggle={toggle} disabled={p.disabled} />
      )}

      <p className="text-[10px] text-mute">{use3d ? t("dn.pick.hint3d") : t("dn.pick.hint2d")}</p>

      {summary && <div className="rounded-lg border border-edge bg-card2 px-2.5 py-1.5 text-[11px] text-ink" dir="auto" aria-live="polite">{summary}</div>}

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          dir="ltr" inputMode="numeric" maxLength={2} aria-label={t("dn.pick.manual")} placeholder={t("dn.teethPlaceholder")} disabled={p.disabled}
          className={`inp w-24 text-center font-mono ${manualErr ? "!border-red-400" : ""}`} value={manual}
          onChange={(e) => { setManual(e.target.value.replace(/\D/g, "").slice(0, 2)); setManualErr(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
        />
        <button type="button" className="btn-ghost !px-2.5 !py-1 text-[11px]" disabled={p.disabled} onClick={addManual}>{t("dn.addTooth")}</button>
        {manualErr && <span className="text-[10px] text-red-400">{t("dn.invalidFdi")}</span>}
      </div>
    </div>
  );
}
