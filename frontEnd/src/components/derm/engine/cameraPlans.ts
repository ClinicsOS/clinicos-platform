import * as THREE from "three";
import { getRegion, surfaceAzimuth, type SurfaceId } from "@/lib/derm/regions";
import type { BodyAsset, CameraState, Facing, ViewMode } from "./types";
import type { CameraPose } from "./cameraDirector";

/**
 * Pure camera composition. Patient frame: azimuth 0 = looking at the patient's front, +90 = from the patient's LEFT
 * (camera at +X), -90 = from the patient's RIGHT, 180 = from behind. Elevation is degrees above the horizon.
 */
export const FOV = 32;
const TAN = Math.tan((FOV * Math.PI) / 360);
const D2R = Math.PI / 180;

export const FACING_AZ: Record<Facing, number> = { front: 0, left: 90, right: -90, back: 180, top: 0 };
/** Scalp elevation per facing: a raised three-quarter look, or straight down onto the crown for `top`. */
export const SCALP_EL = 58;
export const SCALP_TOP_EL = 80; // below OrbitControls' polar limit (~84°) so the orbit never flips

export function directionFromAz(az: number, el: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = az * D2R, e = el * D2R;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

/** Distance at which a sphere of `radius` fits `fill` of the viewport (height or, in portrait, width). */
export function distanceToFit(radius: number, fill: number, aspect: number): number {
  const vert = radius / (fill * TAN);
  const horiz = radius / (fill * TAN * Math.max(aspect, 0.2));
  return Math.max(vert, horiz);
}

export interface Limits { minDistance: number; maxDistance: number }

export function overviewPose(asset: BodyAsset, view: ViewMode, facing: Facing, aspect: number): CameraPose {
  const az = FACING_AZ[facing];
  if (facing === "top" && view !== "scalp") return overviewPose(asset, view, "front", aspect); // `top` only exists in the Scalp view
  if (view === "body") {
    const h = asset.landmarks.height;
    const target = new THREE.Vector3(0, h * 0.5, 0);
    const d = Math.max(distanceToFit(h * 0.5 * 1.06, 1, aspect), distanceToFit(0.5, 1, aspect));
    return { target, position: target.clone().addScaledVector(directionFromAz(az, 3), d) };
  }
  const lm = asset.landmarks;
  const head = lm.head;
  if (view === "face") {
    // Clinical face inspection: the face (brow -> chin, ear to ear) fills the viewport. Orbiting to a side keeps the whole
    // head centred (the pivot slides from the middle of the face toward the middle of the head as the view turns).
    const faceC = lm.faceCenter ?? head.clone().add(new THREE.Vector3(0, -lm.headRadius * 0.16, 0));
    const side = Math.abs(Math.sin(az * D2R));
    const target = faceC.clone();
    target.z = faceC.z + (head.z - faceC.z) * side;
    const d = distanceToFit((lm.faceRadius ?? lm.headRadius) * 1.02, 0.9, aspect);
    return { target, position: target.clone().addScaledVector(directionFromAz(az, 2), d) };
  }
  // scalp: look down onto the crown from a raised three-quarter angle (or straight down for `top`), so the doctor
  // inspects the scalp itself, not the top of a sphere
  const target = head.clone().add(new THREE.Vector3(0, lm.headRadius * 0.28, 0));
  const d = distanceToFit((lm.scalpRadius ?? lm.headRadius) * 0.95, 0.86, aspect);
  return { target, position: target.clone().addScaledVector(directionFromAz(az, facing === "top" ? SCALP_TOP_EL : SCALP_EL), d) };
}

/** Pose that frames one region (optionally one surface of it). `null` when the asset does not carry the region. */
export function regionPose(asset: BodyAsset, regionId: string, aspect: number, surface?: SurfaceId): CameraPose | null {
  const def = getRegion(regionId);
  const surf = asset.regions.get(regionId);
  if (!def || !surf) return null;
  const az = surface ? surfaceAzimuth(def, surface) : def.focus.az;
  const el = def.focus.el;
  // target = the centre of the region's bounds: for a limb segment that is the limb axis, so the camera frames the whole
  // segment rather than an arbitrary point on its circumference (`surf.center` is a representative surface point, used
  // for markers / labels, NOT for framing).
  const target = surf.bounds.getCenter(new THREE.Vector3());
  const d = distanceToFit(Math.max(surf.radius, 0.045), def.focus.fill, aspect);
  return { target, position: target.clone().addScaledVector(directionFromAz(az, el), d) };
}

/** Focus keys: one region `id`, one surface `id#surface`, or SEVERAL regions `a+b+c` (multi-region treatment / follow-up). */
export const MULTI_SEP = "+";
export const multiFocusKey = (ids: readonly string[]): string => ids.join(MULTI_SEP);
export function parseFocusKey(key: string): { ids: string[]; surface?: SurfaceId } {
  if (key.includes(MULTI_SEP)) return { ids: key.split(MULTI_SEP).filter(Boolean) };
  const [id, surf] = key.split("#");
  return { ids: [id], surface: (surf as SurfaceId) || undefined };
}

/**
 * Pose that frames SEVERAL regions together (e.g. left_cheek + right_cheek): the target is the centre of the union of
 * their bounds, the distance fits the union, and the viewing direction is the average of the regions' own focus
 * directions (falling back to the first region's when they face opposite ways). Regions the asset lacks are ignored;
 * `null` when none is present. One region -> exactly `regionPose`.
 */
export function regionsPose(asset: BodyAsset, regionIds: readonly string[], aspect: number): CameraPose | null {
  const present = Array.from(new Set(regionIds)).filter((id) => getRegion(id) && asset.regions.get(id));
  if (!present.length) return null;
  if (present.length === 1) return regionPose(asset, present[0], aspect);
  const box = new THREE.Box3();
  const dir = new THREE.Vector3();
  present.forEach((id) => {
    const def = getRegion(id)!;
    box.union(asset.regions.get(id)!.bounds);
    dir.add(directionFromAz(def.focus.az, def.focus.el));
  });
  if (dir.lengthSq() < 0.04) { const d0 = getRegion(present[0])!; directionFromAz(d0.focus.az, d0.focus.el, dir); }
  dir.normalize();
  const target = box.getCenter(new THREE.Vector3());
  const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.06);
  const d = distanceToFit(radius, 0.78, aspect);
  return { target, position: target.clone().addScaledVector(dir, d) };
}

/** Resolves ANY focus key (single, surface or multi) to a pose. */
export function focusPose(asset: BodyAsset, key: string, aspect: number): CameraPose | null {
  const { ids, surface } = parseFocusKey(key);
  return ids.length > 1 ? regionsPose(asset, ids, aspect) : regionPose(asset, ids[0], aspect, surface);
}

export function limitsFor(asset: BodyAsset): Limits {
  return { minDistance: 0.22, maxDistance: asset.landmarks.height * 3.4 };
}

export interface Constraints extends Limits { minPolar: number; maxPolar: number }

/**
 * Orbit constraints per camera state. Body / region focus keep the full range. The Face and Scalp inspections are
 * intentionally tighter (you cannot dolly out into the next room, or swing below the chin) so the doctor cannot lose the
 * patient. `moving` (a scripted glide is running) always uses the loose range: a glide from Body to Face must never be
 * clamped half-way. The polar range never reaches 0 or PI, so the orbit can never flip upside-down.
 */
export function constraintsFor(asset: BodyAsset, state: CameraState, moving: boolean): Constraints {
  const base = limitsFor(asset);
  const loose: Constraints = { ...base, minPolar: 0.1, maxPolar: Math.PI - 0.1 };
  if (moving) return loose;
  const fr = asset.landmarks.faceRadius ?? asset.landmarks.headRadius;
  if (state === "FACE_OVERVIEW") return { minDistance: Math.max(0.16, fr * 0.9), maxDistance: Math.min(base.maxDistance, Math.max(1.6, fr * 9)), minPolar: 0.42, maxPolar: Math.PI / 2 + 0.5 };
  if (state === "SCALP_OVERVIEW") return { minDistance: Math.max(0.16, fr * 0.9), maxDistance: Math.min(base.maxDistance, Math.max(1.6, fr * 9)), minPolar: 0.08, maxPolar: Math.PI / 2 + 0.3 };
  return loose;
}

/** Reduced framing used by the entrance glide. */
export function entrancePose(asset: BodyAsset, view: ViewMode, aspect: number): CameraPose {
  const p = overviewPose(asset, view, "front", aspect);
  const off = p.position.clone().sub(p.target);
  return { target: p.target.clone(), position: p.target.clone().addScaledVector(off, 1.35) };
}
