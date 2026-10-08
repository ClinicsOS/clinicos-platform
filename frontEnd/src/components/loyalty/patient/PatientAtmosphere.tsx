"use client";
import dynamic from "next/dynamic";
import { useState, type MutableRefObject } from "react";
import { usePatientVisual } from "./patientDesign";

/** The GL layer is a separate lazy chunk: only capable, non-reduced-motion phones ever download `three`. */
const GL = dynamic(() => import("./PatientAtmosphereGL"), { ssr: false });

/**
 * Patient atmosphere — a CSS base (always), plus the ONE lazy WebGL canvas in "full" mode. If WebGL is unavailable or the context is lost,
 * the CSS base simply stays (it is already a complete, premium background).
 */
export default function PatientAtmosphere({ accent, scrollRef }: { accent: string; scrollRef: MutableRefObject<number> }) {
  const v = usePatientVisual();
  const [failed, setFailed] = useState(false);
  const [live, setLive] = useState(false);
  const useGl = v.webgl && !failed;
  return (
    <div className="pw-atmo" aria-hidden="true" data-testid="pw-atmo">
      <div className="pw-atmo-base" />
      <div className="pw-atmo-aurora" />
      {useGl && (
        <div className={live ? "is-live" : ""} style={{ position: "absolute", inset: 0 }}>
          <GL accent={accent} dpr={v.dpr} scrollRef={scrollRef} onFail={() => setFailed(true)} onLive={() => setLive(true)} />
        </div>
      )}
      <div className="pw-grain" />
    </div>
  );
}
