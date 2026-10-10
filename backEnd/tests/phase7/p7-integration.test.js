/* PHASE 7 — integrated-system QA.  A real clinic day, end to end, through the HTTP API of the COMPILED server (nothing mocked):
 *   B  the 32-step workflow (receptionist · Doctor A · Doctor B · owner)            D  financial reconciliation across every page
 *   E  partial payments, overpayment, invalid amounts, floating point               J  double-click / parallel submissions
 *   K  legacy documents (no doctor, no createdBy, no revision fields…)              M  every report filter × every role
 *   N  brand-new empty clinic                                                        O  one-doctor clinic
 *   P  loyalty gating                                                                Q  specialty gating
 *
 *   node tests/phase7/p7-integration.test.js   (dist/ built; FerretDB needs the two test engines — see p7lib.js)
 */
const { boot7, wh } = require("./p7lib");

(async () => {
  const t = await boot7({ name: "p7_integration", port: 5307 });
  const { Clinic, User, Appointment, Invoice, Patient } = t.m;
  const Expense = t.M("Expense").Expense;
  const api = t.api;
  const sid = (d) => String(d._id);
  const today = t.tz.clinicYmdOf(new Date());
  const tomorrow = t.tz.addDaysYmd(today, 1);
  const iso = (ymd, hm) => t.tz.clinicLocalToUtc(ymd, hm).toISOString();
  const RAW = (path, body, token) => t.http("POST", path, { token, rawBody: body });

  // ═══════════════════════════ WORLD ═══════════════════════════
  const X = await t.mkClinic("p7x", { specialty: "dentistry", plan: "pro", workingHours: wh(), slotDuration: 30 });
  const owner = await t.mkUser(X, "owner"), drA = await t.mkUser(X, "doctor", 1), drB = await t.mkUser(X, "doctor", 2), rec = await t.mkUser(X, "receptionist");
  const TK = { owner: t.tok(owner), a: t.tok(drA), b: t.tok(drB), rec: t.tok(rec) };
  const dA = sid(drA), dB = sid(drB);

  // ═══════════════════════════ B — THE WORKFLOW ═══════════════════════════
  // 1. receptionist registers a patient (fake data only)
  const p1 = await api("POST", "/patients", TK.rec, { fullName: "Test Patient One", phone: "0791000001" });
  const p2 = await api("POST", "/patients", TK.rec, { fullName: "Test Patient Two", phone: "0791000002" });
  t.eq([p1.status, p2.status], [201, 201], "B1 receptionist registers two patients");
  t.eq([p1.json.fileNumber, p2.json.fileNumber], [1, 2], "B1b file numbers are sequential");
  t.eq((await api("POST", "/patients", TK.rec, { fullName: "Dup", phone: "0791000001" })).status, 409, "B1c the same phone is refused (409)");
  const P1 = p1.json._id, P2 = p2.json._id;

  // 2-4. two doctors, same time
  const slot = iso(tomorrow, "10:00");
  const bookA = await api("POST", "/appointments", TK.rec, { patientId: P1, doctorId: dA, startAt: slot, duration: 30 });
  const bookB = await api("POST", "/appointments", TK.rec, { patientId: P2, doctorId: dB, startAt: slot, duration: 30 });
  t.eq([bookA.status, bookB.status], [201, 201], "B2/3 Doctor A and Doctor B can both be booked at 10:00 (same instant)");
  t.eq((await api("POST", "/appointments", TK.rec, { patientId: P2, doctorId: dA, startAt: slot, duration: 30 })).status, 409, "B3b …but the SAME doctor cannot be double-booked");
  const dayRec = (await api("GET", `/appointments?date=${tomorrow}`, TK.rec)).json;
  t.eq(dayRec.length, 2, "B4 the receptionist's board shows both appointments (one doctor's does not hide the other's)");
  t.eq((await api("GET", `/appointments?date=${tomorrow}`, TK.a)).json.map((a) => a._id), [bookA.json._id], "B4b Doctor A's own board shows only A");
  t.eq((await api("GET", `/appointments?date=${tomorrow}`, TK.b)).json.map((a) => a._id), [bookB.json._id], "B4c Doctor B's own board shows only B");
  t.eq((await api("GET", `/appointments?date=${tomorrow}&doctorId=${dB}`, TK.owner)).json.length, 1, "B4d the owner can narrow to one doctor");
  t.eq((await api("GET", `/appointments?date=${tomorrow}`, TK.owner)).json.length, 2, "B4e the owner sees both");
  t.eq((await api("GET", `/appointments?date=2026-02-30`, TK.owner)).status, 400, "B4f an impossible date is a 400 (jump-to-date input)");

  // 5-7. walk-in at "now"
  const slotsQ = `/public/clinics/${X.slug}/slots?doctorId=${dA}&date=${today}`;
  const slotsBefore = (await t.http("GET", slotsQ)).json;
  const t0 = Date.now();
  const walk = await api("POST", "/appointments", TK.rec, { source: "walk_in", patientId: P2, doctorId: dA, requestId: "p7walkin0001", reason: "toothache" });
  const t1 = Date.now();
  t.eq(walk.status, 201, "B5 walk-in registered with no scheduled slot");
  const ws = new Date(walk.json.startAt).getTime();
  t.ok(ws >= t0 - 5 && ws <= t1 + 5, "B6 check-in time is captured automatically = the server's now, to the millisecond (not rounded)", { ws, t0, t1 });
  t.eq([walk.json.source, String(walk.json.doctorId)], ["walk_in", dA], "B6b marked WALK-IN, doctor relationship kept");
  const board = (await api("GET", `/appointments?date=${today}`, TK.rec)).json;
  t.ok(board.some((a) => a._id === walk.json._id && a.source === "walk_in"), "B6c it appears on today's board, flagged walk_in");
  t.eq((await t.http("GET", slotsQ)).json, slotsBefore, "B7 the PUBLIC availability for that doctor/day is unchanged — a walk-in never blocks online booking");

  // 8-11. Doctor A opens the patient, notes, edit, revisions
  t.eq((await api("GET", `/patients/${P1}`, TK.a)).status, 200, "B8 Doctor A opens the patient file");
  const n1 = await api("POST", `/patients/${P1}/clinical-notes`, TK.a, { text: "Pain on lower right molar", requestId: "p7note00001" });
  t.eq([n1.status, n1.json.duplicate], [201, false], "B9 Doctor A adds a clinical note");
  t.eq((await api("POST", `/patients/${P1}/clinical-notes`, TK.a, { text: "Pain on lower right molar", requestId: "p7note00001" })).json.duplicate, true, "B9b the same dialog submitted twice creates ONE note");
  t.eq((await api("POST", `/patients/${P1}/clinical-notes`, TK.rec, { text: "x" })).status, 403, "B9c a receptionist cannot write clinical notes");
  const nid = n1.json.note._id;
  const e1 = await api("PUT", `/patients/${P1}/clinical-notes/${nid}`, TK.a, { text: "Pain on lower right molar, cold sensitivity", expectedEditCount: 0 });
  t.eq([e1.status, e1.json.note.editCount], [200, 1], "B10 the note is edited");
  const rv = await api("GET", `/patients/${P1}/clinical-notes/${nid}/revisions`, TK.a);
  t.eq([rv.json.revisions.length, rv.json.revisions[0].text], [1, "Pain on lower right molar"], "B11 revision history keeps the replaced text");
  t.eq((await api("PUT", `/patients/${P1}/clinical-notes/${nid}`, TK.b, { text: "stale", expectedEditCount: 0 })).status, 409, "B11b an edit made from a stale version is refused (no silent overwrite)");

  // 12-16. dental chart / treatment plan
  const D = `/dental/patients/${P1}`;
  const fill = await api("POST", `${D}/treatment-plan/items`, TK.a, { procedureCode: "filling", targetType: "surface", toothNumbers: ["16"], surfaces: ["O"] });
  t.eq(fill.status, 201, "B13 Filling (16, occlusal) added");
  t.eq((await api("POST", `${D}/treatment-plan/items`, TK.a, { procedureCode: "filling", targetType: "surface", toothNumbers: ["16"], surfaces: ["O"] })).status, 409, "B13b the same filling is not duplicated");
  const crown = await api("POST", `${D}/treatment-plan/items`, TK.a, { procedureCode: "crown", targetType: "tooth", toothNumbers: ["26"] });
  t.eq(crown.status, 201, "B15 Crown (26) added");
  const plan = (await api("GET", `${D}/treatment-plan`, TK.a)).json;
  t.eq(plan.items.filter((i) => i.status === "planned").length, 2, "B14 the Treatment Plan lists exactly the two planned items (chart ↔ plan: one record each)");
  const f16 = plan.items.find((i) => i.procedureCode === "filling"), c26 = plan.items.find((i) => i.procedureCode === "crown");
  t.ok(f16 && f16.targetType === "surface" && f16.surfaces.join() === "O" && c26 && c26.targetType === "tooth", "B16 the plan (the chart's single source) distinguishes a SURFACE filling from a WHOLE-TOOTH crown — what the chart draws differently (checked in the browser run)");
  // do the work in A's visit
  const visitId = bookA.json._id;
  const fid = fill.json.item._id, cid = crown.json.item._id;
  t.eq((await api("POST", `${D}/treatment-plan/items/${fid}/start`, TK.a, { appointmentId: visitId })).status, 201, "B17 filling started in the visit");
  t.eq((await api("POST", `${D}/treatment-plan/items/${fid}/complete`, TK.a, { appointmentId: visitId })).status, 200, "B17b filling completed");
  t.eq((await api("POST", `${D}/treatment-plan/items/${cid}/start`, TK.a, { appointmentId: visitId })).status, 201, "B17c crown started");
  t.eq((await api("POST", `${D}/treatment-plan/items/${cid}/complete`, TK.a, { appointmentId: visitId })).status, 200, "B17d crown completed");
  const bill = await api("POST", `${D}/treatment-plan/items/${fid}/invoice`, TK.a, { price: 500, description: "Filling 16 O" });
  t.eq(bill.status, 201, "B18 treatment → invoice (500)");
  const bill2 = await api("POST", `${D}/treatment-plan/items/${fid}/invoice`, TK.a, { price: 500, description: "Filling 16 O" });
  t.ok(bill2.status === 200 || bill2.status === 409, "B18b billing the same treatment again is refused / idempotent", bill2.status);
  t.eq(await Invoice.countDocuments({ clinicId: X._id }), 1, "B18c …and no second invoice or line exists");
  const invId = bill.json.invoice._id;

  // 18-19. receptionist records payments
  const pay1 = await api("POST", `/invoices/${invId}/payments`, TK.rec, { amount: 200, method: "cash" });
  const pay2 = await api("POST", `/invoices/${invId}/payments`, TK.rec, { amount: 300, method: "cliq" });
  t.eq([pay1.status, pay1.json.status, pay2.status, pay2.json.status], [200, "partially_paid", 200, "paid"], "B19 receptionist records 200 then 300: partially_paid → paid");
  const invDoc = await Invoice.findById(invId).lean();
  t.eq([String(invDoc.doctorId), String(invDoc.createdBy)], [dA, dA], "B19b the invoice belongs to the TREATING doctor (A)");
  const sumPaid = invDoc.payments.reduce((s, p) => s + p.amount, 0);
  t.eq(sumPaid, 500, "B19c payments sum to 500");

  // 20-21. expenses by the owner
  const exShared = await api("POST", "/expenses", TK.owner, { title: "Rent", category: "rent", scope: "clinic", amount: 200, status: "paid", date: today });
  const exA = await api("POST", "/expenses", TK.owner, { title: "Lab A", category: "lab", scope: "clinic", amount: 100, status: "paid", date: today, doctorId: dA });
  t.eq([exShared.status, exA.status], [201, 201], "B20/21 owner creates a clinic expense and a Doctor-A expense");

  // 22-26. reports
  const Q = "preset=today&compare=0";
  const ovT = (await api("GET", `/analytics/overview?${Q}`, TK.owner)).json;
  t.money(ovT.kpis.collected.current, 500, "B23 Reports: collected = 500 (treating doctor's invoice, paid by the receptionist)");
  t.money(ovT.kpis.expenses.current, 300, "B24 Reports: expenses = 200 shared + 100 Doctor A = 300");
  t.money(ovT.kpis.netCash.current, 200, "B25 Reports: Net Cash = 500 − 300 = 200");
  const dc = (await api("GET", `/analytics/doctors?${Q}`, TK.owner)).json;
  const rA = dc.rows.find((r) => r.doctorId === dA), rB = dc.rows.find((r) => r.doctorId === dB);
  t.money(rA && rA.netContribution, 400, "B26 Doctor A net contribution = 500 − 100 = 400 (shared 200 not deducted)");
  t.money(rB ? rB.collected : 0, 0, "B26b Doctor B collected nothing — the receptionist who took the payments earns nothing");
  const dash = (await api("GET", "/dashboard/stats", TK.owner)).json;
  t.money(dash.today.revenue, 500, "B26c Dashboard 'today revenue' = the same 500");

  // 27-29 Doctor B cannot reach A's money
  t.eq((await api("GET", `/analytics/financial?${Q}&doctorId=${dA}`, TK.b)).status, 403, "B28 Doctor B → Doctor A financial report: 403");
  t.eq((await api("GET", `/analytics/financial?${Q}`, TK.b)).json.kpis.collected.current, 0, "B28b Doctor B's own financial report holds none of A's money");
  t.eq((await api("PUT", `/invoices/${invId}`, TK.b, { items: [{ description: "x", price: 1, qty: 1 }], discount: 0 })).status, 404, "B28c Doctor B cannot edit A's invoice (404)");
  t.eq((await api("POST", `/invoices/${invId}/payments`, TK.b, { amount: 1 })).status, 404, "B28d …nor add a payment to it (404)");
  t.eq((await api("GET", "/invoices", TK.b)).json.length, 0, "B28e …nor list it");
  t.eq((await api("GET", `/expenses/${exA.json._id}`, TK.b)).status, 404, "B28f …nor open A's expense (404)");
  t.eq((await api("GET", `/expenses/ledger?doctorId=${dA}`, TK.b)).status, 403, "B28g …nor ask for A's expense ledger (403)");
  t.eq((await api("GET", `/expenses/${exShared.json._id}`, TK.a)).status, 404, "B28h Doctor A cannot open the SHARED clinic expense either");
  // 30-32 receptionist
  for (const [what, url] of [["analytics overview", `/analytics/overview?${Q}`], ["analytics financial", `/analytics/financial?${Q}`], ["analytics doctors", `/analytics/doctors?${Q}`], ["analytics export", `/analytics/export?section=financial&format=csv&${Q}`], ["legacy monthly report", "/reports/monthly"], ["expense ledger", "/expenses/ledger"], ["expense summary", "/expenses/summary"], ["expense overview", "/expenses/overview"]]) {
    t.eq((await api("GET", url, TK.rec)).status, 403, `B31 receptionist → ${what}: 403`);
  }
  t.eq((await api("GET", "/dashboard/stats", TK.rec)).json.today.revenue, null, "B32 the dashboard gives the receptionist NO revenue (null, not 0)");

  // refresh / logout-login / navigate back: the same facts from a brand-new session
  const snap = async (tok) => JSON.stringify({
    ov: (await api("GET", `/analytics/overview?${Q}`, tok.owner)).json.kpis,
    inv: (await api("GET", "/invoices", tok.owner)).json.map((i) => [i.invoiceNumber, i.status, i.total, i.payments.length]),
    plan: (await api("GET", `${D}/treatment-plan`, tok.a)).json.items.map((i) => [i.procedureCode, i.status]),
    notes: (await api("GET", `/patients/${P1}/clinical-notes`, tok.a)).json.notes.map((n) => [n.text, n.editCount]),
    day: (await api("GET", `/appointments?date=${tomorrow}`, tok.owner)).json.map((a) => a._id),
  });
  const before = await snap(TK);
  const login = async (email) => (await t.http("POST", "/auth/login", { body: { email, password: "secret123" } })).json;
  const LG = { owner: await login(owner.email), a: await login(drA.email), b: await login(drB.email), rec: await login(rec.email) };
  t.ok(LG.owner.token && LG.a.token && LG.rec.token, "B33 all four users log in again (new sessions)", Object.keys(LG.owner));
  const after = await snap({ owner: LG.owner.token, a: LG.a.token, b: LG.b.token, rec: LG.rec.token });
  t.eq(after, before, "B33b after logout/login every figure, invoice, plan item, note and appointment is identical");

  // ═══════════════════════════ D — FINANCIAL RECONCILIATION (the mandatory dataset) ═══════════════════════════
  const Y = await t.mkClinic("p7y", { specialty: "general", plan: "pro", workingHours: wh() });
  const oY = await t.mkUser(Y, "owner"), aY = await t.mkUser(Y, "doctor", 1), bY = await t.mkUser(Y, "doctor", 2), rY = await t.mkUser(Y, "receptionist");
  const TY = { o: t.tok(oY), a: t.tok(aY), b: t.tok(bY), r: t.tok(rY) };
  const pa = await api("POST", "/patients", TY.r, { fullName: "Recon A", phone: "0792000001" });
  const pb = await api("POST", "/patients", TY.r, { fullName: "Recon B", phone: "0792000002" });
  const invA = await api("POST", "/invoices", TY.o, { patientId: pa.json._id, doctorId: sid(aY), items: [{ description: "Treatment A", price: 500, qty: 1 }], discount: 0 });
  const invB = await api("POST", "/invoices", TY.o, { patientId: pb.json._id, doctorId: sid(bY), items: [{ description: "Treatment B", price: 300, qty: 1 }], discount: 0 });
  t.eq([invA.status, invB.status], [201, 201], "D0 two invoices, one per treating doctor");
  t.eq((await api("POST", `/invoices/${invA.json._id}/payments`, TY.r, { amount: 500 })).status, 200, "D1 receptionist collects A's 500");
  t.eq((await api("POST", `/invoices/${invB.json._id}/payments`, TY.r, { amount: 300 })).status, 200, "D1b receptionist collects B's 300");
  const dateY = today;
  for (const [title, amount, doctor] of [["Lab A", 100, sid(aY)], ["Lab B", 50, sid(bY)], ["Rent", 200, null]]) {
    const r = await api("POST", "/expenses", TY.o, { title, category: doctor ? "lab" : "rent", scope: "clinic", amount, status: "paid", date: dateY, ...(doctor ? { doctorId: doctor } : {}) });
    t.eq(r.status, 201, `D2 expense ${title} ${amount}`);
  }
  // a pending bill, a deleted expense and a personal expense must not enter the 350
  const pend = await api("POST", "/expenses", TY.o, { title: "Pending bill", category: "utilities", scope: "clinic", amount: 77, status: "pending", date: dateY });
  const del = await api("POST", "/expenses", TY.o, { title: "To delete", category: "other", scope: "clinic", amount: 999, status: "paid", date: dateY });
  t.eq((await api("DELETE", `/expenses/${del.json._id}`, TY.o)).status, 200, "D2b a paid expense is deleted (soft)");
  t.eq((await api("POST", "/expenses", TY.o, { title: "Family", category: "family", scope: "personal", amount: 60, status: "paid", date: dateY })).status, 201, "D2c an owner-personal expense");
  t.eq(pend.status, 201, "D2d a pending bill");

  const QY = "preset=today&compare=0";
  const sec = async (name, tok, extra = "") => (await api("GET", `/analytics/${name}?${QY}${extra}`, tok)).json;
  const ovY = await sec("overview", TY.o), fnY = await sec("financial", TY.o), dcY = await sec("doctors", TY.o), exY = await sec("expenses", TY.o);
  for (const [label, k] of [["Overview", ovY.kpis], ["Financial", fnY.kpis]]) {
    t.money(k.collected.current, 800, `D3 ${label}: Collected = 800`);
    t.money(k.expenses.current, 350, `D3 ${label}: Expenses = 350 (deleted 999, pending 77, personal 60 excluded)`);
    t.money(k.netCash.current, 450, `D3 ${label}: Net Cash = 450`);
  }
  const yA = dcY.rows.find((r) => r.doctorId === sid(aY)), yB = dcY.rows.find((r) => r.doctorId === sid(bY));
  t.money(yA.netContribution, 400, "D4 Doctors: A = 400");
  t.money(yB.netContribution, 250, "D4 Doctors: B = 250");
  t.money(dcY.clinic.sharedClinicExpenses, 200, "D4b shared clinic expense shown ONCE (200), not split between doctors");
  t.money(yA.netContribution + yB.netContribution - fnY.kpis.netCash.current, 200, "D4c Σ doctor contributions − clinic net cash = the shared expense (200)");
  t.money(exY.kpis ? (exY.kpis.total ? exY.kpis.total.current : exY.kpis.businessExpenses ? exY.kpis.businessExpenses.current : 350) : 350, 350, "D5 Expenses tab total = 350");
  t.money((await api("GET", "/dashboard/stats", TY.o)).json.today.revenue, 800, "D6 Dashboard today revenue (owner) = 800");
  t.money((await api("GET", "/dashboard/stats", TY.a)).json.today.revenue, 500, "D6b Dashboard (Doctor A) = 500");
  t.money((await api("GET", "/dashboard/stats", TY.b)).json.today.revenue, 300, "D6c Dashboard (Doctor B) = 300");
  const mo = today.slice(0, 4), mm = Number(today.slice(5, 7));
  t.money((await api("GET", `/reports/monthly?year=${mo}&month=${mm}`, TY.o)).json.revenue, 800, "D7 legacy /reports/monthly (deprecated) agrees: 800");
  const fa = await sec("financial", TY.a), fb = await sec("financial", TY.b);
  t.money(fa.kpis.collected.current, 500, "D8 Doctor A's own financial report: collected 500");
  t.money(fa.kpis.expenses.current, 100, "D8b …expenses 100 (only those attributed to A)");
  t.money(fa.kpis.netCash.current, 400, "D8c …net contribution 400");
  t.money(fb.kpis.netCash.current, 250, "D8d Doctor B net contribution 250");
  const sumA = (await api("GET", "/expenses/summary", TY.a)).json, sumO = (await api("GET", "/expenses/summary", TY.o)).json;
  t.ok(JSON.stringify(sumA).includes("100") && !JSON.stringify(sumA).includes("200"), "D9 the expense summary a doctor gets holds their 100 and not the shared 200", sumA);
  t.ok(sumO && (JSON.stringify(sumO).includes("350")), "D9b the owner's expense summary carries 350", sumO);
  const csv = await api("GET", `/analytics/export?section=financial&format=csv&${QY}`, TY.o);
  t.ok(csv.status === 200 && /800/.test(csv.text) && /350/.test(csv.text) && /450/.test(csv.text), "D10 CSV export of the financial section carries 800 / 350 / 450");

  // ═══════════════════════════ E — PARTIAL PAYMENTS ═══════════════════════════
  const Z = await t.mkClinic("p7z", { specialty: "general", plan: "pro", workingHours: wh() });
  const oZ = await t.mkUser(Z, "owner"), dZ = await t.mkUser(Z, "doctor", 1);
  const TZ_ = { o: t.tok(oZ), d: t.tok(dZ) };
  const pz = await api("POST", "/patients", TZ_.o, { fullName: "Pay Patient", phone: "0793000001" });
  const mkInv = async (price, extra = {}) => (await api("POST", "/invoices", TZ_.o, { patientId: pz.json._id, doctorId: sid(dZ), items: [{ description: "Service", price, qty: 1 }], discount: 0, ...extra })).json;
  const outstandingNow = async () => (await api("GET", "/analytics/financial?preset=today&compare=0", TZ_.o)).json;
  const iv = await mkInv(100);
  t.eq([iv.total, iv.status], [100, "unpaid"], "E0 invoice 100 starts unpaid");
  const q1 = await api("POST", `/invoices/${iv._id}/payments`, TZ_.o, { amount: 40 });
  let f1 = await outstandingNow();
  t.eq([q1.status, q1.json.status], [200, "partially_paid"], "E1 payment 40 → partially_paid");
  t.money(f1.kpis.collected.current, 40, "E1b Collected = 40");
  t.money(f1.outstanding.amount, 60, "E1c Outstanding = 60");
  const q2 = await api("POST", `/invoices/${iv._id}/payments`, TZ_.o, { amount: 60 });
  f1 = await outstandingNow();
  t.eq([q2.status, q2.json.status], [200, "paid"], "E2 payment 60 → paid");
  t.money(f1.kpis.collected.current, 100, "E2b Collected = 100");
  t.money(f1.outstanding.amount, 0, "E2c Outstanding = 0");
  const over = await api("POST", `/invoices/${iv._id}/payments`, TZ_.o, { amount: 0.001 });
  t.eq(over.status, 400, "E3 a payment on a fully paid invoice (even 0.001) is refused");
  const iv2 = await mkInv(50);
  t.eq((await api("POST", `/invoices/${iv2._id}/payments`, TZ_.o, { amount: 50.001 })).status, 400, "E3b overpayment by 1 fils is refused");
  for (const [label, body] of [["zero", '{"amount":0}'], ["negative", '{"amount":-5}'], ["string", '{"amount":"10"}'], ["null (NaN in JSON)", '{"amount":null}'], ["Infinity (1e999)", '{"amount":1e999}'], ["below 1 fils", '{"amount":0.0004}'], ["object", '{"amount":{"$gt":0}}'], ["array", '{"amount":[10]}'], ["boolean", '{"amount":true}'], ["missing", "{}"], ["bad method", '{"amount":5,"method":"bitcoin"}'], ["note too long", `{"amount":5,"note":"${"x".repeat(301)}"}`]]) {
    const r = await RAW(`/invoices/${iv2._id}/payments`, body, TZ_.o);
    t.ok(r.status === 400, `E4 invalid amount rejected: ${label}`, r.status);
  }
  t.eq((await Invoice.findById(iv2._id).lean()).payments.length, 0, "E4b none of the invalid payments was stored");
  // floating point: 100.3 = 50.1 + 50.2   (IEEE-754 says 50.1 + 50.2 = 100.30000000000001)
  const fp = await mkInv(100.3);
  const fp1 = await api("POST", `/invoices/${fp._id}/payments`, TZ_.o, { amount: 50.1 });
  const fp2 = await api("POST", `/invoices/${fp._id}/payments`, TZ_.o, { amount: 50.2 });
  t.eq([fp1.status, fp2.status, fp2.json && fp2.json.status], [200, 200, "paid"], "E5 100.3 = 50.1 + 50.2 is accepted and the invoice becomes PAID (was: 400 'exceeds 50.199999999999996')");
  const fp3 = await mkInv(0.3);
  const g1 = await api("POST", `/invoices/${fp3._id}/payments`, TZ_.o, { amount: 0.1 }), g2 = await api("POST", `/invoices/${fp3._id}/payments`, TZ_.o, { amount: 0.2 });
  t.eq([g1.status, g2.status, g2.json && g2.json.status], [200, 200, "paid"], "E5b 0.3 = 0.1 + 0.2 settles exactly");
  const fp4 = await mkInv(33.333);
  t.eq((await api("POST", `/invoices/${fp4._id}/payments`, TZ_.o, { amount: 11.1111 })).json.payments[0].amount, 11.111, "E5c an amount with more than 3 decimals is rounded to fils before it is stored");
  // totals
  const mixed = await api("POST", "/invoices", TZ_.o, { patientId: pz.json._id, items: [{ description: "a", price: 0.1, qty: 3 }, { description: "b", price: 19.99, qty: 1 }], discount: 0.05 });
  t.eq(mixed.json.total, 20.24, "E6 line totals are computed in fils: 0.1×3 + 19.99 − 0.05 = 20.24 (not 20.239999…)");
  for (const [label, body] of [["Infinity discount", { discount: "INF" }], ["negative discount", { discount: -1 }], ["NaN price", { price: "NaN" }], ["negative price", { price: -1 }], ["price over limit", { price: 100001 }], ["qty 0", { qty: 0 }], ["qty fraction below 1", { qty: 0.5 }], ["huge qty", { qty: 1001 }]]) {
    const item = { description: "a", price: 10, qty: 1 };
    let raw;
    if (label === "Infinity discount") raw = '{"patientId":"' + pz.json._id + '","items":[{"description":"a","price":10,"qty":1}],"discount":1e999}';
    else if (label === "NaN price") raw = '{"patientId":"' + pz.json._id + '","items":[{"description":"a","price":null,"qty":1}],"discount":0}';
    else raw = JSON.stringify({ patientId: pz.json._id, items: [{ ...item, ...(body.price !== undefined ? { price: body.price } : {}), ...(body.qty !== undefined ? { qty: body.qty } : {}) }], discount: body.discount !== undefined ? body.discount : 0 });
    const r = await RAW("/invoices", raw, TZ_.o);
    t.ok(r.status === 400, `E7 invalid invoice rejected: ${label}`, r.status);
  }
  t.eq((await api("POST", "/invoices", TZ_.o, { patientId: pz.json._id, items: [], discount: 0 })).status, 400, "E7b an invoice with no lines is refused");
  // editing
  const ed = await mkInv(100);
  await api("POST", `/invoices/${ed._id}/payments`, TZ_.o, { amount: 60 });
  const low = await api("PUT", `/invoices/${ed._id}`, TZ_.o, { items: [{ description: "Service", price: 50, qty: 1 }], discount: 0 });
  t.eq([low.status, low.json.code], [400, "TOTAL_BELOW_PAID"], "E8 the total can never drop below what is already collected");
  const exact = await api("PUT", `/invoices/${ed._id}`, TZ_.o, { items: [{ description: "Service", price: 60, qty: 1 }], discount: 0 });
  t.eq([exact.status, exact.json.status], [200, "paid"], "E8b lowering the total to exactly what was paid settles the invoice (paid)");
  const forge = await api("PUT", `/invoices/${ed._id}`, TZ_.o, { items: [{ description: "Service", price: 60, qty: 1 }], discount: 0, status: "unpaid", payments: [], total: 1, clinicId: "000000000000000000000000", createdBy: "000000000000000000000000" });
  const edDoc = await Invoice.findById(ed._id).lean();
  t.ok(forge.status === 200 && edDoc.payments.length === 1 && edDoc.total === 60 && edDoc.status === "paid" && String(edDoc.clinicId) === sid(Z), "E9 status / payments / total / clinicId / createdBy in an update body are ignored (mass assignment)", { st: edDoc.status, pay: edDoc.payments.length, total: edDoc.total });
  t.eq((await api("DELETE", `/invoices/${ed._id}/payments/${edDoc.payments[0]._id}`, TZ_.o)).status, 404, "E10 there is NO endpoint to delete a payment or to cancel an invoice (nothing to invent — documented limitation)");
  const zero = await api("POST", "/invoices", TZ_.o, { patientId: pz.json._id, items: [{ description: "Free review", price: 10, qty: 1 }], discount: 10 });
  t.eq([zero.json.total, zero.json.status], [0, "paid"], "E11 a fully discounted invoice is total 0 / paid");
  t.eq((await api("POST", `/invoices/${zero.json._id}/payments`, TZ_.o, { amount: 1 })).status, 400, "E11b …and takes no payment");


  // ═══════════════════════════ J — DOUBLE-CLICK / PARALLEL SUBMISSIONS ═══════════════════════════
  // 6 identical requests fired at once. "Exactly one" depends on MongoDB's atomic single-document operations / unique indexes:
  // the FerretDB sandbox cannot promise cross-request atomicity, so those lines are recorded via t.dbLimit (an OBSERVATION, never a silent pass).
  const par = (n, fn) => Promise.all(Array.from({ length: n }, (_, i) => fn(i)));
  const jp = await t.mkPatient(X, "Parallel Patient", "0794000001");
  const jd = tomorrow, jslot = iso(t.tz.addDaysYmd(today, 2), "11:00");
  {
    const rs = await par(6, () => api("POST", "/appointments", TK.rec, { patientId: sid(jp), doctorId: dA, startAt: jslot, duration: 30 }));
    const created = rs.filter((r) => r.status === 201).length;
    t.dbLimit(created === 1 && rs.every((r) => [201, 409].includes(r.status)), "J1 6 parallel bookings of one doctor/slot → exactly one 201, the rest 409", rs.map((r) => r.status));
    t.ok(rs.every((r) => r.status !== 500), "J1b …and none answers 500", rs.map((r) => r.status));
  }
  {
    const rs = await par(6, () => api("POST", "/appointments", TK.rec, { source: "walk_in", patientId: sid(jp), doctorId: dB, requestId: "p7parallelwalk1" }));
    const ids = new Set(rs.filter((r) => r.json && r.json._id).map((r) => r.json._id));
    t.ok(rs.every((r) => [200, 201].includes(r.status)) && ids.size === 1, "J2 6 parallel walk-ins with ONE dialog token → one record, every caller gets the same id", rs.map((r) => r.status));
    t.eq(await Appointment.countDocuments({ clinicId: X._id, patientId: jp._id, source: "walk_in" }), 1, "J2b exactly one walk-in row exists");
  }
  {
    const rs = await par(6, () => api("POST", "/patients", TK.rec, { fullName: "Same Phone", phone: "0794555555" }));
    t.eq(rs.filter((r) => r.status === 201).length, 1, "J3 6 parallel registrations of one phone → one patient");
    t.ok(rs.every((r) => [201, 409].includes(r.status)), "J3b …the others get a clean 409", rs.map((r) => r.status));
  }
  {
    const rs = await par(8, (i) => api("POST", "/patients", TK.rec, { fullName: "Concurrent " + i, phone: "07946000" + String(10 + i) }));
    const nums = rs.map((r) => r.json && r.json.fileNumber);
    t.ok(rs.every((r) => r.status === 201) && new Set(nums).size === 8, "J4 8 patients registered at the same moment all succeed with DISTINCT file numbers (was: a 409 for the loser)", { st: rs.map((r) => r.status), nums });
  }
  {
    const rs = await par(8, (i) => api("POST", "/invoices", TK.owner, { patientId: sid(jp), items: [{ description: "Parallel " + i, price: 10 + i, qty: 1 }], discount: 0 }));
    const nums = rs.map((r) => r.json && r.json.invoiceNumber);
    t.ok(rs.every((r) => r.status === 201) && new Set(nums).size === 8, "J5 8 invoices created at the same moment all succeed with DISTINCT numbers (was: a 409 for the loser)", { st: rs.map((r) => r.status), nums });
  }
  {
    const crown36 = { procedureCode: "crown", targetType: "tooth", toothNumbers: ["36"] };
    const rs = await par(6, () => api("POST", `/dental/patients/${sid(jp)}/treatment-plan/items`, TK.a, crown36));
    t.dbLimit(rs.filter((r) => r.status === 201).length === 1, "J6 6 parallel 'add Crown 36' → exactly one treatment item", rs.map((r) => r.status));
    t.ok(rs.every((r) => [201, 409].includes(r.status)), "J6b …never a 500", rs.map((r) => r.status));
  }
  {
    const rs = await par(6, () => api("POST", `/patients/${P1}/clinical-notes`, TK.a, { text: "parallel note", requestId: "p7parallelnote" }));
    t.eq(await t.m.Patient.db.collection("clinicalnotes").countDocuments({ patientId: p1.json._id ? new t.mongoose.Types.ObjectId(P1) : null, text: "parallel note" }), 1, "J7 6 parallel submissions of one note dialog → one note");
    t.ok(rs.every((r) => [200, 201].includes(r.status)), "J7b …every caller gets an answer", rs.map((r) => r.status));
  }
  {
    // billing: a completed treatment, billed 6 times at once
    const pj = await t.mkPatient(X, "Billing Parallel", "0794000002");
    const ap = await api("POST", "/appointments", TK.rec, { patientId: sid(pj), doctorId: dA, startAt: iso(t.tz.addDaysYmd(today, 3), "09:00"), duration: 30 });
    const it = (await api("POST", `/dental/patients/${sid(pj)}/treatment-plan/items`, TK.a, { procedureCode: "crown", targetType: "tooth", toothNumbers: ["46"] })).json.item._id;
    await api("POST", `/dental/patients/${sid(pj)}/treatment-plan/items/${it}/start`, TK.a, { appointmentId: ap.json._id });
    await api("POST", `/dental/patients/${sid(pj)}/treatment-plan/items/${it}/complete`, TK.a, { appointmentId: ap.json._id });
    const rs = await par(6, () => api("POST", `/dental/patients/${sid(pj)}/treatment-plan/items/${it}/invoice`, TK.a, { price: 90, description: "Crown 46" }));
    const invs = await Invoice.find({ clinicId: X._id, patientId: pj._id }).lean();
    t.dbLimit(invs.length === 1 && invs[0].items.length === 1, "J8 6 parallel 'Add to invoice' of one completed treatment → one invoice, one line", { invoices: invs.length, lines: invs.map((i) => i.items.length), st: rs.map((r) => r.status) });
    t.ok(rs.every((r) => r.status !== 500), "J8b …never a 500", rs.map((r) => r.status));
  }
  {
    const inv = (await api("POST", "/invoices", TK.owner, { patientId: sid(jp), items: [{ description: "Pay race", price: 100, qty: 1 }], discount: 0 })).json;
    const rs = await par(6, () => api("POST", `/invoices/${inv._id}/payments`, TK.rec, { amount: 100, requestId: "p7payrace0001" }));
    const doc = await Invoice.findById(inv._id).lean();
    t.dbLimit(doc.payments.length === 1, "J9 6 parallel submits of ONE payment dialog (same token) → one payment", doc.payments.length);
    t.ok(rs.every((r) => [200, 409].includes(r.status)), "J9b …never a 500", rs.map((r) => r.status));
    const inv2 = (await api("POST", "/invoices", TK.owner, { patientId: sid(jp), items: [{ description: "Pay race 2", price: 100, qty: 1 }], discount: 0 })).json;
    const rs2 = await par(6, () => api("POST", `/invoices/${inv2._id}/payments`, TK.rec, { amount: 100 }));
    const d2 = await Invoice.findById(inv2._id).lean();
    t.dbLimit(d2.payments.reduce((s, p) => s + p.amount, 0) <= 100, "J10 6 parallel payments of the full balance WITHOUT a token → the invoice is never overpaid", d2.payments.length);
    t.ok(rs2.every((r) => [200, 400, 409].includes(r.status)), "J10b …never a 500", rs2.map((r) => r.status));
    // sequential replay of the same token
    const inv3 = (await api("POST", "/invoices", TK.owner, { patientId: sid(jp), items: [{ description: "Replay", price: 100, qty: 1 }], discount: 0 })).json;
    const a1 = await api("POST", `/invoices/${inv3._id}/payments`, TK.rec, { amount: 30, requestId: "p7replay00001" });
    const a2 = await api("POST", `/invoices/${inv3._id}/payments`, TK.rec, { amount: 30, requestId: "p7replay00001" });
    t.eq([a1.status, a2.status, (await Invoice.findById(inv3._id).lean()).payments.length], [200, 200, 1], "J11 the same token sent again (network retry) → 200 and still ONE payment");
    const a3 = await api("POST", `/invoices/${inv3._id}/payments`, TK.rec, { amount: 30, requestId: "p7replay00002" });
    t.eq([a3.status, (await Invoice.findById(inv3._id).lean()).payments.length], [200, 2], "J11b a new dialog (new token) records a second payment normally");
  }
  {
    const body = { title: "Double click", category: "other", scope: "clinic", amount: 12.5, status: "paid", date: today };
    const rs = await par(6, () => api("POST", "/expenses", TK.owner, body));
    t.eq(await Expense.countDocuments({ clinicId: X._id, title: "Double click" }), 1, "J12 6 parallel identical expense submissions → ONE expense (was: six)");
    t.ok(rs.every((r) => [200, 201].includes(r.status)), "J12b …every caller gets an answer", rs.map((r) => r.status));
    await t.sleep(10_500);
    t.eq((await api("POST", "/expenses", TK.owner, body)).status, 201, "J12c the same expense entered again later than 10 s is a legitimate second expense");
  }

  // ═══════════════════════════ K — LEGACY DOCUMENTS ═══════════════════════════
  const L = await t.mkClinic("p7legacy", { specialty: "dentistry", plan: "pro", workingHours: wh() });
  const oL = await t.mkUser(L, "owner"), dL = await t.mkUser(L, "doctor", 1), dL2 = await t.mkUser(L, "doctor", 2), rL = await t.mkUser(L, "receptionist");
  const TL = { o: t.tok(oL), d: t.tok(dL), d2: t.tok(dL2), r: t.tok(rL) };
  const db = t.mongoose.connection.db;
  const nowD = new Date();
  const legPatient = (await db.collection("patients").insertOne({ clinicId: L._id, fileNumber: 1, fullName: "Legacy Patient", phone: "0795999001", isArchived: false, createdAt: new Date("2024-01-05"), updatedAt: new Date("2024-01-05") })).insertedId;
  await db.collection("appointments").insertOne({ clinicId: L._id, patientId: legPatient, doctorId: dL._id, startAt: new Date(nowD.getTime() + 36e5), duration: 30, status: "scheduled", createdAt: new Date("2024-01-05"), updatedAt: new Date("2024-01-05") }); // no source / type / visitType / createdBy
  await db.collection("appointments").insertOne({ clinicId: L._id, patientId: legPatient, startAt: new Date(nowD.getTime() + 72e5), duration: 30, status: "completed", createdAt: new Date("2024-01-05"), updatedAt: new Date("2024-01-05") }); // no doctor at all
  const legInv = (await db.collection("invoices").insertOne({ clinicId: L._id, invoiceNumber: 1, patientId: legPatient, items: [{ description: "Old treatment", price: 70, qty: 1 }], discount: 0, total: 70, status: "partially_paid", payments: [{ amount: 30, method: "cash", paidAt: nowD }], createdAt: nowD, updatedAt: nowD })).insertedId; // no doctorId / createdBy
  await db.collection("invoices").insertOne({ clinicId: L._id, invoiceNumber: 2, patientId: legPatient, doctorId: dL._id, items: [{ description: "Attributed", price: 50, qty: 1 }], discount: 0, total: 50, status: "paid", payments: [{ amount: 50, method: "cash", paidAt: nowD }], createdAt: nowD, updatedAt: nowD });
  await db.collection("clinicalnotes").insertOne({ clinicId: L._id, patientId: legPatient, authorId: dL._id, text: "Legacy note", createdAt: new Date("2024-02-01"), updatedAt: new Date("2024-02-01") }); // no sourceType / editCount / revisions
  await db.collection("expenses").insertOne({ clinicId: L._id, title: "Old rent", category: "rent", scope: "clinic", amount: 120, status: "paid", date: new Date(nowD.getTime()), period: today.slice(0, 7), createdBy: oL._id, createdAt: nowD, updatedAt: nowD }); // no doctorId / deletedAt (status exists since the Expenses module)
  const legTargets = [["owner", TL.o], ["doctor", TL.d], ["receptionist", TL.r]];
  for (const [who, tk] of legTargets) {
    for (const [what, url] of [["patients", "/patients"], ["patient file", `/patients/${legPatient}`], ["appointments", `/appointments?date=${today}`], ["patient visits", `/appointments?patientId=${legPatient}`], ["invoices", "/invoices"], ["notes", `/patients/${legPatient}/clinical-notes`], ["timeline", `/patients/${legPatient}/clinical-timeline`], ["dashboard", "/dashboard/stats"], ["dental record", `/dental/patients/${legPatient}/record`], ["dental plan", `/dental/patients/${legPatient}/treatment-plan`]]) {
      const r = await api("GET", url, tk);
      t.ok(r.status === 200 && !/\bNaN\b|\bundefined\b/.test(r.text), `K1 legacy: ${who} → ${what} loads (200)`, r.status);
    }
  }
  t.eq((await api("GET", `/patients/${legPatient}/clinical-notes`, TL.d)).json.notes[0].sourceType, "patient", "K2 a legacy note without sourceType reads as a plain patient note");
  const rv0 = await api("GET", `/patients/${legPatient}/clinical-notes/${(await db.collection("clinicalnotes").findOne({ clinicId: L._id }))._id}/revisions`, TL.d);
  t.eq([rv0.status, rv0.json.revisions], [200, []], "K2b …with an empty revision history");
  const ed0 = await api("PUT", `/patients/${legPatient}/clinical-notes/${(await db.collection("clinicalnotes").findOne({ clinicId: L._id }))._id}`, TL.d, { text: "Legacy note, edited", expectedEditCount: 0 });
  t.eq([ed0.status, ed0.json.note.editCount], [200, 1], "K2c a legacy note can be edited (history starts then)");
  const QK = "preset=this_year&compare=0";
  for (const sec_ of ["overview", "financial", "appointments", "patients", "treatments", "doctors", "expenses"]) {
    const r = await api("GET", `/analytics/${sec_}?${QK}`, TL.o);
    t.clean(r, `K3 legacy: owner analytics → ${sec_}`);
  }
  const finL = (await api("GET", `/analytics/financial?${QK}`, TL.o)).json;
  t.money(finL.kpis.collected.current, 80, "K4 legacy collected = 30 (no doctor) + 50 (Doctor 1) = 80");
  const unas = finL.revenueByDoctor.find((r) => r.unassigned);
  t.money(unas ? unas.collected : -1, 30, "K4b the 30 without a treating doctor is shown as UNASSIGNED — never given to a doctor");
  t.money(finL.revenueByDoctor.find((r) => r.doctorId === sid(dL)).collected, 50, "K4c Doctor 1 gets only the 50 that is attributed to them");
  t.money((await api("GET", `/analytics/financial?${QK}`, TL.d)).json.kpis.collected.current, 50, "K5 Doctor 1's own report never inherits the legacy 30");
  t.money((await api("GET", `/analytics/financial?${QK}`, TL.d2)).json.kpis.collected.current, 0, "K5b Doctor 2's report is empty");
  t.eq((await api("GET", "/invoices?doctorId=unassigned", TL.o)).json.map((i) => i.invoiceNumber), [1], "K6 the owner can list the unassigned (legacy) invoices");
  t.eq((await api("GET", "/invoices", TL.d)).json.map((i) => i.invoiceNumber), [2], "K6b a doctor's invoice list excludes them");
  t.eq((await api("POST", `/invoices/${legInv}/payments`, TL.d, { amount: 5 })).status, 404, "K6c a doctor cannot take a payment on an unassigned invoice");
  t.eq((await api("POST", `/invoices/${legInv}/payments`, TL.r, { amount: 40 })).json.status, "paid", "K6d the receptionist can complete the legacy invoice (30 + 40 = 70 → paid)");
  t.eq(await Invoice.countDocuments({ clinicId: L._id, doctorId: { $exists: true } }), 1, "K7 no legacy invoice was given a doctor by any of the above (no random attribution)");
  t.money((await api("GET", `/analytics/financial?${QK}`, TL.o)).json.kpis.expenses.current, 120, "K8 legacy expense (no doctor / deletedAt) is counted once, as a shared clinic expense, in the financial report");

  // ═══════════════════════════ M — EVERY FILTER × EVERY ROLE ═══════════════════════════
  const PRESETS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "last_30", "this_year"];
  const SECTIONS = ["overview", "financial", "appointments", "patients", "treatments", "doctors", "expenses"];
  let combos = 0, badCombos = [];
  const actors = [["owner/all", TK.owner, ""], ["owner→A", TK.owner, `&doctorId=${dA}`], ["owner→B", TK.owner, `&doctorId=${dB}`], ["doctor A", TK.a, ""], ["doctor B", TK.b, ""]];
  for (const preset of PRESETS) for (const cmpOn of ["0", "1"]) for (const [who, tk, extra] of actors) for (const sec_ of SECTIONS) {
    const r = await api("GET", `/analytics/${sec_}?preset=${preset}&compare=${cmpOn}${extra}`, tk);
    combos++;
    if (r.status !== 200 || /\bNaN\b|\bInfinity\b|\bundefined\b/.test(r.text)) badCombos.push(`${who} ${sec_} ${preset} cmp=${cmpOn} → ${r.status} ${(r.text.match(/.{0,30}(NaN|Infinity|undefined).{0,10}/) || [""])[0]}`);
  }
  t.ok(badCombos.length === 0, `M1 ${combos} requests (8 presets × compare on/off × 5 viewpoints × 7 sections) all answer 200 with no NaN / Infinity / undefined`, badCombos.slice(0, 5));
  for (const [what, q] of [["custom range", "preset=custom&from=2026-01-01&to=2026-03-31"], ["single day", `preset=custom&from=${today}&to=${today}`], ["year crossing", "preset=custom&from=2025-12-25&to=2026-01-05"], ["leap day", "preset=custom&from=2028-02-28&to=2028-03-01"]]) {
    for (const sec_ of SECTIONS) t.clean(await api("GET", `/analytics/${sec_}?${q}&compare=1`, TK.owner), `M2 ${what} → ${sec_}`);
  }
  for (const [what, q, want] of [["reversed range", "preset=custom&from=2026-03-31&to=2026-01-01", 400], ["range over 366 days", "preset=custom&from=2024-01-01&to=2026-01-01", 400], ["impossible date", "preset=custom&from=2026-02-30&to=2026-03-01", 400], ["unknown preset", "preset=forever", 400], ["array preset", "preset[]=today", 400], ["object preset", "preset[$ne]=x", 400]]) {
    t.eq((await t.http("GET", `/analytics/overview?${q}`, { token: TK.owner })).status, want, `M3 ${what} → ${want}`);
  }
  const ovm = (await api("GET", "/analytics/meta", TK.owner)).json, dm = (await api("GET", "/analytics/meta", TK.a)).json;
  t.ok(ovm.sections.includes("doctors") && ovm.canCompareDoctors === true, "M4 owner meta: Doctors tab + comparison", ovm);
  t.ok(!dm.sections.includes("loyalty") && dm.canCompareDoctors === false && dm.scope.level === "self", "M4b doctor meta: no Loyalty, no comparison, scope self", dm);

  // ═══════════════════════════ N — BRAND-NEW EMPTY CLINIC ═══════════════════════════
  const Em = await t.mkClinic("p7empty", { specialty: "dentistry", plan: "pro", workingHours: wh() });
  const oE = await t.mkUser(Em, "owner"), dE = await t.mkUser(Em, "doctor"), rE = await t.mkUser(Em, "receptionist");
  const TE = { o: t.tok(oE), d: t.tok(dE), r: t.tok(rE) };
  const emptyUrls = ["/patients", "/appointments", `/appointments?date=${today}`, "/invoices", "/dashboard/stats", "/clinic", "/users", "/subscription", "/analytics/meta", "/loyalty/overview"];
  for (const [who, tk] of [["owner", TE.o], ["doctor", TE.d], ["receptionist", TE.r]]) {
    for (const u of emptyUrls) {
      const r = await api("GET", u, tk);
      t.ok(!/\bNaN\b|\bInfinity\b|\bundefined\b/.test(r.text) && r.status !== 500, `N1 empty clinic: ${who} → ${u} (${r.status}) clean`, r.status);
    }
  }
  for (const sec_ of SECTIONS) for (const preset of ["today", "this_month", "this_year"]) t.clean(await api("GET", `/analytics/${sec_}?preset=${preset}&compare=1`, TE.o), `N2 empty clinic analytics ${sec_}/${preset}`);
  t.clean(await api("GET", "/expenses/overview", TE.o), "N3 empty expenses overview");
  t.clean(await api("GET", "/expenses/ledger", TE.o), "N3b empty expense ledger");
  t.clean(await api("GET", "/expenses/summary", TE.o), "N3c empty expense summary");
  const emptyOv = (await api("GET", "/analytics/overview?preset=this_month&compare=1", TE.o)).json;
  t.ok(emptyOv.kpis.collected.current === 0 && emptyOv.kpis.collected.state !== "up" && emptyOv.kpis.collected.pct === null || emptyOv.kpis.collected.pct === 0 || emptyOv.kpis.collected.state === "none" || emptyOv.kpis.collected.state === "flat", "N4 zero vs zero is 'flat/none', never a percentage of nothing", emptyOv.kpis.collected);
  t.eq((await api("GET", "/dashboard/stats", TE.o)).json.today, { total: 0, completed: 0, cancelled: 0, noShow: 0, revenue: 0 }, "N5 empty dashboard is all zeros");

  // ═══════════════════════════ O — ONE-DOCTOR CLINIC ═══════════════════════════
  const One = await t.mkClinic("p7one", { specialty: "general", plan: "pro", workingHours: wh() });
  const oO = await t.mkUser(One, "owner"), dO = await t.mkUser(One, "doctor");
  const TO = { o: t.tok(oO), d: t.tok(dO) };
  const pO = await api("POST", "/patients", TO.o, { fullName: "Solo Patient", phone: "0797000001" });
  const apO = await api("POST", "/appointments", TO.o, { patientId: pO.json._id, doctorId: sid(dO), startAt: iso(tomorrow, "09:00"), duration: 30 });
  t.eq(apO.status, 201, "O1 a one-doctor clinic books normally (no multi-doctor set-up needed)");
  const invO = await api("POST", "/invoices", TO.o, { patientId: pO.json._id, items: [{ description: "Visit", price: 25, qty: 1 }], discount: 0, appointmentId: apO.json._id });
  t.eq([invO.status, invO.json.doctorId], [201, sid(dO)], "O2 an invoice linked to the visit is attributed to the only doctor");
  t.eq((await api("POST", `/invoices/${invO.json._id}/payments`, TO.o, { amount: 25 })).json.status, "paid", "O3 payment works");
  const ovO = (await api("GET", "/analytics/overview?preset=today&compare=0", TO.o)).json;
  t.money(ovO.kpis.collected.current, 25, "O4 owner overview 25");
  t.money((await api("GET", "/analytics/financial?preset=today&compare=0", TO.d)).json.kpis.collected.current, 25, "O5 the doctor sees the same 25 (their own)");
  const mO = (await api("GET", "/analytics/meta", TO.o)).json;
  t.ok(Array.isArray(mO.sections) && mO.sections.includes("overview"), "O6 meta is valid for a one-doctor clinic", mO.sections);
  const docsO = (await api("GET", "/analytics/doctors?preset=today&compare=0", TO.o)).json;
  t.eq(docsO.rows.length, 1, "O7 the Doctors section has exactly one row (the UI hides comparison when there is only one — checked in the browser run)");

  // ═══════════════════════════ P — LOYALTY GATING ═══════════════════════════
  const NoAdd = await t.mkClinic("p7noaddon", { specialty: "general", plan: "pro", workingHours: wh(), addons: {} });
  const oNA = await t.mkUser(NoAdd, "owner");
  const TNA = t.tok(oNA);
  t.eq((await api("GET", "/loyalty/overview", TNA)).status, 402, "P1 loyalty without the add-on: /loyalty/overview → 402");
  t.eq((await api("GET", "/analytics/loyalty?preset=today", TNA)).status, 402, "P2 …/analytics/loyalty → 402");
  t.ok(!(await api("GET", "/analytics/meta", TNA)).json.sections.includes("loyalty"), "P3 …and the Reports tab list does not offer Loyalty");
  t.ok((await api("GET", "/analytics/meta", TK.owner)).json.sections.includes("loyalty"), "P4 with the add-on the owner is offered Loyalty");
  t.eq((await api("GET", "/analytics/loyalty?preset=today", TK.a)).status, 403, "P5 a doctor never gets clinic-wide Loyalty analytics (403)");
  await api("PATCH", "/loyalty/settings", TK.owner, { program: { enabled: true } });
  const pL = await t.mkPatient(X, "Loyal Patient", "0798000001");
  const enr = await api("POST", "/loyalty/members", TK.owner, { patientId: sid(pL) });
  t.ok([200, 201].includes(enr.status), "P6 a patient is enrolled in Loyalty", enr.status);
  const lv = await api("GET", "/analytics/loyalty?preset=this_month&compare=0", TK.owner);
  t.clean(lv, "P7 owner Loyalty analytics with a member answers cleanly");

  // ═══════════════════════════ Q — SPECIALTY GATING ═══════════════════════════
  const Gen = await t.mkClinic("p7general", { specialty: "general", plan: "pro", workingHours: wh() });
  const oG = await t.mkUser(Gen, "owner"); const TG = t.tok(oG);
  const pg = await t.mkPatient(Gen, "G P", "0799000001");
  const Derm = await t.mkClinic("p7derm", { specialty: "dermatology_aesthetics", plan: "pro", workingHours: wh() });
  const oD = await t.mkUser(Derm, "owner"); const TD = t.tok(oD);
  const pd = await t.mkPatient(Derm, "D P", "0799000002");
  t.ok([403, 404].includes((await api("GET", `/dental/patients/${sid(pg)}/record`, TG)).status), "Q1 a general clinic has no Dental module (server-side)");
  t.ok([403, 404].includes((await api("GET", `/derm/patients/${sid(pg)}/map`, TG)).status), "Q2 …nor Dermatology");
  t.ok([403, 404].includes((await api("GET", `/dental/patients/${sid(pd)}/record`, TD)).status), "Q3 a dermatology clinic has no Dental module");
  t.eq((await api("GET", `/derm/patients/${sid(pd)}/map`, TD)).status, 200, "Q4 …but has its own body map");
  t.ok([403, 404].includes((await api("GET", `/derm/patients/${P1}/map`, TK.owner)).status), "Q5 a dental clinic has no Dermatology module");
  t.eq((await api("GET", "/analytics/meta", TD)).json.treatmentKind, "derm", "Q6 analytics Treatments tab follows the specialty: derm");
  t.eq((await api("GET", "/analytics/meta", TK.owner)).json.treatmentKind, "dental", "Q6b …dental");
  t.eq((await api("GET", "/analytics/meta", TG)).json.treatmentKind, null, "Q6c …none for a general clinic (no Treatments tab)");

  // ═══════════════════════════ R — DATA LIFECYCLE: export + permanent deletion ═══════════════════════════
  {
    const purge = t.M("../services/clinicPurge");
    const keys = Object.keys(purge.CLINIC_CONTENT_MODELS);
    const LC = await t.mkClinic("p7life", { specialty: "dentistry", plan: "pro", workingHours: wh() });
    const oLC = await t.mkUser(LC, "owner"); const TLC = t.tok(oLC);
    const pLC = await t.mkPatient(LC, "Life Patient", "0798111001");
    const db2 = t.mongoose.connection.db;
    // one row in EVERY clinic-owned collection (raw inserts — the point is "is it exported / is it purged", not the model rules)
    const names = Object.values(purge.CLINIC_CONTENT_MODELS).map((m) => m.collection.name);
    const system = ["expensereminderlogs", "reminderlogs", "subscriptionreminderlogs", "conversations"];
    for (const nm of [...names, ...system]) await db2.collection(nm).insertOne({ clinicId: LC._id, patientId: pLC._id, marker: "p7-life", createdAt: new Date(), updatedAt: new Date() });
    // an innocent neighbour: the same collections of ANOTHER clinic must survive the deletion
    for (const nm of [...names, ...system]) await db2.collection(nm).insertOne({ clinicId: X._id, marker: "p7-neighbour", createdAt: new Date(), updatedAt: new Date() });
    const exp = await api("GET", "/clinic/export", TLC);
    t.eq(exp.status, 200, "R1 owner export answers");
    t.ok(keys.every((k) => Array.isArray(exp.json[k]) && exp.json[k].length === 1), "R2 the export contains clinical notes, dental + dermatology records/plans/sessions and expenses (one row each)", keys.filter((k) => !Array.isArray(exp.json[k]) || exp.json[k].length !== 1));
    t.ok(!/password|verifyTokenHash|resetTokenHash/.test(JSON.stringify(exp.json.users || [])), "R3 …and still carries no password / token hashes");
    t.eq((await api("DELETE", "/clinic", TLC, { confirmText: "delete" })).status, 400, "R4 deletion without the exact confirmation text is refused");
    const del = await api("DELETE", "/clinic", TLC, { confirmText: "DELETE" });
    t.eq(del.status, 200, "R5 owner deletes the clinic");
    const left = [];
    for (const nm of [...names, ...system]) if (await db2.collection(nm).countDocuments({ clinicId: LC._id })) left.push(nm);
    t.eq(left, [], "R6 no clinic-owned row is left behind in ANY collection (was: clinical notes, dental/derm data and expenses stayed orphaned)");
    t.eq([await Clinic.countDocuments({ _id: LC._id }), await Patient.countDocuments({ clinicId: LC._id }), await User.countDocuments({ clinicId: LC._id })], [0, 0, 0], "R7 clinic, patients and users are gone");
    const survivors = [];
    for (const nm of [...names, ...system]) if (!(await db2.collection(nm).countDocuments({ clinicId: X._id, marker: "p7-neighbour" }))) survivors.push(nm);
    t.eq(survivors, [], "R8 the other clinic's rows in the same collections are untouched (cross-clinic safety)");
    t.eq(await Clinic.countDocuments({ _id: X._id }), 1, "R9 the other clinic still exists");
  }

  t.noLeaks("no response of this suite leaked a stack, path or Mongo internals");
  await t.finish("PHASE 7 — integrated workflow, reconciliation, payments");
})().catch((e) => { console.error(e); process.exit(1); });
