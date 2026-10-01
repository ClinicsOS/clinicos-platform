import * as THREE from "three";

/**
 * Engine-level contracts. The clinical layer (registry ids) and the visual layer (meshes) only meet through
 * `RegionSurface` — a mesh is NEVER the clinical identity of anything.
 *
 * Canonical frame of every visual asset (procedural or GLB): +X = patient's LEFT, +Y up, +Z anterior,
 * origin on the floor between the feet, 1 unit = 1 metre. See public/models/derm/README.md.
 */
export type ModelKey = "male" | "female";
export type AssetSource = "procedural" | "glb";
export type ViewMode = "body" | "face" | "scalp";
/** `top` is a scalp-only preset (looking straight down onto the crown); the UI offers it in the Scalp view only. */
export type Facing = "front" | "back" | "left" | "right" | "top";
/** Adaptive render quality: desktop = high, tablet = medium, phone / low-memory = low. Never removes 3D. */
export type RenderQuality = "high" | "medium" | "low";

/** The part of the model that belongs to ONE anatomical region: used for the highlight AND for picking. */
export interface RegionSurface {
  regionId: string;
  /** Vertices in the asset's canonical (root) space, offset ~1.5 mm along the normals. Has attribute `aEdge`. */
  geometry: THREE.BufferGeometry;
  /** Object the overlay mesh is attached to (procedural: the asset root; GLB: the source mesh's parent). */
  parent: THREE.Object3D;
  /** A representative point ON the surface (nearest surface vertex to the region's centroid) + its outward normal. */
  center: THREE.Vector3;
  normal: THREE.Vector3;
  /** Axis-aligned bounds in canonical root space (used for camera framing and marker normalisation). */
  bounds: THREE.Box3;
  radius: number;
  triangleCount: number;
}

export interface Landmarks {
  height: number;
  /** Centre of the skull (canonical space). */
  head: THREE.Vector3;
  /** Approx. radius of the head+neck framing sphere. */
  headRadius: number;
  neckBase: THREE.Vector3;
  /** Optional framing hints from the asset (GLB manifest): the middle of the face (brow -> chin), and the framing radii of the Face / Scalp views. */
  faceCenter?: THREE.Vector3;
  faceRadius?: number;
  scalpRadius?: number;
}

export interface BodyAsset {
  key: ModelKey;
  source: AssetSource;
  /**
   * Visual-asset version (e.g. "derm-human-v1"). It identifies the ARTWORK only and is never part of a region id or of
   * any stored clinical record, so a future v2 model cannot change or orphan existing history.
   */
  modelVersion: string;
  root: THREE.Group;
  /** Materials that make up the visible skin (dimmed while a region is focused). */
  skinMaterials: THREE.Material[];
  regions: Map<string, RegionSurface>;
  landmarks: Landmarks;
  bounds: THREE.Box3;
  /** Registry regions this asset does not carry (GLB only) — they stay non-selectable in the 3D view. */
  unmappedRegions?: string[];
  /** Free every GPU resource owned by this asset. Never throws. */
  dispose(): void;
}

/** Where the assets came from — shown honestly in the UI (a development model is never presented as final art). */
export interface AssetStatus {
  source: AssetSource;
  modelVersion?: string;
  /** Present when a GLB was expected but could not be used (the procedural preview is shown instead). */
  fallbackReason?: string;
  /** GLB regions that the registry defines but the asset does not map (they stay non-selectable). */
  unmappedRegions?: string[];
}

export type CameraState = "BODY_OVERVIEW" | "FACE_OVERVIEW" | "SCALP_OVERVIEW" | "REGION_FOCUS" | "RESETTING";

export interface MarkerPoint {
  regionId: string;
  u: number;
  v: number;
  w: number;
}
