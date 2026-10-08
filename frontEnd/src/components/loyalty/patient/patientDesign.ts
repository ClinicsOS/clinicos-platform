"use client";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { detectWebGL, useReducedMotionLive } from "../shell/loyaltyDesign";

/**
 * ClinicOS Loyalty — PATIENT app design constants + device adaptation (Phase 9).
 *
 * The patient app belongs to the same family as the clinic product (Phase 8: dark graphite, ivory, gold, rose, mint) but is more
 * immersive and card-first. It re-uses the Phase 8 utilities (reduced-motion hook, WebGL probe) and nothing else from the clinic UI.
 *
 * MOTION — one timing vocabulary (the same numbers exist in CSS as --pw-micro / --pw-nav / --pw-feature / --pw-cine):
 *   micro      150 ms   press / release, small state changes
 *   nav        280 ms   screen transitions, sheets, list entrances
 *   feature    560 ms   progress rails, counters, balance changes, card flip
 *   cinematic 1800 ms   entry, tier transformation — the only long motion
 */
export const PMOTION = { micro: 150, nav: 280, feature: 560, cinematic: 1800 } as const;
/** Easing curves (CSS strings); `spring` overshoots slightly, `out` is the default decelerate. */
export const PEASE = { out: "cubic-bezier(.2,.8,.2,1)", spring: "cubic-bezier(.3,1.35,.5,1)", inOut: "cubic-bezier(.6,0,.2,1)" } as const;

/** Cinematic entry: first meaningful content is visible after this long (skippable by tap). */
export const ENTRY_MS = 2200;
/** The welcome-back transition for a returning, still-valid session. */
export const WELCOME_BACK_MS = 800;
/** The full cinematic entry is not replayed on every QR scan: only when the patient hasn't seen it on this device for this long. */
export const INTRO_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/* ---------- visual modes ---------- */

export type PatientMode = "full" | "lite" | "static";
export interface PatientVisual {
  mode: PatientMode;
  reduced: boolean;
  /** one lazy WebGL canvas is allowed AND available */
  webgl: boolean;
  /** pixel-ratio cap for the canvas / particle layers */
  dpr: number;
}
export const PATIENT_VISUAL_KEY = "lyp-visual";

const Ctx = createContext<PatientVisual>({ mode: "lite", reduced: false, webgl: false, dpr: 1 });
export const PatientVisualProvider = Ctx.Provider;
export const usePatientVisual = () => useContext(Ctx);

/**
 * full    capable phones: one lazy WebGL light field, card reflections, particles for moments, idle light sweep
 * lite    weak hardware / data saver / the patient's own choice: no WebGL, bounded CSS effects, no continuous loops
 * static  prefers-reduced-motion: no parallax, no tilt-follow, no particles, no camera/idle motion — clean fades. Every feature remains.
 */
export function usePatientVisualState(): PatientVisual {
  const reduced = useReducedMotionLive();
  const [pref, setPref] = useState<"auto" | "lite">("auto");
  const [weak, setWeak] = useState(false);
  const [gl, setGl] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(PATIENT_VISUAL_KEY) === "lite") setPref("lite");
    } catch {
      /* storage blocked */
    }
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } };
    const cores = nav.hardwareConcurrency ?? 8;
    const mem = nav.deviceMemory ?? 8;
    const slowNet = nav.connection?.saveData === true || /(^|-)2g$/.test(nav.connection?.effectiveType ?? "");
    setWeak(cores <= 3 || mem <= 2 || slowNet);
    setGl(detectWebGL());
    const onPref = (e: StorageEvent) => {
      if (e.key === PATIENT_VISUAL_KEY) setPref(e.newValue === "lite" ? "lite" : "auto");
    };
    window.addEventListener("storage", onPref);
    return () => window.removeEventListener("storage", onPref);
  }, []);

  const mode: PatientMode = reduced ? "static" : pref === "lite" || weak ? "lite" : "full";
  return { mode, reduced, webgl: mode === "full" && gl, dpr: mode === "full" ? 1.5 : 1 };
}
export function setPatientVisualPref(v: "auto" | "lite") {
  try {
    if (v === "lite") window.localStorage.setItem(PATIENT_VISUAL_KEY, "lite");
    else window.localStorage.removeItem(PATIENT_VISUAL_KEY);
    window.dispatchEvent(new StorageEvent("storage", { key: PATIENT_VISUAL_KEY, newValue: v === "lite" ? "lite" : null }));
  } catch {
    /* storage blocked — the choice just applies to this page view through the event below */
  }
}

/* ---------- tier materials (metadata; the pixels live in patientStyles.ts) ---------- */

export type PTierKey = "tier1" | "tier2" | "tier3" | "tier4";
export type MaterialKey = PTierKey | "none";
/**
 * Not colour alone: every tier also has its own surface pattern, edge treatment, symbol and a rank glyph (filled pips).
 *   tier1 pearl / ivory — guilloche rings, soft iridescent pearl, ring symbol
 *   tier2 platinum      — fine brushed lines, cold specular, faceted-diamond symbol
 *   tier3 gold          — engraved lattice, layered highlights, crown symbol
 *   tier4 obsidian      — dark facets with gold & rose foil, seal symbol
 */
export const MATERIAL_INFO: Record<MaterialKey, { rank: number; pattern: "guilloche" | "brushed" | "lattice" | "facets" | "plain"; symbol: "ring" | "diamond" | "crown" | "seal" | "gem"; accent: string }> = {
  tier1: { rank: 1, pattern: "guilloche", symbol: "ring", accent: "233,224,205" },
  tier2: { rank: 2, pattern: "brushed", symbol: "diamond", accent: "205,214,228" },
  tier3: { rank: 3, pattern: "lattice", symbol: "crown", accent: "232,199,106" },
  tier4: { rank: 4, pattern: "facets", symbol: "seal", accent: "230,138,156" },
  none: { rank: 0, pattern: "plain", symbol: "gem", accent: "232,199,106" },
};
export const materialOf = (key?: string | null): MaterialKey => (key === "tier1" || key === "tier2" || key === "tier3" || key === "tier4" ? key : "none");

/* ---------- small helpers ---------- */

export const hexToRgb = (hex?: string | null) => {
  const m = hex ? /^#([0-9a-f]{6})$/i.exec(hex) : null;
  if (!m) return "232,199,106";
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};

/** Browser online/offline (the PWA must say so and disable anything that needs the server). */
export function useOnline(): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const up = () => setOn(navigator.onLine !== false);
    up();
    window.addEventListener("online", up);
    window.addEventListener("offline", up);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", up);
    };
  }, []);
  return on;
}

/** Page visibility — expensive rendering and polling pause while hidden and resume cleanly. */
export function useVisible(): boolean {
  const [v, setV] = useState(true);
  useEffect(() => {
    const f = () => setV(document.visibilityState !== "hidden");
    f();
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);
  return v;
}

/** The previous value of something (undefined on the first render). */
export function usePrevious<T>(v: T): T | undefined {
  const r = useRef<T>();
  useEffect(() => {
    r.current = v;
  });
  return r.current;
}

/**
 * Critically-damped spring toward a target — runs a requestAnimationFrame loop ONLY while the value is still moving, then stops
 * (no idle loop). `apply` receives the current value on every step.
 */
export function createSpring(apply: (v: number) => void, opts: { stiffness?: number; damping?: number; eps?: number } = {}) {
  const k = opts.stiffness ?? 170;
  const c = opts.damping ?? 17;
  const eps = opts.eps ?? 0.02;
  let x = 0;
  let v = 0;
  let target = 0;
  let raf = 0;
  let last = 0;
  const step = (now: number) => {
    const dt = Math.min(0.034, (now - last) / 1000 || 0.016);
    last = now;
    const a = -k * (x - target) - c * v;
    v += a * dt;
    x += v * dt;
    if (Math.abs(x - target) < eps && Math.abs(v) < eps) {
      x = target;
      v = 0;
      raf = 0;
      apply(x);
      return;
    }
    apply(x);
    raf = requestAnimationFrame(step);
  };
  return {
    set(val: number) {
      x = val;
      v = 0;
      target = val;
      cancelAnimationFrame(raf);
      raf = 0;
      apply(x);
    },
    to(val: number) {
      target = val;
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(step);
      }
    },
    get value() {
      return x;
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
