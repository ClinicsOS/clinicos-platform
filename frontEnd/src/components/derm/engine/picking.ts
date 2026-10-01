import * as THREE from "three";

export interface PickResult {
  regionId: string;
  /** Point on the region overlay surface, in world space. */
  point: THREE.Vector3;
  distance: number;
}

/** Tolerance (m): a body surface this much nearer than the region hit means something else covers the region. */
export const OCCLUSION_EPS = 0.006;
/**
 * Tolerance (m) BEHIND an overlay hit: the overlay sits ~1.5 mm off the skin, so on a grazing ray its hit can be a few
 * millimetres in front of the skin hit. When the visible skin is much farther than that, the overlay hit is only a
 * "halo" of a silhouette edge and the pixel really shows something else.
 */
export const HALO_TOLERANCE = 0.03;

/**
 * Region picking. The pointer ray is tested against the region overlay meshes (each has a tight bounding sphere/box, so
 * three.js rejects a mesh cheaply before any triangle test) and against the visible skin.
 *  - If the skin is hit clearly NEARER than the nearest region, the ray hit a part of the body that no region covers
 *    (an unmapped part of a GLB asset, the other leg, the torso in front of an arm…) — nothing behind it is picked.
 *  - An overlay hit is only accepted when it lies on the visible skin (skin hit within HALO_TOLERANCE behind it);
 *    otherwise it is a silhouette halo and the next region along the ray is considered.
 * Decorative meshes (hair…) are never part of `occluders`, so they cannot block a pick.
 */
export function pickRegion(
  raycaster: THREE.Raycaster,
  regionMeshes: THREE.Object3D[],
  occluders: THREE.Object3D[]
): PickResult | null {
  const hits = raycaster.intersectObjects(regionMeshes, false);
  if (!hits.length) return null;
  const toResult = (h: THREE.Intersection): PickResult => ({ regionId: h.object.userData.regionId as string, point: h.point.clone(), distance: h.distance });
  if (!occluders.length) return toResult(hits[0]);
  const skin = raycaster.intersectObjects(occluders, false)[0];
  if (!skin) return null; // overlay-only hit: a halo, the pixel shows the background
  if (skin.distance < hits[0].distance - OCCLUSION_EPS) return null;
  for (const h of hits) if (skin.distance <= h.distance + HALO_TOLERANCE) return toResult(h);
  return null;
}
