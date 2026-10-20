/* PHASE 5 — multi / serial teeth in the chart (tests 13, 28–30, 32–33, 39, 43–45) and deep links (tests 46–52). Pure unit tests:
       node --import ./tests/support/register.mjs --experimental-transform-types --test tests/dental-p5-multi-deeplink.test.mjs
   (the server-side multi-tooth tests 26–27, 31, 34–38, 40 are in backEnd/tests/dental/dental-chart-v2.test.js) */
import test from "node:test";
import assert from "node:assert/strict";
import { PROCEDURES, findProcedure, targetError, deriveTargetMode } from "../src/lib/dental/procedures.ts";
import { applyPlanToVisual } from "../src/lib/dental/planVisual.ts";
import { emptyVisualState } from "../src/lib/dental/toothStates.ts";
import { deriveToothMarks, marksSignature } from "../src/lib/dental/toothMarks.ts";
import { upsertItem, patchItem, diffPlanItems } from "../src/lib/dental/planCache.ts";
import { sortByChart, teethSummary } from "../src/lib/dental/teethFormat.ts";
import { buildHistoryHref, parseProfileFocus, hasFocusTarget, sanitizeTeeth, findFocusedItem } from "../src/lib/history/deeplink.ts";
import { resolveChartLink } from "../src/lib/dental/focusLink.ts";
import { JawModel } from "../src/components/dental/engine/JawModel.ts";
import { buildDentitionConfig } from "../src/components/dental/engine/dentitionConfig.ts";

const OID = (n) => String(n).padStart(24, "a");
const mk = (over) => ({ _id: OID(1), status: "planned", procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["14", "15", "16"], surfaces: [], phase: 1, createdAt: "2026-01-01", priority: "normal", ...over });
const visualOf = (items) => applyPlanToVisual({}, items, emptyVisualState);
const model = new JawModel(buildDentitionConfig("permanent", null));
const t3 = (fdi) => model.teeth.get(fdi);
const parse = (o) => parseProfileFocus(new URLSearchParams(o));
const emptyPlan = () => ({ items: [], summary: { planned: 0, inProgress: 0, completed: 0, cancelled: 0 }, phases: [{ number: 1 }] });
const t = (k) => k;

test("[P5-26f] every tooth-level procedure can target several teeth; whole-mouth ones stay general; the editor rules match the server's", () => {
  const multi = PROCEDURES.filter((p) => p.targets.includes("multi_tooth")).map((p) => p.code);
  for (const c of ["filling", "root_canal", "extraction", "crown", "implant", "veneer", "bridge", "scaling", "whitening", "denture", "sealant", "other"]) assert.ok(multi.includes(c), c);
  assert.equal(findProcedure("scaling").defaultTarget, "general");
  assert.equal(targetError({ procedureCode: "crown", targetType: "multi_tooth", teeth: ["14", "15"], surfaces: [] }, "permanent"), null);
  assert.equal(targetError({ procedureCode: "crown", targetType: "multi_tooth", teeth: ["14"], surfaces: [] }, "permanent"), "dn.err.needTeeth");
  assert.equal(targetError({ procedureCode: "crown", targetType: "multi_tooth", teeth: ["14", "99"], surfaces: [] }, "permanent"), "dn.invalidFdi");
  assert.equal(targetError({ procedureCode: "crown", targetType: "multi_tooth", teeth: ["14", "15"], surfaces: ["O"] }, "permanent"), "dn.err.target", "a crown has no surfaces");
  assert.equal(targetError({ procedureCode: "filling", targetType: "multi_tooth", teeth: ["16", "17"], surfaces: ["O"] }, "permanent"), null, "same surfaces on both");
  assert.equal(targetError({ procedureCode: "filling", targetType: "multi_tooth", teeth: ["16", "17"], surfaces: [], toothSurfaces: { 16: ["M", "O"], 17: ["O"] } }, "permanent"), null);
  assert.equal(targetError({ procedureCode: "filling", targetType: "multi_tooth", teeth: ["16", "17"], surfaces: [], toothSurfaces: { 16: ["M", "O"], 17: [] } }, "permanent"), "dn.err.needSurfaceEach");
});

test("[P5-39f] a single-tooth treatment stays valid exactly as before", () => {
  assert.equal(targetError({ procedureCode: "crown", targetType: "tooth", teeth: ["26"], surfaces: [] }, "permanent"), null);
  assert.equal(targetError({ procedureCode: "filling", targetType: "surface", teeth: ["26"], surfaces: ["D"] }, "permanent"), null);
  assert.equal(targetError({ procedureCode: "filling", targetType: "surface", teeth: ["26"], surfaces: [] }, "permanent"), "dn.err.needSurface");
  assert.equal(deriveTargetMode("tooth", ["26"], "permanent"), "single_tooth");
  assert.equal(deriveTargetMode("general", [], "permanent"), "general");
});

test("[P5-26g] target mode is derived: several teeth = multi_tooth, a whole arch = arch (permanent + primary), mixed never claims an arch", () => {
  const upper = ["18","17","16","15","14","13","12","11","21","22","23","24","25","26","27","28"];
  assert.equal(deriveTargetMode("multi_tooth", ["14", "15", "16"], "permanent"), "multi_tooth");
  assert.equal(deriveTargetMode("multi_tooth", upper, "permanent"), "arch");
  assert.equal(deriveTargetMode("multi_tooth", upper.slice(1), "permanent"), "multi_tooth");
  assert.equal(deriveTargetMode("multi_tooth", ["55","54","53","52","51","61","62","63","64","65"], "primary"), "arch");
  assert.equal(deriveTargetMode("multi_tooth", upper, "mixed"), "multi_tooth");
});

test("[P5-28f] the list text of a multi-tooth treatment names every tooth (long lists summarised by range, never dropped)", () => {
  assert.equal(teethSummary(["14", "15", "16"], t).includes("14"), true);
  const s = teethSummary(["11","12","13","14","15","16","17","18"], t);
  assert.ok(s.length > 0);
  assert.deepEqual(sortByChart(["26", "11", "18", "36"]), ["18", "11", "26", "36"]);
});

test("[P5-29] the 2D chart shows ALL selected teeth: every tooth of the group carries the treatment mark", () => {
  const v = visualOf([mk()]);
  for (const f of ["14", "15", "16"]) assert.ok(marksSignature(deriveToothMarks(f, v[f])).includes("crown|planned"), f);
  for (const f of ["13", "17"]) assert.equal(v[f], undefined, `${f} is not part of the group`);
});

test("[P5-30] the 3D chart shows ALL selected teeth, the same marks as 2D", () => {
  const v = visualOf([mk({ procedureCode: "filling", surfaces: ["O"] })]);
  for (const f of ["14", "15", "16"]) {
    t3(f).applyState(v[f]);
    assert.deepEqual(Array.from(new Set(t3(f).markSummary())), Array.from(new Set(marksSignature(deriveToothMarks(f, v[f])))), f);
    assert.deepEqual(t3(f).markSummary(), ["filling|planned|O"]);
  }
});

test("[P5-S] DIFFERENT surfaces per tooth: each tooth shows only its own surfaces, in 2D and 3D alike", () => {
  const v = visualOf([mk({ procedureCode: "filling", toothNumbers: ["16", "17", "18"], surfaces: ["M", "O", "D"], toothSurfaces: { 16: ["M", "O"], 17: ["O"], 18: ["D"] } })]);
  const expect = { 16: ["M", "O"], 17: ["O"], 18: ["D"] };
  for (const [f, ss] of Object.entries(expect)) {
    const m = deriveToothMarks(f, v[f]);
    assert.deepEqual(["M", "D", "B", "L", "O"].filter((s) => m.surfaces[s].length), ss.slice().sort((a, b) => ["M", "D", "B", "L", "O"].indexOf(a) - ["M", "D", "B", "L", "O"].indexOf(b)), `2D ${f}`);
    t3(f).applyState(v[f]);
    assert.deepEqual(t3(f).markSummary(), ss.map((s) => `filling|planned|${s}`).sort(), `3D ${f}`);
  }
});

test("[P5-32f] removing ONE tooth from a group keeps the others; the removed tooth is clean", () => {
  const before = visualOf([mk()]);
  const after = visualOf([mk({ toothNumbers: ["14", "16"] })]);
  assert.ok(before["15"] && !after["15"]);
  assert.ok(after["14"] && after["16"]);
});

test("[P5-33f] editing / adding a tooth patches the SAME record in the shared cache (never a second copy)", () => {
  const plan = { ...emptyPlan(), items: [mk()] };
  const edited = upsertItem(plan, mk({ toothNumbers: ["14", "15", "16", "17"] }));
  assert.equal(edited.items.length, 1);
  assert.deepEqual(edited.items[0].toothNumbers, ["14", "15", "16", "17"]);
  const again = upsertItem(edited, mk({ toothNumbers: ["14", "15", "16", "17"] }));
  assert.equal(again.items.length, 1, "re-delivery of the same record is idempotent");
  const optimistic = patchItem(again, OID(1), { toothNumbers: ["14", "15"] });
  assert.equal(optimistic.items.length, 1);
  const diff = diffPlanItems(plan.items, edited.items);
  assert.deepEqual(diff.teeth, ["14", "15", "16", "17"], "the glow covers old AND new teeth");
  assert.deepEqual(diff.changedIds, [OID(1)]);
  // dropping the per-tooth map really drops it (server item is authoritative)
  const withMap = upsertItem(plan, mk({ procedureCode: "filling", toothSurfaces: { 14: ["O"], 15: ["D"], 16: ["M"] } }));
  assert.ok(withMap.items[0].toothSurfaces);
  assert.equal(upsertItem(withMap, mk({ procedureCode: "filling", surfaces: ["O"] })).items[0].toothSurfaces, undefined);
});

test("[P5-13f] a surface edit keeps the SAME record id and updates the chart in the same render", () => {
  const plan = { ...emptyPlan(), items: [mk({ targetType: "surface", procedureCode: "filling", toothNumbers: ["26"], surfaces: ["D"] })] };
  const next = upsertItem(plan, mk({ targetType: "surface", procedureCode: "filling", toothNumbers: ["26"], surfaces: ["D", "O"] }));
  assert.equal(next.items.length, 1); assert.equal(next.items[0]._id, OID(1));
  assert.deepEqual(visualOf(next.items)["26"].treatments[0].surfaces, ["D", "O"]);
});

/* ---------------------------------------------------------------- 2D / 3D shared state (data level; the live switch is in the browser acceptance run) */
test("[P5-43] multi-selected teeth are the SAME list for both modes: stable order, no duplicates, only real teeth", () => {
  const sel = sortByChart(["27", "26", "26", "11", "18"]);
  assert.deepEqual(sel, ["18", "11", "26", "27"]);
  assert.deepEqual(sanitizeTeeth(["26", "26", "2x", "999", "27"]), ["26", "27"]);
});

test("[P5-44] a treatment STATUS change reaches 2D marks and 3D marks from the same state, in one step", () => {
  const items = [mk({ procedureCode: "filling", targetType: "surface", toothNumbers: ["26"], surfaces: ["D"] })];
  for (const [status, sem] of [["planned", "planned"], ["in_progress", "inProgress"], ["completed", "completed"]]) {
    const v = visualOf([{ ...items[0], status }])["26"];
    t3("26").applyState(v);
    assert.deepEqual(t3("26").markSummary(), [`filling|${sem}|D`]);
    assert.deepEqual(marksSignature(deriveToothMarks("26", v)), [`filling|${sem}|D`]);
  }
  assert.deepEqual(visualOf([{ ...items[0], status: "cancelled" }])["26"] ?? null, null, "cancelled work is not drawn");
});

test("[P5-45] a SURFACE update reaches 2D marks and 3D marks from the same state, in one step", () => {
  for (const surfaces of [["D"], ["M", "O", "D"], ["O"]]) {
    const v = visualOf([mk({ procedureCode: "filling", targetType: "surface", toothNumbers: ["26"], surfaces })])["26"];
    t3("26").applyState(v);
    const want = surfaces.map((s) => `filling|planned|${s}`).sort();
    assert.deepEqual(t3("26").markSummary(), want);
    assert.deepEqual(marksSignature(deriveToothMarks("26", v)), want);
  }
});

/* ---------------------------------------------------------------- deep links */
test("[P5-46] the Phase 3 Dental Chart deep link still builds and parses exactly as before", () => {
  const href = buildHistoryHref(OID(9), { tab: "dental-chart", toothNumber: "26", surface: "D", eventId: OID(2), noteId: "n:1", sourceId: OID(3) });
  const f = parseProfileFocus(new URL(href, "http://x").searchParams);
  assert.deepEqual([f.tab, f.tooth, f.surface, f.event, f.note, f.source, f.teeth], ["dental-chart", "26", "D", OID(2), "n:1", OID(3), null]);
  assert.ok(hasFocusTarget(f));
  assert.ok(!href.includes("teeth="), "a single-tooth link carries no teeth param");
});

test("[P5-47] the correct tooth opens (link tooth > chart entry's tooth > first tooth of the linked treatment)", () => {
  const events = [{ _id: OID(2), fdi: "36" }];
  const items = [{ _id: OID(5), toothNumbers: ["14", "15", "16"] }];
  assert.equal(resolveChartLink(parse({ tab: "dental-chart", tooth: "26", event: OID(2) }), { events, planItems: items }).tooth, "26");
  assert.equal(resolveChartLink(parse({ tab: "dental-chart", event: OID(2) }), { events, planItems: items }).tooth, "36");
  assert.equal(resolveChartLink(parse({ tab: "dental-chart", item: OID(5) }), { events, planItems: items }).tooth, "14");
});

test("[P5-48] the correct treatment opens: matched by its stable id only, never by text or position", () => {
  const items = [{ _id: OID(5), toothNumbers: ["14"] }, { _id: OID(6), toothNumbers: ["15"] }];
  assert.equal(findFocusedItem(items, { item: OID(6) })._id, OID(6));
  assert.equal(findFocusedItem(items, { item: OID(7) }), null);
  assert.equal(resolveChartLink(parse({ tab: "dental-chart", item: OID(6) }), { planItems: items }).tooth, "15");
});

test("[P5-49] note focus survives: the note / source ids are validated and kept on the link", () => {
  const f = parse({ tab: "dental-chart", tooth: "26", note: "evt:abc-1", source: OID(3) });
  assert.equal(f.note, "evt:abc-1"); assert.equal(f.source, OID(3));
  assert.equal(parse({ tab: "dental-chart", note: "a b<c" }).note, null, "hostile note ids are dropped");
});

test("[P5-50] surface metadata is preserved (and only the five real surfaces)", () => {
  assert.equal(resolveChartLink(parse({ tab: "dental-chart", tooth: "26", surface: "D" }), {}).surface, "D");
  assert.equal(resolveChartLink(parse({ tab: "dental-chart", tooth: "26", surface: "Z" }), {}).surface, null);
  const href = buildHistoryHref(OID(9), { tab: "dental-chart", toothNumber: "26", surface: "M" });
  assert.equal(parse(Object.fromEntries(new URL(href, "http://x").searchParams)).surface, "M");
});

test("[P5-51] a MISSING target fails gracefully: no tooth is invented, the chart is told what is missing", () => {
  const miss = resolveChartLink(parse({ tab: "dental-chart", event: OID(8) }), { events: [{ _id: OID(2), fdi: "36" }] });
  assert.equal(miss.tooth, null); assert.equal(miss.eventMissing, true);
  const missItem = resolveChartLink(parse({ tab: "dental-chart", item: OID(8) }), { planItems: [{ _id: OID(5), toothNumbers: ["14"] }] });
  assert.equal(missItem.tooth, null); assert.equal(missItem.itemMissing, true); assert.deepEqual(missItem.teeth, []);
  const notLoaded = resolveChartLink(parse({ tab: "dental-chart", item: OID(8) }), {});
  assert.equal(notLoaded.itemMissing, false, "data still loading is not 'missing'");
  const junk = parse({ tab: "dental-chart", tooth: "9999", teeth: "<script>,26,26,7", event: "x" });
  assert.deepEqual(junk.teeth, ["26"]); assert.equal(junk.tooth, null); assert.equal(junk.event, null);
});

test("[P5-52] a multi-tooth treatment link highlights EVERY tooth of the group (by item id or by teeth=)", () => {
  const items = [{ _id: OID(5), toothNumbers: ["14", "15", "16", "17"] }];
  const byItem = resolveChartLink(parse({ tab: "dental-chart", item: OID(5) }), { planItems: items });
  assert.deepEqual(byItem.teeth, ["14", "15", "16", "17"]);
  const href = buildHistoryHref(OID(9), { tab: "dental-chart", toothNumber: "14", toothNumbers: ["14", "15", "16", "17"] });
  assert.ok(href.includes("teeth=14%2C15%2C16%2C17"));
  const back = resolveChartLink(parseProfileFocus(new URL(href, "http://x").searchParams), {});
  assert.deepEqual(back.teeth, ["14", "15", "16", "17"]); assert.equal(back.tooth, "14");
  assert.deepEqual(resolveChartLink(parse({ tab: "dental-chart", tooth: "26" }), {}).teeth, [], "a single tooth is not a group");
  assert.equal(sanitizeTeeth(Array.from({ length: 80 }, (_, i) => String(10 + i))).length, 32, "capped");
});
