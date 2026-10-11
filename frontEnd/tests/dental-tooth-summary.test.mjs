/* Dental Chart — per-tooth Treatment Summary (src/lib/dental/toothSummary.ts + the hover card / panel wiring).
   Pure logic and static guarantees: no browser, no network. The rendered behaviour (hover, click, touch, Arabic/RTL, mobile,
   live refresh) is covered by tests/dental/e2e/dental-summary.e2e.mjs against the real app.
       node --test tests/dental-tooth-summary.test.mjs
   (Node >= 22.18, or 22.6+ with --experimental-strip-types — same as tests/dental-plan-visual.test.mjs.) */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { indexTreatmentsByTooth, treatmentsOf, buildToothSummary, HOVER_MAX_TREATMENTS } from "../src/lib/dental/toothSummary.ts";
import { applyPlanToVisual } from "../src/lib/dental/planVisual.ts";
import { deriveToothStates, emptyVisualState, toVisualState } from "../src/lib/dental/toothStates.ts";
import { getToothMeta, teethForDentition } from "../src/lib/dental/fdi.ts";

let n = 0;
const item = (over = {}) => ({
  _id: "i" + ++n, planId: "p", procedureCode: "filling", targetType: "surface", toothNumbers: ["16"], surfaces: ["O"], status: "planned", priority: "normal", phase: 1,
  estimatedPrice: null, sourceDiagnosisIds: [], dentitionType: "permanent", statusHistory: [], createdBy: null, createdAt: "", updatedAt: "", billing: { state: "none" }, ...over,
});
const dx = (fdi, code = "caries", over = {}) => ({ _id: "e" + ++n, fdi, dentitionType: "permanent", category: "diagnosis", code, surfaces: ["O"], status: "active", createdAt: "", createdBy: null, ...over });
const read = (f) => fs.readFileSync(new URL("../src/" + f, import.meta.url), "utf8");

/* ---------- 1–4: one / many / other tooth / none ---------- */
test("1 a tooth with one treatment shows it, with the plan's own status", () => {
  const idx = indexTreatmentsByTooth([item({ status: "planned" })]);
  const s = buildToothSummary("16", [], idx);
  assert.equal(s.total, 1);
  assert.equal(s.shown[0].procedureCode, "filling");
  assert.equal(s.shown[0].status, "planned");
  assert.equal(s.hidden, 0);
});

test("2 a tooth with several treatments lists them all (up to the preview limit), none dropped silently", () => {
  const idx = indexTreatmentsByTooth([item({ procedureCode: "root_canal", targetType: "tooth", surfaces: [], status: "completed" }), item({ procedureCode: "crown", targetType: "tooth", surfaces: [] })]);
  const s = buildToothSummary("16", [], idx);
  assert.equal(s.total, 2);
  assert.deepEqual(s.shown.map((x) => x.procedureCode).sort(), ["crown", "root_canal"]);
  assert.equal(s.hidden, 0);
});

test("3 a treatment of tooth A never appears on tooth B (16 vs 15, 116, 26, primary 56, 17)", () => {
  const idx = indexTreatmentsByTooth([item({ toothNumbers: ["16"] })]);
  for (const other of ["15", "17", "26", "46", "56", "116", "1", "6", ""]) assert.equal(treatmentsOf(idx, other).length, 0, `tooth "${other}" must be empty`);
  assert.equal(treatmentsOf(idx, "16").length, 1);
});

test("4 a tooth with no treatment is clean: empty list, nothing invented", () => {
  const s = buildToothSummary("11", [], indexTreatmentsByTooth([item()]));
  assert.deepEqual([s.total, s.shown.length, s.hidden, s.diagnoses.length], [0, 0, 0, 0]);
  assert.equal(treatmentsOf(indexTreatmentsByTooth(undefined), "16").length, 0);
  assert.equal(treatmentsOf(indexTreatmentsByTooth(null), "16").length, 0);
});

/* ---------- 5: diagnosis is separate ---------- */
test("5 diagnosis stays separate from treatment (a Caries diagnosis creates no treatment; a treatment erases no diagnosis)", () => {
  const events = [dx("16", "caries"), dx("16", "pulpitis", { status: "resolved" }), dx("16", "existing_filling", { category: "existing_condition" }), dx("17", "caries")];
  const states = deriveToothStates(events);
  const noTreat = buildToothSummary("16", states["16"]?.diagnoses, indexTreatmentsByTooth([]));
  assert.deepEqual(noTreat.diagnoses.map((d) => d.code), ["caries"]); // active diagnosis only: not the resolved one, not the existing condition
  assert.equal(noTreat.total, 0);
  const withTreat = buildToothSummary("16", states["16"]?.diagnoses, indexTreatmentsByTooth([item()]));
  assert.deepEqual(withTreat.diagnoses.map((d) => d.code), ["caries"]);
  assert.equal(withTreat.total, 1);
  // the other tooth's diagnosis is not on 16
  assert.deepEqual(buildToothSummary("17", states["17"]?.diagnoses, indexTreatmentsByTooth([])).diagnoses.map((d) => d.code), ["caries"]);
});

/* ---------- 6–7: existing Filling / Crown visualisation is untouched by the summary ---------- */
test("6/7 the Filling / Crown chart pictures still come from the plan exactly as before (summary does not alter them)", () => {
  const items = [item({ procedureCode: "filling", surfaces: ["M", "O"], toothNumbers: ["26"] }), item({ procedureCode: "crown", targetType: "tooth", surfaces: [], toothNumbers: ["27"], status: "completed" })];
  const before = JSON.stringify(applyPlanToVisual({}, items, emptyVisualState));
  indexTreatmentsByTooth(items); buildToothSummary("26", [], indexTreatmentsByTooth(items)); // the summary is read-only
  assert.equal(JSON.stringify(applyPlanToVisual({}, items, emptyVisualState)), before);
  const v = applyPlanToVisual({}, items, emptyVisualState);
  assert.deepEqual(v["26"].treatments, [{ kind: "filling", status: "planned", surfaces: ["M", "O"] }]);
  assert.deepEqual(v["27"].treatments, [{ kind: "crown", status: "completed", surfaces: [] }]);
  assert.equal(v["27"].treated, true);
  // the input is never mutated
  const frozen = Object.freeze(items.map((x) => Object.freeze({ ...x, toothNumbers: Object.freeze([...x.toothNumbers]) })));
  assert.doesNotThrow(() => indexTreatmentsByTooth(frozen));
});

/* ---------- 12: live update ---------- */
test("12 the summary follows the plan data: a changed / new / cancelled item changes the next result (nothing is cached inside)", () => {
  let items = [item({ _id: "a", status: "planned" })];
  assert.equal(buildToothSummary("16", [], indexTreatmentsByTooth(items)).shown[0].status, "planned");
  items = [item({ _id: "a", status: "completed" })];
  assert.equal(buildToothSummary("16", [], indexTreatmentsByTooth(items)).shown[0].status, "completed");
  items = [...items, item({ _id: "b", procedureCode: "crown", targetType: "tooth", surfaces: [] })];
  assert.equal(buildToothSummary("16", [], indexTreatmentsByTooth(items)).total, 2);
  items = items.map((x) => (x._id === "b" ? { ...x, status: "cancelled" } : x));
  assert.equal(buildToothSummary("16", [], indexTreatmentsByTooth(items)).total, 1);
});

/* ---------- 13–14: statuses and completed treatment ---------- */
test("13/14 only the real statuses exist; completed is kept, cancelled is left out (same rule as the chart pictures and the tooth panel)", () => {
  const idx = indexTreatmentsByTooth([item({ status: "completed" }), item({ status: "cancelled", procedureCode: "crown", targetType: "tooth", surfaces: [] }), item({ status: "in_progress", procedureCode: "root_canal", targetType: "tooth", surfaces: [] })]);
  const s = buildToothSummary("16", [], idx);
  assert.deepEqual(s.shown.map((x) => x.status), ["in_progress", "completed"]); // open work first, completed kept
  assert.ok(s.shown.every((x) => ["planned", "in_progress", "completed"].includes(x.status)));
  assert.equal(s.total, 2);
  // the labels are the EXISTING translations
  const i18n = read("lib/i18n.tsx");
  for (const k of ["planned", "in_progress", "completed", "cancelled"]) assert.ok(i18n.includes(`"dn.ps.${k}"`), `existing status key dn.ps.${k}`);
});

/* ---------- 15–17: adult / primary / mixed ---------- */
test("15/16/17 adult, primary and mixed dentition teeth each get exactly their own treatments", () => {
  const all = ["16", "26", "36", "46", "55", "65", "75", "85", "18"];
  const idx = indexTreatmentsByTooth(all.map((f, i) => item({ _id: "t" + i, toothNumbers: [f], dentitionType: f[0] >= "5" ? "primary" : "permanent" })));
  for (const f of all) {
    const own = treatmentsOf(idx, f);
    assert.equal(own.length, 1, f);
    assert.deepEqual(own[0].toothNumbers, [f]);
  }
  // mixed dentition shows both numbering systems in one mouth: 16 (permanent) and 55 (primary) in the same plan never mix
  assert.equal(treatmentsOf(idx, "16")[0]._id, "t0");
  assert.equal(treatmentsOf(idx, "55")[0]._id, "t4");
  // every tooth the chart can show (all 52 FDI codes) round-trips through its own key only
  const items = teethForDentition("mixed").map((m, i) => item({ _id: "m" + i, toothNumbers: [m.fdi] }));
  const mixed = indexTreatmentsByTooth(items);
  for (const m of teethForDentition("mixed")) {
    const got = treatmentsOf(mixed, m.fdi);
    assert.equal(got.length, 1, m.fdi);
    assert.deepEqual(got[0].toothNumbers, [m.fdi]);
  }
  assert.equal(teethForDentition("mixed").length, 52);
  assert.ok(getToothMeta("16") && getToothMeta("55"));
});

test("multi-tooth (bridge 14-15-16) appears on each of its teeth once; whole-mouth items on none; duplicate numbers do not duplicate", () => {
  const idx = indexTreatmentsByTooth([
    item({ _id: "br", procedureCode: "bridge", targetType: "multi_tooth", toothNumbers: ["14", "15", "16", "16"], surfaces: [] }),
    item({ _id: "sc", procedureCode: "scaling", targetType: "general", toothNumbers: [], surfaces: [] }),
  ]);
  for (const f of ["14", "15", "16"]) assert.deepEqual(treatmentsOf(idx, f).map((x) => x._id), ["br"]);
  assert.equal(treatmentsOf(idx, "17").length, 0);
  assert.equal(idx.size, 3);
});

/* ---------- 20–21: long names, many treatments ---------- */
test("21 many treatments: the preview is capped and says how many more, the total stays exact", () => {
  const many = Array.from({ length: 7 }, (_, i) => item({ _id: "m" + i, procedureCode: "other", customName: "Procedure " + i, targetType: "tooth", surfaces: [], status: i === 6 ? "in_progress" : "planned" }));
  const s = buildToothSummary("16", [], indexTreatmentsByTooth(many));
  assert.equal(HOVER_MAX_TREATMENTS, 3);
  assert.equal(s.shown.length, 3);
  assert.equal(s.hidden, 4);
  assert.equal(s.total, 7);
  assert.equal(s.shown[0]._id, "m6"); // in progress first, then plan order
  assert.deepEqual(s.shown.slice(1).map((x) => x._id), ["m0", "m1"]);
});

test("20 a very long treatment name cannot break the card (the markup clamps and wraps it)", () => {
  const card = read("components/dental/ToothHoverSummary.tsx");
  assert.match(card, /max-w-\[260px\]/);
  assert.match(card, /line-clamp-2/);
  assert.match(card, /break-words/);
  const panel = read("components/dental/ToothPanel.tsx");
  assert.match(panel, /min-w-0 break-words/);
});

/* ---------- 22: no request per hover ---------- */
test("22 no network at all: the summary module and the hover card import neither the API client nor any query hook", () => {
  for (const f of ["lib/dental/toothSummary.ts", "components/dental/ToothHoverSummary.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /from "@\/lib\/api"|from "axios"|useQuery|useMutation|fetch\(|api\.(get|post|put)/, f);
    assert.doesNotMatch(src, /console\./, f + " must not log clinical data");
  }
});

test("22b the chart derives the summary from the ONE already-loaded plan query (no second query, no per-tooth request)", () => {
  const tab = read("components/dental/DentalChartTab.tsx");
  assert.equal((tab.match(/useTreatmentPlan\(/g) ?? []).length, 1);
  assert.match(tab, /indexTreatmentsByTooth\(planItems\)/);
  assert.doesNotMatch(tab, /api\.(get|post|put)\(/);
  assert.doesNotMatch(tab, /useQuery\(/);
});

/* ---------- 23–24: hover cost / 3D untouched ---------- */
test("23/24 hovering does not touch the 3D scene: the engine is not modified and the tooltip is positioned imperatively", () => {
  const tab = read("components/dental/DentalChartTab.tsx");
  assert.match(tab, /tip\.style\.transform/); // moved by style, not by React state per pointer move
  assert.match(tab, /setHover\(\(p\) => \(p === f \? p : f\)\)/); // re-render only when the hovered TOOTH changes
  const scene = read("components/dental/DentalScene3D.tsx");
  assert.doesNotMatch(scene, /hoverSummary|ToothHoverSummary|byTooth/); // the scene component knows nothing about the summary
  const card = read("components/dental/ToothHoverSummary.tsx");
  assert.match(card, /pointer-events-none/); // cannot steal the click / cannot flicker by being entered
});

/* ---------- 10/11, a11y: hover is not the only way ---------- */
test("10/11 click/tap is independent of hover: hover is only rendered for fine hover-capable pointers; the panel shows the same data", () => {
  const tab = read("components/dental/DentalChartTab.tsx");
  assert.match(tab, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(tab, /canHover && hoverSummary/);
  const panel = read("components/dental/ToothPanel.tsx");
  assert.match(panel, /dn\.forTooth/); // the Treatment Plan section
  assert.match(panel, /dn\.diagnoses/); // the Diagnosis section
  assert.match(panel, /dn\.viewPlan/); // the "View Plan" action
});

/* ---------- 18/19: Arabic / RTL ---------- */
test("18/19 every new string exists in English AND Arabic; the card follows the UI direction while FDI numbers stay LTR", () => {
  const i18n = read("lib/i18n.tsx");
  for (const k of ["dn.tt.none", "dn.tt.more", "dn.tt.click"]) assert.equal((i18n.match(new RegExp(`"${k}":`, "g")) ?? []).length, 2, k);
  assert.match(i18n, /"dn\.tt\.none": "لا توجد خطة علاج لهذا السن"/);
  assert.match(i18n, /"dn\.tt\.none": "No treatment planned"/);
  const card = read("components/dental/ToothHoverSummary.tsx");
  assert.match(card, /dir=\{lang === "ar" \? "rtl" : "ltr"\}/);
  assert.match(card, /font-mono[^"]*"[^>]*dir="ltr"/);
  assert.doesNotMatch(card, /\b(?:ml|mr|pl|pr)-\d/); // logical spacing only (ms-/me-/ps-/pe-)
});

/* ---------- security / privacy ---------- */
test("security: no new endpoint, no clinic/patient id taken from the client, nothing logged", () => {
  const hooks = read("lib/dental/hooks.ts");
  assert.equal((hooks.match(/treatment-plan`\)/g) ?? []).length, 1, "still one treatment-plan READ");
  for (const f of ["lib/dental/toothSummary.ts", "components/dental/ToothHoverSummary.tsx"]) assert.doesNotMatch(read(f), /clinicId|localStorage|sessionStorage/, f);
});
