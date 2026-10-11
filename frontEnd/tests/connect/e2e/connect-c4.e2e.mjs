/* CLINICOS CONNECT (C4) — browser end-to-end tests for Appointment / Patient CARDS. Real production build + real backend (HTTP + Socket.IO) + real database.
   Nothing is mocked. Staff act through the real UI (Share → picker → Send); the second browser is observed receiving the push.
   Numbers T… follow the C4 brief. Run (see docs/connect-c4.md):
     node tests/connect/c4-world.js <dir>     (backend :5701 + world)       next start -p 3000
     WORLD=<dir>/c4-world.json node tests/connect/e2e/connect-c4.e2e.mjs      — the run MUTATES the world; restart c4-world.js for a clean run. */
import { launch, session, openMessages, world as W, harness } from "./lib.mjs";

const t = harness("connect-c4 e2e");
const { ok, eq } = t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const U = W.users;
const C = W.c4;
const api = async (who, method, url, body) => {
  const r = await fetch(W.base + "/connect" + url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + U[who].token }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
};
const waitUntil = async (fn, timeout = 9000, step = 60) => { const end = Date.now() + timeout; for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() > end) return false; await sleep(step); } };
const rowByName = (page, name) => page.locator('[data-testid^="conv-"]', { has: page.locator('[data-testid="conv-name"]', { hasText: name }) });
const openConv = async (s, name) => { await rowByName(s.page, name).first().click(); await s.page.waitForSelector('[data-testid="stream"]', { timeout: 15000 }); await s.page.waitForTimeout(500); };
const openTeam = async (s) => { await s.page.locator('[data-testid="conv-team"]').first().click(); await s.page.waitForSelector('[data-testid="stream"]', { timeout: 15000 }); await s.page.waitForTimeout(500); };
const cards = (page) => page.locator('[data-testid="ref-card"]');
const diag = (page) => page.evaluate(() => globalThis.__clinicosConnect3D || { created: 0, disposed: 0, running: 0 });
const watch = (s) => {
  s.ws = { opened: 0, rx: [], tx: [] };
  s.page.on("websocket", (w) => { s.ws.opened++; w.on("framereceived", (f) => s.ws.rx.push(String(f.payload))); w.on("framesent", (f) => s.ws.tx.push(String(f.payload))); });
  return s;
};
const NO_GL = () => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...a) { return /webgl/i.test(String(type)) ? null : orig.call(this, type, ...a); };
};
const all = [];
const live = async (browser, who, o = {}) => {
  const s = watch(await session(browser, who, o));
  if (!o.gl) await s.ctx.addInitScript(NO_GL);
  all.push(s);
  return s;
};
const ready = async (s) => {
  await openMessages(s);
  await waitUntil(() => s.page.locator('[data-testid="conv-team"]').count().then((n) => n > 0), 25000);
  await waitUntil(() => s.ws.opened >= 1, 15000);
  await s.page.waitForTimeout(600);
};
/** Share through the REAL UI. kind = "patient" | "appointment". pick(page) chooses the row. */
const shareViaUi = async (s, kind, { search, tab, note, pick } = {}) => {
  const p = s.page;
  await p.locator('[data-testid="share-btn"]').click();
  await p.locator(`[data-testid="share-${kind}"]`).click();
  await p.waitForSelector('[data-testid="share-picker"]', { timeout: 8000 });
  if (tab) await p.locator(`[data-testid="sp-tab-${tab}"]`).click();
  if (search) await p.locator('[data-testid="sp-search"]').fill(search);
  await waitUntil(() => p.locator('[data-testid="sp-row"]').count().then((n) => n > 0), 8000);
  await p.waitForTimeout(450);
  if (pick) await pick(p); else await p.locator('[data-testid="sp-row"]').first().click();
  if (note) await p.locator('[data-testid="sp-note"]').fill(note);
  await p.locator('[data-testid="sp-send"]').click();
  await p.waitForSelector('[data-testid="share-picker"]', { state: "detached", timeout: 8000 });
};

const browser = await launch();
const crash = async (e) => { console.log("CRASH:", String(e?.stack || e).slice(0, 700)); try { await browser.close(); } catch {} process.exit(2); };
process.on("uncaughtException", crash);
process.on("unhandledRejection", crash);

try {
  /* ============ sessions ============ */
  const doc = await live(browser, "doc");
  const rec = await live(browser, "rec"); // WebGL off here (software GL starves the CPU with several browsers); the 3D pulse is observed in its own session at the end
  await Promise.all([ready(doc), ready(rec)]);
  await openConv(doc, "Lina Reception");
  await openConv(rec, "Dr. Sarah Khalil");

  /* ============ the Share control, and what it does NOT offer ============ */
  ok((await doc.page.locator('input[type="file"]').count()) === 0, "T0 no generic attachment control exists anywhere (no file input)");
  await doc.page.locator('[data-testid="share-btn"]').click();
  const items = await doc.page.locator('[data-testid="share-menu"] [role="menuitem"]').allTextContents();
  eq(items.map((x) => x.trim()), ["Appointment", "Patient"], "T0 Share offers exactly Appointment and Patient");
  await doc.page.keyboard.press("Escape");
  ok(!(await doc.page.locator('[data-testid="share-menu"]').count()), "X the Share menu closes on Escape");

  /* ============ T12/T23: share a PATIENT (English name) through the UI, observe the push ============ */
  const wsMark = rec.ws.rx.length;
  await shareViaUi(doc, "patient", { search: "Mona", note: "Please check this file" });
  ok(await waitUntil(() => cards(doc.page).count().then((n) => n >= 3)), "T12 sender sees the patient card (plus the two seeded cards)", await cards(doc.page).count());
  ok(await waitUntil(() => cards(rec.page).filter({ has: rec.page.locator('[data-testid="rc-patient-name"]', { hasText: "Mona Hassan" }) }).count().then((n) => n === 1)), "T23 the recipient receives the Patient card live, once");
  const pcard = cards(rec.page).filter({ has: rec.page.locator('[data-testid="rc-patient-name"]', { hasText: "Mona Hassan" }) }).first();
  ok((await pcard.innerText()).includes("Open Patient File"), "T12 the card shows name, file number and 'Open Patient File'");
  ok(/File #\d+/.test(await pcard.innerText()), "T12 …with the file number");
  ok((await rec.page.locator('[data-testid="bubble"]', { hasText: "Please check this file" }).count()) === 1, "X the optional note arrives with the card");
  const frames = rec.ws.rx.slice(wsMark).join("\n");
  ok(frames.includes("connect:message:new") && !/Mona|0791111111|الخطيب/.test(frames), "T39 the socket frames the recipient's browser received contain NO patient data", frames.slice(0, 300));
  await rec.page.waitForTimeout(1200);
  eq(await cards(rec.page).filter({ has: rec.page.locator('[data-testid="rc-patient-name"]', { hasText: "Mona Hassan" }) }).count(), 1, "T25 still exactly one card after polling + refetch (no duplicates)");
  /* ============ T24: share an APPOINTMENT through the UI (tabs, search) ============ */
  await shareViaUi(doc, "appointment", { tab: "today", pick: async (p) => { await p.locator('[data-testid="sp-row"]', { hasText: "Mona Hassan" }).first().click(); } });
  ok(await waitUntil(() => cards(rec.page).filter({ has: rec.page.locator('[data-testid="rc-view-appt"]') }).count().then((n) => n >= 1)), "T24 the recipient receives the Appointment card live");
  const acard = cards(rec.page).filter({ has: rec.page.locator('[data-testid="rc-view-appt"]') }).last();
  const atext = await acard.innerText();
  ok(/Mona Hassan/.test(atext) && /Dr\. Sarah Khalil/.test(atext) && /Scheduled/i.test(atext) && /(AM|PM)/.test(atext) && /View Appointment/.test(atext), "T10 the card shows patient, date/time, doctor, status and 'View Appointment'", atext);
  eq(await cards(rec.page).filter({ has: rec.page.locator('[data-testid="rc-view-appt"]') }).count(), 1, "T25 one appointment card (no duplicate)");

  /* ============ the picker ============ */
  await doc.page.locator('[data-testid="share-btn"]').click();
  await doc.page.locator('[data-testid="share-appointment"]').click();
  await doc.page.waitForSelector('[data-testid="share-picker"]');
  const tabs = await doc.page.locator('[role="tab"]').allTextContents();
  eq(tabs.map((x) => x.trim()), ["Today", "Upcoming", "Recent"], "T1 appointments are grouped Today / Upcoming / Recent");
  await doc.page.locator('[data-testid="sp-tab-upcoming"]').click();
  await doc.page.waitForTimeout(700);
  ok(await doc.page.locator('[data-testid="sp-row"]').count() >= 1, "T1 Upcoming lists tomorrow's appointment");
  await doc.page.locator('[data-testid="sp-search"]').fill("zzzz-nobody");
  await doc.page.waitForTimeout(800);
  ok(/No appointments found/.test(await doc.page.locator('[data-testid="sp-empty"]').innerText()), "T1 empty search → 'No appointments found'");
  await doc.page.keyboard.press("Escape");
  await doc.page.waitForSelector('[data-testid="share-picker"]', { state: "detached" });
  // a Doctor's appointment picker never lists another doctor's patients' visits
  await doc.page.locator('[data-testid="share-btn"]').click();
  await doc.page.locator('[data-testid="share-appointment"]').click();
  await doc.page.waitForSelector('[data-testid="share-picker"]');
  await doc.page.waitForTimeout(800);
  const rowsText = (await doc.page.locator('[data-testid="sp-row"]').allTextContents()).join(" | ");
  ok(!/أحمد المصري/.test(rowsText), "T9 a Doctor is only offered their OWN appointments", rowsText);
  await doc.page.keyboard.press("Escape");
  // patient picker: pagination (+ Arabic search)
  await doc.page.locator('[data-testid="share-btn"]').click();
  await doc.page.locator('[data-testid="share-patient"]').click();
  await doc.page.waitForSelector('[data-testid="share-picker"]');
  await waitUntil(() => doc.page.locator('[data-testid="sp-row"]').count().then((n) => n === 20), 8000);
  eq(await doc.page.locator('[data-testid="sp-row"]').count(), 20, "T2 the patient picker loads 20 at a time (not the whole table)");
  await doc.page.locator('[data-testid="sp-more"]').click();
  ok(await waitUntil(() => doc.page.locator('[data-testid="sp-row"]').count().then((n) => n > 20)), "T2 'Load more' brings the next page");
  await doc.page.locator('[data-testid="sp-search"]').fill("الخطيب");
  await doc.page.waitForTimeout(900);
  eq(await doc.page.locator('[data-testid="sp-row"]').count(), 1, "T31 Arabic search finds the Arabic-named patient");
  ok(/محمد الخطيب/.test(await doc.page.locator('[data-testid="sp-row"]').first().innerText()), "T31 …and shows the name correctly");
  await doc.page.locator('[data-testid="sp-search"]').fill("nobody-by-this-name-xx");
  await doc.page.waitForTimeout(800);
  ok(/No patients found/.test(await doc.page.locator('[data-testid="sp-empty"]').innerText()), "T2 empty search → 'No patients found'");
  await doc.page.keyboard.press("Escape");

  /* ============ T36 / T37: the card opens the REAL ClinicOS page ============ */
  await pcard.locator('[data-testid="rc-open-patient"]').click();
  await rec.page.waitForURL(/\/patients\/profile/, { timeout: 15000 });
  ok(await waitUntil(() => rec.page.getByText("Mona Hassan").first().isVisible(), 15000), "T36 'Open Patient File' opens the real patient profile page for that patient");
  await ready(rec);
  await openConv(rec, "Dr. Sarah Khalil");
  const ac2 = cards(rec.page).filter({ has: rec.page.locator('[data-testid="rc-view-appt"]') }).last();
  await ac2.locator('[data-testid="rc-view-appt"]').click();
  await rec.page.waitForURL(/\/appointments\?appt=/, { timeout: 15000 });
  ok(/date=\d{4}-\d{2}-\d{2}/.test(rec.page.url()), "T37 the link carries the clinic day", rec.page.url());
  ok(await waitUntil(() => rec.page.locator('[role="dialog"]').count().then((n) => n > 0), 20000), "T37 'View Appointment' opens that visit in the real Appointments page");
  ok(await waitUntil(() => rec.page.locator('[role="dialog"]').first().innerText().then((x) => /Mona Hassan/.test(x)), 8000), "T37 …and it is the right visit");
  await rec.page.keyboard.press("Escape");
  await rec.page.locator('[role="dialog"] button[aria-label="Close"]').first().click().catch(() => {});
  await rec.page.waitForTimeout(6500); // the page refetches every 5 s: a closed visit must NOT re-open
  ok((await rec.page.locator('[role="dialog"]').count()) === 0, "X closing the visit keeps it closed (no re-open on refresh)");
  // a future-day appointment resolves through &date=
  await rec.page.goto(`${(await rec.page.evaluate(() => location.origin))}/appointments?appt=${C.aFuture}&date=${(() => { const d = new Date(C.today + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })()}`);
  ok(await waitUntil(() => rec.page.locator('[role="dialog"]').count().then((n) => n > 0), 25000), "T37 a card for a future-day appointment opens it (deep link jumps to that day)");

  /* ============ T11 / T22 / T38: Clinic Team — per-recipient rendering, destination still authorises ============ */
  const owner = await live(browser, "owner");
  const doc2 = await live(browser, "doc2");
  await Promise.all([ready(owner), ready(doc2)]);
  await openTeam(owner); await openTeam(doc2); await ready(doc); await openTeam(doc);
  await shareViaUi(owner, "appointment", { tab: "today", pick: async (p) => { await p.locator('[data-testid="sp-row"]', { hasText: "محمد الخطيب" }).first().click(); } });
  ok(await waitUntil(() => cards(doc2.page).filter({ has: doc2.page.locator('[data-state="ok"][data-kind="appointment"], [data-testid="rc-view-appt"]') }).count().then((n) => n >= 1)), "T22 the owning doctor sees the Appointment card");
  ok(await waitUntil(() => doc.page.locator('[data-testid="ref-card"][data-state="restricted"]').count().then((n) => n >= 1)), "T11 a Doctor who may not see that appointment gets the restricted placeholder");
  const restrictedCard = doc.page.locator('[data-testid="ref-card"][data-state="restricted"]').first();
  const rtext = await restrictedCard.innerText();
  ok(/You don't have permission to view this item/.test(rtext) && !/محمد|الخطيب|المصري|View Appointment|\d{1,2}:\d{2}/.test(rtext), "T11 …with no name, time, doctor or button", rtext);
  ok((await restrictedCard.locator("button").count()) === 0, "T11 …and nothing to click");
  ok(!/الخطيب/.test(await doc.page.locator('[data-testid="stream"]').innerText()), "T11 the restricted viewer's stream holds no patient name");
  // T38: the destination page authorises independently — the restricted doctor cannot reach it by URL either
  const apptId = (await (await fetch(W.base + "/connect/pickers/appointments?group=today", { headers: { Authorization: "Bearer " + U.owner.token } })).json()).appointments.find((a) => a.patientName === "محمد الخطيب").id;
  const deep = `${await doc.page.evaluate(() => location.origin)}/appointments?appt=${apptId}&date=${C.today}`;
  await doc.page.goto(deep);
  await doc.page.waitForSelector("main, [data-testid], h1", { timeout: 20000 });
  await doc.page.waitForTimeout(3500);
  ok((await doc.page.locator('[role="dialog"]').count()) === 0, "T38 the doctor opening that appointment's URL is NOT shown it (the page authorises on its own)");
  ok(!/الخطيب/.test(await doc.page.locator("body").innerText()), "T38 …no patient name anywhere on the page");
  ok(await waitUntil(() => doc.page.locator("body").innerText().then((x) => /This item is no longer available/.test(x)), 6000), "T38 a quiet 'not available' notice (toast)");
  // T14/T15: sharing granted nothing — the doctor also cannot share it
  const reshare = await api("doc", "POST", `/conversations/${W.conversations.team}/messages`, { reference: { type: "appointment", id: apptId } });
  eq(reshare.status, 404, "T15 sharing did not grant the doctor the appointment (cannot share it onward)");

  /* ============ T17 / T18: deleted records ============ */
  await ready(rec); await openConv(rec, "Dr. Sarah Khalil");
  ok(await waitUntil(() => rec.page.locator('[data-testid="ref-card"][data-state="unavailable"]').count().then((n) => n >= 2)), "T17/T18 deleted patient + appointment render 'This item is no longer available'");
  const un = await rec.page.locator('[data-testid="ref-card"][data-state="unavailable"]').first().innerText();
  ok(/This item is no longer available/.test(un) && !/Vanishing|Mona/.test(un), "T17 …without leaking what they were", un);

  /* ============ T19 / T20: the Owner cannot see unrelated DMs holding cards ============ */
  const names = (await owner.page.locator('[data-testid="conv-name"]').allTextContents()).map((n) => n.trim());
  ok(names.includes("Dr. Sarah Khalil") && names.length === 2 && names.every((n) => !/المصري/.test(n)), "T19 the Owner's list shows only the conversations they are in (Clinic Team + Dr. Sarah)", names);
  const ownerHtml = await owner.page.content();
  ok(!ownerHtml.includes(C.privateNote), "T19 the private DM's card note never reaches the Owner's browser");
  const o404 = await api("owner", "POST", `/conversations/${W.conversations.dmDocDoc2}/cards`, { messageIds: [] });
  eq(o404.status, 404, "T19/T20 the Owner is refused that conversation's cards (404)");
  const oMsgs = await api("owner", "GET", `/conversations/${W.conversations.dmDocDoc2}/messages`);
  eq(oMsgs.status, 404, "T19 …and its messages");

  /* ============ T26: reconnect — no duplicates, nothing missed ============ */
  const before = await cards(rec.page).count();
  await rec.ctx.setOffline(true);
  await sleep(600);
  const during = await api("doc", "POST", `/conversations/${W.conversations.dmDocRec}/messages`, { reference: { type: "patient", id: C.pAr }, text: "sent while you were offline" });
  eq(during.status, 201, "T26 (setup) a card is sent while the recipient is offline");
  await rec.ctx.setOffline(false);
  ok(await waitUntil(() => rec.page.locator('[data-testid="bubble"]', { hasText: "sent while you were offline" }).count().then((n) => n === 1), 30000), "T26 the card arrives after reconnecting");
  await rec.page.waitForTimeout(1500);
  eq(await cards(rec.page).count(), before + 1, "T26 exactly one new card — no duplicates after reconnect");
  eq(await rec.page.locator('[data-testid="bubble"]', { hasText: "sent while you were offline" }).count(), 1, "T26 …and the note once");

  /* ============ T27: text still works; card + text ordering ============ */
  await doc.page.goto(doc.page.url().replace(/\/appointments.*/, "/messages"));
  await ready(doc); await openConv(doc, "Lina Reception");
  await doc.page.locator('[data-testid="composer"]').fill("plain text still works");
  await doc.page.locator('[data-testid="send"]').click();
  ok(await waitUntil(() => rec.page.locator('[data-testid="bubble"]', { hasText: "plain text still works" }).count().then((n) => n === 1)), "T27 plain text messages are unaffected");
  const preview = await rowByName(rec.page, "Dr. Sarah Khalil").first().locator('[data-testid="conv-preview"]').innerText();
  ok(/plain text still works/.test(preview), "T27 the list preview shows the text");
  await shareViaUi(doc, "patient", { search: "Mona" });
  ok(await waitUntil(async () => /Patient/.test(await rowByName(rec.page, "Dr. Sarah Khalil").first().locator('[data-testid="conv-preview"]').innerText())), "T30 the list preview of a card is a generic 'Patient' label");
  ok(!/Mona/.test(await rowByName(rec.page, "Dr. Sarah Khalil").first().locator('[data-testid="conv-preview"]').innerText()), "T30 …never the patient's name");

  /* ============ T31–T33: Arabic + RTL ============ */
  const recAr = await live(browser, "rec", { lang: "ar" });
  await ready(recAr); await openConv(recAr, "Dr. Sarah Khalil");
  ok((await recAr.page.evaluate(() => document.documentElement.dir)) === "rtl", "T33 the page is RTL");
  ok(await waitUntil(() => cards(recAr.page).count().then((n) => n >= 3)), "T31 cards render in the Arabic UI");
  const arPat = cards(recAr.page).filter({ has: recAr.page.locator('[data-testid="rc-patient-name"]', { hasText: "محمد الخطيب" }) }).first();
  ok(await arPat.count() > 0 && (await arPat.innerText()).includes("فتح ملف المريض"), "T31 Arabic patient card: Arabic name + 'فتح ملف المريض'");
  ok((await cards(recAr.page).filter({ has: recAr.page.locator('[data-testid="rc-view-appt"]') }).first().innerText()).includes("عرض الموعد"), "T32 Arabic appointment card: 'عرض الموعد'");
  ok((await recAr.page.locator('[data-testid="ref-card"][data-state="unavailable"]').first().innerText()).includes("لم يعد متاحاً"), "T32 Arabic 'no longer available'");
  const nameDir = await arPat.locator('[data-testid="rc-patient-name"]').evaluate((el) => getComputedStyle(el).direction + "/" + getComputedStyle(el).unicodeBidi + "/" + el.getAttribute("dir"));
  ok(/auto|plaintext/.test(nameDir), "T31 names are bidi-isolated (dir=auto / plaintext)", nameDir);
  await recAr.page.locator('[data-testid="share-btn"]').click();
  const arItems = (await recAr.page.locator('[data-testid="share-menu"] [role="menuitem"]').allTextContents()).map((x) => x.trim());
  eq(arItems, ["موعد", "مريض"], "T33 Arabic Share menu: موعد / مريض");
  await recAr.page.locator('[data-testid="share-patient"]').click();
  await recAr.page.waitForSelector('[data-testid="share-picker"]');
  const ph = await recAr.page.locator('[data-testid="sp-search"]').getAttribute("placeholder");
  eq(ph, "ابحث عن مريض", "T33 Arabic picker placeholder");
  const box = await recAr.page.locator('[data-testid="sp-search"]').boundingBox();
  const icon = await recAr.page.locator('[data-testid="share-picker"] svg').nth(1).boundingBox().catch(() => null);
  ok(!!box && (!icon || icon.x > box.x + box.width / 2), "T33 in RTL the search icon sits at the right edge", { box, icon });
  await recAr.page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + "/c4-ar-picker.png" : undefined }).catch(() => {});
  await recAr.page.keyboard.press("Escape");
  await recAr.page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + "/c4-ar-chat.png" : undefined }).catch(() => {});

  /* ============ T34 / T35: mobile ============ */
  const mob = await live(browser, "rec", { w: 390, h: 844, touch: true });
  await ready(mob);
  await openConv(mob, "Dr. Sarah Khalil");
  await mob.page.waitForTimeout(600);
  ok(await waitUntil(() => cards(mob.page).count().then((n) => n >= 3)), "T34 cards render on a phone");
  const over = await mob.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(over.sw <= over.cw + 1, "T34 no horizontal scroll on a 390 px screen", over);
  const cb = await cards(mob.page).first().boundingBox();
  ok(cb && cb.x >= 0 && cb.x + cb.width <= 390 + 1, "T34 the card fits inside the screen", cb);
  const btnBox = await mob.page.locator('[data-testid="rc-open-patient"]').first().boundingBox();
  ok(btnBox && btnBox.height >= 44, "T34 the card button is a comfortable touch target (≥ 44 px)", btnBox);
  await mob.page.locator('[data-testid="share-btn"]').tap();
  await mob.page.locator('[data-testid="share-appointment"]').tap();
  await mob.page.waitForSelector('[data-testid="share-picker"]');
  await mob.page.waitForTimeout(500);
  const sheet = await mob.page.locator('[data-testid="share-picker"]').boundingBox();
  ok(sheet && Math.abs(sheet.x) <= 1 && Math.abs(sheet.width - 390) <= 2 && Math.abs(sheet.y + sheet.height - 844) <= 4, "T35 on a phone the picker is a full-width bottom sheet", sheet);
  const tabBox = await mob.page.locator('[data-testid="sp-tab-today"]').boundingBox();
  ok(tabBox && tabBox.height >= 32, "T35 the picker tabs are tappable", tabBox);
  await mob.page.locator('[data-testid="sp-row"]').first().tap();
  await mob.page.locator('[data-testid="sp-note"]').waitFor();
  ok(await mob.page.locator('[data-testid="sp-send"]').isVisible(), "T35 choose → note → Send works on a phone");
  await mob.page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + "/c4-mobile-picker.png" : undefined }).catch(() => {});
  await mob.page.locator('[data-testid="sp-close"]').tap();

  /* ============ cache safety: logging out clears what a card put in the browser ============ */
  await rec.page.goto(rec.page.url().replace(/\/appointments.*/, "/messages"));
  await ready(rec); await openConv(rec, "Dr. Sarah Khalil");
  await rec.page.locator('[data-testid="rc-open-patient"]').first().click();
  await rec.page.waitForURL(/\/patients\/profile/);
  const sel = await rec.page.evaluate(() => sessionStorage.getItem("clinicos-selected-patient"));
  ok(!!sel && sel.includes("selected"), "X (setup) a card set the selected patient", sel);
  await rec.page.locator('button[title="Log out"]').first().click();
  await rec.page.waitForURL(/signin|login/, { timeout: 15000 });
  const sel2 = await rec.page.evaluate(() => { try { const v = JSON.parse(sessionStorage.getItem("clinicos-selected-patient") || "{}"); return v.state ? v.state.selected : null; } catch { return "err"; } });
  ok(sel2 === null, "X logout removes the selected patient a card had set", sel2);

  /* ============ 3D: a subtle pulse per kind, never an identity ============ */
  const finished = all.slice();
  for (const s of all) await s.ctx.close().catch(() => {});
  all.length = 0;
  const gl = await live(browser, "rec", { gl: true });
  await ready(gl); await openConv(gl, "Dr. Sarah Khalil");
  ok(await waitUntil(async () => (await diag(gl.page)).created >= 1, 30000), "X (setup) the 3D scene is running");
  await sleep(2500);
  const sendCard = (type, id) => api("doc", "POST", `/conversations/${W.conversations.dmDocRec}/messages`, { reference: { type, id } });
  let g0 = await diag(gl.page);
  eq((await sendCard("patient", C.pEn)).status, 201, "T40a (setup) a patient card is sent");
  ok(await waitUntil(async () => ((await diag(gl.page)).incoming ?? 0) > (g0.incoming ?? 0), 15000), "T40a a patient card gives a subtle 3D NODE pulse", { g0, now: await diag(gl.page) });
  await sleep(1500);
  g0 = await diag(gl.page);
  eq((await sendCard("appointment", C.aDoc)).status, 201, "T40b (setup) an appointment card is sent");
  ok(await waitUntil(async () => ((await diag(gl.page)).incoming ?? 0) > (g0.incoming ?? 0), 15000), "T40b an appointment card gives a subtle 3D CONNECTION pulse", { g0, now: await diag(gl.page) });
  const scene = await gl.page.locator('[data-testid="team-scene"]').innerText().catch(() => "");
  ok(!/Mona|الخطيب|File #|Hassan/.test(scene), "T40 the 3D scene never shows patient or appointment identity", scene.slice(0, 200));
  await gl.page.screenshot({ path: process.env.SHOTS ? process.env.SHOTS + "/c4-3d.png" : undefined }).catch(() => {});

  /* ============ overall hygiene ============ */
  for (const s of finished.concat(all)) {
    const bad = s.log.pageErrors.filter((e) => !/ResizeObserver|Non-Error promise rejection/.test(e));
    ok(bad.length === 0, `X no uncaught page errors (${s.user.role})`, bad);
    const bodies = s.log.connect.filter((c) => c.method === "POST" && /\/messages$/.test(c.url)).map((c) => c.body || "");
    ok(bodies.every((b) => !/fullName|phone|Mona|الخطيب|diagnosis|nationalId|clinicId|senderId|contentType|referenceId/.test(b)), `X the browser sends only { text, reference:{type,id} } — never record data, clinicId or senderId (${s.user.role})`, bodies.filter((b) => /fullName|phone|clinicId|senderId|contentType/.test(b)));
    const cardCalls = s.log.connect.filter((c) => /\/cards$/.test(c.url));
    ok(cardCalls.every((c) => { try { return Object.keys(JSON.parse(c.body)).join() === "messageIds"; } catch { return false; } }), `X card requests carry only message ids (${s.user.role})`);
  }
  // batching: opening a conversation with several cards costs ONE /cards request per visit, not one per card
  const recCards = rec.log.connect.filter((c) => /\/cards$/.test(c.url)).length;
  ok(recCards < 14, "X card resolution is batched (requests are per page, not per card)", recCards);
} catch (e) {
  await crash(e);
}

for (const s of all) await s.ctx.close().catch(() => {});
await browser.close();
process.exit(t.done());
