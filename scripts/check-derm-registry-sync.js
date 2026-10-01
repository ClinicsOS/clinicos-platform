#!/usr/bin/env node
/**
 * Verifies the two hand-mirrored copies of the Dermatology Anatomical Region Registry agree:
 *   backEnd/src/config/dermatology.ts   (what the server accepts and stores)
 *   frontEnd/src/lib/derm/regions.ts    (labels + 3D/camera metadata)
 * Also checks internal consistency (unique ids, left_/right_ ⇄ side, mirrored pairs, both labels present).
 *
 * Run from the project root:   node scripts/check-derm-registry-sync.js
 * Needs `npm install` to have been done in frontEnd/ (uses its TypeScript to read the .ts files).
 */
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "frontEnd/node_modules/typescript"));

function load(rel, cache = new Map()) {
  if (cache.has(rel)) return cache.get(rel).exports;
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {} };
  cache.set(rel, mod);
  // Only sibling files (./x) are resolved, so a module can share the registry; any package import is still refused.
  const req = (m) => {
    if (!m.startsWith("./")) throw new Error("unexpected import " + m + " in " + rel);
    return load(path.join(path.dirname(rel), m.slice(2) + ".ts"), cache);
  };
  new Function("exports", "module", "require", js)(mod.exports, mod, req);
  return mod.exports;
}

const be = load("backEnd/src/config/dermatology.ts");
const fe = load("frontEnd/src/lib/derm/regions.ts");
const errors = [];
const bad = (m) => errors.push(m);

const norm = (r) => `${r.id}|${r.group}|${r.side}|${[...r.surfaces].sort().join(",")}|${r.active}`;
const beMap = new Map(be.REGIONS.map((r) => [r.id, norm(r)]));
const feMap = new Map(fe.REGIONS.map((r) => [r.id, norm(r)]));
for (const [id, v] of beMap) { if (!feMap.has(id)) bad(`region "${id}" exists on the backend but not on the frontend`); else if (feMap.get(id) !== v) bad(`region "${id}" differs:\n   backend : ${v}\n   frontend: ${feMap.get(id)}`); }
for (const id of feMap.keys()) if (!beMap.has(id)) bad(`region "${id}" exists on the frontend but not on the backend`);
if (be.REGIONS.length !== new Set(be.REGIONS.map((r) => r.id)).size) bad("backend registry has duplicate ids");
if (fe.REGIONS.length !== new Set(fe.REGIONS.map((r) => r.id)).size) bad("frontend registry has duplicate ids");

const same = (a, b) => JSON.stringify([...a]) === JSON.stringify([...b]);
if (!same(be.RECORD_TYPES, fe.RECORD_TYPES)) bad("RECORD_TYPES differ");
if (!same(be.SURFACE_IDS, fe.SURFACE_IDS)) bad("SURFACE_IDS differ");
if (!same(be.REGION_GROUPS, fe.REGION_GROUPS)) bad("REGION_GROUPS differ");
if (be.MAX_REGIONS_PER_ASSESSMENT !== fe.MAX_REGIONS_PER_ASSESSMENT) bad("MAX_REGIONS_PER_ASSESSMENT differ");

for (const r of fe.REGIONS) {
  if (!/^[a-z][a-z0-9_]*$/.test(r.id)) bad(`id "${r.id}" is not a stable snake_case id`);
  if (/^(male|female)_/.test(r.id)) bad(`id "${r.id}" is gendered — ids must be independent from the visual model`);
  const expectSide = r.id.startsWith("left_") ? "left" : r.id.startsWith("right_") ? "right" : "midline";
  if (r.side !== expectSide) bad(`"${r.id}" has side "${r.side}" but its id says "${expectSide}"`);
  if (!r.labels.en || !r.labels.ar) bad(`"${r.id}" is missing an EN or AR label`);
  if (r.id.startsWith("left_") && !feMap.has("right_" + r.id.slice(5))) bad(`"${r.id}" has no right-hand twin`);
  if (r.id.startsWith("right_") && !feMap.has("left_" + r.id.slice(6))) bad(`"${r.id}" has no left-hand twin`);
  if (r.side === "left" && !/[يى]سر|اليسرى|الأيسر|اليسار/.test(r.labels.ar)) bad(`"${r.id}" Arabic label does not say left: ${r.labels.ar}`);
  if (r.side === "right" && !/الأيمن|اليمنى|اليمين/.test(r.labels.ar)) bad(`"${r.id}" Arabic label does not say right: ${r.labels.ar}`);
  if (r.side === "left" && !/^Left /.test(r.labels.en)) bad(`"${r.id}" English label does not start with Left`);
  if (r.side === "right" && !/^Right /.test(r.labels.en)) bad(`"${r.id}" English label does not start with Right`);
  // mirrored camera: right twin must look from the opposite side
  if (r.side === "right") { const l = fe.getRegion("left_" + r.id.slice(6)); if (l && Math.abs(l.focus.az + r.focus.az) > 1e-6) bad(`"${r.id}" camera azimuth is not the mirror of its left twin`); }
  if (r.side === "left" && r.focus.az < 0 && r.focus.az > -180) bad(`"${r.id}" (LEFT) has a camera azimuth on the patient's right side`);
}


// ---------------------------------------------------------------- Phase 2: procedure catalog + lifecycle enums + limits
const bp = load("backEnd/src/config/dermProcedures.ts");
const fp = load("frontEnd/src/lib/derm/procedures.ts");
const pnorm = (p) => `${p.code}|${p.recordType}|${p.metadata}`;
const bpMap = new Map(bp.PROCEDURES.map((p) => [p.code, pnorm(p)]));
const fpMap = new Map(fp.PROCEDURES.map((p) => [p.code, pnorm(p)]));
for (const [c, v] of bpMap) { if (!fpMap.has(c)) bad(`procedure "${c}" exists on the backend but not on the frontend`); else if (fpMap.get(c) !== v) bad(`procedure "${c}" differs:\n   backend : ${v}\n   frontend: ${fpMap.get(c)}`); }
for (const c of fpMap.keys()) if (!bpMap.has(c)) bad(`procedure "${c}" exists on the frontend but not on the backend`);
if (bp.PROCEDURES.length !== bpMap.size) bad("backend procedure catalog has duplicate codes");
if (fp.PROCEDURES.length !== fpMap.size) bad("frontend procedure catalog has duplicate codes");
if (bp.PROCEDURE_CATALOG_VERSION !== fp.PROCEDURE_CATALOG_VERSION) bad("PROCEDURE_CATALOG_VERSION differs");
// ---- Phase 3: the backend keeps a label table ONLY to snapshot a procedure's name on a session; it must equal what the UI shows
for (const p of fp.PROCEDURES) {
  const l = bp.PROCEDURE_LABELS && bp.PROCEDURE_LABELS[p.code];
  if (!l) { bad(`procedure "${p.code}" has no backend snapshot label`); continue; }
  if (l.en !== p.labels.en || l.ar !== p.labels.ar) bad(`procedure "${p.code}" snapshot label differs from the frontend label:\n   backend : ${l.en} / ${l.ar}\n   frontend: ${p.labels.en} / ${p.labels.ar}`);
}
for (const c of Object.keys(bp.PROCEDURE_LABELS || {})) if (!fpMap.has(c)) bad(`backend snapshot label for unknown procedure "${c}"`);
// ---- Phase 3: central documentation config (field groups) must match on both sides
const bd = load("backEnd/src/config/dermDocumentation.ts");
const fd = load("frontEnd/src/lib/derm/documentation.ts");
if (bd.DOC_SCHEMA_VERSION !== fd.DOC_SCHEMA_VERSION) bad("DOC_SCHEMA_VERSION differs");
for (const g of ["product", "device"]) {
  const a = JSON.stringify(bd.DOC_FIELDS[g]), b = JSON.stringify(fd.DOC_FIELDS[g]);
  if (a !== b) bad(`documentation fields of group "${g}" differ:\n   backend : ${a}\n   frontend: ${b}`);
}
for (const k of ["none", "product", "device", "product_device"]) {
  if (JSON.stringify(bd.groupsFor(k)) !== JSON.stringify(fd.groupsFor(k))) bad(`documentation groups for metadata "${k}" differ`);
}
for (const k of ["PLAN_STATUSES", "PRIORITIES", "TARGET_TYPES", "FOLLOWUP_OUTCOMES", "METADATA_KINDS"]) if (!same(bp[k], fp[k])) bad(`${k} differ: ${JSON.stringify(bp[k])} vs ${JSON.stringify(fp[k])}`);
if (!same(bp.GENERAL_AREAS, fp.GENERAL_AREAS)) bad("GENERAL_AREAS differ");
for (const k of ["MAX_PHASE", "MAX_TARGET_REGIONS"]) if (bp[k] !== fp[k]) bad(`${k} differs: ${bp[k]} vs ${fp[k]}`);
for (const k of ["MAX_TREATMENT_TEXT", "MAX_SESSION_TEXT", "MAX_TRACE_TEXT", "MAX_FOLLOWUP_TEXT"]) {
  // the frontend may hide the backend-only keys (e.g. sourceDiagnosis); every key the frontend uses must match
  for (const [key, v] of Object.entries(fp[k])) if (bp[k][key] !== v) bad(`${k}.${key} differs: backend ${bp[k][key]} vs frontend ${v}`);
}
// labels + categories (UI-only data) must be complete and coherent
for (const p of fp.PROCEDURES) {
  if (!p.labels.en || !p.labels.ar) bad(`procedure "${p.code}" is missing an EN or AR label`);
  if (!/[\u0600-\u06FF]/.test(p.labels.ar)) bad(`procedure "${p.code}" Arabic label has no Arabic text`);
  if (!fp.CATEGORY_LABELS[p.category]) bad(`procedure "${p.code}" has an unknown category "${p.category}"`);
  else if (fp.CATEGORY_LABELS[p.category].recordType !== p.recordType) bad(`procedure "${p.code}" (${p.recordType}) sits in a ${fp.CATEGORY_LABELS[p.category].recordType} category`);
  if (!/^[a-z][a-z_]*$/.test(p.code)) bad(`procedure code "${p.code}" is not a stable snake_case id`);
}
for (const c of fp.CATEGORY_ORDER) if (!fp.CATEGORY_LABELS[c].en || !fp.CATEGORY_LABELS[c].ar) bad(`category "${c}" is missing a label`);
if (fp.CATEGORY_ORDER.length !== Object.keys(fp.CATEGORY_LABELS).length) bad("CATEGORY_ORDER and CATEGORY_LABELS differ");
// the frontend types file for Phase 1 limits stays in step too
const ft = load("frontEnd/src/lib/derm/types.ts");
for (const [k, v] of Object.entries(ft.DERM_MAX_TEXT)) if (be.MAX_TEXT[k] !== v) bad(`Phase 1 text limit ${k} differs: backend ${be.MAX_TEXT[k]} vs frontend ${v}`);

if (errors.length) { console.error("✗ Derm registry check FAILED:\n - " + errors.join("\n - ")); process.exit(1); }
console.log(`✓ Derm registry OK — ${fe.REGIONS.length} regions, frontend ⇄ backend identical, ids stable, left/right consistent, EN+AR labels present; ${fp.PROCEDURES.length} procedures, enums and limits in sync.`);
