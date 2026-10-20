/* Phase 3 — Clinical History: deep-link building/parsing + day grouping (pure modules, no browser, no network).
       node --test tests/history-deeplink.test.mjs
   Run under different process timezones — grouping must never depend on the browser's zone:
       TZ=UTC node --test tests/history-deeplink.test.mjs   |   TZ=Pacific/Kiritimati node --test tests/history-deeplink.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import * as dl from "../src/lib/history/deeplink.ts";
import * as gr from "../src/lib/history/grouping.ts";

const P = "64b7f0c2a1b2c3d4e5f60718";
const A = "64b7f0c2a1b2c3d4e5f60719";
const I = "64b7f0c2a1b2c3d4e5f6071a";
const E = "64b7f0c2a1b2c3d4e5f6071b";
const S = "64b7f0c2a1b2c3d4e5f6071c";
const qs = (href) => new URLSearchParams(href.split("?")[1]);

test("dental chart link carries tab, tooth, surface, event, note — and round-trips through parseProfileFocus", () => {
  const href = dl.buildHistoryHref(P, { tab: "dental-chart", sourceId: E, noteId: "note", eventId: E, toothNumber: "26", surface: "D" });
  assert.ok(href.startsWith("/patients/profile?"));
  const f = dl.parseProfileFocus(qs(href));
  assert.equal(f.patient, P); assert.equal(f.tab, "dental-chart"); assert.equal(f.tooth, "26"); assert.equal(f.surface, "D"); assert.equal(f.event, E); assert.equal(f.note, "note");
  assert.equal(dl.hasFocusTarget(f), true);
});

test("treatment-plan link: item and session ids", () => {
  const href = dl.buildHistoryHref(P, { tab: "treatment-plan", sourceId: I, noteId: `session:${S}`, itemId: I, sessionId: S });
  const f = dl.parseProfileFocus(qs(href));
  assert.equal(f.tab, "treatment-plan"); assert.equal(f.item, I); assert.equal(f.session, S);
});

test("appointment link goes to /appointments with appt, date, patient", () => {
  const href = dl.buildHistoryHref(P, { tab: "appointment", sourceId: A, noteId: "visit-note", appointmentId: A, appointmentDate: "2026-03-04" });
  assert.ok(href.startsWith("/appointments?"));
  const q = qs(href);
  assert.equal(q.get("appt"), A); assert.equal(q.get("date"), "2026-03-04"); assert.equal(q.get("patient"), P);
});

test("appointment link without an appointment id (deleted visit) builds no link", () => {
  assert.equal(dl.buildHistoryHref(P, { tab: "appointment", sourceId: "", noteId: "x" }), null);
});

test("invalid patient id / unknown tab / missing link build no link", () => {
  assert.equal(dl.buildHistoryHref("nope", { tab: "record", sourceId: "", noteId: "" }), null);
  assert.equal(dl.buildHistoryHref(P, { tab: "evil", sourceId: "", noteId: "" }), null);
  assert.equal(dl.buildHistoryHref(P, null), null);
});

test("parseProfileFocus rejects malformed / hostile values (never reaches a query or the DOM)", () => {
  const f = dl.parseProfileFocus(new URLSearchParams({ patient: "<script>", tab: "../admin", tooth: "9999", surface: "Z", event: "x".repeat(24), item: "abc", note: "a b<c" }));
  assert.equal(f.patient, null); assert.equal(f.tab, null); assert.equal(f.tooth, null); assert.equal(f.surface, null);
  assert.equal(f.event, null); assert.equal(f.item, null); assert.equal(f.note, null);
  assert.equal(dl.hasFocusTarget(f), false);
});

test("findFocusedItem / findFocusedEvent match by id only", () => {
  const items = [{ _id: I, notes: "Root canal recommended" }, { _id: A, notes: "Root canal recommended" }];
  assert.equal(dl.findFocusedItem(items, { item: A })._id, A);
  assert.equal(dl.findFocusedItem(items, { item: S }), null);
  assert.equal(dl.findFocusedItem(items, { item: null }), null);
  assert.equal(dl.findFocusedEvent([{ _id: E }], { event: E })._id, E);
  assert.equal(dl.findFocusedEvent(undefined, { event: E }), null);
});

test("focusedTooth validates against the dentition; focusedSurface only the 5 surfaces", () => {
  assert.equal(dl.focusedTooth({ tooth: "26" }, ["26", "27"]), "26");
  assert.equal(dl.focusedTooth({ tooth: "26" }, ["16"]), null);
  assert.equal(dl.focusedTooth({ tooth: null }), null);
  assert.equal(dl.focusedSurface({ surface: "O" }), "O");
  assert.equal(dl.focusedSurface({ surface: "X" }), null);
});

const it = (localDate, id) => ({ id, localDate });
test("groupByDay: today / yesterday / earlier this week / one group per older day, in input order", () => {
  const today = "2026-10-17";
  const g = gr.groupByDay([it("2026-10-17", 1), it("2026-10-17", 2), it("2026-10-16", 3), it("2026-10-15", 4), it("2026-10-11", 5), it("2026-10-10", 6), it("2026-10-10", 7), it("2026-09-01", 8)], today);
  assert.deepEqual(g.map((x) => [x.kind, x.items.map((i) => i.id)]), [["today", [1, 2]], ["yesterday", [3]], ["week", [4, 5]], ["date", [6, 7]], ["date", [8]]]);
  assert.equal(g[3].ymd, "2026-10-10");
});

test("groupByDay: month/year boundaries and a clock-skewed future day", () => {
  assert.equal(gr.daysAgo("2026-12-31", "2027-01-01"), 1);
  assert.equal(gr.daysAgo("2026-02-28", "2026-03-01"), 1);
  const g = gr.groupByDay([it("2026-10-18", 1), it("2026-10-17", 2)], "2026-10-17");
  assert.deepEqual(g.map((x) => x.kind), ["today"]);
  assert.equal(g[0].items.length, 2);
});

test("groupByDay: empty input", () => assert.deepEqual(gr.groupByDay([], "2026-10-17"), []));
