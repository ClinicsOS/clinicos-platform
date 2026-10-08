"use client";
import { useEffect, useState, type ComponentType } from "react";
import { useVisual } from "./loyaltyDesign";

type GLProps = { onFail: () => void; onLive: () => void };

/**
 * Background environment of the Loyalty product (Phase 8): charcoal depth, warm light pools and a faint perspective grid — all CSS, so it is
 * the complete look on its own (lite / static modes, no WebGL, WebGL failure). On capable devices a single lazily-loaded WebGL canvas
 * (AtmosphereGL) fades in on top. `data-gl` reports which one is active.
 */
export default function LoyaltyAtmosphere() {
  const { webgl } = useVisual();
  const [Gl, setGl] = useState<ComponentType<GLProps> | null>(null);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!webgl || failed) return;
    let alive = true;
    import("./AtmosphereGL")
      .then((m) => alive && setGl(() => m.default))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [webgl, failed]);

  useEffect(() => {
    if (!webgl) setLive(false);
  }, [webgl]);

  const on = webgl && !failed && !!Gl;
  return (
    <div className={`lyx-atmo ${live && on ? "is-live" : ""}`} aria-hidden="true" data-testid="lyx-atmo" data-gl={on ? "on" : "off"}>
      <div className="lyx-atmo-orb a" />
      <div className="lyx-atmo-orb b" />
      <div className="lyx-atmo-grid" />
      {on && Gl && <Gl onFail={() => setFailed(true)} onLive={() => setLive(true)} />}
    </div>
  );
}
