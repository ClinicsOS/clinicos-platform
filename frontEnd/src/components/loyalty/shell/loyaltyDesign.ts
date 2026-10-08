"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { useLoyaltyUi, VISUAL_KEY } from "@/lib/loyaltyNav";

/**
 * ClinicOS Loyalty — design constants + device adaptation (Phase 8).
 *
 * MOTION is the single timing vocabulary for the whole product. The same values live in CSS as --lyx-micro / --lyx-fast /
 * --lyx-normal / --lyx-slow / --lyx-cine (see shellStyles.ts) — components never invent their own durations:
 *   micro      120 ms  press / release, icon nudges
 *   fast       200 ms  hovers, toggles, small reveals, tab content cross-fades
 *   normal     320 ms  page transitions, sheets, dialogs, list entrances
 *   slow       560 ms  progress rails, counters, balance changes
 *   cinematic 1400 ms  the entry splash and promotion moments — the only "long" motion
 */
export const MOTION = { micro: 120, fast: 200, normal: 320, slow: 560, cinematic: 1400 } as const;

/** Total time of the ClinicOS → Loyalty entry sequence (splash visible → fully revealed). */
export const SPLASH_MS = 1750;
/** Time the exit veil needs before navigating back to ClinicOS. */
export const EXIT_MS = 380;

/* ---------- device adaptation ---------- */

export type VisualMode = "full" | "lite" | "static";

/**
 * full    everything: lazy WebGL atmosphere, pointer parallax, orbiting hero, cinematic splash
 * lite    small screens, low-end hardware, or the user's own choice: no WebGL, no blur-heavy layers, few continuous animations
 * static  prefers-reduced-motion: no continuous motion, no parallax, no tilt; transitions become clean fades. All features remain.
 */
export interface VisualState {
  mode: VisualMode;
  reduced: boolean;
  /** WebGL atmosphere allowed AND available on this device */
  webgl: boolean;
}
const VisualCtx = createContext<VisualState>({ mode: "lite", reduced: false, webgl: false });
export const VisualProvider = VisualCtx.Provider;
export const useVisual = () => useContext(VisualCtx);

/** Live prefers-reduced-motion. */
export function useReducedMotionLive(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return r;
}

let webglProbe: boolean | null = null;
/**
 * Can this device create a real (hardware-accelerated) WebGL context? Uses failIfMajorPerformanceCaveat, so machines that would fall back to
 * slow software rendering get the lightweight CSS look instead of a janky canvas. `localStorage["lyx-gl"] = "force"` skips the caveat check
 * (QA only). The probe context is released immediately.
 */
export function detectWebGL(): boolean {
  if (typeof document === "undefined") return false;
  const forced = (() => {
    try {
      return window.localStorage.getItem("lyx-gl") === "force";
    } catch {
      return false;
    }
  })();
  if (webglProbe !== null && !forced) return webglProbe;
  let ok = false;
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2", { failIfMajorPerformanceCaveat: !forced }) || c.getContext("webgl", { failIfMajorPerformanceCaveat: !forced })) as WebGLRenderingContext | null;
    ok = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    ok = false;
  }
  if (!forced) webglProbe = ok;
  return ok;
}

/** Computes the visual mode from reduced-motion, screen width, hardware hints and the user's preference. */
export function useVisualState(): VisualState {
  const pref = useLoyaltyUi((s) => s.visual);
  const setVisual = useLoyaltyUi((s) => s.setVisual);
  const reduced = useReducedMotionLive();
  const [small, setSmall] = useState(false);
  const [weak, setWeak] = useState(false);
  const [gl, setGl] = useState(false);

  // Restore the saved preference once (without re-writing it).
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(VISUAL_KEY);
      if (v === "lite" || v === "auto") useLoyaltyUi.setState({ visual: v });
    } catch {
      /* storage blocked */
    }
  }, [setVisual]);

  useEffect(() => {
    let raf = 0;
    const measure = () => setSmall(window.innerWidth < 768);
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    measure();
    const nav = navigator as Navigator & { deviceMemory?: number };
    setWeak((nav.hardwareConcurrency ?? 8) <= 2 || (nav.deviceMemory ?? 8) <= 2);
    setGl(detectWebGL());
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const mode: VisualMode = reduced ? "static" : pref === "lite" || small || weak ? "lite" : "full";
  return { mode, reduced, webgl: mode === "full" && gl };
}

/* ---------- tier materials for JS consumers (CSS has the same palette as variables) ---------- */

export const TIER_ACCENT = { tier1: "#8e9bb0", tier2: "#cdd6e4", tier3: "#e0b341", tier4: "#9a78e6" } as const;
