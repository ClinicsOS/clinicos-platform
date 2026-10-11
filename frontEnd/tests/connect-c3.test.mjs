/* CLINICOS CONNECT (C3) — frontend unit tests: the pure logic that turns realtime events into cache updates. No browser, no socket, no network.
       node --test tests/connect-c3.test.mjs
   (Socket / HTTP / real-browser behaviour is covered by backEnd/tests/connect/connect-c3.test.js and tests/connect/e2e/connect-c3.e2e.mjs.) */
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, n){ try { return await n(s, c); } catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[a-z]+$/.test(s)) return n(s + ".ts", c); throw e; } }`,
    ),
);
const S = "../src/lib/connect/";
const store = await import(S + "messageStore.ts");
const ev = await import(S + "realtime/events.ts");
const inflight = await import(S + "realtime/inflight.ts");
const rtcfg = await import(S + "realtime/config.ts");
const { useRt } = await import(S + "realtime/store.ts");

const cur = (seq) => Buffer.from(`v1:${seq}`, "utf8").toString("base64url");
const person = (id, name = id, role = "doctor") => ({ id, name, role, isActive: true });
const msg = (seq, extra = {}) => ({ id: `m${seq}`, conversationId: "c1", senderId: "u2", sender: person("u2"), text: `t${seq}`, createdAt: new Date(Date.UTC(2026, 9, 10, 9, 0, seq)).toISOString(), cursor: cur(seq), ...extra });
const thread = (seqs, extra = {}) => ({ messages: seqs.map((s) => msg(s)), hasMoreOlder: false, olderCursor: seqs.length ? cur(seqs[0]) : null, newerCursor: seqs.length ? cur(seqs[seqs.length - 1]) : null, pending: [], ...extra });
const event = (seq, extra = {}) => {
  const m = msg(seq);
  return { v: 1, conversation: { id: "c1", type: "direct" }, message: { id: m.id, conversationId: "c1", senderId: m.senderId, sender: { id: "u2", name: "u2", role: "doctor" }, text: m.text, createdAt: m.createdAt, cursor: m.cursor }, preview: m.text, lastMessageAt: m.createdAt, unreadCount: 1, ...extra };
};
const conv = (id, extra = {}) => ({ id, type: "direct", createdAt: "2026-10-01T00:00:00.000Z", lastMessageAt: "2026-10-10T08:00:00.000Z", lastMessage: { id: `${id}-old`, senderId: "u2", isMine: false, preview: "old", createdAt: "2026-10-10T08:00:00.000Z" }, unreadCount: 0, peer: person("u2"), peerLastReadCursor: null, ...extra });
const list = (...cs) => ev.withTotals(cs);

/* ---------- event validation (untrusted input) ---------- */
test("a well-formed message event is accepted", () => assert.ok(ev.parseMessageEvent(event(3))));
test("unknown version / missing parts / mismatched ids are dropped", () => {
  assert.equal(ev.parseMessageEvent({ ...event(3), v: 2 }), null);
  assert.equal(ev.parseMessageEvent(null), null);
  assert.equal(ev.parseMessageEvent("x"), null);
  assert.equal(ev.parseMessageEvent({ ...event(3), message: undefined }), null);
  assert.equal(ev.parseMessageEvent({ ...event(3), conversation: { id: "other", type: "direct" } }), null);
  assert.equal(ev.parseMessageEvent({ ...event(3), conversation: { id: "c1", type: "weird" } }), null);
  const bad = event(3);
  bad.message.cursor = "not-a-cursor";
  assert.equal(ev.parseMessageEvent(bad), null);
  assert.equal(ev.parseMessageEvent({ ...event(3), unreadCount: -1 }), null);
  assert.equal(ev.parseMessageEvent({ ...event(3), preview: 5 }), null);
});
test("read / typing events are validated", () => {
  assert.ok(ev.parseReadSelf({ v: 1, conversationId: "c1", unreadCount: 0, lastReadCursor: cur(2) }));
  assert.equal(ev.parseReadSelf({ v: 1, conversationId: "c1", unreadCount: -2 }), null);
  assert.ok(ev.parseReadPeer({ v: 1, conversationId: "c1", lastReadCursor: cur(2) }));
  assert.equal(ev.parseReadPeer({ v: 9, conversationId: "c1" }), null);
  assert.ok(ev.parseTyping({ v: 1, conversationId: "c1", userId: "u2", name: "B", role: "doctor", typing: true }));
  assert.equal(ev.parseTyping({ v: 1, conversationId: "c1", userId: "u2", name: "B", typing: "yes" }), null);
});
test("messageFromEvent produces the same DTO shape the HTTP API returns (C4: now including contentType, text for a C3-era event)", () => {
  const m = ev.messageFromEvent(event(4));
  assert.deepEqual(Object.keys(m).sort(), ["contentType", "conversationId", "createdAt", "cursor", "id", "sender", "senderId", "text"]);
  assert.equal(m.sender.isActive, true);
  assert.equal(ev.messageFromEvent(event(4, { message: { ...event(4).message, sender: null } })).sender, null);
});

/* ---------- thread merge: no duplicates, no skipped messages ---------- */
test("next message in sequence is appended and the cursor advances", () => {
  const r = store.applyRealtimeMessage(thread([1, 2]), msg(3), { myId: "me", sending: false });
  assert.equal(r.gap, false);
  assert.deepEqual(r.thread.messages.map((m) => m.id), ["m1", "m2", "m3"]);
  assert.equal(r.thread.newerCursor, cur(3));
});
test("the same event twice changes nothing (identity preserved)", () => {
  const t = thread([1, 2, 3]);
  const r = store.applyRealtimeMessage(t, msg(3), { myId: "me", sending: false });
  assert.equal(r.thread, t);
});
test("a gap is NOT inserted — a catch-up is requested instead", () => {
  const t = thread([1, 2]);
  const r = store.applyRealtimeMessage(t, msg(5), { myId: "me", sending: false });
  assert.equal(r.gap, true);
  assert.equal(r.thread, t);
});
test("my own echo is ignored while my HTTP send is in flight, merged by id otherwise (other tab)", () => {
  const mine = msg(3, { senderId: "me" });
  const t = thread([1, 2]);
  assert.equal(store.applyRealtimeMessage(t, mine, { myId: "me", sending: true }).thread, t);
  const other = store.applyRealtimeMessage(t, mine, { myId: "me", sending: false });
  assert.deepEqual(other.thread.messages.map((m) => m.id), ["m1", "m2", "m3"]);
});
test("echo after the HTTP answer already inserted the message is a no-op (no duplicate)", () => {
  const sent = store.applySent(thread([1, 2]), "c-1", msg(3, { senderId: "me" }));
  const r = store.applyRealtimeMessage(sent, msg(3, { senderId: "me" }), { myId: "me", sending: false });
  assert.equal(r.thread, sent);
  assert.equal(r.thread.messages.filter((m) => m.id === "m3").length, 1);
});
test("an older message is merged by id and leaves the cursor alone", () => {
  const t = thread([1, 3, 4]);
  const r = store.applyRealtimeMessage(t, msg(2), { myId: "me", sending: false });
  assert.deepEqual(r.thread.messages.map((m) => m.id), ["m1", "m2", "m3", "m4"]);
  assert.equal(r.thread.newerCursor, cur(4));
});
test("first message of an empty conversation (seq 1) is accepted", () => {
  const r = store.applyRealtimeMessage(thread([]), msg(1), { myId: "me", sending: false });
  assert.equal(r.gap, false);
  assert.equal(r.thread.messages.length, 1);
});
test("my message arriving from another tab resolves a failed-maybe-stored pending twin of this tab", () => {
  const pend = { clientId: "c-1", conversationId: "c1", text: "hello", createdAt: new Date(Date.UTC(2026, 9, 10, 9, 0, 3)).toISOString(), status: "failed", uncertain: true };
  const r = store.applyRealtimeMessage(thread([1, 2], { pending: [pend] }), msg(3, { senderId: "me", text: "hello" }), { myId: "me", sending: false });
  assert.equal(r.thread.pending.length, 0);
  assert.equal(r.thread.messages.length, 3);
});
test("applySent never skips a colleague's message that landed in between (cursor stays)", () => {
  const t = store.applySent(thread([1, 2]), "c-1", msg(4, { senderId: "me" }));
  assert.equal(t.newerCursor, cur(2));
  assert.deepEqual(t.messages.map((m) => m.id), ["m1", "m2", "m4"]);
});
test("applySent advances the cursor when the message is the next one", () => {
  assert.equal(store.applySent(thread([1, 2]), "c-1", msg(3, { senderId: "me" })).newerCursor, cur(3));
});
test("reconnect reconciliation: HTTP 'after' page plus replayed events converge to one copy of each", () => {
  let t = thread([1, 2]);
  t = store.applyNewer(t, { messages: [msg(3), msg(4)], pageInfo: { hasMoreOlder: false, hasMoreNewer: false, olderCursor: cur(3), newerCursor: cur(4) } });
  for (const s of [3, 4, 4, 3]) t = store.applyRealtimeMessage(t, msg(s), { myId: "me", sending: false }).thread;
  assert.deepEqual(t.messages.map((m) => m.id), ["m1", "m2", "m3", "m4"]);
});

/* ---------- conversation list ---------- */
test("a message updates preview, time, unread and moves the conversation to the top", () => {
  const a = conv("a", { lastMessageAt: "2026-10-10T09:00:00.000Z" });
  const b = conv("c1", { lastMessageAt: "2026-10-10T07:00:00.000Z" });
  const r = ev.listWithMessage(list(a, b), event(5, { unreadCount: 2 }), "me");
  assert.equal(r.unknown, false);
  assert.deepEqual(r.list.conversations.map((c) => c.id), ["c1", "a"]);
  const c1 = r.list.conversations[0];
  assert.equal(c1.unreadCount, 2);
  assert.equal(c1.lastMessage.preview, "t5");
  assert.equal(r.list.totalUnread, 2);
});
test("Clinic Team stays pinned first even when a DM is newer", () => {
  const team = conv("t", { type: "clinic_team", peer: null, lastMessageAt: "2026-10-01T00:00:00.000Z" });
  const r = ev.listWithMessage(list(team, conv("c1")), event(5), "me");
  assert.equal(r.list.conversations[0].id, "t");
});
test("an unknown conversation is reported, not invented", () => {
  const l = list(conv("a"));
  const r = ev.listWithMessage(l, event(1), "me");
  assert.equal(r.unknown, true);
  assert.equal(r.list, l);
});
test("the same message twice, or an older one, does not change the list", () => {
  const first = ev.listWithMessage(list(conv("c1")), event(5), "me").list;
  assert.equal(ev.listWithMessage(first, event(5), "me").list, first);
  assert.equal(ev.listWithMessage(first, event(2), "me").list, first);
});
test("my own message: isMine preview, no peer-read change", () => {
  const e = event(5, { unreadCount: 0 });
  e.message.senderId = "me";
  const r = ev.listWithMessage(list(conv("c1")), e, "me").list.conversations[0];
  assert.equal(r.lastMessage.isMine, true);
  assert.equal(r.peerLastReadCursor, null);
});
test("a message FROM the peer proves the peer has read up to it (Seen can advance)", () => {
  const r = ev.listWithMessage(list(conv("c1")), event(5), "me").list.conversations[0];
  assert.equal(r.peerLastReadCursor, cur(5));
});
test("read:self lowers the badge and the total (read in another tab)", () => {
  const l = list(conv("c1", { unreadCount: 3 }), conv("b", { unreadCount: 1 }));
  const n = ev.listWithReadSelf(l, { v: 1, conversationId: "c1", unreadCount: 0, lastReadCursor: cur(9) });
  assert.equal(n.totalUnread, 1);
  assert.equal(ev.listWithReadSelf(n, { v: 1, conversationId: "c1", unreadCount: 0, lastReadCursor: cur(9) }), n);
  assert.equal(ev.listWithReadSelf(l, { v: 1, conversationId: "zzz", unreadCount: 0, lastReadCursor: cur(9) }), l);
});
test("read:peer moves Seen forward only, and only for direct conversations", () => {
  const l = list(conv("c1", { peerLastReadCursor: cur(5) }));
  assert.equal(ev.listWithReadPeer(l, { v: 1, conversationId: "c1", lastReadCursor: cur(3) }), l);
  const n = ev.listWithReadPeer(l, { v: 1, conversationId: "c1", lastReadCursor: cur(8) });
  assert.equal(n.conversations[0].peerLastReadCursor, cur(8));
  const team = list(conv("t", { type: "clinic_team", peer: null }));
  assert.equal(ev.listWithReadPeer(team, { v: 1, conversationId: "t", lastReadCursor: cur(8) }), team);
});
test("badge data without a loaded list: set one conversation and re-total", () => {
  const prev = { total: 2, conversations: [{ conversationId: "a", unreadCount: 2 }] };
  const n = ev.unreadWithConversation(prev, "b", 3);
  assert.equal(n.total, 5);
  assert.equal(ev.unreadWithConversation(n, "b", 3), n);
  assert.equal(ev.unreadWithConversation(n, "b", 0).total, 2);
  assert.deepEqual(ev.unreadFromList([conv("a", { unreadCount: 2 }), conv("b")]), { total: 2, conversations: [{ conversationId: "a", unreadCount: 2 }] });
});

/* ---------- typing (ephemeral) ---------- */
const tp = (typing, userId = "u2") => ({ v: 1, conversationId: "c1", userId, name: "B", role: "doctor", typing });
test("typing appears, expires by itself and clears on stop; my own is ignored", () => {
  let m = ev.typingWith({}, tp(true), 1000, 6000, "me");
  assert.equal(m.c1.u2.until, 7000);
  assert.equal(ev.typingExpire(m, 6999), m);
  assert.deepEqual(ev.typingExpire(m, 7001), {});
  assert.deepEqual(ev.typingWith(m, tp(false), 2000, 6000, "me"), {});
  const same = {};
  assert.equal(ev.typingWith(same, tp(true, "me"), 1000, 6000, "me"), same);
  assert.equal(ev.typingWith(same, tp(false), 1000, 6000, "me"), same);
});

/* ---------- in-flight registry, store, config ---------- */
test("in-flight registry counts nested sends per conversation", () => {
  inflight.markSending("c9", 1);
  inflight.markSending("c9", 1);
  assert.equal(inflight.isSending("c9"), true);
  inflight.markSending("c9", -1);
  assert.equal(inflight.isSending("c9"), true);
  inflight.markSending("c9", -1);
  assert.equal(inflight.isSending("c9"), false);
  inflight.markSending("c9", -1);
  assert.equal(inflight.isSending("c9"), false);
});
test("realtime store: status clock, reconcile/catch-up counters, pulse nonce, reset", () => {
  const st = () => useRt.getState();
  st().reset();
  st().setStatus("connecting");
  st().setStatus("reconnecting");
  const since = st().since;
  assert.ok(since > 0);
  st().setStatus("reconnecting");
  assert.equal(st().since, since);
  st().setStatus("connected");
  assert.equal(st().since, 0);
  st().bumpReconcile();
  st().requestCatchUp("c1");
  st().requestCatchUp("c1");
  assert.equal(st().reconcileTick, 1);
  assert.equal(st().catchUp.c1, 2);
  st().firePulse("c1", "direct", "u2");
  st().firePulse("c1", "direct", "u2");
  assert.equal(st().pulse.nonce, 2);
  st().applyTyping(tp(true), "me", 6000);
  assert.ok(st().typing.c1);
  st().reset();
  assert.equal(st().status, "off");
  assert.deepEqual(st().typing, {});
  assert.equal(st().pulse, null);
});
test("realtime config: the socket targets the API host only; the live polling is slower than the C2 fallback", () => {
  assert.equal(rtcfg.socketUrl(), "http://localhost:5000");
  assert.deepEqual(rtcfg.socketTransports(), ["polling", "websocket"]);
  assert.ok(rtcfg.RT_POLL.threadMs > 5000 && rtcfg.RT_POLL.listMs > 20000 && rtcfg.RT_POLL.badgeMs > 30000);
  assert.ok(rtcfg.RT_CLIENT.typingTtlMs > rtcfg.RT_CLIENT.typingSendMs);
});
