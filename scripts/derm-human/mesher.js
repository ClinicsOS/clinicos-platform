'use strict';
/**
 * Sparse Surface Nets over an SDF. Only cells near the surface are evaluated (coarse block pass), vertices are then
 * projected onto the true zero level set (Newton steps along the gradient) so the mesh has no lattice stair-stepping.
 * Returns { positions: Float32Array, indices: Uint32Array }.
 */
function surfaceNets(sdf, bounds, h, opts = {}) {
  const BLK = opts.block || 8;
  const nx = Math.ceil((bounds.max[0] - bounds.min[0]) / h) + 1, ny = Math.ceil((bounds.max[1] - bounds.min[1]) / h) + 1, nz = Math.ceil((bounds.max[2] - bounds.min[2]) / h) + 1;
  const ox = bounds.min[0], oy = bounds.min[1], oz = bounds.min[2];
  const N = nx * ny * nz;
  const val = new Float32Array(N).fill(NaN);
  const idx = (i, j, k) => (k * ny + j) * nx + i;
  let evals = 0;
  const at = (i, j, k) => {
    const id = idx(i, j, k);
    let v = val[id];
    if (v !== v) { v = sdf(ox + i * h, oy + j * h, oz + k * h); val[id] = v; evals++; }
    return v;
  };
  // 1) coarse pass: evaluate block centres, keep blocks that may contain the surface
  const bx = Math.ceil((nx - 1) / BLK), by = Math.ceil((ny - 1) / BLK), bz = Math.ceil((nz - 1) / BLK);
  const half = BLK * h * 0.5 * Math.sqrt(3) * 1.6 + 2 * h;
  const active = new Uint8Array(bx * by * bz);
  for (let K = 0; K < bz; K++) for (let J = 0; J < by; J++) for (let I = 0; I < bx; I++) {
    const cx = ox + (I * BLK + BLK / 2) * h, cy = oy + (J * BLK + BLK / 2) * h, cz = oz + (K * BLK + BLK / 2) * h;
    if (Math.abs(sdf(cx, cy, cz)) <= half) active[(K * by + J) * bx + I] = 1;
  }
  // 2) cells: evaluate corners of every cell in an active block, find sign changes, create vertices
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const cid = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
  const P = [];
  const cornerSign = new Float32Array(8);
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const CO = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  for (let K = 0; K < bz; K++) for (let J = 0; J < by; J++) for (let I = 0; I < bx; I++) {
    if (!active[(K * by + J) * bx + I]) continue;
    const i0 = I * BLK, j0 = J * BLK, k0 = K * BLK;
    const i1 = Math.min(i0 + BLK, nx - 1), j1 = Math.min(j0 + BLK, ny - 1), k1 = Math.min(k0 + BLK, nz - 1);
    for (let k = k0; k < k1; k++) for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) { const v = at(i + CO[c][0], j + CO[c][1], k + CO[c][2]); cornerSign[c] = v; if (v < 0) mask |= 1 << c; }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let e = 0; e < 12; e++) {
        const a = E[e][0], b = E[e][1];
        const va = cornerSign[a], vb = cornerSign[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        sx += CO[a][0] + (CO[b][0] - CO[a][0]) * t; sy += CO[a][1] + (CO[b][1] - CO[a][1]) * t; sz += CO[a][2] + (CO[b][2] - CO[a][2]) * t; n++;
      }
      cellVert[cid(i, j, k)] = P.length / 3;
      P.push(ox + (i + sx / n) * h, oy + (j + sy / n) * h, oz + (k + sz / n) * h);
    }
  }
  // 3) quads on every lattice edge that crosses the surface
  const I = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (!flip) I.push(a, c, b, a, d, c); else I.push(a, b, c, a, c, d); };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = val[idx(i, j, k)];
    if (v0 !== v0) continue;
    const s0 = v0 < 0;
    // x-edge
    let v1 = val[idx(i + 1, j, k)];
    if (v1 === v1 && (v1 < 0) !== s0) quad(cellVert[cid(i, j - 1, k - 1)], cellVert[cid(i, j, k - 1)], cellVert[cid(i, j, k)], cellVert[cid(i, j - 1, k)], s0);
    v1 = val[idx(i, j + 1, k)];
    if (v1 === v1 && (v1 < 0) !== s0) quad(cellVert[cid(i - 1, j, k - 1)], cellVert[cid(i - 1, j, k)], cellVert[cid(i, j, k)], cellVert[cid(i, j, k - 1)], s0);
    v1 = val[idx(i, j, k + 1)];
    if (v1 === v1 && (v1 < 0) !== s0) quad(cellVert[cid(i - 1, j - 1, k)], cellVert[cid(i, j - 1, k)], cellVert[cid(i, j, k)], cellVert[cid(i - 1, j, k)], s0);
  }
  // 4) project onto the true surface (Newton along the gradient)
  const pos = new Float32Array(P);
  const g = opts.grad || 0.0006;
  for (let it = 0; it < (opts.project ?? 2); it++) {
    for (let v = 0; v < pos.length; v += 3) {
      const x = pos[v], y = pos[v + 1], z = pos[v + 2];
      const d = sdf(x, y, z);
      const gx = sdf(x + g, y, z) - sdf(x - g, y, z), gy = sdf(x, y + g, z) - sdf(x, y - g, z), gz = sdf(x, y, z + g) - sdf(x, y, z - g);
      const l2 = gx * gx + gy * gy + gz * gz;
      if (l2 < 1e-12) continue;
      const s = d / (l2 / (4 * g * g)) * (1 / (2 * g));
      // gradient vector = (gx,gy,gz)/(2g); step = d * grad / |grad|^2
      const inv = (2 * g) / l2 * d;
      const stepx = gx * inv * 0.0 + (gx / (2 * g)) * d / ((l2) / (4 * g * g)), stepy = (gy / (2 * g)) * d / (l2 / (4 * g * g)), stepz = (gz / (2 * g)) * d / (l2 / (4 * g * g));
      const lim = h * 0.9, m = Math.hypot(stepx, stepy, stepz), sc = m > lim ? lim / m : 1;
      pos[v] = x - stepx * sc; pos[v + 1] = y - stepy * sc; pos[v + 2] = z - stepz * sc;
    }
  }
  return { positions: pos, indices: Uint32Array.from(I), evals, cells: nx * ny * nz };
}
module.exports = { surfaceNets };
