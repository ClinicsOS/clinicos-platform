/* Dental chart <- treatment plan derivation (src/lib/dental/planVisual.ts + toothStates.ts).
   Pure unit tests, no browser, no network. Imports the TypeScript sources directly (Node >= 22.18, or 22.6+ with
   --experimental-strip-types):
       node --test tests/dental-plan-visual.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import { applyPlanToVisual } from "../src/lib/dental/planVisual.ts";
import { deriveToothStates, toVisualState, emptyVisualState } from "../src/lib/dental/toothStates.ts";

const item = (over) => ({ status: "planned", procedureCode: "crown", targetType: "tooth", toothNumbers: ["16"], surfaces: [], ...over });
const run = (items, out = {}) => applyPlanToVisual(out, items, emptyVisualState);
const ev = (over) => ({ _id: "e" + Math.random(), fdi: "13", dentitionType: "permanent", category: "diagnosis", code: "caries", surfaces: ["O"], status: "active", createdAt: "", createdBy: null, ...over });

test("a planned crown becomes a crown treatment + a planned badge; the tooth is not 'restored'", () => {
  const v = run([item()])["16"];
  assert.equal(v.plan, "planned");
  assert.deepEqual(v.treatments, [{ kind: "crown", status: "planned", surfaces: [] }]);
  assert.equal(v.restoration, null);
  assert.equal(v.treated, false);
});

test("a filling keeps its surfaces; a crown never has surfaces", () => {
  const out = run([item({ procedureCode: "filling", targetType: "surface", toothNumbers: ["26"], surfaces: ["M", "O"] }), item({ toothNumbers: ["27"], surfaces: ["O"] })]);
  assert.deepEqual(out["26"].treatments, [{ kind: "filling", status: "planned", surfaces: ["M", "O"] }]);
  assert.deepEqual(out["27"].treatments, [{ kind: "crown", status: "planned", surfaces: [] }]);
});

test("cancelled items are never drawn", () => {
  const out = run([item({ status: "cancelled" })]);
  assert.equal(out["16"], undefined);
});

test("completed -> treated badge + solid treatment; in_progress beats planned", () => {
  const done = run([item({ status: "completed" })])["16"];
  assert.equal(done.treated, true);
  assert.equal(done.plan, null);
  assert.equal(done.treatments[0].status, "completed");
  const mixed = run([item({ toothNumbers: ["14"] }), item({ toothNumbers: ["14"], status: "in_progress", procedureCode: "filling", targetType: "surface", surfaces: ["D"] })])["14"];
  assert.equal(mixed.plan, "in_progress");
  const reverse = run([item({ toothNumbers: ["14"], status: "in_progress" }), item({ toothNumbers: ["14"] })])["14"];
  assert.equal(reverse.plan, "in_progress");
});

test("other procedures only get the generic badge (no crown/filling picture)", () => {
  const v = run([item({ procedureCode: "root_canal" })])["16"];
  assert.equal(v.plan, "planned");
  assert.deepEqual(v.treatments, []);
  const general = run([item({ procedureCode: "crown", targetType: "general", toothNumbers: ["16"] })])["16"];
  assert.deepEqual(general.treatments, []);
});

test("legacy duplicates collapse to one picture; result is order-independent (stable engine signature)", () => {
  const a = item({ procedureCode: "filling", targetType: "surface", surfaces: ["O"] });
  const b = item({ procedureCode: "filling", targetType: "surface", surfaces: ["M"], status: "in_progress" });
  const c = item();
  const one = run([a, a, b, c, c])["16"].treatments;
  const two = run([c, b, a])["16"].treatments;
  assert.equal(one.length, 3);
  assert.deepEqual(one, two);
});

test("idempotent: deriving twice from the same inputs gives identical output", () => {
  const items = [item(), item({ toothNumbers: ["26"], procedureCode: "filling", targetType: "surface", surfaces: ["O"] })];
  assert.deepEqual(JSON.parse(JSON.stringify(run(items))), JSON.parse(JSON.stringify(run(items))));
});

test("condition != treatment: a Caries diagnosis alone creates no treatment visual and no plan badge", () => {
  const states = deriveToothStates([ev()]);
  const v = toVisualState(states["13"]);
  const out = run([], { 13: v });
  assert.equal(out["13"].plan, null);
  assert.deepEqual(out["13"].treatments, []);
  assert.equal(out["13"].diagnoses.length, 1);
});

test("condition + planned treatment are both visible on the same tooth", () => {
  const v = toVisualState(deriveToothStates([ev({ fdi: "16", category: "existing_condition", code: "existing_filling", surfaces: ["O"] }), ev({ fdi: "16" })])["16"]);
  const out = run([item()], { 16: v });
  assert.deepEqual(out["16"].fillings, ["O"]);
  assert.equal(out["16"].diagnoses.length, 1);
  assert.equal(out["16"].treatments[0].kind, "crown");
});

test("resolved events are not on the chart", () => {
  assert.deepEqual(deriveToothStates([ev({ status: "resolved" })]), {});
});
