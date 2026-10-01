import * as THREE from "three";

/**
 * Region highlight material. Selection is NEVER communicated by colour alone: a selected region gets a colour tint, a
 * bright outline along its boundary AND a fine diagonal hatch; hover gets a tint + a softer outline. Works on any
 * skin tone and in colour-vision deficiency.
 */
export const OVERLAY_VERT = /* glsl */ `
attribute float aEdge;
varying float vEdge;
varying vec3 vWorld;
void main() {
  vEdge = aEdge;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const OVERLAY_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uFill;
uniform float uOutline;
uniform float uHatch;
varying float vEdge;
varying vec3 vWorld;
void main() {
  float edge = smoothstep(0.15, 0.85, vEdge) * uOutline;
  float stripe = step(0.5, fract((vWorld.x + vWorld.y + vWorld.z) * 110.0));
  float a = uFill * (1.0 - 0.5 * uHatch * stripe) + edge * 0.85;
  vec3 c = mix(uColor, vec3(1.0), clamp(edge * 0.7 + uHatch * stripe * 0.25, 0.0, 0.85));
  gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
}`;

export function makeOverlayMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: OVERLAY_VERT,
    fragmentShader: OVERLAY_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color(0x4fc3b8) },
      uFill: { value: 0 },
      uOutline: { value: 0 },
      uHatch: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export interface OverlayLook { fill: number; outline: number; hatch: number }
export const LOOK_IDLE: OverlayLook = { fill: 0, outline: 0, hatch: 0 };
export const LOOK_HOVER: OverlayLook = { fill: 0.26, outline: 0.7, hatch: 0 };
export const LOOK_SELECTED: OverlayLook = { fill: 0.4, outline: 1, hatch: 1 };
export const LOOK_PLACING: OverlayLook = { fill: 0.16, outline: 0.9, hatch: 0 };

/** Neutral marker sprites (no severity colour): circle = dermatology, diamond = aesthetic, ring = precise point. */
export type MarkerShape = "circle" | "diamond" | "ring";

export function makeMarkerTexture(shape: MarkerShape, size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - c) / c, dy = (y - c) / c;
      let d: number; // signed distance-ish in [-1, 1], <0 inside
      if (shape === "diamond") d = (Math.abs(dx) + Math.abs(dy)) / 0.86 - 1;
      else d = Math.hypot(dx, dy) / 0.86 - 1;
      let r = 0, g = 0, b = 0, a = 0;
      if (shape === "ring") {
        const ring = Math.abs(Math.hypot(dx, dy) - 0.62);
        if (ring < 0.09) { r = g = b = 255; a = 255; } else if (ring < 0.17) { r = 12; g = 30; b = 46; a = 220; }
      } else if (d < -0.22) { r = g = b = 246; a = 255; } // neutral off-white fill
      else if (d < 0.02) { r = 12; g = 30; b = 46; a = 255; } // dark outline keeps it legible on light AND dark skin
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.needsUpdate = true;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
