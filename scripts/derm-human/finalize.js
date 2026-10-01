'use strict';
/**
 * SDF -> final render mesh: surface nets at fine resolution, attribute-aware simplification (curvature keeps its
 * vertices, flat skin loses them), analytic normals from the SDF gradient (perfectly smooth shading independent of the
 * triangle count), baked ambient occlusion + subtle anatomical tint as vertex colours.
 */
const { surfaceNets } = require('./mesher.js');
const { refine } = require('./refine.js');

function gradient(sdf, x, y, z, e = 0.0006) {
  const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

/** Ambient occlusion from the distance field: how much of the neighbourhood along the normal is solid. 1 = open, 0 = closed. */
function ambientOcclusion(sdf, p, n) {
  let occ = 0, w = 1;
  for (let i = 1; i <= 5; i++) {
    const t = 0.006 * i * i * 0.6 + 0.004 * i; // 0.010 .. ~0.09 m
    const d = sdf(p[0] + n[0] * t, p[1] + n[1] * t, p[2] + n[2] * t);
    occ += Math.max(0, t - d) * w; w *= 0.62;
  }
  return Math.max(0, Math.min(1, 1 - 2.1 * occ));
}

async function buildMesh(human, opts = {}) {
  const h = opts.h || 0.0025;
  const t0 = Date.now();
  const raw = surfaceNets(human.sdf, human.bounds, h, { project: 2 });
  const log = opts.log || (() => {});
  log(`  surface nets: ${raw.positions.length / 3} verts, ${raw.indices.length / 3} tris, ${raw.evals} evals, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  let positions = raw.positions, indices = raw.indices;
  // simplify
  const { MeshoptSimplifier } = require(opts.meshopt || 'meshoptimizer');
  await MeshoptSimplifier.ready;
  const target = Math.max(3000, Math.floor((opts.targetTris || 110000) * 3));
  // colour-like attributes are not known yet: use the SDF normal as the attribute so silhouettes / creases keep vertices
  // Simplifier attributes: SDF normal (keeps silhouettes / creases) + the atlas colour (keeps muscle / tendon borders sharp
  // where the colour changes, lets flat uniform areas lose triangles).
  const nv0 = positions.length / 3;
  const nAttr = new Float32Array(nv0 * 6);
  for (let i = 0; i < nv0; i++) {
    const g = gradient(human.sdf, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    nAttr[i * 6] = g[0]; nAttr[i * 6 + 1] = g[1]; nAttr[i * 6 + 2] = g[2];
    const c = opts.guide ? opts.guide(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]) : [0, 0, 0];
    nAttr[i * 6 + 3] = c[0]; nAttr[i * 6 + 4] = c[1]; nAttr[i * 6 + 5] = c[2];
  }
  const [simp, err] = MeshoptSimplifier.simplifyWithAttributes(indices, positions, 3, nAttr, 6, [0.5, 0.5, 0.5, opts.guide ? 1.6 : 0, opts.guide ? 1.6 : 0, opts.guide ? 1.6 : 0], null, target, opts.error || 0.002, []);
  log(`  simplified to ${simp.length / 3} tris (error ${err.toExponential(2)})`);
  // compact
  const remap = new Int32Array(positions.length / 3).fill(-1);
  const P = [];
  const I = new Uint32Array(simp.length);
  for (let i = 0; i < simp.length; i++) {
    const v = simp[i];
    if (remap[v] < 0) { remap[v] = P.length / 3; P.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]); }
    I[i] = remap[v];
  }
  positions = Float32Array.from(P); indices = I;
  if (human.refine && human.refine.length) {
    const r = refine(positions, indices, human.sdf, human.refine);
    positions = r.positions; indices = r.indices;
    log(`  refined faces/hands: ${indices.length / 3} tris`);
  }
  // Fix fold-overs left by the simplifier: a triangle whose geometric normal opposes the surface (SDF) normal is re-wound.
  {
    let flipped = 0;
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const cx = (positions[a] + positions[b] + positions[c]) / 3, cy = (positions[a + 1] + positions[b + 1] + positions[c + 1]) / 3, cz = (positions[a + 2] + positions[b + 2] + positions[c + 2]) / 3;
      const g = gradient(human.sdf, cx, cy, cz, 0.0008);
      if (nx * g[0] + ny * g[1] + nz * g[2] < 0) { const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp; flipped++; }
    }
    log(`  re-wound ${flipped} fold-over triangles`);
  }
  // normals from the SDF, AO
  const nv = positions.length / 3;
  const normals = new Float32Array(nv * 3), ao = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    const g = gradient(human.sdf, p[0], p[1], p[2], 0.0008);
    normals[v * 3] = g[0]; normals[v * 3 + 1] = g[1]; normals[v * 3 + 2] = g[2];
    ao[v] = ambientOcclusion(human.sdf, p, g);
  }
  log(`  final: ${nv} verts, ${indices.length / 3} tris, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { positions, indices, normals, ao };
}
module.exports = { buildMesh, gradient, ambientOcclusion };
