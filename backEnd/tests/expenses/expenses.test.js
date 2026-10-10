/* PHASE 5 — Expenses & financial architecture. ATTACKER-STYLE, end-to-end against the COMPILED server (real HTTP, real database).
     npm run build && node tests/expenses/expenses.test.js
   Optional env: P10_MONGO (default mongodb://127.0.0.1:27017), P10_DIST, P10_OUT.
   World: Clinic A: Owner, Doctor A, Doctor B, Receptionist.  Clinic B: Owner, Doctor, Receptionist.
   The numbers in the comments are the Phase 5 test-matrix numbers (1–42); 34–42 (invoices, payments, treatment→invoice, walk-in, public
   booking, schedule, dental chart, notes, Phase 4 permissions) are the earlier suites, which are re-run unchanged. */
const path = require("path");
const { boot } = require("../phase10/lib");

(async () => {
  const t = await boot({ name: "expenses", port: 5305, env: { NODE_OPTIONS: `--require ${path.join(__dirname, "../multi-doctor/ferret-date-shim.js")}` } });
  const { ok, eq, http, m } = t;
  const { Invoice, User } = m;
  const { Expense } = t.M("Expense");
  const { RecurringExpense } = t.M("RecurringExpense");
  const sid = (x) => String(x._id);

  const A = await t.mkClinic("ex-a", { specialty: "dentistry", plan: "pro" });
  const B = await t.mkClinic("ex-b", { specialty: "dentistry", plan: "pro" });
  const owner = await t.mkUser(A, "owner"), docA = await t.mkUser(A, "doctor", 1), docB = await t.mkUser(A, "doctor", 2), rec = await t.mkUser(A, "receptionist");
  const docOff = await t.mkUser(A, "doctor", 3); await User.updateOne({ _id: docOff._id }, { isActive: false });
  const ownerB = await t.mkUser(B, "owner"), docX = await t.mkUser(B, "doctor"), recB = await t.mkUser(B, "receptionist");
  const tkO = t.tok(owner), tkA = t.tok(docA), tkB = t.tok(docB), tkR = t.tok(rec), tkOB = t.tok(ownerB), tkDX = t.tok(docX), tkRB = t.tok(recB);
  const api = (method, url, token, body) => http(method, url, { token, body });
  const raw = (url, token, rawBody) => http("POST", url, { token, rawBody, headers: { "Content-Type": "application/json" } });
  const post = async (token, body) => api("POST", "/expenses", token, body);
  const ledger = async (token, qs = "") => api("GET", "/expenses/ledger" + (qs ? "?" + qs : ""), token);
  const summary = async (token, qs = "") => api("GET", "/expenses/summary" + (qs ? "?" + qs : ""), token);
  const ids = (r) => (r.json.items || []).map((x) => x.title);

  /* ================= access matrix as the UI receives it ================= */
  const me = async (tk) => (await api("GET", "/auth/me", tk)).json.access;
  const aO = await me(tkO), aD = await me(tkA), aR = await me(tkR);
  eq([aO.expenses, aO.expensesManage, aD.expenses, aD.expensesManage, aR.expenses, aR.expensesManage], ["clinic", "clinic", "self", "none", "none", "none"], "A1 /auth/me: owner manages, doctor reads own, receptionist none");

  /* ================= 1–3. owner creates clinic / Doctor A / Doctor B expenses ================= */
  const rent = await post(tkO, { title: "Rent October", category: "rent", scope: "clinic", amount: 1200, status: "paid", date: "2026-09-28", method: "bank" });
  eq(rent.status, 201, "1  owner creates a CLINIC expense");
  const lab = await post(tkO, { title: "Crown laboratory work", category: "lab", scope: "clinic", amount: 35, status: "paid", date: "2026-10-02", vendor: "Alpha Dental Lab", reference: "LAB-1001", doctorId: sid(docA) });
  eq(lab.status, 201, "2  owner creates a Doctor A expense");
  const mat = await post(tkO, { title: "Composite kit", category: "materials", scope: "clinic", amount: 60, status: "paid", date: "2026-10-05", doctorId: sid(docB) });
  eq(mat.status, 201, "3  owner creates a Doctor B expense");
  const fam = await post(tkO, { title: "School fees", category: "family", scope: "personal", amount: 80, status: "paid", date: "2026-10-03" });
  eq(fam.status, 201, "3b owner creates a PERSONAL expense");
  const pend = await post(tkO, { title: "Pending compressor", category: "equipment", scope: "clinic", amount: 500, status: "pending", date: "2026-10-30" });
  eq(pend.status, 201, "3c owner creates a PENDING (future) expense");
  const dbRent = await Expense.findById(rent.json._id).lean(), dbLab = await Expense.findById(lab.json._id).lean();
  ok(!dbRent.doctorId && String(dbRent.createdBy) === sid(owner), "5a clinic expense: no doctor, createdBy = the authenticated owner");
  ok(String(dbLab.doctorId) === sid(docA) && String(dbLab.createdBy) === sid(owner) && dbLab.vendor === "Alpha Dental Lab" && dbLab.reference === "LAB-1001", "5b doctor expense: doctorId = Dr A (financial owner) while createdBy = Owner (typist) — not the same thing");
  eq(String(dbLab.clinicId), sid(A), "5c clinicId comes from the token, not the client");

  /* ================= 4–10. owner reads, filters, totals ================= */
  const all = await ledger(tkO);
  eq(all.status, 200, "4a owner ledger");
  eq(ids(all).sort(), ["Composite kit", "Crown laboratory work", "Pending compressor", "Rent October", "School fees"].sort(), "4  owner sees all (clinic + both doctors + personal + pending)");
  eq(ids(await ledger(tkO, "kind=clinic")).sort(), ["Pending compressor", "Rent October"], "5  filter Clinic only (shared clinic expenses; no doctor, no personal)");
  eq(ids(await ledger(tkO, "kind=doctor")).sort(), ["Composite kit", "Crown laboratory work"], "5b filter Doctor expenses");
  eq(ids(await ledger(tkO, "kind=personal")), ["School fees"], "5c filter Personal");
  eq(ids(await ledger(tkO, `doctorId=${sid(docA)}`)), ["Crown laboratory work"], "6  filter Doctor A");
  eq(ids(await ledger(tkO, `doctorId=${sid(docB)}`)), ["Composite kit"], "7  filter Doctor B");
  eq(ids(await ledger(tkO, "category=lab")), ["Crown laboratory work"], "8  filter by category");
  eq(ids(await ledger(tkO, "from=2026-09-28&to=2026-09-30")), ["Rent October"], "9  date range (Sept 28–30) → the Sept 28 expense");
  eq(ids(await ledger(tkO, "from=2026-10-01&to=2026-10-31&status=paid")).sort(), ["Composite kit", "Crown laboratory work", "School fees"], "9b date range (October, paid)");
  eq(ids(await ledger(tkO, "search=alpha")), ["Crown laboratory work"], "9c search by vendor");
  eq(ids(await ledger(tkO, "search=lab-1001")), ["Crown laboratory work"], "9d search by reference");
  eq(ids(await ledger(tkO, "search=composite")), ["Composite kit"], "9e search by description");
  eq(ids(await ledger(tkO, "search=.*")), [], "9f regex characters are literal text, not a pattern");
  const sAll = (await summary(tkO)).json;
  eq(sAll.totals, { business: 1295, clinic: 1200, doctor: 95, personal: 80 }, "10 totals: business 1295 = clinic 1200 + doctors 95; personal 80 reported separately, never inside business");
  eq(sAll.pending, 500, "10b the pending 500 is informational and not part of any total");
  eq(sAll.byDoctor.map((d) => [d.name, d.total]), [["doctor 2", 60], ["doctor 1", 35]], "10c by doctor (doctor-attributed only; the clinic's rent is NOT split between doctors)");
  eq(sAll.byCategory.find((c) => c.category === "rent"), { category: "rent", total: 1200, clinic: 1200, doctor: 0, personal: 0 }, "10d by category");
  eq((await summary(tkO, "from=2026-10-01&to=2026-10-31")).json.totals, { business: 95, clinic: 0, doctor: 95, personal: 80 }, "10e totals for a date range use the expense date (financial date)");
  eq((await summary(tkO, `doctorId=${sid(docA)}`)).json.totals, { business: 35, clinic: 0, doctor: 35, personal: 0 }, "10f owner narrowed to Doctor A");
  eq((await summary(tkO, "kind=clinic")).json.totals.business, 1200, "10g owner kind=clinic");

  /* ================= 11–14, 17, 18. doctors see only their own ================= */
  const lA = await ledger(tkA);
  eq(ids(lA), ["Crown laboratory work"], "11 Doctor A sees only Doctor A's expense");
  ok(!ids(lA).includes("Composite kit"), "12 Doctor A cannot see Doctor B's expense in the list");
  ok(!ids(lA).includes("Rent October") && !ids(lA).includes("School fees"), "13 Doctor A cannot see the clinic's private expenses (rent) nor the owner's personal ones");
  eq(ids(await ledger(tkB)), ["Composite kit"], "14 Doctor B sees only Doctor B's expense, not Doctor A's");
  eq((await summary(tkA)).json.totals, { business: 35, clinic: 0, doctor: 35, personal: 0 }, "11b Doctor A's summary has only their own figures");
  eq((await summary(tkA)).json.byDoctor.map((d) => d.total), [35], "11c …and no other doctor appears in it");
  eq((await ledger(tkA, `doctorId=${sid(docA)}`)).status, 200, "17a Doctor A asking for himself is fine");
  eq((await ledger(tkA, `doctorId=${sid(docB)}`)).status, 403, "17 Doctor A cannot bypass the scope with ?doctorId=B");
  eq((await summary(tkA, `doctorId=${sid(docB)}`)).status, 403, "17b …nor on the summary");
  eq((await ledger(tkA, "doctorId=unassigned")).status, 403, "17c …nor by asking for the unassigned / clinic bucket");
  eq(ids(await ledger(tkA, "kind=clinic")), [], "17d …nor with kind=clinic (a doctor's own scope still applies → nothing)");
  eq(ids(await ledger(tkA, "kind=personal")), [], "17e …nor with kind=personal");
  eq((await api("GET", `/expenses/${lab.json._id}`, tkA)).status, 200, "18a Doctor A opens his own expense by id");
  eq((await api("GET", `/expenses/${mat.json._id}`, tkA)).status, 404, "18 Doctor A cannot fetch Doctor B's expense by id (404, same as an unknown id)");
  eq((await api("GET", `/expenses/${rent.json._id}`, tkA)).status, 404, "18b …nor the clinic's rent");
  eq((await api("GET", `/expenses/${fam.json._id}`, tkA)).status, 404, "18c …nor the owner's personal expense");
  eq((await api("GET", `/expenses/${"a".repeat(24)}`, tkA)).status, 404, "18d an unknown id is the same 404");
  eq((await api("GET", `/expenses/not-an-id`, tkA)).status, 404, "18e a malformed id is a 404 too");
  eq((await api("GET", `/expenses/${lab.json._id}`, tkO)).json.doctor?.name, "doctor 1", "18f the owner's detail shows the doctor and creator names");

  /* doctors cannot WRITE (owner-controlled financial mutation) */
  eq((await post(tkA, { title: "x", category: "lab", scope: "clinic", amount: 5, date: "2026-10-06", doctorId: sid(docA) })).status, 403, "W1 a doctor cannot create an expense (even for himself)");
  eq((await api("PUT", `/expenses/${lab.json._id}`, tkA, { amount: 1 })).status, 403, "W2 …nor edit his own attributed expense");
  eq((await api("DELETE", `/expenses/${lab.json._id}`, tkA)).status, 403, "W3 …nor delete it");
  eq((await api("POST", `/expenses/${pend.json._id}/pay`, tkA, {})).status, 403, "W4 …nor mark one paid");
  eq((await api("GET", "/expenses/overview", tkA)).status, 403, "W5 …nor open the owner's month overview (it holds personal expenses)");
  eq((await api("GET", "/expenses/alerts", tkA)).status, 403, "W6 …nor the bill alerts");
  eq((await api("POST", "/expenses/recurring", tkA, { title: "b", category: "rent", scope: "clinic", amount: 1, dueDay: 1 })).status, 403, "W7 …nor create a monthly bill");
  eq((await Expense.findById(lab.json._id).lean()).amount, 35, "W8 the expense is untouched after every refused write");

  /* ================= 15, 16. receptionist ================= */
  for (const [label, method, url, body] of [
    ["ledger", "GET", "/expenses/ledger"], ["summary", "GET", "/expenses/summary"], ["overview", "GET", "/expenses/overview"], ["alerts", "GET", "/expenses/alerts"],
    ["by id", "GET", `/expenses/${rent.json._id}`], ["create", "POST", "/expenses", { title: "x", category: "rent", scope: "clinic", amount: 5, date: "2026-10-06" }],
    ["update", "PUT", `/expenses/${rent.json._id}`, { amount: 1 }], ["delete", "DELETE", `/expenses/${rent.json._id}`], ["pay", "POST", `/expenses/${pend.json._id}/pay`, {}],
    ["bill", "POST", "/expenses/recurring", { title: "b", category: "rent", scope: "clinic", amount: 1, dueDay: 1 }],
  ]) eq((await api(method, url, tkR, body)).status, 403, `16 receptionist ${label} → 403`);
  eq((await Expense.countDocuments({ clinicId: A._id, deletedAt: null })), 5, "16z …and nothing changed");
  eq((await api("GET", "/expenses/ledger")).status, 401, "16y no token → 401");

  /* ================= 19–21, 25. clinic isolation ================= */
  eq((await api("GET", `/expenses/${rent.json._id}`, tkOB)).status, 404, "19 Clinic B owner cannot fetch a Clinic A expense");
  eq((await api("PUT", `/expenses/${rent.json._id}`, tkOB, { amount: 1 })).status, 404, "20 …cannot update it");
  eq((await api("DELETE", `/expenses/${rent.json._id}`, tkOB)).status, 404, "21 …cannot delete it");
  eq((await api("POST", `/expenses/${pend.json._id}/pay`, tkOB, {})).status, 404, "21b …cannot pay it");
  eq((await api("GET", `/expenses/${lab.json._id}`, tkDX)).status, 404, "19b a Clinic B doctor cannot fetch a Clinic A doctor's expense");
  eq((await Expense.findById(rent.json._id).lean()).amount, 1200, "21c Clinic A's expense is untouched");
  eq(ids(await ledger(tkOB)), [], "19c Clinic B's ledger holds none of Clinic A's expenses");
  eq((await summary(tkOB)).json.totals, { business: 0, clinic: 0, doctor: 0, personal: 0 }, "19d …and its totals are zero");
  eq(ids(await ledger(tkOB, `doctorId=${sid(docA)}`)), [], "19e a Clinic A doctor id used inside Clinic B returns nothing");
  eq((await post(tkOB, { title: "x", category: "lab", scope: "clinic", amount: 5, date: "2026-10-06", doctorId: sid(docA) })).status, 404, "25 a doctor of ANOTHER clinic is rejected");
  const own = await post(tkOB, { title: "B rent", category: "rent", scope: "clinic", amount: 100, date: "2026-10-06", clinicId: sid(A), createdBy: sid(owner) });
  eq(String((await Expense.findById(own.json._id).lean()).clinicId), sid(B), "19f a clinicId / createdBy in the body is ignored — the authenticated clinic and user win");
  eq(ids(await ledger(tkO, `clinicId=${sid(B)}`)).length, 5, "19g a clinicId in the query string is ignored");
  eq((await Expense.countDocuments({ clinicId: A._id, title: "B rent" })), 0, "19h nothing leaked into Clinic A");

  /* ================= 22–25. money & doctor validation ================= */
  const bad = (body) => post(tkO, { title: "bad", category: "rent", scope: "clinic", status: "paid", date: "2026-10-06", ...body });
  eq((await bad({ amount: -5 })).status, 400, "22 negative amount rejected");
  eq((await bad({ amount: 0 })).status, 400, "23 zero amount rejected");
  eq((await bad({ amount: "35" })).status, 400, "22b a string amount is rejected");
  eq((await bad({ amount: "abc" })).status, 400, "22c an invalid string is rejected");
  eq((await bad({})).status, 400, "22d a missing amount is rejected");
  eq((await bad({ amount: null })).status, 400, "22e a null amount is rejected");
  eq((await raw("/expenses", tkO, '{"title":"bad","category":"rent","scope":"clinic","status":"paid","date":"2026-10-06","amount":1e999}')).status, 400, "22f Infinity is rejected");
  eq((await bad({ amount: 12.3456 })).status, 400, "22g more than 3 decimals is rejected (no float drift)");
  eq((await bad({ amount: 10000001 })).status, 400, "22h above the ceiling is rejected");
  eq((await bad({ amount: 12.345 })).status, 201, "22i exactly 3 decimals (fils) is fine");
  eq((await bad({ amount: 35, category: "nonsense" })).status, 400, "22j unknown category rejected");
  eq((await bad({ amount: 35, date: "2026-02-31" })).status, 400, "22k impossible date rejected");
  eq((await bad({ amount: 35, scope: "everyone" })).status, 400, "22l unknown scope rejected");
  eq((await api("PUT", `/expenses/${rent.json._id}`, tkO, { amount: -1 })).status, 400, "22m negative on edit rejected");
  eq((await api("PUT", `/expenses/${rent.json._id}`, tkO, { amount: 0 })).status, 400, "22n zero on edit rejected");
  eq((await bad({ amount: 5, doctorId: "a".repeat(24) })).status, 404, "24 a well-formed but unknown doctor is rejected");
  eq((await bad({ amount: 5, doctorId: "xyz" })).status, 400, "24b a malformed doctor id is rejected");
  eq((await bad({ amount: 5, doctorId: sid(owner) })).status, 404, "24c the owner is not a doctor → rejected");
  eq((await bad({ amount: 5, doctorId: sid(rec) })).status, 404, "24d a receptionist is not a doctor → rejected");
  eq((await bad({ amount: 5, doctorId: sid(docOff) })).status, 404, "24e an INACTIVE doctor cannot be newly assigned");
  eq((await bad({ amount: 5, doctorId: sid(docA), scope: "personal", category: "family" })).status, 400, "24f a personal expense can never carry a doctor");
  eq((await bad({ amount: 5, doctorId: { $ne: null } })).status, 400, "24g an operator object as doctorId is rejected");
  eq((await Expense.countDocuments({ clinicId: A._id, title: "bad", amount: { $ne: 12.345 } })), 0, "24h none of the rejected requests wrote anything");
  eq((await api("POST", "/expenses", tkO, { title: "<script>", category: "rent", scope: "clinic", amount: 1, date: "2026-10-06", ...{ vendor: "x".repeat(101) } })).status, 400, "24i over-long vendor rejected");

  /* ================= 26–29. dates and edit audit ================= */
  const g = (await api("GET", `/expenses/${rent.json._id}`, tkO)).json;
  eq([g.date, g.period], ["2026-09-28", "2026-09"], "26 expenseDate persists exactly (Sept 28), period derived from it");
  const created = await Expense.findById(rent.json._id).lean();
  ok(new Date(created.createdAt).getTime() > new Date("2026-10-01").getTime() && created.date.toISOString() === "2026-09-28T09:00:00.000Z", "27 createdAt (when it was typed) is different from the expense date (when it happened)");
  eq(ids(await ledger(tkO, "from=2026-09-28&to=2026-09-28")), ["Rent October"], "27b the expense counts on Sept 28, not on the day it was entered");
  const before = await Expense.findById(rent.json._id).lean();
  await new Promise((r) => setTimeout(r, 30));
  const ed = await api("PUT", `/expenses/${rent.json._id}`, tkO, { amount: 1250, notes: "raised", createdBy: sid(docA), createdAt: "2000-01-01T00:00:00Z", clinicId: sid(B), updatedBy: sid(docA) });
  eq(ed.status, 200, "28a owner edits legitimate fields");
  const after = await Expense.findById(rent.json._id).lean();
  eq(String(after.createdBy), String(before.createdBy), "28 editing preserves createdBy (a body createdBy is ignored)");
  eq(new Date(after.createdAt).toISOString(), new Date(before.createdAt).toISOString(), "29 editing preserves createdAt");
  eq(String(after.clinicId), sid(A), "29b …and clinicId");
  ok(after.amount === 1250 && new Date(after.updatedAt) > new Date(before.updatedAt) && String(after.updatedBy) === sid(owner), "29c updatedAt moves and updatedBy = the editing owner");
  eq(ids(await ledger(tkO, "from=2026-09-28&to=2026-09-28")), ["Rent October"], "29d a later edit does not move the expense in time");
  await api("PUT", `/expenses/${rent.json._id}`, tkO, { amount: 1200 });

  /* attribution edits */
  eq((await api("PUT", `/expenses/${lab.json._id}`, tkO, { doctorId: sid(docB) })).status, 200, "E1 owner re-attributes an expense to another doctor");
  eq(ids(await ledger(tkB)).sort(), ["Composite kit", "Crown laboratory work"], "E1b it now belongs to Doctor B's view");
  eq(ids(await ledger(tkA)), [], "E1c …and left Doctor A's view");
  eq((await api("PUT", `/expenses/${lab.json._id}`, tkO, { doctorId: sid(docA) })).status, 200, "E2 and back");
  eq((await api("PUT", `/expenses/${lab.json._id}`, tkO, { scope: "personal", category: "family" })).status, 200, "E3 moving it to personal…");
  ok(!(await Expense.findById(lab.json._id).lean()).doctorId, "E3b …clears the doctor (personal money can't be a doctor's)");
  eq(ids(await ledger(tkA)), [], "E3c …and it disappears from the doctor's view");
  eq((await api("PUT", `/expenses/${lab.json._id}`, tkO, { scope: "clinic", category: "lab", doctorId: sid(docA) })).status, 200, "E4 restore (clinic, lab, Dr A)");
  eq((await api("PUT", `/expenses/${lab.json._id}`, tkO, { doctorId: null })).status, 200, "E5 owner clears the attribution → shared clinic expense");
  ok(!(await Expense.findById(lab.json._id).lean()).doctorId, "E5b stored without a doctor");
  eq((await api("PUT", `/expenses/${lab.json._id}`, tkO, { doctorId: sid(docA) })).status, 200, "E6 re-assign");
  eq((await api("PUT", `/expenses/${lab.json._id}`, tkO, { doctorId: sid(docX) })).status, 404, "E7 a doctor of another clinic cannot be assigned on edit");
  eq((await api("PUT", `/expenses/${lab.json._id}`, tkO, { doctorId: sid(docOff) })).status, 404, "E8 an inactive doctor cannot be newly assigned on edit");
  await User.updateOne({ _id: docA._id }, { isActive: false });
  eq((await api("PUT", `/expenses/${lab.json._id}`, tkO, { notes: "doctor left the clinic" })).status, 200, "E9 an expense of a doctor who has since been deactivated stays editable (history is not blocked)");
  await User.updateOne({ _id: docA._id }, { isActive: true });

  /* ================= 30. delete = archive, and totals ================= */
  const del = await post(tkO, { title: "To delete", category: "supplies", scope: "clinic", amount: 40, status: "paid", date: "2026-10-04", doctorId: sid(docA) });
  const t0 = (await summary(tkO)).json.totals;
  const tA0 = (await summary(tkA)).json.totals.business;
  eq((await api("DELETE", `/expenses/${del.json._id}`, tkO)).status, 200, "30 owner deletes (archives) an expense");
  const t1 = (await summary(tkO)).json.totals;
  eq([+(t0.business - t1.business).toFixed(3), +(t0.doctor - t1.doctor).toFixed(3)], [40, 40], "30b the owner's totals drop by exactly its amount");
  eq(+(tA0 - (await summary(tkA)).json.totals.business).toFixed(3), 40, "30c …and so do the doctor's");
  ok(!ids(await ledger(tkO)).includes("To delete") && !ids(await ledger(tkA)).includes("To delete"), "30d it is gone from every list");
  eq((await api("GET", `/expenses/${del.json._id}`, tkO)).status, 404, "30e …and from the detail endpoint");
  const kept = await Expense.findById(del.json._id).lean();
  ok(kept && kept.deletedAt && String(kept.deletedBy) === sid(owner) && kept.amount === 40, "30f the record is KEPT in the database with deletedAt / deletedBy (audit-safe)");
  eq((await api("DELETE", `/expenses/${del.json._id}`, tkO)).status, 404, "30g a second delete is a 404");
  eq((await api("PUT", `/expenses/${del.json._id}`, tkO, { amount: 41 })).status, 404, "30h a deleted expense cannot be edited");
  eq((await api("POST", `/expenses/${del.json._id}/pay`, tkO, {})).status, 404, "30i …nor paid");
  const pendDel = await post(tkO, { title: "Pending to delete", category: "equipment", scope: "clinic", amount: 10, status: "pending", date: ymd(0) });
  const al0 = (await api("GET", "/expenses/alerts", tkO)).json.count;
  await api("DELETE", `/expenses/${pendDel.json._id}`, tkO);
  ok((await api("GET", "/expenses/alerts", tkO)).json.count === al0 - 1, "30j a deleted pending bill stops showing in the alerts / reminders");
  function ymd(offset) { const d = new Date(Date.now() + 3 * 3600e3 + offset * 864e5); return d.toISOString().slice(0, 10); }

  /* ================= 31–33. persistence & pagination ================= */
  eq(ids(await ledger(tkO)).sort(), ids(await ledger(tkO)).sort(), "31 refresh returns the same data");
  const tkO2 = t.tok(owner); eq((await ledger(tkO2)).json.total, (await ledger(tkO)).json.total, "32 a fresh login token sees the same data");
  for (let i = 1; i <= 30; i++) await post(tkO, { title: `Bulk ${String(i).padStart(2, "0")}`, category: "supplies", scope: "clinic", amount: 1 + i, status: "paid", date: `2026-08-${String((i % 28) + 1).padStart(2, "0")}` });
  const p1 = (await ledger(tkO, "category=supplies&from=2026-08-01&to=2026-08-31&limit=10&page=1")).json, p2 = (await ledger(tkO, "category=supplies&from=2026-08-01&to=2026-08-31&limit=10&page=2")).json, p4 = (await ledger(tkO, "category=supplies&from=2026-08-01&to=2026-08-31&limit=10&page=4")).json;
  eq([p1.items.length, p2.items.length, p1.total, p1.pages, p4.items.length], [10, 10, 30, 3, 0], "33 pagination: sizes, total, pages, empty page beyond the end");
  eq(new Set([...p1.items, ...p2.items].map((x) => x._id)).size, 20, "33b pages do not overlap");
  const sorted = [...p1.items, ...p2.items].map((x) => x.date); eq(sorted, [...sorted].sort().reverse(), "33c newest expense date first");
  eq((await ledger(tkO, "limit=100000")).json.limit, 100, "33d the page size is capped (never unlimited history in the browser)");
  eq((await ledger(tkO, "limit=abc&page=-3")).json.limit, 25, "33e garbage paging falls back to defaults");

  /* ================= malicious requests ================= */
  eq((await api("GET", "/expenses/ledger?doctorId[$ne]=x", tkO)).status, 400, "M1 operator injection in doctorId → 400");
  eq((await api("GET", "/expenses/ledger?search[$ne]=x", tkO)).status, 400, "M2 operator injection in search → 400");
  eq((await api("GET", "/expenses/ledger?category[$ne]=x", tkO)).status, 400, "M3 operator injection in category → 400");
  eq((await api("GET", "/expenses/ledger?from=garbage", tkO)).status, 400, "M4 invalid date → 400");
  eq((await api("GET", "/expenses/ledger?from=2026-10-10&to=2026-10-01", tkO)).status, 400, "M5 inverted range → 400");
  eq((await api("GET", "/expenses/ledger?kind=everything", tkO)).status, 400, "M6 invalid kind → 400");
  ok([400, 403].includes((await api("GET", "/expenses/ledger?doctorId[$ne]=x", tkA)).status), "M7 …also for a doctor (refused: 400 or 403, never data)");
  ok([400, 403].includes((await api("GET", `/expenses/ledger?doctorId=${sid(docB)}&doctorId=${sid(docA)}`, tkA)).status), "M8 a repeated doctorId parameter is refused, not half-honoured");
  eq((await api("PUT", `/expenses/${lab.json._id}`, tkA, { doctorId: sid(docA), amount: 1 })).status, 403, "M9 PUT as a doctor");
  eq((await api("PATCH", `/expenses/${lab.json._id}`, tkO, { amount: 1 })).status, 404, "M10 there is no PATCH route to bypass the rules");
  eq((await api("DELETE", `/expenses/${mat.json._id}`, tkB)).status, 403, "M11 DELETE as the doctor it belongs to");
  eq((await api("DELETE", `/expenses/${mat.json._id}`, tkRB)).status, 403, "M12 DELETE as another clinic's receptionist");

  /* ================= monthly bills: doctor attribution, soft-delete, no duplicates ================= */
  const bill = await api("POST", "/expenses/recurring", tkO, { title: "Dr A software", category: "software", scope: "clinic", amount: 25, dueDay: 5, doctorId: sid(docA), vendor: "SaaS Co", startPeriod: "2026-10" });
  eq(bill.status, 201, "R1 a monthly bill can carry a doctor");
  eq((await api("POST", "/expenses/recurring", tkO, { title: "x", category: "rent", scope: "personal", amount: 5, dueDay: 5, doctorId: sid(docA) })).status, 400, "R1b …but not a personal one");
  const pay1 = await api("POST", `/expenses/recurring/${bill.json._id}/pay`, tkO, { period: "2026-10", date: "2026-10-06" });
  eq(pay1.status, 201, "R2 mark as paid");
  ok(String((await Expense.findById(pay1.json._id).lean()).doctorId) === sid(docA), "R2b the payment line inherits the bill's doctor");
  ok(ids(await ledger(tkA)).includes("Dr A software"), "R2c Doctor A sees it (read-only)");
  eq((await api("POST", `/expenses/recurring/${bill.json._id}/pay`, tkO, { period: "2026-10", date: "2026-10-06" })).status, 409, "R3 paying the same month twice is refused (no duplicates)");
  eq((await api("DELETE", `/expenses/recurring/${bill.json._id}/pay/2026-10`, tkO)).status, 200, "R4 undo the payment");
  ok(!ids(await ledger(tkA)).includes("Dr A software") && (await Expense.findById(pay1.json._id).lean()).deletedAt, "R4b archived (kept for audit), gone from the doctor's view");
  const pay2 = await api("POST", `/expenses/recurring/${bill.json._id}/pay`, tkO, { period: "2026-10", date: "2026-10-07" });
  eq(pay2.status, 201, "R5 the month can be paid again after an undo");
  eq((await Expense.countDocuments({ clinicId: A._id, title: "Dr A software", deletedAt: null })), 1, "R5b exactly one live payment for that month");
  eq((await api("PUT", `/expenses/recurring/${bill.json._id}`, tkO, { amount: 0 })).status, 400, "R6 a zero-amount bill is rejected");
  eq((await api("POST", `/expenses/recurring/${bill.json._id}/pay`, tkO, { period: "2026-11", amount: -3 })).status, 400, "R7 a negative payment is rejected");

  /* ================= legacy documents (pre-Phase-5 shape) ================= */
  const legacy = await Expense.collection.insertOne({ clinicId: A._id, title: "Legacy electricity", category: "utilities", scope: "clinic", amount: 77, status: "paid", date: new Date("2026-07-15T09:00:00Z"), period: "2026-07", createdBy: owner._id, createdAt: new Date("2026-07-16"), updatedAt: new Date("2026-07-16") });
  const lg = await ledger(tkO, "from=2026-07-01&to=2026-07-31");
  eq([ids(lg), lg.json.items[0]?.kind, lg.json.items[0]?.doctor], [["Legacy electricity"], "clinic", null], "L1 a legacy expense (no doctor / no deletedAt) is a shared clinic expense — never guessed onto a doctor");
  eq(ids(await ledger(tkA, "from=2026-07-01&to=2026-07-31")), [], "L2 …and not visible to a doctor");
  eq((await summary(tkO, "from=2026-07-01&to=2026-07-31")).json.totals, { business: 77, clinic: 77, doctor: 0, personal: 0 }, "L3 it counts in the clinic's business totals");
  eq((await api("PUT", `/expenses/${legacy.insertedId}`, tkO, { doctorId: sid(docB) })).status, 200, "L4 the owner can attribute a legacy expense explicitly");
  eq((await api("GET", "/expenses/overview?period=2026-07", tkO)).status, 200, "L5 the existing month overview still works on legacy data");
  await api("PUT", `/expenses/${legacy.insertedId}`, tkO, { doctorId: null });

  /* ================= consistency with the existing overview (one set of numbers) ================= */
  const ov = (await api("GET", "/expenses/overview?period=2026-10", tkO)).json;
  const sm = (await summary(tkO, "from=2026-10-01&to=2026-10-31")).json.totals;
  eq([ov.totals.clinic, ov.totals.personal], [+(sm.clinic + sm.doctor).toFixed(3), sm.personal], "C1 the Expenses month overview and the summary service agree (business = clinic + doctors, personal apart)");
  eq(ov.entries.find((e) => e.title === "Crown laboratory work")?.doctorName, "doctor 1", "C2 the month overview rows carry the doctor's name");

  /* ================= earlier-phase behaviour still there (full suites are re-run separately) ================= */
  eq((await api("GET", "/invoices", tkR)).status, 200, "P1 the receptionist's invoice workflow is untouched");
  eq((await api("GET", "/invoices", tkA)).status, 200, "P2 a doctor still lists his own invoices");
  eq((await api("GET", "/reports/monthly", tkR)).status, 403, "P3 Phase 4: reports stay closed to the receptionist");
  eq((await api("GET", "/dashboard/stats", tkA)).status, 200, "P4 the dashboard still works for a doctor");
  const dash = (await api("GET", "/dashboard/stats", tkA)).json;
  ok(!JSON.stringify(dash).includes("expense"), "P5 no expense figure leaks into the doctor's dashboard");
  ok(!JSON.stringify((await api("GET", "/dashboard/stats", tkO)).json).includes("expense"), "P6 …nor was the dashboard redesigned for the owner (Phase 6)");

  t.noLeaks("Z1 no response of this suite leaked a stack / path / Mongo internals");
  await t.finish("PHASE 5 — expenses & financial architecture");
})().catch((e) => { console.error("SUITE CRASHED", e); process.exit(2); });
