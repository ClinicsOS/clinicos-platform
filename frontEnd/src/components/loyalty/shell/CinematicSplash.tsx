"use client";
import { useEffect, useRef, useState } from "react";
import { IconDiamond } from "@tabler/icons-react";
import { SPLASH_MS } from "./loyaltyDesign";

const OUT_MS = 360;
/** reduced-motion entry: a short, calm fade (no camera movement, no rotation) */
const STATIC_MS = 700;

/**
 * The ClinicOS → ClinicOS Loyalty entry moment (Phase 8). Three tier-material cards fan into place in 3D, a light sweeps across the gold card,
 * the wordmark settles. ~1.75 s in total, then the shell reveals itself underneath. Played ONLY when the user enters Loyalty from ClinicOS
 * (never on section changes or a refresh). Click / Enter / Space / Escape skip it. No sound.
 *
 * `onReveal` fires when the splash starts fading out (the shell begins its own entrance), `onDone` when it can be removed.
 */
export default function CinematicSplash({ reduced, lang, onReveal, onDone }: { reduced: boolean; lang: "en" | "ar"; onReveal: () => void; onDone: () => void }) {
  const [out, setOut] = useState(false);
  const fired = useRef(false);
  const cbs = useRef({ onReveal, onDone });
  cbs.current = { onReveal, onDone };
  const skip = useRef<() => void>(() => {});

  useEffect(() => {
    const total = reduced ? STATIC_MS : SPLASH_MS;
    const t1 = setTimeout(() => finish(OUT_MS), total - OUT_MS);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") finish(OUT_MS);
    };
    window.addEventListener("keydown", key);
    function finish(outMs: number) {
      if (fired.current) return;
      fired.current = true;
      clearTimeout(t1);
      setOut(true);
      cbs.current.onReveal();
      setTimeout(() => cbs.current.onDone(), outMs);
    }
    skip.current = () => finish(OUT_MS);
    return () => {
      clearTimeout(t1);
      window.removeEventListener("keydown", key);
    };
  }, [reduced]);

  const ar = lang === "ar";
  return (
    <div
      className={`lyx-splash ${out ? "is-out" : ""}`}
      role="status"
      aria-label="ClinicOS Loyalty"
      data-testid="lyx-splash"
      onClick={() => skip.current()}
      dir="ltr"
    >
      <div className="lyx-splash-glow" />
      <div className="lyx-splash-stage" aria-hidden="true">
        <div className="lyx-sp-card" data-m="1" />
        <div className="lyx-sp-card" data-m="2" />
        <div className="lyx-sp-card" data-m="3">
          <div className="lyx-sp-face">
            <div className="lyx-sp-top">
              <span className="lyx-sp-mark">
                <IconDiamond size={15} stroke={1.7} />
              </span>
              CLINICOS
            </div>
            <div className="lyx-sp-foot">LOYALTY</div>
            <div className="lyx-sp-sweep" />
          </div>
        </div>
      </div>
      <div className="lyx-splash-word" dir={ar ? "rtl" : "ltr"}>
        <small>CLINICOS</small>
        <b>LOYALTY</b>
        <em>{ar ? "الأعضاء • المكافآت • النمو" : "Members • Rewards • Growth"}</em>
      </div>
      <div className="lyx-splash-skip" aria-hidden="true">
        {ar ? "المس للتخطي" : "TAP TO SKIP"}
      </div>
    </div>
  );
}
