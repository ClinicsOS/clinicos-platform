"use client";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { DermEngine, CameraSnapshot, HistoryCounts, StoredMarker } from "./engine/DermEngine"; // type-only: three.js is NOT in the main bundle
import type { AssetStatus, MarkerPoint, ModelKey, RenderQuality, ViewMode } from "./engine/types";

export interface DermSceneHandlers {
  onPick: (regionId: string, additive: boolean) => void;
  onPickNone: (additive: boolean) => void;
  onHover: (regionId: string | null, clientX: number, clientY: number) => void;
  onCameraState: (s: CameraSnapshot) => void;
  onMarkerPlace: (m: MarkerPoint) => void;
  onReady: (status: AssetStatus) => void;
  onModelStatus: (status: AssetStatus) => void;
  onFailure: (message: string) => void;
}

interface Props {
  engineRef: MutableRefObject<DermEngine | null>;
  handlers: DermSceneHandlers;
  model: ModelKey;
  view: ViewMode;
  selection: string[];
  history: Record<string, HistoryCounts>;
  markers: StoredMarker[];
  placingRegion: string | null;
  reducedMotion: boolean;
  quality: RenderQuality;
  ariaLabel: string;
}

/**
 * Mounts the imperative engine. Three.js (engine + asset loader + GLTFLoader) is imported dynamically INSIDE the effect,
 * so a clinic that is not Dermatology & Aesthetics — or a user who never opens the map — never downloads it. Any failure
 * while creating the WebGL context / scene / model is reported to the parent (which shows the accessible list, history
 * intact); it never throws into React, so the rest of the Patient Profile keeps working.
 */
export default function DermScene3D({ engineRef, handlers, model, view, selection, history, markers, placingRegion, reducedMotion, quality, ariaLabel }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const hRef = useRef(handlers);
  hRef.current = handlers;
  const init = useRef({ model, view, reducedMotion, quality, ariaLabel });
  const [ready, setReady] = useState(false);
  const loadToken = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let engine: DermEngine | null = null;
    const ctl = new AbortController();
    (async () => {
      try {
        const [{ DermEngine: Engine }, { loadAsset }] = await Promise.all([import("./engine/DermEngine"), import("./engine/assetLoader")]);
        if (cancelled || !host.current) return;
        const { asset, status } = await loadAsset(init.current.model, { signal: ctl.signal });
        if (cancelled || !host.current) { asset.dispose(); return; }
        engine = new Engine(
          host.current,
          {
            onPick: (id, add) => hRef.current.onPick(id, add),
            onPickNone: (add) => hRef.current.onPickNone(add),
            onHover: (id, x, y) => hRef.current.onHover(id, x, y),
            onCameraState: (s) => hRef.current.onCameraState(s),
            onMarkerPlace: (m) => hRef.current.onMarkerPlace(m),
            onContextLost: () => hRef.current.onFailure("The GPU context was lost"),
          },
          { reducedMotion: init.current.reducedMotion, asset, view: init.current.view, quality: init.current.quality, ariaLabel: init.current.ariaLabel }
        );
        engineRef.current = engine;
        setReady(true);
        hRef.current.onReady(status);
      } catch (e) {
        if (!cancelled && !(e instanceof DOMException && e.name === "AbortError")) hRef.current.onFailure(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      ctl.abort();
      engine?.dispose();
      if (engineRef.current === engine) engineRef.current = null;
    };
    // The engine is created once per mount; everything else is synced through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Male <-> female: load the new asset, then swap it in. Only the LATEST request may apply (rapid toggling can't
  // leave the old figure on screen or leak an asset); selection / history / markers survive the swap.
  const firstModel = useRef(true);
  useEffect(() => {
    if (!ready) return;
    if (firstModel.current) { firstModel.current = false; if (engineRef.current?.assetKey === model) return; }
    const token = ++loadToken.current;
    const ctl = new AbortController();
    (async () => {
      try {
        const { loadAsset } = await import("./engine/assetLoader");
        const { asset, status } = await loadAsset(model, { signal: ctl.signal });
        if (token !== loadToken.current || !engineRef.current) { asset.dispose(); return; }
        engineRef.current.setAsset(asset);
        hRef.current.onModelStatus(status);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError") && token === loadToken.current) hRef.current.onFailure(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, model]);

  const selKey = selection.join(",");
  useEffect(() => { if (ready) engineRef.current?.setSelection(selection); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selKey, model]);
  useEffect(() => { if (ready) engineRef.current?.setHistory(history); }, [ready, history, model, engineRef]);
  useEffect(() => { if (ready) engineRef.current?.setMarkers(markers); }, [ready, markers, model, engineRef]);
  useEffect(() => { if (ready) engineRef.current?.setMarkerPlacement(placingRegion); }, [ready, placingRegion, model, engineRef]);
  useEffect(() => { if (ready) engineRef.current?.setView(view); }, [ready, view, engineRef]);

  // The canvas fades in once the engine is up (no hard pop over the loading silhouette).
  return <div ref={host} className={`absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none [&_canvas]:outline-none [&_canvas:focus-visible]:outline [&_canvas:focus-visible]:outline-2 [&_canvas:focus-visible]:-outline-offset-2 [&_canvas:focus-visible]:outline-teal ${ready ? "opacity-100" : "opacity-0"}`} />;
}
