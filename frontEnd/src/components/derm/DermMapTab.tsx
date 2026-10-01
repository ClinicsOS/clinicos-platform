"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle, IconChevronDown, IconChevronUp, IconMinus, IconPlus, IconRefresh, IconSearch, IconSelector, IconX,
} from "@tabler/icons-react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";
import type { Appointment } from "@/lib/types";
import { getRegion, MAX_REGIONS_PER_ASSESSMENT, regionLabel, type SurfaceId } from "@/lib/derm/regions";
import type { DermAssessment, DermMarker, DermRegionRef } from "@/lib/derm/types";
import { useDermBridge } from "@/store/dermBridge";
import { dermErrorCode, flattenAssessments, useDermAssessments, useDermMap } from "@/lib/derm/hooks";
import { detectQuality, detectWebGL } from "./engine/webgl";
import DermLoading from "./DermLoading";
import type { DermEngine, CameraSnapshot, HistoryCounts, StoredMarker } from "./engine/DermEngine";
import type { AssetStatus, Facing, ModelKey, ViewMode } from "./engine/types";
import type { DermSceneHandlers } from "./DermScene3D";
import AssessmentForm, { type VisitOption } from "./AssessmentForm";
import UnifiedTimeline from "./treatment/UnifiedTimeline";
import TreatmentForm, { type TreatmentPrefill } from "./treatment/TreatmentForm";
import RegionList from "./RegionList";
import { RegionChip, fmtDate, TypeGlyph } from "./dermUi";

// Three.js is loaded lazily and only when this tab is actually rendered (never for another specialty).
const DermScene3D = dynamic(() => import("./DermScene3D"), { ssr: false });

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

const seg = (on: boolean) =>
  `rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors ${on ? "border-teal bg-teal/20 text-teal" : "border-white/10 bg-white/5 text-[#CFE9F2] hover:border-sky/60"}`;
const iconBtn = "flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-[#CFE9F2] hover:border-sky/60 disabled:opacity-40";

const VIEWS: ViewMode[] = ["body", "face", "scalp"];
const FACINGS: Facing[] = ["front", "back", "left", "right"];
const SCALP_FACINGS: Facing[] = ["front", "back", "left", "right", "top"];
const MODELS: ModelKey[] = ["male", "female"];

interface Props {
  patientId: string;
  /** Patient's recorded gender — only chooses the DEFAULT figure; the switch is visual and never changes the record. */
  patientGender?: string | null;
  /** Pre-links a new assessment to this visit (optional). */
  defaultVisitId?: string | null;
  /** Phase 2: opens the Treatment Plan tab of the Patient Profile. */
  onOpenPlan?: () => void;
}

export default function DermMapTab({ patientId, patientGender, defaultVisitId, onOpenPlan }: Props) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const role = useAuth((s) => s.user?.role);
  const canWrite = role === "owner" || role === "doctor";
  const desktop = useMedia("(min-width: 1024px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");

  const engineRef = useRef<DermEngine | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // ---- 3D availability: WebGL probe BEFORE importing three.js; the accessible list is the full fallback.
  const [sceneKey, setSceneKey] = useState(0);
  const [scene, setScene] = useState<"probing" | "loading" | "ready" | "failed">("probing");
  const [quality] = useState(() => detectQuality());
  const [assetStatus, setAssetStatus] = useState<AssetStatus | null>(null);
  useEffect(() => {
    if (scene !== "probing") return;
    const gl = detectWebGL();
    if (gl.ok) setScene("loading");
    else { console.warn("[derm] 3D unavailable:", gl.reason); setScene("failed"); }
  }, [scene]);

  // ---- view state
  const [model, setModel] = useState<ModelKey>(patientGender === "female" ? "female" : "male");
  const [view, setView] = useState<ViewMode>("body");
  const [cam, setCam] = useState<CameraSnapshot | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  // ---- clinical selection (registry ids only; last = primary)
  const [selected, setSelected] = useState<string[]>([]);
  const [surfaces, setSurfaces] = useState<Record<string, SurfaceId | undefined>>({});
  const [multi, setMulti] = useState(false);
  const [historyRegion, setHistoryRegion] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  // Phase 2: the side panel composes either an assessment (Phase 1) or a treatment (regions carried over — never re-picked)
  const [composeKind, setComposeKind] = useState<"assessment" | "treatment">("assessment");
  const [treatmentPrefill, setTreatmentPrefill] = useState<TreatmentPrefill | null>(null);
  const [markers, setMarkers] = useState<DermMarker[]>([]);
  const [placing, setPlacing] = useState<string | null>(null);
  const [tab, setTab] = useState<"map" | "timeline">("map");
  const [sheet, setSheet] = useState<"collapsed" | "open">("collapsed");
  const [findOpen, setFindOpen] = useState(false);

  const mapQ = useDermMap(patientId);
  const activity = mapQ.data?.regions;
  const history = useMemo<Record<string, HistoryCounts>>(() => {
    const h: Record<string, HistoryCounts> = {};
    for (const [id, a] of Object.entries(activity ?? {})) h[id] = { dermatology: a.dermatology, aesthetic: a.aesthetic };
    return h;
  }, [activity]);

  const apptQ = useQuery({
    queryKey: ["patient-appointments", patientId],
    queryFn: async () => (await api.get<Appointment[]>(`/appointments?patientId=${patientId}`)).data,
    enabled: !!patientId,
  });
  const visits: VisitOption[] = useMemo(
    () => (apptQ.data ?? []).map((a) => ({ _id: a._id, startAt: a.startAt, status: a.status, type: a.type, visitType: a.visitType })),
    [apptQ.data]
  );

  // markers of the assessments currently shown in Area History are drawn on the model (shared cache with <AreaHistory>)
  const areaQ = useDermAssessments(patientId, { regionId: historyRegion ?? undefined }, !!historyRegion);
  const storedMarkers = useMemo<StoredMarker[]>(() => {
    if (!historyRegion) return [];
    return flattenAssessments(areaQ.data?.pages)
      .filter((a) => a.status === "active")
      .flatMap((a) => a.markers.filter((m) => m.regionId === historyRegion).map((m, i) => ({ ...m, id: `${a._id}-${i}` })));
  }, [areaQ.data, historyRegion]);
  const engineMarkers = useMemo<StoredMarker[]>(
    () => [...storedMarkers, ...markers.map((m) => ({ ...m, id: `pending-${m.regionId}` }))],
    [storedMarkers, markers]
  );

  // ---- selection logic (ONE place): click on the model, the list, a chip and the timeline all end up here
  const maxReached = selected.length >= MAX_REGIONS_PER_ASSESSMENT;
  const applySelection = useCallback((next: string[], focus?: { id: string; surface?: SurfaceId }) => {
    setSelected(next);
    setHistoryRegion((cur) => (cur && next.includes(cur) ? cur : next.length ? next[next.length - 1] : null));
    setSurfaces((s) => Object.fromEntries(Object.entries(s).filter(([k]) => next.includes(k))));
    setMarkers((m) => m.filter((x) => next.includes(x.regionId)));
    setPlacing((p) => (p && next.includes(p) ? p : null));
    if (next.length === 0) { setComposing(false); setSheet("collapsed"); }
    if (focus) engineRef.current?.focusRegion(focus.id, focus.surface);
  }, []);

  // The latest selection, readable from event handlers that must not be re-created on every change (3D callbacks).
  const selectedRef = useRef<string[]>([]);
  selectedRef.current = selected;
  const multiRef = useRef(false);
  multiRef.current = multi;

  const toggleRegion = useCallback((id: string, additive: boolean, viaList = false) => {
    if (!getRegion(id)) return;
    setTab("map");
    const cur = selectedRef.current;
    const has = cur.includes(id);
    const many = additive || multiRef.current || (viaList && cur.length > 1);
    let next: string[];
    if (has && many) next = cur.filter((x) => x !== id);
    else if (has) next = viaList ? cur.filter((x) => x !== id) : [id];
    else if (many) {
      if (cur.length >= MAX_REGIONS_PER_ASSESSMENT) { toast.warning(t("dm.max")); return; }
      next = [...cur, id];
    } else next = [id];
    // The camera follows a single selection only; while building a multi-selection the user's framing is left alone.
    applySelection(next, next.length === 1 && !has ? { id } : undefined);
  }, [applySelection, t, toast]);

  const clearSelection = useCallback(() => applySelection([]), [applySelection]);
  const openRegion = useCallback((id: string, surface?: SurfaceId) => {
    setTab("map");
    if (surface) setSurfaces((s) => ({ ...s, [id]: surface }));
    applySelection([id], { id, surface });
  }, [applySelection]);

  const setSurface = (id: string, s: SurfaceId | undefined) => {
    setSurfaces((cur) => ({ ...cur, [id]: s }));
    engineRef.current?.focusRegion(id, s);
  };

  // ---- Phase 2: 3D -> Add Treatment (the selected regions + surfaces carry over; nothing is re-picked)
  const startTreatment = (assessment?: DermAssessment | null) => {
    const regs: DermRegionRef[] = assessment ? assessment.regions.map((r) => (r.surface ? { id: r.id, surface: r.surface } : { id: r.id })) : regionsForForm;
    if (assessment) {
      setTab("map");
      applySelection(regs.map((r) => r.id));
      setSurfaces(Object.fromEntries(regs.filter((r) => r.surface).map((r) => [r.id, r.surface])));
    }
    setTreatmentPrefill({ regions: regs, assessment: assessment ?? null, recordType: assessment?.recordType });
    setComposeKind("treatment"); setComposing(true); setSheet("open");
  };

  // ---- Phase 2: treatment / follow-up -> "View on map": select + frame exactly those regions in THIS engine
  const focusReq = useDermBridge((s) => s.focus);
  const clearFocus = useDermBridge((s) => s.clearFocus);
  const lastFocus = useRef(0);
  const [pendingFrame, setPendingFrame] = useState<string[] | null>(null);
  const focusIds = useCallback((ids: string[]) => {
    const valid = ids.filter((id) => getRegion(id));
    if (!valid.length) return;
    setTab("map"); setComposing(false);
    applySelection(valid);
    const group = getRegion(valid[0])!.group;
    setView((cur) => (cur === group ? cur : group)); // Face / Scalp / Body follows the target; Male/Female is untouched
    setPendingFrame(valid);
  }, [applySelection]);
  useEffect(() => {
    if (!focusReq || focusReq.nonce === lastFocus.current || focusReq.patientId !== patientId) return;
    if (scene === "probing" || scene === "loading") return; // wait for the engine (or its fallback)
    lastFocus.current = focusReq.nonce;
    focusIds(focusReq.regionIds);
    clearFocus();
  }, [focusReq, scene, patientId, focusIds, clearFocus]);
  // Runs AFTER the scene has synced a view change (child effects run first), so the framing is not overridden by the view glide.
  useEffect(() => {
    if (!pendingFrame) return;
    engineRef.current?.focusRegions(pendingFrame);
    setPendingFrame(null);
  }, [pendingFrame, view]);

  // ---- 3D handlers (kept in a ref-friendly object: DermScene3D reads the latest through its own ref)
  const handlers: DermSceneHandlers = {
    onPick: (id, additive) => toggleRegion(id, additive),
    onPickNone: (additive) => { if (!additive && !multi && !placing) clearSelection(); },
    onHover: (id, x, y) => setHover(id ? { id, x, y } : null),
    onCameraState: setCam,
    onMarkerPlace: (m) => {
      setMarkers((cur) => [...cur.filter((x) => x.regionId !== m.regionId), m]);
      setPlacing(null);
      engineRef.current?.setPendingMarker(null);
    },
    onReady: (s) => { setAssetStatus(s); setScene("ready"); },
    onModelStatus: setAssetStatus,
    onFailure: (m) => { console.warn("[derm] 3D failed:", m); setScene("failed"); }, // technical detail goes to the console, never to the doctor
  };

  const regionsForForm: DermRegionRef[] = selected.map((id) => (surfaces[id] ? { id, surface: surfaces[id] } : { id }));

  // keyboard: Escape leaves marker placement, then clears the selection (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT")) return;
      if (!hostRef.current?.contains(el) && el !== document.body) return;
      if (placing) setPlacing(null);
      else if (!composing && selected.length) clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing, composing, selected.length, clearSelection]);

  const retry3D = () => { setAssetStatus(null); setScene("probing"); setSceneKey((k) => k + 1); };

  // ---- pieces
  const forbidden = mapQ.isError && dermErrorCode(mapQ.error) === "FORBIDDEN";
  const list3D = scene !== "failed";

  const panel = (
    <div className="space-y-3">
      <div className="flex gap-1.5" role="tablist" aria-label={t("dm.panel.tabs")}>
        {(["map", "timeline"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
            className={`rounded-lg border px-3 py-1 text-xs font-medium ${tab === k ? "border-teal bg-teal/15 text-teal" : "border-edge bg-soft text-mute hover:text-ink"}`}>
            {t(k === "map" ? "dm.tab.region" : "dm.tab.timeline")}
          </button>
        ))}
      </div>

      {tab === "timeline" ? (
        <UnifiedTimeline patientId={patientId} canWrite={canWrite} onSelectRegion={openRegion} onAddTreatment={startTreatment} onViewMap={focusIds} />
      ) : composing && composeKind === "treatment" && treatmentPrefill ? (
        <TreatmentForm
          patientId={patientId}
          mode="create"
          prefill={treatmentPrefill}
          onSaved={() => { setComposing(false); setTreatmentPrefill(null); }}
          onCancel={() => { setComposing(false); setTreatmentPrefill(null); }}
        />
      ) : composing && selected.length > 0 ? (
        <AssessmentForm
          patientId={patientId}
          regions={regionsForForm}
          visits={visits}
          defaultVisitId={defaultVisitId}
          markers={markers}
          placingRegion={placing}
          onPlaceMarker={(id) => { setPlacing(id); if (id) { engineRef.current?.focusRegion(id, surfaces[id]); if (!desktop) setSheet("collapsed"); } }}
          onRemoveMarker={(id) => setMarkers((m) => m.filter((x) => x.regionId !== id))}
          onSaved={() => { setComposing(false); setMarkers([]); setPlacing(null); setComposeKind("assessment"); }}
          onCancel={() => { setComposing(false); setPlacing(null); }}
        />
      ) : (
        <>
          {selected.length > 0 ? (
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="lbl !mb-0">{selected.length > 1 ? t("dm.selected.many").replace("{n}", String(selected.length)) : t("dm.selected.one")}</div>
                  <button type="button" onClick={clearSelection} className="text-[11px] text-mute hover:text-ink">{t("dm.clear")}</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selected.map((id) => (
                    <RegionChip key={id} id={id} surface={surfaces[id]} active={id === historyRegion} onClick={() => setHistoryRegion(id)} onRemove={() => applySelection(selected.filter((x) => x !== id))} />
                  ))}
                </div>
                {selected.length > 1 && <p className="mt-1 text-[11px] text-mute">{t("dm.history.pick")}</p>}
              </div>

              {selected.filter((id) => (getRegion(id)?.surfaces.length ?? 0) > 0).map((id) => (
                <div key={id}>
                  <div className="lbl">{t("dm.surface.label")} · {regionLabel(id, lang)}</div>
                  <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t("dm.surface.label")}>
                    {[undefined, ...getRegion(id)!.surfaces].map((s) => (
                      <button key={s ?? "any"} type="button" role="radio" aria-checked={surfaces[id] === s} onClick={() => setSurface(id, s)}
                        className={`rounded-lg border px-2 py-1 text-[11px] ${surfaces[id] === s ? "border-teal bg-teal/15 text-teal" : "border-edge bg-soft text-mute hover:text-ink"}`}>
                        {s ? t(`dm.surface.${s}`) : t("dm.surface.any")}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              {canWrite ? (
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className="btn-teal" onClick={() => { setComposeKind("assessment"); setComposing(true); }}>{t("dm.add")}</button>
                  <button type="button" className="btn-ghost !border-teal !text-teal" onClick={() => startTreatment(null)}>{t("dt.addTreatment")}</button>
                </div>
              ) : (
                <p className="rounded-lg bg-soft px-3 py-2 text-[11px] text-mute">{t("dm.viewOnly")}</p>
              )}

              {historyRegion && (
                <div>
                  <h4 className="mb-1.5 text-xs font-medium text-ink">{t("dm.area.title")} · {regionLabel(historyRegion, lang)}</h4>
                  <UnifiedTimeline key={historyRegion} patientId={patientId} regionId={historyRegion} canWrite={canWrite} onSelectRegion={openRegion} onAddTreatment={startTreatment} onViewMap={focusIds} />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-mute">{list3D ? t("dm.hint") : t("dm.hint.list")}</p>
              {mapQ.data && mapQ.data.total === 0 && <p className="rounded-xl border border-dashed border-edge p-3 text-center text-xs text-mute">{t("dm.empty")}</p>}
              <RegionList selected={selected} onToggle={(id) => toggleRegion(id, true, true)} activity={activity} />
            </div>
          )}
        </>
      )}
    </div>
  );

  const stat = mapQ.data;

  return (
    <div ref={hostRef} className={`space-y-3 ${!desktop && (selected.length > 0 || findOpen || composing) ? "pb-16" : ""}`}>
      {/* summary line */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-mute">
        {mapQ.isLoading ? <span>{t("common.loading")}</span> : stat ? (
          <>
            <span className="inline-flex items-center gap-1.5"><TypeGlyph type="dermatology" />{t("dm.type.dermatology")}: <b className="text-ink">{stat.byType.dermatology}</b></span>
            <span className="inline-flex items-center gap-1.5"><TypeGlyph type="aesthetic" />{t("dm.type.aesthetic")}: <b className="text-ink">{stat.byType.aesthetic}</b></span>
            {stat.lastAt && <span>{t("dm.lastRecord")}: <b className="text-ink">{fmtDate(stat.lastAt, lang)}</b></span>}
          </>
        ) : null}
        {mapQ.isError && !forbidden && (
          <span role="alert" className="inline-flex items-center gap-2 text-red-300"><IconAlertTriangle size={13} />{t("dm.err.load")}
            <button type="button" className="underline" onClick={() => void mapQ.refetch()}><IconRefresh size={12} className="inline" /> {t("dm.retry")}</button></span>
        )}
      </div>
      {forbidden && <div role="alert" className="card p-4 text-sm text-red-300">{t("dm.err.forbidden")}</div>}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_390px]">
        {/* ------------------------------------------------ the map (hero) */}
        <div className="min-w-0">
          {/* toolbar */}
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#06263F]/80 px-2 py-1.5">
            {list3D && (
              <>
                <div className="flex gap-1" role="group" aria-label={t("dm.view.label")}>
                  {VIEWS.map((v) => <button key={v} type="button" className={seg(view === v && cam?.state !== "REGION_FOCUS")} aria-pressed={view === v} onClick={() => { setView(v); engineRef.current?.setView(v); }}>{t(`dm.view.${v}`)}</button>)}
                </div>
                <div className="flex gap-1" role="group" aria-label={t("dm.facing.label")}>
                  {(view === "scalp" ? SCALP_FACINGS : FACINGS).map((f) => (
                    <button key={f} type="button" className={seg(cam?.facing === f && cam?.state !== "REGION_FOCUS")} aria-pressed={cam?.facing === f && cam?.state !== "REGION_FOCUS"}
                      title={f === "left" || f === "right" ? t(`dm.facing.${f}.tip`) : undefined} onClick={() => engineRef.current?.setFacing(f)}>
                      {t(`dm.facing.${f}`)}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  <button type="button" className={iconBtn} aria-label={t("dm.zoomIn")} onClick={() => engineRef.current?.zoomBy(0.75)}><IconPlus size={15} /></button>
                  <button type="button" className={iconBtn} aria-label={t("dm.zoomOut")} onClick={() => engineRef.current?.zoomBy(1.33)}><IconMinus size={15} /></button>
                  <button type="button" className={seg(false)} onClick={() => engineRef.current?.resetView()}>{t("dm.reset")}</button>
                </div>
              </>
            )}
            <button type="button" className={seg(multi)} aria-pressed={multi} onClick={() => setMulti((m) => !m)} title={t("dm.multi.tip")}>{t("dm.multi")}</button>
            <div className="ms-auto flex gap-1" role="group" aria-label={t("dm.model.label")} title={t("dm.model.tip")}>
              {MODELS.map((m) => <button key={m} type="button" className={seg(model === m)} aria-pressed={model === m} onClick={() => setModel(m)}>{t(`dm.model.${m}`)}</button>)}
            </div>
            {!desktop && (
              <button type="button" className={iconBtn} aria-label={t("dm.find")} onClick={() => { setFindOpen(true); setSheet("open"); }}><IconSearch size={15} /></button>
            )}
          </div>

          {list3D ? (
            <div
              ref={stageRef}
              className="relative overflow-hidden rounded-2xl border border-white/10"
              style={{ height: desktop ? "min(720px, calc(100vh - 260px))" : "58vh", minHeight: 400, background: "radial-gradient(ellipse at 50% 40%, #14324d 0%, #0b1e31 55%, #071522 100%)" }}
            >
              {scene !== "probing" && (
                <DermScene3D
                  key={sceneKey}
                  engineRef={engineRef}
                  handlers={handlers}
                  model={model}
                  view={view}
                  selection={selected}
                  history={history}
                  markers={engineMarkers}
                  placingRegion={placing}
                  reducedMotion={reduced}
                  quality={quality}
                  ariaLabel={t("dm.canvas.label")}
                />
              )}
              {(scene === "probing" || scene === "loading") && <DermLoading />}
              {hover && stageRef.current && (() => {
                const r = stageRef.current!.getBoundingClientRect();
                const left = Math.min(Math.max(6, hover.x - r.left + 12), Math.max(6, r.width - 150));
                const top = Math.max(6, hover.y - r.top + 12);
                return (
                  <div className="pointer-events-none absolute z-10 rounded-lg border border-white/10 bg-[#06263F]/90 px-2.5 py-1 text-[11px] text-[#E6F3FA] shadow-lg" style={{ left, top }}>
                    {regionLabel(hover.id, lang)}
                    {(activity?.[hover.id]?.total ?? 0) > 0 && <span className="text-[#9FBFD0]"> · {t("dm.hover.records").replace("{n}", String(activity![hover.id].total))}</span>}
                  </div>
                );
              })()}
              {placing && (
                <div className="absolute inset-x-3 top-3 z-10 flex items-center justify-between gap-2 rounded-lg border border-teal/40 bg-[#06263F]/90 px-3 py-1.5 text-[11px] text-[#E6F3FA]" role="status">
                  <span>{t("dm.form.markerHint")}</span>
                  <button type="button" className="text-teal underline" onClick={() => setPlacing(null)}>{t("dm.form.markerDone")}</button>
                </div>
              )}
              {assetStatus?.source === "procedural" && scene === "ready" && (
                <div className="pointer-events-none absolute bottom-2 start-3 z-10 max-w-[70%] rounded-md bg-[#06263F]/70 px-2 py-1 text-[10px] text-[#9FBFD0]" title={t("dm.asset.devTip")}>
                  {assetStatus.fallbackReason ? t("dm.asset.fallback") : t("dm.asset.dev")}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-edge bg-card2 p-4" role="alert">
              <div className="flex items-start gap-2 text-sm text-ink">
                <IconAlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
                <div>
                  <div className="font-medium">{t("dm.fallback.title")}</div>
                  <p className="mt-1 text-xs text-mute">{t("dm.fallback.body")}</p>
                  <button type="button" className="btn-ghost mt-2" onClick={retry3D}><IconRefresh size={13} className="me-1 inline" />{t("dm.retry3d")}</button>
                </div>
              </div>
            </div>
          )}
          {assetStatus?.unmappedRegions && assetStatus.unmappedRegions.length > 0 && (
            <p className="mt-1 text-[11px] text-mute">{t("dm.asset.unmapped").replace("{n}", String(assetStatus.unmappedRegions.length))}</p>
          )}
        </div>

        {/* ------------------------------------------------ desktop side panel */}
        {desktop && (
          <aside className="card min-w-0 self-start p-4 dn-fade-in" aria-label={t("dm.panel.title")}>
            {panel}
          </aside>
        )}
      </div>

      {/* ------------------------------------------------ mobile bottom sheet */}
      {!desktop && (selected.length > 0 || findOpen || tab === "timeline" || composing) && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex max-h-[78vh] flex-col rounded-t-2xl border border-edge bg-card shadow-2xl dn-sheet-in" role="dialog" aria-label={t("dm.panel.title")}>
          <div className="flex items-center gap-2 px-4 py-2">
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-start" onClick={() => setSheet((s) => (s === "open" ? "collapsed" : "open"))} aria-expanded={sheet === "open"}>
              {sheet === "open" ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
              <span className="truncate text-xs font-medium text-ink">
                {selected.length > 0 ? (selected.length === 1 ? regionLabel(selected[0], lang) : t("dm.selected.many").replace("{n}", String(selected.length))) : t("dm.panel.title")}
              </span>
            </button>
            {selected.length > 0 && !composing && canWrite && sheet === "collapsed" && (
              <button type="button" className="btn-teal !px-3 !py-1 text-xs" onClick={() => { setComposeKind("assessment"); setComposing(true); setSheet("open"); }}>{t("dm.add")}</button>
            )}
            {selected.length > 0 && !composing && canWrite && sheet === "collapsed" && (
              <button type="button" className="btn-ghost !border-teal !px-3 !py-1 text-xs !text-teal" onClick={() => startTreatment(null)}>{t("dt.addTreatment")}</button>
            )}
            <button type="button" className={iconBtn.replace("bg-white/5", "bg-soft").replace("text-[#CFE9F2]", "text-ink")} aria-label={t("dm.close")} onClick={() => { setFindOpen(false); setSheet("collapsed"); if (tab === "timeline") setTab("map"); if (!composing) clearSelection(); }}><IconX size={14} /></button>
          </div>
          {/* Always mounted (only hidden when collapsed): the assessment form keeps everything the clinician typed while the sheet is collapsed to place a marker on the model. */}
          <div className={sheet === "open" ? "min-h-0 flex-1 overflow-y-auto px-4 pb-6" : "hidden"}>
            {findOpen && selected.length === 0 ? <RegionList selected={selected} onToggle={(id) => toggleRegion(id, true, true)} activity={activity} /> : panel}
          </div>
        </div>
      )}
      {!desktop && selected.length === 0 && !findOpen && tab !== "timeline" && (
        <div className="flex gap-2">
          <button type="button" className="btn-ghost flex-1" onClick={() => { setTab("timeline"); setSheet("open"); }}>{t("dm.tab.timeline")}</button>
          <button type="button" className="btn-ghost flex-1" onClick={() => { setFindOpen(true); setSheet("open"); }}><IconSelector size={14} className="me-1 inline" />{t("dm.find")}</button>
        </div>
      )}
    </div>
  );
}
