#!/usr/bin/env node
'use strict';
/**
 * ClinicOS Dermatology & Aesthetics — offline generator of the clinical human (visual model v2).
 *
 *   node scripts/derm-human/generate.js [male|female|all] [--h 0.0025] [--tris 100000]
 *
 * Writes frontEnd/public/models/derm/{male,female}.glb and updates frontEnd/public/models/derm/manifest.json.
 * Everything is produced by the code in this folder (signed-distance-field sculpting -> surface nets -> simplification ->
 * SDF normals / AO / tint -> region hit layer -> GLB). NO third-party model, texture or asset is used.
 *
 * Dev-only dependency (NOT part of the app): `npm i --no-save meshoptimizer` in this folder (the simplifier). The app
 * itself never runs this script: it ships the generated .glb files.
 */
const fs = require('fs'), path = require('path');
const { REPO } = require('./tsload.js');
const { buildHuman } = require('./human.js');
const { buildMesh } = require('./finalize.js');
const { classifyTriangles, cleanLabels, smoothLabels, relaxLabels, registry } = require('./regions.js');
const { colorize } = require('./color.js');
const { buildMuscles, withMuscleRelief, makeColorizer } = require('./muscles.js');
const { writeGlb } = require('./glb.js');

const MODEL_VERSION = 'derm-human-v3';
async function generate(key, opts) {
  const log = (m) => console.log(`[${key}] ${m}`);
  const human = buildHuman(key);
  // superficial musculoskeletal layer: sculpts bellies/grooves into the skin and drives the atlas colours (visual only)
  const territories = buildMuscles(human);
  const eyeKeep = human.eyes.map((e) => ({ c: e.c, r2: (e.r * 1.35) ** 2 }));
  human.sdfPlain = human.sdf;
  human.sdf = withMuscleRelief(human.sdfPlain, territories, eyeKeep);
  const atlas = makeColorizer(territories);
  log(`muscle territories: ${territories.length}`);
  const mesh = await buildMesh(human, { h: opts.h, targetTris: opts.tris, meshopt: opts.meshopt, guide: (x, y, z) => atlas(x, y, z, false), log: (m) => log(m.trim()) });
  const cls = classifyTriangles(human, mesh);
  smoothLabels(mesh.indices, cls.label, 5);
  cleanLabels(mesh.indices, cls.label);
  relaxLabels(mesh.indices, cls.label, 8);
  cleanLabels(mesh.indices, cls.label);
  const colors = colorize(human, mesh, atlas);
  // per-region index lists
  const per = new Map(); registry.REGION_IDS.forEach((id) => per.set(id, []));
  let unclassified = 0;
  for (let t = 0; t < cls.label.length; t++) {
    const lab = cls.label[t];
    if (lab < 0) { unclassified++; continue; }
    const arr = per.get(registry.REGION_IDS[lab]);
    arr.push(mesh.indices[t * 3], mesh.indices[t * 3 + 1], mesh.indices[t * 3 + 2]);
  }
  const regionIndices = {}, counts = {}, missing = [];
  for (const [id, arr] of per) { if (arr.length === 0) { missing.push(id); continue; } regionIndices[id] = arr; counts[id] = arr.length / 3; }
  log(`regions with triangles: ${Object.keys(regionIndices).length}/${registry.REGION_IDS.length}; unclassified tris: ${unclassified}`);
  if (missing.length) log(`MISSING regions: ${missing.join(', ')}`);
  const sp = human.spec, H = human.H, chinY = human.chinY;
  const landmarks = {
    head: [0, +(chinY + 0.56 * H).toFixed(4), sp.headZ], headRadius: +(0.5 * H).toFixed(4), neckBase: [0, sp.y.neckBase, sp.neck.z],
    faceCenter: [0, +(chinY + 0.41 * H).toFixed(4), +(sp.headZ + 0.25 * H).toFixed(4)], faceRadius: +(0.52 * H).toFixed(4), scalpRadius: +(0.62 * H).toFixed(4),
  };
  const glb = writeGlb({
    name: `derm-human-${key}`, positions: mesh.positions, normals: mesh.normals, colors, indices: mesh.indices, regionIndices,
    extras: { modelVersion: MODEL_VERSION, procedural: true, thirdPartyAssets: false, frame: '+X = patient LEFT, +Y up, +Z anterior, metres, origin on floor' },
  });
  const outDir = path.join(REPO, 'frontEnd', 'public', 'models', 'derm');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${key}.glb`), glb);
  log(`wrote ${key}.glb (${(glb.length / 1e6).toFixed(2)} MB, ${mesh.indices.length / 3} tris, ${mesh.positions.length / 3} verts)`);
  return { key, landmarks, regionIndices: Object.keys(regionIndices), counts, missing, tris: mesh.indices.length / 3, verts: mesh.positions.length / 3, bytes: glb.length };
}

async function main() {
  const args = process.argv.slice(2);
  const which = args.find((a) => !a.startsWith('--')) || 'all';
  const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? parseFloat(args[i + 1]) : d; };
  const opts = { h: opt('h', 0.0025), tris: opt('tris', 105000), meshopt: process.env.MESHOPT_PATH || 'meshoptimizer' };
  const keys = which === 'all' ? ['male', 'female'] : [which];
  const manifestPath = path.join(REPO, 'frontEnd', 'public', 'models', 'derm', 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { version: 1, models: {} };
  const report = {};
  for (const key of keys) {
    const r = await generate(key, opts);
    report[key] = r;
    const regions = {}; r.regionIndices.forEach((id) => { regions[id] = [`hit_${id}`]; });
    manifest.models[key] = { file: `${key}.glb`, modelVersion: MODEL_VERSION, skinMeshes: ['skin'], regions, landmarks: r.landmarks };
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(__dirname, 'last-report.json'), JSON.stringify(report, null, 2));
  console.log('manifest updated');
}
main().catch((e) => { console.error(e); process.exit(1); });
