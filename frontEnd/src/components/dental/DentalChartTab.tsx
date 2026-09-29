"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { errMsg } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";
import { getToothMeta, isValidFdiFor, resolveCurrentTeeth, slotVariants, toothName, type DentitionType } from "@/lib/dental/fdi";
import { deriveToothStates, emptyVisualState, toVisualState } from "@/lib/dental/toothStates";
import type { ToothVisualState } from "@/lib/dental/types";
import { useDentalRecord, useSetCurrentTeeth, useSetDentition, useTreatmentPlan } from "@/lib/dental/hooks";
import { detectWebGL } from "./engine/webgl";
import type { DentalEngine } from "./engine/DentalEngine";
import type { Mode, PresetName } from "./engine/interactionMachine";
import DentalScene3D from "./DentalScene3D";
import ToothPanel from "./ToothPanel";
import ToothGrid2D from "./ToothGrid2D";
import TreatmentEditor, { type EditorPrefill } from "./treatment/TreatmentEditor";
import AddToInvoiceModal from "./treatment/AddToInvoiceModal";
import type { TreatmentItem } from "@/lib/dental/types";

const PANEL_W = 300;
const PRESETS: PresetName[] = ["front", "upper", "lower", "left", "right"];
const DENTITIONS: DentitionType[] = ["primary", "mixed", "permanent"];

function useMedia(query: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return m;
}

const barBtn = (on = false) =>
  `rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${on ? "border-teal bg-teal/20 text-teal" : "border-white/10 bg-white/5 text-[#CFE9F2] hover:border-sky/60"}`;

export default function DentalChartTab({ patientId, onOpenPlan }: { patientId: string; patientName?: string; onOpenPlan?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const role = useAuth((s) => s.user?.role);
  const canWrite = role === "owner" || role === "doctor";
  const desktop = useMedia("(min-width: 1024px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");

  const q = useDentalRecord(patientId);
  const setDent = useSetDentition(patientId);
  const setCurrent = useSetCurrentTeeth(patientId);
  const planQ = useTreatmentPlan(patientId); // treatment plan: drives the small plan indicators + the panel's plan section
  const planItems = planQ.data?.items;
  const events = q.data?.events;
  const dentition: DentitionType = q.data?.record.dentitionType ?? "permanent";
  const current = q.data?.record.currentTeeth ?? null;

  const states = useMemo(() => deriveToothStates(events ?? []), [events]);
  const visual = useMemo(() => {
    const out: Record<string, ToothVisualState> = {};
    Object.keys(states).forEach((k) => (out[k] = toVisualState(states[k])));
    // Treatment-plan indicators: in progress > planned (small shape). "treated" = has completed treatment (history).
    // Plan items never change the clinical state (existing conditions / diagnoses stay exactly as recorded).
    for (const it of planItems ?? []) {
      if (it.status === "cancelled") continue;
      for (const fdi of it.toothNumbers) {
        const cur = out[fdi] ?? emptyVisualState();
        if (it.status === "completed") cur.treated = true;
        else if (it.status === "in_progress") cur.plan = "in_progress";
        else if (cur.plan !== "in_progress") cur.plan = "planned";
        out[fdi] = cur;
      }
    }
    return out;
  }, [states, planItems]);

  // Teeth the chart shows NOW (dentition + the doctor's mixed choice). History exists per FDI regardless of this.
  const chartTeeth = useMemo(() => resolveCurrentTeeth(dentition, current).map((m) => m.fdi), [dentition, current]);
  const hiddenHistory = useMemo(() => {
    const shown = new Set(chartTeeth);
    const all = Array.from(new Set((events ?? []).map((e) => e.fdi)));
    return all.filter((f) => !shown.has(f)).sort();
  }, [events, chartTeeth]);

  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("FULL_JAW");
  const [jawOpen, setJawOpen] = useState(false);
  const [labelsOn, setLabelsOn] = useState(false);
  const [gl, setGl] = useState<"checking" | "ok" | "failed">("checking");
  const [glReason, setGlReason] = useState("");
  const [sceneReady, setSceneReady] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [finder, setFinder] = useState("");
  const [finderErr, setFinderErr] = useState<null | "invalid" | "hidden">(null);
  const engineRef = useRef<DentalEngine | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const c = detectWebGL(); setGl(c.ok ? "ok" : "failed"); if (!c.ok) setGlReason(c.reason); }, []);

  // 3D is the NORMAL experience for Permanent, Primary AND Mixed. The number grid is only a genuine WebGL fallback.
  const use3D = gl === "ok";

  // ONE selection pipeline: with the 3D engine every path goes through engine.selectTooth();
  // the 2D fallback has no camera, so it sets state directly. Both feed the same panel + API.
  const selectFdi = useCallback((fdi: string) => {
    if (engineRef.current) engineRef.current.selectTooth(fdi);
    else setSelected(fdi);
  }, []);
  const clearSelection = useCallback(() => {
    if (engineRef.current) engineRef.current.backToJaw();
    else setSelected(null);
  }, []);

  const onDentition = async (d: DentitionType) => {
    if (d === dentition || !canWrite) return;
    try {
      await setDent.mutateAsync(d); // the 3D scene reconfigures when the saved dentition arrives (no optimistic switch)
      if (!engineRef.current) setSelected(null);
      toast.success(t("dn.dentSaved"), t(`dn.dent.${d}`));
    } catch (e) { toast.error(t("dn.err.dentition"), errMsg(e, "")); }
  };

  const chooseTooth = async (fdi: string) => {
    const meta = getToothMeta(fdi);
    if (!meta) return;
    const same = slotVariants(meta).map((m) => m.fdi);
    try {
      await setCurrent.mutateAsync(chartTeeth.filter((f) => !same.includes(f)).concat(fdi));
      toast.success(t("dn.chartUpdated"), fdi);
    } catch (e) { toast.error(t("dn.err.currentTeeth"), errMsg(e, "")); }
  };

  const runFinder = () => {
    const code = finder.trim();
    if (!isValidFdiFor(code, "mixed")) { setFinderErr("invalid"); return; } // not a real FDI code at all
    const shown = use3D ? !!engineRef.current?.hasTooth(code) : chartTeeth.includes(code);
    if (!shown) { setFinderErr("hidden"); return; } // real code, but not part of the current dentition
    setFinderErr(null);
    selectFdi(code); // same authoritative pipeline as a mouse click
    setFinder("");
  };

  const toothEvents = useMemo(() => (selected ? (events ?? []).filter((e) => e.fdi === selected) : []), [events, selected]);
  const focusing = mode === "ENTERING_FOCUS" || mode === "FOCUS";
  const toothPlan = useMemo(() => (selected ? (planItems ?? []).filter((i) => i.toothNumbers.includes(selected)) : []), [planItems, selected]);
  const toothTimeline = useMemo(() => (selected ? (planQ.data?.timeline ?? []).filter((e) => e.toothNumbers.includes(selected)) : []), [planQ.data, selected]);
  const [editor, setEditor] = useState<EditorPrefill | null>(null);
  const [billingItem, setBillingItem] = useState<TreatmentItem | null>(null);

  // composition offset: keeps the subject left of the side panel (desktop only)
  const viewShift = use3D && desktop && selected ? (PANEL_W + 12) / 2 : 0;

  const handlers = useMemo(() => ({
    onSelect: (f: string | null) => setSelected(f),
    onHover: (f: string | null, x: number, y: number) => {
      setHover((p) => (p === f ? p : f));
      if (tipRef.current && stageRef.current && f) {
        const r = stageRef.current.getBoundingClientRect();
        tipRef.current.style.transform = `translate(${x - r.left + 14}px, ${y - r.top + 16}px)`;
      }
    },
    onMode: (m: Mode) => setMode(m),
    onJaw: (a: number) => setJawOpen(a > 0.2),
    onReady: () => setSceneReady(true),
    onFailure: (msg: string) => { setGl("failed"); setGlReason(msg); setSceneReady(false); },
  }), []);

  // ---------------- states: forbidden / loading / error ----------------
  if (q.isError) {
    const forbidden = axios.isAxiosError(q.error) && q.error.response?.status === 403;
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center" role="alert">
        <IconAlertTriangle size={22} className="text-amber-400" />
        <div className="text-sm text-ink">{forbidden ? t("dn.err.forbidden") : errMsg(q.error, t("dn.err.load"))}</div>
        {!forbidden && <button type="button" className="btn-ghost text-xs" onClick={() => q.refetch()}><IconRefresh size={13} /> {t("dn.retry")}</button>}
      </div>
    );
  }
  if (q.isLoading || gl === "checking") {
    return <div className="card flex h-[420px] items-center justify-center text-sm text-mute animate-pulse">{t("dn.loading")}</div>;
  }

  const panel = selected ? (
    <ToothPanel
      key="panel"
      fdi={selected}
      dentition={dentition}
      events={toothEvents}
      patientId={patientId}
      canWrite={canWrite}
      can3D={use3D && sceneReady}
      focusing={focusing}
      variant={use3D ? (desktop ? "side" : "sheet") : "inline"}
      onClose={clearSelection}
      onFocus={() => engineRef.current?.focusSelected()}
      onBack={() => engineRef.current?.backToJaw()}
      mixed={dentition === "mixed"}
      shownTeeth={chartTeeth}
      onChooseTooth={chooseTooth}
      choosing={setCurrent.isPending}
      plan={toothPlan}
      treatmentEntries={toothTimeline}
      visits={planQ.data?.visits}
      onAddTreatment={canWrite ? setEditor : undefined}
      onOpenPlan={onOpenPlan}
      onBill={setBillingItem}
    />
  ) : null;

  const header = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-medium text-ink">{t("dn.title")}</h2>
          <div className="flex overflow-hidden rounded-lg border border-edge bg-card text-[10px]" title={t("dn.dentHint")}>
            {DENTITIONS.map((d) => (
              <button key={d} type="button" disabled={!canWrite || setDent.isPending} onClick={() => onDentition(d)} aria-pressed={dentition === d}
                className={`px-2.5 py-1 ${dentition === d ? "bg-teal text-navy font-medium" : "text-mute hover:text-ink"} disabled:cursor-default`}>
                {t(`dn.dent.${d}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="hidden text-[10px] text-mute md:block">{use3D ? t("dn.hint") : t("dn.selectTooth")}</div>
      </div>
      {dentition === "mixed" && <div className="text-[10px] text-mute">{t("dn.mixedNote")}</div>}
      {planQ.isError && <div role="status" className="text-[10px] text-amber-400">{t("dn.err.plan.load")}</div>}
      {hiddenHistory.length > 0 && (
        <div className="text-[10px] text-mute" dir="ltr">{t("dn.hiddenHistory")} <span className="font-mono text-sky">{hiddenHistory.join(", ")}</span></div>
      )}
    </div>
  );

  // ---------------- 2D chart: ONLY a genuine WebGL fallback ----------------
  if (!use3D) {
    return (
      <div className="space-y-3">
        {header}
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400" role="status">
          <IconAlertTriangle size={14} className="mt-px shrink-0" />
          <span>{t("dn.err.webgl")}. {t("dn.err.webglHint")}{glReason ? <span className="ms-1 opacity-70" dir="ltr">({glReason})</span> : null}</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
          <div className="card p-3"><ToothGrid2D dentition={dentition} states={states} plan={visual} selected={selected} onSelect={selectFdi} /></div>
          {panel}
        </div>
        {editor && <TreatmentEditor patientId={patientId} dentition={dentition} prefill={editor} phases={planQ.data?.plan.phases ?? [{ number: 1 }]} onClose={() => setEditor(null)} />}
        {billingItem && <AddToInvoiceModal patientId={patientId} item={billingItem} onClose={() => setBillingItem(null)} />}
      </div>
    );
  }

  // ---------------- 3D workspace (Permanent / Primary / Mixed) ----------------
  const hoverMeta = hover ? getToothMeta(hover) : undefined;
  return (
    <div className="space-y-3">
      {header}
      <div
        ref={stageRef}
        dir="ltr"
        className="dn-fade-in relative overflow-hidden rounded-xl border border-edge"
        style={{ height: "calc(100vh - 250px)", minHeight: 540, background: "radial-gradient(ellipse at 50% 38%, #14324d 0%, #0b1e31 55%, #071522 100%)" }}
      >
        <DentalScene3D engineRef={engineRef} handlers={handlers} visual={visual} dentition={dentition} current={current} labelsOn={labelsOn} viewShift={viewShift} reducedMotion={reduced} />

        {!sceneReady && <div className="absolute inset-0 flex items-center justify-center text-sm text-[#8FB3CC] animate-pulse">{t("dn.loading3d")}</div>}

        {hoverMeta && (
          <div ref={tipRef} className="pointer-events-none absolute left-0 top-0 z-10 rounded-lg border border-white/10 bg-[#06263F]/90 px-2.5 py-1.5 text-[11px] text-[#E6F3FA] shadow-lg">
            <div className="font-mono text-teal">{hoverMeta.fdi}</div>
            <div>{toothName(hoverMeta, t)}</div>
          </div>
        )}

        {sceneReady && (
          <div className="dn-ui-in pointer-events-none absolute left-3 top-3 hidden flex-col gap-1 rounded-lg border border-white/10 bg-[#06263F]/70 px-2.5 py-2 text-[10px] text-[#CFE9F2] md:flex">
            <span className="text-[9px] tracking-wider text-[#8FB3CC]">{t("dn.legend").toUpperCase()}</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full bg-[#E8A93C]" /> {t("dn.legend.diagnosis")}</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-sm bg-[#8E99A3]" /> {t("dn.legend.filling")}</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2.5 rounded-t-sm bg-[#D5DADD]" /> {t("dn.legend.crown")}</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-sm border border-dashed border-[#8FB3CC]" /> {t("dn.legend.missing")}</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rounded-full border border-[#6CB6E8]" /> {t("dn.legend.planned")}</span>
            <span className="flex items-center gap-1.5"><i className="inline-block h-2 w-2 rotate-45 bg-[#B49BFF]" /> {t("dn.legend.inprogress")}</span>
            <span className="flex items-center gap-1.5"><span className="text-[10px] leading-none text-[#62D39A]">✓</span> {t("dn.legend.done")}</span>
          </div>
        )}

        {sceneReady && (
          <div className={`dn-ui-in absolute bottom-3 left-3 z-10 flex justify-center ${selected && desktop ? "right-[324px]" : "right-3"}`}>
            <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-[#06263F]/80 px-2 py-1.5 backdrop-blur">
              <div className="flex gap-1" title={t("dn.view.hint")}>
                {PRESETS.map((p) => (
                  <button key={p} type="button" className={barBtn()} onClick={() => engineRef.current?.setPreset(p)}>{t(`dn.view.${p}`)}</button>
                ))}
              </div>
              <span className="mx-0.5 hidden h-4 w-px bg-white/10 sm:block" />
              <button type="button" className={barBtn()} onClick={() => engineRef.current?.setJawOpen(!jawOpen)}>{jawOpen ? t("dn.closeJaw") : t("dn.openJaw")}</button>
              <button type="button" className={barBtn(labelsOn)} aria-pressed={labelsOn} onClick={() => setLabelsOn((v) => !v)}>{t("dn.fdiNumbers")}</button>
              <span className="mx-0.5 hidden h-4 w-px bg-white/10 sm:block" />
              <div className="flex items-center gap-1">
                <input
                  value={finder}
                  onChange={(e) => { setFinder(e.target.value.replace(/\D/g, "").slice(0, 2)); setFinderErr(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") runFinder(); }}
                  placeholder={t("dn.findPlaceholder")}
                  aria-label={t("dn.findTooth")}
                  aria-invalid={!!finderErr}
                  title={finderErr === "invalid" ? t("dn.invalidFdi") : finderErr === "hidden" ? t("dn.finderNotShown") : t("dn.findTooth")}
                  inputMode="numeric"
                  dir="ltr"
                  className={`w-10 rounded-lg border bg-white/5 px-1.5 py-1 text-center font-mono text-[11px] text-[#E6F3FA] outline-none ${finderErr ? "border-red-400" : "border-white/10 focus:border-sky"}`}
                />
                <button type="button" className={barBtn()} onClick={runFinder}>{t("dn.findTooth")}</button>
              </div>
              <span className="mx-0.5 hidden h-4 w-px bg-white/10 sm:block" />
              <button type="button" className={barBtn()} onClick={() => engineRef.current?.resetView()}>{t("dn.resetView")}</button>
              {selected && <button type="button" className={barBtn()} onClick={() => engineRef.current?.backToJaw()}>{t("dn.back")}</button>}
            </div>
          </div>
        )}

        {desktop && panel}
      </div>
      {!desktop && panel}
      {finderErr && <div className="text-[11px] text-red-400" role="alert">{finderErr === "invalid" ? t("dn.invalidFdi") : t("dn.finderNotShown")}</div>}
      {editor && <TreatmentEditor patientId={patientId} dentition={dentition} prefill={editor} phases={planQ.data?.plan.phases ?? [{ number: 1 }]} onClose={() => setEditor(null)} />}
        {billingItem && <AddToInvoiceModal patientId={patientId} item={billingItem} onClose={() => setBillingItem(null)} />}
    </div>
  );
}
