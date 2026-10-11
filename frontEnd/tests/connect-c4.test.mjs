/* CLINICOS CONNECT (C4) — frontend unit tests: structured (card) messages. Pure logic only: no browser, no network.
       node --test tests/connect-c4.test.mjs
   (Rendering, pickers, RTL, mobile and the real routes are covered by tests/connect/e2e/connect-c4.e2e.mjs;
    authorisation is covered by backEnd/tests/connect/connect-c4.test.js.) */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, n){ try { return await n(s, c); } catch (e) { if (/^\\.\\.?\\//.test(s) && !/\\.[a-z]+$/.test(s)) return n(s + ".ts", c); throw e; } }`,
    ),
);
const S = "../src/lib/connect/";
const cards = await import(S + "cards.ts");
const store = await import(S + "messageStore.ts");
const ev = await import(S + "realtime/events.ts");
const { connectKeys } = await import(S + "keys.ts");

const cur = (seq) => Buffer.from(`v1:${seq}`, "utf8").toString("base64url");
const person = (id, role = "doctor") => ({ id, name: id, role, isActive: true });
const msg = (seq, extra = {}) => ({ id: `m${seq}`, conversationId: "c1", senderId: "u2", sender: person("u2"), text: "", contentType: "text", createdAt: new Date(Date.UTC(2026, 9, 10, 9, 0, seq)).toISOString(), cursor: cur(seq), ...extra });
const thread = (...ms) => ({ messages: ms, hasMoreOlder: false, olderCursor: null, newerCursor: ms.length ? ms[ms.length - 1].cursor : null, pending: [] });
const evt = (m, extra = {}) => ({ v: 1, conversation: { id: "c1", type: "direct" }, message: { id: m.id, conversationId: "c1", senderId: m.senderId, sender: { id: "u2", name: "u2", role: "doctor" }, text: m.text, contentType: m.contentType, createdAt: m.createdAt, cursor: m.cursor }, preview: m.text, lastMessageAt: m.createdAt, unreadCount: 1, ...extra });

/* ---------- which messages need a card ---------- */
test("refMessageIds picks reference messages only (text, legacy and unknown types are not cards)", () => {
  const ms = [msg(1, { contentType: "text" }), msg(2, { contentType: "patient_reference" }), msg(3, { contentType: undefined }), msg(4, { contentType: "appointment_reference" }), msg(5, { contentType: "image" })];
  assert.deepEqual(cards.refMessageIds(ms), ["m2", "m4"]);
});
test("chunk splits into server-sized batches (never one request per card)", () => {
  const ids = Array.from({ length: 250 }, (_, i) => `m${i}`);
  const parts = cards.chunk(ids, cards.CARDS_BATCH);
  assert.equal(cards.CARDS_BATCH, 100);
  assert.deepEqual(parts.map((p) => p.length), [100, 100, 50]);
  assert.deepEqual(cards.chunk([], 100), []);
});

/* ---------- parsing the server's answer (untrusted) ---------- */
const okPatient = { messageId: "m2", contentType: "patient_reference", state: "ok", patient: { id: "p1", fullName: "محمد الخطيب", fileNumber: 7 } };
const okAppt = { messageId: "m4", contentType: "appointment_reference", state: "ok", appointment: { id: "a1", startAt: "2026-10-11T07:00:00.000Z", day: "2026-10-11", duration: 30, status: "scheduled", patientName: "Mona", doctorName: "Dr. Sarah" } };
test("well-formed cards are accepted, including Arabic names", () => {
  const out = cards.parseCards({ cards: [okPatient, okAppt, { messageId: "m9", contentType: "patient_reference", state: "restricted" }, { messageId: "m8", contentType: "appointment_reference", state: "unavailable" }] });
  assert.equal(out.length, 4);
  assert.equal(out[0].patient.fullName, "محمد الخطيب");
});
test("malformed answers are dropped, never rendered", () => {
  for (const bad of [null, undefined, "x", 5, {}, { cards: "x" }, { cards: [null, 1, "x", {}] }]) assert.deepEqual(cards.parseCards(bad), []);
  assert.deepEqual(cards.parseCards({ cards: [{ messageId: "m1", contentType: "text", state: "ok" }] }), []); // not a reference type
  assert.deepEqual(cards.parseCards({ cards: [{ messageId: "m1", contentType: "patient_reference", state: "ok" }] }), []); // ok without data
  assert.deepEqual(cards.parseCards({ cards: [{ messageId: "m1", contentType: "patient_reference", state: "ok", patient: { fullName: 5 } }] }), []);
  assert.deepEqual(cards.parseCards({ cards: [{ messageId: "m1", contentType: "patient_reference", state: "weird" }] }), []);
  assert.deepEqual(cards.parseCards({ cards: [{ contentType: "patient_reference", state: "restricted" }] }), []); // no message id
});

/* ---------- the cache ---------- */
test("mergeCards: answered cards are stored; asked-but-unanswered ones become 'unavailable' (never stuck loading)", () => {
  const asked = [msg(2, { contentType: "patient_reference" }), msg(4, { contentType: "appointment_reference" }), msg(6, { contentType: "patient_reference" })];
  const merged = cards.mergeCards({}, asked, [okPatient]);
  assert.equal(merged.m2.state, "ok");
  assert.equal(merged.m4.state, "unavailable");
  assert.equal(merged.m6.state, "unavailable");
  assert.equal(merged.m4.contentType, "appointment_reference");
});
test("mergeCards: a fresh answer REPLACES a cached card (permission removed → restricted on the next load)", () => {
  const first = cards.mergeCards({}, [msg(2, { contentType: "patient_reference" })], [okPatient]);
  const later = cards.mergeCards(first, [msg(2, { contentType: "patient_reference" })], [{ messageId: "m2", contentType: "patient_reference", state: "restricted" }]);
  assert.equal(later.m2.state, "restricted");
  assert.ok(!("patient" in later.m2), "a restricted card holds no data at all");
});
test("mergeCards does not mutate its input", () => {
  const prev = Object.freeze({});
  assert.doesNotThrow(() => cards.mergeCards(prev, [msg(2, { contentType: "patient_reference" })], [okPatient]));
});

/* ---------- navigation targets are the normal ClinicOS pages ---------- */
test("card navigation uses the real routes", () => {
  assert.equal(cards.PATIENT_FILE_HREF, "/patients/profile");
  assert.equal(cards.appointmentHref({ id: "a1", day: "2026-10-11" }), "/appointments?appt=a1&date=2026-10-11");
  assert.equal(cards.appointmentHref({ id: "a/1&x", day: "2026-10-11" }), "/appointments?appt=a%2F1%26x&date=2026-10-11", "ids are URL-encoded");
});
test("conversation-list preview of a card is a generic label, never the record", () => {
  assert.equal(cards.previewLabelKey("appointment_reference"), "share.prevAppt");
  assert.equal(cards.previewLabelKey("patient_reference"), "share.prevPatient");
  assert.equal(cards.previewLabelKey("text"), null);
  assert.equal(cards.previewLabelKey(undefined), null);
});

/* ---------- realtime ---------- */
test("a card message event is accepted; an unknown contentType is dropped", () => {
  const m = msg(3, { contentType: "patient_reference" });
  assert.ok(ev.parseMessageEvent(evt(m)));
  assert.equal(ev.parseMessageEvent(evt(msg(3, { contentType: "image" }))), null);
  const legacy = evt(msg(3));
  delete legacy.message.contentType;
  assert.ok(ev.parseMessageEvent(legacy), "an event without contentType (older server) is a text message");
  assert.equal(ev.messageFromEvent(legacy).contentType, "text");
});
test("messageFromEvent keeps the content type and nothing else about a record", () => {
  const dto = ev.messageFromEvent(evt(msg(3, { contentType: "appointment_reference" })));
  assert.equal(dto.contentType, "appointment_reference");
  assert.deepEqual(Object.keys(dto).sort(), ["contentType", "conversationId", "createdAt", "cursor", "id", "sender", "senderId", "text"]);
});
test("the conversation list remembers the last message's type but holds no card data", () => {
  const conv = { id: "c1", type: "direct", createdAt: "2026-10-01T00:00:00.000Z", lastMessageAt: "2026-10-10T08:00:00.000Z", lastMessage: { id: "old", senderId: "u2", isMine: false, preview: "old", createdAt: "2026-10-10T08:00:00.000Z" }, unreadCount: 0, peer: person("u2"), peerLastReadCursor: null };
  const e = ev.parseMessageEvent(evt(msg(3, { contentType: "patient_reference" })));
  const r = ev.listWithMessage(ev.withTotals([conv]), e, "me");
  assert.equal(r.list.conversations[0].lastMessage.contentType, "patient_reference");
  assert.equal(r.list.conversations[0].lastMessage.preview, "");
  assert.equal(r.list.conversations[0].unreadCount, 1);
});
test("HTTP + socket + reconnect never duplicate a card message (merge by canonical id)", () => {
  const m = msg(3, { contentType: "appointment_reference" });
  const t0 = thread(msg(1), msg(2));
  const a = store.applyRealtimeMessage(t0, m, { myId: "me", sending: false }).thread;
  assert.equal(a.messages.length, 3);
  const b = store.applyRealtimeMessage(a, m, { myId: "me", sending: false }).thread; // the same event again (reconnect replay)
  assert.equal(b, a);
  const viaHttp = store.applyNewer(a, { messages: [m], pageInfo: { hasMoreOlder: false, hasMoreNewer: false, olderCursor: null, newerCursor: m.cursor } });
  assert.equal(viaHttp.messages.filter((x) => x.id === "m3").length, 1);
  assert.equal(store.mergeMessages(a.messages, [m, m]).length, 3);
});
test("my own card: the HTTP answer wins over the socket event while the send is in flight (no second card)", () => {
  const mine = msg(3, { senderId: "me", contentType: "patient_reference" });
  const pending = { clientId: "c-1", conversationId: "c1", text: "", reference: { type: "patient", id: "p1" }, createdAt: mine.createdAt, status: "sending" };
  const t0 = { ...thread(msg(1), msg(2)), pending: [pending] };
  assert.equal(store.applyRealtimeMessage(t0, mine, { myId: "me", sending: true }).thread, t0, "ignored while sending");
  const sent = store.applySent(t0, "c-1", mine);
  assert.equal(sent.pending.length, 0);
  assert.equal(sent.messages.filter((m) => m.id === "m3").length, 1);
});
test("an uncertain failed card is recognised as delivered by its TYPE, not mistaken for a text with the same note", () => {
  const p = { clientId: "c-1", conversationId: "c1", text: "", reference: { type: "patient", id: "p1" }, createdAt: "2026-10-10T09:00:05.000Z", status: "failed", uncertain: true };
  const stored = msg(3, { senderId: "me", contentType: "patient_reference", createdAt: "2026-10-10T09:00:06.000Z" });
  const textOnly = msg(4, { senderId: "me", contentType: "text", text: "", createdAt: "2026-10-10T09:00:06.000Z" });
  assert.equal(store.findDeliveredTwin(p, [stored], "me")?.id, "m3");
  assert.equal(store.findDeliveredTwin(p, [textOnly], "me"), undefined);
  const wrongKind = msg(5, { senderId: "me", contentType: "appointment_reference", createdAt: "2026-10-10T09:00:06.000Z" });
  assert.equal(store.findDeliveredTwin(p, [wrongKind], "me"), undefined);
  // old behaviour is unchanged for plain text
  const tp = { clientId: "c-2", conversationId: "c1", text: "hello", createdAt: "2026-10-10T09:00:05.000Z", status: "failed", uncertain: true };
  assert.ok(store.findDeliveredTwin(tp, [msg(6, { senderId: "me", text: "hello", createdAt: "2026-10-10T09:00:06.000Z" })], "me"));
});
test("old messages without contentType still merge and order correctly (backward compatible)", () => {
  const old = { id: "m1", conversationId: "c1", senderId: "u2", sender: null, text: "legacy", createdAt: "2026-10-10T09:00:01.000Z", cursor: cur(1) };
  const merged = store.mergeMessages([old], [msg(2, { contentType: "patient_reference" })]);
  assert.deepEqual(merged.map((m) => m.id), ["m1", "m2"]);
});

/* ---------- cache safety ---------- */
test("card and picker cache keys are scoped by user AND role", () => {
  const a = connectKeys.cards("u1", "doctor", "c1");
  assert.notDeepEqual(a, connectKeys.cards("u2", "doctor", "c1"));
  assert.notDeepEqual(a, connectKeys.cards("u1", "owner", "c1"));
  for (const k of [a, connectKeys.pickPatients("u1", "doctor", "x"), connectKeys.pickAppts("u1", "doctor", "today", "x")]) {
    assert.equal(k[0], "connect", "under the ['connect'] prefix that is purged on logout / account change");
    assert.equal(k[1], "u1");
    assert.ok(k.includes("doctor"));
  }
});
test("logout / account change purges the Connect cache (static check of lib/providers.tsx)", () => {
  const src = fs.readFileSync(new URL("../src/lib/providers.tsx", import.meta.url), "utf8");
  assert.match(src, /removeQueries\(\{\s*queryKey:\s*\["connect"\]\s*\}\)/);
  assert.match(src, /useAuth\.subscribe/);
  assert.match(src, /selected:\s*null/);
});

/* ---------- i18n: every new string exists in English AND Arabic ---------- */
const dict = fs.readFileSync(new URL("../src/lib/i18n.tsx", import.meta.url), "utf8");
const keysUsed = [...fs.readFileSync(new URL("../src/components/connect/SharePicker.tsx", import.meta.url), "utf8").matchAll(/t\("(share\.[A-Za-z]+)"\)/g)].map((m) => m[1]);
const keysCard = [...fs.readFileSync(new URL("../src/components/connect/ReferenceCard.tsx", import.meta.url), "utf8").matchAll(/t\("(share\.[A-Za-z]+)"\)/g)].map((m) => m[1]);
const keysComposer = [...fs.readFileSync(new URL("../src/components/connect/Composer.tsx", import.meta.url), "utf8").matchAll(/t\("(share\.[A-Za-z]+)"\)/g)].map((m) => m[1]);
const required = ["share.btn", "share.appointment", "share.patient", "share.searchAppts", "share.searchPatients", "share.viewAppt", "share.openPatient", "share.noAppts", "share.noPatients", "share.restricted", "share.unavailable", "share.today", "share.upcoming", "share.recent", "share.prevAppt", "share.prevPatient"];
test("the strings the brief lists exist in EN and AR, with the exact wording", () => {
  const en = (k) => new RegExp(`^  "${k.replace(".", "\\.")}": "(.*)",$`, "m").exec(dict.slice(0, dict.indexOf("// ====== ARABIC") > 0 ? dict.indexOf("// ====== ARABIC") : undefined));
  const all = (k) => [...dict.matchAll(new RegExp(`^  "${k.replace(".", "\\.")}": "(.*)",$`, "gm"))].map((m) => m[1]);
  for (const k of new Set([...required, ...keysUsed, ...keysCard, ...keysComposer])) {
    const found = all(k);
    assert.equal(found.length, 2, `${k} must exist exactly once in EN and once in AR`);
    assert.notEqual(found[0], found[1], `${k}: the Arabic text must differ from the English`);
    assert.ok(/[؀-ۿ]/.test(found[1]), `${k}: the Arabic entry is Arabic`);
  }
  void en;
  const [e1] = [all("share.restricted")[0], all("share.unavailable")[0]];
  assert.equal(e1, "You don't have permission to view this item");
  assert.equal(all("share.unavailable")[0], "This item is no longer available");
  assert.equal(all("share.viewAppt")[0], "View Appointment");
  assert.equal(all("share.openPatient")[0], "Open Patient File");
  assert.equal(all("share.noAppts")[0], "No appointments found");
  assert.equal(all("share.noPatients")[0], "No patients found");
  assert.equal(all("share.searchAppts")[0], "Search appointments");
  assert.equal(all("share.searchPatients")[0], "Search patients");
  assert.equal(all("share.openPatient")[1], "فتح ملف المريض");
  assert.equal(all("share.appointment")[1], "موعد");
  assert.equal(all("share.patient")[1], "مريض");
});

/* ---------- RTL: the C4 stylesheet uses logical properties only ---------- */
test("C4 styles use logical (direction-safe) properties", () => {
  const css = fs.readFileSync(new URL("../src/components/connect/connect.module.css", import.meta.url), "utf8");
  const c4 = css.slice(css.indexOf("C4 — structured cards"));
  assert.ok(c4.length > 500);
  assert.doesNotMatch(c4, /(^|[\s;{])(left|right)\s*:/m, "no physical left/right");
  assert.doesNotMatch(c4, /(margin|padding|border)-(left|right)\b/);
  assert.doesNotMatch(c4, /text-align\s*:\s*(left|right)/);
});

/* ---------- the card never renders data it was not given / no attachments ---------- */
test("the composer offers Share (Appointment / Patient) and NO generic attachment controls", () => {
  const src = fs.readFileSync(new URL("../src/components/connect/Composer.tsx", import.meta.url), "utf8");
  assert.match(src, /share-appointment/);
  assert.match(src, /share-patient/);
  assert.doesNotMatch(src, /type="file"|capture=|getUserMedia|IconPaperclip|IconCamera|IconMicrophone|IconPhoto/);
});
test("the card component renders restricted / unavailable states without reading any record field", () => {
  const src = fs.readFileSync(new URL("../src/components/connect/ReferenceCard.tsx", import.meta.url), "utf8");
  const restricted = src.slice(src.indexOf('card.state === "restricted"'), src.indexOf('if ("patient" in card)'));
  assert.doesNotMatch(restricted, /\.patient|\.appointment|fullName|patientName|doctorName/);
});
