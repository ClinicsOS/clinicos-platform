'use strict';
/**
 * Clinical hit layer: assigns every triangle of the visible skin to ONE registry region id.
 *
 * The visible model knows nothing about regions. Ownership is decided in two steps:
 *  1. which anatomical PART produced that piece of skin (nearest part SDF: head / neck / torso / arm / hand / leg / foot / ear),
 *  2. the SHARED region rules (frontEnd/src/components/derm/engine/regionRules.ts — the same functions the development
 *     body uses) map the position inside that part to a registry id.
 * Left = the patient's left = +X, always.
 */
const { loadTs } = require('./tsload.js');
const rules = loadTs('frontEnd/src/components/derm/engine/regionRules.ts');
const registry = loadTs('frontEnd/src/lib/derm/regions.ts');
const { armGeometry, legGeometry } = require('./human.js');
const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Arc-length parameter of the point on a polyline nearest to p (clamped at both ends). */
function polyS(poly, p) {
  let best = Infinity, bs = 0, acc = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
    let t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2; t = Math.max(0, Math.min(1, t));
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const d = D(p, q);
    if (d < best) { best = d; bs = acc + Math.sqrt(l2) * t; }
    acc += Math.sqrt(l2);
  }
  return bs;
}

function classifyTriangles(human, mesh, opts = {}) {
  const sp = human.spec, { positions: P, indices: I, normals: N } = mesh;
  const nt = I.length / 3;
  const ids = registry.REGION_IDS;
  const idIndex = new Map(ids.map((id, i) => [id, i]));
  // part SDFs used for ownership (the head WITHOUT ears, so ears can own their own skin)
  const parts = { torso: human.parts.torso.f, neck: human.parts.neck.f, head: human.head.headOnly };
  for (const nm of ['L', 'R']) for (const k of ['arm', 'hand', 'leg', 'foot', 'ear']) parts[k + nm] = human.parts[k + nm].f;
  const names = Object.keys(parts);
  const armPoly = {}, legPoly = {}, armL1 = sp.upperArm, legL1 = sp.thigh;
  for (const [nm, side] of [['L', 1], ['R', -1]]) {
    const a = armGeometry(sp, side); armPoly[nm] = [a.S0, a.E, a.Wr];
    const l = legGeometry(sp, side); legPoly[nm] = [l.hip, l.knee, l.ankle];
  }
  const legLen = {}; for (const nm of ['L', 'R']) legLen[nm] = D(legPoly[nm][0], legPoly[nm][1]) + D(legPoly[nm][1], legPoly[nm][2]);
  const chinY = human.chinY, H = human.H, hz = sp.headZ;
  const label = new Int16Array(nt), owner = new Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const x = (P[a] + P[b] + P[c]) / 3, y = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    const nz = (N[a + 2] + N[b + 2] + N[c + 2]) / 3;
    let best = Infinity, who = 'torso';
    for (const nm of names) { const d = parts[nm](x, y, z); if (d < best) { best = d; who = nm; } }
    // The neck column (between the base of the neck and just under the chin, close to the midline) is always the neck:
    // on the slimmer female neck the jaw / torso lofts would otherwise swallow the anterior neck.
    if ((who === 'torso' || who === 'head') && y > sp.neck.base + 0.005 && y < chinY + 0.012 && Math.abs(x) < 0.075 + (y - sp.neck.base) * 0.0) who = 'neck';
    owner[t] = who;
    const side = x >= 0 ? 1 : -1, Ls = side > 0 ? 'left' : 'right';
    let id;
    if (who === 'torso') id = rules.classifyTorso(sp, x, y, z);
    else if (who === 'neck') { const th = (Math.atan2(Math.abs(x), z - (sp.neck.z + 0.004)) * 180) / Math.PI; id = rules.classifyNeck(side, th); }
    else if (who === 'head') {
      const X = Math.abs(x) / H, Y = (y - chinY) / H, Z = (z - hz) / H;
      const theta = (Math.atan2(Math.abs(x), z - hz) * 180) / Math.PI;
      id = rules.classifyHead(side, X, Y, Z, theta, nz);
    } else if (who.startsWith('ear')) id = who.endsWith('L') ? 'left_ear' : 'right_ear';
    else if (who.startsWith('arm')) { const nm = who.slice(3); id = rules.classifyArm(nm === 'L' ? 1 : -1, polyS(armPoly[nm], [x, y, z]), armL1); }
    else if (who.startsWith('hand')) id = who.endsWith('L') ? 'left_hand' : 'right_hand';
    else if (who.startsWith('leg')) { const nm = who.slice(3); id = rules.classifyLeg(nm === 'L' ? 1 : -1, polyS(legPoly[nm], [x, y, z]), legL1, legLen[nm]); }
    else if (who.startsWith('foot')) id = y > (opts.ankleY ?? 0.072) ? `${who.endsWith('L') ? 'left' : 'right'}_ankle` : `${who.endsWith('L') ? 'left' : 'right'}_foot`;
    else id = 'abdomen';
    label[t] = idIndex.has(id) ? idIndex.get(id) : -1;
  }
  return { label, owner, ids };
}

/**
 * Removes speckle: connected groups of < minTris triangles that touch another region are absorbed by the neighbour they
 * share the most edges with. Regions never disappear (the largest group of each label is always kept).
 */
function cleanLabels(indices, label, minTris = 14) {
  const nt = indices.length / 3;
  const edge = new Map();
  const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  const nb = Array.from({ length: nt }, () => []);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const k = key(indices[t * 3 + e], indices[t * 3 + (e + 1) % 3]);
    const o = edge.get(k);
    if (o === undefined) edge.set(k, t); else { nb[t].push(o); nb[o].push(t); }
  }
  for (let pass = 0; pass < 3; pass++) {
    const comp = new Int32Array(nt).fill(-1); const comps = [];
    for (let t = 0; t < nt; t++) {
      if (comp[t] >= 0) continue;
      const id = comps.length, list = [t]; comp[t] = id;
      for (let i = 0; i < list.length; i++) for (const u of nb[list[i]]) if (comp[u] < 0 && label[u] === label[t]) { comp[u] = id; list.push(u); }
      comps.push(list);
    }
    const largest = new Map();
    comps.forEach((l, i) => { const lab = label[l[0]]; if (!largest.has(lab) || comps[largest.get(lab)].length < l.length) largest.set(lab, i); });
    let changed = 0;
    comps.forEach((list, i) => {
      const lab = label[list[0]];
      if (list.length >= minTris || largest.get(lab) === i) return;
      const votes = new Map();
      for (const t of list) for (const u of nb[t]) if (label[u] !== lab) votes.set(label[u], (votes.get(label[u]) || 0) + 1);
      let best = -2, bv = 0; votes.forEach((v, k) => { if (v > bv) { bv = v; best = k; } });
      if (best !== -2) { for (const t of list) label[t] = best; changed++; }
    });
    if (!changed) break;
  }
  return label;
}

/** Majority smoothing of region borders (kills sawtooth borders on coarse triangles). Never empties a region. */
function smoothLabels(indices, label, iterations = 4) {
  const nt = indices.length / 3;
  const edge = new Map();
  const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  const nb = Array.from({ length: nt }, () => []);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const k = key(indices[t * 3 + e], indices[t * 3 + (e + 1) % 3]);
    const o = edge.get(k);
    if (o === undefined) edge.set(k, t); else { nb[t].push(o); nb[o].push(t); }
  }
  const count = new Map(); for (let t = 0; t < nt; t++) count.set(label[t], (count.get(label[t]) || 0) + 1);
  for (let it = 0; it < iterations; it++) {
    const next = label.slice();
    for (let t = 0; t < nt; t++) {
      const own = label[t]; const votes = new Map();
      for (const u of nb[t]) votes.set(label[u], (votes.get(label[u]) || 0) + 1);
      const ownVotes = votes.get(own) || 0;
      let best = own, bv = ownVotes;
      votes.forEach((v, k) => { if (v > bv) { bv = v; best = k; } });
      if (best !== own && bv >= 2 && ownVotes <= 1 && count.get(own) > 1) { next[t] = best; count.set(own, count.get(own) - 1); count.set(best, (count.get(best) || 0) + 1); }
    }
    label.set(next);
  }
  return label;
}

/**
 * Boundary relaxation (curvature-flow-like): each triangle takes the majority label of its 2-ring neighbourhood when
 * that majority clearly beats its own label. Straightens zig-zag borders left by the coarse triangles. Never empties a
 * region (a region keeps at least `keep` triangles).
 */
function relaxLabels(indices, label, iterations = 6, keep = 16) {
  const nt = indices.length / 3;
  const edge = new Map();
  const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  const nb = Array.from({ length: nt }, () => []);
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const k = key(indices[t * 3 + e], indices[t * 3 + (e + 1) % 3]);
    const o = edge.get(k);
    if (o === undefined) edge.set(k, t); else { nb[t].push(o); nb[o].push(t); }
  }
  const ring2 = nb.map((n, t) => { const s = new Set(n); for (const u of n) for (const w of nb[u]) if (w !== t) s.add(w); return Array.from(s); });
  const count = new Map(); for (let t = 0; t < nt; t++) count.set(label[t], (count.get(label[t]) || 0) + 1);
  for (let it = 0; it < iterations; it++) {
    const next = label.slice(); let flips = 0;
    for (let t = 0; t < nt; t++) {
      const own = label[t]; const votes = new Map();
      for (const u of ring2[t]) votes.set(label[u], (votes.get(label[u]) || 0) + 1);
      const ownV = votes.get(own) || 0;
      let best = own, bv = ownV; votes.forEach((v, k) => { if (v > bv) { bv = v; best = k; } });
      if (best !== own && bv > ownV + 2 && count.get(own) > keep) { next[t] = best; count.set(own, count.get(own) - 1); count.set(best, (count.get(best) || 0) + 1); flips++; }
    }
    label.set(next);
    if (!flips) break;
  }
  return label;
}
module.exports = { classifyTriangles, cleanLabels, smoothLabels, relaxLabels, registry, rules };
