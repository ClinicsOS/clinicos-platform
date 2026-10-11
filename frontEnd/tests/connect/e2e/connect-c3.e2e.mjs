/* CLINICOS CONNECT (C3) — browser end-to-end tests for REALTIME. Real production build + real C1/C3 backend (Socket.IO) + real database.
   Nothing is mocked: the browsers talk to the real socket. Where a test needs a sender it uses the real C1 HTTP API as that user
   (exactly what the UI does), so the receiving browser is observed receiving a push — not a reload.
   Numbers T11… follow the C3 brief. Run (see docs/connect-c3.md):
     node tests/connect/c2-world.js <dir>   (backend :5701 + world)      next start -p 3000
     WORLD=<dir>/c2-world.json node tests/connect/e2e/connect-c3.e2e.mjs      — the run MUTATES the world; restart c2-world.js for a clean run. */
import { launch, session, openMessages, world as W, harness } from "./lib.mjs";

const t = harness("connect-c3 e2e");
const { ok, eq } = t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const U = W.users;
const api = async (who, method, url, body) => {
  const r = await fetch(W.base + "/connect" + url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + U[who].token }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const say = async (who, convId, text) => { const r = await api(who, "POST", `/conversations/${convId}/messages`, { text }); if (r.status !== 201) ok(false, `API send by ${who} was accepted`, r.text); return r; };
const waitUntil = async (fn, timeout = 8000, step = 60) => { const end = Date.now() + timeout; for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() > end) return false; await sleep(step); } };
const bubbles = (page) => page.locator('[data-testid="bubble"]').allTextContents();
const count = async (page, text) => (await bubbles(page)).filter((b) => b.trim() === text).length;
const names = (page) => page.locator('[data-testid="conv-name"]').allTextContents();
const rowByName = (page, name) => page.locator('[data-testid^="conv-"]', { has: page.locator('[data-testid="conv-name"]', { hasText: name }) });
const openConv = async (s, name) => { await rowByName(s.page, name).first().click(); await s.page.waitForSelector('[data-testid="stream"]', { timeout: 15000 }); await s.page.waitForTimeout(500); };
const openTeam = async (s) => { await s.page.locator('[data-testid="conv-team"]').first().click(); await s.page.waitForSelector('[data-testid="stream"]', { timeout: 15000 }); await s.page.waitForTimeout(500); };
const diag = (page) => page.evaluate(() => globalThis.__clinicosConnect3D || { created: 0, disposed: 0, running: 0 });
const gets = (s, re) => s.log.connect.filter((c) => c.method === "GET" && re.test(c.url));
const posts = (s, re) => s.log.connect.filter((c) => c.method === "POST" && re.test(c.url));
const badge = async (page) => { const l = page.locator('[data-testid="nav-messages-badge"]'); return (await l.count()) ? Number((await l.first().innerText()).replace(/\D/g, "")) : 0; };
const apiUnread = async (who) => (await api(who, "GET", "/unread-count")).json.total;

/** Watch the socket of a session: frames in/out (the proof of what a browser was actually sent). */
const watch = (s) => {
  s.ws = { opened: 0, rx: [], tx: [] };
  s.page.on("websocket", (w) => { s.ws.opened++; w.on("framereceived", (f) => s.ws.rx.push(String(f.payload))); w.on("framesent", (f) => s.ws.tx.push(String(f.payload))); });
  return s;
};
const events = (s, name) => s.ws.rx.filter((p) => p.startsWith("42[") && p.includes(`"${name}"`)).map((p) => { try { return JSON.parse(p.slice(2))[1]; } catch { return null; } }).filter(Boolean);
/** WebGL is switched off by default (the 3D scene is CPU-heavy under software GL and none of these checks needs it); `gl: true` keeps it. */
const NO_GL = () => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) { return /webgl/i.test(String(type)) ? null : orig.call(this, type, ...a); };
};
const live = async (browser, who, o = {}) => {
  const s = watch(await session(browser, who, o));
  if (!o.gl) await s.ctx.addInitScript(NO_GL);
  allSessions.push(s);
  return s;
};
const allSessions = [];
const ready = async (s) => {
  await openMessages(s);
  await waitUntil(() => s.page.locator('[data-testid="conv-team"]').count().then((n) => n > 0), 25000);
  await waitUntil(() => s.ws.opened >= 1, 15000);
  await s.page.waitForTimeout(600);
};

const browser = await launch();
const crash = async (e) => { console.log("CRASH:", String(e?.stack || e).slice(0, 600)); try { await browser.close(); } catch {} process.exit(2); };
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);
const C = W.conversations;

/* ============ FALLBACK (run with the server's CONNECT_REALTIME=off and C3_REALTIME=off): Connect keeps working over plain HTTP, silently ============ */
if (process.env.C3_REALTIME === "off") {
  const R = await live(browser, "rec");
  await ready(R);
  await openConv(R, "Dr. Sarah Khalil");
  await R.page.waitForTimeout(9000);
  eq(R.ws.opened, 0, "FALLBACK no WebSocket can be opened (the server has realtime switched off)");
  eq(await R.page.locator('[data-testid="rt-status"]').count(), 0, "FALLBACK no 'Reconnecting…' chip: realtime is simply unavailable, the screen stays calm");
  await say("doc", C.dmDocRec, "arrives by polling");
  ok(await waitUntil(async () => (await count(R.page, "arrives by polling")) === 1, 9000), "FALLBACK a new message still arrives (C2 polling)");
  await R.page.locator('[data-testid="composer"]').fill("sent over http only");
  await R.page.locator('[data-testid="composer"]').press("Enter");
  ok(await waitUntil(async () => (await api("doc", "GET", `/conversations/${C.dmDocRec}/messages?limit=5`)).json.messages.some((m) => m.text === "sent over http only"), 5000), "FALLBACK sending works");
  eq(R.log.pageErrors.length, 0, "FALLBACK no uncaught errors");
  await R.ctx.close();
  await browser.close();
  process.exit(t.done());
}

/* ============ T1–T3 (+T4 in the browser): the socket is established for every PRO role, and not for a Basic clinic ============ */
for (const [n, who] of [[1, "owner"], [2, "doc"], [3, "rec"]]) {
  const s = await live(browser, who);
  await ready(s);
  ok(s.ws.opened >= 1, `T${n} ${who}: a WebSocket to the API is open`);
  ok((await s.page.locator('[data-testid="rt-status"]').count()) === 0, `T${n} ${who}: no connection chip while connected`);
  await s.ctx.close();
}
{
  const s = await live(browser, "ownerBasic");
  await openMessages(s);
  await s.page.waitForTimeout(2500);
  eq(s.ws.opened, 0, "T4 a Basic clinic opens NO socket at all");
  eq(s.log.connect.length, 0, "T4 …and makes no /api/connect request");
  await s.ctx.close();
}

/* ============ T18–T21, T30: list preview / order / unread / navigation badge update with NO reload, in two tabs ============ */
{
  const R = await live(browser, "rec");
  await ready(R);
  const before = await names(R.page);
  ok(before.length >= 3, "list loaded", before);
  // the conversation list is the page; a second tab of the same user sits on another page (only the nav badge there)
  const tab2 = await R.ctx.newPage();
  const tab2ws = { opened: 0 };
  tab2.on("websocket", () => tab2ws.opened++);
  await tab2.goto("http://localhost:3000/dashboard");
  await tab2.waitForSelector('[data-testid="nav-messages-badge"], a[href="/messages"]', { timeout: 20000 });
  await waitUntil(() => tab2ws.opened >= 1, 12000);
  const unreadBefore = await apiUnread("rec");
  await waitUntil(async () => (await badge(tab2)) === unreadBefore, 8000, 100); // the badge's first HTTP answer is still in flight right after load (harness race, not an app state)
  const navBefore = await badge(tab2);
  eq(navBefore, unreadBefore, "T21 the badge on the other tab matches the server before anything happens");
  const reloadsList = gets(R, /^\/conversations$/).length;

  const sent = await say("doc", C.dmDocRec, "ordering ping 1");
  ok(sent.status === 201, "doc sends over the real HTTP API", sent.text);
  const t0 = Date.now();
  const gotRow = await waitUntil(async () => (await R.page.locator('[data-testid="conv-preview"]').allTextContents()).some((p) => p.includes("ordering ping 1")), 5000, 40);
  ok(gotRow, "T18 the conversation preview updates in realtime", await R.page.locator('[data-testid="conv-preview"]').allTextContents());
  const ms = Date.now() - t0;
  console.log(`  (preview latency ${ms} ms)`);
  ok(ms < 2500, "T18 …within 2.5 s (no polling interval involved)", ms);
  const after = await names(R.page);
  eq(after[0] === "Clinic Team" || after[0].length > 0, true, "list still renders");
  const idxDoc = after.indexOf("Dr. Sarah Khalil"), idxGone = after.indexOf("Former Colleague");
  ok(idxDoc >= 0 && idxGone >= 0 && idxDoc < idxGone, "T19 the conversation with new activity moved above the older one", after);
  eq(after[0], "Clinic Team", "T19 Clinic Team stays pinned on top");
  const rowBadge = await rowByName(R.page, "Dr. Sarah Khalil").first().locator('[data-testid="conv-badge"]').innerText();
  ok(Number(rowBadge) >= 1, "T20 the conversation's unread badge appears without reload", rowBadge);
  ok(await waitUntil(async () => (await badge(tab2)) === (await apiUnread("rec")), 4000, 60), "T21 the navigation badge (other tab / other page) equals the server total, live", { nav: await badge(tab2), api: await apiUnread("rec") });
  eq(gets(R, /^\/conversations$/).length - reloadsList, 0, "T18–T21 …and the list was NOT re-fetched over HTTP to do it");

  await say("doc", C.dmDocRec, "ordering ping 2");
  ok(await waitUntil(async () => (await badge(tab2)) === (await apiUnread("rec")), 4000), "T21 a second message raises the badge again");

  // T22 / T30: read it in tab 1 → the badge in tab 2 drops live; the server agrees
  await openConv(R, "Dr. Sarah Khalil");
  ok(await waitUntil(async () => (await apiUnread("rec")) === (await rowByName(R.page, "Team").count() ? await apiUnread("rec") : 0), 3000) , "(sync)");
  ok(await waitUntil(async () => (await api("rec", "GET", "/conversations")).json.conversations.find((c) => c.id === C.dmDocRec).unreadCount === 0, 6000), "T22 mark-as-read persisted on the server");
  ok(await waitUntil(async () => (await badge(tab2)) === (await apiUnread("rec")), 4000), "T30 reading in one tab updates the other tab's badge, live (no corruption)", { nav: await badge(tab2), api: await apiUnread("rec") });
  eq(R.log.pageErrors.length, 0, "no uncaught errors");
  await R.ctx.close();
}

/* ============ T11, T14, T15, T23, T28, T29: a DM open on both sides ============ */
{
  const D = await live(browser, "doc", { lang: "ar", gl: true });
  const R = await live(browser, "rec");
  await ready(D); await ready(R);
  await openConv(D, "Lina Reception");
  await openConv(R, "Dr. Sarah Khalil");
  eq(await D.page.evaluate(() => document.documentElement.dir), "rtl", "Arabic UI is RTL");

  const getsBefore = gets(R, /\/messages/).length;
  let postDoneAt = 0;
  D.page.on("response", (r) => { if (r.request().method() === "POST" && /\/messages$/.test(r.url()) && !postDoneAt) postDoneAt = Date.now(); });
  await D.page.locator('[data-testid="composer"]').fill("live hello 1");
  const t0 = Date.now();
  await D.page.locator('[data-testid="composer"]').press("Enter");
  let domAt = 0;
  const arrived = await waitUntil(async () => { if ((await count(R.page, "live hello 1")) === 1) { domAt = Date.now(); return true; } return false; }, 8000, 25);
  console.log(`  (Enter → recipient screen ${domAt - t0} ms; server answered → recipient screen ${domAt - (postDoneAt || t0)} ms; includes test-harness polling)`);
  ok(arrived, "T11 the recipient sees the new message without a refresh");
  ok(domAt - (postDoneAt || t0) < 1500, "T11 …immediately after the server accepted it (no polling interval involved)", domAt - (postDoneAt || t0));
  eq(gets(R, /\/messages/).length - getsBefore, 0, "T11 …and the recipient did not fetch messages over HTTP to get it");
  await sleep(1500);
  eq(await count(D.page, "live hello 1"), 1, "T14 the sender sees ONE copy (optimistic + HTTP + echo do not duplicate)");
  eq(await count(R.page, "live hello 1"), 1, "T15 the recipient sees ONE copy after HTTP/echo/polling");
  ok(await waitUntil(async () => (await D.page.locator('[data-testid="seen"]').count()) === 1, 5000), "T23 the sender sees Seen (live) once the recipient has it on screen");
  eq((await D.page.locator('[data-testid="seen"]').first().innerText()).trim(), "تمت المشاهدة", "T23 the Seen label is Arabic in the Arabic UI");
  ok(!(await D.page.locator("body").innerText()).includes("Delivered"), "no fake 'Delivered' state exists");

  // Arabic + mixed text arrive live and intact
  const ar = "مرحبا، هل المريض جاهز؟", mixed = "Check نتيجة الفحص 2026 ✓";
  await say("rec", C.dmDocRec, ar);
  await say("rec", C.dmDocRec, mixed);
  ok(await waitUntil(async () => (await count(D.page, ar)) === 1 && (await count(D.page, mixed)) === 1, 5000), "T28/T29 Arabic and mixed Arabic/English messages arrive live, intact");
  eq(await D.page.locator('[data-testid="bubble"]').last().getAttribute("dir"), "auto", "T28 bubbles use dir=auto");
  // …and Seen moves back to my newest message only after they read again
  await D.page.locator('[data-testid="composer"]').fill("second from doc");
  await D.page.locator('[data-testid="composer"]').press("Enter");

  const rowOf = D.page.locator('[data-testid="msg"]', { hasText: "second from doc" });
  ok(await waitUntil(async () => (await rowOf.count()) === 1 && /تمت المشاهدة/.test(await rowOf.innerText()), 6000), "T23 …and sits under the newest message", await D.page.locator('[data-testid="stream"]').innerText());
  eq(await D.page.locator('[data-testid="seen"]').count(), 1, "T23 only ONE Seen marker is shown (under the newest read message)");

  /* ---- typing (T32, T33) ---- */
  await R.page.locator('[data-testid="composer"]').click();
  await R.page.locator('[data-testid="composer"]').pressSequentially("typing something long enough here", { delay: 35 });
  ok(await waitUntil(async () => /Lina Reception/.test(await D.page.locator('[data-testid="typing"]').innerText()), 3000), "T32 the other participant sees the typing indicator");
  const tt = (await D.page.locator('[data-testid="typing"]').innerText()).trim();
  ok(/يكتب/.test(tt), "T32 …in Arabic in the Arabic UI", tt);
  const sentTyping = R.ws.tx.filter((p) => p.includes('"connect:typing"') && p.includes("true")).length;
  ok(sentTyping >= 1 && sentTyping <= 2, "T33 typing signals are throttled (≈1.2 s of fast typing → ≤ 2 signals, not one per key)", sentTyping);
  const idleSince = Date.now();
  ok(await waitUntil(async () => (await D.page.locator('[data-testid="typing"]').innerText()).trim() === "", 9500, 150), "T33 the indicator expires by itself");
  console.log(`  (typing expired after ${Date.now() - idleSince} ms)`);
  await R.page.locator('[data-testid="composer"]').fill("");
  await R.page.locator('[data-testid="composer"]').pressSequentially("abc", { delay: 20 });
  ok(await waitUntil(async () => (await D.page.locator('[data-testid="typing"]').innerText()).trim() !== "", 3000), "typing shows again");
  await R.page.locator('[data-testid="composer"]').press("Enter");
  ok(await waitUntil(async () => (await D.page.locator('[data-testid="typing"]').innerText()).trim() === "", 2500), "T33 sending the message clears the indicator at once");

  // the 3D scene pulses subtly for an incoming message (and the chat did not need it)
  const p0 = (await diag(D.page)).incoming || 0;
  await sleep(1000);
  await say("rec", C.dmDocRec, "pulse me");
  ok(await waitUntil(async () => ((await diag(D.page)).incoming || 0) > p0, 4000), "a subtle 3D pulse fires for an incoming message", await diag(D.page));
  eq(D.log.pageErrors.length + R.log.pageErrors.length, 0, "no uncaught errors in either browser");
  await D.ctx.close(); await R.ctx.close();
}

/* ============ T13 + Owner privacy: Clinic Team reaches the team; an Owner never receives unrelated DMs ============ */
{
  const O = await live(browser, "owner");
  const D = await live(browser, "doc");
  const D2 = await live(browser, "doc2");
  const B = await live(browser, "ownerB");
  for (const s of [O, D, D2, B]) await ready(s);
  await openTeam(O); await openTeam(D);
  const before = O.ws.rx.length;
  await say("rec", C.team, "TEAM-LIVE-1");
  ok(await waitUntil(async () => (await count(O.page, "TEAM-LIVE-1")) === 1 && (await count(D.page, "TEAM-LIVE-1")) === 1, 5000), "T13 a Clinic Team message reaches authorised members live (Owner and Doctor)");
  await say("doc", C.dmDocDoc2, "PRIVATE-LIVE-DOC-TO-DOC2");
  ok(await waitUntil(async () => (await D2.page.locator('[data-testid="conv-preview"]').allTextContents()).some((p) => p.includes("PRIVATE-LIVE-DOC-TO-DOC2")), 8000), "the DM's own recipient receives it live", await D2.page.locator('[data-testid="conv-preview"]').allTextContents());
  await sleep(1500);
  const oFrames = O.ws.rx.join("\n");
  ok(!oFrames.includes("PRIVATE-LIVE-DOC-TO-DOC2") && !oFrames.includes(W.secret), "Owner: the unrelated DM text never crossed the owner's socket");
  ok(!(await O.page.content()).includes("PRIVATE-LIVE-DOC-TO-DOC2"), "Owner: …nor reached the owner's DOM");
  const ownerMsgs = events(O, "connect:message:new").map((e) => e.conversation.id);
  ok(ownerMsgs.length >= 1 && ownerMsgs.every((id) => id === C.team), "Owner: every message event the owner got belongs to a conversation they are in", ownerMsgs);
  eq(events(O, "connect:typing").length, 0, "Owner: no typing events from conversations they are not in");
  // a DM the owner IS in does reach them
  await say("doc", C.dmOwnerDoc, "owner-direct-live");
  ok(await waitUntil(async () => (await O.page.locator('[data-testid="conv-preview"]').allTextContents()).some((p) => p.includes("owner-direct-live")), 5000), "Owner: a DM they are part of arrives live");
  // cross-clinic
  ok(!B.ws.rx.join("\n").includes("TEAM-LIVE-1") && events(B, "connect:message:new").length === 0, "Clinic B receives nothing from clinic A");
  ok(!(await B.page.content()).includes("TEAM-LIVE-1"), "Clinic B's DOM has nothing from clinic A");
  void before;
  for (const s of [O, D, D2, B]) await s.ctx.close();
}

/* ============ T16, T17, T31(client side): offline → chip → reconnect → recovery without duplicates; offline send is honest ============ */
{
  const R = await live(browser, "rec");
  await ready(R);
  await openConv(R, "Dr. Sarah Khalil");
  await R.ctx.setOffline(true);
  ok(await waitUntil(async () => R.page.locator('[data-testid="rt-status"]').isVisible(), 6000), "a calm status chip appears when the connection drops");
  eq(await R.page.locator('[data-testid="rt-status"]').getAttribute("data-status"), "offline", "…it says offline");
  eq((await R.page.locator('[data-testid="rt-status"]').innerText()).trim(), "Offline", "…in English");

  // a send while offline: no request leaves the device, no queue, the failure is shown, retry is safe
  const postsBefore = posts(R, /\/messages$/).length;
  await R.page.locator('[data-testid="composer"]').fill("written offline");
  await R.page.locator('[data-testid="composer"]').press("Enter");
  ok(await waitUntil(async () => (await R.page.locator('[data-testid="msg-pending-failed"]').count()) === 1, 4000), "an offline send shows an honest 'not sent' state");
  const note = await R.page.locator('[data-testid="msg-pending-failed"]').innerText();
  ok(/offline/i.test(note), "…that says why", note);
  eq(posts(R, /\/messages$/).length, postsBefore, "…and no request was made (nothing is queued behind the user's back)");

  // missed while offline
  await say("doc", C.dmDocRec, "missed while offline 1");
  await say("doc", C.dmDocRec, "missed while offline 2");
  await sleep(500);
  eq(await count(R.page, "missed while offline 1"), 0, "(not delivered while offline, as expected)");
  await R.ctx.setOffline(false);
  ok(await waitUntil(async () => (await count(R.page, "missed while offline 1")) === 1 && (await count(R.page, "missed while offline 2")) === 1, 15000), "T17 messages missed while disconnected are recovered after reconnect");
  await sleep(1500);
  eq(await count(R.page, "missed while offline 1"), 1, "T16 …exactly once (reconnect + HTTP reconciliation do not duplicate)");
  ok(await waitUntil(async () => (await R.page.locator('[data-testid="rt-status"]').count()) === 0, 8000), "the chip disappears when live again");
  // safe retry of the offline message
  await R.page.locator('[data-testid="retry-send"]').click();
  ok(await waitUntil(async () => (await R.page.locator('[data-testid="msg-pending-failed"]').count()) === 0 && (await count(R.page, "written offline")) === 1, 8000), "Retry delivers the offline message once");
  await sleep(1000);
  const msgs = (await api("rec", "GET", `/conversations/${C.dmDocRec}/messages?limit=30`)).json.messages;
  eq(msgs.filter((m) => m.text === "written offline").length, 1, "…and the database holds exactly one copy");
  eq(R.log.pageErrors.length, 0, "no uncaught errors");
  await R.ctx.close();

  // Arabic chip
  const A = await live(browser, "doc", { lang: "ar" });
  await ready(A);
  await A.ctx.setOffline(true);
  ok(await waitUntil(async () => A.page.locator('[data-testid="rt-status"]').isVisible(), 6000), "the chip also appears in the Arabic UI");
  eq((await A.page.locator('[data-testid="rt-status"]').innerText()).trim(), "غير متصل", "…in Arabic");
  await A.ctx.setOffline(false);
  await A.ctx.close();
}

/* ============ polling is reduced while the socket is live ============ */
{
  const D = await live(browser, "doc");
  await ready(D);
  await openConv(D, "Lina Reception");
  await sleep(3000);
  const m0 = D.log.connect.length;
  await sleep(20000);
  const win = D.log.connect.slice(m0);
  const th = win.filter((c) => c.method === "GET" && /\/messages/.test(c.url)).length;
  const ls = win.filter((c) => c.method === "GET" && /^\/conversations$/.test(c.url)).length;
  ok(th <= 1, `C2 polled the open thread every 5 s (≈4 requests per 20 s); with a live socket: ${th}`, th);
  ok(ls <= 1, `C2 polled the list every 20 s; with a live socket in 20 s: ${ls}`, ls);
  eq(win.filter((c) => c.method === "POST").length, 0, "polling never writes");
  await D.ctx.close();
}

/* ============ hidden tab: no mark-as-read while hidden; read when visible again; the message is there on return ============ */
{
  const R = await live(browser, "rec");
  const D = await live(browser, "doc");
  await ready(R); await ready(D);
  await openConv(R, "Dr. Sarah Khalil");
  await R.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await sleep(500);
  await say("doc", C.dmDocRec, "while hidden");
  await sleep(1800);
  eq((await api("rec", "GET", "/conversations")).json.conversations.find((c) => c.id === C.dmDocRec).unreadCount, 1, "a hidden tab does not mark messages as read");
  await R.page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); });
  ok(await waitUntil(async () => (await count(R.page, "while hidden")) === 1, 4000), "the message is on screen when the tab returns");
  ok(await waitUntil(async () => (await api("rec", "GET", "/conversations")).json.conversations.find((c) => c.id === C.dmDocRec).unreadCount === 0, 5000), "…and is marked read once visible");
  await R.ctx.close(); await D.ctx.close();
}

/* ============ T34, T35: chat does not depend on 3D; reduced motion changes nothing functionally ============ */
{
  const N = await live(browser, "doc2");
  await N.ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) { return /webgl/i.test(String(type)) ? null : orig.call(this, type, ...a); };
  });
  await ready(N);
  await openConv(N, "Dr. Sarah Khalil");
  await say("doc", C.dmDocDoc2, "no-webgl live");
  ok(await waitUntil(async () => (await count(N.page, "no-webgl live")) === 1, 5000), "T34 with WebGL unavailable the message still arrives live");
  eq((await diag(N.page)).running, 0, "T34 …and no 3D engine is running");
  await N.ctx.close();

  const M = await live(browser, "doc2", { reducedMotion: true, gl: true });
  await ready(M);
  await openConv(M, "Dr. Sarah Khalil");
  await say("doc", C.dmDocDoc2, "reduced-motion live");
  ok(await waitUntil(async () => (await count(M.page, "reduced-motion live")) === 1, 5000), "T35 under prefers-reduced-motion the message arrives live");
  eq((await diag(M.page)).incoming || 0, 0, "T35 …and no incoming pulse animation is played");
  eq(M.log.pageErrors.length, 0, "T35 no uncaught errors");
  await M.ctx.close();
}

/* ============ mobile ============ */
{
  const P = await live(browser, "doc2", { w: 390, h: 844, touch: true });
  await ready(P);
  eq(await P.page.locator('[data-testid="messages-app"]').getAttribute("data-layout"), "mobile", "mobile layout");
  await say("doc", C.dmDocDoc2, "mobile live ping");
  ok(await waitUntil(async () => (await P.page.locator('[data-testid="conv-preview"]').allTextContents()).some((x) => x.includes("mobile live ping")), 5000), "mobile: the list preview updates live");
  await openConv(P, "Dr. Sarah Khalil");
  ok(await waitUntil(async () => (await count(P.page, "mobile live ping")) === 1, 4000), "mobile: the message is in the chat");
  await say("doc", C.dmDocDoc2, "mobile live ping 2");
  ok(await waitUntil(async () => (await count(P.page, "mobile live ping 2")) === 1, 4000), "mobile: new messages arrive live in the open chat");
  eq(await P.page.locator("canvas").count(), 0, "mobile: still no WebGL");
  await P.ctx.close();
}

/* ============ CSP: the WebSocket is allowed by the production Content-Security-Policy ============ */
{
  const csp = allSessions.flatMap((s) => s.log.errors).filter((e) => /Content Security Policy|violates the following/i.test(e));
  eq(csp.length, 0, "no Content-Security-Policy violation in any session (connect-src allows the socket)");
  ok(allSessions.every((s) => s.log.pageErrors.length === 0), "no uncaught page errors in any session", allSessions.map((s) => s.log.pageErrors));
}

await browser.close();
process.exit(t.done());
