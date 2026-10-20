"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { IconAlertTriangle, IconRefresh } from "@tabler/icons-react";
import type { SurfaceId } from "@/lib/dental/taxonomy";
import { useI18n } from "@/lib/i18n";
import { errMsg } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";
import { getToothMeta, isValidFdiFor, resolveCurrentTeeth, slotVariants, toothName, type DentitionType } from "@/lib/dental/fdi";
import { sortByChart } from "@/lib/dental/teethFormat";
import { deriveToothStates, emptyVisualState, toVisualState } from "@/lib/dental/toothStates";
import { applyPlanToVisual } from "@/lib/dental/planVisual";
import { buildToothSummary, indexTreatmentsByTooth, treatmentsOf } from "@/lib/dental/toothSummary";
import { procLabel } from "@/lib/dental/procedures";
import type { ToothVisualState } from "@/lib/dental/types";
import { useDentalRecord, useSetCurrentTeeth, useSetDentition, useTreatmentPlan } from "@/lib/dental/hooks";
import { detectWebGL } from "./engine/webgl";
import type { DentalEngine } from "./engine/DentalEngine";
import type { Mode, PresetName } from "./engine/interactionMachine";
import DentalScene3D from "./DentalScene3D";
import ToothPanel from "./ToothPanel";
import ToothHoverSummary from "./ToothHoverSummary";
import ToothGrid2D from "./ToothGrid2D";
import ChartLegend from "./ChartLegend";
import MultiSelectPanel from "./MultiSelectPanel";
import { useChangeFeedback } from "@/lib/dental/changeFeedback";
import TreatmentEditor, { type EditorPrefill } from "./treatment/TreatmentEditor";
import AddToInvoiceModal from "./treatment/AddToInvoiceModal";
import type { TreatmentItem } from "@/lib/dental/types";
import FocusMissing from "@/components/history/FocusMissing";
import { focusedSurface, type ProfileFocus } from "@/lib/history/deeplink";
import { resolveChartLink } from "@/lib/dental/focusLink";

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

export default function DentalChartTab({ patientId, onOpenPlan, focus, focusRun = "" }: { patientId: string; patientName?: string; onOpenPlan?: () => void; focus?: ProfileFocus; focusRun?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const role = useAuth((s) => s.user?.role);
  const canWrite = role === "owner" || role === "doctor";
  const desktop = useMedia("(min-width: 1024px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const feedback = useChangeFeedback(patientId); // PHASE 4 — teeth touched by the last server-confirmed treatment change (glow ~1.8 s)
  // Hover is an ENHANCEMENT for mouse-like pointers only. Touch / pen-less devices never get a fake hover: tapping a tooth opens the same
  // information in the tooth panel (the primary interaction on every device).
  const canHover = useMedia("(hover: hover) and (pointer: fine)");

  const q = useDentalRecord(patientId);
  const setDent = useSetDentition(patientId);
  const setCurrent = useSetCurrentTeeth(patientId);
  const planQ = useTreatmentPlan(patientId); // treatment plan: drives the small plan indicators + the panel's plan section
  const planItems = planQ.data?.items;
  const events = q.data?.events;
  const dentition: DentitionType = q.data?.record.dentitionType ?? "permanent";
  const current = q.data?.record.currentTeeth ?? null;

  const states = useMemo(() => deriveToothStates(events ?? []), [events]);
  // ONE in-memory index of the (already loaded) Treatment Plan by tooth: hover and the tooth panel both read it, no request per tooth / per hover.
  const byTooth = useMemo(() => indexTreatmentsByTooth(planItems), [planItems]);
  const visual = useMemo(() => {
    const out: Record<string, ToothVisualState> = {};
    Object.keys(states).forEach((k) => (out[k] = toVisualState(states[k])));
    // Treatment-plan pictures (status badge + Crown / Filling type) are DERIVED from the canonical treatment records, so this
    // chart can never disagree with the Treatment Plan. They never change the clinical state: existing conditions and
    // diagnoses stay exactly as recorded (a Caries diagnosis does NOT create a treatment, a treatment does not create a condition).
    return applyPlanToVisual(out, planItems ?? [], emptyVisualState);
  }, [states, planItems]);

  // Text twin of the Crown / Filling pictures (screen readers + "never colour alone"): exactly what the chart draws, one line per picture.
  const restorations = useMemo(() => {
    const rows: { fdi: string; kind: "crown" | "filling"; state: "existing" | "planned" | "in_progress" | "completed"; surfaces: string }[] = [];
    Object.keys(visual).sort().forEach((fdi) => {
      const v = visual[fdi];
      if (v.restoration === "crown") rows.push({ fdi, kind: "crown", state: "existing", surfaces: "" });
      if (v.hasFilling) rows.push({ fdi, kind: "filling", state: "existing", surfaces: v.fillings.join("") });
      v.treatments.forEach((x) => rows.push({ fdi, kind: x.kind, state: x.status, surfaces: x.surfaces.join("") }));
    });
    return rows;
  }, [visual]);

  // Teeth the chart shows NOW (dentition + the doctor's mixed choice). History exists per FDI regardless of this.
  const chartTeeth = useMemo(() => resolveCurrentTeeth(dentition, current).map((m) => m.fdi), [dentition, current]);
  const hiddenHistory = useMemo(() => {
    const shown = new Set(chartTeeth);
    const all = Array.from(new Set((events ?? []).map((e) => e.fdi)));
    return all.filter((f) => !shown.has(f)).sort();
  }, [events, chartTeeth]);

  // ONE canonical selection for BOTH views (2D grid and 3D scene): the tooth, its surface, isolation and the serial (multi) selection live here.
  const [selected, setSelected] = useState<string | null>(null);
  const [surface, setSurface] = useState<SurfaceId | null>(null);
  const [isolated, setIsolated] = useState(false);
  const [multiOn, setMultiOn] = useState(false);
  const [multiSel, setMultiSel] = useState<string[]>([]);
  const [linkedTeeth, setLinkedTeeth] = useState<string[]>([]); // teeth of a multi-tooth treatment a deep link points at
  const [view, setView] = useState<"3d" | "2d">("3d");
  const selRef = useRef<string | null>(null);
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
  // The doctor's last view (3D / 2D) is a per-browser convenience only (never needed for correctness).
  useEffect(() => { try { if (window.localStorage.getItem("clinicos.dental.view") === "2d") setView("2d"); } catch { /* storage unavailable */ } }, []);
  const changeView = (v: "3d" | "2d") => { setView(v); try { window.localStorage.setItem("clinicos.dental.view", v); } catch { /* ignore */ } };

  // 3D is the DEFAULT for Permanent, Primary AND Mixed; the doctor can switch to the 2D chart at any time (same data, same selection).
  // Without WebGL the 2D chart is shown automatically (genuine fallback + notice).
  const webglOk = gl === "ok";
  const use3D = webglOk && view === "3d";
  useEffect(() => { if (!use3D) setSceneReady(false); }, [use3D]);

  // ONE selection pipeline. Every path (3D click, 2D tooth or surface click, finder, deep link, panel) lands in selectFdi(); the 3D engine is
  // only a renderer of this state: it is told directly (so the camera reacts at once) and re-synced by the effect below after a view switch.
  const toggleMulti = useCallback((fdi: string) => {
    setMultiSel((cur) => (cur.includes(fdi) ? cur.filter((f) => f !== fdi) : sortByChart([...cur, fdi])));
  }, []);
  const selectFdi = useCallback((fdi: string, opts?: { surface?: SurfaceId | null; isolate?: boolean }) => {
    if (multiOn) { toggleMulti(fdi); return; }
    const changed = selRef.current !== fdi;
    selRef.current = fdi;
    setSelected(fdi);
    if (changed) { setSurface(opts?.surface ?? null); setIsolated(!!opts?.isolate); }
    else {
      if (opts && "surface" in opts) setSurface(opts.surface ?? null);
      if (opts?.isolate) setIsolated(true);
    }
    setLinkedTeeth((cur) => (cur.length && !cur.includes(fdi) ? [] : cur));
    // The 3D engine is NOT called from here: it follows this state in the effect below (one writer, no stale-closure race between the
    // two). Engine-originated changes (a click in the 3D scene) come back through handlers.onSelect.
  }, [multiOn, toggleMulti]);
  const clearSelection = useCallback(() => {
    selRef.current = null;
    setSelected(null); setSurface(null); setIsolated(false); // the 3D scene returns to the full jaw through the sync effect
  }, []);
  const pickSurface = useCallback((s: SurfaceId | null) => { setSurface(s); }, []);
  const setIsolation = useCallback((on: boolean) => { setIsolated(on); }, []);
  const enterMulti = () => {
    clearSelection(); setLinkedTeeth([]); setMultiSel([]); setMultiOn(true);
  };
  const exitMulti = () => { setMultiOn(false); setMultiSel([]); };

  const onDentition = async (d: DentitionType) => {
    if (d === dentition || !canWrite) return;
    try {
      await setDent.mutateAsync(d); // the 3D scene reconfigures when the saved dentition arrives (no optimistic switch)
      if (!engineRef.current) clearSelection();
      setMultiSel([]); setLinkedTeeth([]);
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
    const shown = use3D && engineRef.current ? engineRef.current.hasTooth(code) : chartTeeth.includes(code);
    if (!shown) { setFinderErr("hidden"); return; } // real code, but not part of the current dentition
    setFinderErr(null);
    selectFdi(code); // same authoritative pipeline as a mouse click
    setFinder("");
  };

  // PHASE 3 deep link: select the linked tooth ONCE per navigation, as soon as the data (and, in 3D, the scene) is ready — no timers.
  // The tooth comes from the link, or from the linked chart entry itself. A tooth that is not on today's chart (mixed dentition) still opens its history.
  // PHASE 5: a MULTI-TOOTH link (`teeth=` or `item=` of a multi-tooth treatment) additionally highlights EVERY tooth of the group; the first one is selected.
  // A link whose surface is Mesial / Distal opens with that tooth isolated, so the surface is actually visible in 3D.
  const link = useMemo(() => resolveChartLink(focus, { events, planItems }), [focus, events, planItems]);
  const groupTeeth = link.teeth;
  const focusFdi = link.tooth;
  const focusMissing = link.eventMissing || (link.itemMissing && planQ.isSuccess);
  const focusDone = useRef<string | null>(null);
  const dataReady = !q.isLoading && !!q.data && gl !== "checking" && (!use3D || sceneReady);
  useEffect(() => {
    if (!focusFdi || !dataReady || focusDone.current === focusRun || !getToothMeta(focusFdi)) return;
    if (focus?.item && !planQ.isSuccess && !planQ.isError) return; // wait for the plan so the group of a multi-tooth item is known
    focusDone.current = focusRun;
    if (groupTeeth.length > 1) setLinkedTeeth(groupTeeth);
    const onChart = use3D && engineRef.current ? engineRef.current.hasTooth(focusFdi) : chartTeeth.includes(focusFdi);
    if (onChart) selectFdi(focusFdi, { surface: link.surface, isolate: link.isolate });
    else { selRef.current = focusFdi; setSelected(focusFdi); }
  }, [focusFdi, dataReady, focusRun, use3D, chartTeeth, selectFdi, groupTeeth, link.surface, link.isolate, focus?.item, planQ.isSuccess, planQ.isError]);

  // 3D follows the canonical selection (this is what keeps the selection when the doctor switches 2D <-> 3D, and what applies a deep link)
  useEffect(() => {
    const e = engineRef.current;
    if (!use3D || !sceneReady || !e) return;
    e.setSelectionMode(multiOn ? "multi" : "single");
    e.setLinkedTeeth(linkedTeeth);
    if (multiOn) { e.setMultiSelection(multiSel); return; }
    if (!selected) { if (e.selectedFdi) e.backToJaw(); return; }
    if (!e.hasTooth(selected)) return;
    if (e.selectedFdi !== selected) { e.selectTooth(selected, { surface, isolate: isolated }); return; }
    if (e.selectedSurface !== surface) e.setSurfaceFocus(surface);
    if (e.isolation !== isolated) e.setIsolation(isolated);
  }, [use3D, sceneReady, multiOn, multiSel, linkedTeeth, selected, surface, isolated]);

  const toothEvents = useMemo(() => (selected ? (events ?? []).filter((e) => e.fdi === selected) : []), [events, selected]);
  const focusing = mode === "ENTERING_FOCUS" || mode === "FOCUS";
  const toothPlan = useMemo(() => (selected ? treatmentsOf(byTooth, selected) : []), [byTooth, selected]);
  const toothTimeline = useMemo(() => (selected ? (planQ.data?.timeline ?? []).filter((e) => e.toothNumbers.includes(selected)) : []), [planQ.data, selected]);
  const [editor, setEditor] = useState<EditorPrefill | null>(null);
  const [billingItem, setBillingItem] = useState<TreatmentItem | null>(null);

  // composition offset: keeps the subject left of the side panel (desktop only)
  const panelOpen = !!selected || multiOn;
  const viewShift = use3D && desktop && panelOpen ? (PANEL_W + 12) / 2 : 0;

  // Hover summary position. Imperative (no React render per pointer move): follow the cursor, keep the card inside the chart and out of the
  // side panel by flipping to the other side of the cursor when it would overflow. Re-run when the card's content (so its size) changes.
  const pointer = useRef({ x: 0, y: 0 });
  const panelBlock = useRef(0);
  panelBlock.current = (selected || multiOn) && desktop ? PANEL_W + 24 : 0;
  const placeTip = useCallback(() => {
    const tip = tipRef.current, stage = stageRef.current;
    if (!tip || !stage) return;
    const r = stage.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight, M = 8, GAP = 14;
    const px = pointer.current.x - r.left, py = pointer.current.y - r.top;
    const maxX = r.width - panelBlock.current - M;
    let x = px + GAP, y = py + GAP + 2;
    if (x + w > maxX) x = px - GAP - w; // flip to the left of the cursor
    if (y + h > r.height - M) y = py - GAP - h; // flip above the cursor
    x = Math.max(M, Math.min(x, maxX - w));
    y = Math.max(M, Math.min(y, r.height - h - M));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }, []);

  const handlers = useMemo(() => ({
    onSelect: (f: string | null) => {
      if (selRef.current !== f) { selRef.current = f; setSurface(null); setIsolated(false); } // another tooth (or none) -> the surface / isolation belong to the old one
      setSelected(f);
      if (f) setLinkedTeeth((cur) => (cur.length && !cur.includes(f) ? [] : cur));
    },
    onToggle: (f: string) => toggleMulti(f),
    onIsolation: (v: boolean) => setIsolated(v),
    onHover: (f: string | null, x: number, y: number) => {
      setHover((p) => (p === f ? p : f));
      if (f) { pointer.current = { x, y }; placeTip(); }
    },
    onMode: (m: Mode) => setMode(m),
    onJaw: (a: number) => setJawOpen(a > 0.2),
    onReady: () => setSceneReady(true),
    onFailure: (msg: string) => { setGl("failed"); setGlReason(msg); setSceneReady(false); },
  }), [placeTip, toggleMulti]);

  const hoverSummary = useMemo(() => (hover ? buildToothSummary(hover, states[hover]?.diagnoses, byTooth) : null), [hover, states, byTooth]);
  // the card is mounted AFTER the hover state changes: place it before the browser paints so it never flashes in the corner
  useLayoutEffect(() => { if (hoverSummary) placeTip(); }, [hoverSummary, placeTip, selected, desktop, planQ.isSuccess]);

  // 2D fallback (no WebGL): the same summary as plain text in the native tooltip
  const titleFor = useCallback((fdi: string) => {
    const meta = getToothMeta(fdi);
    const head = meta ? `${fdi} — ${toothName(meta, t)}` : fdi;
    if (!planQ.isSuccess) return head;
    const list = treatmentsOf(byTooth, fdi);
    if (!list.length) return `${head}\n${t("dn.tt.none")}`;
    return `${head}\n${list.slice(0, 4).map((x) => `• ${procLabel(t, x)} — ${t(`dn.ps.${x.status}`)}`).join("\n")}${list.length > 4 ? `\n${t("dn.tt.more").replace("{n}", String(list.length - 4))}` : ""}`;
  }, [byTooth, planQ.isSuccess, t]);

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

  // Panels: side overlay on desktop 3D, inline column on desktop 2D, bottom sheet on tablet / phone (touch-friendly, never covers the whole chart).
  const panelVariant: "side" | "sheet" | "inline" = !desktop ? "sheet" : use3D ? "side" : "inline";
  const arch = (jaw: "upper" | "lower") => setMultiSel(sortByChart(chartTeeth.filter((f) => getToothMeta(f)?.jaw === jaw)));
  const panel = multiOn ? (
    <MultiSelectPanel
      key="multi-panel"
      teeth={multiSel}
      dentition={dentition}
      byTooth={byTooth}
      canWrite={canWrite}
      variant={panelVariant}
      onRemove={(f) => setMultiSel((cur) => cur.filter((x) => x !== f))}
      onClear={() => setMultiSel([])}
      onArch={arch}
      onAddTreatment={() => setEditor({ teeth: multiSel })}
      onExit={exitMulti}
    />
  ) : selected ? (
    <ToothPanel
      key="panel"
      fdi={selected}
      focusEventId={focus?.event ?? undefined}
      focusSurface={focus ? focusedSurface(focus) ?? undefined : undefined}
      dentition={dentition}
      events={toothEvents}
      patientId={patientId}
      canWrite={canWrite}
      can3D={use3D && sceneReady}
      focusing={focusing}
      variant={panelVariant}
      onClose={clearSelection}
      onFocus={() => engineRef.current?.focusSelected()}
      onBack={() => clearSelection()}
      visual={visual[selected]}
      surface={surface}
      onSurface={pickSurface}
      isolated={isolated}
      onIsolate={setIsolation}
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
      {focusMissing && <FocusMissing run={focusRun} />}
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
        <div className="flex flex-wrap items-center gap-2">
          {webglOk && (
            <div role="group" aria-label={t("dn2.view.label")} data-testid="view-toggle" className="flex overflow-hidden rounded-lg border border-edge bg-card text-[10px]">
              {(["3d", "2d"] as const).map((v) => (
                <button key={v} type="button" data-testid={`view-${v}`} aria-pressed={view === v} onClick={() => changeView(v)}
                  className={`px-2.5 py-1 ${view === v ? "bg-teal font-medium text-navy" : "text-mute hover:text-ink"} ${!desktop ? "min-h-[36px] min-w-[44px]" : ""}`}>{v === "3d" ? "3D" : "2D"}</button>
              ))}
            </div>
          )}
          {canWrite && (
            <button type="button" data-testid="multi-toggle" aria-pressed={multiOn} onClick={() => (multiOn ? exitMulti() : enterMulti())} title={t("dn2.multi.hint")}
              className={`rounded-lg border px-2.5 py-1 text-[10px] transition-colors ${multiOn ? "border-teal bg-teal text-navy font-medium" : "border-edge bg-card text-mute hover:text-ink"} ${!desktop ? "min-h-[36px]" : ""}`}>
              {multiOn ? `${t("dn2.multi.mode")} · ${multiSel.length}` : t("dn2.multi.mode")}
            </button>
          )}
          <div className="hidden text-[10px] text-mute lg:block">{multiOn ? t("dn2.multi.hint") : use3D ? t("dn.hint") : t("dn2.hint2d")}</div>
        </div>
      </div>
      {linkedTeeth.length > 1 && (
        <div data-testid="linked-banner" data-count={linkedTeeth.length} className="flex flex-wrap items-center gap-2 rounded-lg border border-teal/40 bg-teal/10 px-2.5 py-1.5 text-[11px] text-ink">
          <span>{t("dn2.linked").replace("{n}", String(linkedTeeth.length))}</span>
          <span className="font-mono text-[10px] text-teal" dir="ltr">{linkedTeeth.join(", ")}</span>
          <button type="button" className="ms-auto text-[10px] text-sky hover:underline" onClick={() => setLinkedTeeth([])}>{t("dn2.linkedClear")}</button>
        </div>
      )}
      {dentition === "mixed" && <div className="text-[10px] text-mute">{t("dn.mixedNote")}</div>}
      {planQ.isError && <div role="status" className="text-[10px] text-amber-400">{t("dn.err.plan.load")}</div>}
      <ul className="sr-only" aria-label={t("dn.a11y.summary")} data-testid="chart-restorations">
        {restorations.map((r) => (
          <li key={`${r.fdi}|${r.kind}|${r.state}|${r.surfaces}`} data-fdi={r.fdi} data-kind={r.kind} data-state={r.state} data-surfaces={r.surfaces}>
            {t("dn.tooth")} {r.fdi}: {r.state === "existing" ? t(`dn.c.existing_${r.kind}`) : `${t(`dn.p.${r.kind}`)} — ${t(`dn.ps.${r.state}`)}`}{r.surfaces ? ` · ${r.surfaces}` : ""}
          </li>
        ))}
      </ul>
      {hiddenHistory.length > 0 && (
        <div className="text-[10px] text-mute" dir="ltr">{t("dn.hiddenHistory")} <span className="font-mono text-sky">{hiddenHistory.join(", ")}</span></div>
      )}
    </div>
  );

  // ---------------- 2D chart: a first-class view (and the genuine fallback without WebGL) ----------------
  if (!use3D) {
    return (
      <div className="space-y-3" data-testid="dental-stage" data-view="2d" data-selected={selected ?? ""} data-surface={surface ?? ""} data-multi={multiOn ? multiSel.join(",") : ""}>
        {header}
        {!webglOk && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-400" role="status">
            <IconAlertTriangle size={14} className="mt-px shrink-0" />
            <span>{t("dn.err.webgl")}. {t("dn.err.webglHint")}{glReason ? <span className="ms-1 opacity-70" dir="ltr">({glReason})</span> : null}</span>
          </div>
        )}
        <div className={`grid gap-3 ${desktop && panel ? "lg:grid-cols-[1fr_300px]" : ""}`}>
          <div className="card min-w-0 space-y-3 p-3">
            <ToothGrid2D
              dentition={dentition} visual={visual} selected={selected} selectedSurface={surface}
              onSelect={(f, s) => selectFdi(f, s === undefined ? undefined : { surface: s })}
              multi={{ on: multiOn, selected: new Set(multiSel), onToggle: toggleMulti }}
              linked={new Set(linkedTeeth)} shown={dentition === "mixed" ? new Set(chartTeeth) : undefined}
              titleFor={titleFor} glow={reduced ? undefined : feedback.teeth} cell={desktop ? 46 : 34}
            />
            <ChartLegend variant="card" />
          </div>
          {panel}
        </div>
        {editor && <TreatmentEditor patientId={patientId} dentition={dentition} prefill={editor} phases={planQ.data?.plan.phases ?? [{ number: 1 }]} onClose={() => setEditor(null)} />}
        {billingItem && <AddToInvoiceModal patientId={patientId} item={billingItem} onClose={() => setBillingItem(null)} />}
      </div>
    );
  }

  // ---------------- 3D workspace (Permanent / Primary / Mixed) ----------------
  return (
    <div className="space-y-3" data-testid="dental-stage" data-view="3d" data-selected={selected ?? ""} data-surface={surface ?? ""} data-isolated={isolated ? "true" : "false"} data-multi={multiOn ? multiSel.join(",") : ""}>
      {header}
      <div
        ref={stageRef}
        dir="ltr"
        className="dn-fade-in relative overflow-hidden rounded-xl border border-edge"
        style={{ height: "calc(100vh - 250px)", minHeight: 540, background: "radial-gradient(ellipse at 50% 38%, #14324d 0%, #0b1e31 55%, #071522 100%)" }}
      >
        <DentalScene3D key="scene" engineRef={engineRef} handlers={handlers} visual={visual} dentition={dentition} current={current} labelsOn={labelsOn} viewShift={viewShift} reducedMotion={reduced} glowTeeth={feedback.teeth} glowRun={feedback.at} />

        {!sceneReady && <div className="absolute inset-0 flex items-center justify-center text-sm text-[#8FB3CC] animate-pulse">{t("dn.loading3d")}</div>}

        {canHover && hoverSummary && <ToothHoverSummary ref={tipRef} summary={hoverSummary} planReady={planQ.isSuccess} />}

        {sceneReady && <ChartLegend variant="overlay" />}

        {sceneReady && (
          <div className={`dn-ui-in absolute bottom-3 left-3 z-10 flex justify-center ${panelOpen && desktop ? "right-[324px]" : "right-3"}`}>
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
              <button type="button" className={barBtn()} data-testid="reset-view" onClick={() => { clearSelection(); engineRef.current?.resetView(); }}>{t("dn.resetView")}</button>
              {selected && !isolated && <button type="button" className={barBtn()} onClick={() => clearSelection()}>{t("dn.back")}</button>}
              {selected && isolated && <button type="button" className={barBtn(true)} data-testid="exit-isolation-bar" onClick={() => setIsolation(false)}>{t("dn2.exitIsolation")}</button>}
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
