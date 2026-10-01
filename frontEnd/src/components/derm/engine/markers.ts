import * as THREE from "three";
import type { MarkerPoint, RegionSurface } from "./types";

/**
 * Marker maths. A marker is stored MODEL-INDEPENDENTLY as (u, v, w) in [0,1]^3 of the region's axis-aligned bounding
 * box (space id `region-aabb/v1`, mirrored by the backend). The same stored marker therefore lands inside the same
 * anatomical region on the male model, the female model, the procedural body and any future GLB — it is never a raw
 * world coordinate. On display it is snapped to the nearest point of the region's surface.
 */
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function toNormalized(bounds: THREE.Box3, p: THREE.Vector3): { u: number; v: number; w: number } {
  const s = bounds.getSize(new THREE.Vector3());
  const q = (a: number, lo: number, size: number) => (size > 1e-9 ? clamp01((a - lo) / size) : 0.5);
  return { u: q(p.x, bounds.min.x, s.x), v: q(p.y, bounds.min.y, s.y), w: q(p.z, bounds.min.z, s.z) };
}

export function fromNormalized(bounds: THREE.Box3, u: number, v: number, w: number, out = new THREE.Vector3()): THREE.Vector3 {
  const s = bounds.getSize(new THREE.Vector3());
  return out.set(bounds.min.x + clamp01(u) * s.x, bounds.min.y + clamp01(v) * s.y, bounds.min.z + clamp01(w) * s.z);
}

/** Nearest surface vertex of the region to `p`, with its outward normal. */
export function snapToSurface(surface: RegionSurface, p: THREE.Vector3): { point: THREE.Vector3; normal: THREE.Vector3 } {
  const pos = surface.geometry.getAttribute("position"), nor = surface.geometry.getAttribute("normal");
  let best = 0, bd = Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const d = v.distanceToSquared(p);
    if (d < bd) { bd = d; best = i; }
  }
  return {
    point: new THREE.Vector3().fromBufferAttribute(pos, best),
    normal: nor ? new THREE.Vector3().fromBufferAttribute(nor, best).normalize() : new THREE.Vector3(0, 0, 1),
  };
}

/** World position (slightly off the skin so it is never buried) where a stored marker is drawn on THIS asset. */
export function markerWorldPosition(surface: RegionSurface, m: MarkerPoint, lift = 0.004): THREE.Vector3 {
  const raw = fromNormalized(surface.bounds, m.u, m.v, m.w);
  const s = snapToSurface(surface, raw);
  return s.point.addScaledVector(s.normal, lift);
}
