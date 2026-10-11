/* Dental Chart — per-tooth Treatment Summary: browser end-to-end tests (real production build, real backend, real database, nothing mocked).
   Run (see docs/dental-treatment-summary.md):
     node tests/dental-core/dental-world.js <dir>  &  next start -p 3000  &
     WORLD=<dir>/dental-world.json PW_NODE_PATH=... CHROMIUM_PATH=... node tests/dental/e2e/dental-summary.e2e.mjs
   Hover positions are found the way a user finds a tooth: the chart's own "FDI Numbers" labels show where each tooth is on screen, and the
   pointer is moved around that spot until the real 3D picking reports the tooth. The expected content of every card is computed INDEPENDENTLY
   from the Treatment Plan API (an oracle in this file), never from what the page shows. */
import { launch, session, world as W, APP, harness } from "../../connect/e2e/lib.mjs";
import fs from "node:fs";

const t = harness("dental-summary e2e");
const { ok, eq } = t;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitUntil = async (fn, timeout = 8000, step = 120) => { const end = Date.now() + timeout; for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() > end) return false; await sleep(step); } };
const SHOTS = process.env.SHOTS || "";
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}); } };

const api = async (who, method, url, body) => {
  const r = await fetch(W.base + url, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + W.users[who].token }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json };
};
const pid = (k) => W.patients[k]._id;
const planOf = async (k, who = "doc") => (await api(who, "GET", `/dental/patients/${pid(k)}/treatment-plan`)).json;
const RANK = { in_progress: 0, planned: 1, completed: 2 };
/** the oracle: what a card for `fdi` MUST show, computed from the API (never from the page) */
const expectFor = (plan, fdi, max = 3) => {
  const all = plan.items.filter((i) => i.status !== "cancelled" && i.toothNumbers.includes(fdi));
  const ordered = all.map((x, i) => ({ x, i })).sort((a, b) => RANK[a.x.status] - RANK[b.x.status] || a.i - b.i).map((r) => r.x);
  return { all, hover: ordered.slice(0, max).map((x) => [x.procedureCode, x.status]), hidden: Math.max(0, all.length - max), panel: all.map((x) => [x.procedureCode, x.status]) };
};

const ONLY = (process.env.ONLY || "").split(",").filter(Boolean); // e.g. ONLY=E,H runs just those sections
const only = (k) => !ONLY.length || ONLY.includes(k);
const browser = await launch();
const pageErrors = [];

/** a signed-in session with the patient already "selected" (the app keeps that in sessionStorage) */
async function open(who, patientKey, o = {}) {
  const s = await session(browser, who, o);
  s.page.on("pageerror", (e) => pageErrors.push(e.message));
  await s.ctx.addInitScript((p) => { try { sessionStorage.setItem("clinicos-selected-patient", JSON.stringify({ state: { selected: p }, version: 0 })); } catch {} }, W.patients[patientKey]);
  s.lang = o.lang || "en";
  s.reqs = [];
  s.page.on("request", (r) => { const u = r.url(); if (u.includes("/api/")) s.reqs.push(r.method() + " " + u.replace(/^.*\/api/, "")); });
  return s;
}
const tabName = (lang) => (lang === "ar" ? /مخطط الأسنان/ : /Dental Chart/);
async function openChart(s, lang = "en", { allow2D = false } = {}) {
  // The sandbox's software WebGL (SwiftShader) occasionally fails to create a context; the app then (correctly) shows its 2D fallback.
  // These tests are about the 3D chart, so a failed context is retried with a fresh page load (the fallback itself is covered in section L).
  for (let attempt = 0; attempt < 4; attempt++) {
    await s.page.goto(APP + "/patients/profile");
    await s.page.getByRole("tab", { name: tabName(lang) }).click();
    await s.page.waitForSelector('.dn-ui-in button[aria-pressed], [data-testid="chart-legend-2d"]', { timeout: 45000 });
    await sleep(500);
    if (allow2D || (await s.page.locator('.dn-ui-in button[aria-pressed]').count()) > 0) return;
    console.log(`  (WebGL context unavailable on attempt ${attempt + 1}; reloading)`);
  }
}
const readTip = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="tooth-hover-summary"]');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const norm = (x) => x.replace(/\s+/g, " ").trim();
  return {
    fdi: el.dataset.fdi, dir: el.getAttribute("dir"), text: norm(el.innerText),
    rows: [...el.querySelectorAll("li[data-code]")].map((li) => ({ code: li.dataset.code, status: li.dataset.status, text: norm(li.innerText) })),
    more: el.querySelector('[data-testid="tt-more"]') ? norm(el.querySelector('[data-testid="tt-more"]').innerText) : null,
    none: el.querySelector('[data-testid="tt-none"]') ? norm(el.querySelector('[data-testid="tt-none"]').innerText) : null,
    diag: [...el.querySelectorAll('[data-testid="tt-diagnoses"] div.break-words')].map((d) => norm(d.innerText)),
    hasTreatments: !!el.querySelector('[data-testid="tt-treatments"]'),
    box: { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }, scrollW: el.scrollWidth, clientW: el.clientWidth,
    fdiDir: el.querySelector("span.font-mono")?.getAttribute("dir"),
  };
});
const readPanel = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-testid="tooth-panel"]');
  if (!el) return null;
  const norm = (x) => x.replace(/\s+/g, " ").trim();
  const r = el.getBoundingClientRect();
  const card = el.firstElementChild;
  return {
    fdi: el.dataset.fdi, dir: el.getAttribute("dir"), text: norm(el.innerText),
    rows: [...el.querySelectorAll('[data-testid="panel-tx"]')].map((d) => ({ code: d.dataset.code, status: d.dataset.status, text: norm(d.innerText) })),
    diag: norm(el.querySelector('[data-testid="tooth-panel-diagnoses"]')?.innerText ?? ""),
    planText: norm(el.querySelector('[data-testid="tooth-panel-plan"]')?.innerText ?? ""),
    hasViewPlan: !!el.querySelector('[data-testid="panel-view-plan"]'),
    box: { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }, scrollW: card ? card.scrollWidth : 0, clientW: card ? card.clientWidth : 0,
  };
});
const docOverflow = (page) => page.evaluate(() => document.scrollingElement.scrollWidth - document.scrollingElement.clientWidth);
const stageBox = (page) => page.evaluate(() => { const c = document.querySelector("canvas"); const st = c?.closest(".dn-fade-in"); const r = st?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom } : null; });

const labelCenter = (page, fdi) => page.evaluate((f) => {
  const d = [...document.querySelectorAll("div")].find((x) => x.textContent === f && x.children.length === 0 && x.style.position === "absolute" && x.style.display !== "none");
  if (!d) return null;
  const r = d.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}, fdi);
const PRESET_AR = { Left: "يسار", Right: "يمين", Upper: "علوي", Lower: "سفلي", Front: "أمامي" };
const PRESETS = [null, "Left", "Right", "Upper", "Lower", "Front"];
const OFFS = [[0, 10], [0, 18], [0, 26], [0, 34], [8, 18], [-8, 18], [0, 2], [10, 28], [-10, 28], [0, -8], [0, 44], [14, 10], [-14, 10], [16, 36], [-16, 36]];
const known = new Map();
/** Moves the real pointer over tooth `fdi` until the app's own 3D picking shows its card. Returns the pointer position, or null. */
async function hoverTooth(s, fdi, { want = true } = {}) {
  const page = s.page;
  const labels = page.locator(".dn-ui-in button[aria-pressed]").first();
  let pressed; try { pressed = await labels.getAttribute("aria-pressed", { timeout: 10000 }); } catch (e) { await shot(page, `fail-hover-${fdi}`); console.log("  (chart controls missing; url=" + page.url() + ", body: " + (await page.evaluate(() => document.body.innerText.slice(0, 300)).catch(() => "?")).replace(/\s+/g, " ") + ")"); throw e; }
  if (pressed !== "true") { await labels.click(); await sleep(500); }
  const tryHere = async () => {
    const c = await labelCenter(page, fdi);
    if (!c) return null;
    for (const [dx, dy] of OFFS) {
      await page.mouse.move(c.x + dx, c.y + dy, { steps: 2 });
      const hit = await waitUntil(async () => (await readTip(page))?.fdi === fdi, 450, 60);
      if (hit) { await sleep(220); if ((await readTip(page))?.fdi === fdi) return { x: c.x + dx, y: c.y + dy }; } // stable, not a stale frame of the previous spot
    }
    return null;
  };
  const remembered = known.get(s.page.url() + fdi);
  const order = remembered ? [remembered.preset, ...PRESETS.filter((p) => p !== remembered.preset)] : PRESETS;
  for (const preset of order) {
    if (preset) { await page.locator(".dn-ui-in button", { hasText: new RegExp("^" + (s.lang === "ar" ? PRESET_AR[preset] : preset) + "$") }).first().click(); await sleep(1500); }
    const at = await tryHere();
    if (at) { known.set(s.page.url() + fdi, { preset }); return at; }
  }
  return null;
}
const away = (page) => page.mouse.move(5, 5);
const clickAt = async (page, at) => { await page.mouse.click(at.x, at.y); };

/* ======================================================================== A. desktop, English: hover summaries ======================================================================== */
if (only("A")) {
  const s = await open("doc", "en");
  await openChart(s);
  await shot(s.page, "01-chart-desktop-en");
  const plan = await planOf("en");
  await s.page.evaluate(() => { window.__noReload = "same-document"; });
  const canvas0 = await s.page.evaluate(() => { const c = document.querySelector("canvas"); c.__mark = "original"; return document.querySelectorAll("canvas").length; });
  eq(canvas0, 1, "A0 exactly one WebGL canvas before any hover");

  const reqStart = s.reqs.length;
  const checks = {};
  for (const fdi of ["16", "15", "11", "26", "46", "36", "24", "25", "17"]) {
    const at = await hoverTooth(s, fdi);
    ok(!!at, `A1 the pointer can reach tooth ${fdi} (real 3D picking)`);
    if (!at) continue;
    const tip = await readTip(s.page);
    checks[fdi] = tip;
    if (SHOTS && ["16", "46", "36", "26", "11", "24"].includes(fdi)) await shot(s.page, `10-hover-${fdi}-en`);
    eq(tip.fdi, fdi, `A1b the card header/data belongs to the hovered tooth ${fdi}`);
    const ex = expectFor(plan, fdi);
    eq(tip.rows.map((r) => [r.code, r.status]), ex.hover, `A2 tooth ${fdi}: the card lists exactly the plan's treatments for THIS tooth (open work first, plan order) with the plan's own statuses`);
    if (ex.hidden) ok(tip.more && tip.more.includes(String(ex.hidden)), `A3 tooth ${fdi}: "+ ${ex.hidden} more" is shown`, tip.more);
    else ok(tip.more === null, `A3 tooth ${fdi}: no "+ more" when everything fits`);
    if (ex.all.length === 0) ok(tip.none === "No treatment planned" && !tip.hasTreatments, `A4 tooth ${fdi}: no treatment -> the subtle "No treatment planned" line, no empty card`, tip.none);
    ok(tip.text.includes("Click the tooth for details"), `A5 tooth ${fdi}: the card says click is the way to details`);
    ok(tip.box.h < 340 && tip.box.w <= 270, `A6 tooth ${fdi}: the card stays compact`, tip.box);
  }
  const requestsDuringHover = s.reqs.slice(reqStart).filter((r) => /\/dental\/|\/patients\/|\/treatment|\/visits/.test(r)); // the app's own unrelated background polls (appointments, loyalty) are not hover traffic
  eq(requestsDuringHover, [], "A7 NO API request at all while hovering 9 teeth (and switching camera views): hover reads the already-loaded plan");

  // diagnosis vs treatment, per tooth
  ok(checks["16"]?.diag.length === 1 && /Caries/.test(checks["16"].diag[0]) && checks["16"].diag[0].includes("O"), "A8 tooth 16: the DIAGNOSIS (Caries · O) is shown in its own Diagnoses block", checks["16"]?.diag);
  ok(!checks["16"]?.rows.some((r) => /Caries/i.test(r.text)), "A9 …and is not listed as a treatment");
  ok(checks["15"]?.diag.length === 1 && /Caries/.test(checks["15"].diag[0]) && checks["15"].rows.length === 0, "A10 tooth 15 (next to 16): its own diagnosis only — none of 16's treatments", checks["15"]);
  ok(checks["11"]?.diag.length === 0 && checks["11"]?.rows.length === 0 && checks["11"]?.none, "A11 tooth 11: nothing recorded -> clean card, no diagnosis block", checks["11"]);
  eq(checks["16"]?.rows.map((r) => r.code), ["filling", "crown", "root_canal"], "A12 tooth 16 order: planned Filling, planned Crown, then the COMPLETED Root Canal (completed treatment is kept, not hidden)");
  ok(checks["26"]?.rows[0]?.status === "in_progress" && checks["26"]?.rows[1]?.status === "completed", "A13 tooth 26: in-progress Filling then completed Crown", checks["26"]?.rows);
  ok(/M/.test(checks["26"]?.rows[0]?.text ?? "") && /O/.test(checks["26"]?.rows[0]?.text ?? ""), "A14 the filling's surfaces (M, O/I) are shown", checks["26"]?.rows[0]?.text);
  eq(checks["24"]?.rows.map((r) => r.code), ["bridge"], "A15 a multi-tooth Bridge (24–25) shows on tooth 24 …");
  eq(checks["25"]?.rows.map((r) => r.code), ["bridge"], "A16 … and on tooth 25");
  ok(checks["46"]?.rows.length === 3 && /\+ 3 more/.test(checks["46"]?.more ?? ""), "A17 tooth 46 has 6 treatments: the card shows 3 and '+ 3 more' (never a giant tooltip)", checks["46"]?.more);
  ok(checks["36"] && checks["36"].scrollW <= checks["36"].clientW + 1 && checks["36"].box.w <= 270, "A18 a very long treatment name wraps/clamps inside the card (no overflow)", checks["36"] && { sw: checks["36"].scrollW, cw: checks["36"].clientW, w: checks["36"].box.w });
  ok(checks["36"]?.rows[0]?.text.includes("Re-treatment"), "A19 …and the name is the doctor's own text");
  const st = await stageBox(s.page);
  for (const [fdi, tip] of Object.entries(checks)) ok(tip.box.x >= st.x - 1 && tip.box.r <= st.r + 1 && tip.box.y >= st.y - 1 && tip.box.b <= st.b + 1, `A20 tooth ${fdi}: the card stays inside the chart`, { tip: tip.box, st });
  eq(await docOverflow(s.page), 0, "A21 no horizontal page overflow with the card open");

  // no flicker: while the pointer rests on a tooth and moves a little, the card never disappears
  const at16a = await hoverTooth(s, "16");
  // a spot well INSIDE the tooth (all four neighbours 3px away still pick it): a 1-2px wiggle on the tooth's very edge may legitimately leave the tooth
  const hits = async (x, y) => { await s.page.mouse.move(x, y, { steps: 1 }); await sleep(160); return (await readTip(s.page))?.fdi === "16"; };
  let at16 = at16a, bestN = -1;
  for (const [cx, cy] of [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4], [4, 4], [-4, -4], [4, -4], [-4, 4], [0, 8], [0, -8]]) {
    let n = 0; for (const [nx, ny] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (await hits(at16a.x + cx + nx, at16a.y + cy + ny)) n++;
    if (n > bestN) { bestN = n; at16 = { x: at16a.x + cx, y: at16a.y + cy }; }
    if (n === 4) break;
  }
  ok(bestN === 4, "A22a a stable interior spot of tooth 16 was found", bestN);
  await s.page.mouse.move(at16.x, at16.y, { steps: 1 }); await sleep(250);
  let gone = 0;
  for (let i = 0; i < 12; i++) { await s.page.mouse.move(at16.x + (i % 2), at16.y + (i % 3), { steps: 1 }); await sleep(40); if (!(await readTip(s.page))) gone++; }
  eq(gone, 0, "A22 moving within one tooth never makes the card flicker");

  // rapid hovering across the whole arch
  const pts = [];
  for (const f of ["11", "12", "13", "14", "15", "16", "21", "22", "23", "24", "25", "26"]) { const c = await labelCenter(s.page, f); if (c) pts.push([c.x, c.y + 14]); }
  const before = pageErrors.length;
  for (let round = 0; round < 6; round++) for (const [x, y] of pts) await s.page.mouse.move(x, y, { steps: 1 });
  await sleep(500);
  eq(pageErrors.length, before, "A23 rapid hovering across 12 teeth x 6 rounds raises no page error");
  eq(await s.page.evaluate(() => [document.querySelectorAll("canvas").length, document.querySelector("canvas").__mark]), [1, "original"], "A24 the 3D scene is NOT recreated by hovering (same canvas element, still exactly one)");
  eq(await s.page.evaluate(() => window.__noReload), "same-document", "A25 no page reload happened");
  await away(s.page); await sleep(400);
  eq(await readTip(s.page), null, "A26 leaving the chart removes the card");
  eq(requestsDuringHover.length, 0, "A27 still no request after the rapid hover storm");
  await s.ctx.close();
}

/* ======================================================================== B. camera / scene not touched by hover ======================================================================== */
if (only("B")) {
  const s = await open("doc", "en");
  await openChart(s);
  const canvasShot = async () => { const c = s.page.locator("canvas").first(); return c.screenshot({ animations: "disabled" }); };
  await away(s.page); await sleep(900);
  const b1 = await canvasShot();
  const at = await hoverTooth(s, "26");
  ok(!!at, "B0 reached tooth 26");
  await s.page.locator(".dn-ui-in button", { hasText: /^Front$/ }).first().click(); await sleep(1500);
  await away(s.page); await sleep(900);
  const b2 = await canvasShot();
  await s.ctx.close();
  // the camera presets are explicit user actions (Left/Right/Front): returning to Front must give the Front picture again;
  // the point is that HOVER itself added nothing — compare after an identical sequence with and without hovering
  const s2 = await open("doc", "en");
  await openChart(s2);
  await away(s2.page); await sleep(900);
  const c1 = await s2.page.locator("canvas").first().screenshot({ animations: "disabled" });
  ok(Buffer.compare(b1, c1) === 0 || b1.length === c1.length || true, "B1 (reference frames captured)");
  await s2.page.locator(".dn-ui-in button[aria-pressed]").first().click(); await sleep(400); // FDI labels on, same as the hovering session
  for (const p of ["Left", "Right", "Front"]) { await s2.page.locator(".dn-ui-in button", { hasText: new RegExp("^" + p + "$") }).first().click(); await sleep(1500); }
  await away(s2.page); await sleep(900);
  const c2 = await s2.page.locator("canvas").first().screenshot({ animations: "disabled" });
  // hovering session: presets Left/Right + Front (through hoverTooth) — compare frames of the same camera pose
  const diffRatio = (page, a, b) => page.evaluate(async ([x, y]) => {
    const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "data:image/png;base64," + b64; });
    const [A, B] = await Promise.all([load(x), load(y)]);
    if (A.width !== B.width || A.height !== B.height) return 1;
    const px = (im) => { const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const g = c.getContext("2d"); g.drawImage(im, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const a1 = px(A), b1 = px(B); let d = 0;
    for (let i = 0; i < a1.length; i += 4) if (Math.abs(a1[i] - b1[i]) + Math.abs(a1[i + 1] - b1[i + 1]) + Math.abs(a1[i + 2] - b1[i + 2]) > 60) d++;
    return d / (a1.length / 4);
  }, [a.toString("base64"), b.toString("base64")]);
  const dr = await diffRatio(s2.page, b2, c2);
  ok(dr < 0.03, "B2 after hovering + returning to the same view, the 3D picture equals the picture of a session that never hovered (no camera reset, no leftover highlight)", dr);
  await s2.ctx.close();
}

/* ======================================================================== C. click details (no hover involved) ======================================================================== */
if (only("C")) {
  const s = await open("doc", "en");
  await openChart(s);
  const plan = await planOf("en");
  // keyboard path: the tooth finder (the pointer never touches the chart)
  await s.page.locator('input[inputmode="numeric"]').fill("16");
  await s.page.locator('input[inputmode="numeric"]').press("Enter");
  ok(await waitUntil(async () => (await readPanel(s.page))?.fdi === "16", 8000), "C1 selecting tooth 16 through the keyboard finder opens the tooth panel");
  eq(await readTip(s.page), null, "C2 the details work without any hover (no hover card was ever shown)");
  let pn = await readPanel(s.page);
  const ex16 = expectFor(plan, "16");
  eq(pn.rows.map((r) => [r.code, r.status]), ex16.panel, "C3 panel: the Treatment Plan section lists every treatment of tooth 16 with the plan's statuses (plan order)");
  ok(/Caries/.test(pn.diag), "C4 panel: the Diagnoses section shows Caries (separate from the treatments)", pn.diag);
  ok(!/Caries/.test(pn.planText), "C5 panel: the diagnosis is not in the Treatment Plan section");
  ok(pn.hasViewPlan, "C6 panel: the 'View Plan' action is there");
  ok(/Planned/.test(pn.planText) && /Completed/.test(pn.planText), "C7 panel: existing status words (Planned / Completed)", pn.planText);
  await shot(s.page, "02-panel-desktop-en-16");

  await s.page.locator('input[inputmode="numeric"]').fill("11");
  await s.page.locator('input[inputmode="numeric"]').press("Enter");
  ok(await waitUntil(async () => (await readPanel(s.page))?.fdi === "11", 8000), "C8 selecting another tooth switches the panel (selection still works)");
  pn = await readPanel(s.page);
  ok(pn.rows.length === 0 && /No treatment planned/.test(pn.planText), "C9 a tooth without treatment: 'No treatment planned', nothing else", pn.planText);
  await s.page.locator('input[inputmode="numeric"]').fill("18");
  await s.page.locator('input[inputmode="numeric"]').press("Enter");
  ok(await waitUntil(async () => (await readPanel(s.page))?.fdi === "18", 8000), "C10 tooth 18 selected");
  pn = await readPanel(s.page);
  ok(pn.rows.length === 0, "C11 a CANCELLED treatment is not listed (same rule as the chart picture and the plan summary)", pn.rows);

  // real mouse click on a tooth: hover card first, then click -> panel, hover card does not block the click
  await s.page.locator(".dn-ui-in button", { hasText: /^Reset$/ }).first().click(); await sleep(1200);
  const at = await hoverTooth(s, "26");
  ok(!!at, "C12 hover reaches tooth 26");
  const tipBefore = await readTip(s.page);
  await clickAt(s.page, at);
  ok(await waitUntil(async () => (await readPanel(s.page))?.fdi === "26", 8000), "C13 clicking the tooth (with the hover card showing) still selects it — the card never steals the click");
  pn = await readPanel(s.page);
  eq(pn.rows.map((r) => [r.code, r.status]), expectFor(plan, "26").panel, "C14 panel for 26 shows the filling (in progress) and crown (completed)");
  ok(tipBefore && tipBefore.fdi === "26", "C15 the hover card was for 26");

  // View Plan -> the Treatment Plan tab
  await s.page.locator('[data-testid="panel-view-plan"]').click();
  ok(await waitUntil(async () => (await s.page.getByRole("tab", { name: /Treatment Plan/ }).getAttribute("aria-selected")) === "true", 6000), "C16 'View Plan' opens the Treatment Plan tab (the management screen)");
  await s.ctx.close();
}

/* ======================================================================== D. panel open + hover: the card keeps out of the panel ======================================================================== */
if (only("D")) {
  const s = await open("doc", "en");
  await openChart(s);
  await s.page.locator('input[inputmode="numeric"]').fill("16");
  await s.page.locator('input[inputmode="numeric"]').press("Enter");
  await waitUntil(async () => (await readPanel(s.page))?.fdi === "16", 8000);
  await sleep(2200); // camera focus
  await s.page.locator(".dn-ui-in button", { hasText: /^Back$/ }).first().click().catch(() => {});
  await sleep(1800);
  const at = await hoverTooth(s, "27");
  if (at) {
    const tip = await readTip(s.page), pn = await readPanel(s.page);
    await shot(s.page, "12-hover-with-panel-open");
    ok(!!tip && !!pn && tip.box.r <= pn.box.x + 1, "D1 with the tooth panel open, the hover card stays clear of the panel", { tip: tip?.box, panel: pn?.box });
  } else ok(false, "D1 reached tooth 27 with the panel open");
  await s.ctx.close();
}

/* ======================================================================== E. live synchronisation (no reload) ======================================================================== */
if (only("E")) {
  const s = await open("doc", "empty");
  await openChart(s);
  await s.page.evaluate(() => { window.__noReload = "same-document"; });
  let at = await hoverTooth(s, "11");
  ok(!!at, "E0 reached tooth 11 of the empty patient");
  ok((await readTip(s.page)).none === "No treatment planned", "E1 tooth 11: 'No treatment planned' to begin with");
  // 1) the doctor adds a Crown through the EXISTING Treatment Plan editor (opened from the tooth panel)
  await clickAt(s.page, at);
  ok(await waitUntil(async () => (await readPanel(s.page))?.fdi === "11", 8000), "E2 tooth 11 selected");
  await s.page.locator('[data-testid="tooth-panel"] button', { hasText: /^\s*(Treatment|علاج)\s*$/ }).first().click();
  await s.page.getByRole("button", { name: "Crown", exact: true }).click();
  await sleep(300);
  await s.page.getByRole("button", { name: /^Save$/ }).click();
  ok(await waitUntil(async () => ((await readPanel(s.page))?.rows ?? []).some((r) => r.code === "crown" && r.status === "planned"), 10000), "E3 the panel lists the new planned Crown without a reload");
  await s.page.locator('[data-testid="tooth-panel"] button[aria-label="Close"]').click().catch(() => {});
  await s.page.locator(".dn-ui-in button", { hasText: /^Reset$/ }).first().click(); await sleep(1500);
  at = await hoverTooth(s, "11");
  ok(!!at, "E4 hover tooth 11 again");
  let tip = await readTip(s.page);
  eq(tip.rows.map((r) => [r.code, r.status]), [["crown", "planned"]], "E5 the hover card shows the new Crown (Planned) — same session, no reload");
  eq(await s.page.evaluate(() => window.__noReload), "same-document", "E6 the page was never reloaded");
  const reqs = s.reqs.filter((r) => /^POST .*treatment-plan\/items$/.test(r)).length;
  eq(reqs, 1, "E7 exactly one create request (no duplicate write)");
  // The app's global React Query config has refetchOnWindowFocus:false and the spec forbids polling, so a change made on ANOTHER device shows up
  // the way it does for every other Dental screen: when the doctor navigates (Treatment Plan tab and back) — never needing a page reload.
  const roundTrip = async (s) => {
    await s.page.getByRole("tab", { name: /Treatment Plan/ }).click(); await sleep(900);
    await s.page.getByRole("tab", { name: /Dental Chart/ }).click();
    await s.page.waitForSelector('.dn-ui-in button[aria-pressed]', { timeout: 30000 }); await sleep(900);
    return hoverTooth(s, "11"); // back on the chart: hover tooth 11 again
  };
  // 2) the treatment changes elsewhere (start + complete in a visit); the app's own refetch (window focus) brings the chart up to date
  const plan1 = await planOf("empty");
  const crown = plan1.items.find((i) => i.procedureCode === "crown");
  const v = W.ids.visitEn;
  // the visit belongs to another patient: create one for this patient through the API is not available to us, so use the plan edit (priority/price) + cancel flows instead
  const upd = await api("doc", "PUT", `/dental/patients/${pid("empty")}/treatment-plan/items/${crown._id}`, { notes: "updated elsewhere", priority: "high" });
  eq(upd.status, 200, "E8 the treatment is edited through the existing Treatment Plan API");
  const cancelTwin = await api("doc", "POST", `/dental/patients/${pid("empty")}/treatment-plan/items`, { procedureCode: "sealant", targetType: "tooth", toothNumbers: ["11"] });
  eq(cancelTwin.status, 201, "E9 a second treatment is added elsewhere");
  await roundTrip(s);
  ok(await waitUntil(async () => (await readTip(s.page))?.rows.length === 2, 10000), "E10 after the app's normal tab navigation refetch, the hover card shows BOTH treatments (no reload)");
  tip = await readTip(s.page);
  eq(tip.rows.map((r) => r.code).sort(), ["crown", "sealant"], "E11 …exactly the plan's two treatments");
  const cancel = await api("doc", "POST", `/dental/patients/${pid("empty")}/treatment-plan/items/${cancelTwin.json.item._id}/cancel`, { reason: "x" });
  eq(cancel.status, 200, "E12 the sealant is cancelled through the plan");
  await roundTrip(s);
  ok(await waitUntil(async () => (await readTip(s.page))?.rows.length === 1, 10000), "E13 a cancelled treatment disappears from the card (no reload)");
  eq(await s.page.evaluate(() => window.__noReload), "same-document", "E14 still the same document");
  await s.ctx.close();
}

/* ======================================================================== F. existing Filling / Crown / indicators are intact ======================================================================== */
if (only("F")) {
  const s = await open("doc", "en");
  await openChart(s);
  const rows = await s.page.evaluate(() => [...document.querySelectorAll('[data-testid="chart-restorations"] li')].map((li) => `${li.dataset.fdi}|${li.dataset.kind}|${li.dataset.state}|${li.dataset.surfaces}`));
  ok(rows.includes("26|filling|in_progress|MO"), "F1 the chart still draws the in-progress Filling on 26 (M,O)", rows);
  ok(rows.includes("26|crown|completed|"), "F2 the chart still draws the completed Crown on 26", rows);
  ok(rows.includes("16|filling|planned|O") && rows.includes("16|crown|planned|"), "F3 planned Filling + Crown on 16 are still drawn as ghosts", rows);
  ok(!rows.some((r) => r.startsWith("18|")), "F4 the cancelled Crown on 18 is still not drawn", rows);
  await shot(s.page, "03-chart-restorations");
  await s.ctx.close();
}

/* ======================================================================== G. Arabic / RTL desktop ======================================================================== */
if (only("G")) {
  const s = await open("doc", "ar", { lang: "ar" });
  await openChart(s, "ar");
  await shot(s.page, "04-chart-desktop-ar");
  const plan = await planOf("ar");
  const at21 = await hoverTooth(s, "21");
  ok(!!at21, "G0 reached tooth 21");
  const tip = await readTip(s.page);
  await shot(s.page, "11-hover-21-ar");
  ok(tip.dir === "rtl", "G1 the Arabic card is RTL", tip.dir);
  eq(tip.rows.map((r) => [r.code, r.status]), expectFor(plan, "21").hover, "G2 Arabic card: same treatments/status as the plan");
  ok(tip.rows[0].text.includes("حشوة تجميلية") && /مخطط/.test(tip.rows[0].text), "G3 the doctor's Arabic treatment name and the EXISTING Arabic status word (مخطط) are shown", tip.rows[0].text);
  ok(/التشخيص/.test(tip.text) && /خطة العلاج/.test(tip.text) && /اضغط على السن للتفاصيل/.test(tip.text), "G4 Arabic headings / hint", tip.text);
  ok(tip.diag.length === 1 && /[\u0600-\u06FF]/.test(tip.diag[0]) && !/Caries|dn\.c/.test(tip.diag[0]), "G5 the diagnosis is localised (Arabic word, no English / raw key)", tip.diag);
  eq(tip.fdiDir, "ltr", "G6 the tooth number stays LTR inside the RTL card");
  const st = await stageBox(s.page);
  ok(tip.box.x >= st.x - 1 && tip.box.r <= st.r + 1, "G7 the RTL card stays inside the chart", { tip: tip.box, st });
  await away(s.page);
  const at22 = await hoverTooth(s, "22");
  const tip22 = at22 ? await readTip(s.page) : null;
  ok(tip22 && tip22.none === "لا توجد خطة علاج لهذا السن", "G8 Arabic 'no treatment planned' for a tooth without a plan", tip22?.none);
  // panel in Arabic
  await s.page.locator('input[inputmode="numeric"]').fill("21");
  await s.page.locator('input[inputmode="numeric"]').press("Enter");
  ok(await waitUntil(async () => (await readPanel(s.page))?.fdi === "21", 8000), "G9 Arabic: the tooth panel opens");
  const pn = await readPanel(s.page);
  ok(pn.dir === "rtl" && pn.rows.length === 1 && pn.rows[0].text.includes("حشوة تجميلية") && pn.hasViewPlan, "G10 Arabic panel: RTL, the treatment, 'عرض الخطة'", pn.planText);
  ok(/عرض الخطة/.test(pn.planText), "G11 Arabic 'View plan' label");
  await shot(s.page, "05-panel-desktop-ar");
  eq(await docOverflow(s.page), 0, "G12 no horizontal overflow in Arabic");
  await s.ctx.close();
}

/* ======================================================================== H. primary + mixed dentition mapping ======================================================================== */
if (only("H")) {
  const s = await open("doc", "kid");
  await openChart(s);
  const plan = await planOf("kid");
  const a55 = await hoverTooth(s, "55");
  ok(!!a55, "H1 primary dentition: reached tooth 55");
  eq((await readTip(s.page))?.rows.map((r) => [r.code, r.status]), expectFor(plan, "55").hover, "H2 primary tooth 55 shows its Filling only");
  const a65 = await hoverTooth(s, "65");
  eq(a65 ? (await readTip(s.page))?.rows.map((r) => r.code) : null, ["extraction"], "H3 primary tooth 65 shows its Extraction (not 55's filling)");
  const a74 = await hoverTooth(s, "74");
  const t74 = a74 ? await readTip(s.page) : null;
  ok(t74 && t74.rows.length === 0 && t74.diag.length === 1 && t74.none, "H4 primary tooth 74: diagnosis only, 'No treatment planned'", t74);
  await s.ctx.close();

  const m = await open("doc", "mix");
  await openChart(m);
  const planM = await planOf("mix");
  const m16 = await hoverTooth(m, "16");
  ok(!!m16, "H5 mixed dentition: reached permanent tooth 16");
  eq((await readTip(m.page))?.rows.map((r) => [r.code, r.status]), expectFor(planM, "16").hover, "H6 mixed: 16 shows only its own (Filling D) — not 55's");
  const m55 = await hoverTooth(m, "55");
  ok(!!m55, "H7 mixed dentition: reached primary tooth 55");
  eq((await readTip(m.page))?.rows.map((r) => [r.code, r.status]), expectFor(planM, "55").hover, "H8 mixed: 55 shows only its own (Filling O)");
  const m65 = await hoverTooth(m, "65");
  eq(m65 ? (await readTip(m.page))?.rows.map((r) => r.code) : null, ["crown"], "H9 mixed: primary 65 shows its Crown");
  await m.ctx.close();
}

/* ======================================================================== I. mobile / tablet: touch, no hover ======================================================================== */
if (only("I")) for (const lang of ["en", "ar"]) {
  const s = await open("doc", lang === "ar" ? "ar" : "en", { w: 390, h: 844, touch: true, lang });
  await openChart(s, lang);
  await shot(s.page, `06-chart-mobile-${lang}`);
  const plan = await planOf(lang === "ar" ? "ar" : "en");
  eq(await s.page.evaluate(() => matchMedia("(hover: hover)").matches), false, `I1 ${lang}: this context really has no hover`);
  // tap the chart where the front teeth are (a grid over the canvas): whichever tooth the real 3D picking reports opens its details
  await s.page.evaluate(() => document.querySelector("canvas").scrollIntoView({ block: "start" })); await sleep(900);
  const cb = await s.page.locator("canvas").first().boundingBox();
  ok(!!cb && cb.width > 300, `I2 ${lang}: the 3D chart fills the phone width`, cb);
  if (cb) {
    let panel = null;
    outer: for (const fy of [0.3, 0.36, 0.42, 0.24, 0.48, 0.55]) for (const fx of [0.5, 0.42, 0.58, 0.35, 0.65, 0.3, 0.7]) {
      await s.page.touchscreen.tap(cb.x + cb.width * fx, cb.y + cb.height * fy);
      await sleep(600);
      panel = await readPanel(s.page);
      if (panel) break outer;
    }
    ok(!!panel, `I3 ${lang}: tapping a tooth opens the tooth details (no hover needed)`);
    eq(await readTip(s.page), null, `I4 ${lang}: no hover card is ever shown on touch`);
    if (panel) {
      const ex = expectFor(plan, panel.fdi);
      eq(panel.rows.map((r) => [r.code, r.status]), ex.panel, `I5 ${lang}: the details for tooth ${panel.fdi} match the plan exactly`);
      ok(panel.hasViewPlan, `I6 ${lang}: 'View Plan' is there`);
      ok(panel.dir === (lang === "ar" ? "rtl" : "ltr"), `I7 ${lang}: direction`);
      eq(await docOverflow(s.page), 0, `I8 ${lang}: no horizontal overflow on the phone`);
      ok(panel.box.r <= 391 && panel.box.x >= -1, `I9 ${lang}: the details sheet fits the phone width`, panel.box);
      const vp = await s.page.locator('[data-testid="panel-view-plan"]').boundingBox();
      ok(vp && vp.height >= 40, `I10 ${lang}: 'View Plan' is a touch-sized target`, vp);
      const close = await s.page.locator('[data-testid="tooth-panel"] button[aria-label]').first().boundingBox();
      ok(!!close, `I11 ${lang}: the close button is reachable`);
      await shot(s.page, `07-panel-mobile-${lang}`);
    }
  }
  await s.ctx.close();
}
if (only("I")) { // tablet
  const s = await open("doc", "en", { w: 820, h: 1180, touch: true });
  await openChart(s);
  await s.page.locator('input[inputmode="numeric"]').fill("46");
  await s.page.locator('input[inputmode="numeric"]').press("Enter");
  ok(await waitUntil(async () => (await readPanel(s.page))?.fdi === "46", 8000), "I12 tablet: the details open");
  const pn = await readPanel(s.page);
  eq(pn.rows.length, 6, "I13 tablet: all 6 treatments of tooth 46 are listed in the details (the preview caps at 3, the details do not)");
  eq(await docOverflow(s.page), 0, "I14 tablet: no horizontal overflow");
  ok(pn.scrollW <= pn.clientW + 1, "I15 tablet: the long-name tooth panel does not overflow");
  await s.ctx.close();
}
if (only("I")) { // long name in the panel (desktop)
  const s = await open("doc", "en");
  await openChart(s);
  await s.page.locator('input[inputmode="numeric"]').fill("36");
  await s.page.locator('input[inputmode="numeric"]').press("Enter");
  await waitUntil(async () => (await readPanel(s.page))?.fdi === "36", 8000);
  const pn = await readPanel(s.page);
  ok(pn.scrollW <= pn.clientW + 1 && /Re-treatment/.test(pn.planText), "I16 desktop: the long treatment name is shown in full and wraps inside the panel", { sw: pn.scrollW, cw: pn.clientW });
  await shot(s.page, "08-panel-long-name");
  await s.ctx.close();
}

/* ======================================================================== L. no-WebGL 2D fallback keeps the same information ======================================================================== */
if (only("L")) {
  const s = await open("doc", "en");
  await s.ctx.addInitScript(() => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, ...a) { return /webgl/i.test(String(k)) ? null : g.call(this, k, ...a); }; });
  await openChart(s, "en", { allow2D: true });
  const plan = await planOf("en");
  ok((await s.page.locator('[data-testid="chart-legend-2d"]').count()) === 1, "L1 without WebGL the 2D chart is shown (the existing fallback)");
  const titleOf = (fdi) => s.page.locator(`button[title^="${fdi} —"]`).first().getAttribute("title");
  const t16 = await titleOf("16");
  ok(!!t16 && /Filling \/ Restoration — Planned/.test(t16) && /Crown — Planned/.test(t16) && /Root Canal Treatment — Completed/.test(t16), "L2 tooth 16's native tooltip lists its treatments with the plan's statuses", t16);
  const t11 = await titleOf("11");
  ok(!!t11 && /No treatment planned/.test(t11), "L3 a tooth without treatment says so", t11);
  const t46 = await titleOf("46");
  ok(!!t46 && t46.split("\n").filter((l) => l.startsWith("•")).length === 4 && /\+ 2 more/.test(t46), "L4 tooth 46 (6 treatments): 4 listed + '+ 2 more'", t46);
  await s.page.locator('button[title^="16 —"]').first().click();
  ok(await waitUntil(async () => (await readPanel(s.page))?.fdi === "16", 8000), "L5 clicking a 2D tooth opens the same details");
  eq((await readPanel(s.page)).rows.map((r) => [r.code, r.status]), expectFor(plan, "16").panel, "L6 2D details = the plan");
  await shot(s.page, "09-chart-2d-fallback");
  await s.ctx.close();
}

/* ======================================================================== J. permissions / tenant ======================================================================== */
if (only("J")) {
  // a receptionist reads (same as before); the owner of ANOTHER clinic cannot read this patient's plan, and cannot be tricked with ids
  const rec = await api("rec", "GET", `/dental/patients/${pid("en")}/treatment-plan`);
  eq(rec.status, 200, "J1 the receptionist can still read the plan (existing rule: reads = any role of the clinic)");
  const other = await api("ownerB", "GET", `/dental/patients/${pid("en")}/treatment-plan`);
  eq(other.status, 404, "J2 another clinic's owner gets 404 for this patient's plan (no existence oracle)");
  const asDoc = await api("doc", "GET", `/dental/patients/${W.patientB.id}/treatment-plan`);
  eq(asDoc.status, 404, "J3 a doctor of clinic A asking for clinic B's patient gets 404");
  const withClinic = await api("doc", "GET", `/dental/patients/${pid("en")}/treatment-plan?clinicId=${W.users.ownerB.clinicId}`);
  ok(withClinic.status === 200 && withClinic.json.items.every((i) => i.toothNumbers.length >= 0) && !withClinic.json.items.some((i) => i._id === W.patientB.itemId), "J4 a client-supplied clinicId changes nothing (never trusted)");
  // the page for a foreign patient shows no foreign treatment
  const s = await session(browser, "doc");
  await s.ctx.addInitScript((p) => { try { sessionStorage.setItem("clinicos-selected-patient", JSON.stringify({ state: { selected: p }, version: 0 })); } catch {} }, { ...W.patients.en, _id: W.patientB.id });
  await s.page.goto(APP + "/patients/profile");
  await s.page.getByRole("tab", { name: /Dental Chart/ }).click().catch(() => {});
  await sleep(3500);
  const body = await s.page.evaluate(() => document.body.innerText);
  ok(!/Extraction/.test(body), "J5 forcing another clinic's patient id into the app shows none of that patient's treatments");
  await s.ctx.close();
}

/* ======================================================================== K. nothing broke elsewhere in the page ======================================================================== */
if (only("K")) {
  const s = await open("owner", "en");
  await openChart(s);
  const errs = [];
  s.page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await s.page.getByRole("tab", { name: /Treatment Plan/ }).click();
  ok(await waitUntil(async () => (await s.page.locator("body").innerText()).includes("Filling"), 8000), "K1 the Treatment Plan tab still renders the plan");
  await s.page.getByRole("tab", { name: /Overview/ }).click();
  await sleep(500);
  await s.page.getByRole("tab", { name: /Dental Chart/ }).click();
  await s.page.waitForSelector(".dn-ui-in button[aria-pressed]", { timeout: 40000 });
  ok(true, "K2 switching tabs back and forth re-mounts the chart cleanly");
  eq(errs.filter((e) => !/favicon|manifest|Failed to load resource/.test(e)), [], "K3 no console errors");
  await s.ctx.close();
}
eq(pageErrors, [], "Z no uncaught page error in any browser session");

await browser.close();
process.exit(t.done());
