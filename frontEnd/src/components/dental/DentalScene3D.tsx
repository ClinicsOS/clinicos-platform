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
}

/**
 * Mounts the imperative engine. The engine module (and therefore Three.js) is imported dynamically inside
 * the effect, so only a dentistry user who actually opens the Dental Chart downloads it. Any failure while
 * creating the WebGL context / scene is reported to the parent (which shows the 2D fallback) — it never throws
 * into React, so the rest of the Patient Profile keeps working.
 */
export default function DentalScene3D({ engineRef, handlers, visual, dentition, current, labelsOn, viewShift, reducedMotion }: Props) {
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
            onHover: (f, x, y) => hRef.current.onHover(f, x, y),
            onModeChange: (m) => hRef.current.onMode(m),
            onJawChange: (a) => hRef.current.onJaw(a),
          },
          { reducedMotion, dentition: { type: dRef.current.dentition, current: dRef.current.current } }
        );
        engineRef.current = engine;
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
  useEffect(() => { if (ready) engineRef.current?.setToothStates(visual); }, [ready, visual, engineRef]);
  useEffect(() => { if (ready) engineRef.current?.setFdiLabels(labelsOn); }, [ready, labelsOn, engineRef]);
  useEffect(() => { if (ready) engineRef.current?.setViewShift(viewShift); }, [ready, viewShift, engineRef]);

  return <div ref={host} className="absolute inset-0" />;
}
