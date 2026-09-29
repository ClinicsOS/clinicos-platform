export type WebGLCheck = { ok: true } | { ok: false; reason: string };

/** Cheap capability probe so the page can fall back to the 2D chart instead of crashing. */
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
