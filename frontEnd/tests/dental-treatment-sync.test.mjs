/* PHASE 4 — Treatment Plan <-> Dental Chart sync: the pure rules behind the ONE canonical cache (src/lib/dental/planCache.ts),
   the chart derivation that 2D + 3D share (planVisual.ts) and the localized error mapping (errors.ts).
   Pure unit tests, no browser, no network (Node >= 22.18):  node --test tests/dental-treatment-sync.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { upsertItem, patchItem, recomputeSummary, diffPlanItems, newRequestId } from "../src/lib/dental/planCache.ts";
import { applyPlanToVisual } from "../src/lib/dental/planVisual.ts";
import { emptyVisualState } from "../src/lib/dental/toothStates.ts";
import { treatmentErrorKey } from "../src/lib/dental/errors.ts";

const item = (over = {}) => ({ _id: "i1", status: "planned", procedureCode: "filling", targetType: "surface", toothNumbers: ["26"], surfaces: ["D"], priority: "normal", phase: 1, estimatedPrice: 40, createdAt: "2026-10-19T08:00:00Z", ...over });
const plan = (items) => ({ plan: { phases: [{ number: 1 }] }, items, sessions: [], visits: {}, timeline: [], summary: { planned: 0, inProgress: 0, completed: 0, cancelled: 0, estimatedTotal: 0, estimatedRemaining: 0, invoicedTotal: 7, invoicedCount: 1 } });
const chart = (p) => applyPlanToVisual({}, p.items, emptyVisualState);

test("canonical cache: a new record is appended ONCE and the summary follows", () => {
  const p = upsertItem(plan([]), item());
  assert.equal(p.items.length, 1);
  assert.deepEqual([p.summary.planned, p.summary.estimatedTotal, p.summary.estimatedRemaining], [1, 40, 40]);
  assert.equal(p.summary.invoicedTotal, 7, "invoice figures (server-only) are left untouched");
});

test("the same confirmed record twice (replay / double response) never creates a second entry", () => {
  const once = upsertItem(plan([]), item());
  const twice = upsertItem(once, item());
  assert.equal(twice.items.length, 1);
  assert.equal(twice.items[0]._id, "i1");
});

test("an edit replaces the SAME record by id (D -> D+O) and the chart derivation follows", () => {
  const p0 = upsertItem(plan([]), item());
  const p1 = upsertItem(p0, item({ surfaces: ["D", "O"], notes: "edited" }));
  assert.equal(p1.items.length, 1);
  assert.deepEqual(chart(p1)["26"].treatments, [{ kind: "filling", status: "planned", surfaces: ["D", "O"] }]);
});

test("status change on the same record: planned -> in_progress -> completed (chart + counters)", () => {
  let p = upsertItem(plan([]), item());
  p = upsertItem(p, item({ status: "in_progress" }));
  assert.equal(chart(p)["26"].plan, "in_progress");
  assert.deepEqual([p.summary.planned, p.summary.inProgress], [0, 1]);
  p = upsertItem(p, item({ status: "completed" }));
  assert.equal(chart(p)["26"].treated, true);
  assert.deepEqual([p.items.length, p.summary.completed, p.summary.estimatedRemaining], [1, 1, 0]);
});

test("optimistic patch + rollback restores the exact previous record", () => {
  const p0 = upsertItem(plan([]), item());
  const prev = p0.items[0];
  const optimistic = patchItem(p0, "i1", { surfaces: ["D", "O"] });
  assert.deepEqual(chart(optimistic)["26"].treatments[0].surfaces, ["D", "O"]);
  const rolledBack = patchItem(optimistic, "i1", prev);
  assert.deepEqual(rolledBack.items[0], prev);
  assert.deepEqual(chart(rolledBack)["26"].treatments[0].surfaces, ["D"]);
});

test("optimistic cancel hides the tooth from the chart; rollback brings it back", () => {
  const p0 = upsertItem(plan([]), item());
  const cancelled = patchItem(p0, "i1", { status: "cancelled" });
  assert.equal(chart(cancelled)["26"], undefined);
  assert.equal(cancelled.summary.cancelled, 1);
  assert.equal(cancelled.summary.estimatedTotal, 0, "cancelled items leave the estimated total");
  const back = patchItem(cancelled, "i1", p0.items[0]);
  assert.equal(chart(back)["26"].plan, "planned");
});

test("patching an unknown id is a no-op (a record removed by a re-read is not resurrected)", () => {
  const p0 = plan([item()]);
  assert.equal(patchItem(p0, "zzz", { status: "cancelled" }), p0);
  assert.equal(patchItem(undefined, "i1", {}), undefined);
  assert.equal(upsertItem(undefined, item()), undefined);
});

test("multi-tooth arrays and surfaces survive the cache round-trip untouched", () => {
  const bridge = item({ _id: "b1", procedureCode: "bridge", targetType: "multi_tooth", toothNumbers: ["11", "12", "13"], surfaces: [] });
  const p = upsertItem(upsertItem(plan([]), item()), bridge);
  assert.deepEqual(p.items.find((i) => i._id === "b1").toothNumbers, ["11", "12", "13"]);
  assert.deepEqual(Object.keys(chart(p)).sort(), ["11", "12", "13", "26"]);
});

test("new records keep plan order (phase, then creation time)", () => {
  const p = upsertItem(upsertItem(plan([]), item({ _id: "late", phase: 2, createdAt: "2026-10-19T09:00:00Z" })), item({ _id: "early", phase: 1, createdAt: "2026-10-19T10:00:00Z" }));
  assert.deepEqual(p.items.map((i) => i._id), ["early", "late"]);
});

test("change detection: first load is not a change; add / edit / status change name the affected teeth", () => {
  const a = [item()];
  assert.deepEqual(diffPlanItems(undefined, a), { addedIds: [], changedIds: [], teeth: [] });
  assert.deepEqual(diffPlanItems(a, a), { addedIds: [], changedIds: [], teeth: [] });
  assert.deepEqual(diffPlanItems(a, [...a, item({ _id: "i2", toothNumbers: ["11", "12"], surfaces: [] })]), { addedIds: ["i2"], changedIds: [], teeth: ["11", "12"] });
  assert.deepEqual(diffPlanItems(a, [item({ surfaces: ["D", "O"] })]), { addedIds: [], changedIds: ["i1"], teeth: ["26"] });
  assert.deepEqual(diffPlanItems(a, [item({ status: "in_progress" })]).changedIds, ["i1"]);
  // moving a treatment from tooth 24 to 23 glows BOTH (where it left and where it landed)
  assert.deepEqual(diffPlanItems([item({ toothNumbers: ["24"] })], [item({ toothNumbers: ["23"] })]).teeth, ["23", "24"]);
});

test("recomputeSummary equals the server formula", () => {
  const p = plan([item({ estimatedPrice: 10 }), item({ _id: "b", status: "completed", estimatedPrice: 5.5 }), item({ _id: "c", status: "cancelled", estimatedPrice: 99 }), item({ _id: "d", estimatedPrice: null })]);
  const s = recomputeSummary(p);
  assert.deepEqual([s.planned, s.inProgress, s.completed, s.cancelled, s.estimatedTotal, s.estimatedRemaining], [2, 0, 1, 1, 15.5, 10]);
});

test("idempotency keys: unique per call, within the server's 8..64 length rule", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newRequestId()));
  assert.equal(ids.size, 200);
  assert.ok([...ids].every((x) => x.length >= 8 && x.length <= 64));
});

const axiosErr = (status, code) => { const e = new axios.AxiosError("raw backend text"); e.response = status ? { status, data: { code, message: "SECRET RAW ENGLISH" } } : undefined; return e; };
test("failed mutations map to localized keys — never the raw backend message", () => {
  assert.equal(treatmentErrorKey(axiosErr(409, "DUPLICATE_ITEM")), "dn.err.duplicate");
  assert.equal(treatmentErrorKey(axiosErr(409, "ITEM_LOCKED")), "ts.err.locked");
  assert.equal(treatmentErrorKey(axiosErr(409, "ITEM_CHANGED")), "ts.err.changed");
  assert.equal(treatmentErrorKey(axiosErr(0)), "ts.err.network", "no response at all = network");
  assert.equal(treatmentErrorKey(new Error("boom")), "ts.err.generic");
  const e404 = axiosErr(1); e404.response = { status: 404, data: { message: "Patient not found" } };
  assert.equal(treatmentErrorKey(e404), "ts.err.gone");
  const e500 = axiosErr(1); e500.response = { status: 500, data: { message: "stack…" } };
  assert.equal(treatmentErrorKey(e500), "ts.err.generic");
});
