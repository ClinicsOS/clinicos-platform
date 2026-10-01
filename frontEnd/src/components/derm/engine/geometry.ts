import * as THREE from "three";
import type { RegionSurface } from "./types";

/**
 * Small, dependency-free geometry toolkit shared by the procedural preview body and the GLB loader.
 * Pure three.js geometry — no DOM, no WebGL — so it can be unit-tested in Node.
 */

/** Smooth 1-D profile through monotone keys `[x, v1, v2, ...]` (Catmull-Rom). Returns f(x) -> [v1, v2, ...]. */
export function makeProfile(keys: number[][]): (x: number) => number[] {
  const dim = keys[0].length - 1;
  const xs = keys.map((k) => k[0]);
  const curves = Array.from({ length: dim }, (_, d) => {
    // Independent variable on the first axis keeps the curve a function of x; sample densely, invert linearly.
    const c = new THREE.CatmullRomCurve3(keys.map((k) => new THREE.Vector3(k[0], k[d + 1], 0)), false, "centripetal");
    const pts = c.getSpacedPoints(Math.max(120, keys.length * 40));
    pts.sort((p, q) => p.x - q.x);
    return pts;
  });
  return (x: number) => {
    const xc = Math.min(xs[xs.length - 1], Math.max(xs[0], x));
    return curves.map((pts) => {
      let lo = 0, hi = pts.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].x <= xc) lo = mid; else hi = mid; }
      const a = pts[lo], b = pts[hi];
      const t = b.x === a.x ? 0 : (xc - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    });
  };
}

export interface Ring {
  c: THREE.Vector3; // centre
  a: THREE.Vector3; // unit axis of semi-axis rx
  b: THREE.Vector3; // unit axis of semi-axis rz
  rx: number;
  rz: number;
  s: number; // application-defined parameter along the part (metres along a limb, y for a torso, ...)
  /** Super-ellipse exponent (2 = ellipse, >2 = boxier). Default 2. */
  e?: number;
}

export interface PartMesh {
  positions: number[];
  indices: number[];
  /** Per-triangle parameter (average of the two rings) — used to assign regions along limbs. */
  triS: number[];
  /** Optional per-vertex linear RGB (3 floats per vertex) — subtle skin detail (lips, brows...). */
  colors?: number[];
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Piece-wise linear lookup through monotone keys `[x, y]`. */
export function lerpTable(keys: number[][], x: number): number {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) { const a = keys[i - 1], b = keys[i]; return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1); }
  }
  return keys[keys.length - 1][1];
}

const sgnPow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);

/**
 * Generic lofted grid: `rows` x `seg` vertices from `fn(row, col)`; seam is welded (col wraps), winding fixed outward.
 * `sOf(row)` is the per-row parameter recorded per triangle.
 */
export function gridLoft(rows: number, seg: number, fn: (i: number, j: number) => [number, number, number], sOf: (i: number) => number): PartMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const triS: number[] = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < seg; j++) { const p = fn(i, j); positions.push(p[0], p[1], p[2]); }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
      indices.push(a, c, b, b, c, d);
      const s = (sOf(i) + sOf(i + 1)) / 2;
      triS.push(s, s);
    }
  }
  const part = { positions, indices, triS };
  orientOutward(part);
  return part;
}

/** Super-ellipse point for angle `th`: x along sin, z along cos. */
export function superEllipse(th: number, e: number): [number, number] {
  const p = 2 / e;
  return [sgnPow(Math.sin(th), p), sgnPow(Math.cos(th), p)];
}

/**
 * Extends a ring list with rounded (elliptical-dome) end caps so the tube is a closed solid. The dome direction is the
 * local tangent of the path, `capLen` metres long, made of `steps` rings shrinking to a point.
 */
export function withCaps(rings: Ring[], capStart: number, capEnd: number, steps = 5): Ring[] {
  const out = rings.slice();
  const tan = (i: number, j: number) => rings[j].c.clone().sub(rings[i].c).normalize();
  if (capEnd > 0) {
    const e = rings[rings.length - 1], T = tan(rings.length - 2, rings.length - 1);
    for (let k = 1; k <= steps; k++) {
      const f = (k / steps) * (Math.PI / 2);
      out.push({ c: e.c.clone().addScaledVector(T, Math.sin(f) * capEnd), a: e.a, b: e.b, rx: e.rx * Math.cos(f), rz: e.rz * Math.cos(f), s: e.s, e: e.e });
    }
  }
  if (capStart > 0) {
    const e = rings[0], T = tan(1, 0);
    const pre: Ring[] = [];
    for (let k = 1; k <= steps; k++) {
      const f = (k / steps) * (Math.PI / 2);
      pre.unshift({ c: e.c.clone().addScaledVector(T, Math.sin(f) * capStart), a: e.a, b: e.b, rx: e.rx * Math.cos(f), rz: e.rz * Math.cos(f), s: e.s, e: e.e });
    }
    return [...pre, ...out];
  }
  return out;
}

/** Lofts an elliptical tube through `rings` (`seg` vertices per ring). Winding is fixed so normals point outward. */
export function loft(rings: Ring[], seg: number): PartMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  const triS: number[] = [];
  for (const r of rings) {
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2;
      const ca = (r.e && r.e !== 2 ? sgnPow(Math.cos(th), 2 / r.e) : Math.cos(th)) * r.rx;
      const sb = (r.e && r.e !== 2 ? sgnPow(Math.sin(th), 2 / r.e) : Math.sin(th)) * r.rz;
      positions.push(r.c.x + r.a.x * ca + r.b.x * sb, r.c.y + r.a.y * ca + r.b.y * sb, r.c.z + r.a.z * ca + r.b.z * sb);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * seg + j, b = i * seg + ((j + 1) % seg), c = (i + 1) * seg + j, d = (i + 1) * seg + ((j + 1) % seg);
      indices.push(a, c, b, b, c, d);
      const s = (rings[i].s + rings[i + 1].s) / 2;
      triS.push(s, s);
    }
  }
  const part = { positions, indices, triS };
  orientOutward(part);
  return part;
}

/** Flips all triangles if the closed mesh has negative signed volume (inside-out). */
export function orientOutward(p: { positions: number[]; indices: number[] }) {
  let vol = 0;
  const P = p.positions;
  for (let i = 0; i < p.indices.length; i += 3) {
    const a = p.indices[i] * 3, b = p.indices[i + 1] * 3, c = p.indices[i + 2] * 3;
    vol += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  if (vol < 0) for (let i = 0; i < p.indices.length; i += 3) { const t = p.indices[i + 1]; p.indices[i + 1] = p.indices[i + 2]; p.indices[i + 2] = t; }
}

/** Sphere-like part from a THREE geometry (positions/index copied) with per-vertex transform. */
export function fromGeometry(g: THREE.BufferGeometry, map: (v: THREE.Vector3, i: number) => void): PartMesh {
  const pos = g.getAttribute("position");
  const v = new THREE.Vector3();
  const positions: number[] = [];
  for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); map(v, i); positions.push(v.x, v.y, v.z); }
  const indices = Array.from(g.getIndex()!.array as ArrayLike<number>);
  const part = { positions, indices, triS: new Array(indices.length / 3).fill(0) };
  orientOutward(part);
  return part;
}

export interface MergedBody {
  geometry: THREE.BufferGeometry;
  /** For every triangle of `geometry`: index of the part it came from. */
  triPart: Int16Array;
  triS: Float32Array;
}

export function mergeParts(parts: PartMesh[], baseColor: [number, number, number] = [1, 1, 1]): MergedBody {
  let vCount = 0, iCount = 0;
  parts.forEach((p) => { vCount += p.positions.length / 3; iCount += p.indices.length; });
  const positions = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);
  const index = new Uint32Array(iCount);
  const triPart = new Int16Array(iCount / 3);
  const triS = new Float32Array(iCount / 3);
  let vo = 0, io = 0, to = 0;
  parts.forEach((p, pi) => {
    positions.set(p.positions, vo * 3);
    if (p.colors) colors.set(p.colors, vo * 3);
    else for (let v = 0; v < p.positions.length / 3; v++) colors.set(baseColor, (vo + v) * 3);
    for (let i = 0; i < p.indices.length; i++) index[io + i] = p.indices[i] + vo;
    for (let t = 0; t < p.indices.length / 3; t++) { triPart[to + t] = pi; triS[to + t] = p.triS[t] ?? 0; }
    vo += p.positions.length / 3; io += p.indices.length; to += p.indices.length / 3;
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  return { geometry, triPart, triS };
}

// ---------------------------------------------------------------- region surfaces

const KEY_Q = 1e5;
const posKey = (x: number, y: number, z: number) => `${Math.round(x * KEY_Q)},${Math.round(y * KEY_Q)},${Math.round(z * KEY_Q)}`;

/**
 * Adds attribute `aEdge` (1 on vertices lying on the OPEN BOUNDARY of the geometry, else 0). Boundary detection is by
 * POSITION (not by index) so seams between duplicated vertices are not mistaken for boundaries. The overlay shader
 * interpolates it to draw a soft outline around a selected region.
 */
export function addEdgeAttribute(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute("position");
  const idx = geo.getIndex();
  const count = pos.count;
  const keyOf: string[] = new Array(count);
  for (let i = 0; i < count; i++) keyOf[i] = posKey(pos.getX(i), pos.getY(i), pos.getZ(i));
  const triCount = idx ? idx.count / 3 : count / 3;
  const edgeUse = new Map<string, number>();
  const ek = (a: string, b: string) => (a < b ? a + "|" + b : b + "|" + a);
  const at = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  for (let t = 0; t < triCount; t++) {
    const k0 = keyOf[at(t, 0)], k1 = keyOf[at(t, 1)], k2 = keyOf[at(t, 2)];
    for (const e of [ek(k0, k1), ek(k1, k2), ek(k2, k0)]) edgeUse.set(e, (edgeUse.get(e) ?? 0) + 1);
  }
  const boundary = new Set<string>();
  for (let t = 0; t < triCount; t++) {
    const ks = [keyOf[at(t, 0)], keyOf[at(t, 1)], keyOf[at(t, 2)]];
    for (let e = 0; e < 3; e++) {
      const a = ks[e], b = ks[(e + 1) % 3];
      if (a !== b && edgeUse.get(ek(a, b)) === 1) { boundary.add(a); boundary.add(b); }
    }
  }
  const edge = new Float32Array(count);
  for (let i = 0; i < count; i++) edge[i] = boundary.has(keyOf[i]) ? 1 : 0;
  geo.setAttribute("aEdge", new THREE.BufferAttribute(edge, 1));
}

/**
 * Builds one `RegionSurface` per region from a merged skin geometry and a per-triangle region assignment
 * (`triRegion[t]` = index into `regionIds`, -1 = unmapped). Each region gets its own compact geometry (its vertices only,
 * pushed 1.5 mm out along the normals) with correct bounds, so raycasts against it reject quickly.
 */
export function buildRegionSurfaces(
  skin: THREE.BufferGeometry,
  triRegion: Int16Array,
  regionIds: readonly string[],
  parent: THREE.Object3D
): Map<string, RegionSurface> {
  const pos = skin.getAttribute("position");
  const nor = skin.getAttribute("normal");
  const idx = skin.getIndex()!;
  const buckets = new Map<number, number[]>();
  for (let t = 0; t < triRegion.length; t++) {
    const r = triRegion[t];
    if (r < 0) continue;
    let b = buckets.get(r);
    if (!b) buckets.set(r, (b = []));
    b.push(t);
  }
  const out = new Map<string, RegionSurface>();
  const OFFSET = 0.0015;
  buckets.forEach((tris, r) => {
    const remap = new Map<number, number>();
    const p: number[] = [];
    const n: number[] = [];
    const ind: number[] = [];
    const tmp = new THREE.Vector3();
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const vi = idx.getX(t * 3 + k);
        let ni = remap.get(vi);
        if (ni === undefined) {
          ni = p.length / 3;
          remap.set(vi, ni);
          tmp.set(nor.getX(vi), nor.getY(vi), nor.getZ(vi));
          p.push(pos.getX(vi) + tmp.x * OFFSET, pos.getY(vi) + tmp.y * OFFSET, pos.getZ(vi) + tmp.z * OFFSET);
          n.push(tmp.x, tmp.y, tmp.z);
        }
        ind.push(ni);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(n, 3));
    geo.setIndex(ind);
    addEdgeAttribute(geo);
    out.set(regionIds[r], finishSurface(regionIds[r], geo, parent, tris.length));
  });
  return out;
}

/** Computes bounds / radius / a representative on-surface point + normal for a region geometry. */
export function finishSurface(regionId: string, geo: THREE.BufferGeometry, parent: THREE.Object3D, triangleCount: number): RegionSurface {
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const bounds = geo.boundingBox!.clone();
  const p = geo.getAttribute("position"), n = geo.getAttribute("normal");
  const centroid = bounds.getCenter(new THREE.Vector3());
  // representative point: the surface vertex nearest to the centroid (a region can be curved — the centroid may float)
  let best = 0, bd = Infinity;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const d = v.distanceToSquared(centroid); if (d < bd) { bd = d; best = i; } }
  const center = new THREE.Vector3().fromBufferAttribute(p, best);
  const normal = n ? new THREE.Vector3().fromBufferAttribute(n, best).normalize() : new THREE.Vector3(0, 0, 1);
  return { regionId, geometry: geo, parent, center, normal, bounds, radius: geo.boundingSphere!.radius, triangleCount };
}
