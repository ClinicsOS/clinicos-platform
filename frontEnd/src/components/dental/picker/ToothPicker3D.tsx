"use client";
import { useEffect, useRef, useState } from "react";
import type { ToothPickerEngine } from "./ToothPickerEngine"; // type-only: three.js is NOT in the main bundle
import type { DentitionType } from "@/lib/dental/fdi";

interface Props {
  selected: string[];
  onChange: (next: string[]) => void;
  onHover: (fdi: string | null, clientX: number, clientY: number) => void;
  onFailure: (message: string) => void;
  onReady?: () => void;
  dentition: DentitionType;
  current: string[] | null;
  mode: "multi" | "single";
  disabled: boolean;
  reducedMotion: boolean;
}

/**
 * Mounts the picker engine. Like the main dental chart, three.js is imported dynamically inside the effect, so only a
 * doctor who opens the treatment editor and needs the picker downloads it. Any failure creating the WebGL context is
 * reported to the parent (which switches to the 2D picker) — it never throws into React.
 */
export default function ToothPicker3D({ selected, onChange, onHover, onFailure, onReady, dentition, current, mode, disabled, reducedMotion }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ToothPickerEngine | null>(null);
  const cbRef = useRef({ onChange, onHover, onFailure, onReady });
  cbRef.current = { onChange, onHover, onFailure, onReady };
  const initial = useRef({ selected, dentition, current, mode, disabled });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let engine: ToothPickerEngine | null = null;
    (async () => {
      try {
        const { ToothPickerEngine: Engine } = await import("./ToothPickerEngine");
        if (cancelled || !host.current) return;
        const i = initial.current;
        engine = new Engine(
          host.current,
          { onChange: (f) => cbRef.current.onChange(f), onHover: (f, x, y) => cbRef.current.onHover(f, x, y) },
          { reducedMotion, dentition: { type: i.dentition, current: i.current }, selected: i.selected, mode: i.mode, disabled: i.disabled }
        );
        engineRef.current = engine;
        setReady(true);
        cbRef.current.onReady?.();
      } catch (e) {
        if (!cancelled) cbRef.current.onFailure(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      engine?.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // created once per mount; everything else is synced through the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selKey = selected.join(",");
  useEffect(() => { if (ready) engineRef.current?.setSelection(selected); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selKey]);
  const curKey = (current ?? []).join(",");
  useEffect(() => { if (ready) engineRef.current?.setDentition(dentition, current); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dentition, curKey]);
  useEffect(() => { if (ready) engineRef.current?.setMode(mode); }, [ready, mode]);
  useEffect(() => { if (ready) engineRef.current?.setDisabled(disabled); }, [ready, disabled]);

  return <div ref={host} className="absolute inset-0" />;
}
