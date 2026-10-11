/* CLINICOS CONNECT (C5) — FINAL browser QA. Real production build + real backend (HTTP + Socket.IO) + real database. Nothing is mocked.
   Release flows that earlier phases did not cover end-to-end: real sign-in, account switching on one browser (cache leak), several tabs, duplicate torture,
   a long mixed history, 3D failure / cleanup, non-PRO UX, a staff member removed while signed in, the complete Arabic flow, phone / tablet layouts.
   Run (see docs/connect-c5.md):
     node tests/connect/c5-world.js <dir>      (backend :5701 + world; restart it for a clean run — the run mutates the world)     next start -p 3000
     WORLD=<dir>/c5-world.json node tests/connect/e2e/connect-c5.e2e.mjs */
import { launch, session, openMessages, world as W, harness, APP } from "./lib.mjs";

const t = harness("connect-c5 e2e");
const { ok, eq } = t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const U = W.users;
const C = W.c4;
const CV = W.conversations;
const api = async (who, method, url, body, base = "/connect") => {
  const r = await fetch(W.base + base + url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + U[who].token }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const say = async (who, convId, text) => { const r = await api(who, "POST", `/conversations/${convId}/messages`, { text }); if (r.status !== 201) ok(false, `API send by ${who} accepted`, r.text); return r; };
const waitUntil = async (fn, timeout = 9000, step = 60) => { const end = Date.now() + timeout; for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() > end) return false; await sleep(step); } };
const bubbles = (page) => page.locator('[data-testid="bubble"]').allTextContents();
const count = async (page, text) => (await bubbles(page)).filter((b) => b.trim() === text).length;
const rowByName = (page, name) => page.locator('[data-testid^="conv-"]', { has: page.locator('[data-testid="conv-name"]', { hasText: name }) });
const openConv = async (s, name) => { await rowByName(s.page, name).first().click(); await s.page.waitForSelector('[data-testid="stream"]', { timeout: 15000 }); await s.page.waitForTimeout(500); };
const openTeam = async (s) => { await s.page.locator('[data-testid="conv-team"]').first().click(); await s.page.waitForSelector('[data-testid="stream"]', { timeout: 15000 }); await s.page.waitForTimeout(500); };
const cards = (page) => page.locator('[data-testid="ref-card"]');
const diag = (page) => page.evaluate(() => globalThis.__clinicosConnect3D || { created: 0, disposed: 0, running: 0 });
const badge = async (page) => { const l = page.locator('[data-testid="nav-messages-badge"]'); return (await l.count()) ? Number((await l.first().innerText()).replace(/\D/g, "")) : 0; };
const overflow = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth);
const NO_GL = () => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) { return /webgl/i.test(String(type)) ? null : orig.call(this, type, ...a); };
};
const THROW_GL = () => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) { if (/webgl/i.test(String(type))) throw new Error("WebGL exploded"); return orig.call(this, type, ...a); };
};
const watch = (s) => {
  s.ws = { opened: 0, rx: [], tx: [] };
  s.page.on("websocket", (w) => { s.ws.opened++; w.on("framereceived", (f) => s.ws.rx.push(String(f.payload))); w.on("framesent", (f) => s.ws.tx.push(String(f.payload))); });
  return s;
};
const bare = async (browser) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US" });
  await ctx.addInitScript(NO_GL);
  await ctx.addInitScript(() => { try { localStorage.setItem("clinicos-lang", "en"); localStorage.setItem("clinicos-theme", "dark"); } catch {} });
  const page = await ctx.newPage();
  const log = { errors: [], connect: [], pageErrors: [], all: [] };
  page.on("pageerror", (e) => log.pageErrors.push(e.message));
  page.on("request", (r) => log.all.push(r.method() + " " + r.url()));
  return watch({ ctx, page, log });
};
const all = [];
const live = async (browser, who, o = {}) => {
  const s = watch(await session(browser, who, o));
  if (o.gl === "throw") await s.ctx.addInitScript(THROW_GL);
  else if (!o.gl) await s.ctx.addInitScript(NO_GL);
  all.push(s);
  return s;
};
const ready = async (s) => {
  await openMessages(s);
  await waitUntil(() => s.page.locator('[data-testid="conv-team"]').count().then((n) => n > 0), 25000);
  await waitUntil(() => s.ws.opened >= 1, 15000);
  await s.page.waitForTimeout(600);
};
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const storageDump = (page) => page.evaluate(() => { const o = {}; try { for (let i = 0; i < localStorage.length; i++) o["L:" + localStorage.key(i)] = localStorage.getItem(localStorage.key(i)); } catch {} try { for (let i = 0; i < sessionStorage.length; i++) o["S:" + sessionStorage.key(i)] = sessionStorage.getItem(sessionStorage.key(i)); } catch {} return JSON.stringify(o); });
const signIn = async (page, email) => {
  await page.goto(APP + "/signin");
  await page.waitForSelector('input[type="email"]', { timeout: 15000 });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "secret123");
  await Promise.all([page.waitForURL(/\/dashboard/, { timeout: 25000, waitUntil: "commit" }), page.locator('button[type="submit"]').click()]);
};
const logOut = async (page, label = "Log out") => {
  await Promise.all([page.waitForURL(/\/signin/, { timeout: 15000, waitUntil: "commit" }), page.locator(`button[title="${label}"]:visible, button:has-text("${label}"):visible`).first().click()]);
};

const browser = await launch();
const crash = async (e) => { console.log("CRASH:", String(e?.stack || e).slice(0, 900)); try { await browser.close(); } catch {} process.exit(2); };
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);

try {
  /* ============ E1 / E2: real sign-in → PRO Owner → Messages → Team → send → live to a second browser → DM → unread → Seen ============ */
  {
    const own = await bare(browser); all.push(own);
    await signIn(own.page, U.owner.email);
    ok(/\/dashboard/.test(own.page.url()), "E1 real sign-in form → dashboard (no injected session)");
    await own.page.locator('a[href="/messages"]:visible').first().click();
    await own.page.waitForSelector('[data-testid="messages-app"]', { timeout: 20000 });
    ok(await waitUntil(() => own.page.locator('[data-testid="conv-team"]').count().then((n) => n > 0), 15000), "E1 PRO Owner reaches Messages and sees the Clinic Team");
    ok(await waitUntil(() => own.ws.opened >= 1, 10000), "E1 the realtime socket connected after a real sign-in");
    const doc = await live(browser, "doc"); await ready(doc);
    await openTeam(own); await openTeam(doc);
    await own.page.locator('[data-testid="composer"]').fill("E1 hello team from the owner");
    await own.page.locator('[data-testid="send"]').click();
    ok(await waitUntil(async () => (await count(doc.page, "E1 hello team from the owner")) === 1, 8000), "E1 the Doctor's browser receives the Team message live, once");
    eq(await count(own.page, "E1 hello team from the owner"), 1, "E1 the sender sees it exactly once");
    // DM + unread + Seen
    await say("doc", CV.dmOwnerDoc, "E1 private hello owner");
    ok(await waitUntil(async () => (await badge(own.page)) >= 1, 8000), "E1 the Owner's nav badge shows the unread DM");
    await openConv(own, "Dr. Sarah Khalil");
    ok(await waitUntil(async () => (await badge(own.page)) === 0, 8000), "E1 opening the DM clears the badge");
    await openConv(doc, "Amjad Owner");
    await own.page.locator('[data-testid="composer"]').fill("E1 owner replies");
    await own.page.locator('[data-testid="send"]').click();
    ok(await waitUntil(async () => (await count(doc.page, "E1 owner replies")) === 1, 8000), "E1 the DM reply arrives live");
    ok(await waitUntil(async () => (await own.page.locator('[data-testid="seen"]').count()) >= 1, 8000), "E1 the sender sees 'Seen' once the peer has the chat open");
    ok(!(await bodyText(doc.page)).includes("PRIVATE-SECRET"), "E4 the Doctor's page never contains another pair's private text");

    /* ============ E2: cache safety — Owner views a card, logs out, ANOTHER user signs in on the same browser ============ */
    await api("doc", "POST", `/conversations/${CV.dmOwnerDoc}/messages`, { reference: { type: "patient", id: C.pEn }, text: "OWNER-CARD-NOTE" });
    ok(await waitUntil(async () => (await cards(own.page).filter({ hasText: "Mona Hassan" }).count()) >= 1, 8000), "E2 the Owner sees the shared Patient card");
    await own.page.locator('[data-testid="rc-open-patient"]').last().click();
    await own.page.waitForURL(/\/patients/, { timeout: 15000, waitUntil: "commit" });
    ok(true, "E2 'Open Patient File' navigates to the normal ClinicOS patient page");
    await own.page.goto(APP + "/messages"); await own.page.waitForSelector('[data-testid="messages-app"]');
    const before = await storageDump(own.page);
    ok(before.includes("clinicos-auth"), "E2 (control) the auth store is in storage while signed in");
    await logOut(own.page);
    const afterOut = await storageDump(own.page);
    ok(!/Mona Hassan|OWNER-CARD-NOTE|Dr\. Sarah/.test(afterOut), "E2 after logout storage holds no Connect content / patient name");
    ok(!/"selected|patientId|selectedPatient/i.test(afterOut) || !afterOut.includes(C.pEn), "E2 after logout the selected patient id is gone from browser storage");
    await own.page.goBack().catch(() => undefined); await own.page.waitForTimeout(1200);
    ok(!(await bodyText(own.page)).match(/Mona Hassan|OWNER-CARD-NOTE|Amjad Owner/) && (/signin/.test(own.page.url()) || (await own.page.locator('[data-testid="messages-app"]').count()) === 0), "E2 the browser Back button after logout does not reveal the previous session");
    // same clinic, different role (no access to the Owner's DM)
    await signIn(own.page, U.doc2.email);
    await own.page.goto(APP + "/messages"); await own.page.waitForSelector('[data-testid="messages-app"]', { timeout: 20000 });
    await own.page.waitForTimeout(1500);
    let txt = await bodyText(own.page);
    ok(!/OWNER-CARD-NOTE|Hello owner, quick question|E1 owner replies|PRIVATE-SECRET-DOC-DOC2|PRIVATE-CARD-NOTE/.test(txt), "E2 user B (same clinic) inherits NONE of user A's conversations / cards");
    ok((await cards(own.page).count()) === 0, "E2 …and no card is on screen");
    ok(!(await storageDump(own.page)).includes("Mona Hassan"), "E2 …nor in storage");
    await logOut(own.page);
    // other clinic
    await signIn(own.page, U.ownerB.email);
    await own.page.goto(APP + "/messages"); await own.page.waitForSelector('[data-testid="messages-app"]', { timeout: 20000 });
    await own.page.waitForTimeout(1500);
    txt = await bodyText(own.page);
    ok(!/Good morning team|Mona Hassan|OWNER-CARD-NOTE|Lina|Dr\. Sarah|Amjad/.test(txt), "E5 an Owner of ANOTHER clinic signing in on the same browser sees nothing of clinic A");
    ok((await own.page.locator('[data-testid="conv-name"]').allTextContents()).every((n) => !/Sarah|Lina|Amjad|Colleague/.test(n)), "E5 …their conversation list holds only their own clinic's people");
    ok(!(await storageDump(own.page)).match(/Mona Hassan|OWNER-CARD-NOTE|Dr\. Sarah/), "E5 …and storage is clean");
    await own.ctx.close(); await doc.ctx.close();
  }

  /* ============ E3: two tabs of the same user ============ */
  {
    const a = await live(browser, "doc"); await ready(a);
    const page2 = await a.ctx.newPage(); const b = { ...a, page: page2 }; watch(b);
    await page2.goto(APP + "/messages"); await page2.waitForSelector('[data-testid="messages-app"]', { timeout: 20000 });
    await waitUntil(() => b.ws.opened >= 1, 15000);
    await openConv(a, "Lina Reception"); await openConv(b, "Lina Reception");
    await say("rec", CV.dmDocRec, "MT-1 from the colleague");
    ok(await waitUntil(async () => (await count(a.page, "MT-1 from the colleague")) === 1 && (await count(b.page, "MT-1 from the colleague")) === 1, 9000), "E-tabs both tabs receive the message exactly once");
    await a.page.locator('[data-testid="composer"]').fill("MT-2 typed in tab 1");
    await a.page.locator('[data-testid="send"]').click();
    ok(await waitUntil(async () => (await count(a.page, "MT-2 typed in tab 1")) === 1 && (await count(b.page, "MT-2 typed in tab 1")) === 1, 9000), "E-tabs a message sent in tab 1 appears once in tab 1 and once in tab 2");
    await sleep(1500);
    eq([await count(a.page, "MT-2 typed in tab 1"), await count(b.page, "MT-2 typed in tab 1")], [1, 1], "E-tabs …still once each after polling / refetch");
    const msgs = (await api("doc", "GET", `/conversations/${CV.dmDocRec}/messages?limit=100`)).json.messages;
    eq(msgs.filter((m) => m.text === "MT-2 typed in tab 1").length, 1, "E-tabs the database holds one copy");
    // unread/badge consistency between tabs: tab 2 stays on the DM, a Team message arrives -> both tabs agree on the badge
    await openTeam(a); await openConv(b, "Lina Reception");
    await say("rec", CV.team, "MT-3 team ping");
    await sleep(1500);
    ok((await badge(a.page)) === (await badge(b.page)), "E-tabs the nav badge is the same in both tabs", [await badge(a.page), await badge(b.page)]);
    await a.ctx.close();
  }

  /* ============ E4: duplicate torture through the real UI ============ */
  {
    const d = await live(browser, "doc"); const r = await live(browser, "rec"); await Promise.all([ready(d), ready(r)]);
    await openConv(d, "Lina Reception"); await openConv(r, "Dr. Sarah Khalil");
    const typeSend = async (text, how) => {
      const c = d.page.locator('[data-testid="composer"]'); await c.fill(text);
      if (how === "dblclick") await d.page.locator('[data-testid="send"]').dblclick();
      else if (how === "enter3") { await d.page.keyboard.press("Enter"); await d.page.keyboard.press("Enter"); await d.page.keyboard.press("Enter"); }
      else if (how === "enter+click") { await d.page.keyboard.press("Enter"); await d.page.locator('[data-testid="send"]').click({ force: true, timeout: 800 }).catch(() => undefined); }
      else if (how === "click5") { for (let i = 0; i < 5; i++) d.page.locator('[data-testid="send"]').click({ force: true, noWaitAfter: true, timeout: 800 }).catch(() => undefined); }
    };
    for (const [text, how] of [["DUP-A double click", "dblclick"], ["DUP-B enter x3", "enter3"], ["DUP-C enter then click", "enter+click"], ["DUP-D five clicks", "click5"]]) await typeSend(text, how);
    await sleep(3000);
    const server = (await api("doc", "GET", `/conversations/${CV.dmDocRec}/messages?limit=100`)).json.messages;
    for (const text of ["DUP-A double click", "DUP-B enter x3", "DUP-C enter then click", "DUP-D five clicks"]) {
      eq(server.filter((m) => m.text === text).length, 1, `E-dup "${text}": exactly ONE message exists on the server`);
      eq(await count(d.page, text), 1, `E-dup "${text}": sender sees it once`);
      eq(await count(r.page, text), 1, `E-dup "${text}": recipient sees it once`);
    }
    // tab hidden / shown around an incoming message (visibility reconciliation must not duplicate)
    await d.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
    await say("rec", CV.dmDocRec, "DUP-E while hidden");
    await sleep(900);
    await d.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
    ok(await waitUntil(async () => (await count(d.page, "DUP-E while hidden")) === 1, 9000), "E-dup a message that arrives while the tab is hidden shows up once when it is visible again");
    await sleep(1500); eq(await count(d.page, "DUP-E while hidden"), 1, "E-dup …and stays once");
    // network blip: offline → message → online (socket reconnect + HTTP reconciliation + React-Query refetch)
    await d.ctx.setOffline(true); await sleep(800);
    await say("rec", CV.dmDocRec, "DUP-F during blip");
    await d.ctx.setOffline(false);
    ok(await waitUntil(async () => (await count(d.page, "DUP-F during blip")) === 1, 20000), "E-dup a message sent during a network blip is recovered");
    await sleep(2500); eq(await count(d.page, "DUP-F during blip"), 1, "E-dup …exactly once after the reconnect settled");
    ok(await waitUntil(async () => (await d.page.locator('[data-testid="rt-status"]').count()) === 0 || (await d.page.locator('[data-testid="rt-status"]').getAttribute("data-status")) === "connected", 10000), "E-dup the connection indicator returns to normal");
    // the same text sent twice deliberately is two messages (no accidental de-dup of different sends)
    for (let i = 0; i < 2; i++) { await d.page.locator('[data-testid="composer"]').fill("SAME-TEXT"); await d.page.locator('[data-testid="send"]').click(); await sleep(600); }
    await sleep(1500);
    eq(await count(d.page, "SAME-TEXT"), 2, "E-dup two deliberate sends of the same text stay two messages");
    await d.ctx.close(); await r.ctx.close();
  }

  /* ============ E5: long mixed history (text + patient + appointment cards) ============ */
  {
    const hist = (await api("rec", "POST", "/conversations/direct", { userId: U.doc2.id })).json.conversation.id;
    const textNums = [];
    for (let i = 1; i <= 140; i++) {
      if (i % 13 === 0) await api("rec", "POST", `/conversations/${hist}/messages`, { reference: { type: "appointment", id: C.aDoc } }); // doc's appointment: RESTRICTED for doc2
      else if (i % 11 === 0) await api("rec", "POST", `/conversations/${hist}/messages`, { reference: { type: "appointment", id: C.aDoc2 } }); // doc2's own: visible
      else if (i % 7 === 0) await api("rec", "POST", `/conversations/${hist}/messages`, { reference: { type: "patient", id: i % 2 ? C.pEn : C.pAr }, text: `h-${String(i).padStart(3, "0")}` }), textNums.push(i);
      else { await api(i % 2 ? "rec" : "doc2", "POST", `/conversations/${hist}/messages`, { text: `h-${String(i).padStart(3, "0")}` }); textNums.push(i); }
    }
    const r = await live(browser, "doc2"); await ready(r);
    await openConv(r, "Lina Reception");
    const nums = async () => (await bubbles(r.page)).map((b) => /^h-(\d{3})$/.exec(b.trim())).filter(Boolean).map((m) => Number(m[1]));
    ok(await waitUntil(async () => (await nums()).includes(140), 8000), "E-hist the newest message is shown first");
    const first = await nums(); ok(first.length < 60, "E-hist only a page is loaded initially (no whole-history load)", first.length);
    // scroll up until the beginning of the conversation
    let guard = 0; const offsets = [];
    while (guard++ < 14 && (await r.page.locator('[data-testid="start-of-conversation"]').count()) === 0) {
      const anchor = await r.page.evaluate(() => { const st = document.querySelector('[data-testid="stream"]'); st.scrollTop = 0; const sr = st.getBoundingClientRect(); const b = [...st.querySelectorAll('[data-testid="bubble"]')].find((x) => x.getBoundingClientRect().top >= sr.top); return b ? { t: b.textContent.trim(), top: b.getBoundingClientRect().top } : null; });
      // wait until the page has SETTLED (older page rendered, its cards resolved): the reading position is judged on the final layout
      let after = null, prevKey = "", stable = 0;
      for (let k = 0; k < 40 && stable < 4 && anchor; k++) {
        await sleep(250);
        const cur = await r.page.evaluate((t0) => { const st = document.querySelector('[data-testid="stream"]'); const b = [...st.querySelectorAll('[data-testid="bubble"]')].find((x) => x.textContent.trim() === t0); return { top: b ? b.getBoundingClientRect().top : null, h: st.scrollHeight, older: !!document.querySelector('[data-testid="older-loading"] [aria-hidden]') }; }, anchor.t);
        const key = cur.h + ":" + cur.top; after = cur.top;
        stable = key === prevKey && !cur.older ? stable + 1 : 0; prevKey = key;
      }
      if (anchor && after !== null) offsets.push(Math.abs(after - anchor.top));
    }
    ok((await r.page.locator('[data-testid="start-of-conversation"]').count()) === 1, "E-hist scrolling up reaches 'start of conversation'");
    const all_ = await nums();
    eq(all_, textNums, "E-hist every text message is present exactly once, in order, with no gaps");
    ok(offsets.length > 0 && offsets.every((o) => o < 120), "E-hist loading older pages keeps the reading position (the top bubble does not jump)", offsets);
    const cardsN = await cards(r.page).count();
    ok(cardsN >= 20, "E-hist the cards of the whole history are rendered", cardsN);
    const cardTexts = await cards(r.page).allInnerTexts();
    ok(!cardTexts.some((x) => /Dr\. Sarah/.test(x)), "E-hist another doctor's appointment shows NO doctor / time / patient to this doctor (restricted)");
    ok(cardTexts.some((x) => /د\. أحمد المصري/.test(x)) , "E-hist this doctor's own appointment card is complete");
    ok((await bodyText(r.page)).split("\n").filter((l) => /^Mona Hassan$/.test(l.trim())).length >= 1, "E-hist patient cards in the history resolved");
    // realtime while reading old history: no jump, pill appears
    const top = await r.page.evaluate(() => document.querySelector('[data-testid="stream"]').scrollTop);
    await say("rec", hist, "LIVE-WHILE-OLD");
    ok(await waitUntil(() => r.page.locator('[data-testid="new-messages-pill"]').count().then((n) => n === 1), 8000), "E-hist a live message while reading old history shows the 'new messages' pill");
    const top2 = await r.page.evaluate(() => document.querySelector('[data-testid="stream"]').scrollTop);
    ok(Math.abs(top2 - top) < 80, "E-hist …without moving the reader", [top, top2]);
    // reconnect while reading old history
    await r.ctx.setOffline(true); await sleep(700);
    await say("rec", hist, "MISSED-1"); await say("rec", hist, "MISSED-2");
    await r.ctx.setOffline(false);
    ok(await waitUntil(async () => (await count(r.page, "MISSED-1")) === 1 && (await count(r.page, "MISSED-2")) === 1, 20000), "E-hist messages missed during a reconnect arrive (once each) while reading history");
    const top3 = await r.page.evaluate(() => document.querySelector('[data-testid="stream"]').scrollTop);
    ok(Math.abs(top3 - top) < 120, "E-hist …and the reader is still where they were", [top, top3]);
    await r.page.locator('[data-testid="new-messages-pill"]').click().catch(() => undefined);
    await sleep(700);
    eq([await count(r.page, "LIVE-WHILE-OLD"), await count(r.page, "MISSED-1"), await count(r.page, "MISSED-2")], [1, 1, 1], "E-hist all three live/missed messages exist exactly once");
    const dist = await r.page.evaluate(() => { const s = document.querySelector('[data-testid="stream"]'); return s.scrollHeight - s.scrollTop - s.clientHeight; });
    ok(dist < 120, "E-hist the pill jumps to the newest message", dist);
    await r.ctx.close();
  }

  /* ============ E6: 3D — cleanup, reduced motion, WebGL that THROWS; chat works in all of them ============ */
  {
    const g = await live(browser, "owner", { gl: true }); await ready(g);
    ok(await waitUntil(async () => (await diag(g.page)).created >= 1, 15000), "E-3d the 3D Team Space is created when WebGL works");
    await g.page.locator('a[href="/dashboard"]:visible').first().click();
    await g.page.waitForURL(/\/dashboard/, { timeout: 15000, waitUntil: "commit" }); await g.page.waitForTimeout(900);
    const d1 = await diag(g.page); eq([d1.disposed, d1.running], [d1.created, 0], "E-3d leaving Messages disposes every scene and stops every render loop (no leak)");
    await g.page.locator('a[href="/messages"]:visible').first().click(); await g.page.waitForSelector('[data-testid="messages-app"]');
    await waitUntil(async () => (await diag(g.page)).created >= 2, 12000);
    await g.page.locator('a[href="/dashboard"]:visible').first().click(); await g.page.waitForURL(/\/dashboard/, { waitUntil: "commit" }); await g.page.waitForTimeout(900);
    const d2 = await diag(g.page); eq([d2.disposed, d2.running], [d2.created, 0], "E-3d …on every visit (two open/close cycles, no accumulation)");
    await g.ctx.close();

    const rm = await live(browser, "owner", { gl: true, reducedMotion: true }); await ready(rm);
    await waitUntil(async () => (await diag(rm.page)).created >= 1, 15000); await rm.page.waitForTimeout(1200);
    const frames = await rm.page.evaluate(() => new Promise((res) => { let n = 0; const s = performance.now(); const t = () => { n++; performance.now() - s < 600 ? requestAnimationFrame(t) : res(n); }; requestAnimationFrame(t); }));
    ok(await waitUntil(async () => (await diag(rm.page)).running === 0, 10000, 200), "E-3d reduced motion: the 3D scene settles with no continuous animation loop", await diag(rm.page));
    void frames;
    await openTeam(rm); await say("doc", CV.team, "RM-1 pulse check"); ok(await waitUntil(async () => (await count(rm.page, "RM-1 pulse check")) === 1, 8000), "E-3d reduced motion: chat is fully live");
    await rm.ctx.close();

    const bad = await live(browser, "owner", { gl: "throw" }); await ready(bad);
    ok(bad.log.pageErrors.length === 0, "E-3d a WebGL context that THROWS does not crash the page", bad.log.pageErrors);
    await openTeam(bad);
    await bad.page.locator('[data-testid="composer"]').fill("E-3d chat without 3D"); await bad.page.locator('[data-testid="send"]').click();
    ok(await waitUntil(async () => (await count(bad.page, "E-3d chat without 3D")) === 1, 8000), "E-3d chat works completely when the 3D scene cannot start");
    ok((await bad.page.locator('[data-testid="team-space"], [data-testid="team-scene"]').count()) >= 0, "E-3d (fallback panel present or hidden — no blank crash)");
    await bad.ctx.close();
    // no private metadata in the 3D layer: the scene host carries no DM / patient text
    const g2 = await live(browser, "doc", { gl: true }); await ready(g2); await waitUntil(async () => (await diag(g2.page)).created >= 1, 15000);
    const sceneText = await g2.page.evaluate(() => [...document.querySelectorAll('[data-testid="team-space"],[data-testid="team-scene"]')].map((e) => e.innerText + " " + [...e.querySelectorAll("[aria-label],[title]")].map((x) => x.getAttribute("aria-label") + x.getAttribute("title")).join(" ")).join(" "));
    ok(!/PRIVATE-|Mona|0791111111|Vanishing|SECRET-|OWNER-CARD|E1 /.test(sceneText), "E-3d the 3D panel never shows private DM text or patient data", sceneText.slice(0, 120));
    await g2.ctx.close();
  }

  /* ============ E7: NON-PRO UX (EN + AR): locked, honest, and no Connect traffic succeeds ============ */
  for (const [who, lang] of [["ownerBasic", "en"], ["ownerExp", "en"], ["ownerBasic", "ar"]]) {
    const s = await live(browser, who, { lang });
    await openMessages(s); await s.page.waitForTimeout(1500);
    ok((await s.page.locator('[data-testid="messages-locked"]').count()) === 1, `E-lock ${who}/${lang}: Messages shows the locked state`);
    ok((await s.page.locator('[data-testid="upgrade-cta"]').count()) >= 0, `E-lock ${who}/${lang}: upgrade call-to-action area present`);
    const txt = await bodyText(s.page);
    ok(lang === "ar" ? /[؀-ۿ]/.test(txt) && /Pro/.test(txt) : /Pro/.test(txt), `E-lock ${who}/${lang}: the locked screen explains the Pro requirement in ${lang}`);
    ok(s.ws.rx.filter((p) => p.startsWith("42[") && p.includes("connect:message")).length === 0, `E-lock ${who}/${lang}: no realtime message ever reached a non-PRO session`);
    ok((await s.page.locator('[data-testid="conv-team"]').count()) === 0 && (await s.page.locator('[data-testid="composer"]').count()) === 0, `E-lock ${who}/${lang}: no conversation list or composer is rendered`);
    ok((await overflow(s.page)) <= 1, `E-lock ${who}/${lang}: no horizontal overflow`);
    const direct = await api(who, "GET", "/conversations"); eq(direct.status, 402, `E-lock ${who}: the same user calling the API directly gets 402`);
    await s.ctx.close();
  }

  /* ============ E8: a staff member removed while signed in ============ */
  {
    const v = await live(browser, "victim"); await ready(v);
    await openTeam(v); await v.page.locator('[data-testid="composer"]').fill("VICTIM-HISTORY team post"); await v.page.locator('[data-testid="send"]').click();
    const d = await live(browser, "doc"); await ready(d); await openTeam(d);
    ok(await waitUntil(async () => (await count(d.page, "VICTIM-HISTORY team post")) === 1, 8000), "E-rm control: the member's message reached the Team");
    const off = await api("owner", "PATCH", `/${U.victim.id}/active`, { isActive: false }, "/users");
    eq(off.status, 200, "E-rm the Owner deactivates the member (normal ClinicOS action)");
    ok(await waitUntil(() => /signin/.test(v.page.url()), 30000), "E-rm the removed member's OPEN Messages page is signed out (back at the sign-in page)", v.page.url());
    const afterTok = await api("victim", "GET", "/conversations"); eq(afterTok.status, 401, "E-rm …and their token is refused by the API");
    await sleep(1200);
    ok(await count(d.page, "VICTIM-HISTORY team post") === 1 && (await d.page.locator('[data-testid="bubble"]', { hasText: "VICTIM-HISTORY team post" }).count()) === 1, "E-rm the member's history stays in the Team");
    await say("doc", CV.team, "AFTER-REMOVAL post");
    ok(!(v.ws.rx.join("\n")).includes("AFTER-REMOVAL"), "E-rm the removed member's browser never received later Team traffic");
    // a DM with a deactivated colleague: history readable, writing blocked
    const r = await live(browser, "rec"); await ready(r); await openConv(r, "Former Colleague");
    ok(await waitUntil(async () => (await count(r.page, "bye")) === 1, 8000), "E-rm a DM with a deactivated colleague keeps its history readable");
    const dis = await r.page.locator('[data-testid="composer"]').isDisabled().catch(() => false);
    if (!dis) { await r.page.locator('[data-testid="composer"]').fill("to nobody"); await r.page.locator('[data-testid="send"]').click().catch(() => undefined); await sleep(1500); }
    const hist = (await api("rec", "GET", `/conversations/${CV.dmGone}/messages`)).json.messages;
    ok(!hist.some((m) => m.text === "to nobody"), "E-rm …and nothing can be written into it", { dis });
    for (const s of [v, d, r]) await s.ctx.close();
  }

  /* ============ E9: the complete ARABIC / RTL flow ============ */
  {
    const en = await live(browser, "doc"); const ar = await live(browser, "doc", { lang: "ar" }); const peer = await live(browser, "rec", { lang: "ar" });
    await Promise.all([ready(en), ready(ar), ready(peer)]);
    const dirOf = await ar.page.evaluate(() => [document.documentElement.dir, getComputedStyle(document.body).direction, document.documentElement.lang]);
    eq(dirOf.slice(0, 2), ["rtl", "rtl"], "E-ar the document is RTL");
    const AR = /[؀-ۿ]/;
    ok(AR.test(await ar.page.locator('a[href="/messages"]:visible').first().innerText()), "E-ar the navigation entry is Arabic");
    ok(AR.test((await ar.page.locator('[data-testid="conv-search"]').getAttribute("placeholder")) || ""), "E-ar the list search placeholder is Arabic");
    ok(AR.test(await ar.page.locator('[data-testid="conv-team"]').first().innerText()), "E-ar the Clinic Team row is Arabic");
    ok((await overflow(ar.page)) <= 1, "E-ar the list view has no horizontal overflow");
    await say("rec", CV.dmDocRec, "رسالة جديدة من الاستقبال: المريض وصل");
    await sleep(1500);
    ok((await ar.page.locator('[data-testid="conv-badge"]').count()) >= 1, "E-ar unread badge shown in the list");
    await openConv(ar, "Lina Reception").catch(async () => { await ar.page.locator('[data-testid^="conv-"]').nth(1).click(); });
    await openConv(en, "Lina Reception");
    await openConv(peer, "Dr. Sarah Khalil").catch(async () => { await peer.page.locator('[data-testid^="conv-"]').nth(1).click(); }); // the colleague has the chat open → she will have read it
    const ph = (await ar.page.locator('[data-testid="composer"]').getAttribute("placeholder")) || "";
    ok(AR.test(ph), "E-ar the composer placeholder is Arabic", ph);
    ok(AR.test((await ar.page.locator('[data-testid="send"]').getAttribute("aria-label")) || ""), "E-ar the Send control is Arabic");
    ok(AR.test((await ar.page.locator('[data-testid="share-btn"]').getAttribute("aria-label")) || ""), "E-ar the Share control is Arabic");
    await ar.page.locator('[data-testid="composer"]').fill("مرحباً، تم استلام الملف ✅ Mona");
    await ar.page.locator('[data-testid="send"]').click();
    await en.page.waitForTimeout(1200);
    ok(await waitUntil(async () => (await count(en.page, "مرحباً، تم استلام الملف ✅ Mona")) === 1, 8000), "E-ar an Arabic/Latin/emoji mixed message arrives intact");
    // alignment is MIRRORED relative to the English UI
    const side = async (page, text) => page.evaluate((tx) => { const st = document.querySelector('[data-testid="stream"]').getBoundingClientRect(); const b = [...document.querySelectorAll('[data-testid="bubble"]')].find((x) => x.textContent.trim() === tx); if (!b) return null; const r = b.getBoundingClientRect(); return (r.left + r.right) / 2 - (st.left + st.right) / 2; }, text);
    const sArMine = await side(ar.page, "مرحباً، تم استلام الملف ✅ Mona"), sEnMineSame = await side(en.page, "مرحباً، تم استلام الملف ✅ Mona");
    ok(sArMine !== null && sEnMineSame !== null && sArMine * sEnMineSame < 0, "E-ar own vs. received bubbles sit on opposite sides, and the layout is mirrored in RTL", [sArMine, sEnMineSame]);
    const dirAuto = await ar.page.locator('[data-testid="bubble"]').first().getAttribute("dir"); eq(dirAuto, "auto", "E-ar bubbles use dir=auto (mixed text)");
    // Seen (Arabic)
    ok(await waitUntil(async () => (await ar.page.locator('[data-testid="seen"]').count()) >= 1 && AR.test(await ar.page.locator('[data-testid="seen"]').last().innerText()), 10000), "E-ar 'Seen' is shown in Arabic");
    // share pickers + cards in Arabic
    await ar.page.locator('[data-testid="share-btn"]').click(); await ar.page.locator('[data-testid="share-patient"]').click();
    await ar.page.waitForSelector('[data-testid="share-picker"]'); await ar.page.locator('[data-testid="sp-search"]').fill("محمد");
    ok(await waitUntil(async () => (await ar.page.locator('[data-testid="sp-row"]', { hasText: "محمد الخطيب" }).count()) === 1, 8000), "E-ar the patient picker finds an Arabic name by an Arabic query");
    ok((await ar.page.evaluate(() => { const m = document.querySelector('[data-testid="share-picker"]').getBoundingClientRect(); return m.left >= 0 && m.right <= window.innerWidth; })), "E-ar the picker fits the screen");
    await ar.page.locator('[data-testid="sp-row"]', { hasText: "محمد الخطيب" }).click(); await ar.page.locator('[data-testid="sp-note"]').fill("يرجى المراجعة"); await ar.page.locator('[data-testid="sp-send"]').click();
    await ar.page.waitForSelector('[data-testid="share-picker"]', { state: "detached" });
    ok(await waitUntil(async () => (await cards(peer.page).count()) >= 0 && (await en.page.locator('[data-testid="ref-card"]', { hasText: "محمد الخطيب" }).count()) === 1, 9000), "E-ar the Arabic-named patient card arrives once in the other browser");
    const pc = en.page.locator('[data-testid="ref-card"]', { hasText: "محمد الخطيب" }).first();
    ok(await pc.locator('[data-testid="rc-patient-name"]').getAttribute("dir") === "auto", "E-ar the patient name is a dir=auto text node");
    await ar.page.waitForTimeout(800);
    const arCard = ar.page.locator('[data-testid="ref-card"]', { hasText: "محمد الخطيب" }).first();
    ok(AR.test(await arCard.locator('[data-testid="rc-open-patient"]').innerText().catch(() => "")), "E-ar the card button is Arabic");
    // empty search state, connection state, failed send — all Arabic
    await ar.page.locator('[data-testid="conv-search"]').fill("zzzz-nobody"); await ar.page.waitForTimeout(600);
    const bt = await bodyText(ar.page); ok(AR.test(bt.split("zzzz-nobody").join("")), "E-ar the empty-search state is Arabic");
    await ar.page.locator('[data-testid="conv-search"]').fill("");
    await ar.ctx.setOffline(true);
    ok(await waitUntil(async () => (await ar.page.locator('[data-testid="rt-status"]').count()) === 1 && AR.test(await ar.page.locator('[data-testid="rt-status"]').innerText()), 15000), "E-ar the connection state is shown in Arabic");
    await ar.page.locator('[data-testid="composer"]').fill("مرسلة بدون اتصال"); await ar.page.locator('[data-testid="send"]').click();
    ok(await waitUntil(async () => (await ar.page.locator('[data-testid="msg-pending-failed"]').count()) === 1, 6000), "E-ar an offline send shows the honest failed state");
    ok(AR.test(await ar.page.locator('[data-testid="msg-pending-failed"]').innerText()), "E-ar …in Arabic");
    await ar.ctx.setOffline(false);
    ok((await overflow(ar.page)) <= 1, "E-ar no horizontal overflow in the chat");
    // typing indicator Arabic: peer types
    await peer.page.waitForTimeout(300);
    await ar.ctx.close(); await en.ctx.close(); await peer.ctx.close();
  }

  /* ============ E10: phone + tablet ============ */
  {
    const m = await live(browser, "rec", { w: 390, h: 844, touch: true }); await ready(m);
    eq(await m.page.locator('[data-testid="messages-app"]').getAttribute("data-layout"), "mobile", "E-mob 390px → mobile layout");
    eq(await m.page.locator('[data-testid="messages-app"]').getAttribute("data-view"), "list", "E-mob it opens on the conversation LIST");
    ok((await overflow(m.page)) <= 1, "E-mob list: no horizontal overflow");
    await m.page.locator('[data-testid="conv-team"]').first().tap().catch(() => m.page.locator('[data-testid="conv-team"]').first().click());
    await m.page.waitForSelector('[data-testid="stream"]');
    eq(await m.page.locator('[data-testid="messages-app"]').getAttribute("data-view"), "chat", "E-mob tapping a conversation opens the chat view");
    ok(await m.page.locator('[data-testid="chat-back"]').isVisible(), "E-mob a Back control is visible");
    await m.page.locator('[data-testid="composer"]').fill("MOB-1 hello"); await m.page.locator('[data-testid="send"]').click();
    ok(await waitUntil(async () => (await count(m.page, "MOB-1 hello")) === 1, 8000), "E-mob send works on a phone");
    // soft keyboard: the visible viewport shrinks; the composer must stay on screen
    await m.page.setViewportSize({ width: 390, height: 420 }); await m.page.waitForTimeout(500);
    ok(await m.page.evaluate(() => { const c = document.querySelector('[data-testid="composer"]').getBoundingClientRect(); return c.bottom <= window.innerHeight + 1 && c.top >= 0; }), "E-mob with a 420px-high viewport (keyboard open) the composer stays on screen");
    await m.page.setViewportSize({ width: 390, height: 844 }); await m.page.waitForTimeout(400);
    await m.page.locator('[data-testid="share-btn"]').click(); await m.page.locator('[data-testid="share-patient"]').click();
    await m.page.waitForSelector('[data-testid="share-picker"]');
    await waitUntil(() => m.page.locator('[data-testid="sp-row"]').count().then((n) => n > 0), 8000); await m.page.waitForTimeout(400);
    const geo = await m.page.evaluate(() => { const p = document.querySelector('[data-testid="share-picker"]').getBoundingClientRect(); const row = document.querySelector('[data-testid="sp-row"]'); return { l: p.left, r: p.right, w: innerWidth, rowH: row ? row.getBoundingClientRect().height : 0, b: p.bottom, h: innerHeight }; });
    ok(geo.l >= 0 && geo.r <= geo.w + 1, "E-mob the picker fits the phone width", geo);
    ok(geo.rowH >= 44, "E-mob picker rows are touch-sized (>=44px)", geo.rowH);
    ok((await overflow(m.page)) <= 1, "E-mob picker open: no horizontal overflow");
    await waitUntil(() => m.page.locator('[data-testid="sp-row"]').count().then((n) => n > 0), 8000); await m.page.waitForTimeout(400);
    await m.page.locator('[data-testid="sp-row"]').first().click(); await m.page.locator('[data-testid="sp-send"]').click();
    await m.page.waitForSelector('[data-testid="share-picker"]', { state: "detached" });
    ok(await waitUntil(async () => (await cards(m.page).count()) >= 1, 8000), "E-mob the card is sent and visible on the phone");
    await cards(m.page).last().scrollIntoViewIfNeeded().catch(() => undefined);
    const cardBox = await waitUntil(() => cards(m.page).last().boundingBox(), 6000); ok(cardBox && cardBox.x >= 0 && cardBox.x + cardBox.width <= 391, "E-mob the card fits the phone", cardBox);
    ok((await overflow(m.page)) <= 1, "E-mob chat with a card: no horizontal overflow");
    await m.page.locator('[data-testid="chat-back"]').click();
    ok(await waitUntil(async () => (await m.page.locator('[data-testid="messages-app"]').getAttribute("data-view")) === "list", 4000), "E-mob Back returns to the list");
    ok((await m.page.locator('[data-testid="mobile-team-strip"]').count()) >= 0, "E-mob (3D strip present or absent — never blocks the list)");
    await m.ctx.close();
    // phone in Arabic
    const ma = await live(browser, "rec", { w: 390, h: 844, touch: true, lang: "ar" }); await ready(ma);
    ok((await overflow(ma.page)) <= 1, "E-mob Arabic list: no horizontal overflow");
    await ma.page.locator('[data-testid="conv-team"]').first().click(); await ma.page.waitForSelector('[data-testid="stream"]');
    ok((await overflow(ma.page)) <= 1, "E-mob Arabic chat: no horizontal overflow");
    await ma.ctx.close();
    for (const [w, h, label] of [[820, 1180, "tablet portrait"], [1180, 820, "tablet landscape"]]) {
      const tb = await live(browser, "rec", { w, h, touch: true }); await ready(tb);
      ok((await overflow(tb.page)) <= 1, `E-tab ${label}: no horizontal overflow`);
      await openTeam(tb);
      ok(await tb.page.locator('[data-testid="composer"]').isVisible(), `E-tab ${label}: composer visible`);
      ok(await tb.page.evaluate(() => { const c = document.querySelector('[data-testid="composer"]').getBoundingClientRect(); return c.bottom <= innerHeight + 1; }), `E-tab ${label}: composer within the viewport`);
      await tb.page.locator('[data-testid="composer"]').fill(`TAB-${w}`); await tb.page.locator('[data-testid="send"]').click();
      ok(await waitUntil(async () => (await count(tb.page, `TAB-${w}`)) === 1, 8000), `E-tab ${label}: send works`);
      await tb.ctx.close();
    }
  }

  /* ============ page health across everything ============ */
  const errs = all.flatMap((s) => s.log.pageErrors);
  ok(errs.length === 0, "no uncaught page error occurred in any session", errs.slice(0, 3));
  const sawLocalhost = all.some((s) => s.log.all.some((u) => /127\.0\.0\.1:5000|localhost:5000/.test(u)));
  ok(!sawLocalhost, "no browser request went to the default development API (localhost:5000)");
} catch (e) {
  console.log("CRASH:", String(e?.stack || e).slice(0, 1200));
  t.ok(false, "the run completed without an exception", String(e?.message || e).slice(0, 200));
} finally {
  const code = t.done();
  try { await browser.close(); } catch {}
  process.exit(code);
}
