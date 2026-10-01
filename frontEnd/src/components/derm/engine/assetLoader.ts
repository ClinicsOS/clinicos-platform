import * as THREE from "three";
import { getRegion, REGION_IDS } from "@/lib/derm/regions";
import type { AssetStatus, BodyAsset, Landmarks, ModelKey, RegionSurface } from "./types";
import { addEdgeAttribute, finishSurface } from "./geometry";
import { buildProceduralBody } from "./bodyBuilder";
import { DERM_FALLBACK_ASSET_VERSION } from "@/lib/derm/modelVersion";

/**
 * Asset pipeline: GLB (production art) -> BodyAsset, with the procedural development body as the honest fallback.
 *
 * THE CONTRACT (full text in public/models/derm/README.md):
 *  - The clinical identity of a region is ONLY its registry id. A GLB mesh name is a private detail of that file and is
 *    translated to registry ids exclusively through `manifest.json` -> `models.<male|female>.regions`.
 *    Nothing outside this file ever sees a mesh name; nothing is ever stored under one.
 *  - Canonical frame: +X = patient LEFT, +Y up, +Z anterior, origin on the floor, 1 unit = 1 m.
 *  - The loader REJECTS an asset whose left_* regions are not on +X (a mirrored asset would silently swap the patient's
 *    left and right — the one error this module must never allow). A rejected asset falls back to the procedural body
 *    and the UI says so.
 */

export interface ManifestModel {
  /** Path relative to the manifest. `null` = no production asset delivered yet (the procedural body is used). */
  file: string | null;
  /** Artwork version, e.g. "derm-human-v1". Identifies the ART only — never part of a region id or a stored record. */
  modelVersion?: string;
  /** Names of the visible skin meshes. Every mesh NOT listed here and not mapped to a region is hidden. */
  skinMeshes?: string[];
  /**
   * Visible meshes that are pure decoration (hair, eyelashes, jewellery…). They are displayed but NEVER block picking,
   * so decorative hair can never make the scalp unselectable. Must not be listed in `regions`.
   */
  decorMeshes?: string[];
  /** registry region id -> mesh name(s) that make up that region's surface. */
  regions?: Record<string, string[]>;
  /** Optional overrides (canonical space, metres). Computed from the bounds when omitted. */
  landmarks?: {
    head: [number, number, number]; headRadius: number; neckBase: [number, number, number];
    /** Framing hints for the Face / Scalp views (all optional). */
    faceCenter?: [number, number, number]; faceRadius?: number; scalpRadius?: number;
  };
}
export interface Manifest {
  version: 1;
  models: Record<ModelKey, ManifestModel>;
}

export const DEFAULT_MANIFEST_URL = "/models/derm/manifest.json";

export function validateManifest(x: unknown): { ok: true; manifest: Manifest } | { ok: false; reason: string } {
  const m = x as Manifest | null;
  if (!m || typeof m !== "object" || m.version !== 1 || !m.models) return { ok: false, reason: "manifest: unsupported version" };
  for (const k of ["male", "female"] as const) {
    const e = m.models[k];
    if (!e || typeof e !== "object") return { ok: false, reason: `manifest: missing model "${k}"` };
    if (e.file !== null && typeof e.file !== "string") return { ok: false, reason: `manifest: ${k}.file must be a string or null` };
    if (e.modelVersion !== undefined && (typeof e.modelVersion !== "string" || !/^[A-Za-z0-9._-]{1,40}$/.test(e.modelVersion))) return { ok: false, reason: `manifest: ${k}.modelVersion is invalid` };
    if (e.decorMeshes !== undefined && (!Array.isArray(e.decorMeshes) || e.decorMeshes.some((n) => typeof n !== "string"))) return { ok: false, reason: `manifest: ${k}.decorMeshes must be an array of mesh names` };
    for (const id of Object.keys(e.regions ?? {})) {
      if (!getRegion(id)) return { ok: false, reason: `manifest: unknown region id "${id}" in ${k}.regions` };
      const names = e.regions![id];
      if (!Array.isArray(names) || names.length === 0 || names.some((n) => typeof n !== "string")) return { ok: false, reason: `manifest: ${k}.regions.${id} must be a non-empty array of mesh names` };
    }
  }
  return { ok: true, manifest: m };
}

function mergeRegionGeometry(meshes: THREE.Mesh[], root: THREE.Object3D): { geo: THREE.BufferGeometry; tris: number } | null {
  const P: number[] = [], N: number[] = [], I: number[] = [];
  const OFFSET = 0.0015;
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3(), n = new THREE.Vector3();
  let tris = 0;
  for (const mesh of meshes) {
    const g = mesh.geometry as THREE.BufferGeometry;
    if (!g.getAttribute("position")) continue;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    m.multiplyMatrices(inv, mesh.matrixWorld);
    nm.getNormalMatrix(m);
    const pos = g.getAttribute("position"), nor = g.getAttribute("normal"), idx = g.getIndex();
    const count = idx ? idx.count : pos.count;
    // COMPACT: only the vertices this region's triangles actually use are copied. A region mesh may share one big vertex
    // buffer with the visible skin (index-only hit meshes) — copying the whole buffer per region would multiply memory by
    // the number of regions and would also make the region bounds / centre meaningless.
    const remap = new Map<number, number>();
    for (let i = 0; i < count; i++) {
      const src = idx ? idx.getX(i) : i;
      let dst = remap.get(src);
      if (dst === undefined) {
        dst = P.length / 3;
        remap.set(src, dst);
        v.fromBufferAttribute(pos, src).applyMatrix4(m);
        n.fromBufferAttribute(nor, src).applyMatrix3(nm).normalize();
        P.push(v.x + n.x * OFFSET, v.y + n.y * OFFSET, v.z + n.z * OFFSET);
        N.push(n.x, n.y, n.z);
      }
      I.push(dst);
    }
    tris += count / 3;
  }
  if (!tris) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  geo.setIndex(I);
  addEdgeAttribute(geo);
  return { geo, tris };
}

/**
 * Pure: turns a loaded glTF scene into a BodyAsset following the manifest. Throws `AssetRejected` (with a human
 * readable reason) when the asset violates the contract. No DOM, no network -> unit-testable.
 */
export class AssetRejected extends Error {}

export function buildAssetFromScene(key: ModelKey, scene: THREE.Object3D, entry: ManifestModel): BodyAsset {
  // Everything below is expressed in the space of `root` (the scene's own transform is part of the asset): the bounds,
  // the region geometry and the left/right guard must all use the SAME space, or a mirrored scene would slip through.
  const root = new THREE.Group();
  root.name = `derm-body-${key}-glb`;
  root.add(scene);
  root.updateMatrixWorld(true);
  const byName = new Map<string, THREE.Mesh>();
  scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) byName.set(o.name, o as THREE.Mesh); });
  const bounds = new THREE.Box3().setFromObject(root);
  const height = bounds.max.y - Math.min(0, bounds.min.y);
  if (!(height > 0.5 && height < 2.6)) throw new AssetRejected(`asset height ${height.toFixed(2)} m is outside 0.5–2.6 m (the asset must be in metres)`);
  if (Math.abs(bounds.min.y) > 0.08) throw new AssetRejected(`asset origin must be on the floor (min.y = ${bounds.min.y.toFixed(2)} m)`);

  const regions = new Map<string, RegionSurface>();
  const unmapped: string[] = [];
  const regionMeshNames = new Set<string>();
  for (const id of REGION_IDS) {
    const names = entry.regions?.[id];
    if (!names) { unmapped.push(id); continue; }
    const meshes = names.map((n) => byName.get(n)).filter((m): m is THREE.Mesh => !!m);
    if (meshes.length !== names.length) throw new AssetRejected(`region "${id}" maps to a mesh that is not in the file`);
    names.forEach((n) => regionMeshNames.add(n));
    const merged = mergeRegionGeometry(meshes, root);
    if (!merged) throw new AssetRejected(`region "${id}" has no triangles`);
    regions.set(id, finishSurface(id, merged.geo, root, merged.tris));
  }
  if (regions.size === 0) throw new AssetRejected("the manifest maps no regions");

  // LEFT/RIGHT guard: a mirrored asset would swap the patient's sides silently. Reject it.
  regions.forEach((s, id) => {
    const side = getRegion(id)!.side;
    const cx = s.bounds.getCenter(new THREE.Vector3()).x;
    if (side === "left" && cx <= 0) throw new AssetRejected(`"${id}" is not on the +X side — the asset is mirrored (left must be +X)`);
    if (side === "right" && cx >= 0) throw new AssetRejected(`"${id}" is not on the -X side — the asset is mirrored (right must be -X)`);
  });

  const decorNames = new Set(entry.decorMeshes ?? []);
  decorNames.forEach((n) => { if (regionMeshNames.has(n)) throw new AssetRejected(`mesh "${n}" cannot be both a region surface and decoration`); });
  const skinNames = new Set(entry.skinMeshes ?? []);
  const skinMaterials: THREE.Material[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const isDecor = decorNames.has(mesh.name);
    const visible = isDecor || (skinNames.size ? skinNames.has(mesh.name) : true);
    mesh.visible = visible;
    // Decoration (hair…) is shown but never occludes a region pick: the engine skips it when it builds its occluder list.
    mesh.userData.noOcclude = isDecor;
    if (visible && !isDecor) for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (!skinMaterials.includes(mat)) skinMaterials.push(mat);
  });

  const h = height;
  const lm = entry.landmarks;
  const landmarks: Landmarks = lm
    ? {
      height: h, head: new THREE.Vector3(...lm.head), headRadius: lm.headRadius, neckBase: new THREE.Vector3(...lm.neckBase),
      ...(lm.faceCenter ? { faceCenter: new THREE.Vector3(...lm.faceCenter) } : {}),
      ...(lm.faceRadius ? { faceRadius: lm.faceRadius } : {}),
      ...(lm.scalpRadius ? { scalpRadius: lm.scalpRadius } : {}),
    }
    : { height: h, head: new THREE.Vector3(0, h * 0.93, 0.01), headRadius: h * 0.075, neckBase: new THREE.Vector3(0, h * 0.84, 0) };

  const geos: THREE.BufferGeometry[] = [];
  regions.forEach((r) => geos.push(r.geometry));
  return {
    key, source: "glb", modelVersion: entry.modelVersion ?? "unversioned", root, skinMaterials, regions, landmarks, bounds,
    dispose() {
      try {
        geos.forEach((g) => g.dispose());
        scene.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry?.dispose();
          for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) mat?.dispose();
        });
      } catch { /* never throws */ }
    },
    unmappedRegions: unmapped,
  };
}

export interface LoadedAsset { asset: BodyAsset; status: AssetStatus }

/**
 * Loads the asset for `key`. Order: production GLB (when the manifest delivers one and it passes the contract) ->
 * procedural development body. NEVER throws: every failure degrades to the procedural body plus a `fallbackReason`.
 */
export async function loadAsset(key: ModelKey, opts: { manifestUrl?: string; signal?: AbortSignal } = {}): Promise<LoadedAsset> {
  const fallback = (reason?: string): LoadedAsset => ({ asset: buildProceduralBody(key), status: { source: "procedural", modelVersion: DERM_FALLBACK_ASSET_VERSION, fallbackReason: reason } });
  const url = opts.manifestUrl ?? DEFAULT_MANIFEST_URL;
  let manifest: Manifest;
  try {
    const res = await fetch(url, { signal: opts.signal, cache: "no-cache" });
    if (!res.ok) return fallback(); // no manifest deployed: a plain development install, not an error
    const v = validateManifest(await res.json());
    if (!v.ok) return fallback(v.reason);
    manifest = v.manifest;
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return fallback();
  }
  const entry = manifest.models[key];
  if (!entry.file) return fallback(); // asset not delivered yet -> procedural, shown as "development model"
  try {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const fileUrl = new URL(entry.file, new URL(url, typeof location !== "undefined" ? location.href : "http://localhost")).toString();
    // Meshopt-compressed GLBs (gltfpack / gltf-transform) work out of the box: the decoder ships inside three.js, no
    // extra files to host. Draco / KTX2 need separately hosted decoders and are intentionally NOT enabled (see README).
    const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(fileUrl);
    const asset = buildAssetFromScene(key, gltf.scene, entry);
    return { asset, status: { source: "glb", modelVersion: asset.modelVersion, unmappedRegions: asset.unmappedRegions } };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return fallback(e instanceof Error ? e.message : "The 3D model file could not be loaded");
  }
}
