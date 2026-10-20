/* PHASE 3 · PART A — INVOICE SAFETY PATCH.  A1: permanent delete is OWNER ONLY.  A2: invoice numbers come from ONE persistent, atomic,
   clinic-scoped, monotonic counter (never reused, never renumbered). End-to-end against the COMPILED server (real HTTP, real database).
     npm run build && node tests/invoices/invoice-safety-phase3.test.js
   Optional env: P10_MONGO (default mongodb://127.0.0.1:27017), P10_DIST, P10_OUT.

   The nine scenarios of the Phase 3 specification are tagged  A1 … A9  (the extra groups are  X = extras for the owner-only rule,
   N = numbering edge cases, C = concurrency, P = per-path proof, S = static scan):
     A1 owner can permanently delete a soft-deleted invoice · A2 doctor cannot · A3 doctor's direct API attempt is rejected
     A4 the permanent-delete button is not offered to a doctor (policy + /auth/me + UI source gate)
     A5 …and it remains available to the owner · A6 a permanently deleted number is NEVER reused (highest 100 → ≥ 101)
     A7 concurrent creation gives unique numbers · A8 existing numbers never change · A9 every creation path uses the canonical generator */
const fs = require("fs");
const path = require("path");
const { boot } = require("../phase10/lib");
const DIST = process.env.P10_DIST || path.resolve(__dirname, "../../dist");
const SRC = path.resolve(__dirname, "../../src");
const FE = path.resolve(__dirname, "../../../frontEnd/src");

const walk = (dir, out = []) => {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f.name)) out.push(p);
  }
  return out;
};

(async () => {
  const t = await boot({ name: "invoice_safety_p3", port: 5813, env: { NODE_OPTIONS: `--require ${path.join(__dirname, "../multi-doctor/ferret-date-shim.js")} --require ${path.join(__dirname, "../analytics/agg-emulator.js")} --require ${path.join(__dirname, "../phase7/expr-shim.js")}` } });
  const { ok, eq, http, m } = t;
  const { Appointment, Invoice } = m;
  const { InvoiceCounter } = t.M("InvoiceCounter");
  const numbering = require(path.join(DIST, "services/invoiceNumbering"));
  const sid = (x) => String(x._id);
  const api = (method, url, token, body) => http(method, url, { token, body });

  const wh = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, from: "09:00", to: "17:00" }));
  const A = await t.mkClinic("p3a-a", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const B = await t.mkClinic("p3a-b", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const L = await t.mkClinic("p3a-legacy", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const D = await t.mkClinic("p3a-derm", { specialty: "dermatology_aesthetics", plan: "pro", workingHours: wh, slotDuration: 30 });
  const owner = await t.mkUser(A, "owner"), docX = await t.mkUser(A, "doctor", 1), docY = await t.mkUser(A, "doctor", 2), rec = await t.mkUser(A, "receptionist");
  const ownerB = await t.mkUser(B, "owner"), docB = await t.mkUser(B, "doctor");
  const ownerL = await t.mkUser(L, "owner"), docL = await t.mkUser(L, "doctor");
  const ownerD = await t.mkUser(D, "owner"), docD = await t.mkUser(D, "doctor");
  const tkO = t.tok(owner), tkX = t.tok(docX), tkY = t.tok(docY), tkR = t.tok(rec), tkOB = t.tok(ownerB), tkDB = t.tok(docB), tkOL = t.tok(ownerL), tkOD = t.tok(ownerD), tkDD = t.tok(docD);
  const p1 = await t.mkPatient(A, "Patient One"), p2 = await t.mkPatient(A, "Patient Two");
  const pB = await t.mkPatient(B, "B patient"), pL = await t.mkPatient(L, "Legacy patient"), pD = await t.mkPatient(D, "Derm patient");

  const mkInv = async (token, body) => (await api("POST", "/invoices", token, { items: [{ description: "Service", price: 100, qty: 1 }], ...body })).json;
  const dbDoc = (x) => Invoice.findById(x._id).lean();
  const inv = (x) => `INV-${String(x.invoiceNumber).padStart(4, "0")}`;
  const counterOf = async (clinic) => (await InvoiceCounter.findOne({ clinicId: clinic._id }).lean())?.seq;
  const allNumbers = async (clinic) => (await Invoice.find({ clinicId: clinic._id }).lean()).map((i) => i.invoiceNumber).sort((a, b) => a - b);
  const noDuplicates = (arr) => arr.every((n, i) => arr.indexOf(n) === i);

  /* ============ A1 · the owner can permanently delete a soft-deleted invoice ============ */
  const iO = await mkInv(tkO, { patientId: sid(p1), doctorId: sid(docX) });
  ok(iO && iO.invoiceNumber >= 1, "A0 (setup) an invoice exists, created through POST /invoices", iO);
  eq((await api("DELETE", `/invoices/${sid(iO)}`, tkO, { reason: "test" })).status, 200, "A1 (setup) the owner moves it to Deleted Invoices");
  const purged = await api("DELETE", `/invoices/${sid(iO)}/permanent`, tkO, { confirm: inv(iO) });
  eq([purged.status, purged.json.deleted, purged.json.invoiceNumber], [200, true, iO.invoiceNumber], "A1 the OWNER permanently deletes a soft-deleted invoice (200)");
  eq(await Invoice.countDocuments({ _id: iO._id }), 0, "A1b …the document is really gone");

  /* ============ A2 / A3 · a doctor cannot — not through the UI route, not by calling the API directly ============ */
  const iX = await mkInv(tkX, { patientId: sid(p1) });          // Dr Ahmad's own invoice
  const iXa = await mkInv(tkX, { patientId: sid(p1) });         // …a second one, left ACTIVE
  eq((await api("DELETE", `/invoices/${sid(iX)}`, tkX, { reason: "mine" })).status, 200, "A2 (control) a doctor can still move his OWN invoice to Deleted Invoices (soft delete is unchanged)");
  eq((await api("GET", "/invoices/deleted", tkX)).json.map((i) => i.invoiceNumber), [iX.invoiceNumber], "A2b (control) …and still sees it in HIS Deleted Invoices");
  const dp = await api("DELETE", `/invoices/${sid(iX)}/permanent`, tkX, { confirm: inv(iX) });
  eq([dp.status, dp.json.code], [403, "FORBIDDEN_ROLE"], "A2c a doctor cannot permanently delete even HIS OWN deleted invoice, typing the right number (403)");
  ok(!!(await dbDoc(iX)) && !!(await dbDoc(iX)).deletedAt, "A2d …the invoice is untouched (still in Deleted Invoices)");
  // direct API attempts, every shape a script could try
  for (const [label, call] of [
    ["body confirm = invoice number", () => api("DELETE", `/invoices/${sid(iX)}/permanent`, tkX, { confirm: iX.invoiceNumber })],
    ["?confirm= in the query string", () => http("DELETE", `/invoices/${sid(iX)}/permanent?confirm=${iX.invoiceNumber}`, { token: tkX })],
    ["no confirmation at all", () => api("DELETE", `/invoices/${sid(iX)}/permanent`, tkX, {})],
    ["a wrong confirmation", () => api("DELETE", `/invoices/${sid(iX)}/permanent`, tkX, { confirm: "INV-9999" })],
    ["an ACTIVE invoice", () => api("DELETE", `/invoices/${sid(iXa)}/permanent`, tkX, { confirm: inv(iXa) })],
    ["a token that CLAIMS the owner role", () => api("DELETE", `/invoices/${sid(iX)}/permanent`, t.tok(docX, { role: "owner", roles: ["owner"] }), { confirm: inv(iX) })],
    ["an unknown id", () => api("DELETE", `/invoices/${"a".repeat(24)}/permanent`, tkX, { confirm: "1" })],
    ["a malformed id", () => api("DELETE", `/invoices/not-an-id/permanent`, tkX, { confirm: "1" })],
  ]) eq([(await call()).status], [403], `A3 doctor direct API call (${label}) → 403`);
  eq((await api("DELETE", `/invoices/${sid(iX)}/permanent`, tkY, { confirm: inv(iX) })).status, 403, "A3b another doctor → 403 as well (never a different answer that would reveal the invoice exists)");
  eq((await api("DELETE", `/invoices/${sid(iX)}/permanent`, tkR, { confirm: inv(iX) })).status, 403, "A3c the receptionist is still refused (403) — her restrictions are preserved");
  eq((await http("DELETE", `/invoices/${sid(iX)}/permanent`, { body: { confirm: inv(iX) } })).status, 401, "A3d no token → 401");
  ok(!!(await dbDoc(iX)) && !!(await dbDoc(iX)).deletedAt && (await dbDoc(iX)).total === 100, "A3e …after every attempt the invoice is exactly as it was");
  eq((await api("DELETE", `/invoices/${sid(iX)}/permanent`, tkDB, { confirm: inv(iX) })).status, 403, "A3f a doctor of ANOTHER clinic → 403 (the role is refused before any lookup)");
  eq((await api("DELETE", `/invoices/${sid(iX)}/permanent`, tkOB, { confirm: inv(iX) })).status, 404, "A3g the OWNER of another clinic → 404 (cross-clinic is still invisible)");
  eq((await api("PATCH", `/invoices/${sid(iX)}/restore`, tkX)).status, 200, "A3h (control) the doctor can still RESTORE his own invoice");
  await api("DELETE", `/invoices/${sid(iX)}`, tkX, { reason: "again" });

  /* ============ A4 / A5 · the button: what the UI is told, and the UI source ============ */
  const meX = (await api("GET", "/auth/me", tkX)).json, meO = (await api("GET", "/auth/me", tkO)).json, meR = (await api("GET", "/auth/me", tkR)).json;
  eq([meX.access.invoicesDelete, meX.access.invoicesPurge], ["self", "none"], "A4 /auth/me for a doctor: delete = self, purge = none → the UI hides 'Delete permanently'");
  eq([meO.access.invoicesDelete, meO.access.invoicesPurge], ["clinic", "clinic"], "A5 /auth/me for the owner: delete = clinic, purge = clinic → the button stays available");
  eq([meR.access.invoicesDelete, meR.access.invoicesPurge], ["none", "none"], "A4b …and for the receptionist both stay none");
  const feAccess = fs.readFileSync(path.join(FE, "lib/access.ts"), "utf8");
  ok(/invoicesPurge:\s*T\("clinic",\s*"none",\s*"none"\)/.test(feAccess), "A4c the frontend's fallback matrix (used before /auth/me answers) also says purge = clinic / none / none");
  const panel = fs.readFileSync(path.join(FE, "components/invoices/DeletedInvoicesPanel.tsx"), "utf8");
  ok(/\{canPurge\s*&&\s*\(/.test(panel), "A4d the Deleted Invoices panel renders the 'Delete permanently' button ONLY behind canPurge");
  const life = fs.readFileSync(path.join(FE, "lib/invoices/lifecycle.ts"), "utf8");
  ok(/canPurge:\s*access\.can\("invoicesPurge"\)/.test(life), "A4e …and canPurge comes from the same invoicesPurge policy row the server enforces");
  const polSrc = fs.readFileSync(path.join(SRC, "auth/policy.ts"), "utf8");
  ok(/invoicesPurge:\s*\{\s*owner:\s*"clinic",\s*doctor:\s*"none",\s*receptionist:\s*"none"\s*\}/.test(polSrc), "A4f the server policy row: invoicesPurge = owner clinic, doctor none, receptionist none");

  /* ============ A6 · the number of a permanently deleted invoice is NEVER reused ============ */
  // (a) the literal scenario: a clinic that already has invoices 1…100 and NO counter yet (every pre-Phase-3 clinic).
  await Invoice.insertMany(Array.from({ length: 100 }, (_, i) => ({ clinicId: L._id, invoiceNumber: i + 1, patientId: pL._id, doctorId: docL._id, items: [{ description: "Legacy", price: 10, qty: 1 }], total: 10, status: "unpaid" })));
  eq(await counterOf(L), undefined, "A6 (setup) the legacy clinic has 100 invoices and no counter");
  const top100 = await Invoice.findOne({ clinicId: L._id, invoiceNumber: 100 });
  eq((await api("DELETE", `/invoices/${sid(top100)}`, tkOL, { reason: "x" })).status, 200, "A6a the owner soft-deletes invoice #100 …");
  eq((await api("DELETE", `/invoices/${sid(top100)}/permanent`, tkOL, { confirm: 100 })).status, 200, "A6b …and permanently deletes it (the highest number is now gone from the database)");
  eq(await Invoice.countDocuments({ clinicId: L._id, invoiceNumber: 100 }), 0, "A6c #100 no longer exists");
  const n101 = await mkInv(tkOL, { patientId: sid(pL), doctorId: sid(docL) });
  ok(n101.invoiceNumber >= 101, "A6d the NEXT invoice is 101 or greater — never 100", n101.invoiceNumber);
  eq(n101.invoiceNumber, 101, "A6e …exactly 101 (the counter was pinned above #100 by the deletion itself)");
  eq(await counterOf(L), 101, "A6f the clinic's counter now stands at 101");
  // (b) again on a clinic whose counter already exists: purge the newest, create, create
  const n102 = await mkInv(tkOL, { patientId: sid(pL), doctorId: sid(docL) });
  await api("DELETE", `/invoices/${sid(n102)}`, tkOL, {}); await api("DELETE", `/invoices/${sid(n102)}/permanent`, tkOL, { confirm: n102.invoiceNumber });
  const n103 = await mkInv(tkOL, { patientId: sid(pL), doctorId: sid(docL) });
  eq([n102.invoiceNumber, n103.invoiceNumber], [102, 103], "A6g purging the newest invoice (#102) does not bring #102 back: the next one is 103");
  // (c) soft delete + restore never consume or free a number
  await api("DELETE", `/invoices/${sid(n103)}`, tkOL, {}); await api("PATCH", `/invoices/${sid(n103)}/restore`, tkOL);
  const n104 = await mkInv(tkOL, { patientId: sid(pL), doctorId: sid(docL) });
  eq([(await dbDoc(n103)).invoiceNumber, n104.invoiceNumber], [103, 104], "A6h soft delete + restore keep #103; the next invoice is 104");
  // (d) deleting EVERY invoice of a clinic still never restarts the sequence
  await Invoice.updateMany({ clinicId: L._id }, { $set: { deletedAt: new Date(), deletedBy: ownerL._id } });
  const all = await Invoice.find({ clinicId: L._id }).lean();
  for (const d of all.slice(0, 5)) await api("DELETE", `/invoices/${sid(d)}/permanent`, tkOL, { confirm: d.invoiceNumber });
  await Invoice.deleteMany({ clinicId: L._id });
  const restart = await mkInv(tkOL, { patientId: sid(pL), doctorId: sid(docL) });
  eq(restart.invoiceNumber, 105, "A6i even with EVERY invoice of the clinic gone, the sequence continues (105), it never restarts at 1");

  /* ============ A7 / C · concurrent creation ============ */
  const N = 24;
  const burst = await Promise.all(Array.from({ length: N }, (_, i) => api("POST", "/invoices", i % 2 ? tkR : tkO, { patientId: sid(p2), items: [{ description: `Parallel ${i}`, price: 5, qty: 1 }] })));
  eq(burst.map((r) => r.status).filter((s) => s !== 201), [], "A7 24 invoices created at the same instant: every request succeeds (201)");
  const burstNums = burst.map((r) => r.json.invoiceNumber);
  ok(noDuplicates(burstNums) && burstNums.length === N, "A7b …and all 24 invoice numbers are DISTINCT", burstNums);
  const stored = await allNumbers(A);
  ok(noDuplicates(stored), "A7c …no duplicate number exists in the clinic", stored);
  const burstSorted = [...burstNums].sort((a, b) => a - b);
  ok(burstSorted.every((n, i) => i === 0 || n > burstSorted[i - 1]), "A7d …strictly increasing once ordered (monotonic)");
  const bursts = await Promise.all([
    ...Array.from({ length: 10 }, () => api("POST", "/invoices", tkOB, { patientId: sid(pB), items: [{ description: "B", price: 1, qty: 1 }] })),
    ...Array.from({ length: 10 }, () => api("POST", "/invoices", tkOL, { patientId: sid(pL), doctorId: sid(docL), items: [{ description: "L", price: 1, qty: 1 }] })),
  ]);
  ok(noDuplicates(await allNumbers(B)) && noDuplicates(await allNumbers(L)), "A7e two clinics creating at once: each clinic's numbers are unique");
  eq(bursts.filter((r) => r.status !== 201).length, 0, "A7f …and none of the parallel requests failed");
  // a concurrent burst running while the highest invoice is being purged must not reuse its number either
  const hi = await Invoice.findOne({ clinicId: A._id }).sort({ invoiceNumber: -1 });
  await api("DELETE", `/invoices/${sid(hi)}`, tkO, {});
  const [pr, ...cr] = await Promise.all([api("DELETE", `/invoices/${sid(hi)}/permanent`, tkO, { confirm: hi.invoiceNumber }), ...Array.from({ length: 6 }, () => api("POST", "/invoices", tkR, { patientId: sid(p2), items: [{ description: "Race", price: 2, qty: 1 }] }))]);
  ok(pr.status === 200 && cr.every((r) => r.status === 201) && cr.every((r) => r.json.invoiceNumber !== hi.invoiceNumber), "A7g creating while the highest invoice is permanently deleted: the deleted number is not handed out", { purge: pr.status, nums: cr.map((r) => r.json.invoiceNumber), deleted: hi.invoiceNumber });

  /* ============ A8 · existing invoice numbers never change ============ */
  const before = new Map((await Invoice.find({ clinicId: A._id }).lean()).map((d) => [sid(d), d.invoiceNumber]));
  await numbering.bootstrapInvoiceCounters();                                   // re-running the bootstrap …
  await InvoiceCounter.deleteOne({ clinicId: A._id });                         // …a LOST counter row …
  await numbering.bootstrapInvoiceCounters({ clinicId: sid(A) });              // …and its rebuild
  const nAfter = await mkInv(tkO, { patientId: sid(p2), doctorId: sid(docX) });
  const after = new Map((await Invoice.find({ clinicId: A._id }).lean()).map((d) => [sid(d), d.invoiceNumber]));
  ok([...before].every(([id, n]) => after.get(id) === n), "A8 every pre-existing invoice keeps exactly the number it had (bootstrap, a lost counter and new invoices renumber nothing)");
  ok(nAfter.invoiceNumber > Math.max(...before.values()), "A8b …and the next one is above every existing number", { next: nAfter.invoiceNumber, max: Math.max(...before.values()) });
  const preCount = await Invoice.countDocuments({ clinicId: A._id });
  const rep = await numbering.bootstrapInvoiceCounters();
  eq([rep.created, rep.raised, await Invoice.countDocuments({ clinicId: A._id })], [0, 0, preCount], "A8c the bootstrap is idempotent: nothing created, nothing raised, no invoice added or removed");
  const dry = await numbering.bootstrapInvoiceCounters({ dryRun: true });
  ok(dry.created === 0 && dry.raised === 0, "A8d a dry run on correct data reports no change");

  /* ============ N · numbering edge cases ============ */
  const hiA = (await allNumbers(A)).slice(-1)[0];
  await InvoiceCounter.updateOne({ clinicId: A._id }, { $set: { seq: 3 } });                 // a counter restored from an OLD backup
  const healed = await mkInv(tkO, { patientId: sid(p2), doctorId: sid(docX) });
  ok(healed.invoiceNumber > hiA, "N1 a counter that trails the real highest number heals itself: the next invoice is above every existing one", { got: healed.invoiceNumber, highest: hiA });
  eq(await counterOf(A), healed.invoiceNumber, "N1b …and the counter follows");
  await InvoiceCounter.deleteOne({ clinicId: A._id });                                       // counter row lost entirely
  const rebuilt = await mkInv(tkO, { patientId: sid(p2), doctorId: sid(docX) });
  eq(rebuilt.invoiceNumber, healed.invoiceNumber + 1, "N2 a LOST counter row is rebuilt above the highest existing number, with no gap and no clash");
  const bFirst = await mkInv(tkOB, { patientId: sid(pB) });
  ok(bFirst.invoiceNumber >= 1 && (await allNumbers(B))[0] >= 1, "N3 clinic B numbers independently (its own sequence, not clinic A's)", await allNumbers(B));
  ok(noDuplicates(await allNumbers(A)) && noDuplicates(await allNumbers(B)) && noDuplicates(await allNumbers(L)), "N4 no clinic has a duplicate invoice number");
  const badPost = await api("POST", "/invoices", tkO, { patientId: sid(p2), items: [] });
  const cBefore = await counterOf(A);
  const nGood = await mkInv(tkO, { patientId: sid(p2), doctorId: sid(docX) });
  ok(badPost.status === 400 && nGood.invoiceNumber === cBefore + 1, "N5 a rejected request (400) never consumes a number");
  eq((await api("POST", "/invoices", tkDB, { patientId: sid(p2), items: [{ description: "x", price: 1, qty: 1 }] })).status, 404, "N6 a doctor of another clinic cannot create an invoice for this clinic's patient (404) — and gets no number");

  /* ============ P · every creation path draws from the SAME counter ============ */
  const seqNow = () => counterOf(A);
  // 1) normal API
  const viaApi = await mkInv(tkR, { patientId: sid(p1) });
  eq([viaApi.invoiceNumber, await seqNow()], [viaApi.invoiceNumber, viaApi.invoiceNumber], "P1 POST /api/invoices: the number is the counter's value");
  // 2) AI assistant (Nabd)
  const tools = require(path.join(DIST, "services/ai/tools"));
  const ctxOf = (u, role) => ({ conversationId: "c", conversationObjectId: "o", clinicId: sid(A), userId: sid(u), role });
  const ai = await tools.getAllowedTools(ctxOf(owner, "owner")).createInvoice.execute({ patientId: sid(p1), items: [{ description: "AI service", price: 30 }] }, ctxOf(owner, "owner"));
  ok(ai.success === true && ai.invoiceNumber === viaApi.invoiceNumber + 1 && (await seqNow()) === ai.invoiceNumber, "P2 AI assistant createInvoice: the next counter value, no max+1", ai);
  // 3) dental billing
  const visit = (p, doc, ago = 6 * 36e5) => Appointment.create({ clinicId: A._id, doctorId: doc._id, patientId: p._id, startAt: new Date(Date.now() - ago), duration: 30, status: "completed" });
  const planIt = async (tk, p, body) => (await api("POST", `/dental/patients/${sid(p)}/treatment-plan/items`, tk, body)).json.item._id;
  const run = async (tk, p, itemId, v) => { await api("POST", `/dental/patients/${sid(p)}/treatment-plan/items/${itemId}/start`, tk, { appointmentId: sid(v) }); return api("POST", `/dental/patients/${sid(p)}/treatment-plan/items/${itemId}/complete`, tk, { appointmentId: sid(v) }); };
  const itD = await planIt(tkX, p1, { procedureCode: "crown", targetType: "tooth", toothNumbers: ["16"] });
  eq((await run(tkX, p1, itD, await visit(p1, docX))).status, 200, "P3 (setup) Dr Ahmad completes a crown");
  const dent = await api("POST", `/dental/patients/${sid(p1)}/treatment-plan/items/${itD}/invoice`, tkR, { price: 80, description: "Crown 16" });
  ok(dent.status === 201 && dent.json.invoice.invoiceNumber === ai.invoiceNumber + 1 && (await seqNow()) === dent.json.invoice.invoiceNumber, "P3 dental 'Add to invoice': the next counter value", dent.json);
  const dent2 = await api("POST", `/dental/patients/${sid(p1)}/treatment-plan/items/${itD}/invoice`, tkR, { price: 80, description: "Crown 16" });
  eq([dent2.status, dent2.json.alreadyInvoiced, await seqNow()], [200, true, dent.json.invoice.invoiceNumber], "P3b …a repeated click is idempotent: same invoice, NO number consumed");
  // 4) dermatology billing
  const walkIn = await api("POST", "/appointments", t.tok(await t.mkUser(D, "receptionist")), { source: "walk_in", patientId: sid(pD), doctorId: sid(docD) });
  eq(walkIn.status, 201, "P4 (setup) a walk-in visit exists in the dermatology clinic");
  const dItem = await api("POST", `/derm/patients/${sid(pD)}/treatment-plan/items`, tkDD, { clientRequestId: `p3a${Date.now().toString(36)}`, recordType: "dermatology", procedureCode: "cryotherapy", targetType: "single_region", regions: [{ id: "forehead" }], estimatedPrice: 50, priority: "normal" });
  const dId = (dItem.json.item || dItem.json)._id;
  await api("POST", `/derm/patients/${sid(pD)}/treatment-plan/items/${dId}/start`, tkDD, { appointmentId: walkIn.json._id });
  eq([200, 201].includes((await api("POST", `/derm/patients/${sid(pD)}/treatment-plan/items/${dId}/complete`, tkDD, { appointmentId: walkIn.json._id, procedureNotes: "done" })).status), true, "P4a (setup) the treatment is completed");
  const derm = await api("POST", `/derm/patients/${sid(pD)}/treatment-plan/items/${dId}/invoice`, tkDD, { price: 50, description: "Cryotherapy" });
  ok([200, 201].includes(derm.status) && derm.json.invoice.invoiceNumber === (await counterOf(D)) && (await counterOf(D)) >= 1, "P4 dermatology 'Add to invoice': the number is the derm clinic's counter value", derm.json);
  ok(noDuplicates(await allNumbers(A)) && noDuplicates(await allNumbers(D)), "P5 after all four paths, no duplicate numbers anywhere");

  /* ============ A9 / S · static proof: ONE canonical generator, no hidden max+1 ============ */
  const files = walk(SRC);
  const canon = path.join(SRC, "services/invoiceNumbering.ts");
  const hits = (re) => files.filter((f) => f !== canon && re.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f));
  eq(hits(/\bInvoice\.create\s*\(/), [], "A9 nothing outside services/invoiceNumbering.ts calls Invoice.create(");
  eq(hits(/\bnew Invoice\s*\(/), [], "A9b …nor `new Invoice(`");
  eq(hits(/\bInvoice\.(insertMany|insertOne|bulkWrite|collection\.insert\w*)\s*\(/), [], "A9c …nor insertMany / insertOne / bulkWrite");
  eq(hits(/\bInvoice\.(findOneAndUpdate|updateOne|updateMany)\s*\([^)]*upsert/), [], "A9d …nor an upsert that could create an invoice");
  eq(hits(/nextNumber\s*\(\s*Invoice\b/), [], "A9e …nor the old max+1 helper applied to invoices");
  eq(hits(/invoiceNumber[^\n]{0,80}\+\s*1|sort\(\{\s*invoiceNumber:\s*-1/), [], "A9f …nor any other `highest invoiceNumber + 1` logic (the highest number is read in the canonical service only)");
  const canonSrc = fs.readFileSync(canon, "utf8");
  ok(/\$inc:\s*\{\s*seq:\s*1\s*\}/.test(canonSrc) && /clinicId/.test(canonSrc), "A9g the canonical generator is an atomic per-clinic $inc");
  const users = files.filter((f) => /createNumberedInvoice/.test(fs.readFileSync(f, "utf8"))).map((f) => path.relative(SRC, f)).sort();
  eq(users, ["controllers/invoiceController.ts", "services/ai/tools/dashboard/createInvoice.ts", "services/dentalBilling.ts", "services/dermBilling.ts", "services/invoiceNumbering.ts"], "A9h the four creation paths (API, AI assistant, dental, dermatology) all go through createNumberedInvoice");
  const idx = await Invoice.collection.indexes();
  ok(idx.some((i) => i.unique && i.key.clinicId === 1 && i.key.invoiceNumber === 1), "A9i the database still enforces unique (clinicId, invoiceNumber) as the last line of defence");
  const cidx = await InvoiceCounter.collection.indexes();
  ok(cidx.some((i) => i.unique && i.key.clinicId === 1), "A9j one counter row per clinic is enforced by a unique index");

  /* ============ audit trail + leaks ============ */
  const act = await m.ActivityLog.find({ action: "invoice.permanently_deleted" }).lean();
  ok(act.length >= 3 && act.every((a) => a.details.actorRole === "owner"), "X1 every permanent deletion in the audit trail was performed by an owner", act.map((a) => a.details.actorRole));
  t.noLeaks();
  await t.finish("Phase 3 · Part A — owner-only permanent delete + canonical invoice counter");
})().catch((e) => { console.error(e); process.exit(1); });
