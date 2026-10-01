import * as THREE from "three";
import { REGION_IDS } from "@/lib/derm/regions";
import type { BodyAsset, Landmarks, ModelKey } from "./types";
import { DERM_FALLBACK_ASSET_VERSION } from "@/lib/derm/modelVersion";
import {
  buildRegionSurfaces, gridLoft, lerpTable, loft, makeProfile, mergeParts, smoothstep, superEllipse, withCaps,
  fromGeometry, type PartMesh, type Ring,
} from "./geometry";

/**
 * EMERGENCY FALLBACK body (male / female). NOT the production model.
 *
 * The normal view is the generated clinical human (public/models/derm/{male,female}.glb, built by scripts/derm-human and
 * loaded by assetLoader.ts). This simplified lofted mannequin is only used when that file cannot be loaded (missing,
 * corrupt, rejected by the contract) so the clinical map and every record stay reachable. It shares the same region
 * rules (regionRules.ts) and the same registry ids as the production model.
 *
 * Canonical frame: +X = patient's LEFT, +Y up, +Z anterior, origin on the floor, 1 unit = 1 metre.
 * Every left_* region is built from geometry at +X and every right_* region from geometry at -X — asserted by the tests.
 */

// ---------------------------------------------------------------------------------------------- specification
interface BodySpec {
  key: ModelKey;
  stature: number;
  headH: number;
  headZ: number;
  headWidth: number; // multiplier of the head half-width profile
  jaw: number; // multiplier of the lower-face width (female: softer jaw)
  /** [y, halfWidth, frontDepth, backDepth, exponent] */
  torso: number[][];
  bust: number;
  pecs: number;
  neck: { rx: number; rz: number; z: number };
  shoulderX: number; // |x| where the shoulder region starts
  armRoot: [number, number, number];
  upperArm: number;
  foreArm: number;
  abduct: number; // deg
  elbowFlex: number; // deg (forward)
  hand: number; // scale
  hipX: number;
  thigh: number;
  shin: number;
  legScale: number;
  footLen: number;
  skin: [number, number, number];
  // landmark heights for the torso classifier
  y: { crotch: number; troch: number; iliac: number; rib: number; armpit: number; shoulder: number; neckBase: number };
}

const MALE: BodySpec = {
  key: "male", stature: 1.78, headH: 0.235, headZ: 0.012, headWidth: 1, jaw: 1,
  torso: [
    [0.78, 0.02, 0.02, 0.02, 2.0], [0.795, 0.1, 0.06, 0.062, 2.2], [0.83, 0.15, 0.088, 0.092, 2.4], [0.9, 0.182, 0.1, 0.114, 2.3], [1.0, 0.168, 0.094, 0.104, 2.3],
    [1.1, 0.15, 0.088, 0.09, 2.3], [1.2, 0.16, 0.093, 0.098, 2.4], [1.3, 0.178, 0.104, 0.1, 2.5],
    [1.37, 0.19, 0.104, 0.096, 2.5], [1.42, 0.196, 0.096, 0.088, 2.3], [1.455, 0.178, 0.08, 0.078, 2.1],
    [1.48, 0.12, 0.07, 0.07, 2.0], [1.505, 0.068, 0.066, 0.064, 2.0], [1.525, 0.03, 0.03, 0.03, 2.0],
  ],
  bust: 0, pecs: 0.012,
  neck: { rx: 0.058, rz: 0.06, z: -0.008 },
  shoulderX: 0.152,
  armRoot: [0.192, 1.41, -0.004], upperArm: 0.3, foreArm: 0.262, abduct: 13, elbowFlex: 8, hand: 1,
  hipX: 0.092, thigh: 0.42, shin: 0.41, legScale: 1, footLen: 0.265,
  skin: [0.86, 0.72, 0.62],
  y: { crotch: 0.84, troch: 0.88, iliac: 1.02, rib: 1.2, armpit: 1.37, shoulder: 1.385, neckBase: 1.5 },
};

const FEMALE: BodySpec = {
  key: "female", stature: 1.65, headH: 0.222, headZ: 0.011, headWidth: 0.95, jaw: 0.9,
  torso: [
    [0.72, 0.02, 0.02, 0.02, 2.0], [0.735, 0.095, 0.06, 0.062, 2.2], [0.77, 0.14, 0.086, 0.092, 2.3], [0.84, 0.17, 0.098, 0.112, 2.2], [0.93, 0.178, 0.096, 0.112, 2.2],
    [1.03, 0.14, 0.086, 0.088, 2.2], [1.09, 0.122, 0.08, 0.08, 2.2], [1.17, 0.132, 0.088, 0.084, 2.3],
    [1.26, 0.148, 0.098, 0.088, 2.4], [1.32, 0.16, 0.092, 0.086, 2.4], [1.36, 0.17, 0.086, 0.08, 2.3],
    [1.385, 0.168, 0.076, 0.072, 2.1], [1.41, 0.11, 0.066, 0.064, 2.0], [1.435, 0.062, 0.058, 0.056, 2.0],
    [1.455, 0.03, 0.03, 0.03, 2.0],
  ],
  bust: 0.034, pecs: 0,
  neck: { rx: 0.047, rz: 0.05, z: -0.007 },
  shoulderX: 0.14,
  armRoot: [0.172, 1.335, -0.004], upperArm: 0.275, foreArm: 0.24, abduct: 12, elbowFlex: 8, hand: 0.9,
  hipX: 0.088, thigh: 0.4, shin: 0.385, legScale: 0.93, footLen: 0.238,
  skin: [0.87, 0.73, 0.63],
  y: { crotch: 0.78, troch: 0.82, iliac: 0.95, rib: 1.12, armpit: 1.29, shoulder: 1.31, neckBase: 1.42 },
};

export const specFor = (key: ModelKey): BodySpec => (key === "female" ? FEMALE : MALE);

// ---------------------------------------------------------------------------------------------- helpers
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const gauss = (d: number, s: number) => Math.exp(-(d * d) / (s * s));

/** Frame for a tube running along tangent T: `a` = mediolateral-ish, `b` = anteroposterior-ish (+Z side). */
function frame(T: THREE.Vector3, ref = V(1, 0, 0)) {
  const a = ref.clone().sub(T.clone().multiplyScalar(ref.dot(T))).normalize();
  const b = new THREE.Vector3().crossVectors(a, T).normalize();
  if (b.z < 0) b.negate();
  return { a, b };
}

interface LimbKey { u: number; rx: number; rz: number }

/** Rings along a smooth path through `pts` with radii from `keys` (u = normalised arc length). `s` = metres from the start. */
function limbRings(pts: THREE.Vector3[], keys: LimbKey[], n: number, ref = V(1, 0, 0), e = 2): { rings: Ring[]; length: number } {
  const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
  const length = curve.getLength();
  const prof = makeProfile(keys.map((k) => [k.u, k.rx, k.rz]));
  const rings: Ring[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const c = curve.getPointAt(u);
    const T = curve.getTangentAt(u).normalize();
    const { a, b } = frame(T, ref);
    const [rx, rz] = prof(u);
    rings.push({ c, a, b, rx, rz, s: u * length, e });
  }
  return { rings, length };
}

// ---------------------------------------------------------------------------------------------- part model
type PartKind =
  | { t: "torso" }
  | { t: "neck" }
  | { t: "head" }
  | { t: "ear"; side: 1 | -1 }
  | { t: "arm"; side: 1 | -1; l1: number }
  | { t: "hand"; side: 1 | -1 }
  | { t: "leg"; side: 1 | -1; l1: number; len: number }
  | { t: "foot"; side: 1 | -1 };

interface Part { kind: PartKind; mesh: PartMesh }

// ---------------------------------------------------------------------------------------------- head (normalised: 1 = head height, y from chin)
const HEAD_PROFILE_KEYS = [
  // y', halfWidth, frontDepth, backDepth
  [0.0, 0.03, 0.14, 0.14], [0.03, 0.12, 0.295, 0.2], [0.08, 0.19, 0.345, 0.24], [0.16, 0.255, 0.347, 0.3], [0.26, 0.3, 0.357, 0.37],
  [0.38, 0.325, 0.366, 0.44], [0.5, 0.337, 0.375, 0.47], [0.6, 0.34, 0.385, 0.475], [0.7, 0.335, 0.375, 0.465],
  [0.8, 0.315, 0.345, 0.43], [0.89, 0.27, 0.29, 0.36], [0.955, 0.19, 0.2, 0.25], [0.99, 0.09, 0.09, 0.1], [1.0, 0.0, 0.0, 0.0],
];
const NOSE_P = [[0.255, 0], [0.285, 0.05], [0.31, 0.122], [0.34, 0.128], [0.4, 0.092], [0.46, 0.052], [0.52, 0.02], [0.565, 0]];
const NOSE_W = [[0.255, 0.1], [0.31, 0.095], [0.36, 0.07], [0.44, 0.052], [0.52, 0.045], [0.6, 0.04]];

const HEAD_ROWS: number[] = (() => {
  const ys: number[] = [];
  let y = 0;
  while (y < 1) { ys.push(y); y += y > 0.08 && y < 0.66 ? 0.0068 : 0.017; }
  ys.push(1);
  return ys;
})();
const HEAD_SEG = 144;

/** Face relief (z displacement, normalised) + subtle vertex colour. All in the normalised head frame. */
function faceRelief(X: number, Y: number, front: boolean, skin: [number, number, number], jaw: number): { dz: number; col: [number, number, number] } {
  let dz = 0;
  const col: [number, number, number] = [skin[0], skin[1], skin[2]];
  if (!front) return { dz, col };
  // nose
  if (Y > 0.255 && Y < 0.565) {
    const w = lerpTable(NOSE_W, Y);
    dz += lerpTable(NOSE_P, Y) * gauss(X, w);
  }
  // lips (upper + lower) and mouth line
  dz += 0.026 * gauss(Y - 0.187, 0.03) * gauss(X, 0.085);
  dz += 0.028 * gauss(Y - 0.128, 0.03) * gauss(X, 0.08);
  dz -= 0.02 * gauss(Y - 0.156, 0.007) * gauss(X, 0.1);
  dz -= 0.012 * gauss(Y - 0.098, 0.012) * gauss(X, 0.09); // mentolabial groove
  const lip = Math.max(gauss(Y - 0.187, 0.024) * gauss(X, 0.075), gauss(Y - 0.128, 0.026) * gauss(X, 0.07));
  // chin + cheek bones + brow ridge + eye sockets
  dz += 0.034 * gauss(Y - 0.06, 0.05) * gauss(X, 0.1);
  dz += 0.014 * gauss(Y - 0.41, 0.06) * gauss(X - 0.22, 0.08);
  dz += 0.022 * gauss(Y - 0.588, 0.026) * smoothstep(0.02, 0.07, X) * (1 - smoothstep(0.2, 0.26, X));
  dz -= 0.03 * gauss(Y - 0.505, 0.04) * gauss(X - 0.135, 0.07);
  const fissure = gauss(Y - 0.503, 0.008) * gauss(X - 0.135, 0.05);
  dz -= 0.008 * fissure;
  const brow = gauss(Y - 0.588, 0.014) * smoothstep(0.03, 0.08, X) * (1 - smoothstep(0.19, 0.24, X));
  // soft jaw narrowing for the female model
  if (jaw < 1) dz -= (1 - jaw) * 0.04 * gauss(Y - 0.12, 0.1) * gauss(X - 0.2, 0.1);
  // colours: lips warmer, brows / lash line a touch deeper
  col[0] = skin[0] * (1 - 0.1 * (brow + fissure)) + 0.05 * lip;
  col[1] = skin[1] * (1 - 0.16 * (brow + fissure) - 0.18 * lip);
  col[2] = skin[2] * (1 - 0.16 * (brow + fissure) - 0.14 * lip);
  return { dz, col };
}

function buildHead(spec: BodySpec): { head: PartMesh; ears: PartMesh[] } {
  const prof = makeProfile(HEAD_PROFILE_KEYS);
  const colors: number[] = [];
  const H = spec.headH;
  const pos = gridLoft(
    HEAD_ROWS.length, HEAD_SEG,
    (i, j) => {
      const Yn = HEAD_ROWS[i];
      const [hw0, zf, zb] = prof(Yn);
      // lower face narrows for the female model (jaw multiplier fades in below the cheekbones)
      const jawK = 1 - (1 - spec.jaw) * (1 - smoothstep(0.1, 0.42, Yn));
      const hw = hw0 * spec.headWidth * jawK;
      const th = (j / HEAD_SEG) * Math.PI * 2;
      const [s, c] = superEllipse(th, 2.15);
      const front = c >= 0;
      const X = Math.abs(hw * s);
      const { dz, col } = faceRelief(X, Yn, front && Yn > 0.02 && Yn < 0.7, spec.skin, spec.jaw);
      const x = hw * s;
      const z = (front ? zf * c : zb * c) + (front ? dz : 0);
      colors.push(col[0], col[1], col[2]);
      return [x * H, Yn * H + (spec.stature - H), z * H + spec.headZ];
    },
    (i) => HEAD_ROWS[i]
  );
  pos.colors = colors;

  // ears: flattened ellipsoids on the sides of the skull (a real ear shape comes with the GLB assets)
  const ears: PartMesh[] = [];
  for (const side of [1, -1] as const) {
    const g = new THREE.SphereGeometry(1, 20, 14);
    const cy = 0.505, cx = 0.352 * spec.headWidth, cz = -0.06;
    const ear = fromGeometry(g, (v) => {
      const rx = 0.03, ry = 0.075, rz = 0.05;
      // tilt: the top of the ear leans slightly backwards
      const y0 = v.y * ry, z0 = v.z * rz + v.y * 0.012;
      v.set((cx + v.x * rx * 0.8 + (v.x > 0 ? 0.008 : 0)) * side * H, (cy + y0) * H + (spec.stature - H), (cz + z0) * H + spec.headZ);
    });
    ears.push(ear);
  }
  return { head: pos, ears };
}

// ---------------------------------------------------------------------------------------------- torso / neck / limbs
function buildTorso(spec: BodySpec): PartMesh {
  const keys = spec.torso;
  const yProf = makeProfile(keys.map((k) => [k[0], k[1], k[2], k[3], k[4]]));
  const y0 = keys[0][0], y1 = keys[keys.length - 1][0];
  const rows = 84;
  const ys = Array.from({ length: rows }, (_, i) => y0 + ((y1 - y0) * i) / (rows - 1));
  const seg = 72;
  const g = gridLoft(
    rows, seg,
    (i, j) => {
      const y = ys[i];
      const [rx, zf, zb, e] = yProf(y);
      const th = (j / seg) * Math.PI * 2;
      const [s, c] = superEllipse(th, Math.max(2, e));
      let x = rx * s, z = c >= 0 ? zf * c : zb * c;
      if (c > 0) {
        // chest relief: female bust (round) or male pecs (flat), tapering to the sides / clavicle
        const bx = Math.abs(x);
        const bust = spec.bust * gauss(bx - 0.082, 0.062) * gauss(y - (spec.y.rib + 0.11), 0.06);
        const pec = spec.pecs * gauss(bx - 0.085, 0.08) * gauss(y - (spec.y.rib + 0.115), 0.075);
        z += (bust + pec) * c;
      }
      if (c < 0 && y < spec.y.iliac + 0.04) {
        // gluteal fullness (two soft lobes)
        z -= 0.02 * gauss(Math.abs(x) - 0.075, 0.06) * gauss(y - (spec.y.troch + 0.03), 0.07) * -c;
      }
      return [x, y, z];
    },
    (i) => ys[i]
  );
  return g;
}

function buildNeck(spec: BodySpec): PartMesh {
  const yb = spec.y.neckBase - 0.09, yt = spec.stature - spec.headH + 0.075;
  const rows = 26, seg = 40;
  const n = spec.neck;
  return gridLoft(
    rows, seg,
    (i, j) => {
      const t = i / (rows - 1);
      const y = yb + (yt - yb) * t;
      const th = (j / seg) * Math.PI * 2;
      const [s, c] = superEllipse(th, 2.1);
      // trumpet flare at the base (trapezius)
      const flare = 1 + 0.55 * Math.pow(1 - t, 4);
      return [n.rx * flare * s, y, n.z + n.rz * flare * c + spec.headZ * t * 0.5];
    },
    (i) => yb + ((yt - yb) * i) / (rows - 1)
  );
}

function buildArm(spec: BodySpec, side: 1 | -1): { arm: PartMesh; l1: number } {
  const [rx0, ry0, rz0] = spec.armRoot;
  const sh = V(side * rx0, ry0, rz0);
  const a = (spec.abduct * Math.PI) / 180, f = (spec.elbowFlex * Math.PI) / 180;
  const d1 = V(side * Math.sin(a), -Math.cos(a), 0.02).normalize();
  const el = sh.clone().addScaledVector(d1, spec.upperArm);
  const d2 = V(side * Math.sin(a * 0.75), -Math.cos(a * 0.75) * Math.cos(f), Math.sin(f)).normalize();
  const wr = el.clone().addScaledVector(d2, spec.foreArm);
  const mid1 = sh.clone().addScaledVector(d1, spec.upperArm * 0.5);
  const mid2 = el.clone().addScaledVector(d2, spec.foreArm * 0.5);
  const s = spec.key === "female" ? 0.9 : 1;
  const L = spec.upperArm + spec.foreArm;
  const u = (m: number) => m / L;
  const { rings, length } = limbRings(
    [sh, mid1, el, mid2, wr],
    [
      { u: 0, rx: 0.052 * s, rz: 0.05 * s }, { u: u(0.05), rx: 0.05 * s, rz: 0.048 * s }, { u: u(0.14), rx: 0.046 * s, rz: 0.044 * s },
      { u: u(spec.upperArm - 0.02), rx: 0.037 * s, rz: 0.036 * s }, { u: u(spec.upperArm + 0.03), rx: 0.038 * s, rz: 0.037 * s },
      { u: u(spec.upperArm + 0.1), rx: 0.04 * s, rz: 0.039 * s }, { u: u(spec.upperArm + spec.foreArm - 0.02), rx: 0.027 * s, rz: 0.021 * s },
      { u: 1, rx: 0.026 * s, rz: 0.02 * s },
    ],
    46
  );
  const arm = loft(withCaps(rings, 0.05 * s, 0.004, 4), 30);
  (arm as PartMesh & { _wrist?: THREE.Vector3; _dir?: THREE.Vector3 })._wrist = wr;
  (arm as PartMesh & { _wrist?: THREE.Vector3; _dir?: THREE.Vector3 })._dir = d2;
  return { arm, l1: (spec.upperArm / (spec.upperArm + spec.foreArm)) * length };
}

/** Flat anatomical hand (palm anterior, thumb lateral): palm + 4 fingers + thumb. All triangles are `hand`. */
function buildHand(spec: BodySpec, side: 1 | -1, wrist: THREE.Vector3, dir: THREE.Vector3): PartMesh[] {
  const k = spec.hand;
  const parts: PartMesh[] = [];
  const T = dir.clone().normalize();
  const ref = V(1, 0, 0);
  const { a, b } = frame(T, ref);
  const at = (m: number, lat: number, ant: number) => wrist.clone().addScaledVector(T, m).addScaledVector(a, lat * side).addScaledVector(b, ant);
  // palm
  const palmLen = 0.098 * k;
  const palm: Ring[] = [];
  const pk = [[0, 0.026, 0.02], [0.3, 0.036, 0.016], [0.7, 0.043, 0.0135], [1, 0.043, 0.012]];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8;
    const r = lerpTable(pk.map((q) => [q[0], q[1]]), u) * k, z = lerpTable(pk.map((q) => [q[0], q[2]]), u) * k;
    palm.push({ c: at(u * palmLen, 0, 0), a, b, rx: r, rz: z, s: 0, e: 2.6 });
  }
  parts.push(loft(withCaps(palm, 0.004, 0.006, 3), 20));
  // fingers: [lateral offset at knuckle (thumb side = +), length, base radius, splay]
  const fingers: Array<[number, number, number, number]> = [
    [0.033, 0.078, 0.0086, 0.05], [0.011, 0.088, 0.0088, 0.0], [-0.011, 0.082, 0.0084, -0.03], [-0.032, 0.066, 0.0075, -0.08],
  ];
  for (const [lat, len, r0, splay] of fingers) {
    const rs: Ring[] = [];
    for (let i = 0; i <= 5; i++) {
      const u = i / 5;
      const dirF = T.clone().addScaledVector(a, splay * side).addScaledVector(b, 0.05 * u).normalize();
      const p = at(palmLen * k, lat * k, 0.0).addScaledVector(dirF, len * k * u);
      const fr = frame(dirF, ref);
      const rr = r0 * k * (1 - 0.22 * u);
      rs.push({ c: p, a: fr.a, b: fr.b, rx: rr, rz: rr * 0.86, s: 0 });
    }
    parts.push(loft(withCaps(rs, 0.004 * k, 0.007 * k, 4), 12));
  }
  // thumb
  const th: Ring[] = [];
  const base = at(palmLen * 0.22, 0.03 * k, 0.004);
  const td = T.clone().addScaledVector(a, 0.85 * side).addScaledVector(b, 0.18).normalize();
  for (let i = 0; i <= 5; i++) {
    const u = i / 5;
    const d = td.clone().lerp(T, u * 0.45).normalize();
    const p = base.clone().addScaledVector(td, 0.0125 * k * i).addScaledVector(T, -0.004 * k * u);
    const fr = frame(d, ref);
    const rr = 0.0115 * k * (1 - 0.2 * u);
    th.push({ c: p, a: fr.a, b: fr.b, rx: rr, rz: rr * 0.86, s: 0 });
  }
  parts.push(loft(withCaps(th, 0.006 * k, 0.007 * k, 4), 12));
  return parts;
}

function buildLeg(spec: BodySpec, side: 1 | -1): { leg: PartMesh; l1: number; len: number; ankle: THREE.Vector3 } {
  const ks = spec.legScale;
  const hip = V(side * spec.hipX, spec.y.troch + 0.01, 0.0);
  const knee = V(side * (spec.hipX - 0.006), hip.y - spec.thigh, 0.014);
  const ankle = V(side * (spec.hipX - 0.008), 0.085, -0.004);
  const midT = hip.clone().lerp(knee, 0.5).add(V(0, 0, 0.004));
  const midS = knee.clone().lerp(ankle, 0.5).add(V(0, 0, -0.008));
  const L = hip.distanceTo(knee) + knee.distanceTo(ankle);
  const l1 = hip.distanceTo(knee);
  const u = (m: number) => m / L;
  const { rings, length } = limbRings(
    [hip, midT, knee, midS, ankle],
    [
      { u: 0, rx: 0.08 * ks, rz: 0.088 * ks }, { u: u(0.1), rx: 0.08 * ks, rz: 0.088 * ks }, { u: u(l1 * 0.55), rx: 0.072 * ks, rz: 0.078 * ks },
      { u: u(l1 - 0.03), rx: 0.052 * ks, rz: 0.056 * ks }, { u: u(l1 + 0.02), rx: 0.05 * ks, rz: 0.054 * ks },
      { u: u(l1 + 0.13), rx: 0.054 * ks, rz: 0.058 * ks }, { u: u(l1 + 0.3), rx: 0.038 * ks, rz: 0.04 * ks }, { u: 1, rx: 0.033 * ks, rz: 0.035 * ks },
    ],
    54
  );
  const leg = loft(withCaps(rings, 0.05 * ks, 0.006, 4), 34);
  return { leg, l1: (l1 / L) * length, len: length, ankle };
}

function buildFoot(spec: BodySpec, side: 1 | -1, ankle: THREE.Vector3): PartMesh {
  const k = spec.footLen / 0.265;
  // rings perpendicular to +Z: a = X (width), b = Y (height). z runs heel -> toe.
  const keys = [
    // z (m from ankle), halfWidth, halfHeight, centreY
    [-0.055, 0.02, 0.034, 0.055], [-0.035, 0.034, 0.044, 0.05], [0.0, 0.037, 0.044, 0.05], [0.05, 0.042, 0.032, 0.04],
    [0.1, 0.048, 0.024, 0.032], [0.15, 0.052, 0.02, 0.027], [0.19, 0.05, 0.016, 0.022], [0.225, 0.04, 0.012, 0.018],
  ];
  const rings: Ring[] = [];
  const A = V(1, 0, 0), B = V(0, 1, 0);
  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    const z = keys[0][0] + (keys[keys.length - 1][0] - keys[0][0]) * t;
    const rx = lerpTable(keys.map((q) => [q[0], q[1]]), z) * k, rz = lerpTable(keys.map((q) => [q[0], q[2]]), z) * k;
    const cy = lerpTable(keys.map((q) => [q[0], q[3]]), z) * k;
    rings.push({ c: V(ankle.x + side * 0.004, cy, ankle.z + z * k + 0.02 * k), a: A, b: B, rx, rz, s: 0, e: 2.3 });
  }
  return loft(withCaps(rings, 0.02 * k, 0.012 * k, 4), 26);
}

// ---------------------------------------------------------------------------------------------- classifier (see regionRules.ts)
export { classifyHead, classifyNeck, classifyTorso, classifyArm, classifyLeg } from "./regionRules";
import { classifyHead, classifyNeck, classifyTorso, classifyArm, classifyLeg } from "./regionRules";
export type { HeadFrame } from "./regionRules";

// ---------------------------------------------------------------------------------------------- assembly
export interface ProceduralBody extends BodyAsset {
  /** Exposed for the tests / debug only. */
  triRegionNames: string[];
}

export function buildProceduralBody(key: ModelKey): ProceduralBody {
  const spec = specFor(key);
  const parts: Part[] = [];
  const chinY = spec.stature - spec.headH;

  parts.push({ kind: { t: "torso" }, mesh: buildTorso(spec) });
  parts.push({ kind: { t: "neck" }, mesh: buildNeck(spec) });
  const { head, ears } = buildHead(spec);
  parts.push({ kind: { t: "head" }, mesh: head });
  parts.push({ kind: { t: "ear", side: 1 }, mesh: ears[0] });
  parts.push({ kind: { t: "ear", side: -1 }, mesh: ears[1] });
  for (const side of [1, -1] as const) {
    const { arm, l1 } = buildArm(spec, side);
    parts.push({ kind: { t: "arm", side, l1 }, mesh: arm });
    const w = (arm as PartMesh & { _wrist: THREE.Vector3; _dir: THREE.Vector3 });
    for (const h of buildHand(spec, side, w._wrist, w._dir)) parts.push({ kind: { t: "hand", side }, mesh: h });
    const { leg, l1: ll1, len, ankle } = buildLeg(spec, side);
    parts.push({ kind: { t: "leg", side, l1: ll1, len }, mesh: leg });
    parts.push({ kind: { t: "foot", side }, mesh: buildFoot(spec, side, ankle) });
  }

  const merged = mergeParts(parts.map((p) => p.mesh), spec.skin);
  const geo = merged.geometry;
  const pos = geo.getAttribute("position");
  const idx = geo.getIndex()!;
  const triCount = idx.count / 3;
  const regionIndex = new Map<string, number>(REGION_IDS.map((id, i) => [id, i]));
  const triRegion = new Int16Array(triCount).fill(-1);
  const names: string[] = new Array(triCount).fill("");
  const nor = geo.getAttribute("normal");

  for (let t = 0; t < triCount; t++) {
    const a = idx.getX(t * 3), b = idx.getX(t * 3 + 1), c = idx.getX(t * 3 + 2);
    const cx = (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3;
    const cy = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
    const nzv = (nor.getZ(a) + nor.getZ(b) + nor.getZ(c)) / 3;
    const part = parts[merged.triPart[t]];
    const k = part.kind;
    let id = "";
    switch (k.t) {
      case "torso": id = classifyTorso(spec, cx, cy, cz); break;
      case "neck": {
        const th = (Math.atan2(Math.abs(cx), cz - (spec.neck.z + 0.004)) * 180) / Math.PI;
        id = classifyNeck(cx >= 0 ? 1 : -1, th);
        break;
      }
      case "head": {
        const H = spec.headH;
        const X = Math.abs(cx) / H, Y = (cy - chinY) / H, Z = (cz - spec.headZ) / H;
        const theta = (Math.atan2(Math.abs(cx), cz - spec.headZ + 0.0) * 180) / Math.PI;
        id = classifyHead(cx >= 0 ? 1 : -1, X, Y, Z, theta, nzv);
        break;
      }
      case "ear": id = k.side > 0 ? "left_ear" : "right_ear"; break;
      case "arm": id = classifyArm(k.side, merged.triS[t], k.l1); break;
      case "hand": id = k.side > 0 ? "left_hand" : "right_hand"; break;
      case "leg": id = classifyLeg(k.side, merged.triS[t], k.l1, k.len); break;
      case "foot": id = cy > 0.1 ? (k.side > 0 ? "left_ankle" : "right_ankle") : k.side > 0 ? "left_foot" : "right_foot"; break;
    }
    names[t] = id;
    triRegion[t] = regionIndex.get(id) ?? -1;
  }

  const root = new THREE.Group();
  root.name = `derm-body-${key}`;
  // Clean matte / semi-matte clinical surface: no clearcoat, no sheen highlights, no metallic response (avoids the
  // waxy / plastic look and keeps the body shape readable under the soft studio lights).
  const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });
  const skin = new THREE.Mesh(geo, skinMat);
  skin.name = "skin";
  skin.castShadow = false;
  skin.receiveShadow = false;
  root.add(skin);

  const regions = buildRegionSurfaces(geo, triRegion, REGION_IDS, root);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const landmarks: Landmarks = {
    height: spec.stature,
    head: new THREE.Vector3(0, chinY + spec.headH * 0.55, spec.headZ),
    headRadius: spec.headH * 0.62,
    neckBase: new THREE.Vector3(0, spec.y.neckBase, spec.neck.z),
  };
  return {
    key,
    source: "procedural",
    modelVersion: DERM_FALLBACK_ASSET_VERSION,
    root,
    skinMaterials: [skinMat],
    regions,
    landmarks,
    bounds,
    triRegionNames: names,
    dispose() {
      try {
        geo.dispose();
        skinMat.dispose();
        regions.forEach((r) => r.geometry.dispose());
      } catch { /* never throws */ }
    },
  };
}
