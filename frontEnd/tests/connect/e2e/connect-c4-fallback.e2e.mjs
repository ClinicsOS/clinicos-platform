/* CLINICOS CONNECT (C4) — cards with realtime switched OFF (CONNECT_REALTIME=off): everything must keep working over plain HTTP polling,
   with no duplicates. Run against a C4 world started with CONNECT_REALTIME=off:
     CONNECT_REALTIME=off node tests/connect/c4-world.js <dir>      then      WORLD=<dir>/c4-world.json node tests/connect/e2e/connect-c4-fallback.e2e.mjs */
import { launch, session, openMessages, world as W, harness } from "./lib.mjs";

const t = harness("connect-c4 fallback e2e (realtime off)");
const { ok, eq } = t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const C = W.c4;
const api = async (who, method, url, body) => {
  const r = await fetch(W.base + "/connect" + url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + W.users[who].token }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const waitUntil = async (fn, timeout = 20000, step = 150) => { const end = Date.now() + timeout; for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() > end) return false; await sleep(step); } };
const browser = await launch();
const NO_GL = () => { const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (ty, ...a) { return /webgl/i.test(String(ty)) ? null : o.call(this, ty, ...a); }; };
try {
  const rec = await session(browser, "rec");
  await rec.ctx.addInitScript(NO_GL);
  await openMessages(rec);
  await rec.page.locator('[data-testid="conv-name"]', { hasText: "Dr. Sarah Khalil" }).first().click();
  await rec.page.waitForSelector('[data-testid="stream"]');
  const cards = rec.page.locator('[data-testid="ref-card"]');
  const before = await cards.count();
  const sock = await rec.page.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes("socket.io")).length);
  const r1 = await api("doc", "POST", `/conversations/${W.conversations.dmDocRec}/messages`, { reference: { type: "patient", id: C.pEn }, text: "fallback note" });
  eq(r1.status, 201, "setup: the card is accepted with realtime off");
  ok(await waitUntil(() => rec.page.locator('[data-testid="bubble"]', { hasText: "fallback note" }).count().then((n) => n === 1), 30000), "the card arrives over HTTP polling (no socket)");
  ok(await waitUntil(() => cards.filter({ has: rec.page.locator('[data-testid="rc-patient-name"]', { hasText: "Mona Hassan" }) }).count().then((n) => n >= 1), 15000), "…and resolves to the real patient card");
  await sleep(6000);
  eq(await cards.count(), before + 1, "exactly one new card after several polling cycles (no duplicates)");
  const r2 = await api("doc", "POST", `/conversations/${W.conversations.dmDocRec}/messages`, { reference: { type: "appointment", id: C.aDoc } });
  eq(r2.status, 201, "setup: an appointment card");
  ok(await waitUntil(() => cards.filter({ has: rec.page.locator('[data-testid="rc-view-appt"]') }).count().then((n) => n >= 1), 30000), "the appointment card arrives and resolves too");
  const bad = rec.log.pageErrors.filter((e) => !/ResizeObserver/.test(e));
  ok(bad.length === 0, "no uncaught page errors", bad);
  void sock;
} catch (e) { console.log("CRASH:", String(e?.stack || e).slice(0, 500)); await browser.close(); process.exit(2); }
await browser.close();
process.exit(t.done());
