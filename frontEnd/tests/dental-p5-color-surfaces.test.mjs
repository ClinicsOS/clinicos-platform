/* PHASE 5 — Dental Chart V2: colour semantics (tests 1–6) and tooth-surface accuracy (tests 7–10, 14–16).
   Pure unit tests (no browser, no network). TypeScript sources are imported through tests/support/register.mjs:
       node --import ./tests/support/register.mjs --test tests/dental-p5-color-surfaces.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { STATE_TOKENS, TYPE_TOKENS, UI_TOKENS, semanticOfStatus, strongestState, deltaE } from "../src/lib/dental/visualTheme.ts";
import { deriveToothMarks, marksSignature } from "../src/lib/dental/toothMarks.ts";
import { getSurfaceOrientation, innerDistalSign } from "../src/lib/dental/surfaces.ts";
import { applyPlanToVisual } from "../src/lib/dental/planVisual.ts";
import { emptyVisualState } from "../src/lib/dental/toothStates.ts";
import { JawModel } from "../src/components/dental/engine/JawModel.ts";
import { buildDentitionConfig } from "../src/components/dental/engine/dentitionConfig.ts";

const item = (over) => ({ _id: "i" + Math.random(), status: "planned", procedureCode: "filling", targetType: "surface", toothNumbers: ["26"], surfaces: ["D"], ...over });
const visualOf = (items, base = {}) => applyPlanToVisual(base, items, emptyVisualState);
const withDx = (fdi, dx) => { const v = emptyVisualState(); v.diagnoses = dx; return { [fdi]: v }; };

const permanent = new JawModel(buildDentitionConfig("permanent", null));
const primary = new JawModel(buildDentitionConfig("primary", null));
permanent.setJawAngle(0); permanent.root.updateMatrixWorld(true);
primary.setJawAngle(0); primary.root.updateMatrixWorld(true);

/* ---------------------------------------------------------------- colour semantics */
test("[P5-1] a PLANNED treatment resolves to the planned semantic state (2D marks + token)", () => {
  assert.equal(semanticOfStatus("planned"), "planned");
  const m = deriveToothMarks("26", visualOf([item()])["26"]);
  assert.deepEqual(m.surfaces.D.map((x) => [x.kind, x.state]), [["filling", "planned"]]);
  assert.equal(m.badge.plan, "planned");
});

test("[P5-2] an IN-PROGRESS treatment resolves to the in-progress semantic state", () => {
  assert.equal(semanticOfStatus("in_progress"), "inProgress");
  const m = deriveToothMarks("26", visualOf([item({ status: "in_progress" })])["26"]);
  assert.deepEqual(m.surfaces.D.map((x) => x.state), ["inProgress"]);
  assert.equal(m.badge.plan, "inProgress");
});

test("[P5-3] a COMPLETED treatment resolves to the completed semantic state", () => {
  assert.equal(semanticOfStatus("completed"), "completed");
  const m = deriveToothMarks("26", visualOf([item({ status: "completed" })])["26"]);
  assert.deepEqual(m.surfaces.D.map((x) => x.state), ["completed"]);
  assert.equal(m.badge.treated, true);
});

test("[P5-4] existing / condition / planned / in-progress / completed stay DISTINCT (semantic + perceptual)", () => {
  const ids = Object.keys(STATE_TOKENS);
  assert.equal(new Set(ids.map((k) => STATE_TOKENS[k].hex)).size, ids.length, "every state has its own colour");
  assert.equal(new Set(ids.map((k) => STATE_TOKENS[k].glyph)).size, ids.length, "…and its own glyph (never colour alone)");
  // an existing filling and a completed filling on the same tooth are two different things
  const v = visualOf([item({ status: "completed", surfaces: ["O"] })], withDx("26", [{ code: "caries", surfaces: ["D"] }]));
  v["26"].hasFilling = true; v["26"].fillings = ["M"];
  const sig = marksSignature(deriveToothMarks("26", v["26"]));
  assert.ok(sig.includes("filling|existing|M") && sig.includes("filling|completed|O") && sig.includes("condition|condition|D|caries"));
  // pairs that can share a tooth must be perceptibly different (CIE ΔE76 >= 20)
  const pairs = [["planned", "inProgress"], ["planned", "completed"], ["inProgress", "completed"], ["condition", "planned"], ["condition", "completed"], ["condition", "inProgress"], ["existing", "completed"], ["existing", "planned"]];
  for (const [a, b] of pairs) assert.ok(deltaE(STATE_TOKENS[a].hex, STATE_TOKENS[b].hex) >= 20, `${a} vs ${b}`);
  // type colours the doctor reads on one tooth: crown vs filling vs enamel-ish bridge
  assert.ok(deltaE(TYPE_TOKENS.crown.hex, STATE_TOKENS.condition.hex) >= 20 && deltaE(TYPE_TOKENS.crown.hex, TYPE_TOKENS.filling.hex) >= 20);
  assert.equal(strongestState(["existing", "completed", "condition", "planned", "inProgress"]), "inProgress");
});

test("[P5-5] SELECTION never destroys clinical state: marks take no selection input, the 3D tooth keeps drawing everything while selected / isolated", () => {
  const v = visualOf([item(), item({ procedureCode: "crown", targetType: "tooth", surfaces: [], status: "in_progress" })], withDx("26", [{ code: "caries", surfaces: ["M"] }]))["26"];
  const before = marksSignature(deriveToothMarks("26", v));
  const tooth = permanent.teeth.get("26");
  tooth.applyState(v);
  const drawnBefore = tooth.markSummary();
  tooth.setSelected(true); tooth.setHero(3); tooth.setHover(true); tooth.setMultiSelected(true);
  for (let i = 0; i < 90; i++) tooth.update(1 / 60, i / 60, false);
  assert.deepEqual(tooth.markSummary(), drawnBefore, "selection / focus / hover / multi never change what is drawn");
  assert.deepEqual(marksSignature(deriveToothMarks("26", v)), before);
  assert.ok(UI_TOKENS.selected.hex !== STATE_TOKENS.planned.hex && UI_TOKENS.selected.hex !== STATE_TOKENS.completed.hex, "the selection colour is not a clinical colour");
  tooth.setSelected(false); tooth.setHero(0); tooth.setHover(false); tooth.setMultiSelected(false);
  for (let i = 0; i < 90; i++) tooth.update(1 / 60, i / 60, false);
});

test("[P5-6] 2D and 3D resolve the SAME semantic state for every combination (parity over a battery of teeth)", () => {
  const cases = [
    visualOf([item()]),
    visualOf([item({ status: "in_progress", surfaces: ["M", "O", "D"] })]),
    visualOf([item({ status: "completed", surfaces: ["O"] })]),
    visualOf([item({ procedureCode: "crown", targetType: "tooth", surfaces: [] })]),
    visualOf([item({ procedureCode: "crown", targetType: "tooth", surfaces: [], status: "completed" })]),
    visualOf([item(), item({ procedureCode: "crown", targetType: "tooth", surfaces: [], status: "in_progress" })], withDx("26", [{ code: "caries", surfaces: ["D"] }, { code: "infection_abscess", surfaces: [] }])),
    visualOf([item({ procedureCode: "root_canal", targetType: "tooth", surfaces: [] })]),
    withDx("26", [{ code: "caries", surfaces: [] }]),
  ];
  const specials = [{ restoration: "bridge" }, { restoration: "implant" }, { restoration: "crown" }, { rootCanal: true }, { missing: true }, { hasFilling: true, fillings: ["M", "O"] }, { hasFilling: true, fillings: [] }];
  for (const s of specials) { const v = emptyVisualState(); Object.assign(v, s); cases.push({ "26": v }); }
  let n = 0;
  for (const vis of cases) {
    const v = vis["26"];
    const tooth = permanent.teeth.get("26");
    tooth.applyState(v);
    const drawn3D = Array.from(new Set(tooth.markSummary()));
    const marks2D = Array.from(new Set(marksSignature(deriveToothMarks("26", v))));
    assert.deepEqual(drawn3D, marks2D, JSON.stringify(v));
    n++;
  }
  assert.equal(n, cases.length);
});

/* ---------------------------------------------------------------- surfaces */
const world = (v, p) => v.inner.localToWorld(p.clone());
const centre = (t) => world(t, new THREE.Vector3(0, t.dims.h * 0.5, 0));
const neighbours = (fdi) => { // [mesial neighbour, distal neighbour] by FDI numbering (mesial of position 1 = position 1 of the opposite quadrant)
  const q = +fdi[0], pos = +fdi[1];
  const opp = { 1: 2, 2: 1, 3: 4, 4: 3, 5: 6, 6: 5, 7: 8, 8: 7 }[q];
  return [pos > 1 ? `${q}${pos - 1}` : `${opp}1`, `${q}${pos + 1}`];
};

test("[P5-7] tooth 26: MESIAL faces tooth 25 / the midline — in the helper AND on the 3D anchor", () => {
  const o = getSurfaceOrientation("26");
  assert.equal(o.mesialSide, "left"); assert.equal(o.cross.left, "M");
  const v = permanent.teeth.get("26"), n25 = permanent.teeth.get("25");
  const pM = world(v, v.anchor("M").p), pD = world(v, v.anchor("D").p);
  assert.ok(pM.distanceTo(centre(n25)) < pD.distanceTo(centre(n25)), "the M anchor is on the 25 side");
});

test("[P5-8] tooth 26: DISTAL faces tooth 27 / away from the midline — in the helper AND on the 3D anchor", () => {
  const o = getSurfaceOrientation("26");
  assert.equal(o.distalSide, "right"); assert.equal(o.cross.right, "D");
  const v = permanent.teeth.get("26"), n27 = permanent.teeth.get("27");
  const pM = world(v, v.anchor("M").p), pD = world(v, v.anchor("D").p);
  assert.ok(pD.distanceTo(centre(n27)) < pM.distanceTo(centre(n27)));
});

test("[P5-9] the contralateral quadrant REVERSES the visual M/D (16 vs 26, 11 vs 21, 36 vs 46 …) — every mirrored pair, 2D helper and 3D", () => {
  let pairs = 0;
  for (const [a, b] of [["1", "2"], ["3", "4"]]) for (let pos = 1; pos <= 8; pos++) {
    const L = getSurfaceOrientation(`${a}${pos}`), R = getSurfaceOrientation(`${b}${pos}`);
    assert.equal(L.distalSide === "left", R.distalSide === "right", `${a}${pos}/${b}${pos}`);
    assert.equal(L.cross.left, R.cross.right); assert.equal(L.cross.right, R.cross.left);
    assert.notEqual(L.distalX, R.distalX);
    pairs++;
  }
  assert.equal(pairs, 16);
  assert.equal(getSurfaceOrientation("16").cross.left, "D"); assert.equal(getSurfaceOrientation("16").cross.right, "M");
  // the sign used to place the 3D marker mirrors too
  assert.equal(innerDistalSign({ side: -1, jaw: "upper" }), -innerDistalSign({ side: 1, jaw: "upper" }));
});

test("[P5-10] lower quadrants work (cross + 3D): facial/lingual swap vertically, M/D keep their anatomical sides — all 32 permanent + 20 primary teeth", () => {
  for (const f of ["36", "46"]) { const o = getSurfaceOrientation(f); assert.equal(o.cross.top, "L"); assert.equal(o.cross.bottom, "B"); }
  for (const f of ["16", "26"]) { const o = getSurfaceOrientation(f); assert.equal(o.cross.top, "B"); assert.equal(o.cross.bottom, "L"); }
  assert.equal(getSurfaceOrientation("36").distalSide, "right"); assert.equal(getSurfaceOrientation("46").distalSide, "left");
  let errors = 0, checked = 0;
  for (const m of [permanent, primary]) for (const [fdi, v] of m.teeth) {
    const [mes, dis] = neighbours(fdi).map((f) => m.teeth.get(f));
    const pM = world(v, v.anchor("M").p), pD = world(v, v.anchor("D").p);
    if (dis) { checked++; if (!(pD.distanceTo(centre(dis)) < pM.distanceTo(centre(dis)))) errors++; }
    if (mes) { checked++; if (!(pM.distanceTo(centre(mes)) < pD.distanceTo(centre(mes)))) errors++; }
  }
  assert.equal(errors, 0); assert.ok(checked >= 90, `checked ${checked}`);
});

test("[P5-11b] anterior teeth show F / I, posterior B / O, upper P and lower L — stored ids stay canonical", () => {
  const a = getSurfaceOrientation("11"), p = getSurfaceOrientation("26"), l = getSurfaceOrientation("46");
  assert.deepEqual([a.letters.B, a.letters.O, a.letters.L], ["F", "I", "P"]);
  assert.deepEqual([p.letters.B, p.letters.O, p.letters.L], ["B", "O", "P"]);
  assert.deepEqual([l.letters.B, l.letters.O, l.letters.L], ["B", "O", "L"]);
});

test("[P5-14] after a surface edit the 2D marks show the NEW surfaces and nothing of the old ones", () => {
  const before = deriveToothMarks("26", visualOf([item({ _id: "same", surfaces: ["D"] })])["26"]);
  const after = deriveToothMarks("26", visualOf([item({ _id: "same", surfaces: ["M", "O", "D"] })])["26"]);
  assert.equal(before.surfaces.M.length, 0);
  assert.deepEqual(["M", "O", "D"].map((s) => after.surfaces[s].length), [1, 1, 1], "MOD persists: all three surfaces carry the filling");
  assert.deepEqual(visualOf([item({ surfaces: ["D", "O"] })])["26"].treatments, [{ kind: "filling", status: "planned", surfaces: ["D", "O"] }], "multi-surface D/O persists in the visual state");
});

test("[P5-15] the 3D tooth receives the updated surface state (markers move to the new surfaces)", () => {
  const tooth = permanent.teeth.get("26");
  tooth.applyState(visualOf([item({ surfaces: ["D"] })])["26"]);
  assert.deepEqual(tooth.markSummary(), ["filling|planned|D"]);
  tooth.applyState(visualOf([item({ surfaces: ["M", "O"] })])["26"]);
  assert.deepEqual(tooth.markSummary(), ["filling|planned|M", "filling|planned|O"]);
  tooth.applyState(visualOf([item({ surfaces: ["M", "O"], status: "completed" })])["26"]);
  assert.deepEqual(tooth.markSummary(), ["filling|completed|M", "filling|completed|O"]);
  tooth.applyState(emptyVisualState());
  assert.deepEqual(tooth.markSummary(), []);
});

test("[P5-16] existing stored data (no toothSurfaces, old shapes) is read exactly as before", () => {
  const legacy = visualOf([{ _id: "L", status: "planned", procedureCode: "filling", targetType: "surface", toothNumbers: ["16"], surfaces: ["O"] }]);
  assert.deepEqual(legacy["16"].treatments, [{ kind: "filling", status: "planned", surfaces: ["O"] }]);
  const wholeTooth = visualOf([{ _id: "T", status: "planned", procedureCode: "crown", targetType: "tooth", toothNumbers: ["16"], surfaces: [] }]);
  assert.deepEqual(wholeTooth["16"].treatments, [{ kind: "crown", status: "planned", surfaces: [] }]);
  const e = { fdi: "36", dentitionType: "permanent", category: "existing_condition", code: "existing_filling", surfaces: ["O", "D"], status: "active" };
  assert.ok(e.surfaces.every((s) => ["M", "D", "B", "L", "O"].includes(s)));
});
