/* DASHBOARD POLISH — role-based financial visibility (compiled server, real HTTP, nothing mocked).
 * Controlled dataset (all dated today, clinic-local):  Doctor A  collected 500 · attributed expenses 100
 *                                                      Doctor B  collected 300 · attributed expenses  50
 *                                                      clinic-shared expenses 200   →  800 / 350 / 450 · A 400 · B 250
 *   R1  owner sees everything (dashboard revenue, analytics overview / financial / doctors, expenses, reports)
 *   R2  doctor sees ONLY their own figures; the other doctor's data is refused (403) or absent
 *   R3  receptionist: every financial / report / expense endpoint answers 403 (GET and write), by direct API call
 *   R4  receptionist: /dashboard/stats carries NO money (revenue === null) and no response of a receptionist-reachable endpoint carries a
 *       clinic-level money aggregate; the AI assistant tool also withholds revenue
 *   R5  receptionist's operational work still functions: appointments, patients, invoice list, creating an invoice, RECORDING A PAYMENT
 *   node tests/dashboard-polish/role-finance.test.js     (FerretDB sandbox: run with the Phase 7 test-only engines; on real MongoDB: REAL_MONGO=1 AGG_EMULATOR=0 EXPR_SHIM=0) */
const { boot7, wh } = require("../phase7/p7lib");

(async () => {
  const t = await boot7({ name: "dash_polish", port: 5322 });
  const { Invoice } = t.m;
  const api = t.api;
  const sid = (d) => String(d._id);
  const today = t.tz.clinicYmdOf(new Date());

  const C = await t.mkClinic("dpol", { specialty: "dentistry", plan: "pro", workingHours: wh(), slotDuration: 30 });
  const owner = await t.mkUser(C, "owner"), dA = await t.mkUser(C, "doctor", 1), dB = await t.mkUser(C, "doctor", 2), rec = await t.mkUser(C, "receptionist");
  const TK = { o: t.tok(owner), a: t.tok(dA), b: t.tok(dB), r: t.tok(rec) };

  const p1 = (await api("POST", "/patients", TK.r, { fullName: "Pat One", phone: "0796100001" })).json;
  const p2 = (await api("POST", "/patients", TK.r, { fullName: "Pat Two", phone: "0796100002" })).json;
  const p3 = (await api("POST", "/patients", TK.r, { fullName: "Pat Three", phone: "0796100003" })).json;

  const mkPaid = async (patient, doctor, price) => {
    const inv = await api("POST", "/invoices", TK.o, { patientId: sid(patient), doctorId: sid(doctor), items: [{ description: "Service", price, qty: 1 }], discount: 0 });
    const pay = await api("POST", `/invoices/${inv.json._id}/payments`, TK.o, { amount: price, method: "cash" });
    return [inv.status, pay.status];
  };
  t.eq(await mkPaid(p1, dA, 500), [201, 200], "D1 doctor A: invoice 500 created and fully paid");
  t.eq(await mkPaid(p2, dB, 300), [201, 200], "D2 doctor B: invoice 300 created and fully paid");
  const ex = (title, amount, extra = {}) => api("POST", "/expenses", TK.o, { title, category: "lab", scope: "clinic", amount, status: "paid", date: today, ...extra });
  t.eq([(await ex("A lab", 100, { doctorId: sid(dA) })).status, (await ex("B lab", 50, { doctorId: sid(dB) })).status, (await ex("Shared rent", 200)).status], [201, 201, 201], "D3 expenses: A 100, B 50, clinic-shared 200");
  // an UNPAID invoice the receptionist will collect on (R5)
  const open = await api("POST", "/invoices", TK.r, { patientId: sid(p3), doctorId: sid(dA), items: [{ description: "Consult", price: 40, qty: 1 }], discount: 0 });
  t.eq(open.status, 201, "D4 the receptionist can create an invoice");

  // ═══════════ R1 owner ═══════════
  const oS = await api("GET", "/dashboard/stats", TK.o);
  t.money(oS.json.today.revenue, 800, "R1.1 owner dashboard revenue = 800 (collected today, both doctors)");
  t.money((await api("GET", `/dashboard/stats?doctorId=${sid(dA)}`, TK.o)).json.today.revenue, 500, "R1.2 owner narrowed to Doctor A = 500");
  const ov = (await api("GET", "/analytics/overview?preset=today&compare=0", TK.o)).json.kpis;
  t.money(ov.collected.current, 800, "R1.3 owner analytics overview: collected 800");
  t.money(ov.expenses.current, 350, "R1.4 …expenses 350");
  t.money(ov.netCash.current, 450, "R1.5 …net cash 450");
  const fin = (await api("GET", "/analytics/financial?preset=today&compare=0", TK.o)).json.kpis;
  t.eq([fin.collected.current, fin.expenses.current, fin.netCash.current], [800, 350, 450], "R1.6 owner financial analytics 800 / 350 / 450");
  const rows = (await api("GET", "/analytics/doctors?preset=today&compare=0", TK.o)).json.rows;
  const rowA = rows.find((r) => r.doctorId === sid(dA)), rowB = rows.find((r) => r.doctorId === sid(dB));
  t.eq([rowA.collected, rowA.attributedExpenses, rowA.netContribution], [500, 100, 400], "R1.7 Doctor A: 500 / 100 / net contribution 400");
  t.eq([rowB.collected, rowB.attributedExpenses, rowB.netContribution], [300, 50, 250], "R1.8 Doctor B: 300 / 50 / net contribution 250");
  t.eq([(await api("GET", "/expenses/overview", TK.o)).status, (await api("GET", "/reports/monthly", TK.o)).status, (await api("GET", "/expenses/summary", TK.o)).status], [200, 200, 200], "R1.9 owner reaches expenses overview / summary and the monthly report");

  // ═══════════ R2 doctor ═══════════
  t.money((await api("GET", "/dashboard/stats", TK.a)).json.today.revenue, 500, "R2.1 Doctor A's dashboard revenue = 500 (own only)");
  t.money((await api("GET", "/dashboard/stats", TK.b)).json.today.revenue, 300, "R2.2 Doctor B's dashboard revenue = 300 (own only)");
  t.eq((await api("GET", `/dashboard/stats?doctorId=${sid(dB)}`, TK.a)).status, 403, "R2.3 Doctor A asking for Doctor B's dashboard → 403");
  const dRows = (await api("GET", "/analytics/doctors?preset=today&compare=0", TK.a)).json.rows;
  t.eq(dRows.map((r) => r.doctorId), [sid(dA)], "R2.4 Doctor A's doctors analytics contains ONLY Doctor A");
  t.eq((await api("GET", `/analytics/financial?preset=today&doctorId=${sid(dB)}`, TK.a)).status, 403, "R2.5 Doctor A asking for Doctor B's financial analytics → 403");
  t.eq([(await api("GET", "/expenses/overview", TK.a)).status, (await api("POST", "/expenses", TK.a, { title: "x", category: "lab", scope: "clinic", amount: 1, status: "paid", date: today })).status], [403, 403], "R2.6 a doctor cannot manage expenses");
  t.ok(!/Shared rent|B lab/.test((await api("GET", "/expenses/ledger", TK.a)).text), "R2.7 Doctor A's ledger carries neither the shared expense nor Doctor B's");

  // ═══════════ R3 receptionist — direct API ═══════════
  const restricted = [
    ["GET", "/analytics/overview?preset=today"], ["GET", "/analytics/financial?preset=today"], ["GET", "/analytics/doctors?preset=today"], ["GET", "/analytics/appointments?preset=today"],
    ["GET", "/analytics/treatments?preset=today"], ["GET", "/analytics/loyalty?preset=today"], ["GET", "/analytics/export?section=financial&format=csv&preset=today"],
    ["GET", "/reports/monthly"], ["GET", "/reports/summary"],
    ["GET", "/expenses/overview"], ["GET", "/expenses/summary"], ["GET", "/expenses/ledger"], ["GET", "/expenses"],
    ["POST", "/expenses", { title: "x", category: "lab", scope: "clinic", amount: 1, status: "paid", date: today }],
  ];
  const got = [];
  for (const [m, u, b] of restricted) { const r = await api(m, u, TK.r, b); got.push([m + " " + u.split("?")[0], r.status]); }
  const notRefused = got.filter(([, s]) => s !== 403 && s !== 404);
  t.ok(notRefused.length === 0, "R3.1 every analytics / reports / expenses endpoint refuses the receptionist (403, or 404 for a path that does not exist)", notRefused);
  t.ok(got.filter(([, s]) => s === 403).length >= 12, "R3.2 …and the real ones answer 403 specifically", got);

  // ═══════════ R4 receptionist — dashboard + sweep of receptionist-reachable GETs ═══════════
  const rS = await api("GET", "/dashboard/stats", TK.r);
  t.eq([rS.status, rS.json.today.revenue, rS.json.scope.showsRevenue], [200, null, false], "R4.1 receptionist dashboard stats: revenue === null, showsRevenue false");
  t.ok(typeof rS.json.today.total === "number" && typeof rS.json.today.completed === "number" && typeof rS.json.today.noShow === "number", "R4.2 …the operational counts (visits / completed / no-shows) are still there", rS.json.today);
  t.ok(!/800|450|350/.test(JSON.stringify(rS.json)), "R4.3 …and none of the clinic's money figures appears anywhere in that response");

  const rScoped = await api("GET", `/dashboard/stats?doctorId=${sid(dA)}`, TK.r);
  t.eq([rScoped.status, rScoped.json.today.revenue], [200, null], "R4.3b receptionist narrowing the COUNTS to one doctor is operational (200) and still carries no revenue (null)");

  const MONEY_KEY = /"(revenue|collected|invoiced|netCash|netContribution|attributedExpenses|totalExpenses|expenses|outstanding|avgCollectedPerVisit)"\s*:\s*[0-9{]/;
  const reachable = ["/appointments?date=" + today, "/patients", "/clinic", "/subscription", "/users", "/dental/dashboard", "/dashboard/stats"];
  const leaks = [];
  for (const u of reachable) { const r = await api("GET", u, TK.r); if (MONEY_KEY.test(r.text)) leaks.push(u); }
  t.ok(leaks.length === 0, "R4.4 no receptionist-reachable endpoint returns a clinic revenue / expense / net / outstanding aggregate", leaks);
  const invList = await api("GET", "/invoices", TK.r);
  t.ok(invList.status === 200 && !MONEY_KEY.test(invList.text.replace(/"payments":\[[^\]]*\]/g, "")), "R4.5 the invoice LIST (needed to collect payments) is per-invoice rows only — no aggregate block", invList.text.slice(0, 160));

  // the AI assistant is bound by the same rule
  const tool = require(`${t.D}/services/ai/tools/dashboard/getClinicStats`);
  const aiRec = await tool.getClinicStatsExecute({ period: "today" }, { clinicId: sid(C), userId: sid(rec), role: "receptionist" });
  t.ok(aiRec.revenueJOD === undefined && !/800|450|350/.test(JSON.stringify(aiRec)), "R4.6 AI assistant (receptionist): no revenue in the answer", aiRec);
  const aiOwn = await tool.getClinicStatsExecute({ period: "today" }, { clinicId: sid(C), userId: sid(owner), role: "owner" });
  t.money(aiOwn.revenueJOD, 800, "R4.7 AI assistant (owner): revenue still 800");

  // ═══════════ R5 receptionist — operational workflow intact ═══════════
  t.eq((await api("GET", "/appointments?date=" + today, TK.r)).status, 200, "R5.1 receptionist reads today's appointments");
  t.eq((await api("POST", "/patients", TK.r, { fullName: "Walk Patient", phone: "0796100009" })).status, 201, "R5.2 receptionist registers a patient");
  t.ok(invList.json.some((i) => String(i._id) === open.json._id && i.total === 40), "R5.3 receptionist sees the invoice (and its amount) they are collecting on");
  const pay = await api("POST", `/invoices/${open.json._id}/payments`, TK.r, { amount: 15, method: "cash" });
  t.eq([pay.status, pay.json.status], [200, "partially_paid"], "R5.4 receptionist RECORDS a payment (partial) — allowed");
  const pay2 = await api("POST", `/invoices/${open.json._id}/payments`, TK.r, { amount: 25, method: "cash" });
  t.eq([pay2.status, pay2.json.status], [200, "paid"], "R5.5 …and the rest → paid");
  const inDb = await Invoice.findById(open.json._id).lean();
  t.eq([inDb.payments.length, inDb.payments.reduce((s, p) => s + p.amount, 0)], [2, 40], "R5.6 the database holds exactly the two payments (40)");

  t.noLeaks("no response of this suite leaked an internal");
  console.log(`\nDASHBOARD POLISH — role-based financial visibility: ${t.pass} passed, ${t.fail} failed`);
  if (t.limits.length) { console.log(`  ${t.limits.length} OBSERVATION(S) NOT VERIFIED on this test database:`); t.limits.forEach((l) => console.log("  NOT-VERIFIED: " + l)); }
  t.failures.forEach((f) => console.log("  FAIL: " + f));
  process.exit(t.fail ? 1 : 0);
})().catch((e) => { console.error("SUITE CRASHED", e); process.exit(1); });
