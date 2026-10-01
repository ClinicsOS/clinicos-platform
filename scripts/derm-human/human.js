'use strict';
/**
 * ClinicOS Dermatology & Aesthetics — procedural clinical human (visual model v2), male + female.
 *
 * Built as a signed-distance field so the whole body is ONE continuous skin: the neck flows into the trapezius, the
 * shoulder into the deltoid, the torso into the thighs, the wrist into the hand. Anatomy is sculpted from named forms
 * (cranium, maxilla, mandible, brow, orbits + eyeballs + lids, nose with alae and nostrils, lips, ears with helix /
 * concha / lobule, sterno-cleido-mastoid, trapezius, clavicle, pectoral, deltoid, biceps, triceps, forearm flexors,
 * palm + three-phalanx fingers + thumb, gluteal mass, quadriceps, vastus medialis, patella, hamstrings, gastrocnemius,
 * tibial crest, malleoli, heel / arch / forefoot / five toes). It is stylised and neutral: no hair, no nipples, no
 * genital detail, no vessels/pores. It is NOT photographic.
 *
 * Canonical frame: +X = patient's LEFT, +Y up, +Z anterior, origin on the floor between the feet, 1 unit = 1 metre.
 * Everything anatomical is built for the patient's LEFT (+X) and mirrored for the right, so sides can never be swapped.
 */
const S = require('./sdf.js');
const { smin, smax, sub, add, mul, dot, norm, cross, lerp3, sphere, ellipsoid, roundCone, roundBox, frameFor, boxDist, boxOf } = S;
const D2R = Math.PI / 180;

// ------------------------------------------------------------------------------------------------ specifications
const MALE = {
  key: 'male', stature: 1.78, headH: 0.235, headZ: 0.012,
  face: { cranW: 0.33, brow: 0.05, jawX: 0.222, jawR: 0.058, chin: 1.0, lip: 1.0, nose: 1.0, cheek: 1.0, faceW: 0.262, earScale: 1.0, neckR: 0.052, scm: 0.8, adam: 1.0 },
  torso: [
    // y, halfWidth, frontDepth, backDepth, exponent
    [0.775, 0.05, 0.05, 0.06, 2.1], [0.83, 0.11, 0.072, 0.088, 2.2], [0.89, 0.172, 0.088, 0.102, 2.3], [0.97, 0.164, 0.090, 0.098, 2.3],
    [1.05, 0.142, 0.084, 0.088, 2.3], [1.12, 0.140, 0.084, 0.088, 2.3], [1.20, 0.152, 0.092, 0.094, 2.4], [1.28, 0.168, 0.100, 0.098, 2.5],
    [1.36, 0.178, 0.104, 0.096, 2.5], [1.41, 0.176, 0.094, 0.090, 2.4], [1.45, 0.150, 0.080, 0.080, 2.2], [1.48, 0.090, 0.066, 0.068, 2.05],
    [1.505, 0.056, 0.060, 0.062, 2.0], [1.53, 0.03, 0.03, 0.03, 2.0],
  ],
  chest: { pec: 1.0, bust: 0 }, lat: 1.0, glute: 1.0, waistDrop: 0,
  neck: { z: -0.008, base: 1.47 },
  shoulderX: 0.152, armRoot: [0.196, 1.41, -0.004], upperArm: 0.30, foreArm: 0.262, abduct: 15, elbowFlex: 10,
  armR: 1.0, muscle: 1.0, hand: 1.0,
  hipX: 0.099, troch: 0.89, thigh: 0.42, shin: 0.41, legR: 1.0, footLen: 0.265, footToe: 1.0,
  skin: [0.86, 0.72, 0.62],
  y: { crotch: 0.84, troch: 0.88, iliac: 1.02, rib: 1.2, armpit: 1.37, shoulder: 1.385, neckBase: 1.5 },
};
const FEMALE = {
  key: 'female', stature: 1.65, headH: 0.222, headZ: 0.011,
  face: { cranW: 0.315, brow: 0.016, jawX: 0.198, jawR: 0.05, chin: 0.8, lip: 1.16, nose: 0.86, cheek: 1.1, faceW: 0.245, earScale: 0.92, neckR: 0.046, scm: 0.55, adam: 0 },
  torso: [
    [0.735, 0.105, 0.066, 0.078, 2.1], [0.78, 0.150, 0.082, 0.096, 2.2], [0.845, 0.172, 0.094, 0.110, 2.2], [0.925, 0.178, 0.094, 0.110, 2.2],
    [1.005, 0.146, 0.086, 0.088, 2.2], [1.065, 0.124, 0.080, 0.080, 2.2], [1.135, 0.128, 0.085, 0.082, 2.3], [1.215, 0.142, 0.094, 0.086, 2.35],
    [1.29, 0.16, 0.096, 0.088, 2.4], [1.335, 0.17, 0.084, 0.080, 2.3], [1.372, 0.150, 0.074, 0.072, 2.15], [1.390, 0.095, 0.062, 0.062, 2.05],
    [1.404, 0.045, 0.045, 0.045, 2.0],
  ],
  chest: { pec: 0.0, bust: 1.0 }, lat: 0.55, glute: 1.18, waistDrop: 0,
  neck: { z: -0.007, base: 1.395 },
  shoulderX: 0.146, armRoot: [0.18, 1.335, -0.004], upperArm: 0.275, foreArm: 0.24, abduct: 12, elbowFlex: 10,
  armR: 0.9, muscle: 0.55, hand: 0.9,
  hipX: 0.094, troch: 0.83, thigh: 0.40, shin: 0.385, legR: 0.95, footLen: 0.238, footToe: 0.92,
  skin: [0.87, 0.73, 0.63],
  y: { crotch: 0.78, troch: 0.82, iliac: 0.95, rib: 1.12, armpit: 1.29, shoulder: 1.31, neckBase: 1.42 },
};
const specFor = (key) => (key === 'female' ? FEMALE : MALE);

// ------------------------------------------------------------------------------------------------ small helpers
const V = (x, y, z) => [x, y, z];
const mirrorX = (p, side) => [p[0] * side, p[1], p[2]];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Monotone-ish smooth interpolation of table columns by the first column (Catmull-Rom on the row index). */
function curve(table) {
  const n = table.length, cols = table[0].length - 1;
  return (y) => {
    if (y <= table[0][0]) return table[0].slice(1);
    if (y >= table[n - 1][0]) return table[n - 1].slice(1);
    let i = 0; while (i < n - 2 && y > table[i + 1][0]) i++;
    const t = (y - table[i][0]) / (table[i + 1][0] - table[i][0]);
    const p0 = table[Math.max(0, i - 1)], p1 = table[i], p2 = table[i + 1], p3 = table[Math.min(n - 1, i + 2)];
    const out = new Array(cols);
    for (let c = 1; c <= cols; c++) {
      // non-uniform tangents (finite differences in y) keep it stable when the row spacing varies
      const m1 = (p2[c] - p0[c]) / (p2[0] - p0[0]) * (p2[0] - p1[0]);
      const m2 = (p3[c] - p1[c]) / (p3[0] - p1[0]) * (p2[0] - p1[0]);
      const t2 = t * t, t3 = t2 * t;
      out[c - 1] = (2 * t3 - 3 * t2 + 1) * p1[c] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[c] + (t3 - t2) * m2;
    }
    return out;
  };
}

/** Elliptical-superellipse loft along Y (front / back depths differ). Returns an SDF-like function. */
function loftY(table, r = 0.035) {
  const at = curve(table);
  const y0 = table[0][0], y1 = table[table.length - 1][0];
  return (x, y, z) => {
    const yc = y < y0 ? y0 : y > y1 ? y1 : y;
    const [rx, zf, zb, e] = at(yc);
    const zd = z >= 0 ? zf : zb;
    const nx = Math.abs(x) / rx, nz = Math.abs(z) / zd;
    const q = Math.pow(Math.pow(nx, e) + Math.pow(nz, e), 1 / e);
    const dxy = (q - 1) * Math.min(rx, zd);
    // rounded extrusion: both end caps are rolled over with radius r instead of being cut flat (no horizontal seam)
    const ex = dxy + r, ey = Math.max(y0 + r - y, y - (y1 - r));
    return Math.min(Math.max(ex, ey), 0) + Math.hypot(Math.max(ex, 0), Math.max(ey, 0)) - r;
  };
}

/**
 * Anchored surface relief: gaussian dents (-) / bumps (+) that follow the skin of `base`. `feats` = [x, y, sx, sy, mm];
 * `dir` = +1 anchors on the front (anterior) skin, -1 on the back. Amplitudes are millimetres of surface displacement.
 */
function anchoredRelief(base, feats, dir, zRange = [-0.2, 0.25]) {
  const surf = (x, y) => {
    if (dir > 0) { let z = zRange[1], prev = base(x, y, z); for (; z > zRange[0]; z -= 0.004) { const v = base(x, y, z - 0.004); if (v < 0 && prev >= 0) { let a = z, b = z - 0.004; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (base(x, y, m) < 0) b = m; else a = m; } return (a + b) / 2; } prev = v; } }
    else { let z = zRange[0], prev = base(x, y, z); for (; z < zRange[1]; z += 0.004) { const v = base(x, y, z + 0.004); if (v < 0 && prev >= 0) { let a = z, b = z + 0.004; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (base(x, y, m) < 0) b = m; else a = m; } return (a + b) / 2; } prev = v; } }
    return null;
  };
  const anchors = feats.map(([x, y, sx, sy, mm]) => { const z = surf(x, y); return z === null ? null : [x, y, z, sx, sy, mm / 1000]; }).filter(Boolean);
  return (x, y, z) => {
    const d = base(x, y, z);
    if (d > 0.014 || d < -0.014) return d;
    let g = 0;
    for (let i = 0; i < anchors.length; i++) { const a = anchors[i]; const dx = (x - a[0]) / a[3], dy = (y - a[1]) / a[4], dz = (z - a[2]) / 0.022; const r2 = dx * dx + dy * dy + dz * dz; if (r2 < 9) g += a[5] * Math.exp(-r2); }
    return d - g;
  };
}

/** Blends a list of {f, box, k}: far parts are skipped / replaced by their box lower bound (perf), near ones are exact. */
function makeBlend(items) {
  const n = items.length;
  return (x, y, z) => {
    let d = Infinity;
    for (let i = 0; i < n; i++) {
      const it = items[i];
      const bd = boxDist(x, y, z, it.box);
      if (i > 0 && bd >= d + it.k) continue;
      const v = bd > 0.1 ? bd : it.f(x, y, z);
      d = i === 0 ? v : smin(d, v, it.k);
    }
    return d;
  };
}

// ------------------------------------------------------------------------------------------------ head (normalised frame)
function buildHead(sp) {
  const H = sp.headH, cy0 = sp.stature - H, hz = sp.headZ, F = sp.face;
  const W = (x, y, z) => V(x * H, cy0 + y * H, hz + z * H);
  const R = (x, y, z) => V(x * H, y * H, z * H);
  const nk = F.nose, lk = F.lip, cw = F.cranW;
  const list = []; // [f, k(normalised)]

  // ---- skull, face plane, mandible (kept simple and smooth: the FEATURES are added on top of this)
  const cranium = ellipsoid(W(0, 0.60, -0.045), R(cw, 0.40, 0.44));
  const faceMass = ellipsoid(W(0, 0.36, 0.06), R(F.faceW * 0.9, 0.28, 0.30));
  const upperFace = ellipsoid(W(0, 0.53, 0.10), R(F.faceW * 0.97, 0.15, 0.275));
  let skull = S.unionK([[cranium, 0], [faceMass, 0.09 * H], [upperFace, 0.08 * H]]);
  const jaws = [];
  for (const s of [1, -1]) jaws.push(roundCone(W(s * 0.06 * F.chin, 0.075, 0.27 * F.chin + 0.03), W(s * F.jawX * 0.93, 0.22, -0.05), 0.045 * F.chin * H, F.jawR * H * 0.74));
  skull = S.unionK([[skull, 0], [jaws[0], 0.05 * H], [jaws[1], 0.05 * H], [ellipsoid(W(0, 0.075, 0.27 * F.chin + 0.03), R(0.075 * F.chin, 0.06 * F.chin, 0.05)), 0.05 * H]]);
  list.push([skull, 0]);
  // zygomatic (cheekbone) prominence, cheek fullness
  for (const s of [1, -1]) {
    list.push([ellipsoid(W(s * 0.2, 0.43, 0.225), R(0.07, 0.045, 0.07)), 0.07]);
    list.push([ellipsoid(W(s * 0.14, 0.33, 0.27), R(0.05 * F.cheek, 0.05 * F.cheek, 0.035)), 0.08]);
  }
  list.push([ellipsoid(W(0, 0.56, 0.372), R(0.05, 0.05, 0.03)), 0.05]); // glabella / nasal root

  // ---- nose: dorsum, tip, alae, columella (moderate, not bulbous)
  const root = W(0, 0.535, 0.372), tip = W(0, 0.318, 0.375 + 0.105 * nk);
  list.push([roundCone(root, tip, 0.033 * nk * H, 0.04 * nk * H), 0.045]);
  list.push([ellipsoid(W(0, 0.316, 0.375 + 0.1 * nk), R(0.043 * nk, 0.04 * nk, 0.04 * nk)), 0.03]);
  for (const s of [1, -1]) list.push([ellipsoid(W(s * 0.056 * nk, 0.292, 0.388), R(0.032 * nk, 0.03 * nk, 0.034 * nk)), 0.05]);
  list.push([roundCone(W(0, 0.30, 0.375 + 0.09 * nk), W(0, 0.262, 0.385), 0.02 * nk * H, 0.017 * nk * H), 0.03]);

  let head = S.unionK(list.map(([f, k]) => [f, k * H]));

  // ---- orbits + eyes: the orbit is a shallow bowl, lids are mounds, the palpebral fissure is an almond opening that shows the globe
  for (const s of [1, -1]) head = S.carve(head, ellipsoid(W(s * 0.135, 0.505, 0.412), R(0.09, 0.068, 0.062)), 0.03 * H);
  const eyes = [];
  for (const s of [1, -1]) {
    const c = W(s * 0.135, 0.505, 0.352), rad = 0.05 * H;
    eyes.push({ side: s, c, r: rad, axis: norm([s * 0.02, 0, 1]) });
    const lidU = ellipsoid(W(s * 0.135, 0.531, 0.342), R(0.072, 0.026, 0.06));
    const lidL = ellipsoid(W(s * 0.135, 0.478, 0.342), R(0.068, 0.022, 0.058));
    head = S.su(head, S.su(lidU, lidL, 0.003), 0.006);
    // almond opening (slightly tilted: lateral canthus a touch higher) then the globe fills it
    const fr = frameFor(norm([0, 0, 1]), V(1, 0, 0));
    const open = ellipsoid(W(s * 0.135, 0.505, 0.4), R(0.068, 0.026, 0.055), { u: norm([1, s * 0.12, 0]), v: norm([-s * 0.12, 1, 0]), w: V(0, 0, 1) });
    head = S.carve(head, open, 0.0025);
    head = S.su(head, sphere(c, rad), 0.002);
  }

  // ---- surface relief (creases / hollows) anchored to the skin, so it cannot cut through
  const R2 = [];
  const surfZ = (f, x, y) => {
    let z = hz + 0.62 * H, prev = f(x, y, z);
    for (; z > hz - 0.2 * H; z -= 0.004) { const v = f(x, y, z - 0.004); if (v < 0 && prev >= 0) { let a = z, b = z - 0.004; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (f(x, y, m) < 0) b = m; else a = m; } return (a + b) / 2; } prev = v; }
    return null;
  };
  const feat = (x, y, sx, sy, mm) => { R2.push([x * H, cy0 + y * H, sx * H, sy * H, mm / 1000]); };
  // lips (vermilion), chin, cheekbone, brow arches: outward bumps on the skin plane
  for (let i = -2; i <= 2; i++) { const t = Math.abs(i) / 2; feat(i * 0.036, 0.194 - 0.006 * t, 0.042, 0.022, 4.6 * lk * (1 - 0.35 * t)); feat(i * 0.036, 0.128 - 0.002 * t, 0.042, 0.03, 5.4 * lk * (1 - 0.3 * t)); }
  feat(0, 0.222, 0.02, 0.02, 1.4); // cupid's bow / tubercle
  feat(0, 0.068, 0.085, 0.05, 4.2 * F.chin); feat(0.11, 0.075, 0.05, 0.04, 1.6); feat(-0.11, 0.075, 0.05, 0.04, 1.6); // mental protuberance
  for (const s of [1, -1]) {
    feat(s * 0.2, 0.43, 0.06, 0.045, 1.3); // zygomatic
    feat(s * 0.09, 0.588, 0.05, 0.02, 2.6 * (F.brow / 0.05)); feat(s * 0.17, 0.577, 0.05, 0.018, 2.2 * (F.brow / 0.05)); feat(s * 0.235, 0.56, 0.04, 0.02, 1.2 * (F.brow / 0.05)); // brow arch
    feat(s * 0.036, 0.262, 0.022, 0.012, -2.2); // nostril (soft dimple)
  }
  for (let i = -3; i <= 3; i++) feat(i * 0.033, 0.158 + (Math.abs(i) === 3 ? 0.008 : 0), 0.036, 0.0055, -1.9 * (1 - 0.4 * Math.abs(i) / 3)); // mouth line
  for (let i = -2; i <= 2; i++) feat(i * 0.035, 0.1 + 0.004 * Math.abs(i), 0.034, 0.014, -1.5); // mentolabial sulcus
  feat(0, 0.226, 0.014, 0.028, -0.9); // philtrum groove
  for (const s of [1, -1]) for (let i = 0; i <= 3; i++) { const t = i / 3; feat(s * (0.09 + 0.045 * t), 0.268 - 0.1 * t, 0.024, 0.024, -0.9 * (1 - 0.4 * t)); } // nasolabial fold (soft)
  for (const s of [1, -1]) { feat(s * 0.135, 0.43, 0.075, 0.022, -0.35); feat(s * 0.135, 0.562, 0.07, 0.008, -1.0); feat(s * 0.262, 0.57, 0.055, 0.09, -1.6); feat(s * 0.06, 0.262, 0.02, 0.014, -1.2); }
  const base0 = head;
  const anchors = R2.map(([x, y, sx, sy, a]) => { const z = surfZ(base0, x, y); return z === null ? null : [x, y, z, sx, sy, a]; }).filter(Boolean);
  head = (x, y, z) => {
    const d = base0(x, y, z);
    if (d > 0.012 || d < -0.012) return d;
    let g = 0;
    for (let i = 0; i < anchors.length; i++) { const a = anchors[i]; const dx = (x - a[0]) / a[3], dy = (y - a[1]) / a[4], dz = (z - a[2]) / 0.02; const r2 = dx * dx + dy * dy + dz * dz; if (r2 < 9) g += a[5] * Math.exp(-r2); }
    return d - g;
  };

  // ---- ears: helix rim, concha bowl, antihelix, tragus, lobule
  const ears = [];
  for (const s of [1, -1]) {
    const es = F.earScale;
    const n = norm([s * Math.cos(24 * D2R), 0, Math.sin(24 * D2R)]);
    const v = norm([0, Math.cos(12 * D2R), -Math.sin(12 * D2R)]);
    const fr = { u: n, v, w: norm(cross(n, v)) };
    const c = W(s * (cw + 0.008), 0.50, -0.075);
    const disc = ellipsoid(c, R(0.02, 0.13 * es, 0.08 * es), fr);
    const lobule = ellipsoid(add(c, mul(v, -0.112 * H * es)), R(0.02, 0.032 * es, 0.034 * es), fr);
    const tragus = sphere(add(add(c, mul(fr.w, 0.068 * H * es)), mul(v, -0.03 * H * es)), 0.012 * H * es);
    let ear = S.unionK([[disc, 0], [lobule, 0.007], [tragus, 0.005]]);
    ear = S.carve(ear, ellipsoid(add(c, mul(n, 0.028 * H)), R(0.034, 0.085 * es, 0.046 * es), fr), 0.005);
    ear = S.su(ear, ellipsoid(add(add(c, mul(n, 0.002 * H)), mul(fr.w, -0.012 * H)), R(0.013, 0.058 * es, 0.017 * es), fr), 0.005);
    ears.push({ side: s, f: ear, box: boxOf([c], 0.11 * H + 0.03), c });
  }
  const earUnion = S.union(ears.map((e) => e.f), 0.001);
  const headBox = boxOf([W(0, 0, 0.1), W(0, 1.02, -0.5), W(0, 0.5, 0.75), W(0.45, 0.5, 0), W(-0.45, 0.5, 0)], 0.03);
  return { head: S.su(head, earUnion, 0.006), headOnly: head, ears, eyes, box: headBox, frame: { chinY: cy0, H, hz } };
}

// ------------------------------------------------------------------------------------------------ torso + neck
function buildTorso(sp) {
  const T = loftY(sp.torso);
  const y = sp.y, list = [[T, 0]];
  const m = sp.muscle;
  const shX = sp.shoulderX;
  for (const s of [1, -1]) {
    // pectoral / breast
    if (sp.chest.pec > 0) list.push([ellipsoid(V(s * 0.088, y.rib + 0.125, 0.052), V(0.092, 0.062, 0.05 * sp.chest.pec)), 0.09]);
    if (sp.chest.bust > 0) {
      list.push([ellipsoid(V(s * 0.07, y.rib + 0.088, 0.044), V(0.046, 0.046, 0.032)), 0.06]);
      list.push([ellipsoid(V(s * 0.07, y.rib + 0.115, 0.042), V(0.048, 0.04, 0.024)), 0.07]); // upper pole: soft slope into the chest wall
    }
    // latissimus / back muscles
    list.push([ellipsoid(V(s * (0.07 + 0.02 * sp.lat), y.rib + 0.06, -0.07), V(0.032 + 0.014 * sp.lat, 0.10, 0.012 * sp.lat + 0.008)), 0.09]);
    list.push([ellipsoid(V(s * 0.05, y.rib + 0.15, -0.08), V(0.055, 0.07, 0.01 * sp.lat + 0.008)), 0.09]);
    // gluteal mass + iliac crest
    list.push([ellipsoid(V(s * 0.078, y.troch + 0.012, -0.062), V(0.078, 0.092, 0.05 * sp.glute)), 0.06]);
    // trapezius: slope from the neck to the acromion
    list.push([roundCone(V(s * 0.034, Math.min(sp.neck.base + 0.014, sp.stature - sp.headH - 0.07), -0.03), V(s * (shX + 0.026), sp.armRoot[1] + 0.04, -0.006), 0.034 * (0.8 + 0.2 * m), 0.032), 0.05]);
    // clavicle
    list.push([roundCone(V(s * 0.018, sp.neck.base + 0.003, 0.058), V(s * (shX + 0.024), sp.armRoot[1] + 0.036, 0.024), 0.0105, 0.0125), 0.014]);
  }
  let f = S.unionK(list);
  // anterior + posterior relief: sternal groove, pectoral / costal margins, rectus, linea alba, spinal groove, scapulae, erectors
  const mm = 0.55 + 0.45 * m, male = sp.key === 'male';
  const front = [], back = [];
  for (let i = 0; i < 6; i++) front.push([0, y.rib + 0.07 + i * 0.03, 0.017, 0.024, -0.9]); // sternal groove
  for (const s of [1, -1]) {
    if (male) for (let i = 0; i <= 3; i++) front.push([s * (0.03 + i * 0.038), y.rib + 0.088 + 0.006 * i * i * 0.5 - 0.006 * i, 0.034, 0.017, -1.0]); // inferior pectoral border
    for (let j = 0; j < 4; j++) front.push([s * 0.036, y.iliac + 0.02 + j * 0.045, 0.026, 0.024, 1.0 * mm]); // rectus bellies
    for (let j = 0; j < 5; j++) front.push([s * 0.078, y.iliac + 0.02 + j * 0.05, 0.026, 0.028, -0.7]); // lateral rectus sheath
    for (let i = 0; i <= 2; i++) front.push([s * (0.05 + 0.035 * i), y.crotch + 0.05 + 0.02 * i, 0.028, 0.012, -0.9]); // inguinal fold
    for (let i = 0; i <= 3; i++) back.push([s * 0.04, y.iliac + 0.1 + i * 0.09, 0.024, 0.04, 1.4 * mm]); // erector spinae
    back.push([s * 0.088, y.rib + 0.16, 0.05, 0.06, 1.6 * mm]); back.push([s * 0.12, y.rib + 0.05, 0.05, 0.07, 0.8 * mm]); // scapula, lats
    back.push([s * 0.105, y.troch + 0.02, 0.05, 0.06, 1.2]); // gluteal mass definition
    back.push([s * 0.038, y.iliac - 0.005, 0.014, 0.014, -2.0]); // sacral dimple
  }
  for (let i = 0; i < 10; i++) back.push([0, y.iliac + 0.01 + i * 0.045, 0.015, 0.035, -1.3]); // spinal groove
  for (let i = 0; i < 4; i++) back.push([0, y.troch + 0.09 - i * 0.045, 0.01, 0.03, -3.2]); // gluteal cleft
  front.push([0, y.iliac + 0.02, 0.012, 0.11, -0.8]); // linea alba
  f = anchoredRelief(anchoredRelief(f, front, 1), back, -1);
  // navel
  f = S.carve(f, sphere(V(0, y.iliac + 0.028, sp.torso[3][2] + 0.008), 0.0085), 0.006);
  // sternal notch / suprasternal hollow
  f = S.carve(f, ellipsoid(V(0, sp.neck.base + 0.006, 0.075), V(0.016, 0.014, 0.02)), 0.008);
  // pubic mound closes the pelvis smoothly (no genital detail)
  const box = [-0.3, sp.torso[0][0] - 0.04, -0.2, 0.3, sp.torso[sp.torso.length - 1][0] + 0.03, 0.2];
  return { f, box };
}

function buildNeck(sp) {
  const F = sp.face, H = sp.headH, chinY = sp.stature - H;
  const list = [];
  const base = V(0, sp.neck.base - 0.02, sp.neck.z), top = V(0, chinY + 0.22 * H, sp.headZ - 0.038);
  list.push([roundCone(base, top, F.neckR * 1.12, F.neckR * 0.86), 0]);
  for (const s of [1, -1]) {
    // sterno-cleido-mastoid cords
    list.push([roundCone(V(s * 0.056, chinY + 0.3 * H, -0.024), V(s * 0.016, sp.neck.base + 0.006, 0.048), 0.0125 * F.scm + 0.003, 0.0135 * F.scm + 0.003), 0.02]);
  }
  if (F.adam > 0) list.push([ellipsoid(V(0, chinY - 0.03, sp.neck.z + F.neckR * 0.98), V(0.013, 0.022, 0.011)), 0.015]);
  let f = S.unionK(list);
  const box = boxOf([base, top], 0.13);
  return { f, box };
}

// ------------------------------------------------------------------------------------------------ arms + hands
function armGeometry(sp, side) {
  const [rx0, ry0, rz0] = sp.armRoot;
  const S0 = V(side * rx0, ry0, rz0);
  const a = sp.abduct * D2R, fl = sp.elbowFlex * D2R;
  const d1 = norm(V(side * Math.sin(a), -Math.cos(a), 0.02));
  const E = add(S0, mul(d1, sp.upperArm));
  const d2 = norm(V(side * Math.sin(a * 0.75), -Math.cos(a * 0.75) * Math.cos(fl), Math.sin(fl)));
  const Wr = add(E, mul(d2, sp.foreArm));
  return { S0, E, Wr, d1, d2 };
}

function buildArm(sp, side) {
  const g = armGeometry(sp, side);
  const k = sp.armR, m = sp.muscle;
  const { S0, E, Wr, d1, d2 } = g;
  const list = [];
  list.push([roundCone(S0, E, 0.0505 * k, 0.0375 * k), 0]);
  list.push([roundCone(E, Wr, 0.0395 * k, 0.0245 * k), 0.03]);
  const f1 = frameFor(d1, V(side, 0, 0)), f2 = frameFor(d2, V(side, 0, 0));
  const at1 = (t) => lerp3(S0, E, t), at2 = (t) => lerp3(E, Wr, t);
  // deltoid cap
  list.push([ellipsoid(add(S0, V(side * 0.014, 0.01, 0)), V(0.048 * k, 0.072 * k, 0.05 * k)), 0.05]);
  // biceps (front) + triceps (back) + brachialis
  list.push([ellipsoid(add(at1(0.46), V(side * 0.002, 0, 0.011 * m + 0.004)), V(0.034 * k, 0.098, 0.031 * k * (0.75 + 0.25 * m)), f1), 0.04]);
  list.push([ellipsoid(add(at1(0.40), V(side * 0.006, 0, -0.019 * m - 0.004)), V(0.036 * k, 0.108, 0.033 * k * (0.75 + 0.25 * m)), f1), 0.04]);
  // olecranon + medial epicondyle
  list.push([sphere(add(E, V(0, 0.002, -0.022 * k)), 0.021 * k), 0.02]);
  // forearm flexor / extensor mass (proximal belly)
  list.push([ellipsoid(add(at2(0.27), V(side * 0.003, 0, 0.004)), V(0.041 * k, 0.098, 0.036 * k), f2), 0.035]);
  list.push([ellipsoid(add(at2(0.2), V(side * 0.014 * k, 0, 0.012)), V(0.03 * k, 0.07, 0.03 * k), f2), 0.03]); // brachioradialis
  // wrist: styloid processes
  list.push([sphere(add(Wr, V(side * 0.014 * k, 0.0, -0.002)), 0.0115 * k), 0.008]);
  list.push([sphere(add(Wr, V(-side * 0.014 * k, 0.0, 0.0)), 0.0105 * k), 0.008]);
  const f = S.unionK(list);
  const box = boxOf([S0, E, Wr], 0.15);
  return { f, box, g };
}

/**
 * Relaxed neutral hand: palm + 4 fingers (3 phalanges each, gentle natural curl and splay) + thumb.
 * Frame: T = along the fingers, P = out of the palm (medial + slightly anterior), L = toward the thumb.
 */
function buildHand(sp, side, Wr, d2) {
  const k = sp.hand;
  const T = norm(d2);
  const P = norm(V(-side * Math.cos(38 * D2R), 0.0, Math.sin(38 * D2R)));
  const Pp = norm(sub(P, mul(T, dot(P, T))));
  let L = norm(cross(Pp, T)); // toward the thumb: anterior for the relaxed pose
  if (L[2] < 0) L = mul(L, -1);
  const wp = add(Wr, mul(T, 0.004 * k));
  const at = (m, lat, pal) => add(add(add(wp, mul(T, m * k)), mul(L, lat * k)), mul(Pp, pal * k));
  const list = [];
  // palm: a slightly wedge-shaped rounded box (wider at the knuckles, thickest at the thenar / hypothenar)
  const palmC = at(0.047, 0.0, -0.001);
  const fr = { u: L, v: T, w: Pp };
  list.push([roundBox(palmC, [0.0395 * k, 0.0505 * k, 0.0125 * k], 0.011 * k, fr), 0]);
  list.push([ellipsoid(at(0.022, 0.028, 0.006), V(0.0245 * k, 0.0345 * k, 0.0175 * k), fr), 0.02]); // thenar eminence
  list.push([ellipsoid(at(0.03, -0.028, 0.002), V(0.016 * k, 0.038 * k, 0.014 * k), fr), 0.02]); // hypothenar
  // fingers: [lateral offset at the knuckle, length scale, base radius, splay (rad), flexion at MCP/PIP/DIP (deg)]
  const fingers = [
    [0.0285, 0.94, 0.0085, 0.10, [16, 26, 16]], // index
    [0.0095, 1.0, 0.0088, 0.02, [22, 34, 20]], // middle
    [-0.0105, 0.95, 0.0083, -0.05, [28, 40, 22]], // ring
    [-0.0295, 0.76, 0.0074, -0.13, [34, 44, 24]], // little
  ];
  const seg = [0.045, 0.028, 0.0215]; // phalanx lengths (proximal, middle, distal) for the middle finger, metres
  for (const [lat, ls, r0, splay, flex] of fingers) {
    let p = at(0.1, lat, -0.0005);
    let dir = norm(add(add(T, mul(L, splay)), V(0, 0, 0)));
    let rad = r0 * k;
    let bend = 0;
    for (let i = 0; i < 3; i++) {
      bend += flex[i] * D2R;
      // rotate `dir` toward the palm (-Pp is the back of the hand; fingers curl toward +Pp)
      const cur = norm(add(mul(dir, Math.cos(bend * 0.62)), mul(Pp, Math.sin(bend * 0.62))));
      const q = add(p, mul(cur, seg[i] * ls * k));
      const r1 = rad * (i === 2 ? 0.78 : 0.9);
      list.push([roundCone(p, q, rad, r1), i === 0 ? 0.008 : 0.004]);
      p = q; rad = r1;
    }
    list.push([sphere(p, rad * 0.98), 0.004]); // fingertip pulp
  }
  // thumb: metacarpal + proximal + distal phalanx, opposed slightly across the palm
  let tp = at(0.018, 0.03, 0.006);
  const tdir0 = norm(add(add(mul(T, 0.62), mul(L, 0.64)), mul(Pp, 0.28)));
  const tseg = [0.04, 0.034, 0.029], trad = [0.0135, 0.0115, 0.0102];
  let cdir = tdir0;
  for (let i = 0; i < 3; i++) {
    const nd = norm(add(cdir, mul(Pp, 0.12 * i)));
    const q = add(tp, mul(nd, tseg[i] * k));
    list.push([roundCone(tp, q, trad[i] * k, (i === 2 ? 0.0095 : trad[i + 1]) * k), i === 0 ? 0.014 : 0.006]);
    tp = q; cdir = norm(add(nd, mul(T, 0.08)));
  }
  list.push([sphere(tp, 0.0096 * k), 0.004]);
  const f = S.unionK(list);
  const box = boxOf([wp, add(wp, mul(T, 0.2 * k)), add(wp, mul(L, 0.06)), add(wp, mul(L, -0.06))], 0.045);
  return { f, box, frame: { T, P: Pp, L } };
}

// ------------------------------------------------------------------------------------------------ legs + feet
function legGeometry(sp, side) {
  const hip = V(side * sp.hipX, sp.troch + 0.01, 0.0);
  const knee = V(side * (sp.hipX - 0.006), hip[1] - sp.thigh, 0.014);
  const ankle = V(side * (sp.hipX - 0.008), 0.085, -0.004);
  return { hip, knee, ankle };
}

function buildLeg(sp, side) {
  const { hip, knee, ankle } = legGeometry(sp, side);
  const k = sp.legR, m = sp.muscle;
  const list = [];
  const thighDir = norm(sub(knee, hip)), shinDir = norm(sub(ankle, knee));
  const ft = frameFor(thighDir, V(side, 0, 0)), fs = frameFor(shinDir, V(side, 0, 0));
  list.push([roundCone(add(hip, V(0, 0.02, 0)), knee, 0.08 * k, 0.05 * k), 0]);
  list.push([roundCone(knee, ankle, 0.049 * k, 0.031 * k), 0.035]);
  const th = (t) => lerp3(hip, knee, t), sh = (t) => lerp3(knee, ankle, t);
  const mm = 0.6 + 0.4 * m;
  // quadriceps (rectus + vastus lateralis) and the vastus medialis teardrop above the knee
  list.push([ellipsoid(add(th(0.42), V(side * 0.006, 0, 0.022)), V(0.06 * k, 0.16, 0.05 * k * mm), ft), 0.05]);
  list.push([ellipsoid(add(th(0.4), V(side * 0.03 * k, 0, 0.004)), V(0.042 * k, 0.15, 0.048 * k), ft), 0.05]);
  list.push([ellipsoid(add(th(0.86), V(-side * 0.02 * k, 0, 0.026)), V(0.034 * k, 0.062, 0.03 * k * mm), ft), 0.03]);
  // hamstrings + adductors
  list.push([ellipsoid(add(th(0.4), V(0, 0, -0.03 * k)), V(0.06 * k, 0.16, 0.046 * k), ft), 0.05]);
  list.push([ellipsoid(add(th(0.32), V(-side * 0.03 * k, 0, 0.0)), V(0.04 * k, 0.15, 0.05 * k), ft), 0.05]);
  // patella + tibial tuberosity + popliteal fill
  list.push([ellipsoid(add(knee, V(0, 0.006, 0.044 * k)), V(0.026, 0.03, 0.012), ft), 0.02]);
  list.push([ellipsoid(add(knee, V(0, -0.005, -0.024)), V(0.048 * k, 0.045, 0.03), ft), 0.03]);
  // calf: medial + lateral gastrocnemius, soleus, tibial crest, malleoli, Achilles
  list.push([ellipsoid(add(sh(0.22), V(-side * 0.014 * k, 0, -0.026)), V(0.033 * k, 0.098, 0.038 * k * mm), fs), 0.04]);
  list.push([ellipsoid(add(sh(0.24), V(side * 0.016 * k, 0, -0.022)), V(0.029 * k, 0.088, 0.033 * k * mm), fs), 0.04]);
  list.push([ellipsoid(add(sh(0.4), V(0, 0, -0.012)), V(0.032 * k, 0.11, 0.032 * k), fs), 0.04]);
  list.push([roundCone(add(sh(0.06), V(-side * 0.002, 0, 0.038 * k)), add(sh(0.78), V(0, 0, 0.026 * k)), 0.0115, 0.0085), 0.02]);
  list.push([sphere(add(ankle, V(-side * 0.028 * k, 0.004, 0.0)), 0.0115 * k), 0.014]);
  list.push([sphere(add(ankle, V(side * 0.028 * k, -0.007, -0.004)), 0.011 * k), 0.014]);
  list.push([roundCone(add(sh(0.62), V(0, 0, -0.03 * k)), add(ankle, V(0, -0.03, -0.034)), 0.015, 0.02), 0.02]);
  const f = S.unionK(list);
  return { f, box: boxOf([hip, knee, ankle], 0.15), g: { hip, knee, ankle } };
}

function buildFoot(sp, side, ankle) {
  const k = sp.footLen / 0.265, tk = sp.footToe;
  const yaw = side * 8 * D2R; // toes point slightly outward
  const Fz = V(Math.sin(yaw), 0, Math.cos(yaw)), Fx = V(Math.cos(yaw), 0, -Math.sin(yaw));
  const base = V(ankle[0] + side * 0.002, 0, ankle[2] - 0.04 * k);
  const P = (fwd, lat, up) => add(add(add(base, mul(Fz, fwd * k)), mul(Fx, lat * side * k)), V(0, up * k, 0));
  const fr = { u: Fx, v: V(0, 1, 0), w: Fz };
  const list = [];
  // heel (calcaneus + fat pad), hind-foot, instep, forefoot ball: one continuous wedge, tall behind, flat in front
  list.push([ellipsoid(P(0.03, 0, 0.036), V(0.033 * k, 0.037 * k, 0.05 * k), fr), 0]);
  list.push([roundCone(P(0.045, 0, 0.045), P(0.115, 0, 0.038), 0.034 * k, 0.03 * k), 0.035]);
  list.push([roundCone(P(0.105, 0, 0.036), P(0.165, 0, 0.026), 0.031 * k, 0.029 * k), 0.03]);
  list.push([ellipsoid(P(0.15, 0, 0.0235), V(0.043 * k, 0.0235 * k, 0.05 * k), fr), 0.03]);
  // toes: lie on the floor, slightly tapering; the big toe is the heaviest
  const toes = [
    [-0.031, 0.072, 0.0125, 0.0155], [-0.0125, 0.065, 0.0084, 0.0125], [0.0045, 0.059, 0.008, 0.0118], [0.0195, 0.052, 0.0074, 0.0112], [0.0335, 0.043, 0.0068, 0.0106],
  ];
  for (const [lat, ln, r, hh] of toes) {
    const a = P(0.172, lat, hh), b = P(0.172 + ln * tk, lat * 1.05, hh - 0.0015);
    list.push([roundCone(a, b, r * k, r * 0.88 * k), 0.012]);
  }
  let f = S.unionK(list);
  // medial longitudinal arch: lift the sole between the heel and the ball of the foot
  f = S.carve(f, ellipsoid(P(0.085, -0.02, -0.006), V(0.028 * k, 0.03 * k, 0.06 * k), fr), 0.02);
  const g = (x, y, z) => smax(f(x, y, z), -y, 0.004); // flat contact with the floor (y = 0)
  return { f: g, box: boxOf([base, P(0.25, 0, 0.03), P(0.0, 0.06, 0.05), P(0, -0.06, 0.05)], 0.06) };
}

// ------------------------------------------------------------------------------------------------ assembly
function buildHuman(key) {
  const sp = specFor(key);
  const H = sp.headH, chinY = sp.stature - H;
  const head = buildHead(sp);
  const torso = buildTorso(sp);
  const neck = buildNeck(sp);
  const parts = { torso: { f: torso.f, box: torso.box }, neck: { f: neck.f, box: neck.box }, head: { f: head.head, box: head.box } };
  const limbs = {};
  for (const side of [1, -1]) {
    const nm = side > 0 ? 'L' : 'R';
    const arm = buildArm(sp, side);
    const hand = buildHand(sp, side, arm.g.Wr, arm.g.d2);
    const leg = buildLeg(sp, side);
    const foot = buildFoot(sp, side, leg.g.ankle);
    parts['arm' + nm] = { f: arm.f, box: arm.box };
    parts['hand' + nm] = { f: hand.f, box: hand.box };
    parts['leg' + nm] = { f: leg.f, box: leg.box };
    parts['foot' + nm] = { f: foot.f, box: foot.box };
    limbs[nm] = { arm: arm.g, hand: hand.frame, leg: leg.g };
  }
  for (const e of head.ears) parts['ear' + (e.side > 0 ? 'L' : 'R')] = { f: e.f, box: e.box };

  // limb + extremity groups are pre-blended (tight k), then everything is blended into the trunk (larger k)
  const group = (a, b, k) => ({ f: (x, y, z) => smin(a.f(x, y, z), b.f(x, y, z), k), box: [Math.min(a.box[0], b.box[0]), Math.min(a.box[1], b.box[1]), Math.min(a.box[2], b.box[2]), Math.max(a.box[3], b.box[3]), Math.max(a.box[4], b.box[4]), Math.max(a.box[5], b.box[5])] });
  const armL = group(parts.armL, parts.handL, 0.014), armR = group(parts.armR, parts.handR, 0.014);
  const legL = group(parts.legL, parts.footL, 0.02), legR = group(parts.legR, parts.footR, 0.02);
  const sdf = makeBlend([
    { f: parts.torso.f, box: parts.torso.box, k: 0 },
    { f: parts.neck.f, box: parts.neck.box, k: 0.055 },
    { f: parts.head.f, box: parts.head.box, k: 0.012 },
    { f: armL.f, box: armL.box, k: 0.035 }, { f: armR.f, box: armR.box, k: 0.035 },
    { f: legL.f, box: legL.box, k: 0.05 }, { f: legR.f, box: legR.box, k: 0.05 },
  ]);
  const bounds = { min: [-0.46, -0.004, -0.16], max: [0.46, sp.stature + 0.01, 0.30] };
  const Wd = (x, y, z) => V(x * H, chinY + y * H, sp.headZ + z * H);
  const refineZones = [
    { c: Wd(0, 0.42, 0.28), r: 0.62 * H, edge: 0.0032 }, // whole face
    { c: Wd(0, 0.162, 0.4), r: 0.15 * H, edge: 0.0016 }, // lips
    { c: Wd(0, 0.31, 0.43), r: 0.12 * H, edge: 0.0019 }, // nose
    ...head.eyes.map((e) => ({ c: e.c, r: 0.1 * H, edge: 0.0012 })), // eyes + lids
    ...head.ears.map((e) => ({ c: e.c, r: 0.15 * H, edge: 0.0028 })),
  ];
  return { spec: sp, sdf, parts, limbs, head, eyes: head.eyes, ears: head.ears, bounds, chinY, H, refine: refineZones };
}

module.exports = { buildHuman, specFor, MALE, FEMALE, armGeometry, legGeometry };
