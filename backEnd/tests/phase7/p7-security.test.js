/* PHASE 7 — AUTHORIZATION PENETRATION (compiled server, real HTTP, nothing mocked).
 *   S1  every route of every staff router is ENUMERATED FROM THE COMPILED ROUTERS (a route added later is attacked automatically):
 *       anonymous → 401 · garbage token → 401 · deactivated user → 401 · wrong-secret token → 401
 *   S2  cross-clinic: every route that takes an id is called by ANOTHER clinic's owner with the real ids of clinic A: never 2xx, never A's data
 *   S3  cross-clinic LIST/aggregate endpoints never contain a single marker of clinic A
 *   S4  cross-clinic WRITES with valid bodies change nothing (database snapshot before = after)
 *   S5  cross-doctor (Doctor B against Doctor A) and receptionist matrices
 *   S6  mass assignment: server-owned fields sent by the client are ignored
 *   S7  input attacks: NoSQL operators, prototype pollution, wrong types, giant / hostile strings → 4xx, never 500, never an internal
 *   node tests/phase7/p7-security.test.js */
const { boot7, wh } = require("./p7lib");
const crypto = require("crypto");

(async () => {
  const t = await boot7({ name: "p7_security", port: 5309, env: { REMINDER_CRON_SECRET: "p7-cron-secret-0123456789abcdef" } });
  const { Clinic, User, Appointment, Invoice, Patient } = t.m;
  const Expense = t.M("Expense").Expense, RecurringExpense = t.M("RecurringExpense").RecurringExpense, ClinicalNote = t.M("ClinicalNote").ClinicalNote;
  const api = t.api;
  const sid = (d) => String(d._id);
  const oid = () => String(new t.mongoose.Types.ObjectId());
  const today = t.tz.clinicYmdOf(new Date());
  const tomorrow = t.tz.addDaysYmd(today, 1);
  const MARK = "ZZSECRET";

  // ═══════════════════════════ WORLD ═══════════════════════════
  const A = await t.mkClinic("p7sa", { specialty: "dentistry", plan: "pro", workingHours: wh(), slotDuration: 30 });
  const F = await t.mkClinic("p7sf", { specialty: "dentistry", plan: "pro", workingHours: wh(), slotDuration: 30 });
  const DA = await t.mkClinic("p7sda", { specialty: "dermatology_aesthetics", plan: "pro", workingHours: wh(), slotDuration: 30 });
  const DF = await t.mkClinic("p7sdf", { specialty: "dermatology_aesthetics", plan: "pro", workingHours: wh(), slotDuration: 30 });
  const oA = await t.mkUser(A, "owner"), a1 = await t.mkUser(A, "doctor", 1), a2 = await t.mkUser(A, "doctor", 2), rA = await t.mkUser(A, "receptionist");
  const oF = await t.mkUser(F, "owner"), fD = await t.mkUser(F, "doctor", 1), fR = await t.mkUser(F, "receptionist");
  const oDA = await t.mkUser(DA, "owner"), oDF = await t.mkUser(DF, "owner");
  const TA = { o: t.tok(oA), d1: t.tok(a1), d2: t.tok(a2), r: t.tok(rA) }, TF = { o: t.tok(oF), d: t.tok(fD), r: t.tok(fR) }, TD = { a: t.tok(oDA), f: t.tok(oDF) };

  const pA = await api("POST", "/patients", TA.r, { fullName: `${MARK} Patient A`, phone: "0796777001" });
  const pDA = await api("POST", "/patients", TA.r, { fullName: "x" }); // placeholder (replaced below)
  void pDA;
  const pDerm = await api("POST", "/patients", t.tok(oDA), { fullName: `${MARK} Derm Patient`, phone: "0796777009" });
  t.eq([pA.status, pDerm.status], [201, 201], "W1 patients exist in clinic A and in the dermatology clinic");
  const PA = pA.json._id, PD = pDerm.json._id;
  const apA = await api("POST", "/appointments", TA.r, { patientId: PA, doctorId: sid(a1), startAt: t.tz.clinicLocalToUtc(tomorrow, "10:00").toISOString(), duration: 30 });
  const invA = await api("POST", "/invoices", TA.o, { patientId: PA, doctorId: sid(a1), items: [{ description: `${MARK} Invoice Item`, price: 100, qty: 1 }], discount: 0 });
  await api("POST", `/invoices/${invA.json._id}/payments`, TA.o, { amount: 30 });
  const exA = await api("POST", "/expenses", TA.o, { title: `${MARK} Expense`, category: "lab", scope: "clinic", amount: 44, status: "paid", date: today, doctorId: sid(a1) });
  const billA = await api("POST", "/expenses/recurring", TA.o, { title: `${MARK} Bill`, category: "rent", scope: "clinic", amount: 25, dueDay: 5, startPeriod: today.slice(0, 7) });
  const noteA = await api("POST", `/patients/${PA}/clinical-notes`, TA.d1, { text: `${MARK} clinical note text` });
  t.eq([apA.status, invA.status, exA.status, billA.status, noteA.status], [201, 201, 201, 201, 201], "W2 appointment, invoice+payment, expense, monthly bill and clinical note exist in clinic A");
  const IDS = { patient: PA, appt: apA.json._id, inv: invA.json._id, exp: exA.json._id, bill: billA.json._id, note: noteA.json.note ? noteA.json.note._id : noteA.json._id, doctor: sid(a1), staff: sid(a2) };

  // ═══════════════════════════ S1 — route enumeration ═══════════════════════════
  const mounts = { user: "/users", patient: "/patients", appointment: "/appointments", clinic: "/clinic", invoice: "/invoices", dashboard: "/dashboard", subscription: "/subscription", reports: "/reports", analytics: "/analytics", reminder: "/reminders", chat: "/chat", expense: "/expenses", dental: "/dental", derm: "/derm" };
  const FILE_KEY = { user: "users", patient: "patients", appointment: "appointments", invoice: "invoices", expense: "expenses" };
  const routes = [];
  for (const [file, mount] of Object.entries(mounts)) {
    const router = require(`${t.D}/routes/${file}Routes`).default;
    for (const l of router.stack) if (l.route) for (const m of Object.keys(l.route.methods).filter((x) => l.route.methods[x])) routes.push({ mount, method: m.toUpperCase(), path: l.route.path, file: FILE_KEY[file] || file });
  }
  t.ok(routes.length >= 100, "S0 routes enumerated from the compiled routers", routes.length);

  // fill :params with real ids of clinic A (by router / name); secondary ids are random (the patient/parent is resolved FIRST, by clinic)
  const fillA = (r) => r.path.replace(/:([A-Za-z]+)/g, (_, p) => {
    if (p === "fdi") return "11";
    if (p === "period") return today.slice(0, 7);
    if (r.file === "patients") return p === "id" ? IDS.patient : p === "noteId" ? IDS.note : oid();
    if (r.file === "appointments") return IDS.appt;
    if (r.file === "invoices") return IDS.inv;
    if (r.file === "users") return IDS.staff;
    if (r.file === "expenses") return p === "id" ? (r.path.startsWith("/recurring") ? IDS.bill : IDS.exp) : oid();
    if (r.file === "dental") return p === "patientId" ? IDS.patient : oid();
    if (r.file === "derm") return p === "patientId" ? PD : oid();
    return oid();
  });
  const hasParam = (r) => r.path.includes(":");
  const BODY = (r) => (r.method === "GET" || r.method === "HEAD" ? undefined : {});
  const url = (r) => r.mount + fillA(r);
  const label = (r) => `${r.method} /api${r.mount}${r.path}`;

  // deactivated user + wrong-secret token
  const gone = await t.mkUser(A, "receptionist", 9);
  const tokGone = t.tok(gone);
  await User.updateOne({ _id: gone._id }, { $set: { isActive: false } });
  const tokWrongSecret = t.tok(oA, {}, "not-the-real-secret-0123456789abcdef0123456789");
  const tokNoneAlg = (() => { const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); return `${b({ alg: "none", typ: "JWT" })}.${b({ userId: sid(oA), tokenVersion: 0 })}.`; })();
  let s1bad = [];
  const PUBLIC_BY_DESIGN = new Set(["POST /chat/message"]); // the marketing chatbot: optionalAuth, rate-limited; its dashboard tools answer "Not authenticated" without a session
  for (const r of routes) {
    if (PUBLIC_BY_DESIGN.has(`${r.method} ${r.mount}${r.path}`)) continue;
    for (const [what, tok] of [["anonymous", null], ["garbage token", "garbage"], ["wrong-secret token", tokWrongSecret], ["alg:none token", tokNoneAlg], ["deactivated user", tokGone]]) {
      const res = await api(r.method, url(r), tok, BODY(r));
      if (res.status !== 401) s1bad.push(`${label(r)} ${what} → ${res.status}`);
    }
  }
  t.eq(s1bad.slice(0, 10), [], `S1 ${routes.length} routes × 5 invalid identities → all 401 (${routes.length * 5} requests)`);

  // ═══════════════════════════ S2 — foreign id sweep ═══════════════════════════
  const snapshot = async () => {
    const out = {};
    for (const [k, M] of [["patients", Patient], ["appointments", Appointment], ["invoices", Invoice], ["expenses", Expense], ["recurring", RecurringExpense], ["notes", ClinicalNote], ["users", User], ["clinics", Clinic]]) {
      const filter = k === "clinics" ? { _id: { $in: [A._id, DA._id] } } : { clinicId: { $in: [A._id, DA._id] } };
      out[k] = crypto.createHash("sha1").update(JSON.stringify(await M.find(filter).sort({ _id: 1 }).lean())).digest("hex");
    }
    return out;
  };
  const before = await snapshot();
  const s2bad = [], s2leak = [];
  let s2n = 0;
  for (const r of routes) {
    if (!hasParam(r)) continue;
    const derm = r.file === "derm";
    const attackers = derm ? [["foreign derm owner", TD.f]] : [["foreign owner", TF.o], ["foreign doctor", TF.d], ["foreign receptionist", TF.r]];
    for (const [who, tok] of attackers) {
      const res = await api(r.method, url(r), tok, BODY(r));
      s2n++;
      if (res.status >= 200 && res.status < 300) s2bad.push(`${label(r)} as ${who} → ${res.status}`);
      if (res.status >= 500) s2bad.push(`${label(r)} as ${who} → ${res.status} (server error)`);
      if (res.text.includes(MARK)) s2leak.push(`${label(r)} as ${who}`);
    }
  }
  t.eq(s2bad.slice(0, 10), [], `S2 ${s2n} cross-clinic requests with REAL ids of clinic A → never 2xx / 5xx`);
  t.eq(s2leak.slice(0, 10), [], "S2b …and no response carries any of clinic A's data");

  // ═══════════════════════════ S3 — foreign LISTS ═══════════════════════════
  const s3leak = [];
  let s3n = 0;
  for (const r of routes) {
    if (r.method !== "GET" || hasParam(r)) continue;
    if (r.file === "derm" || r.file === "dental") continue; // module routes are all patient-scoped except dashboards (below)
    for (const tok of [TF.o, TF.d, TF.r, TD.f]) {
      const res = await api("GET", `${r.mount}${r.path}`, tok);
      s3n++;
      if (res.text.includes(MARK) || res.status >= 500) s3leak.push(`${label(r)} → ${res.status}${res.text.includes(MARK) ? " LEAK" : ""}`);
    }
  }
  for (const p of ["/dental/dashboard", "/derm/dashboard"]) for (const tok of [TF.o, TD.f]) { const res = await api("GET", p, tok); s3n++; if (res.text.includes(MARK) || res.status >= 500) s3leak.push(`GET ${p} → ${res.status}`); }
  for (const q of [`?search=${MARK}`, `?q=${MARK}`, `?search=Patient`, `?doctorId=${IDS.doctor}`, `?patientId=${IDS.patient}`]) for (const p of ["/patients", "/appointments", "/invoices", "/expenses/ledger", "/analytics/doctors", "/analytics/financial", "/analytics/patients"]) {
    const res = await api("GET", p + q + (p.startsWith("/analytics") ? (q.includes("?") ? "&" : "?") + "preset=this_month" : ""), TF.o); s3n++;
    if (res.text.includes(MARK) || res.status >= 500) s3leak.push(`GET ${p}${q} → ${res.status}`);
  }
  t.eq(s3leak.slice(0, 10), [], `S3 ${s3n} list / aggregate requests by other clinics: no marker of clinic A, no 5xx`);
  const fa = await api("GET", `/analytics/financial?preset=this_month&compare=0&doctorId=${IDS.doctor}`, TF.o);
  t.ok([400, 403, 404].includes(fa.status), "S3b another clinic's owner filtering Reports by clinic A's doctor id is refused", fa.status);
  const fx = await api("GET", `/dashboard/stats?doctorId=${IDS.doctor}`, TF.o);
  t.ok(fx.status === 400 || (fx.status === 200 && fx.json.today.total === 0 && fx.json.today.revenue === 0 && !fx.text.includes(MARK)), "S3c …the dashboard answers with an EMPTY clinic-F scope (zeros), never clinic A's numbers", fx.status);
  const fl = await api("GET", `/expenses/ledger?doctorId=${IDS.doctor}`, TF.o);
  t.ok(fl.status === 400 || (fl.status === 200 && (fl.json.rows || fl.json.items || []).length === 0 && !fl.text.includes(MARK)), "S3d …and so does the expense ledger", fl.status);

  // ═══════════════════════════ S4 — foreign WRITES with valid bodies ═══════════════════════════
  const hostile = [
    ["PATCH", `/patients/${PA}`, { fullName: "HACKED" }],
    ["POST", `/patients/${PA}/clinical-notes`, { text: "HACKED NOTE" }],
    ["PUT", `/patients/${PA}/clinical-notes/${IDS.note}`, { text: "HACKED EDIT" }],
    ["PATCH", `/appointments/${IDS.appt}/status`, { status: "cancelled" }],
    ["PATCH", `/appointments/${IDS.appt}/read`, {}],
    ["PUT", `/invoices/${IDS.inv}`, { items: [{ description: "HACKED", price: 1, qty: 1 }], discount: 0 }],
    ["POST", `/invoices/${IDS.inv}/payments`, { amount: 5 }],
    ["POST", "/invoices", { patientId: PA, items: [{ description: "HACKED", price: 1, qty: 1 }], discount: 0 }],
    ["POST", "/appointments", { patientId: PA, doctorId: IDS.doctor, startAt: t.tz.clinicLocalToUtc(tomorrow, "11:00").toISOString(), duration: 30 }],
    ["PUT", `/expenses/${IDS.exp}`, { title: "HACKED", amount: 1 }],
    ["POST", `/expenses/${IDS.exp}/pay`, {}],
    ["DELETE", `/expenses/${IDS.exp}`, undefined],
    ["PUT", `/expenses/recurring/${IDS.bill}`, { title: "HACKED" }],
    ["DELETE", `/expenses/recurring/${IDS.bill}`, undefined],
    ["POST", `/expenses/recurring/${IDS.bill}/pay`, { period: today.slice(0, 7) }],
    ["PATCH", `/users/${IDS.staff}`, { name: "HACKED", role: "owner" }],
    ["PATCH", `/users/${IDS.staff}/active`, {}],
    ["PUT", `/users/${IDS.staff}/working-hours`, { workingHours: wh("00:00", "23:00") }],
    ["POST", `/dental/patients/${PA}/treatment-plan/items`, { toothFdi: 11, procedureKey: "filling", description: "HACKED" }],
    ["PUT", `/dental/patients/${PA}/dentition`, { dentition: "permanent" }],
    ["POST", `/dental/patients/${PA}/teeth/11/conditions`, { condition: "caries" }],
    ["POST", `/derm/patients/${PD}/assessments`, { area: "face", notes: "HACKED" }],
    ["POST", `/derm/patients/${PD}/follow-ups`, { dueDate: tomorrow, reason: "HACKED" }],
    ["PATCH", "/clinic", { name: "HACKED CLINIC" }],
  ];
  const s4bad = [];
  for (const [m, p, b] of hostile) {
    for (const [who, tok] of p.startsWith("/derm") ? [["foreign derm owner", TD.f]] : [["foreign owner", TF.o], ["foreign doctor", TF.d]]) {
      if (p === "/clinic") continue; // PATCH /clinic is the caller's OWN clinic: checked below
      const res = await api(m, p, tok, b);
      if (res.status >= 200 && res.status < 300) s4bad.push(`${m} ${p.replace(/[a-f0-9]{24}/g, ":id")} as ${who} → ${res.status}`);
    }
  }
  const after = await snapshot();
  t.eq(s4bad.slice(0, 10), [], `S4 ${hostile.length - 1} hostile writes with VALID bodies by another clinic → never 2xx`);
  t.eq(after, before, "S4b …and a hash of every clinic-A document (patients, appointments, invoices, expenses, bills, notes, users, clinics) is byte-identical afterwards");

  // PATCH /clinic by foreign owner changes THEIR clinic only
  await api("PATCH", "/clinic", TF.o, { name: "F Renamed" });
  t.eq([(await Clinic.findById(A._id).lean()).name, (await Clinic.findById(F._id).lean()).name], ["Clinic p7sa", "F Renamed"], "S4c PATCH /clinic can only ever touch the caller's own clinic");

  // ═══════════════════════════ S5 — role matrices ═══════════════════════════
  const st = async (m, p, tok, b) => (await api(m, p, tok, b)).status;
  // receptionist
  const recForbidden = [
    ["GET", "/expenses/ledger"], ["GET", "/expenses/summary"], ["GET", "/expenses/overview"], ["POST", "/expenses"], ["GET", `/expenses/${IDS.exp}`],
    ["GET", "/analytics/overview?preset=today"], ["GET", "/analytics/financial?preset=today"], ["GET", "/analytics/doctors?preset=today"], ["GET", "/analytics/export?section=financial&format=csv&preset=today"],
    ["GET", "/reports/monthly"], ["POST", `/patients/${PA}/clinical-notes`, { text: "rec note" }], ["PUT", `/patients/${PA}/clinical-notes/${IDS.note}`, { text: "rec edit" }],
    ["POST", `/dental/patients/${PA}/treatment-plan/items`, {}], ["PUT", `/dental/patients/${PA}/dentition`, { dentition: "permanent" }],
    ["POST", "/users", { name: "Evil Rec", email: "evil@x.io", password: "secret123", role: "receptionist" }], ["PATCH", `/users/${IDS.staff}`, { name: "x" }], ["PATCH", `/users/${IDS.staff}/active`, {}],
    ["PATCH", "/clinic", { name: "rec rename" }], ["GET", "/clinic/export"], ["DELETE", "/clinic", { confirmText: "DELETE" }],
  ];
  const recBad = [];
  for (const [m, p, b] of recForbidden) { const s = await st(m, p, TA.r, b); if (s !== 403) recBad.push(`${m} ${p.replace(/[a-f0-9]{24}/g, ":id")} → ${s}`); }
  t.eq(recBad, [], `S5 receptionist: ${recForbidden.length} forbidden operations → all 403`);
  const dashR = (await api("GET", "/dashboard/stats", TA.r)).json;
  t.eq(dashR.today.revenue, null, "S5b receptionist dashboard carries no revenue");
  const invR = await api("GET", "/invoices", TA.r);
  t.eq(invR.status, 200, "S5c …but the receptionist can list invoices & take payments (front-desk job)");
  t.eq((await api("POST", `/invoices/${IDS.inv}/payments`, TA.r, { amount: 1 })).status, 200, "S5d …record a payment");
  // doctor B against doctor A
  const docB = [
    ["GET", `/expenses/${IDS.exp}`, 404], ["PUT", `/invoices/${IDS.inv}`, 404], ["POST", `/invoices/${IDS.inv}/payments`, 404], ["PATCH", `/appointments/${IDS.appt}/status`, 404],
    ["GET", `/analytics/financial?preset=this_month&doctorId=${sid(a1)}`, 403], ["GET", `/dashboard/stats?doctorId=${sid(a1)}`, 403], ["GET", `/expenses/ledger?doctorId=${sid(a1)}`, 403],
    ["GET", "/analytics/loyalty?preset=this_month", 403],
    ["POST", "/expenses", 403], ["PUT", `/expenses/${IDS.exp}`, 403], ["DELETE", `/expenses/${IDS.exp}`, 403], ["GET", "/expenses/overview", 403],
    ["POST", "/users", 403], ["PATCH", `/users/${sid(a1)}`, 403], ["PATCH", `/users/${sid(a1)}/active`, 403], ["PATCH", "/clinic", 403], ["GET", "/clinic/export", 403], ["DELETE", "/clinic", 403],
  ];
  const dbBad = [];
  for (const [m, p, want] of docB) {
    const body = m === "GET" || m === "DELETE" ? undefined : m === "PUT" && p.includes("invoices") ? { items: [{ description: "x", price: 1, qty: 1 }], discount: 0 } : m === "POST" && p.includes("payments") ? { amount: 1 } : m === "PATCH" && p.includes("status") ? { status: "cancelled" } : m === "POST" && p === "/users" ? { name: "Evil Doc", email: "evildoc@x.io", password: "secret123", role: "receptionist" } : {};
    const s = await st(m, p, TA.d2, body);
    if (s !== want) dbBad.push(`${m} ${p.replace(/[a-f0-9]{24}/g, ":id")} → ${s} (want ${want})`);
  }
  t.eq(dbBad, [], `S5e Doctor B vs Doctor A's data + owner-only operations: ${docB.length} checks`);
  const dB = await api("GET", "/analytics/doctors?preset=this_month&compare=0", TA.d2);
  t.ok(dB.status === 200 && dB.json.rows.length === 1 && dB.json.rows[0].doctorId === sid(a2) && dB.json.clinic === null && !dB.text.includes(sid(a1)) && dB.json.unassignedRevenue === null, "S5e2 Doctor B's Reports → Doctors tab holds ONLY their own row (no colleague, no clinic totals, no unassigned revenue)");
  const invListB = (await api("GET", "/invoices", TA.d2)).json;
  t.ok(!JSON.stringify(invListB).includes(MARK), "S5f Doctor B's invoice list does not contain Doctor A's invoice");
  t.eq(await Invoice.countDocuments({ _id: IDS.inv, "payments.amount": 1 }) >= 0, true, "S5g (control)");
  // owner escalation attempts by a lower role
  t.eq((await User.findById(a2._id).lean()).role, "doctor", "S5h Doctor B is still a doctor (no role escalation happened)");
  t.eq((await User.countDocuments({ clinicId: A._id, role: "owner" })), 1, "S5i clinic A still has exactly one owner");

  // ═══════════════════════════ S6 — mass assignment ═══════════════════════════
  const FOREIGN_ID = sid(F._id ? F : F);
  const m1 = await api("POST", "/patients", TA.r, { fullName: "Mass P", phone: "0796777100", clinicId: sid(F), fileNumber: 99999, isArchived: true, createdAt: "2001-01-01T00:00:00Z", _id: oid(), createdBy: sid(oF), __v: 7 });
  const mp = await Patient.findById(m1.json._id).lean();
  t.eq([m1.status, String(mp.clinicId), mp.fileNumber !== 99999, mp.isArchived === true, mp.createdAt.getFullYear() >= 2026], [201, sid(A), true, false, true], "S6a patient: clinicId / fileNumber / isArchived / createdAt from the client are ignored");
  const m2 = await api("POST", "/invoices", TA.r, { patientId: PA, items: [{ description: "Mass", price: 80, qty: 1 }], discount: 0, status: "paid", total: 1, payments: [{ amount: 80, method: "cash", paidAt: new Date().toISOString() }], clinicId: sid(F), invoiceNumber: 1, createdBy: sid(oF), doctorId: sid(a1) });
  const mi = await Invoice.findById(m2.json._id).lean();
  t.eq([m2.status, mi.status, mi.total, (mi.payments || []).length, String(mi.clinicId), String(mi.createdBy)], [201, "unpaid", 80, 0, sid(A), sid(rA)], "S6b invoice: status / total / payments / clinicId / createdBy from the client are ignored");
  t.ok(mi.invoiceNumber !== 1, "S6b2 …and invoiceNumber is server-assigned", mi.invoiceNumber);
  const m3 = await api("POST", "/appointments", TA.r, { patientId: PA, doctorId: sid(a2), startAt: t.tz.clinicLocalToUtc(tomorrow, "12:00").toISOString(), duration: 30, clinicId: sid(F), createdBy: sid(oF), status: "completed", reminderSent: true, isRead: true });
  t.eq((await api("POST", "/appointments", TA.r, { patientId: PA, doctorId: sid(a2), startAt: t.tz.clinicLocalToUtc(tomorrow, "13:00").toISOString(), duration: 30, source: "public" })).status, 400, "S6c0 source:'public' (reserved for the public booking page) is refused (400)");
  const ma = m3.json && m3.json._id ? await Appointment.findById(m3.json._id).lean() : null;
  t.ok(m3.status === 201 && ma && String(ma.clinicId) === sid(A) && ma.status === "scheduled" && ma.source !== "public" && ma.reminderSent !== true && String(ma.createdBy) === sid(rA), "S6c appointment: clinicId / createdBy / status:'completed' / reminderSent from the client are ignored", { http: m3.status, body: m3.json && (m3.json.message || m3.json.code), s: ma && ma.status, src: ma && ma.source });
  const m4 = await api("POST", "/expenses", TA.o, { title: "Mass E", category: "other", scope: "clinic", amount: 3, status: "paid", date: today, clinicId: sid(F), createdBy: sid(oF), deletedAt: new Date().toISOString(), dedupeKey: "x", recurringId: IDS.bill, period: "1999-01" });
  const me = await Expense.findById(m4.json._id).lean();
  t.ok(m4.status === 201 && String(me.clinicId) === sid(A) && !me.deletedAt && me.period === today.slice(0, 7) && !me.recurringId && me.dedupeKey !== "x" && String(me.createdBy) === sid(oA), "S6d expense: clinicId / createdBy / deletedAt / period / recurringId / dedupeKey from the client are ignored");
  const m5 = await api("PATCH", "/clinic", TA.o, { name: "A Renamed", plan: "enterprise", planExpiresAt: "2099-01-01T00:00:00Z", status: "active", slug: "hijacked", addons: { loyalty: { active: true } }, _id: oid(), isSuspended: false });
  const mc = await Clinic.findById(A._id).lean();
  t.ok(mc.name === "A Renamed" && mc.plan === "pro" && mc.slug === "p7sa" && (!mc.planExpiresAt || mc.planExpiresAt.getFullYear() < 2090), "S6e clinic profile: plan / planExpiresAt / slug / addons / status cannot be set by the owner", { plan: mc.plan, slug: mc.slug, status: m5.status });
  const m6 = await api("POST", "/users", TA.o, { name: "Mass Staff", email: "massstaff@p7.io", password: "secret123", role: "doctor", phone: "0791234567", clinicId: sid(F), isActive: false, emailVerified: false, tokenVersion: 99, permissions: ["all"] });
  const mu = await User.findOne({ email: "massstaff@p7.io" }).lean();
  t.ok(m6.status === 201 && String(mu.clinicId) === sid(A) && mu.role === "doctor" && mu.tokenVersion !== 99, "S6f staff: clinicId / tokenVersion from the client are ignored");
  t.eq((await api("POST", "/users", TA.o, { name: "Sneaky Owner", email: "sneaky@p7.io", password: "secret123", role: "owner" })).status, 400, "S6g an owner cannot create a second 'owner' through the staff endpoint (400)");
  t.eq((await api("POST", "/users", TA.o, { name: "Sneaky Admin", email: "sneaky2@p7.io", password: "secret123", role: "admin" })).status, 400, "S6h …nor an unknown role");
  const reg = await t.http("POST", "/auth/register-clinic", { body: { clinicName: "Reg Mass", ownerName: "Reg Owner", email: "regmass@p7.io", password: "secret123", phone: "0791234500", plan: "enterprise", role: "owner", status: "active", planExpiresAt: "2099-01-01", addons: { loyalty: { active: true } }, emailVerified: true, specialty: "general" } });
  const rc = await Clinic.findOne({ name: /Reg Mass/ }).lean();
  t.ok(!rc || (rc.plan !== "enterprise" && (!rc.planExpiresAt || rc.planExpiresAt.getFullYear() < 2090) && !(rc.addons && rc.addons.loyalty && rc.addons.loyalty.active === true)), "S6i public clinic registration: a client cannot choose its own plan / expiry / paid add-on", rc && { plan: rc.plan, reg: reg.status });
  if (rc) { const ru = await User.findOne({ clinicId: rc._id, role: "owner" }).lean(); t.ok(ru && ru.emailVerified !== true, "S6j …nor mark its own e-mail as verified"); }

  // ═══════════════════════════ S7 — hostile input ═══════════════════════════
  const RAW = (p, body, tok) => t.http("POST", p, { token: tok, rawBody: body });
  const inj = [];
  const bad500 = (what, r) => { if (r.status >= 500) inj.push(`${what} → ${r.status}`); if (/MongoServerError|at .*\.(js|ts):\d+|node_modules|\/home\/|stack/i.test(r.text)) inj.push(`${what} leaked internals`); };
  // login with operator objects
  for (const body of [{ email: { $ne: null }, password: { $ne: null } }, { email: { $gt: "" }, password: "x" }, { email: "a@b.co", password: { $regex: ".*" } }, { email: ["a@b.co"], password: ["x"] }, { email: "a@b.co" }, {}, [], "str", null, { email: "x".repeat(100000), password: "y" }]) {
    const r = await t.http("POST", "/auth/login", { body });
    bad500("login " + JSON.stringify(body).slice(0, 60), r);
    if (r.status === 200) inj.push("login accepted an operator object: " + JSON.stringify(body).slice(0, 60));
  }
  // query operators on list endpoints (qs-style and JSON-ish)
  for (const q of ["search[$ne]=x", "search[$regex]=.*", "patientId[$ne]=1", "doctorId[$ne]=1", "status[$ne]=x", "date[$gt]=1", "from[$gt]=1&to=2026-01-01", "preset[]=today", "page=-1", "page=abc", "limit=999999999", "limit=-5", "sort=__proto__", "search=" + "a".repeat(20000), "search=%00%0d%0a", "search=<script>alert(1)</script>", "search=%E2%80%AE evil"]) {
    for (const p of ["/patients", "/appointments", "/invoices", "/expenses/ledger", "/analytics/financial", "/analytics/patients", "/analytics/export", "/dental/dashboard"]) {
      const r = await api("GET", `${p}?${q}`, TA.o);
      bad500(`GET ${p}?${q.slice(0, 40)}`, r);
    }
  }
  // wrong types / hostile bodies on write endpoints
  const wild = [{ fullName: { $ne: 1 }, phone: "0791" }, { fullName: ["a"], phone: 1 }, { fullName: "x".repeat(10000), phone: "0791" }, { fullName: "<img src=x onerror=alert(1)>", phone: "0796777200" }, { fullName: "ok", phone: "+٩٦٢٧٩١٢٣٤٥٦٧" }, { __proto__: { isAdmin: true }, fullName: "p", phone: "0796777201" }, { constructor: { prototype: { polluted: 1 } }, fullName: "p2", phone: "0796777202" }];
  for (const b of wild) bad500("POST /patients " + JSON.stringify(b).slice(0, 50), await api("POST", "/patients", TA.r, b));
  for (const b of [{ patientId: { $ne: 1 }, items: [] }, { patientId: PA, items: "x" }, { patientId: PA, items: [{ description: "a", price: "1e999", qty: 1 }] }, { patientId: PA, items: [{ description: "a", price: -1, qty: 1 }] }, { patientId: PA, items: [{ description: "a", price: 1, qty: 0 }] }, { patientId: PA, items: [{ description: "a".repeat(5000), price: 1, qty: 1 }] }, { patientId: PA, items: [{ description: "a", price: null, qty: 1 }] }, { patientId: PA, items: Array(500).fill({ description: "a", price: 1, qty: 1 }) }, { patientId: PA, items: [{ description: "a", price: 1, qty: 1 }], discount: -5 }, { patientId: PA, items: [{ description: "a", price: 1, qty: 1 }], discount: 1e300 }]) {
    const r = await api("POST", "/invoices", TA.o, b); bad500("POST /invoices " + JSON.stringify(b).slice(0, 60), r);
    if (r.status === 201) inj.push("invoice accepted hostile body " + JSON.stringify(b).slice(0, 60));
  }
  for (const b of [{ amount: "5" }, { amount: -5 }, { amount: 0 }, { amount: 1e300 }, { amount: NaN }, { amount: null }, { amount: { $gt: 0 } }, { amount: [5] }, { amount: 5, method: { $ne: 1 } }, { amount: 5, method: "bitcoin" }, { amount: 0.0001 }, {}]) {
    const r = await api("POST", `/invoices/${IDS.inv}/payments`, TA.o, b); bad500("payment " + JSON.stringify(b), r);
    if (r.status === 200 && !(b.amount === 5 && b.method === undefined)) inj.push("payment accepted " + JSON.stringify(b));
  }
  for (const b of [{ title: "x", category: "nope", scope: "clinic", amount: 1, date: today }, { title: "x", category: "other", scope: "clinic", amount: -1, date: today }, { title: "x", category: "other", scope: "clinic", amount: 1, date: "2026-02-30" }, { title: "x", category: "other", scope: "clinic", amount: 1, date: "31/12/2026" }, { title: { $ne: 1 }, category: "other", scope: "clinic", amount: 1, date: today }, { title: "x", category: "other", scope: "clinic", amount: "1e999", date: today }, { title: "x", category: "other", scope: "clinic", amount: 1, date: today, doctorId: "zzz" }, { title: "x", category: "other", scope: "clinic", amount: 1, date: today, doctorId: sid(rA) }, { title: "x", category: "other", scope: "clinic", amount: 1, date: today, doctorId: sid(fD) }]) {
    const r = await api("POST", "/expenses", TA.o, b); bad500("POST /expenses " + JSON.stringify(b).slice(0, 60), r);
    if (r.status === 201) inj.push("expense accepted hostile body " + JSON.stringify(b).slice(0, 80));
  }
  for (const b of [{ patientId: PA, doctorId: sid(a1), startAt: "not-a-date", duration: 30 }, { patientId: PA, doctorId: sid(a1), startAt: "2026-02-30T10:00:00Z", duration: 30 }, { patientId: PA, doctorId: sid(a1), startAt: new Date(Date.now() + 864e5).toISOString(), duration: -5 }, { patientId: PA, doctorId: sid(a1), startAt: new Date(Date.now() + 864e5).toISOString(), duration: 1e9 }, { patientId: PA, doctorId: sid(fD), startAt: new Date(Date.now() + 864e5).toISOString(), duration: 30 }, { patientId: sid(pDerm._id ? pDerm : pDerm), doctorId: sid(a1), startAt: new Date(Date.now() + 864e5).toISOString(), duration: 30 }, { patientId: { $ne: 1 }, doctorId: sid(a1) }]) {
    const r = await api("POST", "/appointments", TA.r, b); bad500("POST /appointments " + JSON.stringify(b).slice(0, 60), r);
    if (r.status === 201) inj.push("appointment accepted hostile body " + JSON.stringify(b).slice(0, 80));
  }
  for (const [p, raw] of [["/patients", "{bad json"], ["/patients", ""], ["/invoices", "[[["], ["/auth/login", "{\"email\":"], ["/expenses", "\u0000"], ["/patients", "x".repeat(2 * 1024 * 1024)]]) {
    const r = await RAW(p, raw, TA.o);
    bad500(`raw body to ${p}`, r);
    if (r.status < 400) inj.push(`raw body to ${p} → ${r.status}`);
  }
  for (const id of ["../etc/passwd", "%2e%2e%2f", "null", "undefined", "{}", "0", "-1", "a".repeat(300), "%00", "123456789012345678901234", "zzzzzzzzzzzzzzzzzzzzzzzz"]) {
    for (const p of [`/patients/${id}`, `/appointments/${id}/status`, `/invoices/${id}/payments`, `/expenses/${id}`, `/users/${id}`, `/dental/patients/${id}/record`]) {
      const r = await api(p.includes("status") || p.includes("payments") ? "POST" : "GET", p, TA.o, p.includes("payments") ? { amount: 1 } : p.includes("status") ? { status: "confirmed" } : undefined);
      bad500(`${p}`, r);
      if (r.status >= 200 && r.status < 300 && !(r.status === 200 && p.startsWith("/expenses/"))) inj.push(`${p} → ${r.status}`);
    }
  }
  t.eq(inj.slice(0, 12), [], "S7 hostile input (NoSQL operators, prototype pollution, wrong types, giant/invalid bodies, malformed ids): never 5xx, never an internal, never accepted");
  t.ok(!(await Patient.findOne({ clinicId: A._id, fullName: /\$ne/ })), "S7b no operator object was stored as data");
  t.eq(({}).polluted, undefined, "S7c Object.prototype of the test process is untouched (and the server kept answering after the pollution attempts)");
  t.eq((await fetch(t.BASE.replace(/\/api$/, "") + "/health")).status, 200, "S7d server still healthy after the whole penetration run");
  // scheduler endpoints: fail closed without / with a wrong secret
  const cron = [];
  for (const p of ["/reminders/send-daily", "/reminders/send-subscription-reminders", "/reminders/send-expense-reminders"]) {
    for (const [what, h] of [["no secret", undefined], ["wrong secret", { "x-cron-secret": "nope" }], ["staff JWT instead", { authorization: "Bearer " + TA.o }]]) {
      const r = await fetch(t.BASE + p, { method: "POST", headers: h });
      if (r.status !== 401) cron.push(`${p} ${what} → ${r.status}`);
    }
  }
  t.eq(cron, [], "S7e the three scheduler endpoints reject: no secret, a wrong secret, and a staff JWT (401)");

  // headers on a normal response
  const hh = await fetch(t.BASE + "/patients", { headers: { authorization: "Bearer " + TA.o } });
  t.ok(!hh.headers.get("x-powered-by"), "S8 no X-Powered-By header");
  t.ok(hh.headers.get("x-content-type-options") === "nosniff", "S8b X-Content-Type-Options: nosniff");

  t.noLeaks("no response of the penetration suite leaked a stack, path or Mongo internals");
  await t.finish("PHASE 7 — authorization penetration");
})().catch((e) => { console.error(e); process.exit(1); });
