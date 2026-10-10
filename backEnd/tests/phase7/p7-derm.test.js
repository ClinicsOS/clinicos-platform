/* PHASE 7 — Dermatology & Aesthetics smoke through the real server: assessment → plan item → visit session → complete → invoice → payment →
 * follow-up → dashboard / report / analytics, plus idempotency, role and cross-clinic checks. A regression guard for the final integrated build.
 *   node tests/phase7/p7-derm.test.js */
const { boot7, wh } = require("./p7lib");

(async () => {
  const t = await boot7({ name: "p7_derm", port: 5310 });
  const { Invoice, Appointment } = t.m;
  const api = t.api;
  const sid = (d) => String(d._id);
  const today = t.tz.clinicYmdOf(new Date());
  const C = await t.mkClinic("p7dm", { specialty: "dermatology_aesthetics", plan: "pro", workingHours: wh(), slotDuration: 30 });
  const O = await t.mkClinic("p7dmo", { specialty: "dermatology_aesthetics", plan: "pro", workingHours: wh(), slotDuration: 30 });
  const owner = await t.mkUser(C, "owner"), doc = await t.mkUser(C, "doctor", 1), doc2 = await t.mkUser(C, "doctor", 2), rec = await t.mkUser(C, "receptionist");
  const oOther = await t.mkUser(O, "owner");
  const TK = { o: t.tok(owner), d: t.tok(doc), d2: t.tok(doc2), r: t.tok(rec), x: t.tok(oOther) };
  const pat = await t.mkPatient(C, "Derm Smoke Patient", "0797100001");
  const P = sid(pat);
  const rid = (n) => `p7dm${n}${Date.now().toString(36)}`.slice(0, 40);

  const walk = await api("POST", "/appointments", TK.r, { source: "walk_in", patientId: P, doctorId: sid(doc) });
  t.eq(walk.status, 201, "D1 a walk-in visit exists for Doctor 1");
  const APPT = walk.json._id;

  // assessment
  const body = { clientRequestId: rid(1), recordType: "dermatology", regions: [{ id: "forehead" }], concern: "Acne", findings: "Papules", diagnosis: "Acne vulgaris", notes: "n" };
  const a1 = await api("POST", `/derm/patients/${P}/assessments`, TK.d, body);
  t.eq(a1.status, 201, "D2 a doctor records an assessment", a1.json);
  const a1b = await api("POST", `/derm/patients/${P}/assessments`, TK.d, body);
  t.ok(a1b.status === 200 && (a1b.json.duplicate === true || (a1b.json.assessment && a1b.json.assessment._id === (a1.json.assessment || a1.json)._id)), "D2b the same clientRequestId again → the SAME assessment (no duplicate)", a1b.json);
  t.eq((await api("POST", `/derm/patients/${P}/assessments`, TK.r, { ...body, clientRequestId: rid(2) })).status, 403, "D3 a receptionist cannot write clinical data (403)");
  t.eq((await api("POST", `/derm/patients/${P}/assessments`, TK.d, { ...body, clientRequestId: rid(3), regions: [{ id: "left_eyebrow_nonexistent" }] })).status, 400, "D3b an unknown anatomical region is refused (400)");
  t.eq((await api("POST", `/derm/patients/${P}/assessments`, TK.d, { ...body, clientRequestId: rid(4), regions: [{ id: "forehead", surface: "lateral" }] })).status, 400, "D3c a surface that region does not allow is refused (400)");
  const map = await api("GET", `/derm/patients/${P}/map`, TK.r);
  t.clean(map, "D4 the receptionist can READ the map (shared patient record)");

  // plan item
  const it = await api("POST", `/derm/patients/${P}/treatment-plan/items`, TK.d, { clientRequestId: rid(5), recordType: "dermatology", procedureCode: "cryotherapy", targetType: "single_region", regions: [{ id: "forehead" }], estimatedPrice: 50, priority: "normal" });
  t.eq(it.status, 201, "D5 a treatment item is added to the plan", it.json);
  const ITEM = (it.json.item || it.json)._id;
  const itBad = await api("POST", `/derm/patients/${P}/treatment-plan/items`, TK.d, { clientRequestId: rid(6), recordType: "aesthetic", procedureCode: "cryotherapy", targetType: "single_region", regions: [{ id: "forehead" }] });
  t.eq(itBad.status, 400, "D5b a dermatology procedure under the 'aesthetic' type is refused (400)");
  t.eq((await api("POST", `/derm/patients/${P}/treatment-plan/items`, TK.d, { clientRequestId: rid(7), recordType: "dermatology", procedureCode: "cryotherapy", targetType: "single_region", regions: [{ id: "forehead" }], estimatedPrice: -5 })).status, 400, "D5c a negative estimate is refused");

  // visit session
  const st = await api("POST", `/derm/patients/${P}/treatment-plan/items/${ITEM}/start`, TK.d, { appointmentId: APPT });
  t.ok([200, 201].includes(st.status), "D6 the item is started on the visit", st.json);
  const st2 = await api("POST", `/derm/patients/${P}/treatment-plan/items/${ITEM}/start`, TK.d, { appointmentId: APPT });
  t.ok([200, 201].includes(st2.status), "D6b a double click on Start is harmless (still one session)");
  const sess = await t.m.Patient.db.collection("dermtreatmentsessions").countDocuments({ clinicId: C._id, patientId: pat._id });
  t.eq(sess, 1, "D6c exactly ONE session row exists");
  const end = await api("POST", `/derm/patients/${P}/treatment-plan/items/${ITEM}/complete`, TK.d, { appointmentId: APPT, procedureNotes: "done", device: undefined });
  t.ok([200, 201].includes(end.status), "D7 the item is completed", end.json);

  // invoice the treatment
  const inv = await api("POST", `/derm/patients/${P}/treatment-plan/items/${ITEM}/invoice`, TK.d, { price: 50, description: "Cryotherapy forehead" });
  t.ok([200, 201].includes(inv.status), "D8 the completed treatment is added to an invoice", inv.json);
  const inv2 = await api("POST", `/derm/patients/${P}/treatment-plan/items/${ITEM}/invoice`, TK.d, { price: 50, description: "Cryotherapy forehead" });
  t.ok(inv2.status === 409 || inv2.status === 200, "D8b billing it again is refused / returns the same invoice (never a 2nd line)", inv2.status);
  const invs = await Invoice.find({ clinicId: C._id }).lean();
  t.eq([invs.length, invs[0] && invs[0].items.length, invs[0] && invs[0].total, invs[0] && String(invs[0].doctorId)], [1, 1, 50, sid(doc)], "D8c exactly one invoice, one line, total 50, attributed to the TREATING doctor (not the creator)");
  const INV = invs[0] && String(invs[0]._id);
  t.eq((await api("POST", `/invoices/${INV}/payments`, TK.r, { amount: 20 })).status, 200, "D9 the receptionist takes 20");
  t.eq((await api("POST", `/invoices/${INV}/payments`, TK.d2, { amount: 5 })).status, 404, "D9b Doctor 2 cannot touch Doctor 1's invoice (404)");
  t.eq((await Invoice.findById(INV).lean()).status, "partially_paid", "D9c status partially_paid");

  // follow-up
  const fu = await api("POST", `/derm/patients/${P}/follow-ups`, TK.d, { clientRequestId: rid(8), itemId: ITEM, outcome: "improved", clinicianAssessment: "good", progress: "better" });
  t.eq(fu.status, 201, "D10 a follow-up is recorded", fu.json);
  t.eq((await api("POST", `/derm/patients/${P}/follow-ups`, TK.d, { clientRequestId: rid(9), outcome: "teleported" })).status, 400, "D10b an unknown outcome is refused");

  // reads
  for (const [what, p] of [["dashboard", "/derm/dashboard"], ["overview", `/derm/patients/${P}/overview`], ["timeline", `/derm/patients/${P}/timeline`], ["plan", `/derm/patients/${P}/treatment-plan`], ["follow-ups", `/derm/patients/${P}/follow-ups`], ["assessments", `/derm/patients/${P}/assessments`], ["report", `/derm/patients/${P}/report`], ["clinical timeline", `/patients/${P}/clinical-timeline`]]) {
    t.clean(await api("GET", p, TK.o), `D11 owner: ${what} loads cleanly`);
  }
  const an = await api("GET", "/analytics/treatments?preset=today&compare=0", TK.o);
  t.clean(an, "D12 Reports → Treatments (derm kind) loads cleanly");
  t.eq(an.json.kind || an.json.treatmentKind, "derm", "D12b …and is the dermatology variant");
  t.money((await api("GET", "/analytics/financial?preset=today&compare=0", TK.o)).json.kpis.collected.current, 20, "D13 Reports: collected 20");
  t.money((await api("GET", "/analytics/financial?preset=today&compare=0", TK.d2)).json.kpis.collected.current, 0, "D13b Doctor 2's own Reports: 0 (Doctor 1's money is not theirs)");
  t.eq((await api("GET", `/derm/patients/${P}/map`, TK.x)).status, 404, "D14 another dermatology clinic cannot open this patient's map (404)");
  t.eq((await api("GET", `/dental/patients/${P}/record`, TK.o)).status === 403 || (await api("GET", `/dental/patients/${P}/record`, TK.o)).status === 404, true, "D15 the dental module is not reachable from a dermatology clinic");
  t.noLeaks("no dermatology response leaked internals");
  await t.finish("PHASE 7 — dermatology smoke");
})().catch((e) => { console.error(e); process.exit(1); });
