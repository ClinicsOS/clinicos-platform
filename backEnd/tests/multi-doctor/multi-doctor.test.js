/* PHASE 4 — multi-doctor architecture: roles, permissions, data ownership. ATTACKER-STYLE, end-to-end against the COMPILED server
   (real HTTP, real database, nothing mocked). Reuses tests/phase10/lib.js.
     npm run build && node tests/multi-doctor/multi-doctor.test.js
   Optional env: P10_MONGO (default mongodb://127.0.0.1:27017), P10_DIST, P10_OUT.
   World: Clinic A (dentistry, pro): Owner, Doctor X, Doctor Y, Receptionist.  Clinic B: Owner, Doctor, Receptionist. */
const path = require("path");
const { boot } = require("../phase10/lib");
const DIST = process.env.P10_DIST || path.resolve(__dirname, "../../dist");
const tz = require(path.join(DIST, "utils/timezone"));
const AMMAN = "Asia/Amman";

(async () => {
  // FerretDB (the sandbox database) lacks $dateToString; this test-only preload buckets the daily series in JS — see the file header.
  const t = await boot({ name: "multi_doctor", port: 5304, env: { NODE_OPTIONS: `--require ${path.join(__dirname, "ferret-date-shim.js")} --require ${path.join(__dirname, "../analytics/agg-emulator.js")} --require ${path.join(__dirname, "../phase7/expr-shim.js")}` } });
  const { ok, eq, http, m } = t;
  const { Appointment, Invoice, User, Patient } = m;
  const { ClinicalNote } = t.M("ClinicalNote");
  const { DentalTreatmentItem } = t.M("DentalTreatmentItem");
  const sid = (x) => String(x._id);

  const today = tz.clinicYmdOf(new Date(), AMMAN);
  const D = tz.addDaysYmd(today, 2); // a future clinic-local day (every day is open in this world)
  const at = (ymd, hhmm) => tz.clinicLocalToUtc(ymd, hhmm, AMMAN).toISOString();
  const wh = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, from: "09:00", to: "17:00" }));
  const A = await t.mkClinic("md-a", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const B = await t.mkClinic("md-b", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const owner = await t.mkUser(A, "owner"), docX = await t.mkUser(A, "doctor", 1), docY = await t.mkUser(A, "doctor", 2), rec = await t.mkUser(A, "receptionist");
  const ownerB = await t.mkUser(B, "owner"), docB = await t.mkUser(B, "doctor"), recB = await t.mkUser(B, "receptionist");
  const tkO = t.tok(owner), tkX = t.tok(docX), tkY = t.tok(docY), tkR = t.tok(rec), tkOB = t.tok(ownerB), tkDB = t.tok(docB), tkRB = t.tok(recB);
  const pats = []; for (let i = 0; i < 12; i++) pats.push(await t.mkPatient(A, "Patient " + i));
  const pB = await t.mkPatient(B, "B patient");
  const api = (method, url, token, body) => http(method, url, { token, body });

  /* ============ fixtures: appointments, invoices ============ */
  const book = async (patient, doc, hhmm, token = tkR, extra = {}) => api("POST", "/appointments", token, { patientId: sid(patient), doctorId: sid(doc), startAt: at(D, hhmm), duration: 30, ...extra });
  const aX1 = await book(pats[0], docX, "10:00"), aX2 = await book(pats[1], docX, "11:00");
  const aY1 = await book(pats[2], docY, "10:00"), aY2 = await book(pats[3], docY, "12:00");
  eq([aX1.status, aX2.status, aY1.status, aY2.status], [201, 201, 201, 201], "S0 fixtures: four scheduled appointments (X 10:00/11:00, Y 10:00/12:00)");
  const payNow = (inv, amount) => Invoice.updateOne({ _id: inv._id }, { $push: { payments: { amount, method: "cash", paidAt: new Date() } }, $set: { status: amount >= inv.total ? "paid" : "partially_paid" } });
  const mkInv = async (token, body) => (await api("POST", "/invoices", token, { items: [{ description: "Service", price: 100, qty: 1 }], ...body })).json;
  const iX = await mkInv(tkX, { patientId: sid(pats[0]) });                                  // doctor X creates (self)
  const iY = await mkInv(tkY, { patientId: sid(pats[2]), items: [{ description: "Service", price: 60, qty: 1 }] });
  const iR = await mkInv(tkR, { patientId: sid(pats[3]), doctorId: sid(docY), items: [{ description: "Service", price: 40, qty: 1 }] }); // receptionist creates FOR doctor Y
  const iL = await Invoice.create({ clinicId: A._id, invoiceNumber: 70900, patientId: pats[4]._id, items: [{ description: "Legacy", price: 25, qty: 1 }], total: 25, status: "unpaid" }); // pre-Phase-4 invoice: no doctor, no creator
  const iB = await Invoice.create({ clinicId: B._id, invoiceNumber: 1, patientId: pB._id, items: [{ description: "B", price: 999, qty: 1 }], total: 999, status: "unpaid" });
  await payNow(iX, 100); await payNow(iY, 60); await payNow(iR, 40); await payNow(iL, 25); await payNow(iB, 999);

  /* ================= A. authentication + the access matrix ================= */
  for (const [m_, u] of [["GET", "/invoices"], ["GET", "/reports/monthly"], ["GET", "/dashboard/stats"], ["GET", "/appointments"], ["GET", "/users"]]) eq((await api(m_, u)).status, 401, `A1 ${m_} ${u} needs a token`);
  const meO = (await api("GET", "/auth/me", tkO)).json, meX = (await api("GET", "/auth/me", tkX)).json, meR = (await api("GET", "/auth/me", tkR)).json;
  eq([meO.access.reports, meX.access.reports, meR.access.reports], ["clinic", "self", "none"], "A2 /auth/me tells each role its report scope (clinic / self / none)");
  eq([meO.access.invoices, meX.access.invoices, meR.access.invoices], ["clinic", "self", "clinic"], "A3 …invoice scope");
  eq([meX.access.dashboardRevenue, meR.access.dashboardRevenue, meX.access.clinicalWrite, meR.access.clinicalWrite], ["self", "none", "clinic", "none"], "A4 …dashboard money + clinical-write rights");
  eq([(await api("GET", "/reports/monthly", tkO)).status, (await api("GET", "/reports/monthly", tkX)).status, (await api("GET", "/reports/monthly", tkR)).status], [200, 200, 403], "A5 reports: owner 200, doctor 200 (own data), receptionist 403");
  for (const [who, tk] of [["doctor", tkX], ["receptionist", tkR]]) {
    eq((await api("POST", "/users", tk, { name: "Evil", email: "evil@t.io", password: "secret123", role: "doctor", phone: "0790000000" })).status, 403, `A6 ${who} cannot create staff`);
    eq((await api("PATCH", "/clinic", tk, { name: "Hacked" })).status, 403, `A7 ${who} cannot edit the clinic`);
    eq((await api("GET", "/clinic/export", tk)).status, 403, `A8 ${who} cannot export the clinic`);
    // PHASE 5: a doctor may now READ their own attributed expenses (/expenses/ledger, /summary); the owner-only finance surface stays closed.
    eq((await api("GET", "/expenses/overview", tk)).status, 403, `A9 ${who} cannot reach the owner expense overview`);
    eq((await api("PUT", `/users/${sid(docX)}/working-hours`, tk, { workingHours: null })).status, 403, `A10 ${who} cannot set a doctor's working hours`);
    eq((await api("PATCH", `/users/${sid(docY)}/active`, tk, { isActive: false })).status, 403, `A11 ${who} cannot deactivate staff`);
  }
  const staffR = (await api("GET", "/users", tkR)).json, staffO = (await api("GET", "/users", tkO)).json;
  ok(staffR.length === 4 && staffR.every((s) => s.email === undefined && s.phone === undefined), "A12 a receptionist's team list has no colleagues' e-mail / phone", staffR[0]);
  ok(staffO.every((s) => typeof s.email === "string"), "A13 the owner's team list is complete");

  /* ================= B. owner: clinic-wide + per-doctor filter ================= */
  const invsO = (await api("GET", "/invoices", tkO)).json;
  eq(invsO.length, 4, "B1 the owner sees every invoice of the clinic (and none of clinic B)");
  eq((await api("GET", `/invoices?doctorId=${sid(docX)}`, tkO)).json.map((i) => i.invoiceNumber), [iX.invoiceNumber], "B2 owner filter by Doctor X");
  eq((await api("GET", `/invoices?doctorId=${sid(docY)}`, tkO)).json.length, 2, "B3 owner filter by Doctor Y (own + the one a receptionist created for Y)");
  eq((await api("GET", "/invoices?doctorId=unassigned", tkO)).json.map((i) => i.invoiceNumber), [70900], "B4 owner filter 'unassigned' = the legacy invoice only");
  eq((await api("GET", "/invoices?doctorId=not-an-id", tkO)).status, 400, "B5 a malformed doctor id is a 400");
  eq((await api("GET", "/invoices?doctorId[$ne]=x", tkO)).status, 400, "B6 an operator-injection attempt in doctorId is a 400");
  const stO = (await api("GET", "/dashboard/stats", tkO)).json;
  eq(stO.today.revenue, 225, "B7 owner dashboard: clinic-wide revenue (100+60+40+25)");
  eq((await api("GET", `/dashboard/stats?doctorId=${sid(docX)}`, tkO)).json.today.revenue, 100, "B8 owner dashboard narrowed to Doctor X");
  const rO = (await api("GET", "/reports/monthly", tkO)).json;
  eq([rO.revenue, rO.attribution.unassignedRevenue, rO.attribution.attributedRevenue], [225, 25, 200], "B9 owner report: clinic revenue, with the unattributed legacy share shown honestly");
  ok(typeof rO.newPatients === "number", "B10 owner clinic-wide report keeps new-patient counts");
  const rOX = (await api("GET", `/reports/monthly?doctorId=${sid(docX)}`, tkO)).json;
  eq([rOX.revenue, rOX.newPatients, rOX.attribution], [100, null, undefined], "B11 owner report narrowed to Doctor X: revenue 100, new patients NOT faked (null)");
  eq((await api("GET", "/reports/monthly?doctorId=unassigned", tkO)).status, 400, "B12 'unassigned' is not a valid report filter");
  const boardO = (await api("GET", `/appointments?date=${D}`, tkO)).json;
  eq(boardO.length, 4, "B13 owner board: both doctors' appointments");
  eq((await api("GET", `/appointments?date=${D}&doctorId=${sid(docY)}`, tkO)).json.length, 2, "B14 owner board filtered to Doctor Y");

  /* ================= C. Doctor X: own private data only ================= */
  const invsX = (await api("GET", "/invoices", tkX)).json;
  eq(invsX.map((i) => i.invoiceNumber), [iX.invoiceNumber], "C1 doctor X lists only the invoice attributed to X");
  eq((await api("GET", `/invoices?doctorId=${sid(docY)}`, tkX)).status, 403, "C2 doctor X asking for Y's invoices is refused");
  eq((await api("GET", "/invoices?doctorId=unassigned", tkX)).status, 403, "C3 …and for the unassigned bucket");
  eq((await api("GET", `/invoices?doctorId=${sid(docX)}`, tkX)).json.length, 1, "C4 asking for himself is fine");
  eq((await api("GET", `/invoices?patientId=${sid(pats[2])}`, tkX)).json.length, 0, "C5 Y's patient's invoice is not reachable through the patient filter");
  eq((await api("GET", `/invoices?search=${encodeURIComponent("Patient 2")}`, tkX)).json.length, 0, "C6 …nor through search");
  const stX = (await api("GET", "/dashboard/stats", tkX)).json;
  eq(stX.today.revenue, 100, "C7 doctor X's dashboard revenue = only X's invoices (not 225)");
  eq((await api("GET", `/dashboard/stats?doctorId=${sid(docY)}`, tkX)).status, 403, "C8 doctor X cannot read Y's dashboard");
  const rX = (await api("GET", "/reports/monthly", tkX)).json;
  eq([rX.revenue, rX.newPatients, rX.attribution, rX.scope.doctorId], [100, null, undefined, sid(docX)], "C9 doctor X's report: own revenue, no clinic-only figures");
  eq((rX.topDoctors || []).map((d) => d.id), [sid(docX)], "C10 …and no other doctor appears in it");
  eq((await api("GET", `/reports/monthly?doctorId=${sid(docY)}`, tkX)).status, 403, "C11 doctor X cannot read Y's report");
  eq((await api("PUT", `/invoices/${iY._id}`, tkX, { items: [{ description: "x", price: 1, qty: 1 }], discount: 0 })).status, 404, "C12 doctor X cannot edit Y's invoice (same 404 as an unknown id)");
  eq((await api("POST", `/invoices/${iY._id}/payments`, tkX, { amount: 1 })).status, 404, "C13 …nor add a payment to it");
  eq((await api("POST", `/invoices/${iL._id}/payments`, tkX, { amount: 1 })).status, 404, "C14 …nor to a legacy / unassigned invoice");
  eq((await Invoice.findById(iY._id).lean()).payments.length, 1, "C15 Y's invoice is untouched");
  eq((await api("PUT", `/invoices/${iX._id}`, tkX, { items: [{ description: "Service+", price: 100, qty: 1 }], discount: 0 })).status, 200, "C16 doctor X can edit his own invoice");
  const mine = (await api("POST", "/invoices", tkX, { patientId: sid(pats[5]), items: [{ description: "S", price: 10, qty: 1 }] })).json;
  eq([String(mine.doctorId), String(mine.createdBy)], [sid(docX), sid(docX)], "C17 an invoice a doctor creates is attributed to that doctor");
  eq((await api("POST", "/invoices", tkX, { patientId: sid(pats[5]), doctorId: sid(docY), items: [{ description: "S", price: 10, qty: 1 }] })).status, 403, "C18 a doctor cannot create an invoice attributed to another doctor");
  eq((await api("POST", "/invoices", tkX, { patientId: sid(pats[2]), appointmentId: aY1.json._id, items: [{ description: "S", price: 10, qty: 1 }] })).status, 403, "C19 …nor by linking another doctor's appointment");
  const withAppt = await api("POST", "/invoices", tkX, { patientId: sid(pats[0]), appointmentId: aX1.json._id, items: [{ description: "S", price: 10, qty: 1 }] });
  eq([withAppt.status, String(withAppt.json.doctorId)], [201, sid(docX)], "C20 …but his own appointment is fine");
  eq((await api("PUT", `/invoices/${iX._id}`, tkX, { items: [{ description: "S", price: 100, qty: 1 }], discount: 0, doctorId: sid(docY) })).status, 403, "C21 a doctor cannot hand his invoice to another doctor");
  eq(String((await Invoice.findById(iX._id).lean()).doctorId), sid(docX), "C22 …and it still belongs to X");
  // symmetry
  eq((await api("GET", "/invoices", tkY)).json.length, 2, "C23 doctor Y symmetrically sees only Y's invoices (own + the one reception made for Y)");
  eq((await api("GET", "/dashboard/stats", tkY)).json.today.revenue, 100, "C24 …and Y's revenue is 60 + 40 (reception collected it, Y earns it)");

  /* ================= D. receptionist: operational, not analytical ================= */
  eq((await api("GET", "/invoices", tkR)).json.length >= 4, true, "D1 the receptionist keeps the invoice workflow: she can list the clinic's invoices");
  const stR = (await api("GET", "/dashboard/stats", tkR)).json;
  ok(stR.today.revenue === null && stR.scope.showsRevenue === false, "D2 receptionist dashboard: NO revenue figure (null)", stR.today);
  ok(!JSON.stringify(stR).includes("225") && typeof stR.today.total === "number", "D3 …but the appointment counts stay", stR);
  eq((await api("GET", "/reports/monthly", tkR)).status, 403, "D4 receptionist: reports refused");
  const rInv = (await api("POST", "/invoices", tkR, { patientId: sid(pats[6]), items: [{ description: "Consult", price: 30, qty: 1 }] })).json;
  ok(rInv.doctorId === undefined && String(rInv.createdBy) === sid(rec), "D5 a receptionist's invoice with no doctor is 'unassigned' — the creator is NOT made the treating doctor", rInv);
  const rInv2 = (await api("POST", "/invoices", tkR, { patientId: sid(pats[6]), doctorId: sid(docX), items: [{ description: "Consult", price: 30, qty: 1 }] })).json;
  eq([String(rInv2.doctorId), String(rInv2.createdBy)], [sid(docX), sid(rec)], "D6 …with a chosen doctor: revenue belongs to the doctor, createdBy stays the receptionist");
  eq((await api("POST", "/invoices", tkR, { patientId: sid(pats[6]), doctorId: sid(owner), items: [{ description: "S", price: 1, qty: 1 }] })).status, 404, "D7 an owner / non-doctor user id is not a valid treating doctor");
  eq((await api("POST", "/invoices", tkR, { patientId: sid(pats[6]), doctorId: sid(docB), items: [{ description: "S", price: 1, qty: 1 }] })).status, 404, "D8 a doctor of ANOTHER clinic is not a valid treating doctor");
  eq((await api("PUT", `/invoices/${rInv._id}`, tkR, { items: [{ description: "Consult", price: 30, qty: 1 }], discount: 0, doctorId: sid(docX) })).status, 403, "D9 only the owner can (re)assign an existing invoice's doctor");
  const reassigned = await api("PUT", `/invoices/${rInv._id}`, tkO, { items: [{ description: "Consult", price: 30, qty: 1 }], discount: 0, doctorId: sid(docY) });
  eq([reassigned.status, String(reassigned.json.doctorId)], [200, sid(docY)], "D10 the owner assigns a legacy / unassigned invoice explicitly");
  const cleared = await api("PUT", `/invoices/${rInv._id}`, tkO, { items: [{ description: "Consult", price: 30, qty: 1 }], discount: 0, doctorId: null });
  eq([cleared.status, cleared.json.doctorId], [200, undefined], "D11 …and can clear it again");
  const pay = await api("POST", `/invoices/${rInv2._id}/payments`, tkR, { amount: 5, method: "cash" });
  ok(pay.status !== 403 && pay.status !== 404, "D12 the receptionist can record a payment on any invoice (workflow kept)", pay.status);
  const paidStored = (await Invoice.findById(rInv2._id).lean()).payments.length === 1;
  t.dbLimit(paidStored, "D13 …and it is stored", pay.status);
  const bookR = await book(pats[7], docY, "13:00", tkR);
  eq(bookR.status, 201, "D14 the receptionist books for any doctor");
  eq((await api("PATCH", `/appointments/${bookR.json._id}/status`, tkR, { startAt: at(D, "13:30") })).status, 200, "D15 …reschedules");
  eq((await api("PATCH", `/appointments/${bookR.json._id}/status`, tkR, { doctorId: sid(docX) })).status, 200, "D16 …and reassigns the doctor");
  eq((await api("POST", "/appointments/block", tkR, { doctorId: sid(docY), startAt: at(D, "15:00"), duration: 30 })).status, 201, "D17 …and blocks time for a doctor");
  const wi = await api("POST", "/appointments", tkR, { source: "walk_in", patientId: sid(pats[7]), doctorId: sid(docX), reason: "pain" });
  eq([wi.status, wi.json.source, String(wi.json.createdBy)], [201, "walk_in", sid(rec)], "D18 the receptionist registers walk-ins");
  eq((await api("GET", `/appointments?date=${D}`, tkR)).json.length >= 5, true, "D19 the receptionist's board is the whole clinic");

  /* ================= E. appointments: a doctor's own board ================= */
  const bX = (await api("GET", `/appointments?date=${D}`, tkX)).json, bY = (await api("GET", `/appointments?date=${D}`, tkY)).json;
  ok(bX.length >= 2 && bX.every((a) => String(a.doctorId._id || a.doctorId) === sid(docX)), "E1 doctor X's board: only X's appointments", bX.map((a) => a.doctorId));
  ok(bY.length >= 2 && bY.every((a) => String(a.doctorId._id || a.doctorId) === sid(docY)), "E2 doctor Y's board: only Y's appointments");
  eq((await api("GET", `/appointments?date=${D}&doctorId=${sid(docY)}`, tkX)).status, 403, "E3 X asking for Y's board is refused");
  eq((await api("GET", `/appointments?date=${D}&doctorId=${sid(docX)}`, tkX)).status, 200, "E4 …X asking for his own is fine");
  ok(bX.some((a) => a.startAt === aX1.json.startAt) && bY.some((a) => a.startAt === aY1.json.startAt) && aX1.json.startAt === aY1.json.startAt, "E5 simultaneous appointments for two doctors (10:00) both exist and each shows on its own doctor's board");
  eq((await api("PATCH", `/appointments/${aY1.json._id}/status`, tkX, { status: "confirmed" })).status, 404, "E6 X cannot change Y's appointment (same 404 as an unknown id)");
  eq((await api("PATCH", `/appointments/${aY1.json._id}/read`, tkX)).status, 404, "E7 …nor mark it read");
  eq((await api("PATCH", `/appointments/${aX1.json._id}/status`, tkX, { status: "confirmed" })).status, 200, "E8 X changes his own appointment's status");
  eq((await api("PATCH", `/appointments/${aX1.json._id}/status`, tkX, { doctorId: sid(docY) })).status, 403, "E9 X cannot reassign his appointment to Y");
  eq((await book(pats[0], docY, "14:00", tkX)).status, 403, "E10 X cannot book an appointment for Y");
  eq((await book(pats[0], docX, "14:00", tkX)).status, 201, "E11 X books for himself");
  eq((await api("POST", "/appointments", tkX, { source: "walk_in", patientId: sid(pats[0]), doctorId: sid(docY) })).status, 403, "E12 X cannot register a walk-in on Y");
  const wiX = await api("POST", "/appointments", tkX, { source: "walk_in", patientId: sid(pats[1]), doctorId: sid(docX) });
  eq([wiX.status, wiX.json.source], [201, "walk_in"], "E13 X registers a walk-in on himself");
  eq((await api("POST", "/appointments/block", tkX, { doctorId: sid(docY), startAt: at(D, "16:00") })).status, 403, "E14 X cannot block Y's time");
  eq((await api("POST", "/appointments/block", tkX, { doctorId: sid(docX), startAt: at(D, "16:00") })).status, 201, "E15 X blocks his own");
  // patient file visit history is shared clinical data
  await book(pats[2], docX, "15:30", tkR);
  const hist = (await api("GET", `/appointments?patientId=${sid(pats[2])}`, tkX)).json;
  ok(hist.some((a) => String(a.doctorId._id || a.doctorId) === sid(docY)) && hist.some((a) => String(a.doctorId._id || a.doctorId) === sid(docX)), "E16 patient file: a doctor sees the patient's visits with EVERY doctor (shared clinical history)");
  const ra = await api("PATCH", "/appointments/read-all", tkX);
  eq(ra.status, 200, "E17 read-all works for a doctor (own scope)");
  // public booking and walk-in non-blocking still intact
  const slotsY = (await http("GET", `/public/clinics/md-a/slots?doctorId=${sid(docX)}&date=${D}`)).json.slots;
  ok(slotsY.includes("14:30") && !slotsY.includes("14:00") && slotsY.includes("10:30"), "E18 public slots: X's scheduled 14:00 blocks, X's walk-in / others do not", slotsY);

  /* ================= F. treatment -> invoice attribution (dentistry) ================= */
  const visit = (p, doc, ago = 6 * 36e5) => Appointment.create({ clinicId: A._id, doctorId: doc._id, patientId: p._id, startAt: new Date(Date.now() - ago), duration: 30, status: "completed" });
  const vX = await visit(pats[9], docX), vY = await visit(pats[8], docY), vY2 = await visit(pats[8], docY, 5 * 36e5);
  const plan = async (token, p, body) => (await api("POST", `/dental/patients/${sid(p)}/treatment-plan/items`, token, body)).json.item._id;
  const run = async (token, p, itemId, v) => { await api("POST", `/dental/patients/${sid(p)}/treatment-plan/items/${itemId}/start`, token, { appointmentId: sid(v) }); return api("POST", `/dental/patients/${sid(p)}/treatment-plan/items/${itemId}/complete`, token, { appointmentId: sid(v) }); };
  const itY = await plan(tkY, pats[8], { procedureCode: "crown", targetType: "tooth", toothNumbers: ["16"] });
  eq((await run(tkY, pats[8], itY, vY)).status, 200, "F0 Doctor Y completes a crown");
  const bill = (token, p, itemId, body = {}) => api("POST", `/dental/patients/${sid(p)}/treatment-plan/items/${itemId}/invoice`, token, { price: 80, description: "Crown 16", ...body });
  eq((await bill(tkX, pats[8], itY)).json.code, "NOT_YOUR_TREATMENT", "F1 Doctor X cannot bill a treatment Doctor Y performed");
  eq(await Invoice.countDocuments({ patientId: pats[8]._id }), 0, "F2 …and nothing was created");
  const bR = await bill(tkR, pats[8], itY);
  eq(bR.status, 201, "F3 the receptionist bills it (financial workflow kept)");
  const invF = await Invoice.findById(bR.json.invoice._id).lean();
  eq([String(invF.doctorId), String(invF.createdBy)], [sid(docY), sid(rec)], "F4 the invoice is attributed to the TREATING doctor (Y), not to the receptionist who created it");
  eq((await bill(tkR, pats[8], itY)).json.alreadyInvoiced, true, "F5 duplicate billing is still idempotent (no second invoice)");
  eq(await Invoice.countDocuments({ patientId: pats[8]._id }), 1, "F6 …exactly one invoice");
  const itY2 = await plan(tkY, pats[8], { procedureCode: "filling", targetType: "surface", toothNumbers: ["26"], surfaces: ["O"] });
  await run(tkY, pats[8], itY2, vY2);
  eq((await bill(tkY, pats[8], itY2, { price: 40, description: "Filling 26", invoiceId: sid(invF) })).status, 201, "F7 Doctor Y adds his second treatment to his own invoice");
  const itOwn = await plan(tkO, pats[9], { procedureCode: "crown", targetType: "tooth", toothNumbers: ["11"] });
  eq((await run(tkO, pats[9], itOwn, vX)).status, 200, "F8 the OWNER records a treatment in Doctor X's visit");
  eq((await bill(tkR, pats[9], itOwn, { invoiceId: sid(invF) })).status, 404, "F9 a receptionist cannot target an invoice of another PATIENT");
  const bOwn = await bill(tkR, pats[9], itOwn, { price: 70, description: "Crown 11" });
  eq(String((await Invoice.findById(bOwn.json.invoice._id).lean()).doctorId), sid(docX), "F10 owner-completed treatment → attributed to the doctor of THAT visit (X), not to the owner");
  // mixing doctors on one invoice is refused
  const itMix = await plan(tkX, pats[9], { procedureCode: "filling", targetType: "surface", toothNumbers: ["12"], surfaces: ["O"] });
  const vX2 = await visit(pats[9], docX, 4 * 36e5);
  await run(tkX, pats[9], itMix, vX2);
  const iYonP4 = await Invoice.create({ clinicId: A._id, invoiceNumber: 99001, patientId: pats[9]._id, doctorId: docY._id, items: [{ description: "Y thing", price: 10, qty: 1 }], total: 10 });
  eq((await bill(tkR, pats[9], itMix, { invoiceId: sid(iYonP4) })).json.code, "INVOICE_DOCTOR_MISMATCH", "F11 an invoice of doctor Y does not take doctor X's treatment (revenue cannot move between doctors)");
  eq((await bill(tkX, pats[9], itMix, { invoiceId: sid(iYonP4) })).status, 404, "F12 …and doctor X cannot even target it");
  const iLegacyP4 = await Invoice.create({ clinicId: A._id, invoiceNumber: 99002, patientId: pats[9]._id, items: [{ description: "Old", price: 10, qty: 1 }], total: 10 });
  const addLegacy2 = await bill(tkR, pats[9], itMix, { price: 20, description: "Filling 12", invoiceId: sid(iLegacyP4) });
  eq(addLegacy2.status, 201, "F14 a legacy (unassigned) invoice accepts a treatment …");
  ok(!(await Invoice.findById(iLegacyP4._id).lean()).doctorId, "F15 …and stays unassigned (never guessed)");
  // viewing money
  const planX = (await api("GET", `/dental/patients/${sid(pats[8])}/treatment-plan`, tkX)).json, planY = (await api("GET", `/dental/patients/${sid(pats[8])}/treatment-plan`, tkY)).json;
  const bi = (pl, id) => pl.items.find((i) => i._id === id).billing;
  ok(bi(planX, itY).state === "invoiced" && bi(planX, itY).amount === undefined && bi(planX, itY).invoiceStatus === undefined, "F16 Doctor X sees that Y's treatment is invoiced but NOT the amount / payment status", bi(planX, itY));
  ok(bi(planY, itY).amount === 80, "F17 Doctor Y sees his own invoiced amount", bi(planY, itY));
  const dashX = (await api("GET", "/dental/dashboard", tkX)).json;
  ok(dashX.today.appointments.every((a) => true) && Array.isArray(dashX.needsBilling), "F18 dental dashboard loads for a doctor");
  ok(!dashX.needsBilling.some((n) => n.patientId === sid(pats[8])), "F19 …and does not offer him Doctor Y's treatments to bill");
  const dashR = (await api("GET", "/dental/dashboard", tkR)).json;
  ok(typeof dashR.today.counts.total === "number", "F20 …and loads for the receptionist");
  const patFin = (await api("GET", `/dental/patients/${sid(pats[8])}/report?financial=1`, tkX)).json;
  eq(patFin.financial.totalInvoiced, 0, "F21 a doctor's printable financial summary of a patient covers only HIS invoices");
  eq((await api("GET", `/dental/patients/${sid(pats[8])}/report?financial=1`, tkR)).json.financial.totalInvoiced, 120, "F22 the receptionist's covers the whole file");

  /* ================= G. cross-clinic ================= */
  eq((await api("GET", "/invoices", tkOB)).json.map((i) => i.total), [999], "G1 clinic B's owner sees only B's invoice");
  eq((await api("GET", `/invoices?patientId=${sid(pats[0])}`, tkOB)).json.length, 0, "G2 …not A's patient's invoices");
  eq((await api("GET", `/invoices?doctorId=${sid(docX)}`, tkOB)).json.length, 0, "G3 …not A's doctor's invoices");
  for (const [who, tk] of [["owner", tkOB], ["receptionist", tkRB], ["doctor", tkDB]]) {
    eq((await api("PUT", `/invoices/${iX._id}`, tk, { items: [{ description: "x", price: 1, qty: 1 }], discount: 0 })).status, 404, `G4 B ${who}: A's invoice cannot be edited`);
    eq((await api("POST", `/invoices/${iX._id}/payments`, tk, { amount: 1 })).status, 404, `G5 B ${who}: A's invoice cannot take a payment`);
    eq((await api("PATCH", `/appointments/${aX1.json._id}/status`, tk, { status: "cancelled" })).status, 404, `G6 B ${who}: A's appointment cannot be changed`);
  }
  eq((await api("POST", "/invoices", tkRB, { patientId: sid(pats[0]), items: [{ description: "x", price: 1, qty: 1 }] })).status, 404, "G7 B cannot invoice A's patient");
  eq((await api("POST", "/invoices", tkRB, { patientId: sid(pB), doctorId: sid(docX), items: [{ description: "x", price: 1, qty: 1 }] })).status, 404, "G8 B cannot attribute an invoice to A's doctor");
  eq((await api("POST", "/invoices", tkRB, { patientId: sid(pB), appointmentId: aX1.json._id, items: [{ description: "x", price: 1, qty: 1 }] })).status, 404, "G9 B cannot link A's appointment");
  eq((await api("POST", "/appointments", tkR, { patientId: sid(pB), doctorId: sid(docX), startAt: at(D, "09:00") })).status, 404, "G10 A cannot book B's patient");
  eq((await api("POST", "/appointments", tkR, { patientId: sid(pats[0]), doctorId: sid(docB), startAt: at(D, "09:00") })).status, 404, "G11 A cannot book B's doctor");
  const forged = await api("POST", "/invoices", tkRB, { clinicId: sid(A), patientId: sid(pB), items: [{ description: "x", price: 1, qty: 1 }] });
  eq(String(forged.json.clinicId), sid(B), "G12 a clinicId in the body is ignored — the authenticated clinic wins");
  eq((await api("PUT", `/users/${sid(docX)}/working-hours`, tkOB, { workingHours: null })).status, 404, "G13 B's owner cannot set A's doctor's hours");
  eq((await api("GET", `/dental/patients/${sid(pats[0])}/treatment-plan`, tkDB)).status, 404, "G14 B's doctor cannot open A's patient's treatment plan");
  // token claims never widen anything
  const fakeClaims = t.tok(docX, { role: "owner", clinicId: sid(B), doctorId: sid(docY) });
  eq((await api("GET", "/invoices", fakeClaims)).json.length, (await api("GET", "/invoices", tkX)).json.length, "G15 a token carrying role / clinicId / doctorId claims is still just Doctor X (identity comes from the database)");
  eq((await api("GET", "/reports/monthly", t.tok(rec, { role: "owner" }))).status, 403, "G16 …and a receptionist token claiming role=owner is still a receptionist");

  /* ================= H. per-doctor working hours ================= */
  const hours = (over = {}) => wh.map((d) => ({ ...d, from: "10:00", to: "14:00", breakFrom: "12:00", breakTo: "12:30", ...(over[d.day] || {}) }));
  const dow = new Date(D + "T00:00:00Z").getUTCDay();
  eq((await api("PUT", `/users/${sid(docX)}/working-hours`, tkO, { workingHours: hours({ [dow]: { from: "08:00" } }) })).status, 400, "H1 a doctor cannot be available outside the clinic's hours (08:00 < 09:00)");
  eq((await api("PUT", `/users/${sid(docX)}/working-hours`, tkO, { workingHours: hours().slice(0, 6) })).status, 400, "H2 all seven days are required");
  eq((await api("PUT", `/users/${sid(owner)}/working-hours`, tkO, { workingHours: hours() })).status, 404, "H3 only a doctor has working hours");
  const setH = await api("PUT", `/users/${sid(docX)}/working-hours`, tkO, { workingHours: hours() });
  eq(setH.status, 200, "H4 the owner sets Doctor X's own hours (10:00–14:00, break 12:00–12:30)");
  eq((await api("GET", "/users", tkR)).json.find((s) => s._id === sid(docX)).workingHours.length, 7, "H5 the team list carries the hours (the scheduler needs them)");
  const hb = (hhmm, doc = docX, tk = tkR) => book(pats[0], doc, hhmm, tk);
  eq((await hb("15:00")).json.code, "DOCTOR_OUTSIDE_HOURS", "H6 booking X at 15:00 (clinic open, X not) is refused");
  eq((await hb("12:00")).json.code, "DOCTOR_BREAK_TIME", "H7 …and during X's break");
  eq((await hb("10:30")).status, 201, "H8 inside X's hours is fine");
  eq((await hb("16:30", docY)).status, 201, "H9 Doctor Y (no own hours) still follows the clinic: 16:30 is fine");
  const slotsX = (await http("GET", `/public/clinics/md-a/slots?doctorId=${sid(docX)}&date=${tz.addDaysYmd(D, 1)}`)).json.slots, slotsY2 = (await http("GET", `/public/clinics/md-a/slots?doctorId=${sid(docY)}&date=${tz.addDaysYmd(D, 1)}`)).json.slots;
  ok(slotsX.length > 0 && slotsX.every((s) => s >= "10:00" && s < "14:00") && !slotsX.includes("12:00") && slotsX.includes("10:00"), "H10 public slots for X: only inside 10–14, without the break", slotsX);
  ok(slotsY2.includes("09:00") && slotsY2.includes("16:30"), "H11 public slots for Y: the clinic's full day", slotsY2);
  const pubBook = (doc, hhmm, phone) => http("POST", "/public/clinics/md-a/book", { body: { doctorId: sid(doc), startAt: at(tz.addDaysYmd(D, 1), hhmm), fullName: "Online Patient", phone } });
  eq((await pubBook(docX, "15:00", "0795500001")).json.code, "DOCTOR_OUTSIDE_HOURS", "H12 public booking cannot bypass the doctor's hours");
  eq((await pubBook(docX, "11:00", "0795500002")).status, 201, "H13 public booking inside them works");
  eq((await api("PATCH", `/appointments/${aX2.json._id}/status`, tkR, { startAt: at(D, "15:30") })).json.code, "DOCTOR_OUTSIDE_HOURS", "H14 rescheduling X outside his hours is refused");
  const wiHours = await api("POST", "/appointments", tkR, { source: "walk_in", patientId: sid(pats[6]), doctorId: sid(docX) });
  eq(wiHours.status, 201, "H15 a walk-in is never judged by working hours (it already happened)");
  const offDay = hours({ [dow]: { isOpen: false } });
  eq((await api("PUT", `/users/${sid(docX)}/working-hours`, tkO, { workingHours: offDay })).status, 200, "H16 a weekly day off");
  eq((await hb("11:00")).json.code, "DOCTOR_DAY_OFF", "H17 …is respected for booking");
  eq((await http("GET", `/public/clinics/md-a/slots?doctorId=${sid(docX)}&date=${D}`)).json.slots, [], "H18 …and for public slots");
  eq((await api("PUT", `/users/${sid(docX)}/working-hours`, tkO, { workingHours: null })).status, 200, "H19 the owner clears X's hours");
  eq((await hb("16:30")).status, 201, "H20 X follows the clinic again (16:30 is outside the old 10–14 window)");
  ok(!(await User.findById(docX._id).lean()).workingHours, "H21 cleared = the field is absent (legacy shape)");

  /* ================= I. shared clinical data stays shared (Phase 3) ================= */
  const note = await api("POST", `/patients/${sid(pats[0])}/clinical-notes`, tkX, { text: "X's note" });
  eq(note.status, 201, "I1 Doctor X writes a clinical note");
  const nid = note.json.note._id;
  eq((await api("GET", `/patients/${sid(pats[0])}/clinical-notes`, tkY)).json.notes.some((n) => n._id === nid), true, "I2 Doctor Y reads it (notes are shared per clinic)");
  const ed = await api("PUT", `/patients/${sid(pats[0])}/clinical-notes/${nid}`, tkY, { text: "Y corrected", expectedEditCount: 0 });
  eq(ed.status, 200, "I3 Doctor Y may amend it");
  const revs = (await api("GET", `/patients/${sid(pats[0])}/clinical-notes/${nid}/revisions`, tkR)).json;
  ok(JSON.stringify(revs).includes("X's note"), "I4 revision history keeps the original text (and the receptionist can read history)", revs);
  eq(String((await ClinicalNote.findById(nid).lean()).authorId), sid(docX), "I5 the original author stays X");
  eq((await api("POST", `/patients/${sid(pats[0])}/clinical-notes`, tkR, { text: "reception note" })).status, 403, "I6 a receptionist cannot write clinical notes");
  eq((await api("GET", `/patients/${sid(pats[0])}/clinical-timeline`, tkY)).status, 200, "I7 the timeline is shared");
  eq((await api("GET", `/dental/patients/${sid(pats[0])}/record`, tkY)).status, 200, "I8 the dental chart is shared across doctors");
  eq((await api("PUT", `/dental/patients/${sid(pats[0])}/dentition`, tkR, { dentition: "adult" })).status, 403, "I9 a receptionist cannot write the dental chart");
  eq((await api("GET", "/patients", tkY)).json.total >= 8, true, "I10 patients are NOT filtered by doctor");
  eq((await api("POST", "/patients", tkR, { fullName: "Walk In Person", phone: "0795777001" })).status, 201, "I11 the receptionist registers patients");

  /* ================= J. the AI assistant obeys the same rules ================= */
  const tools = require(path.join(DIST, "services/ai/tools"));
  const ctxOf = (u, role) => ({ conversationId: "c", conversationObjectId: "o", clinicId: sid(A), userId: sid(u), role });
  const run_ = (name, input, u, role) => tools.getAllowedTools(ctxOf(u, role))[name].execute(input, ctxOf(u, role));
  const sR = await run_("getClinicStats", { period: "today" }, rec, "receptionist"), sX = await run_("getClinicStats", { period: "today" }, docX, "doctor"), sO = await run_("getClinicStats", { period: "month" }, owner, "owner"), sXm = await run_("getClinicStats", { period: "month" }, docX, "doctor");
  ok(sR.revenueJOD === undefined && !JSON.stringify(sR).includes("225"), "J1 AI stats for a receptionist: no revenue field", sR);
  eq(sX.revenueJOD, 100 + (paidStored ? 5 : 0), "J2 AI stats for Doctor X: only the payments on HIS invoices (never the clinic's 225+)");
  ok(sO.revenueJOD >= 225 && typeof sO.newPatients === "number", "J3 AI stats for the owner: clinic-wide", sO);
  ok(sXm.newPatients === undefined, "J4 …a doctor gets no clinic-wide new-patient count", sXm);
  const lt = await run_("listTodayAppointments", { doctorId: sid(docY) }, docX, "doctor");
  ok(lt.error && !lt.appointments, "J5 AI schedule: Doctor X asking for Y's list is refused", lt);
  const ci = await run_("createInvoice", { patientId: sid(pats[6]), doctorId: sid(docY), items: [{ description: "s", price: 5 }] }, docX, "doctor");
  ok(ci.error && !ci.success, "J6 AI invoice: Doctor X cannot bill as Doctor Y", ci);
  const ci2 = await run_("createInvoice", { patientId: sid(pats[6]), items: [{ description: "s", price: 5 }] }, docX, "doctor");
  eq(String((await Invoice.findById(ci2.invoiceId).lean()).doctorId), sid(docX), "J7 AI invoice by a doctor is attributed to that doctor");
  const ci3 = await run_("createInvoice", { patientId: sid(pats[6]), items: [{ description: "s", price: 5 }] }, rec, "receptionist");
  ok(ci3.success && !(await Invoice.findById(ci3.invoiceId).lean()).doctorId, "J8 AI invoice by a receptionist: unassigned, creator not promoted to doctor");
  const cx = await run_("cancelAppointment", { appointmentId: aY2.json._id }, docX, "doctor");
  ok(cx.error && (await Appointment.findById(aY2.json._id).lean()).status !== "cancelled", "J9 AI cancel: a doctor cannot cancel another doctor's appointment", cx);
  const ca = await run_("createAppointment", { patientId: sid(pats[0]), doctorId: sid(docY), startAt: at(D, "09:00") }, docX, "doctor");
  ok(ca.error && !ca.success, "J10 AI booking: a doctor cannot book for another doctor", ca);

  /* ================= K. legacy data keeps working ================= */
  ok((await api("GET", "/invoices", tkO)).json.some((i) => i.invoiceNumber === 70900 && !i.doctorId), "K1 a pre-Phase-4 invoice (no doctor, no creator) loads for the owner as unassigned");
  ok((await api("GET", "/invoices", tkR)).json.some((i) => i.invoiceNumber === 70900), "K2 …and for the receptionist");
  ok(!(await api("GET", "/invoices", tkX)).json.some((i) => i.invoiceNumber === 70900), "K3 …but is never shown to a doctor (no attribution → not guessed)");
  const legacyAppt = await Appointment.collection.insertOne({ clinicId: A._id, patientId: pats[0]._id, doctorId: docX._id, startAt: new Date(Date.now() + 9 * 864e5), duration: 30, status: "scheduled", source: "dashboard", createdAt: new Date(), updatedAt: new Date() });
  eq((await api("PATCH", `/appointments/${legacyAppt.insertedId}/status`, tkX, { visitNote: "ok" })).status, 200, "K4 an appointment with no createdBy / type field still works");
  eq((await api("PUT", `/invoices/${iL._id}`, tkO, { items: [{ description: "Legacy", price: 25, qty: 1 }], discount: 0 })).status, 200, "K5 a legacy invoice can still be edited by the owner");
  eq((await api("PUT", `/invoices/${iL._id}`, tkR, { items: [{ description: "Legacy", price: 25, qty: 1 }], discount: 0 })).status, 200, "K6 …and by the receptionist");

  t.noLeaks("Z1 no response of this suite leaked a stack / path / Mongo internals");
  await t.finish("PHASE 4 — multi-doctor roles, permissions and data ownership");
})().catch((e) => { console.error("SUITE CRASHED", e); process.exit(2); });
