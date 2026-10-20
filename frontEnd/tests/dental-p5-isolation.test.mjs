/* PHASE 5 — Tooth Focus / Isolation (tests 17–25), run headlessly on the REAL JawModel + ToothVisual + focus model.
   The engine applies focusModel results to the teeth with the same `computeFocusTargets` / `applyFocusTargets` used here, so these tests
   exercise the real transforms and materials, frame by frame, without a GPU:
       node --import ./tests/support/register.mjs --experimental-transform-types --test tests/dental-p5-isolation.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { JawModel } from "../src/components/dental/engine/JawModel.ts";
import { buildDentitionConfig } from "../src/components/dental/engine/dentitionConfig.ts";
import { applyFocusTargets, computeFocusTargets, focusLevelOf, FOCUS_TUNING, SURFACE_REVEAL_ALPHA } from "../src/components/dental/engine/focusModel.ts";
import { LIFT_BY_LEVEL } from "../src/components/dental/engine/toothVisual.ts";
import { adjacentTeeth, archDistance, isolationNeighbours } from "../src/lib/dental/neighbors.ts";
import { applyPlanToVisual } from "../src/lib/dental/planVisual.ts";
import { emptyVisualState } from "../src/lib/dental/toothStates.ts";
import { resolveChartLink } from "../src/lib/dental/focusLink.ts";
import { parseProfileFocus } from "../src/lib/history/deeplink.ts";

const cfg = buildDentitionConfig("permanent", null);
const model = new JawModel(cfg);
model.setJawAngle(0.12); model.root.updateMatrixWorld(true);
const shown = Array.from(model.teeth.keys());
const TICK = 1 / 60;
let clock = 0;
const settle = (frames = 240) => { for (let i = 0; i < frames; i++) { clock += TICK; model.teeth.forEach((v) => v.update(TICK, clock, false)); } };
const focus = (inp) => { const r = computeFocusTargets({ shown, focusing: false, isolated: false, ...inp }); applyFocusTargets(model.teeth, r.teeth); return r; };
const snapshot = () => {
  const o = {};
  model.teeth.forEach((v, f) => {
    const d = v.debugState();
    o[f] = { ...d, pos: v.group.position.toArray(), rot: [v.group.rotation.x, v.group.rotation.y, v.group.rotation.z], innerPos: v.inner.position.toArray(), innerRot: [v.inner.rotation.x, v.inner.rotation.y, v.inner.rotation.z], crownMat: v.crown.material.uuid, geo: v.crown.geometry.uuid };
  });
  return o;
};
const planted = applyPlanToVisual({}, [{ _id: "p1", status: "planned", procedureCode: "filling", targetType: "surface", toothNumbers: ["26"], surfaces: ["D"] }], emptyVisualState);
model.teeth.get("26").applyState(planted["26"]);
settle();
const baseline = snapshot();
const near = (a, b, eps = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= eps);

test("[P5-17] selecting ONE tooth enables focus behaviour: select -> focus -> isolate levels, hero lift grows, others recede", () => {
  assert.equal(focusLevelOf(null, false, false), "none");
  assert.equal(focusLevelOf("26", false, false), "select");
  assert.equal(focusLevelOf("26", true, false), "focus");
  assert.equal(focusLevelOf("26", true, true), "isolate");
  const r = focus({ selected: "26" });
  assert.equal(r.level, "select");
  assert.equal(r.teeth.get("26").hero, 1);
  assert.equal(shown.filter((f) => r.teeth.get(f).hero > 0).length, 1, "exactly one hero tooth");
  assert.ok(LIFT_BY_LEVEL[1] > 0 && LIFT_BY_LEVEL[2] > LIFT_BY_LEVEL[1] && LIFT_BY_LEVEL[3] > LIFT_BY_LEVEL[2]);
  settle();
  assert.ok(Math.abs(model.teeth.get("26").inner.position.z - LIFT_BY_LEVEL[1]) < 1e-6);
  focus({ selected: null }); settle();
});

test("[P5-18] isolation affects the CORRECT tooth: only 26 is lifted, nobody else moves", () => {
  focus({ selected: "26", focusing: true, isolated: true }); settle();
  const s = snapshot();
  for (const f of shown) {
    if (f === "26") { assert.ok(Math.abs(s[f].innerPos[2] - LIFT_BY_LEVEL[3]) < 1e-6, "26 moved outward by the isolate lift"); assert.equal(s[f].hero, 3); }
    else { assert.ok(near(s[f].innerPos, baseline[f].innerPos), `${f} did not move`); assert.equal(s[f].hero, 0); }
  }
  focus({ selected: null }); settle();
});

test("[P5-19] the NEIGHBOURS (and only they) are made transparent, stronger as focus deepens; far teeth recede but stay opaque", () => {
  assert.deepEqual(isolationNeighbours(shown, "26").sort(), ["25", "27"]);
  assert.deepEqual(isolationNeighbours(shown, "11").sort(), ["12", "21"], "across the midline");
  assert.equal(archDistance(shown, "26", "24"), 2); assert.equal(archDistance(shown, "26", "36"), null);
  const a = (level) => { const r = computeFocusTargets({ shown, selected: "26", focusing: level !== "select", isolated: level === "isolate" }); return r.teeth; };
  const sel = a("select"), foc = a("focus"), iso = a("isolate");
  assert.ok(sel.get("25").neighbourAlpha > foc.get("25").neighbourAlpha && foc.get("25").neighbourAlpha > iso.get("25").neighbourAlpha);
  assert.equal(iso.get("25").neighbourAlpha, FOCUS_TUNING.isolate.neighbour); assert.equal(iso.get("27").neighbourAlpha, FOCUS_TUNING.isolate.neighbour);
  assert.equal(iso.get("24").neighbourAlpha, FOCUS_TUNING.isolate.ring2);
  for (const f of shown) if (!["25", "27", "24", "28", "26"].includes(f)) assert.equal(iso.get(f).neighbourAlpha, 1, `${f} is not faded`);
  assert.ok(iso.get("36").emphasis < 1, "the antagonist arch is de-emphasised, not hidden");
  // really applied to the materials
  focus({ selected: "26", focusing: true, isolated: true }); settle();
  const d25 = model.teeth.get("25").debugState(), d27 = model.teeth.get("27").debugState(), d16 = model.teeth.get("16").debugState();
  assert.ok(d25.alpha < 0.06 && d27.alpha < 0.06, `neighbour opacity ${d25.alpha}/${d27.alpha}`);
  assert.equal(d25.enamel.depthWrite, false, "a see-through tooth must not write depth");
  assert.ok(d16.alpha > 0.99);
  assert.equal(model.teeth.get("25").pickTargets().length, 0, "an isolated-away neighbour cannot swallow clicks");
  assert.ok(model.teeth.get("26").pickTargets().length > 0);
  focus({ selected: null }); settle();
});

test("[P5-20] Reset restores the ORIGINAL tooth transforms exactly", () => {
  focus({ selected: "26", focusing: true, isolated: true }); settle();
  focus({ selected: null }); settle();
  const s = snapshot();
  for (const f of shown) {
    assert.ok(near(s[f].pos, baseline[f].pos) && near(s[f].rot, baseline[f].rot), `${f} group transform`);
    assert.ok(near(s[f].innerPos, baseline[f].innerPos) && near(s[f].innerRot, baseline[f].innerRot), `${f} inner transform`);
    assert.equal(s[f].groupScale, baseline[f].groupScale);
  }
});

test("[P5-21] Reset restores the ORIGINAL neighbour materials: same objects, same opacity / depthWrite / transparency, no leaks", () => {
  const before = snapshot();
  focus({ selected: "26", focusing: true, isolated: true }); settle();
  focus({ selected: null }); settle();
  const s = snapshot();
  for (const f of shown) {
    assert.equal(s[f].enamel.id, before[f].enamel.id, `${f} same enamel material object`);
    assert.equal(s[f].crownMat, before[f].crownMat); assert.equal(s[f].geo, before[f].geo, "geometry untouched (shared)");
    assert.equal(s[f].enamel.opacity, 1, `${f} opacity`); assert.equal(s[f].enamel.depthWrite, true); assert.equal(s[f].enamel.transparent, false);
    assert.equal(s[f].enamel.color, before[f].enamel.color);
    assert.equal(s[f].alpha, 1); assert.equal(s[f].nb, 1);
  }
  // materials are PER TOOTH: fading 25 never touched 24 / 16
  const mats = new Set(shown.map((f) => model.teeth.get(f).debugState().enamel.id));
  assert.equal(mats.size, shown.length, "every tooth owns its own enamel material (nothing shared to contaminate)");
});

test("[P5-22] 60 repeated isolate / exit / reset cycles accumulate NO positional drift and allocate NO new materials", () => {
  const ids0 = JSON.stringify(shown.map((f) => model.teeth.get(f).debugState().enamel.id));
  for (let i = 0; i < 60; i++) {
    const f = ["26", "11", "46", "36", "18"][i % 5];
    focus({ selected: f }); settle(30);
    focus({ selected: f, focusing: true, isolated: true }); settle(40);
    focus({ selected: f, focusing: true, isolated: false, surface: "D" }); settle(20);
    focus({ selected: null }); settle(60);
  }
  settle(300);
  const s = snapshot();
  for (const f of shown) { assert.ok(near(s[f].innerPos, baseline[f].innerPos, 1e-9), `${f} drifted`); assert.ok(near(s[f].pos, baseline[f].pos, 1e-12)); }
  assert.equal(JSON.stringify(shown.map((f) => model.teeth.get(f).debugState().enamel.id)), ids0, "no material was replaced or leaked");
});

test("[P5-23] the treatment overlay stays attached to the selected tooth and moves WITH it; neighbours' overlays hide with them", () => {
  const tooth = model.teeth.get("26");
  const p0 = new THREE.Vector3(), n0 = new THREE.Vector3(), p1 = new THREE.Vector3(), n1 = new THREE.Vector3();
  tooth.surfaceWorld("D", p0, n0);
  const drawn = tooth.markSummary();
  focus({ selected: "26", focusing: true, isolated: true }); settle();
  tooth.surfaceWorld("D", p1, n1);
  assert.deepEqual(tooth.markSummary(), drawn, "the planned filling on D is still drawn during isolation");
  assert.ok(Math.abs(p1.distanceTo(p0) - LIFT_BY_LEVEL[3]) < 1e-3, `the D anchor travelled with the tooth by exactly the lift (${p1.distanceTo(p0).toFixed(4)})`);
  assert.equal(tooth.debugState().treatVisible, true); assert.equal(tooth.debugState().markersVisible, true);
  assert.equal(model.teeth.get("27").debugState().treatVisible, false, "a faded neighbour hides its overlays");
  assert.ok(tooth.inner.children.length > 0 && tooth.inner.parent === tooth.group, "overlays live in the tooth's own frame");
  focus({ selected: null }); settle();
  tooth.surfaceWorld("D", p1, n1);
  assert.ok(p1.distanceTo(p0) < 1e-6, "back to the exact original anchor");
});

test("[P5-24] a deep-linked tooth enters / follows the focus state: M/D surface links open isolated, others do not", () => {
  const sp = (o) => parseProfileFocus(new URLSearchParams({ tab: "dental-chart", ...o }));
  const d = resolveChartLink(sp({ tooth: "26", surface: "D" }), {});
  assert.deepEqual([d.tooth, d.surface, d.isolate], ["26", "D", true]);
  assert.equal(resolveChartLink(sp({ tooth: "26", surface: "M" }), {}).isolate, true);
  assert.equal(resolveChartLink(sp({ tooth: "26", surface: "O" }), {}).isolate, false);
  assert.equal(resolveChartLink(sp({ tooth: "26" }), {}).isolate, false);
  // and the model really isolates it, revealing the D neighbour even without full isolation
  const r = focus({ selected: "26", surface: "D", isolated: true, focusing: true }); settle();
  assert.equal(r.level, "isolate");
  const reveal = computeFocusTargets({ shown, selected: "26", focusing: false, isolated: false, surface: "D" }).teeth;
  assert.equal(reveal.get("27").neighbourAlpha, SURFACE_REVEAL_ALPHA, "choosing D fades the DISTAL neighbour (27)");
  assert.ok(reveal.get("25").neighbourAlpha > SURFACE_REVEAL_ALPHA, "…but not the mesial one (25)");
  const m = computeFocusTargets({ shown, selected: "16", focusing: false, isolated: false, surface: "D" }).teeth;
  assert.equal(m.get("17").neighbourAlpha, SURFACE_REVEAL_ALPHA, "contralateral: distal of 16 is 17");
  focus({ selected: null }); settle();
});

test("[P5-25] MULTI-select does NOT pull several teeth out: no hero, no lift, no neighbour fade, only an outline", () => {
  const r = focus({ selected: null, multiSelected: new Set(["26", "27", "28", "36"]) }); settle();
  assert.equal(r.level, "none");
  for (const f of shown) {
    const d = model.teeth.get(f).debugState();
    assert.equal(d.hero, 0, `${f} hero`); assert.ok(Math.abs(d.liftZ - baseline[f].innerPos[2]) < 1e-9, `${f} not lifted`); assert.equal(d.nbTarget, 1, `${f} not faded`);
  }
  assert.equal(r.teeth.get("26").emphasis, 1); assert.ok(r.teeth.get("16").emphasis < 1, "unpicked teeth recede a little so picks read");
  assert.deepEqual(shown.filter((f) => r.teeth.get(f).multi).sort(), ["26", "27", "28", "36"]);
  focus({ selected: null }); settle();
  const s = snapshot();
  for (const f of shown) assert.ok(near(s[f].innerPos, baseline[f].innerPos));
});

test("[P5-25b] adjacency follows the shown teeth: a mixed arch with a gap still isolates the real neighbour", () => {
  const gap = shown.filter((f) => f !== "25");
  assert.deepEqual(adjacentTeeth(gap, "26"), { mesial: "24", distal: "27" });
  assert.deepEqual(adjacentTeeth(shown, "28"), { mesial: "27", distal: null });
  assert.deepEqual(adjacentTeeth(shown, "99"), { mesial: null, distal: null });
});
