'use strict';
/**
 * Conforming local refinement: long edges inside the given spheres are split at their midpoint, which is then projected
 * back onto the true SDF surface (so refinement adds REAL detail, it does not just add triangles). Midpoints are shared
 * between neighbouring triangles (edge map), so the mesh stays crack-free. Used on the face (eyes, lips, nose, ears),
 * where the 3 mm lattice is too coarse for a believable result.
 */
function refine(positions, indices, sdf, zones, maxPasses = 5) {
  const P = Array.from(positions);
  let I = Array.from(indices);
  const key = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  const g = 0.0004;
  // `lim` = the largest displacement allowed (a fraction of the edge being split): near sharp creases the SDF gradient is
  // unreliable and an unbounded Newton step can throw the new vertex centimetres away (long sliver triangles).
  const project = (x, y, z, lim) => {
    const x0 = x, y0 = y, z0 = z;
    for (let it = 0; it < 2; it++) {
      const d = sdf(x, y, z);
      const gx = (sdf(x + g, y, z) - sdf(x - g, y, z)) / (2 * g), gy = (sdf(x, y + g, z) - sdf(x, y - g, z)) / (2 * g), gz = (sdf(x, y, z + g) - sdf(x, y, z - g)) / (2 * g);
      const l2 = gx * gx + gy * gy + gz * gz;
      if (l2 < 1e-10) break;
      let sx = (gx * d) / l2, sy = (gy * d) / l2, sz = (gz * d) / l2;
      const m = Math.hypot(sx, sy, sz);
      if (m > lim) { const k = lim / m; sx *= k; sy *= k; sz *= k; }
      x -= sx; y -= sy; z -= sz;
    }
    const tot = Math.hypot(x - x0, y - y0, z - z0);
    if (tot > lim) { const k = lim / tot; return [x0 + (x - x0) * k, y0 + (y - y0) * k, z0 + (z - z0) * k]; }
    return [x, y, z];
  };
  const target = (x, y, z) => {
    let t = Infinity;
    for (const zn of zones) { const d = Math.hypot(x - zn.c[0], y - zn.c[1], z - zn.c[2]); if (d < zn.r && zn.edge < t) t = zn.edge; }
    return t;
  };
  for (let pass = 0; pass < maxPasses; pass++) {
    const mid = new Map();
    const getMid = (a, b) => {
      const k = key(a, b); let m = mid.get(k);
      if (m === undefined) {
        const el = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
        const p = project((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2, el * 0.35);
        m = P.length / 3; P.push(p[0], p[1], p[2]); mid.set(k, m);
      }
      return m;
    };
    const wantSplit = new Set();
    const need = (a, b) => {
      const k = key(a, b);
      if (wantSplit.has(k)) return true;
      const mx = (P[a * 3] + P[b * 3]) / 2, my = (P[a * 3 + 1] + P[b * 3 + 1]) / 2, mz = (P[a * 3 + 2] + P[b * 3 + 2]) / 2;
      const tg = target(mx, my, mz);
      if (tg === Infinity) return false;
      const len = Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
      if (len > tg * 1.35) { wantSplit.add(k); return true; }
      return false;
    };
    for (let t = 0; t < I.length; t += 3) { need(I[t], I[t + 1]); need(I[t + 1], I[t + 2]); need(I[t + 2], I[t]); }
    if (wantSplit.size === 0) break;
    const out = [];
    const dist = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    for (let t = 0; t < I.length; t += 3) {
      let v = [I[t], I[t + 1], I[t + 2]];
      const s = [wantSplit.has(key(v[0], v[1])), wantSplit.has(key(v[1], v[2])), wantSplit.has(key(v[2], v[0]))];
      const n = s[0] + s[1] + s[2];
      if (n === 0) { out.push(v[0], v[1], v[2]); continue; }
      if (n === 1) {
        const i = s.indexOf(true); const a = v[i], b = v[(i + 1) % 3], c = v[(i + 2) % 3]; const m = getMid(a, b);
        out.push(a, m, c, m, b, c);
      } else if (n === 2) {
        const un = s.indexOf(false); // the unsplit edge is (v[un], v[un+1]); rotate so it is the LAST edge (v2 -> v0)
        const r = (un + 1) % 3; // new v0 = v[r] ... edges e0=(v0,v1) and e1=(v1,v2) are split
        const a = v[r], b = v[(r + 1) % 3], c = v[(r + 2) % 3];
        const m0 = getMid(a, b), m1 = getMid(b, c);
        out.push(m0, b, m1);
        if (dist(a, m1) < dist(m0, c)) out.push(a, m0, m1, a, m1, c); else out.push(a, m0, c, m0, m1, c);
      } else {
        const m0 = getMid(v[0], v[1]), m1 = getMid(v[1], v[2]), m2 = getMid(v[2], v[0]);
        out.push(v[0], m0, m2, m0, v[1], m1, m2, m1, v[2], m0, m1, m2);
      }
    }
    I = out;
  }
  return { positions: Float32Array.from(P), indices: Uint32Array.from(I) };
}
module.exports = { refine };
