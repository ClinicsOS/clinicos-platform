/* CLINICOS CONNECT (C2) — frontend unit tests: the pure logic behind the Messages screen.
   No browser, no network, no new dependency. Imports the TypeScript source directly (Node >= 22.18, or 22.6+ with --experimental-strip-types):
       node --test tests/connect-c2.test.mjs
   Run under other process time zones — clinic-time formatting must not change:  TZ=America/New_York node --test tests/connect-c2.test.mjs
   (The browser/E2E checks live in tests/connect/e2e/ and need the seeded backend — see docs/connect-c2.md.) */
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// TypeScript sources import each other without extensions (the bundler resolves them): teach Node's resolver the same.
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, n){ try { return await n(s, c); } catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[a-z]+$/.test(s)) return n(s + ".ts", c); throw e; } }`,
    ),
);
const S = "../src/lib/connect/";
const store = await import(S + "messageStore.ts");
const text = await import(S + "text.ts");
const time = await import(S + "time.ts");
const errors = await import(S + "errors.ts");
const layout = await import(S + "team3d/layout.ts");

const cur = (seq) => Buffer.from(`v1:${seq}`, "utf8").toString("base64url");
const msg = (seq, extra = {}) => ({ id: `m${seq}`, conversationId: "c1", senderId: "u2", sender: { id: "u2", name: "B", role: "doctor", isActive: true }, text: `t${seq}`, createdAt: new Date(Date.UTC(2026, 9, 10, 9, 0, seq)).toISOString(), cursor: cur(seq), ...extra });
const page = (seqs, info = {}) => ({ messages: seqs.map((s) => msg(s)), pageInfo: { hasMoreOlder: false, hasMoreNewer: false, olderCursor: seqs.length ? cur(seqs[0]) : null, newerCursor: seqs.length ? cur(seqs[seqs.length - 1]) : null, ...info } });

/* ------------------------------------------------------------------ message store */
test("seqOf reads the sequence inside an opaque cursor and survives garbage", () => {
  assert.equal(store.seqOf(cur(42)), 42);
  assert.equal(store.seqOf(cur(1)), 1);
  assert.equal(store.seqOf(null), 0);
  assert.equal(store.seqOf("!!!"), 0);
  assert.equal(store.seqOf(Buffer.from("v2:9").toString("base64url")), 0);
});

test("mergeMessages: unique by id, ordered by sequence, existing entries win", () => {
  const a = [msg(3), msg(1)];
  const merged = store.mergeMessages(a, [msg(2), msg(3, { text: "CHANGED" }), msg(4)]);
  assert.deepEqual(merged.map((m) => m.id), ["m1", "m2", "m3", "m4"]);
  assert.equal(merged.find((m) => m.id === "m3").text, "t3");
  assert.equal(store.mergeMessages(a, []), a);
});

test("applyInitial / applyOlder / applyNewer keep both cursors correct and never duplicate", () => {
  let th = store.applyInitial(undefined, page([8, 9, 10], { hasMoreOlder: true }));
  assert.equal(th.hasMoreOlder, true);
  assert.equal(th.olderCursor, cur(8));
  assert.equal(th.newerCursor, cur(10));
  th = store.applyOlder(th, page([5, 6, 7], { hasMoreOlder: true }));
  assert.deepEqual(th.messages.map((m) => store.seqOf(m.cursor)), [5, 6, 7, 8, 9, 10]);
  assert.equal(th.olderCursor, cur(5));
  assert.equal(th.newerCursor, cur(10));
  th = store.applyOlder(th, page([1, 2, 3, 4], { hasMoreOlder: false })); // reaches the beginning
  assert.equal(th.hasMoreOlder, false);
  assert.equal(th.messages.length, 10);
  th = store.applyNewer(th, page([10, 11, 12]));  // overlapping poll result
  assert.deepEqual(th.messages.map((m) => store.seqOf(m.cursor)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.equal(th.newerCursor, cur(12));
  const same = store.applyNewer(th, page([]));
  assert.equal(same, th, "an empty poll changes nothing (no re-render)");
  const back = store.applyNewer(th, { messages: [msg(3)], pageInfo: { hasMoreOlder: true, hasMoreNewer: false, olderCursor: cur(3), newerCursor: cur(3) } });
  assert.equal(back.newerCursor, cur(12), "the newer cursor never moves backwards");
});

test("applyInitial keeps the messages typed locally (pending) when a conversation is reloaded", () => {
  const p = { clientId: "x", conversationId: "c1", text: "draft", createdAt: new Date().toISOString(), status: "failed" };
  const th = store.applyInitial({ ...store.EMPTY_THREAD, pending: [p] }, page([1, 2]));
  assert.deepEqual(th.pending, [p]);
});

test("a sent message replaces its pending twin exactly once", () => {
  const p = { clientId: "k1", conversationId: "c1", text: "hello", createdAt: "2026-10-10T09:00:00.000Z", status: "sending" };
  let th = store.addPending(store.applyInitial(undefined, page([1, 2])), p);
  assert.equal(th.pending.length, 1);
  const confirmed = msg(3, { senderId: "me", text: "hello" });
  th = store.applySent(th, "k1", confirmed);
  assert.equal(th.pending.length, 0);
  assert.equal(th.messages.length, 3);
  assert.equal(th.newerCursor, cur(3));
  // the same message arriving again through polling must not duplicate it
  th = store.applyNewer(th, { messages: [confirmed], pageInfo: { hasMoreOlder: true, hasMoreNewer: false, olderCursor: cur(3), newerCursor: cur(3) } });
  assert.equal(th.messages.length, 3);
});

test("failed sends: patch, remove, and the 'did it actually arrive?' twin check", () => {
  const p = { clientId: "k2", conversationId: "c1", text: "lost?", createdAt: "2026-10-10T09:00:00.000Z", status: "sending" };
  let th = store.addPending(store.EMPTY_THREAD, p);
  th = store.patchPending(th, "k2", { status: "failed", uncertain: true });
  assert.equal(th.pending[0].status, "failed");
  assert.equal(th.pending[0].uncertain, true);
  const arrived = [msg(7, { senderId: "me", text: "lost?", createdAt: "2026-10-10T09:00:03.000Z" }), msg(8, { senderId: "other", text: "lost?" })];
  assert.equal(store.findDeliveredTwin(th.pending[0], arrived, "me")?.id, "m7");
  assert.equal(store.findDeliveredTwin(th.pending[0], [msg(9, { senderId: "other", text: "lost?" })], "me"), undefined, "someone else's identical text is not mine");
  assert.equal(store.findDeliveredTwin(th.pending[0], [msg(9, { senderId: "me", text: "lost?", createdAt: "2026-10-10T07:00:00.000Z" })], "me"), undefined, "an old identical message is not this attempt");
  th = store.removePending(th, "k2");
  assert.equal(th.pending.length, 0);
});

test("latest helpers", () => {
  const th = store.applyInitial(undefined, page([1, 2, 3]));
  assert.equal(store.latestMessage(th).id, "m3");
  assert.equal(store.latestFromOthers(th, "u2"), undefined);
  assert.equal(store.latestFromOthers(th, "me").id, "m3");
});

/* ------------------------------------------------------------------ text rules */
test("checkDraft: empty / invisible-only drafts are rejected, real text is kept (Arabic, English, mixed)", () => {
  for (const bad of ["", "   ", "\n\n", "​‏‎", "­﻿"]) assert.deepEqual(text.checkDraft(bad), { ok: false, reason: "empty" }, JSON.stringify(bad));
  assert.deepEqual(text.checkDraft("  hello  "), { ok: true, text: "hello" });
  assert.deepEqual(text.checkDraft("مرحباً بكم"), { ok: true, text: "مرحباً بكم" });
  assert.equal(text.checkDraft("Hello مرحبا 123").text, "Hello مرحبا 123");
  assert.equal(text.checkDraft("a\r\nb c").text, "a\nb\nc");
  assert.equal(text.checkDraft("a‮b").text, "ab", "bidi override characters are dropped");
  assert.equal(text.checkDraft("keep‍zwj").text, "keep‍zwj", "ZWJ is kept");
});

test("checkDraft: the limit counts Unicode code points, not UTF-16 units", () => {
  assert.equal(text.checkDraft("x".repeat(4000)).ok, true);
  assert.deepEqual(text.checkDraft("x".repeat(4001)), { ok: false, reason: "tooLong" });
  assert.equal(text.checkDraft("😀".repeat(4000)).ok, true, "4000 emoji = 4000 characters");
  assert.deepEqual(text.checkDraft("😀".repeat(4001)), { ok: false, reason: "tooLong" });
  assert.deepEqual(text.checkDraft("ع".repeat(9000)), { ok: false, reason: "tooLong" });
  assert.equal(text.codePointLength("a😀ع"), 3);
});

test("the client text rules agree with the server's (C1 dist), over a corpus", { skip: !fs.existsSync(srvText()) }, async () => {
  const srv = (await import("node:module")).createRequire(import.meta.url)(srvText());
  const corpus = ["hi", "  padded  ", "", "   ", "a\r\nb", "x y", "\u0000nul\u0007", "RTL‮over", "مرحبا", "😀", "​", "tab\there", "؜", "line1\n\n\nline2", "é"];
  for (const c of corpus) {
    let server;
    try { server = { ok: true, text: srv.validateMessageText(c) }; } catch (e) { server = { ok: false, code: e.code }; }
    const client = text.checkDraft(c);
    assert.equal(client.ok, server.ok, `ok parity for ${JSON.stringify(c)}`);
    if (server.ok) assert.equal(client.text, server.text, `text parity for ${JSON.stringify(c)}`);
  }
});
function srvText() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../backEnd/dist/services/connect/text.js");
}

/* ------------------------------------------------------------------ time (clinic wall clock) */
test("fmtClock uses the clinic zone and Latin digits in Arabic", () => {
  const iso = "2026-10-10T11:30:00.000Z"; // 14:30 in Amman (UTC+3)
  assert.match(time.fmtClock(iso, "en"), /^2:30\s?PM$/);
  const ar = time.fmtClock(iso, "ar");
  assert.match(ar, /^2:30/);
  assert.doesNotMatch(ar, /[٠-٩]/);
});

test("dayKind / fmtListTime around clinic midnight (not the browser's)", () => {
  const now = new Date("2026-10-10T21:30:00.000Z"); // 00:30 on Oct 11 in Amman
  assert.equal(time.dayKind("2026-10-10T21:10:00.000Z", now), "today");
  assert.equal(time.dayKind("2026-10-10T20:59:00.000Z", now), "yesterday"); // 23:59 Oct 10 Amman
  assert.equal(time.dayKind("2026-10-01T10:00:00.000Z", now), "date");
  assert.equal(time.fmtListTime("2026-10-10T20:59:00.000Z", "en", { yesterday: "Yesterday" }, now), "Yesterday");
  assert.match(time.fmtListTime("2026-10-10T21:10:00.000Z", "en", { yesterday: "Y" }, now), /12:10\s?AM/);
  assert.equal(time.dayKey("2026-10-10T21:10:00.000Z"), "2026-10-11");
});

/* ------------------------------------------------------------------ errors */
test("classifyError maps server answers to the few states the UI handles", () => {
  const ax = (status, code) => ({ isAxiosError: true, response: { status, data: { code } } });
  assert.equal(errors.classifyError(ax(402, "PLAN_LIMIT")).kind, "plan");
  assert.equal(errors.classifyError(ax(402, "SUSPENDED")).kind, "suspended");
  assert.equal(errors.classifyError(ax(402, "EXPIRED")).kind, "suspended");
  assert.equal(errors.classifyError(ax(404)).kind, "gone");
  assert.equal(errors.classifyError(ax(403)).kind, "forbidden");
  assert.equal(errors.classifyError(ax(409, "PARTICIPANT_INACTIVE")).kind, "inactive");
  assert.equal(errors.classifyError(ax(429, "RATE_LIMITED")).kind, "rate");
  assert.equal(errors.classifyError(ax(400, "EMPTY_MESSAGE")).kind, "validation");
  assert.equal(errors.classifyError(ax(500)).kind, "server");
  assert.equal(errors.classifyError({ isAxiosError: true }).kind, "network");
  assert.equal(errors.classifyError(new Error("boom")).kind, "network");
  assert.equal(errors.isUncertain({ isAxiosError: true }), true);
  assert.equal(errors.isUncertain(ax(404)), false);
});

/* ------------------------------------------------------------------ Team Space layout */
test("orderPeople: you first, roles ordered, capped, the chat partner is always drawn", () => {
  const me = { id: "me", name: "Me", role: "doctor" };
  const mk = (i, role) => ({ id: `u${i}`, name: `P${String(i).padStart(2, "0")}`, role });
  const others = [mk(1, "receptionist"), mk(2, "doctor"), mk(3, "owner"), ...Array.from({ length: 14 }, (_, i) => mk(10 + i, "receptionist"))];
  const { shown, hidden } = layout.orderPeople(me, others, null);
  assert.equal(shown[0].id, "me");
  assert.equal(shown.length, layout.MAX_NODES);
  assert.equal(hidden, others.length - (layout.MAX_NODES - 1));
  assert.deepEqual(shown.slice(1, 3).map((p) => p.role), ["owner", "doctor"]);
  const last = others[others.length - 1];
  const withPeer = layout.orderPeople(me, others, last.id);
  assert.ok(withPeer.shown.some((p) => p.id === last.id), "the DM partner is brought into the scene");
  assert.equal(withPeer.shown.length, layout.MAX_NODES);
  assert.equal(layout.orderPeople(me, [], null).shown.length, 1);
  assert.equal(layout.orderPeople(me, [me, mk(1, "owner")], null).shown.length, 2, "you are never listed twice");
});

test("frame + positions: finite, distinct, inside the stage", () => {
  for (const [w, h] of [[340, 420], [320, 560], [700, 132], [900, 140]]) {
    const f = layout.frameFor(w, h);
    for (const n of [1, 2, 5, 12]) {
      const pos = layout.worldPositions(n, f);
      assert.equal(pos.length, n);
      assert.ok(pos.every((p) => p.every(Number.isFinite)));
      if (n > 1) assert.equal(new Set(pos.map((p) => p.map((v) => v.toFixed(3)).join())).size, n, "no two nodes share a position");
      const fb = layout.fallbackPositions(n, f.kind);
      assert.ok(fb.nodes.every(([x, y]) => x >= 0 && x <= 100 && y >= 0 && y <= 100));
    }
  }
  assert.equal(layout.frameFor(340, 420).kind, "panel");
  assert.equal(layout.frameFor(700, 132).kind, "band");
});
