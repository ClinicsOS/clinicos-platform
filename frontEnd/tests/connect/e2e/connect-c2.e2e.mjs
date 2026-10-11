/* CLINICOS CONNECT (C2) — browser end-to-end tests. Real production build + real C1 backend + real database. Nothing is mocked,
   except where a test deliberately breaks the network or WebGL to prove the UI copes.
   The numbers (T1…T30) are the 30 required scenarios of the C2 brief; X-* are extra checks.
   Run (see docs/connect-c2.md):  node tests/connect/c2-world.js <dir>  &  next start  &  WORLD=<dir>/c2-world.json node tests/connect/e2e/connect-c2.e2e.mjs */
import { launch, session, openMessages, world, harness, APP } from "./lib.mjs";

const t = harness("connect-c2 e2e");
const { ok, eq } = t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = world;
const U = W.users;
const api = async (who, method, url, body) => {
  const r = await fetch(W.base + "/connect" + url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + U[who].token }, body: body ? JSON.stringify(body) : undefined });
  let json = null; const text = await r.text(); try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const waitUntil = async (fn, timeout = 15000, step = 150) => { const end = Date.now() + timeout; for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() > end) return false; await sleep(step); } };
const bubbles = (page) => page.locator('[data-testid="bubble"]').allTextContents();
const convNames = (page) => page.locator('[data-testid="conv-name"]').allTextContents();
const posts = (s, re) => s.log.connect.filter((c) => c.method === "POST" && re.test(c.url));
const gets = (s, re) => s.log.connect.filter((c) => c.method === "GET" && re.test(c.url));
const rowByName = (page, name) => page.locator('[data-testid^="conv-"]', { has: page.locator('[data-testid="conv-name"]', { hasText: name }) });
const openConv = async (s, name) => { await rowByName(s.page, name).first().click(); await s.page.waitForSelector('[data-testid="stream"]', { timeout: 15000 }); await s.page.waitForTimeout(400); };
const type = async (page, text) => { await page.locator('[data-testid="composer"]').fill(text); };
const enter = (page) => page.locator('[data-testid="composer"]').press("Enter");
const diag = (page) => page.evaluate(() => globalThis.__clinicosConnect3D || { created: 0, disposed: 0, running: 0 });
const secretSeen = [];

const browser = await launch();

/* ================= T1–T3: every role opens Messages in a PRO clinic ================= */
for (const [n, who] of [[1, "owner"], [2, "doc"], [3, "rec"]]) {
  const s = await session(browser, who);
  await openMessages(s);
  ok(await s.page.locator('[data-testid="messages-app"]').isVisible(), `T${n} ${who} sees the Messages screen`);
  ok((await s.page.locator('nav, aside').locator('a[href="/messages"]').count()) > 0, `T${n} ${who} has the Messages item in the navigation`);
  ok(await waitUntil(async () => (await s.page.locator('[data-testid="conv-team"]').count()) === 1, 20000), `T${n} ${who}: the Clinic Team is listed`);
  ok(s.log.pageErrors.length === 0, `T${n} no uncaught page errors`, s.log.pageErrors);
  await s.ctx.close();
}

/* ================= T4: non-PRO follows the feature gate ================= */
{
  const s = await session(browser, "ownerBasic");
  await openMessages(s);
  await s.page.waitForTimeout(1500);
  ok(await s.page.locator('[data-testid="messages-locked"]').isVisible(), "T4 a Basic clinic sees the locked screen");
  eq(await s.page.locator('[data-testid="messages-locked"]').getAttribute("data-reason"), "plan", "T4 reason is 'plan'");
  eq(s.log.connect.length, 0, "T4 NO /api/connect request is made by a non-PRO clinic");
  const html = await s.page.locator('[data-testid="messages-locked"]').innerText();
  ok(!/Good morning team|PRIVATE-SECRET|مرحبا بكم/.test(html), "T4 the locked preview exposes no chat content");
  eq(await s.page.locator('[data-testid="upgrade-cta"]').getAttribute("href"), "/settings?tab=subscription", "T4 the upgrade CTA uses the existing subscription screen");
  eq(await s.page.locator('nav a[href="/messages"], aside a[href="/messages"]').count(), 0, "T4 the menu hides Messages for a non-PRO clinic (same as Reports)");
  // the server is the real gate: the same token is refused by the API
  const direct = await api("ownerBasic", "GET", "/conversations");
  ok(direct.status === 402 && direct.json?.code === "PLAN_LIMIT", "T4 backend answers 402 PLAN_LIMIT to the Basic clinic", direct.json);
  await s.ctx.close();
  const e = await session(browser, "ownerExp");
  await openMessages(e);
  ok(await waitUntil(async () => e.page.locator('[data-testid="messages-locked"]').isVisible(), 15000), "T4 an expired clinic also sees the locked screen");
  await e.ctx.close();
}

/* ================= T5, T6, T21: list = backend-authorized conversations only; Clinic Team opens; Owner cannot see unrelated DMs ================= */
{
  const s = await session(browser, "owner");
  const bodies = [];
  s.page.on("response", async (r) => { if (r.url().includes("/api/connect")) { try { bodies.push(await r.text()); } catch {} } });
  await openMessages(s);
  await s.page.waitForSelector('[data-testid="conv-team"]');
  const server = await api("owner", "GET", "/conversations");
  const serverNames = server.json.conversations.map((c) => (c.type === "clinic_team" ? "Clinic Team" : c.peer.name)).sort();
  const shown = (await convNames(s.page)).map((x) => x.trim()).sort();
  eq(shown, serverNames, "T5 the list shows exactly the conversations the backend returned");
  ok(!shown.includes("د. أحمد المصري"), "T5/T21 the colleague chat the owner is NOT in is not listed");
  // T6 Clinic Team
  await openConv(s, "Clinic Team");
  eq((await s.page.locator('[data-testid="chat-title"]').innerText()).trim(), "Clinic Team", "T6 Clinic Team header");
  const b = await bubbles(s.page);
  ok(b.some((x) => x.includes("Good morning team")) && b.some((x) => x.includes("صباح الخير")) && b.some((x) => x.includes("Welcome — mixed text")), "T6 Clinic Team shows the real messages (English, Arabic, mixed)", b);
  // T21 search / UI / network never reveal the other DM
  await s.page.locator('[data-testid="conv-search"]').fill("PRIVATE");
  await s.page.waitForTimeout(300);
  eq(await s.page.locator('[data-testid="conv-name"]').count(), 0, "T21 searching for the private chat's text finds nothing for the owner");
  await s.page.locator('[data-testid="conv-search"]').fill("أحمد");
  eq(await s.page.locator('[data-testid="conv-name"]').count(), 0, "T21 searching the other participants' name finds no conversation");
  await s.page.locator('[data-testid="conv-search"]').fill("");
  const page = await s.page.content();
  ok(!page.includes(W.secret), "T21 the secret text of an unrelated DM is nowhere in the owner's DOM");
  ok(!bodies.some((x) => x.includes(W.secret)), "T21 no /api/connect response received by the owner contained it");
  const peek = await api("owner", "GET", `/conversations/${W.conversations.dmDocDoc2}/messages`);
  eq(peek.status, 404, "T21 the owner is refused a DM they are not in (404, existence not confirmed)");
  ok(!peek.text.includes(W.secret) && !/participants|Sarah|أحمد/.test(peek.text), "T20/T21 the refusal leaks nothing", peek.text);
  // X: the 3D scene lists only active staff of this clinic
  const labels = (await s.page.locator('[data-testid="team-scene"]').innerText()).replace(/\s+/g, " ");
  ok(!/Zed Outsider|Bilal|Former Colleague/.test(labels + (await s.page.locator('[data-testid="team-space"]').innerText())), "X the Team Space shows only ACTIVE staff of this clinic");
  ok(/Lina Reception/.test(await s.page.locator('[data-testid="team-space"]').innerHTML()), "X the Team Space shows real colleagues");
  secretSeen.push(...bodies);
  await s.ctx.close();
}

/* ================= T7: a Direct Message opens; X: inactive colleague ================= */
{
  const s = await session(browser, "doc");
  await openMessages(s);
  await openConv(s, "Amjad Owner");
  eq((await s.page.locator('[data-testid="chat-title"]').innerText()).trim(), "Amjad Owner", "T7 DM header shows the colleague");
  ok((await bubbles(s.page)).some((x) => x.includes("Hello owner, quick question")), "T7 DM shows its real message");
  ok(/Owner/.test(await s.page.locator('[data-testid="chat-title"]').locator("xpath=ancestor::header").innerText()), "T7 DM header shows the role");
  await s.ctx.close();
  const r = await session(browser, "rec");
  await openMessages(r);
  await openConv(r, "Former Colleague");
  ok(await r.page.locator('[data-testid="composer"]').isDisabled(), "X a DM with a deactivated colleague is read-only in the composer");
  ok((await bubbles(r.page)).some((x) => x.includes("bye")), "X its history stays readable");
  await r.ctx.close();
}

/* ================= T8–T13: start a DM, no duplicates, send, empty, Arabic, too long ================= */
{
  const s = await session(browser, "owner");
  await openMessages(s);
  await s.page.click('[data-testid="new-message"]');
  await s.page.waitForSelector('[data-testid="new-message-dialog"]');
  await s.page.waitForSelector('[data-testid="nm-person"]');
  const people = (await s.page.locator('[data-testid="nm-person"]').allInnerTexts()).join("|");
  ok(/Sarah Khalil/.test(people) && /Lina Reception/.test(people) && /المصري/.test(people), "T8 the picker lists the active colleagues", people);
  ok(!/Amjad/.test(people), "T8 you are not offered to yourself");
  ok(!/Former Colleague/.test(people), "T8 a deactivated colleague is not offered");
  ok(!/Zed Outsider|Bilal/.test(people), "T8 users of another clinic are never offered");
  eq(await s.page.locator('input[name*="user" i], input[placeholder*="id" i]').count(), 0, "T8 there is no free-text user-id field");
  await s.page.locator('[data-testid="nm-search"]').fill("lina");
  eq(await s.page.locator('[data-testid="nm-person"]').count(), 1, "T8 the picker filters by name");
  await s.page.locator('[data-testid="nm-search"]').fill("");
  // keyboard: Escape closes and focus returns
  await s.page.keyboard.press("Escape");
  ok(!(await s.page.locator('[data-testid="new-message-dialog"]').count()), "X Escape closes the picker");
  ok(await s.page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "new-message"), "X focus returns to the button that opened it");
  await s.page.click('[data-testid="new-message"]');
  await s.page.locator('[data-testid="nm-person"]', { hasText: "المصري" }).click();
  await s.page.waitForSelector('[data-testid="stream"]');
  const opens = posts(s, /conversations\/direct$/);
  eq(opens.length, 1, "T8 one open-direct request");
  eq(JSON.parse(opens[0].body), { userId: U.doc2.id }, "T8 the request carries only the chosen colleague's id");
  const convId1 = await s.page.locator('[data-testid="stream"]').getAttribute("data-conversation");
  eq((await s.page.locator('[data-testid="chat-title"]').innerText()).trim(), "د. أحمد المصري", "T8 the new DM is open");
  // T9 again → same conversation, no duplicate row
  await s.page.click('[data-testid="new-message"]');
  await s.page.locator('[data-testid="nm-person"]', { hasText: "المصري" }).click();
  await s.page.waitForSelector('[data-testid="stream"]');
  const convId2 = await s.page.locator('[data-testid="stream"]').getAttribute("data-conversation");
  eq(convId2, convId1, "T9 choosing the same colleague again opens the SAME conversation");
  await s.page.waitForTimeout(500);
  const names = (await convNames(s.page)).filter((x) => x.includes("المصري"));
  eq(names.length, 1, "T9 the list has exactly one entry for that colleague");
  const srv = (await api("owner", "GET", "/conversations")).json.conversations.filter((c) => c.peer?.name?.includes("المصري"));
  eq(srv.length, 1, "T9 the server holds exactly one conversation for the pair");
  // T10 send
  await type(s.page, "Hello from the owner");
  await enter(s.page);
  await s.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="bubble"]')].some((b) => b.textContent.includes("Hello from the owner")));
  const sent = posts(s, /conversations\/[0-9a-f]{24}\/messages$/);
  eq(sent.length, 1, "T10 exactly one send request");
  eq(JSON.parse(sent[0].body), { text: "Hello from the owner" }, "T10 the request body is {text} only (no sender/clinic/time)");
  await waitUntil(async () => (await s.page.locator('[data-testid^="msg-pending"]').count()) === 0, 5000);
  const stored = (await api("owner", "GET", `/conversations/${convId1}/messages`)).json.messages;
  ok(stored.length === 1 && stored[0].text === "Hello from the owner", "T10 the message is persisted through C1", stored);
  ok(!/Delivered|Seen|✓✓/.test(await s.page.locator('[data-testid="stream"]').innerText()), "T10 no fabricated delivery/seen status is shown");
  // Shift+Enter inserts a newline and does not send
  const before = posts(s, /messages$/).length;
  await s.page.locator('[data-testid="composer"]').fill("line one");
  await s.page.locator('[data-testid="composer"]').press("Shift+Enter");
  await s.page.locator('[data-testid="composer"]').pressSequentially("line two");
  eq(await s.page.locator('[data-testid="composer"]').inputValue(), "line one\nline two", "X Shift+Enter inserts a new line");
  eq(posts(s, /messages$/).length, before, "X Shift+Enter does not send");
  await enter(s.page);
  await s.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="bubble"]')].some((b) => b.textContent.includes("line two")));
  ok((await s.page.locator('[data-testid="bubble"]', { hasText: "line two" }).innerText()).includes("line one\nline two"), "X the multi-line message keeps its line break");
  // double Enter does not double-send
  await type(s.page, "once only");
  const b2 = posts(s, /messages$/).length;
  await s.page.locator('[data-testid="composer"]').press("Enter");
  await s.page.locator('[data-testid="composer"]').press("Enter");
  await s.page.waitForTimeout(1200);
  eq(posts(s, /messages$/).length - b2, 1, "X pressing Enter twice sends once");
  // T11 empty
  const b3 = posts(s, /messages$/).length;
  ok(await s.page.locator('[data-testid="send"]').isDisabled(), "T11 the send button is disabled with an empty composer");
  await type(s.page, "   ");
  ok(await s.page.locator('[data-testid="send"]').isDisabled(), "T11 …and with spaces only");
  await enter(s.page);
  await type(s.page, "​‏");
  await enter(s.page);
  await s.page.waitForTimeout(500);
  eq(posts(s, /messages$/).length, b3, "T11 an empty / invisible-only message never reaches the server");
  await type(s.page, "");
  // T12 Arabic
  await type(s.page, "مرحباً دكتور، كيف حالك اليوم؟ 123 ✅");
  await enter(s.page);
  await s.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="bubble"]')].some((b) => b.textContent.includes("مرحباً دكتور")));
  await waitUntil(async () => (await s.page.locator('[data-testid^="msg-pending"]').count()) === 0, 8000);
  const ar = (await api("owner", "GET", `/conversations/${convId1}/messages`)).json.messages.map((m) => m.text);
  ok(ar.includes("مرحباً دكتور، كيف حالك اليوم؟ 123 ✅"), "T12 an Arabic message is stored and shown intact", ar);
  eq(await s.page.locator('[data-testid="bubble"]', { hasText: "مرحباً دكتور" }).getAttribute("dir"), "auto", "T12 bubbles pick their direction from the text");
  // T13 too long
  const b4 = posts(s, /messages$/).length;
  await s.page.locator('[data-testid="composer"]').fill("x".repeat(4001));
  ok(await s.page.locator('[data-testid="send"]').isDisabled(), "T13 an over-long message cannot be sent (button disabled)");
  ok(/4000|4,000/.test(await s.page.locator("#connect-composer-note").innerText()), "T13 the limit is explained");
  await enter(s.page);
  await s.page.waitForTimeout(400);
  eq(posts(s, /messages$/).length, b4, "T13 no request for an over-long message");
  await s.page.locator('[data-testid="composer"]').fill("x".repeat(4000));
  ok(!(await s.page.locator('[data-testid="send"]').isDisabled()), "T13 exactly 4000 characters is allowed");
  // server-side too (bypassing the UI)
  const bad = await api("owner", "POST", `/conversations/${convId1}/messages`, { text: "y".repeat(4001) });
  eq(bad.status, 400, "T13 the server independently refuses an over-long message");
  ok(s.log.pageErrors.length === 0, "T8-13 no uncaught page errors", s.log.pageErrors);
  await s.ctx.close();
}

/* ================= T14–T16: unread badge, mark-as-read, navigation badge ================= */
{
  const s = await session(browser, "owner");
  await openMessages(s);
  await s.page.waitForSelector('[data-testid="conv-direct"]');
  const rowSarah = rowByName(s.page, "Dr. Sarah Khalil").first();
  const base = await api("owner", "GET", "/conversations");
  const sarahConv = base.json.conversations.find((c) => c.peer?.name === "Dr. Sarah Khalil");
  const before = sarahConv.unreadCount;
  ok(before >= 1, "T14 precondition: the owner has an unread message from the doctor", before);
  eq(await rowSarah.locator('[data-testid="conv-badge"]').innerText(), String(before), "T14 the list shows the real unread count");
  const navBefore = Number(await s.page.locator('[data-testid="nav-messages-badge"]').innerText());
  eq(navBefore, base.json.totalUnread, "T16 the navigation badge equals the server's total unread");
  // a new message arrives from the doctor (through the real API); the list refreshes on its own
  await api("doc", "POST", `/conversations/${sarahConv.id}/messages`, { text: "ping while you were away" });
  const grew = await waitUntil(async () => Number(await rowSarah.locator('[data-testid="conv-badge"]').innerText()) === before + 1, 40000, 500);
  ok(grew, "T14 the unread badge updates by itself (HTTP refresh, no reload)");
  const navMid = Number(await s.page.locator('[data-testid="nav-messages-badge"]').innerText());
  eq(navMid, navBefore + 1, "T16 the navigation badge follows without a reload");
  ok(/unread/i.test(await rowSarah.innerText()), "X the unread state is also exposed to screen readers");
  // T15 open → marked read
  await rowSarah.click();
  await s.page.waitForSelector('[data-testid="stream"]');
  const readOk = await waitUntil(async () => posts(s, /\/read$/).length >= 1, 8000);
  ok(readOk, "T15 opening the conversation marks it read");
  const readReq = posts(s, /\/read$/)[0];
  const lastId = (await api("owner", "GET", `/conversations/${sarahConv.id}/messages`)).json.messages.slice(-1)[0].id;
  eq(JSON.parse(readReq.body), { upToMessageId: lastId }, "T15 mark-read names the newest message that was actually shown");
  await waitUntil(async () => (await rowSarah.locator('[data-testid="conv-badge"]').count()) === 0, 8000);
  eq(await rowSarah.locator('[data-testid="conv-badge"]').count(), 0, "T15 the row's badge disappears");
  const srvAfter = (await api("owner", "GET", "/conversations")).json.conversations.find((c) => c.id === sarahConv.id);
  eq(srvAfter.unreadCount, 0, "T15 the server agrees: unread is 0");
  const navAfter = await s.page.locator('[data-testid="nav-messages-badge"]').count();
  const expectTotal = (await api("owner", "GET", "/unread-count")).json.total;
  eq(navAfter ? Number(await s.page.locator('[data-testid="nav-messages-badge"]').innerText()) : 0, expectTotal, "T16 the navigation badge drops without a reload");
  await s.ctx.close();
}

/* ================= T17–T18: older messages, scroll position ================= */
{
  const s = await session(browser, "doc");
  await openMessages(s);
  await openConv(s, "Lina Reception");
  await s.page.waitForTimeout(600);
  const stream = s.page.locator('[data-testid="stream"]');
  eq(await s.page.locator('[data-testid="bubble"]').count(), 30, "T17 the newest page (30) is shown first");
  const atBottom = await stream.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 8);
  ok(atBottom, "X a conversation opens at the latest message");
  ok((await bubbles(s.page)).slice(-1)[0].includes("msg 075"), "T17 the newest message is last");
  // T18: remember where msg 046 is, scroll to the top edge, wait for the older page, and compare
  // measured against the content box, so the pane's slide-in animation (a transform on the whole content) cannot skew it
  const pos = (el) => { const b = [...el.querySelectorAll('[data-testid="bubble"]')].find((x) => x.textContent.includes("msg 046")); return b.getBoundingClientRect().top - el.firstElementChild.getBoundingClientRect().top - el.scrollTop; };
  const anchorPos = async () => stream.evaluate(pos);
  const before = await stream.evaluate((el, posSrc) => {
    const pos = eval(posSrc);
    el.scrollTop = 100;
    return pos(el);
  }, pos.toString());
  ok(await waitUntil(async () => (await s.page.locator('[data-testid="bubble"]').count()) >= 60, 8000), "T17 scrolling up loads the next older page");
  await s.page.waitForTimeout(400);
  const after = await anchorPos();
  ok(Math.abs(after - before) <= 4, "T18 the reader's place is kept when older messages are added on top", { before, after });
  const older = gets(s, /before=/);
  ok(older.length >= 1 && /before=[A-Za-z0-9_-]+/.test(older[0].url), "T17 pagination uses the opaque cursor from C1", older.map((o) => o.url));
  // keep going until the beginning
  for (let i = 0; i < 6; i++) { await stream.evaluate((el) => (el.scrollTop = 0)); await s.page.waitForTimeout(500); }
  eq(await s.page.locator('[data-testid="bubble"]').count(), 75, "T17 every one of the 75 messages is reachable");
  ok(await s.page.locator('[data-testid="start-of-conversation"]').isVisible(), "T17 the beginning of the conversation is shown at the end");
  const nOlder = gets(s, /before=/).length;
  await stream.evaluate((el) => (el.scrollTop = 0));
  await s.page.waitForTimeout(1200);
  eq(gets(s, /before=/).length, nOlder, "T17 no further requests once the history has ended");
  const texts = await bubbles(s.page);
  eq(new Set(texts).size, 75, "T17 no duplicated messages after paging");
  eq(texts[0].trim(), "msg 001", "T17 messages are in order, oldest first");
  await s.ctx.close();
}

/* ================= T19: failed sends are safe and never duplicate ================= */
{
  const s = await session(browser, "owner");
  await openMessages(s);
  await openConv(s, "Dr. Sarah Khalil");
  const convId = await s.page.locator('[data-testid="stream"]').getAttribute("data-conversation");
  // (a) the request never reaches the server
  await s.page.route(/\/api\/connect\/conversations\/[0-9a-f]{24}\/messages$/, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await type(s.page, "will fail A");
  await enter(s.page);
  await s.page.waitForSelector('[data-testid="msg-pending-failed"]', { timeout: 10000 });
  ok(/Retry|إعادة/.test(await s.page.locator('[data-testid="msg-pending-failed"]').innerText()), "T19 a failed message is clearly marked and offers Retry");
  eq(await s.page.locator('[data-testid="bubble"]', { hasText: "will fail A" }).count(), 1, "T19 shown once");
  await s.page.unroute(/\/api\/connect\/conversations\/[0-9a-f]{24}\/messages$/);
  await s.page.locator('[data-testid="retry-send"]').click();
  await waitUntil(async () => (await s.page.locator('[data-testid^="msg-pending"]').count()) === 0, 8000);
  const afterA = (await api("owner", "GET", `/conversations/${convId}/messages`)).json.messages.filter((m) => m.text === "will fail A");
  eq(afterA.length, 1, "T19 Retry delivered the message exactly once");
  eq(await s.page.locator('[data-testid="bubble"]', { hasText: "will fail A" }).count(), 1, "T19 …and it is shown once");
  // (b) the server STORED it but the answer was lost: Retry must not create a second copy
  await s.page.route(/\/api\/connect\/conversations\/[0-9a-f]{24}\/messages$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fetch(); // the server processes and stores it …
    await route.abort(); // … but the browser never gets the answer
  });
  await type(s.page, "will fail B");
  await enter(s.page);
  await s.page.waitForSelector('[data-testid="msg-pending-failed"]', { timeout: 10000 });
  ok(/may not have been sent|قد لا تكون/.test(await s.page.locator('[data-testid="msg-pending-failed"]').innerText()), "T19 an unanswered request says it MAY not have been sent (not a false 'failed')");
  await s.page.unroute(/\/api\/connect\/conversations\/[0-9a-f]{24}\/messages$/);
  await s.page.locator('[data-testid="retry-send"]').click();
  await waitUntil(async () => (await s.page.locator('[data-testid^="msg-pending"]').count()) === 0, 8000);
  await s.page.waitForTimeout(800);
  const afterB = (await api("owner", "GET", `/conversations/${convId}/messages`)).json.messages.filter((m) => m.text === "will fail B");
  eq(afterB.length, 1, "T19 retrying a message whose answer was lost does NOT duplicate it", afterB.length);
  eq(await s.page.locator('[data-testid="bubble"]', { hasText: "will fail B" }).count(), 1, "T19 …and the screen shows one copy");
  // (c) discard
  await s.page.route(/\/api\/connect\/conversations\/[0-9a-f]{24}\/messages$/, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
  await type(s.page, "will fail C");
  await enter(s.page);
  await s.page.waitForSelector('[data-testid="msg-pending-failed"]');
  await s.page.getByRole("button", { name: /Remove|حذف/ }).click();
  ok(await waitUntil(async () => (await s.page.locator('[data-testid="bubble"]', { hasText: "will fail C" }).count()) === 0, 5000), "T19 a failed message can be removed");
  await s.page.unroute(/\/api\/connect\/conversations\/[0-9a-f]{24}\/messages$/);
  ok(!s.log.errors.some((e) => /Cannot read|undefined|TypeError/.test(e)), "T19 failures raise no script errors", s.log.errors);
  await s.ctx.close();
}

/* ================= T20: unauthorised / cross-clinic failures leak nothing ================= */
{
  const s = await session(browser, "owner");
  const probes = [
    ["owner", "GET", `/conversations/${W.conversations.dmDocDoc2}`],
    ["owner", "GET", `/conversations/${W.conversations.dmDocDoc2}/messages`],
    ["owner", "POST", `/conversations/${W.conversations.dmDocDoc2}/messages`, { text: "intrude" }],
    ["owner", "POST", `/conversations/${W.conversations.dmDocDoc2}/read`, {}],
    ["ownerB", "GET", `/conversations/${W.conversations.team}/messages`],
    ["ownerB", "GET", `/conversations/${W.conversations.dmOwnerDoc}`],
    ["owner", "POST", "/conversations/direct", { userId: U.ownerB.id }],
    ["owner", "POST", "/conversations/direct", { userId: U.gone.id }],
  ];
  for (const [who, m, url, body] of probes) {
    const r = await api(who, m, url, body);
    ok(r.status === 404, `T20 ${who} ${m} ${url.slice(0, 40)}… → 404`, { status: r.status, text: r.text });
    ok(!/Zed|Bilal|Sarah|Former|Outsider|PRIVATE|participant|clinic|stack|mongo/i.test(r.text), `T20 …and the answer reveals nothing`, r.text);
  }
  // UI: the conversation disappears for the user (404 on the thread) → a calm, generic state
  await openMessages(s);
  await s.page.route(/\/messages\?limit=30$/, (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: "Conversation not found", code: "NOT_FOUND" }) }));
  await rowByName(s.page, "Dr. Sarah Khalil").first().click();
  await s.page.waitForSelector('[data-testid="conversation-gone"]', { timeout: 10000 });
  const txt = await s.page.locator('[data-testid="conversation-gone"]').innerText();
  ok(/no longer available/i.test(txt) && !/[0-9a-f]{24}|stack|mongo/i.test(txt), "T20 'conversation no longer accessible' is calm and shows no ids/internals", txt);
  await s.page.unroute(/\/messages\?limit=30$/);
  await s.page.getByRole("button", { name: /Back to messages/i }).click();
  ok(await s.page.locator('[data-testid="chat-empty"]').isVisible(), "T20 the user can go back to the list");
  await s.ctx.close();
}

/* ================= T22–T25, X: layouts ================= */
{
  // desktop
  const d = await session(browser, "owner", { w: 1440, h: 900 });
  await openMessages(d);
  await d.page.waitForSelector('[data-testid="team-space"]');
  eq(await d.page.locator('[data-testid="messages-app"]').getAttribute("data-layout"), "desktop", "T22 desktop layout");
  const box = async (sel) => (await d.page.locator(sel).first().boundingBox());
  const list = await box('aside[aria-label]'); const chat = await box('section[aria-label]'); const team = await box('[data-testid="team-space"]');
  ok(list && chat && team && list.x < chat.x && chat.x < team.x, "T22 three areas side by side: list | chat | Team Space", { list, chat, team });
  await d.page.waitForSelector('[data-testid="team-scene"][data-gl="on"]', { timeout: 15000 });
  ok(true, "T22 the 3D Team Space is running");
  await d.page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/desktop.png` : undefined });
  await d.ctx.close();
  // tablet
  const tb = await session(browser, "owner", { w: 900, h: 1000 });
  await openMessages(tb);
  eq(await tb.page.locator('[data-testid="messages-app"]').getAttribute("data-layout"), "tablet", "T23 tablet layout");
  eq(await tb.page.locator('[data-testid="team-space"]').count(), 0, "T23 no full Team Space panel on a tablet");
  await tb.page.click('[data-testid="open-team"]');
  await tb.page.waitForSelector('[data-testid="team-space-band"]');
  ok(await tb.page.locator('[data-testid="conv-team"]').isVisible() && await tb.page.locator('[data-testid="stream"]').isVisible(), "T23 list and chat are both visible");
  ok(await tb.page.locator('[data-testid="team-space-band"]').isVisible(), "T23 a reduced 3D band sits above the chat");
  await tb.page.getByRole("button", { name: /Team Space|مساحة الفريق/ }).click();
  await tb.page.waitForTimeout(300);
  eq(await tb.page.locator('[data-testid="team-space-band"]').count(), 0, "T23 the band can be collapsed");
  await tb.ctx.close();
  // mobile
  const m = await session(browser, "owner", { w: 390, h: 844, touch: true });
  await openMessages(m);
  eq(await m.page.locator('[data-testid="messages-app"]').getAttribute("data-layout"), "mobile", "T24 mobile layout");
  ok(await waitUntil(async () => m.page.locator('[data-testid="conv-team"]').isVisible(), 20000), "T24 the list comes first");
  ok(!(await m.page.locator('[data-testid="stream"]').count()), "T24 no chat yet");
  eq(await m.page.locator("canvas").count(), 0, "T24 no WebGL canvas at all on a phone (lightweight header only)");
  ok(await m.page.locator('[data-testid="mobile-team-strip"]').isVisible(), "T24 a light team header is shown instead");
  eq((await diag(m.page)).created, 0, "T24 the 3D engine is never created on a phone");
  await m.page.locator('[data-testid="conv-team"]').tap();
  await m.page.waitForSelector('[data-testid="stream"]');
  await m.page.waitForTimeout(500);
  ok(await m.page.locator('[data-testid="composer"]').isVisible(), "T24 chat + composer fill the screen");
  ok(!(await m.page.locator('[data-testid="conv-team"]').isVisible()), "T24 the list is hidden while chatting");
  const back = m.page.locator('[data-testid="chat-back"]');
  ok(await back.isVisible(), "T24 a Back button is shown");
  const bb = await back.boundingBox();
  ok(bb.width >= 40 && bb.height >= 40, "X touch target of Back is at least 40px", bb);
  const sb = await m.page.locator('[data-testid="send"]').boundingBox();
  ok(sb.width >= 40 && sb.height >= 40, "X touch target of Send is at least 40px", sb);
  await back.tap();
  await m.page.waitForTimeout(500);
  ok(await m.page.locator('[data-testid="conv-team"]').isVisible(), "T24 Back returns to the list");
  ok(await m.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "T24 no horizontal page scroll on mobile");
  await m.ctx.close();
}

/* ================= T25: Arabic / RTL ================= */
{
  const s = await session(browser, "owner", { lang: "ar" });
  await openMessages(s);
  await s.page.waitForSelector('[data-testid="conv-team"]');
  eq(await s.page.evaluate(() => document.documentElement.dir), "rtl", "T25 the page is RTL");
  ok(/الرسائل/.test(await s.page.locator("aside").first().innerText()), "T25 UI text is Arabic (real useI18n dictionary)");
  const l = await s.page.locator('aside[aria-label]').first().boundingBox();
  const c = await s.page.locator('section[aria-label]').first().boundingBox();
  const tm = await s.page.locator('[data-testid="team-space"]').boundingBox();
  ok(l.x > c.x && c.x > tm.x, "T25 the three areas are mirrored (list on the right, Team Space on the left)", { l, c, tm });
  await openConv(s, "فريق العيادة");
  const mine = await s.page.locator('[data-testid="bubble"]', { hasText: "Welcome — mixed text" }).boundingBox();
  const other = await s.page.locator('[data-testid="bubble"]', { hasText: "صباح الخير" }).boundingBox();
  ok(mine.x < other.x, "T25 my bubbles sit on the left, colleagues' on the right (RTL)", { mine, other });
  const ph = await s.page.locator('[data-testid="composer"]').getAttribute("placeholder");
  ok(/اكتب/.test(ph), "T25 the composer is Arabic");
  ok(!(/[٠-٩]/.test(await s.page.locator('[data-testid="stream"]').innerText())), "T25 times use the app's Latin digits");
  await s.page.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/arabic.png` : undefined });
  await s.ctx.close();
}

/* ================= T26: reduced motion ================= */
{
  const s = await session(browser, "owner", { reducedMotion: true });
  await openMessages(s);
  await s.page.waitForSelector('[data-testid="conv-direct"]');
  const dur = await s.page.locator('[data-testid="conv-badge"]').first().evaluate((el) => getComputedStyle(el).animationDuration).catch(() => "0s");
  ok(parseFloat(dur) <= 0.001 || dur === "0s", "T26 CSS animations are disabled under prefers-reduced-motion", dur);
  await openConv(s, "Clinic Team");
  await s.page.waitForSelector('[data-testid="team-scene"][data-gl="on"]', { timeout: 15000 });
  await s.page.waitForTimeout(2500);
  eq((await diag(s.page)).running, 0, "T26 the 3D scene is NOT animating idle under reduced motion (no render loop)");
  await type(s.page, "reduced motion works");
  await enter(s.page);
  await s.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="bubble"]')].some((b) => b.textContent.includes("reduced motion works")));
  await s.page.waitForTimeout(1500);
  eq((await diag(s.page)).running, 0, "T26 sending still works and the scene settles back to idle");
  await s.ctx.close();
}

/* ================= T27: 3D failure does not break chat ================= */
{
  const s = await session(browser, "owner");
  await s.ctx.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...a) { return /webgl/i.test(String(type)) ? null : orig.call(this, type, ...a); };
  });
  await openMessages(s);
  await s.page.waitForTimeout(1500);
  await openConv(s, "Clinic Team");
  eq(await s.page.locator('[data-testid="team-scene"]').getAttribute("data-gl"), "off", "T27 without WebGL the CSS/SVG fallback is shown");
  ok(await s.page.locator('[data-testid="team-space"]').isVisible(), "T27 the Team Space panel is still there");
  ok((await s.page.locator('[data-testid="team-space"]').innerText()).includes("Lina"), "T27 the fallback still shows the real team");
  await type(s.page, "chat works without 3D");
  await enter(s.page);
  ok(await s.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="bubble"]')].some((b) => b.textContent.includes("chat works without 3D"))).then(() => true), "T27 sending works without 3D");
  ok(s.log.pageErrors.length === 0, "T27 no uncaught errors", s.log.pageErrors);
  await s.ctx.close();
  // context lost at runtime
  const l = await session(browser, "owner");
  await openMessages(l);
  await l.page.waitForSelector('[data-testid="team-scene"][data-gl="on"]', { timeout: 15000 });
  await l.page.evaluate(() => document.querySelector('[data-testid="team-scene"] canvas')?.dispatchEvent(new Event("webglcontextlost", { cancelable: true })));
  await l.page.waitForTimeout(600);
  eq(await l.page.locator('[data-testid="team-scene"]').getAttribute("data-gl"), "off", "T27 losing the GL context at runtime falls back gracefully");
  eq((await diag(l.page)).running, 0, "T27 …and the render loop is stopped");
  ok(l.log.pageErrors.length === 0, "T27 no uncaught errors after context loss", l.log.pageErrors);
  await l.ctx.close();
}

/* ================= T28: 3D cleans up on unmount ================= */
{
  const s = await session(browser, "owner");
  await openMessages(s);
  await s.page.waitForSelector('[data-testid="team-scene"][data-gl="on"]', { timeout: 15000 });
  let d = await diag(s.page);
  eq([d.created, d.disposed], [1, 0], "T28 one engine is created for the screen");
  await s.page.locator('aside a[href="/dashboard"]').first().click();
  await s.page.waitForURL(/dashboard/);
  await s.page.waitForTimeout(800);
  d = await diag(s.page);
  eq([d.created, d.disposed, d.running], [1, 1, 0], "T28 leaving the screen disposes the engine and stops its loop");
  eq(await s.page.locator("canvas").count(), 0, "T28 no stray canvas is left in the page");
  await s.page.locator('aside a[href="/messages"]').first().click();
  await s.page.waitForSelector('[data-testid="team-scene"][data-gl="on"]', { timeout: 15000 });
  d = await diag(s.page);
  eq([d.created, d.disposed], [2, 1], "T28 coming back creates exactly one new engine (no leak)");
  // switching conversations / DM mode must not create more engines
  await openConv(s, "Dr. Sarah Khalil");
  await openConv(s, "Clinic Team");
  d = await diag(s.page);
  eq(d.created - d.disposed, 1, "T28 switching conversations keeps a single engine alive", d);
  await s.ctx.close();
}

/* ================= T29: no uncontrolled polling ================= */
{
  const s = await session(browser, "owner");
  await openMessages(s);
  await openConv(s, "Dr. Sarah Khalil");
  // hop between conversations several times; loops must not stack up
  for (let i = 0; i < 4; i++) { await openConv(s, "Clinic Team"); await openConv(s, "Dr. Sarah Khalil"); }
  await s.page.waitForTimeout(1500);
  const mark = s.log.connect.length;
  await s.page.waitForTimeout(22000);
  const win = s.log.connect.slice(mark);
  const after = win.filter((c) => c.method === "GET" && /messages\?.*after=/.test(c.url));
  const lists = win.filter((c) => c.method === "GET" && /^\/conversations$/.test(c.url));
  if (process.env.C3_REALTIME === "off") {
    // C3 kill switch (CONNECT_REALTIME=off on the server): the screen falls back to the C2 polling intervals, unchanged
    ok(after.length >= 3 && after.length <= 6, "T29 the open conversation polls about every 5 s (one loop only)", { after: after.length });
    ok(lists.length <= 2, "T29 the list refreshes about every 20 s", { lists: lists.length });
  } else {
    // C3: while the realtime socket is connected polling is only a slow safety net (45 s / 60 s) — never an uncontrolled loop
    ok(after.length <= 1, "T29 (C3) with a live socket the open conversation is only reconciled slowly (one loop only)", { after: after.length });
    ok(lists.length <= 1, "T29 (C3) with a live socket the list refreshes slowly", { lists: lists.length });
  }
  ok(win.filter((c) => c.method === "POST").length === 0, "T29 polling never writes (no mark-read spam)", win.filter((c) => c.method === "POST"));
  ok(win.filter((c) => /unread-count/.test(c.url)).length <= 2, "T29 the badge does not poll in addition to the list", win.filter((c) => /unread/.test(c.url)).length);
  // hidden tab: everything stops, and one catch-up happens on return
  await s.page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
  await s.page.waitForTimeout(800);
  const m2 = s.log.connect.length;
  await s.page.waitForTimeout(14000);
  eq(s.log.connect.length - m2, 0, "T29 a hidden tab makes no Connect requests at all");
  await s.page.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); });
  await s.page.waitForTimeout(1500);
  ok(s.log.connect.length - m2 >= 1, "T29 coming back triggers an immediate catch-up");
  await s.ctx.close();
}

/* ================= X: a new message while reading older ones does not yank the view; mark-read waits ================= */
{
  const s = await session(browser, "doc");
  await openMessages(s);
  await openConv(s, "Lina Reception");
  const stream = s.page.locator('[data-testid="stream"]');
  await stream.evaluate((el) => (el.scrollTop = 0));
  await s.page.waitForTimeout(900);
  const top = await stream.evaluate((el) => el.scrollTop);
  const convId = await stream.getAttribute("data-conversation");
  const reads = posts(s, /\/read$/).length;
  await api("rec", "POST", `/conversations/${convId}/messages`, { text: "arrived while reading history" });
  const pill = await waitUntil(async () => (await s.page.locator('[data-testid="new-messages-pill"]').count()) === 1, 12000, 300);
  ok(pill, "X while reading older messages a 'New messages' pill appears");
  const top2 = await stream.evaluate((el) => el.scrollTop);
  ok(Math.abs(top2 - top) < 80, "X the view is NOT forced to the bottom", { top, top2 });
  eq(posts(s, /\/read$/).length, reads, "X the conversation is not marked read while the new message is out of view");
  await s.page.locator('[data-testid="new-messages-pill"]').click();
  await s.page.waitForTimeout(900);
  ok(await stream.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 40), "X the pill jumps to the newest message");
  ok(await waitUntil(async () => posts(s, /\/read$/).length > reads, 6000), "X …and only now is it marked read");
  // near the bottom: new messages follow automatically
  await api("rec", "POST", `/conversations/${convId}/messages`, { text: "follow me down" });
  await s.page.waitForFunction(() => [...document.querySelectorAll('[data-testid="bubble"]')].some((b) => b.textContent.includes("follow me down")), null, { timeout: 12000 });
  // the follow-scroll is a smooth scroll: on a slow machine (software WebGL running) it can start >1 s late, so wait for it instead of guessing
  ok(await waitUntil(() => stream.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight < 40), 8000, 200), "X near the bottom, new messages scroll into view by themselves");
  eq(await s.page.locator('[data-testid="new-messages-pill"]').count(), 0, "X no pill when you are already at the bottom");
  await s.ctx.close();
}

/* ================= T30: the rest of ClinicOS still works ================= */
{
  const s = await session(browser, "owner");
  const paths = ["/dashboard", "/appointments", "/patients", "/invoices", "/expenses", "/reports", "/settings", "/loyalty"];
  for (const p of paths) {
    await s.page.goto(APP + p);
    await s.page.waitForTimeout(1500);
    ok(s.page.url().includes(p.slice(0, 6)), `T30 ${p} still opens`, s.page.url());
  }
  ok(s.log.pageErrors.length === 0, "T30 no uncaught errors while visiting existing pages", s.log.pageErrors);
  await s.page.goto(APP + "/dashboard");
  await s.page.waitForSelector('aside a[href="/messages"]');
  await s.page.waitForSelector('aside a[href="/loyalty"]', { timeout: 15000 }).catch(() => {}); // the sidebar fills in as /subscription arrives
  const items = await s.page.locator("aside a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  for (const h of ["/dashboard", "/appointments", "/patients", "/invoices", "/expenses", "/reports", "/loyalty", "/messages", "/settings"]) ok(items.includes(h), `T30 navigation item ${h} is present`, items);
  const nonBadge = s.log.connect.filter((c) => !/^\/unread-count/.test(c.url));
  ok(nonBadge.length === 0, "T30 pages other than Messages make no Connect request except the badge", nonBadge.map((c) => c.url));
  await s.ctx.close();
  // role matrix is untouched: receptionist / doctor navigation
  const r = await session(browser, "rec");
  await r.page.goto(APP + "/dashboard");
  await r.page.waitForSelector('aside a[href="/messages"]');
  const rItems = await r.page.locator("aside a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  ok(rItems.includes("/messages") && !rItems.includes("/reports") && !rItems.includes("/expenses"), "T30 a receptionist keeps their existing menu (+ Messages)", rItems);
  await r.ctx.close();
}

await browser.close();
process.exit(t.done());
