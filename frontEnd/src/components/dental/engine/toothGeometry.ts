import * as THREE from "three";
import type { ToothMeta, ToothFamily } from "@/lib/dental/fdi";

/**
 * PLACEHOLDER tooth geometry — NOT an anatomically accurate model and not a licensed asset.
 * It is a procedural loft that gives each of the four tooth families a visibly different
 * silhouette; it exists so professional GLB/GLTF geometry can replace it later through the
 * `ToothMeshProvider` seam (see toothVisual.ts) without touching selection/hover/camera/state.
 *
 * TOOTH-LOCAL FRAME (the contract a future GLB must also follow):
 *   origin = cemento-enamel junction (CEJ) centre
 *   +Y = toward the biting surface (crown up, root down)
 *   +Z = facial (buccal/labial) direction
 *   +X = mesio-distal axis
 * 1 unit ~= 10 mm.
 */

export interface ToothDims {
  w: number; // mesio-distal crown width
  h: number; // crown wall height, CEJ -> rim
  d: number; // bucco-lingual depth
  rootLen: number;
  rise: number; // cusp / incisal-edge height above the rim
  tip: number; // h + rise : CEJ -> highest point of the crown
}

export interface ToothMeshSource {
  crown: THREE.BufferGeometry;
  roots: THREE.BufferGeometry[];
  dims: ToothDims;
}
export type ToothMeshProvider = (meta: ToothMeta) => ToothMeshSource;

// ---- per-position sizes (index 0 = position 1 = central incisor) ----
const UPPER = {
  w: [0.86, 0.66, 0.76, 0.7, 0.66, 1.02, 0.92, 0.86],
  h: [1.03, 0.9, 0.84, 0.68, 0.66, 0.55, 0.52, 0.48],
  d: [0.72, 0.66, 0.82, 0.92, 0.92, 1.1, 1.1, 1.0],
  r: [1.3, 1.2, 1.55, 1.3, 1.35, 1.25, 1.2, 1.05],
};
const LOWER = {
  w: [0.53, 0.59, 0.69, 0.71, 0.71, 1.1, 1.05, 1.0],
  h: [0.9, 0.95, 0.85, 0.68, 0.66, 0.55, 0.52, 0.48],
  d: [0.62, 0.66, 0.78, 0.8, 0.85, 1.05, 1.05, 1.0],
  r: [1.2, 1.3, 1.45, 1.35, 1.4, 1.25, 1.2, 1.05],
};
// Roots are placeholders that stay inside the gingiva; scaled so the alveolar band can stay proportionate.
const ROOT_VISUAL_SCALE = 0.72;
// PRIMARY dentition has its OWN sizes (units of 10mm) — it is NOT the permanent set scaled down, and it has NO premolars.
// index 0..4 = central incisor, lateral incisor, canine, first primary molar, second primary molar
const PRIMARY_UPPER = {
  w: [0.65, 0.51, 0.65, 0.7, 0.85],
  h: [0.58, 0.54, 0.5, 0.34, 0.36],
  d: [0.52, 0.45, 0.6, 0.82, 0.95],
  r: [1.0, 0.9, 1.15, 0.9, 0.9],
};
const PRIMARY_LOWER = {
  w: [0.42, 0.41, 0.5, 0.77, 0.99],
  h: [0.48, 0.5, 0.48, 0.38, 0.36],
  d: [0.42, 0.42, 0.55, 0.78, 0.9],
  r: [0.9, 0.95, 1.05, 0.95, 0.95],
};

type Key = readonly [t: number, a: number, bf: number, bl: number, n: number];
// Cross-section keyframes along crown height t (t=0 CEJ, t=1 rim, t<0 = trunk inside the gum).
// a = mesio-distal semi-axis, bf/bl = facial/lingual semi-axes, n = superellipse squareness.
const PROFILES: Record<ToothFamily, { w: number; h: number; d: number; keys: readonly Key[] }> = {
  // flat facial surface, wide MD / thin BL, cervical narrowing, thin incisal edge, squarish corners
  incisor: {
    w: 0.86, h: 1.03, d: 0.72,
    keys: [
      [-0.3, 0.27, 0.3, 0.32, 2.4], [0, 0.29, 0.34, 0.37, 2.4], [0.25, 0.35, 0.36, 0.36, 2.5],
      [0.55, 0.41, 0.32, 0.25, 2.8], [0.82, 0.43, 0.29, 0.16, 3.2], [1, 0.38, 0.27, 0.1, 3.0],
    ],
  },
  // strong crown, prominent facial convexity, one cusp
  canine: {
    w: 0.76, h: 0.84, d: 0.82,
    keys: [
      [-0.3, 0.29, 0.32, 0.34, 2.2], [0, 0.31, 0.36, 0.38, 2.2], [0.3, 0.36, 0.4, 0.35, 2.4],
      [0.62, 0.375, 0.4, 0.28, 2.6], [0.85, 0.34, 0.35, 0.2, 2.5], [1, 0.3, 0.3, 0.14, 2.3],
    ],
  },
  // broader BL than incisors, oval-rectangular occlusal outline, two cusps
  premolar: {
    w: 0.7, h: 0.68, d: 0.92,
    keys: [
      [-0.3, 0.28, 0.32, 0.32, 2.2], [0, 0.29, 0.34, 0.34, 2.2], [0.3, 0.34, 0.42, 0.4, 2.4],
      [0.7, 0.35, 0.46, 0.44, 2.6], [1, 0.33, 0.43, 0.41, 2.8],
    ],
  },
  // short, broad crown, large rounded-rectangular occlusal table, multi-cusp
  molar: {
    w: 1.02, h: 0.55, d: 1.1,
    keys: [
      [-0.3, 0.36, 0.42, 0.42, 2.6], [0, 0.41, 0.46, 0.46, 2.8], [0.3, 0.5, 0.55, 0.53, 3.0],
      [0.7, 0.52, 0.56, 0.53, 3.2], [1, 0.47, 0.5, 0.48, 3.2],
    ],
  },
};

// Primary crowns: shorter, more compact and rounder (lower superellipse exponent), with the pronounced cervical
// bulge/constriction typical of primary teeth. Three families only: incisor, canine, molar.
const PRIMARY_PROFILES: Record<"incisor" | "canine" | "molar", { w: number; h: number; d: number; keys: readonly Key[] }> = {
  incisor: {
    w: 0.65, h: 0.58, d: 0.52,
    keys: [
      [-0.3, 0.24, 0.24, 0.25, 2.3], [0, 0.25, 0.26, 0.28, 2.3], [0.2, 0.31, 0.29, 0.29, 2.3],
      [0.55, 0.325, 0.25, 0.19, 2.5], [0.85, 0.325, 0.22, 0.12, 2.8], [1, 0.3, 0.2, 0.09, 2.7],
    ],
  },
  canine: {
    w: 0.65, h: 0.5, d: 0.6,
    keys: [
      [-0.3, 0.24, 0.27, 0.28, 2.1], [0, 0.25, 0.29, 0.31, 2.1], [0.22, 0.31, 0.33, 0.3, 2.2],
      [0.6, 0.325, 0.31, 0.24, 2.3], [0.85, 0.29, 0.26, 0.18, 2.2], [1, 0.25, 0.22, 0.12, 2.1],
    ],
  },
  molar: {
    w: 0.85, h: 0.36, d: 0.95,
    keys: [
      [-0.3, 0.31, 0.36, 0.36, 2.5], [0, 0.34, 0.4, 0.4, 2.6], [0.25, 0.42, 0.49, 0.46, 2.7],
      [0.7, 0.425, 0.475, 0.45, 2.9], [1, 0.38, 0.42, 0.4, 2.9],
    ],
  },
};
const profileFor = (m: ToothMeta) =>
  m.dentition === "primary" ? PRIMARY_PROFILES[m.family as "incisor" | "canine" | "molar"] : PROFILES[m.family];

const primaryCusps = (position: number, upper: boolean): Array<[number, number, number]> => {
  const k = 0.8; // primary cusps are lower
  const list: Array<[number, number, number]> =
    position === 4
      ? upper
        ? [[-0.5, 0.5, 0.2], [0.5, 0.5, 0.17], [-0.35, -0.5, 0.2]] // first primary molar (upper): 3 main cusps
        : [[-0.55, 0.5, 0.2], [0.05, 0.5, 0.17], [-0.55, -0.5, 0.2], [0.3, -0.5, 0.17]] // (lower): elongated, 4 cusps
      : upper
      ? [[-0.5, 0.52, 0.2], [0.5, 0.52, 0.18], [-0.5, -0.52, 0.22], [0.5, -0.52, 0.16]] // second primary molar (upper)
      : [[-0.62, 0.5, 0.18], [0, 0.56, 0.17], [0.62, 0.5, 0.15], [-0.4, -0.5, 0.2], [0.4, -0.5, 0.18]]; // (lower): 5 cusps
  return list.map(([a, b, h]) => [a, b, h * k]);
};

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const gauss = (u: number, v: number, cu: number, cv: number, su: number, sv: number) =>
  Math.exp(-(((u - cu) / su) ** 2 + ((v - cv) / sv) ** 2));

function sampleKeys(keys: readonly Key[], t: number) {
  if (t <= keys[0][0]) return { a: keys[0][1], bf: keys[0][2], bl: keys[0][3], n: keys[0][4] };
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i], k1 = keys[i + 1];
    if (t <= k1[0]) {
      const u = sstep(0, 1, (t - k0[0]) / (k1[0] - k0[0]));
      const l = (x: number, y: number) => x + (y - x) * u;
      return { a: l(k0[1], k1[1]), bf: l(k0[2], k1[2]), bl: l(k0[3], k1[3]), n: l(k0[4], k1[4]) };
    }
  }
  const k = keys[keys.length - 1];
  return { a: k[1], bf: k[2], bl: k[3], n: k[4] };
}

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
};

/** Occlusal height field over the crown footprint; (u,v) in [-1,1]: u mesio-distal, v facial(+)/lingual(-). */
function makeOcclusal(meta: ToothMeta): (u: number, v: number) => number {
  const upper = meta.jaw === "upper";
  const seed = hash(meta.fdi);
  const marginal = (u: number, v: number, k: number) => k * sstep(0.5, 1, Math.abs(u)) * (1 - 0.4 * Math.abs(v));
  switch (meta.family) {
    case "incisor": // flat incisal edge
      return (u) => 0.03 * (1 - u * u);
    case "canine": { // ONE main cusp, blunt (not a fang); primary cusps are lower
      const k = meta.dentition === "primary" ? 0.7 : 1;
      return (u, v) => k * 0.22 * Math.pow(Math.max(0, 1 - (1.15 * u * u + 0.85 * v * v)), 1.15) + 0.02;
    }
    case "premolar": {
      const buccal = upper ? 0.26 : 0.24;
      const lingual = upper ? 0.19 : meta.position === 4 ? 0.08 : 0.16;
      return (u, v) =>
        buccal * gauss(u, v, 0, 0.5, 0.6, 0.42) +
        lingual * gauss(u, v, 0, -0.5, 0.6, 0.42) -
        0.05 * Math.exp(-((v / 0.13) ** 2)) * (1 - sstep(0.65, 1, Math.abs(u))) + // central groove
        marginal(u, v, 0.07) + 0.02;
    }
    case "molar": {
      const s = (n: number) => (meta.isThirdMolar ? 0.85 + 0.3 * ((seed * n * 7) % 1) : 1); // 3rd molar: irregular
      let cusps: Array<[number, number, number]>;
      if (meta.dentition === "primary") cusps = primaryCusps(meta.position, upper);
      else if (meta.isThirdMolar) cusps = [[-0.5, 0.5, 0.18 * s(1)], [0.5, 0.42, 0.15 * s(2)], [0, -0.5, 0.2 * s(3)]];
      else if (!upper && meta.position === 6)
        cusps = [[-0.62, 0.5, 0.2], [0, 0.56, 0.19], [0.62, 0.5, 0.17], [-0.4, -0.5, 0.22], [0.4, -0.5, 0.2]]; // 5-cusp lower M1
      else if (upper) cusps = [[-0.5, 0.52, 0.24], [0.5, 0.52, 0.21], [-0.5, -0.52, 0.26], [0.5, -0.52, 0.19]];
      else cusps = [[-0.5, 0.52, 0.22], [0.5, 0.52, 0.2], [-0.5, -0.52, 0.22], [0.5, -0.52, 0.2]];
      const su = cusps.length === 5 ? 0.34 : 0.42;
      return (u, v) => {
        let h = 0.03 + marginal(u, v, 0.07);
        for (const [cu, cv, ch] of cusps) h += ch * gauss(u, v, cu, cv, su, 0.42);
        h -= 0.05 * Math.exp(-((v / 0.11) ** 2)) * (1 - sstep(0.75, 1, Math.abs(u))); // central fissure
        h -= 0.045 * Math.exp(-((u / 0.11) ** 2)) * (1 - sstep(0.75, 1, Math.abs(v))); // cross fissure
        return Math.max(0, h);
      };
    }
  }
}

const dimsCache = new Map<string, ToothDims>();
export function toothDims(meta: ToothMeta): ToothDims {
  const hit = dimsCache.get(meta.fdi);
  if (hit) return hit;
  const primary = meta.dentition === "primary";
  const T = primary ? (meta.jaw === "upper" ? PRIMARY_UPPER : PRIMARY_LOWER) : meta.jaw === "upper" ? UPPER : LOWER;
  const i = meta.position - 1;
  const w = T.w[i], h = T.h[i], d = T.d[i], rootLen = T.r[i] * ROOT_VISUAL_SCALE;
  const prof = profileFor(meta);
  const occScale = Math.min(1.2, Math.max(0.7, (w / prof.w + d / prof.d) / 2));
  const occ = makeOcclusal(meta);
  let max = 0;
  for (let u = -1; u <= 1; u += 0.1) for (let v = -1; v <= 1; v += 0.1) if (u * u + v * v <= 1) max = Math.max(max, occ(u, v));
  const rise = max * occScale;
  const dims = { w, h, d, rootLen, rise, tip: h + rise };
  dimsCache.set(meta.fdi, dims);
  return dims;
}

// ---- lofting ----
const SEG = 28;
const CAP_ROWS = 8;
const CROWN_TS = [-0.3, -0.18, -0.07, 0.03, 0.14, 0.27, 0.42, 0.57, 0.72, 0.86];

function ringUV(theta: number, n: number) {
  const c = Math.cos(theta), s = Math.sin(theta), e = 2 / n;
  return { u: Math.sign(c) * Math.pow(Math.abs(c), e), v: Math.sign(s) * Math.pow(Math.abs(s), e) };
}

function buildGrid(rows: number[][]): THREE.BufferGeometry {
  const stride = SEG + 1;
  const positions = new Float32Array(rows.length * stride * 3);
  rows.forEach((r, i) => positions.set(r, i * stride * 3));
  const index: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let j = 0; j < SEG; j++) {
      const a = r * stride + j, b = a + 1, c = a + stride, d = c + 1;
      index.push(a, c, b, b, c, d); // outward-facing winding (verified in tests)
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  // Smooth the wrap-around seam and any collapsed (pole) rows so shading has no visible seam/pinch.
  const n = g.getAttribute("normal") as THREE.BufferAttribute;
  const tmp = new THREE.Vector3(), acc = new THREE.Vector3();
  for (let r = 0; r < rows.length; r++) {
    const i0 = r * stride, i1 = i0 + SEG;
    tmp.set(n.getX(i0) + n.getX(i1), n.getY(i0) + n.getY(i1), n.getZ(i0) + n.getZ(i1)).normalize();
    n.setXYZ(i0, tmp.x, tmp.y, tmp.z);
    n.setXYZ(i1, tmp.x, tmp.y, tmp.z);
    const row = rows[r];
    const mid = 3 * Math.floor(SEG / 2);
    const collapsed =
      Math.abs(row[0] - row[mid]) < 1e-9 && Math.abs(row[1] - row[mid + 1]) < 1e-9 && Math.abs(row[2] - row[mid + 2]) < 1e-9;
    if (collapsed) {
      acc.set(0, 0, 0);
      for (let j = 0; j <= SEG; j++) acc.add(tmp.set(n.getX(i0 + j), n.getY(i0 + j), n.getZ(i0 + j)));
      acc.normalize();
      for (let j = 0; j <= SEG; j++) n.setXYZ(i0 + j, acc.x, acc.y, acc.z);
    }
  }
  n.needsUpdate = true;
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

function buildCrown(meta: ToothMeta, dims: ToothDims): THREE.BufferGeometry {
  const prof = profileFor(meta);
  const sx = dims.w / prof.w, sz = dims.d / prof.d;
  const occScale = Math.min(1.2, Math.max(0.7, (dims.w / prof.w + dims.d / prof.d) / 2));
  const occ = makeOcclusal(meta);
  const rows: number[][] = [];

  const rowAt = (t: number) => {
    const k = sampleKeys(prof.keys, t);
    const a = k.a * sx, bf = k.bf * sz, bl = k.bl * sz;
    const row: number[] = [];
    for (let j = 0; j <= SEG; j++) {
      const { u, v } = ringUV((j / SEG) * Math.PI * 2, k.n);
      row.push(a * u, t * dims.h, (v > 0 ? bf : bl) * v);
    }
    return row;
  };
  for (const t of CROWN_TS) rows.push(rowAt(t));

  // Occlusal cap: rows shrink toward the centre while y follows the cusp height-field.
  const rim = sampleKeys(prof.keys, 1);
  const rimA = rim.a * sx, rimBf = rim.bf * sz, rimBl = rim.bl * sz;
  for (let k = 0; k <= CAP_ROWS; k++) {
    const s = 1 - k / CAP_ROWS;
    const row: number[] = [];
    for (let j = 0; j <= SEG; j++) {
      const { u, v } = ringUV((j / SEG) * Math.PI * 2, rim.n);
      const us = u * s, vs = v * s;
      row.push(rimA * us, dims.h + occ(us, vs) * occScale, (v > 0 ? rimBf : rimBl) * vs);
    }
    rows.push(row);
  }
  return buildGrid(rows);
}

interface RootSpec { x: number; z: number; a: number; b: number; len: number; cx: number; cz: number }

function rootSpecs(meta: ToothMeta, dims: ToothDims): RootSpec[] {
  const prof = profileFor(meta);
  const sx = dims.w / prof.w, sz = dims.d / prof.d;
  const trunk = sampleKeys(prof.keys, -0.3);
  const a0 = trunk.a * sx * 0.85, b0 = ((trunk.bf + trunk.bl) / 2) * sz * 0.85;
  const L = dims.rootLen;
  const upper = meta.jaw === "upper";
  const sp = meta.dentition === "primary" ? 2.4 : 1; // primary molar roots splay around the developing tooth germ
  if (meta.family === "molar" && !meta.isThirdMolar) {
    if (upper) // 3 roots: mesio-buccal, disto-buccal, palatal (longest)
      return [
        { x: -0.24 * dims.w, z: 0.22 * dims.d, a: a0 * 0.42, b: b0 * 0.5, len: L * 0.95, cx: -0.14 * sp, cz: 0 },
        { x: 0.24 * dims.w, z: 0.22 * dims.d, a: a0 * 0.4, b: b0 * 0.48, len: L * 0.92, cx: 0.14 * sp, cz: 0 },
        { x: 0, z: -0.26 * dims.d, a: a0 * 0.46, b: b0 * 0.5, len: L * 1.05, cx: 0, cz: -0.12 },
      ];
    return [ // lower: 2 broad roots (mesial, distal)
      { x: -0.26 * dims.w, z: 0, a: a0 * 0.5, b: b0 * 0.85, len: L, cx: -0.1 * sp, cz: 0 },
      { x: 0.26 * dims.w, z: 0, a: a0 * 0.46, b: b0 * 0.8, len: L * 0.95, cx: 0.1 * sp, cz: 0 },
    ];
  }
  if (meta.family === "premolar" && upper && meta.position === 4)
    return [
      { x: 0, z: 0.2 * dims.d, a: a0 * 0.62, b: b0 * 0.5, len: L * 0.9, cx: 0, cz: 0.08 },
      { x: 0, z: -0.2 * dims.d, a: a0 * 0.6, b: b0 * 0.48, len: L * 0.88, cx: 0, cz: -0.08 },
    ];
  const fused = meta.isThirdMolar ? 1.15 : 1;
  const curve = meta.family === "incisor" || meta.family === "canine" ? 0.06 : 0.04;
  return [{ x: 0, z: 0, a: a0 * fused * (meta.family === "canine" ? 1.05 : 0.92), b: b0 * (meta.family === "canine" ? 1.05 : 0.9), len: L, cx: curve, cz: 0 }];
}

function buildRoot(spec: RootSpec, y0: number): THREE.BufferGeometry {
  const rows: number[][] = [];
  const RR = 8;
  for (let i = 0; i <= RR; i++) {
    const t = i / RR;
    const shrink = Math.max(0.02, Math.pow(1 - t, 0.9) * (1 - 0.15 * t));
    const a = Math.max(0.012, spec.a * shrink), b = Math.max(0.012, spec.b * shrink);
    const row: number[] = [];
    for (let j = 0; j <= SEG; j++) {
      const { u, v } = ringUV((j / SEG) * Math.PI * 2, 2.3);
      row.push(spec.x + spec.cx * t * t + a * u, y0 - spec.len * t, spec.z + spec.cz * t * t + b * v);
    }
    rows.push(row);
  }
  return buildGrid(rows);
}

const meshCache = new Map<string, ToothMeshSource>();
/** The built-in placeholder provider. Swap for a GLB-backed provider to use professional models. */
export const placeholderToothProvider: ToothMeshProvider = (meta) => {
  const hit = meshCache.get(meta.fdi);
  if (hit) return hit;
  const dims = toothDims(meta);
  const y0 = -0.27 * dims.h;
  const src = { crown: buildCrown(meta, dims), roots: rootSpecs(meta, dims).map((r) => buildRoot(r, y0)), dims };
  meshCache.set(meta.fdi, src);
  return src;
};
