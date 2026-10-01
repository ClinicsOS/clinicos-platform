'use strict';
/**
 * Tiny signed-distance-field toolkit (no dependencies) used to sculpt the Dermatology & Aesthetics clinical human.
 * Everything is a plain closure (x, y, z) -> signed distance in metres (negative inside). The primitives are exact or
 * conservative bounds (good enough for surface extraction + smooth blending); the surface is the zero level set.
 *
 * `smin`/`smax` are polynomial smooth min/max: they are what makes the body ONE continuous skin (neck -> shoulder ->
 * arm, torso -> thigh, wrist -> hand) instead of an assembly of separate tubes.
 */
const sqrt = Math.sqrt, min = Math.min, max = Math.max, abs = Math.abs;

const smin = (a, b, k) => { const h = max(k - abs(a - b), 0) / k; return min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => { const h = max(k - abs(a - b), 0) / k; return max(a, b) + h * h * k * 0.25; };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => sqrt(dot(a, a));
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function sphere(c, r) {
  const [cx, cy, cz] = c;
  return (x, y, z) => { const dx = x - cx, dy = y - cy, dz = z - cz; return sqrt(dx * dx + dy * dy + dz * dz) - r; };
}

/** Orthonormal frame with `v` = the long axis. `hint` picks the direction of the first axis. */
function frameFor(v, hint) {
  const V = norm(v);
  let u = sub(hint, mul(V, dot(hint, V)));
  if (len(u) < 1e-6) u = sub([0, 0, 1], mul(V, V[2]));
  u = norm(u);
  const w = norm(cross(u, V));
  return { u, v: V, w };
}

/**
 * Ellipsoid (iq's bound). `fr` = optional {u,v,w} local axes (radii are along u, v, w); default = world axes.
 */
function ellipsoid(c, r, fr) {
  const [cx, cy, cz] = c, [rx, ry, rz] = r;
  if (!fr) {
    return (x, y, z) => {
      const px = (x - cx) / rx, py = (y - cy) / ry, pz = (z - cz) / rz;
      const k0 = sqrt(px * px + py * py + pz * pz);
      if (k0 < 1e-9) return -min(rx, ry, rz);
      const qx = px / rx, qy = py / ry, qz = pz / rz;
      const k1 = sqrt(qx * qx + qy * qy + qz * qz);
      return (k0 * (k0 - 1)) / k1;
    };
  }
  const u = fr.u, v = fr.v, w = fr.w;
  return (x, y, z) => {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const lx = dx * u[0] + dy * u[1] + dz * u[2], ly = dx * v[0] + dy * v[1] + dz * v[2], lz = dx * w[0] + dy * w[1] + dz * w[2];
    const px = lx / rx, py = ly / ry, pz = lz / rz;
    const k0 = sqrt(px * px + py * py + pz * pz);
    if (k0 < 1e-9) return -min(rx, ry, rz);
    const qx = px / rx, qy = py / ry, qz = pz / rz;
    const k1 = sqrt(qx * qx + qy * qy + qz * qz);
    return (k0 * (k0 - 1)) / k1;
  };
}

/** Round cone between a and b (radius ra at a, rb at b): exact. Also used as a capsule when ra == rb. */
function roundCone(a, b, ra, rb) {
  const ba = sub(b, a), l2 = dot(ba, ba), rr = ra - rb, a2 = l2 - rr * rr, il2 = 1 / l2;
  if (a2 <= 1e-10) { const sa = sphere(a, ra), sb = sphere(b, rb); return (x, y, z) => Math.min(sa(x, y, z), sb(x, y, z)); } // one end swallows the other
  const [ax, ay, az] = a;
  return (x, y, z) => {
    const px = x - ax, py = y - ay, pz = z - az;
    const z_ = px * ba[0] + py * ba[1] + pz * ba[2];
    const x2 = (px * l2 - ba[0] * z_) * (px * l2 - ba[0] * z_) + (py * l2 - ba[1] * z_) * (py * l2 - ba[1] * z_) + (pz * l2 - ba[2] * z_) * (pz * l2 - ba[2] * z_);
    // (iq) sdRoundCone
    const yy = z_ * z_ * l2;
    const zz = (z_ - l2) * (z_ - l2) * l2;
    const xx = x2;
    const k = Math.sign(rr) * rr * rr * xx;
    if (Math.sign(z_ - l2) * a2 * zz > k) return sqrt(xx + zz) * il2 - rb;
    if (Math.sign(z_) * a2 * yy < k) return sqrt(xx + yy) * il2 - ra;
    return (sqrt(xx * a2 * il2) + z_ * rr) * il2 - ra;
  };
}

/** Rounded box centred on c with half-extents h, local frame fr={u,v,w}, corner radius r. */
function roundBox(c, h, r, fr) {
  const [cx, cy, cz] = c, u = fr.u, v = fr.v, w = fr.w;
  return (x, y, z) => {
    const dx = x - cx, dy = y - cy, dz = z - cz;
    const qx = abs(dx * u[0] + dy * u[1] + dz * u[2]) - h[0] + r, qy = abs(dx * v[0] + dy * v[1] + dz * v[2]) - h[1] + r, qz = abs(dx * w[0] + dy * w[1] + dz * w[2]) - h[2] + r;
    const ox = max(qx, 0), oy = max(qy, 0), oz = max(qz, 0);
    return sqrt(ox * ox + oy * oy + oz * oz) + min(max(qx, qy, qz), 0) - r;
  };
}

/** Smooth union of many shapes with ONE k (sequential polynomial smin). */
function union(fs, k) {
  const n = fs.length;
  return (x, y, z) => { let d = fs[0](x, y, z); for (let i = 1; i < n; i++) d = smin(d, fs[i](x, y, z), k); return d; };
}
/** Smooth union of [f, k] pairs: each shape has its own blend radius against the accumulated shape. */
function unionK(items) {
  const n = items.length;
  return (x, y, z) => { let d = items[0][0](x, y, z); for (let i = 1; i < n; i++) d = smin(d, items[i][0](x, y, z), items[i][1]); return d; };
}
/** Carve: base minus tool with smooth edge k. */
const carve = (base, tool, k) => (x, y, z) => smax(base(x, y, z), -tool(x, y, z), k);
/** Smooth union of two shape FUNCTIONS. */
const su = (a, b, k) => (x, y, z) => smin(a(x, y, z), b(x, y, z), k);

/**
 * A bounded shape: `box` = [x0,y0,z0,x1,y1,z1] must contain the shape (expanded by the widest blend that touches it).
 * `withBox(f, box)` returns f but cheap-rejects far points: outside the box it returns the (lower-bound) box distance.
 */
function boxDist(x, y, z, b) {
  const dx = max(b[0] - x, 0, x - b[3]), dy = max(b[1] - y, 0, y - b[4]), dz = max(b[2] - z, 0, z - b[5]);
  return sqrt(dx * dx + dy * dy + dz * dz);
}
const withBox = (f, b) => (x, y, z) => { const d = boxDist(x, y, z, b); return d > 0 ? d + 0.0 : f(x, y, z); };
/** Like withBox but lets the caller pass the current best distance so the part is skipped entirely when it cannot matter. */
function boxOf(points, pad) {
  const b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
  for (const p of points) for (let i = 0; i < 3; i++) { b[i] = min(b[i], p[i] - pad); b[i + 3] = max(b[i + 3], p[i] + pad); }
  return b;
}

module.exports = { smin, smax, sub, add, mul, dot, len, norm, cross, lerp3, sphere, ellipsoid, roundCone, roundBox, union, unionK, carve, su, frameFor, boxDist, withBox, boxOf };
