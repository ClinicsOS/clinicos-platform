"use client";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { DentalEngine } from "./engine/DentalEngine"; // type-only: three.js is NOT in the main bundle
import type { Mode } from "./engine/interactionMachine";
import type { ToothVisualState } from "@/lib/dental/types";
import type { DentitionType } from "@/lib/dental/fdi";

export interface SceneHandlers {
  onSelect: (fdi: string | null) => void;
  onHover: (fdi: string | null, x: number, y: number) => void;
  onMode: (m: Mode) => void;
  onJaw: (angle: number) => void;
  /** PHASE 5 */
  onToggle?: (fdi: string) => void;
  onIsolation?: (isolated: boolean) => void;
  onReady: () => void;
  onFailure: (message: string) => void;
}

interface Props {
  engineRef: MutableRefObject<DentalEngine | null>;
  handlers: SceneHandlers;
  visual: Record<string, ToothVisualState>;
  dentition: DentitionType;
  current: string[] | null; // mixed: the doctor's charted teeth (null => default chart)
  labelsOn: boolean;
  viewShift: number;
  reducedMotion: boolean;
  /** PHASE 4 — teeth to glow once per `glowRun` (the timestamp of a server-confirmed treatment change; 0 = none). */
  glowTeeth?: ReadonlySet<string>;
  glowRun?: number;
}

/**
 * Mounts the imperative engine. The engine module (and therefore Three.js) is imported dynamically inside
 * the effect, so only a dentistry user who actually opens the Dental Chart downloads it. Any failure while
 * creating the WebGL context / scene is reported to the parent (which shows the 2D fallback) — it never throws
 * into React, so the rest of the Patient Profile keeps working.
 */
export default function DentalScene3D({ engineRef, handlers, visual, dentition, current, labelsOn, viewShift, reducedMotion, glowTeeth, glowRun = 0 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const hRef = useRef(handlers);
  hRef.current = handlers;
  const dRef = useRef({ dentition, current });
  dRef.current = { dentition, current };
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let engine: DentalEngine | null = null;
    (async () => {
      try {
        const { DentalEngine: Engine } = await import("./engine/DentalEngine");
        if (cancelled || !host.current) return;
        engine = new Engine(
          host.current,
          {
            onSelect: (f) => hRef.current.onSelect(f),
            onToggle: (f) => hRef.current.onToggle?.(f),
            onIsolationChange: (v) => hRef.current.onIsolation?.(v),
            onFocusChange: (sum) => { if (host.current) host.current.dataset.focus = sum; },
            onHover: (f, x, y) => hRef.current.onHover(f, x, y),
            onModeChange: (m) => hRef.current.onMode(m),
            onJawChange: (a) => hRef.current.onJaw(a),
          },
          { reducedMotion, dentition: { type: dRef.current.dentition, current: dRef.current.current } }
        );
        engineRef.current = engine;
        host.current.dataset.focus = engine.focusState();
        setReady(true);
        hRef.current.onReady();
      } catch (e) {
        if (!cancelled) hRef.current.onFailure(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      engine?.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // The engine is created once per mount; everything else is synced through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ONE engine for every dentition: switching reconfigures it (dim -> swap -> fade in + reframe) instead of remounting.
  const currentKey = (current ?? []).join(",");
  useEffect(() => { if (ready) engineRef.current?.setDentition(dentition, current); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dentition, currentKey, engineRef]);
  useEffect(() => {
    if (!ready) return;
    engineRef.current?.setToothStates(visual);
    if (host.current) host.current.dataset.applied = engineRef.current?.appliedSummary() ?? ""; // what the 3D teeth were actually given (read by the acceptance tests)
  }, [ready, visual, engineRef]);
  useEffect(() => { if (ready) engineRef.current?.setFdiLabels(labelsOn); }, [ready, labelsOn, engineRef]);
  useEffect(() => { if (ready) engineRef.current?.setViewShift(viewShift); }, [ready, viewShift, engineRef]);
  // The tooth glow fires once per confirmed change (keyed by its timestamp), after the new visual state was applied above — never on every render.
  const glowRef = useRef(glowTeeth);
  glowRef.current = glowTeeth;
  useEffect(() => { if (ready && glowRun && glowRef.current?.size) engineRef.current?.flashTeeth(Array.from(glowRef.current)); }, [ready, glowRun, engineRef]);

  return <div ref={host} data-testid="chart-3d" className="absolute inset-0" />;
}
