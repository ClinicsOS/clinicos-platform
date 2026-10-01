import type { RenderQuality } from "./types";

export type WebGLCheck = { ok: true } | { ok: false; reason: string };

/** Cheap capability probe so the page can fall back to the accessible list instead of crashing. */
export function detectWebGL(): WebGLCheck {
  if (typeof document === "undefined") return { ok: false, reason: "no-document" };
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return { ok: false, reason: "WebGL is unavailable or disabled in this browser" };
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "WebGL check failed" };
  }
}


/**
 * Adaptive render quality. Phones and low-memory devices get a cheaper pipeline (lower pixel ratio, no
 * environment-map generation) — the 3D map stays fully functional everywhere, only the rendering cost changes.
 */
export function detectQuality(): RenderQuality {
  if (typeof window === "undefined") return "medium";
  const w = Math.min(window.innerWidth || 1024, window.screen?.width || 9999);
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency || 8;
  if (w < 640 || (mem !== undefined && mem <= 2) || cores <= 2) return "low";
  if (w < 1100 || (mem !== undefined && mem <= 4)) return "medium";
  return "high";
}

export const QUALITY_PIXEL_RATIO: Record<RenderQuality, number> = { high: 2, medium: 1.75, low: 1.25 };
