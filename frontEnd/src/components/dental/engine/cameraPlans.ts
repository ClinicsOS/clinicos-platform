import * as THREE from "three";
import type { CameraPose } from "./cameraDirector";
import type { PresetName } from "./interactionMachine";

export const FOV = 30;
const TAN = Math.tan((FOV * Math.PI) / 360);

/**
 * Camera framing is derived from the MODEL BOUNDS (not hard-coded), so Permanent, Primary and Mixed jaws all fill a
 * similar useful part of the viewport regardless of their size.
 */
export interface Framing { center: THREE.Vector3; halfW: number; halfH: number; halfD: number }

export function frameFromBox(box: THREE.Box3): Framing {
  const size = box.getSize(new THREE.Vector3());
  return { center: box.getCenter(new THREE.Vector3()), halfW: size.x / 2, halfH: size.y / 2, halfD: size.z / 2 };
}

/**
 * Smallest camera distance (looking at the model centre along `dir`) at which the PROJECTED bounding box of the model
 * fits inside `fillY` of the viewport half-height and `fillX` of the half-width. Solved on the real perspective
 * projection of the 8 box corners, so Permanent / Primary / Mixed jaws all end up filling the same useful share of the
 * view regardless of their size or depth.
 */
function fitProjected(fr: Framing, aspect: number, dir: THREE.Vector3, fillY: number, fillX: number): number {
  const d = dir.clone().normalize(), f = d.clone().negate();
  const r = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 1, 0)).normalize();
  const u = new THREE.Vector3().crossVectors(r, f);
  const corners: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3(sx * fr.halfW, sy * fr.halfH, sz * fr.halfD));
  const fits = (dist: number) => {
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    for (const c of corners) {
      const rel = c.clone().addScaledVector(d, -dist);
      const z = rel.dot(f);
      if (z < 0.2) return false;
      const x = rel.dot(r) / (z * TAN * aspect), y = rel.dot(u) / (z * TAN);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return (maxY - minY) / 2 <= fillY && (maxX - minX) / 2 <= fillX;
  };
  let lo = 1, hi = 400;
  for (let i = 0; i < 32; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  return hi;
}
const FILL_Y = 0.68, FILL_X = 0.8;

const at = (fr: Framing, dir: THREE.Vector3, dist: number, targetOffset = new THREE.Vector3()): CameraPose => {
  const target = fr.center.clone().add(targetOffset);
  return { position: target.clone().addScaledVector(dir.clone().normalize(), dist), target };
};

/** Restrained perspective view: upper + lower teeth, anterior teeth and posterior depth. */
export const defaultPose = (fr: Framing, aspect: number): CameraPose =>
  at(fr, new THREE.Vector3(0, 0.195, 0.98), fitProjected(fr, aspect, new THREE.Vector3(0, 0.195, 0.98), FILL_Y, FILL_X));

/** Start of the entrance move: farther away and a little higher. */
export const entrancePose = (fr: Framing, aspect: number): CameraPose => {
  const d = defaultPose(fr, aspect);
  d.position.sub(d.target).multiplyScalar(1.55).add(d.target);
  d.position.y += fr.halfH * 0.45;
  return d;
};

export function presetPose(name: PresetName, fr: Framing, aspect: number): CameraPose {
  const u = fr.halfH / 3.4; // unit relative to the permanent jaw the offsets were tuned on
  switch (name) {
    case "front": return defaultPose(fr, aspect);
    case "upper": { const dir = new THREE.Vector3(0, -0.62, 0.78); return at(fr, dir, fitProjected(fr, aspect, dir, FILL_Y, FILL_X), new THREE.Vector3(0, 1.5 * u, 0)); } // looks up at the upper arch
    case "lower": { const dir = new THREE.Vector3(0, 0.85, 0.53); return at(fr, dir, fitProjected(fr, aspect, dir, FILL_Y, FILL_X), new THREE.Vector3(0, -1.7 * u, 0)); } // looks down at the lower arch
    // Patient's LEFT = viewer's right (+X); patient's RIGHT = viewer's left (-X).
    case "left": { const dir = new THREE.Vector3(1, 0.07, 0); return at(fr, dir, fitProjected(fr, aspect, dir, FILL_Y, FILL_X)); }
    case "right": { const dir = new THREE.Vector3(-1, 0.07, 0); return at(fr, dir, fitProjected(fr, aspect, dir, FILL_Y, FILL_X)); }
  }
}

export interface ToothViewInput {
  center: THREE.Vector3; // crown centre, world
  nx: number; nz: number; // facial normal (xz), world
  jaw: "upper" | "lower";
  tip: number; w: number;
}

/**
 * Distance at which the tooth fills `fillFraction` of the viewport height. Selected ≈ 25% (jaw clearly visible behind),
 * Focus ≈ 42% (close examination). Depends on the tooth's own size, so small primary teeth are framed correctly too.
 */
export function toothDistance(i: Pick<ToothViewInput, "tip" | "w">, fillFraction: number): number {
  const need = Math.max(i.tip + 0.35, i.w * 0.9);
  return Math.min(10, Math.max(3.4, need / fillFraction / (2 * TAN)));
}
export const SELECT_FILL = 0.25;
export const FOCUS_FILL = 0.42;

/** Camera pose that looks at a tooth — position AND orbit target both move to the tooth (never only the position). */
export function toothPose(kind: "select" | "focus", i: ToothViewInput): CameraPose {
  const n = new THREE.Vector3(i.nx, 0, i.nz).normalize();
  const elev = i.jaw === "upper" ? -0.12 : 0.3;
  const dir = new THREE.Vector3();
  if (kind === "select") dir.copy(n).multiplyScalar(0.55).add(new THREE.Vector3(0, elev, 0.55));
  else dir.copy(n).multiplyScalar(0.85).add(new THREE.Vector3(0, elev, 0.2));
  dir.normalize();
  const dist = toothDistance(i, kind === "select" ? SELECT_FILL : FOCUS_FILL);
  return { position: i.center.clone().addScaledVector(dir, dist), target: i.center.clone() };
}
