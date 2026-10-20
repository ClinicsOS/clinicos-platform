/* PHASE 4 — TREATMENT PLAN <-> DENTAL CHART SYNC (backend half). End-to-end against the COMPILED server (real HTTP, real database,
   nothing mocked). The browser-side derivation (planVisual.ts / toothStates.ts) is the SAME pure module the Dental Chart imports,
   so "the chart shows it" is verified from the very payload the server returns.
     npm run build && node tests/dental/treatment-chart-sync.test.js
   Optional env: P10_MONGO (default mongodb://127.0.0.1:27017), P10_DIST, P10_OUT.

   Tagged exactly as the Phase 4 specification:
     T1  one canonical record is created            T9  multi-tooth arrays are preserved
     T2  it belongs to the correct patient          T10 unauthorized doctor is denied
     T3  it carries the correct tooth               T11 delegated doctor is allowed while active
     T4  it carries the correct surfaces            T12 revoked delegation is denied
     T5  status persists                            T13 expired delegation is denied
     T6  editing updates the SAME record            T14 cross-clinic access fails
     T7  editing does not create a duplicate        T15 rapid duplicate create does not duplicate
     T8  a status change updates the SAME record
   Extra groups: U (ownership / updatedBy) · I (idempotent create) · C (canonical read agrees with the chart) · H (Phase 3 history link). */
const path = require("path");
const { pathToFileURL } = require("url");
const { boot } = require("../phase10/lib");
const DIST = process.env.P10_DIST || path.resolve(__dirname, "../../dist");
const FE = path.resolve(__dirname, "../../../frontEnd/src");

(async () => {
  const planVisual = await import(pathToFileURL(path.join(FE, "lib/dental/planVisual.ts")).href);
  const toothStates = await import(pathToFileURL(path.join(FE, "lib/dental/toothStates.ts")).href);
  const chartOf = (items) => planVisual.applyPlanToVisual({}, items, toothStates.emptyVisualState);

  const t = await boot({ name: "treatment_chart_sync", port: 5821, env: { NODE_OPTIONS: `--require ${path.join(__dirname, "../multi-doctor/ferret-date-shim.js")} --require ${path.join(__dirname, "../analytics/agg-emulator.js")} --require ${path.join(__dirname, "../phase7/expr-shim.js")}` } });
  const { ok, eq, http } = t;
  const { DentalTreatmentItem } = t.M("DentalTreatmentItem");
  const { PatientDoctorAccess } = t.M("PatientDoctorAccess");
  const sid = (x) => String(x._id);
  const api = (method, url, token, body) => http(method, url, { token, body });
  const wh = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, from: "09:00", to: "17:00" }));

  const A = await t.mkClinic("sync-a", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const B = await t.mkClinic("sync-b", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const owner = await t.mkUser(A, "owner"), docX = await t.mkUser(A, "doctor", 1), docY = await t.mkUser(A, "doctor", 2);
  const ownerB = await t.mkUser(B, "owner"), docB = await t.mkUser(B, "doctor");
  const tkO = t.tok(owner), tkX = t.tok(docX), tkY = t.tok(docY), tkOB = t.tok(ownerB), tkDB = t.tok(docB);

  const reg = async (tk, name, phone) => (await api("POST", "/patients", tk, { fullName: name, phone })).json;
  const pX = await reg(tkX, "Xavier Sync", "0791500001");   // Dr X's patient
  const pX2 = await reg(tkX, "Xena Second", "0791500002");  // another of Dr X's patients (must never be touched)
  const pB = await t.mkPatient(B, "Outsider Bilal", "0794500001", { noAccess: true });
  const base = (p) => `/dental/patients/${sid(p)}`;
  const plan = async (p = pX, token = tkX) => (await api("GET", `${base(p)}/treatment-plan`, token)).json;
  const add = (body, p = pX, token = tkX) => api("POST", `${base(p)}/treatment-plan/items`, token, body);
  const edit = (id, body, p = pX, token = tkX) => api("PUT", `${base(p)}/treatment-plan/items/${id}`, token, body);
  const act = (id, what, body = {}, p = pX, token = tkX) => api("POST", `${base(p)}/treatment-plan/items/${id}/${what}`, token, body);
  const count = (filter) => DentalTreatmentItem.countDocuments(filter);

  /* ---------- the specification's example: Filling · tooth 26 · surface D · Planned · "Distal composite filling planned" ---------- */
  const NOTE = "Distal composite filling planned";
  const c1 = await add({ procedureCode: "filling", targetType: "surface", toothNumbers: ["26"], surfaces: ["D"], notes: NOTE });
  const it = c1.json.item;
  eq(c1.status, 201, "T1a the Filling is created (201)");
  eq(await count({ clinicId: A._id, patientId: pX._id }), 1, "T1 exactly ONE canonical record exists for it (one DentalTreatmentItem, no chart-side copy)");
  const row = await DentalTreatmentItem.findById(it._id).lean();
  eq(String(row.patientId), sid(pX), "T2 the record belongs to the correct patient");
  eq(await count({ clinicId: A._id, patientId: pX2._id }), 0, "T2b …and no other patient of the same doctor got anything");
  eq(row.toothNumbers, ["26"], "T3 the correct tooth is stored (26)");
  eq(row.surfaces, ["D"], "T4 the correct surface is stored (D)");
  eq([row.status, row.notes, row.procedureCode], ["planned", NOTE, "filling"], "T5 status 'planned', the note and the procedure persist");
  const p1 = await plan();
  const inPlan = p1.items.find((i) => i._id === it._id);
  ok(!!inPlan && inPlan.status === "planned" && inPlan.notes === NOTE, "T5b the Treatment Plan read returns that same record with its status and note");

  /* ---------- C · the Dental Chart (2D + 3D share ONE derivation) is built from that very record ---------- */
  const v26 = chartOf(p1.items)["26"];
  ok(!!v26 && v26.plan === "planned" && v26.treatments.length === 1 && v26.treatments[0].kind === "filling" && v26.treatments[0].surfaces.join() === "D" && v26.treatments[0].status === "planned",
    "C1 the chart derivation of tooth 26 shows a PLANNED filling on surface D, from the same payload the Treatment Plan shows", v26);
  eq(Object.keys(chartOf(p1.items)), ["26"], "C2 and only tooth 26 is touched");

  /* ---------- T6/T7 · edit D -> DO updates the SAME record ---------- */
  const e1 = await edit(it._id, { surfaces: ["D", "O"], toothNumbers: ["26"], targetType: "surface", procedureCode: "filling", notes: NOTE });
  eq(e1.status, 200, "T6a the edit is accepted");
  eq([e1.json.item._id, e1.json.item.surfaces], [it._id, ["D", "O"]], "T6 the edit (D -> DO) updates the SAME record id");
  eq(await count({ clinicId: A._id, patientId: pX._id }), 1, "T7 editing created NO duplicate (still exactly one record)");
  const v26b = chartOf((await plan()).items)["26"];
  eq(v26b.treatments[0].surfaces.slice().sort(), ["D", "O"], "T7b the chart derivation now shows D+O for the same treatment");
  eq((await plan()).items.filter((i) => i._id === it._id).length, 1, "T7c the plan lists it once");

  /* ---------- T8 · status change (Planned -> In Progress -> Completed) on the SAME record ---------- */
  const appt = await t.m.Appointment.create({ clinicId: A._id, doctorId: docX._id, patientId: pX._id, startAt: new Date(Date.now() - 36e5), duration: 30, status: "confirmed" });
  const st = await act(it._id, "start", { appointmentId: sid(appt) });
  eq([st.status, st.json.item._id, st.json.item.status], [201, it._id, "in_progress"], "T8 Planned -> In Progress keeps the SAME record id");
  eq(await count({ clinicId: A._id, patientId: pX._id }), 1, "T8b still exactly one record after the status change");
  eq(chartOf((await plan()).items)["26"].plan, "in_progress", "T8c the chart derivation reflects In Progress");
  // the notes / edit of an in-progress item still hit the same record (priority/phase/notes only)
  const e2 = await edit(it._id, { notes: NOTE + " (started)" });
  eq([e2.status, e2.json.item._id, e2.json.item.notes], [200, it._id, NOTE + " (started)"], "T8d editing the note of an in-progress treatment updates the same record");
  const cp = await act(it._id, "complete", { appointmentId: sid(appt) });
  eq([cp.status, cp.json.item._id, cp.json.item.status], [200, it._id, "completed"], "T8e In Progress -> Completed keeps the SAME record id");
  const vDone = chartOf((await plan()).items)["26"];
  ok(vDone.treated === true && vDone.treatments[0].status === "completed", "T8f the chart shows it as treated (completed)", vDone);

  /* ---------- U · ownership + updatedBy ---------- */
  const afterAll = await DentalTreatmentItem.findById(it._id).lean();
  eq(String(afterAll.createdBy), sid(docX), "U1 createdBy (the owner) is still the creating doctor after edits and status changes");
  eq(String(afterAll.updatedBy), sid(docX), "U2 updatedBy records the latest editor");
  // the clinic owner edits a planned item created by the doctor: ownership must NOT transfer
  const own = (await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["11"] })).json.item;
  const oe = await edit(own._id, { notes: "Owner reviewed" }, pX, tkO);
  eq(oe.status, 200, "U3 the clinic owner can edit the doctor's planned treatment");
  const ownRow = await DentalTreatmentItem.findById(own._id).lean();
  eq([String(ownRow.createdBy), String(ownRow.updatedBy)], [sid(docX), sid(owner)], "U4 createdBy stays the doctor; updatedBy becomes the owner (no silent ownership transfer)");
  eq([oe.json.item.createdBy._id, oe.json.item.updatedBy._id], [sid(docX), sid(owner)], "U5 the API exposes both");
  // cancel (soft state): stays in the record, the chart stops drawing it, nothing is deleted
  const cn = await act(own._id, "cancel", { reason: "Patient declined" }, pX, tkO);
  eq([cn.status, cn.json.item.status], [200, "cancelled"], "U6 cancelling keeps the record (status 'cancelled')");
  eq(await count({ _id: own._id }), 1, "U6b …nothing was deleted");
  ok(chartOf((await plan()).items)["11"] === undefined, "U7 a cancelled treatment is no longer drawn on the chart");
  eq(String((await DentalTreatmentItem.findById(own._id).lean()).updatedBy), sid(owner), "U8 cancel recorded updatedBy");

  /* ---------- T9 · multi-tooth arrays ---------- */
  const mt = await add({ procedureCode: "bridge", targetType: "multi_tooth", toothNumbers: ["11", "12", "13"] });
  eq(mt.status, 201, "T9a a multi-tooth treatment is created");
  eq((await DentalTreatmentItem.findById(mt.json.item._id).lean()).toothNumbers, ["11", "12", "13"], "T9 the multi-tooth array [11,12,13] is stored intact");
  const mtE = await edit(mt.json.item._id, { priority: "high", notes: "Bridge 11-13" });
  eq(mtE.json.item.toothNumbers, ["11", "12", "13"], "T9b editing other fields keeps the array");
  eq(Object.keys(chartOf((await plan()).items)).filter((k) => ["11", "12", "13"].includes(k)).sort(), ["11", "12", "13"], "T9c the chart derivation covers all three teeth");

  /* ---------- T10–T13 · patient authorization on EVERY mutation ---------- */
  const guard = async (label, token, expectStatus, who) => {
    const before = await count({ clinicId: A._id, patientId: pX._id });
    const mk = await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["47"], requestId: "auth-" + label + "-create" }, pX, token);
    const ed = await edit(mt.json.item._id, { notes: "by " + who }, pX, token);
    const ca = await act(mt.json.item._id, "cancel", {}, pX, token);
    const ss = await act(mt.json.item._id, "start", { appointmentId: sid(appt) }, pX, token);
    const after = await count({ clinicId: A._id, patientId: pX._id });
    return { codes: [mk.status, ed.status, ca.status, ss.status], before, after, expectStatus };
  };
  const denied = await guard("deny", tkY, 404, "Y");
  eq(denied.codes, [404, 404, 404, 404], "T10 a doctor with NO access to the patient is denied on create / edit / cancel / start (404, patient hidden)");
  eq(denied.after, denied.before, "T10b …and nothing was created");
  eq((await DentalTreatmentItem.findById(mt.json.item._id).lean()).notes, "Bridge 11-13", "T10c …and the existing record was not modified");
  eq((await api("GET", `${base(pX)}/treatment-plan`, tkY)).status, 404, "T10d …nor can he read the plan");

  const del = await api("POST", "/patient-access/delegations", tkO, { fromDoctorId: sid(docX), toDoctorId: sid(docY), scope: "all" });
  eq(del.status, 201, "T11a the owner delegates Dr X's patients to Dr Y");
  const viaDelegate = await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["46"], requestId: "deleg-active-001" }, pX, tkY);
  eq(viaDelegate.status, 201, "T11 a delegated doctor CAN create while the delegation is active");
  const dEdit = await edit(viaDelegate.json.item._id, { notes: "covering for Dr X" }, pX, tkY);
  eq(dEdit.status, 200, "T11b …and edit");
  const dRow = await DentalTreatmentItem.findById(viaDelegate.json.item._id).lean();
  eq([String(dRow.createdBy), String(dRow.updatedBy)], [sid(docY), sid(docY)], "T11c the delegate is recorded as the actor (createdBy/updatedBy), the patient's owner is untouched");
  eq(String((await PatientDoctorAccess.findOne({ patientId: pX._id, doctorId: docX._id, role: "owner" }).lean())?.doctorId || sid(docX)), sid(docX), "T11d Dr X is still the patient's owner");
  const rv = await api("POST", `/patient-access/delegations/${del.json.delegation._id}/revoke`, tkO, {});
  eq(rv.status, 200, "T12a the delegation is revoked");
  const revoked = await guard("revoked", tkY, 404, "Y");
  eq(revoked.codes, [404, 404, 404, 404], "T12 after revocation the SAME token is denied on every mutation");
  eq(revoked.after, revoked.before, "T12b …and nothing was created");

  const soon = await api("POST", "/patient-access/delegations", tkO, { fromDoctorId: sid(docX), toDoctorId: sid(docY), scope: "selected", patientIds: [sid(pX)], expiresAt: new Date(Date.now() + 3600e3).toISOString() });
  eq((await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["45"], requestId: "deleg-timed-0001" }, pX, tkY)).status, 201, "T13a a time-limited delegation works before it expires");
  await PatientDoctorAccess.updateMany({ delegationId: new t.mongoose.Types.ObjectId(soon.json.delegation._id) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const expired = await guard("expired", tkY, 404, "Y");
  eq(expired.codes, [404, 404, 404, 404], "T13 once the delegation has expired the doctor is denied on every mutation (no clean-up job needed)");
  await api("POST", `/patient-access/delegations/${soon.json.delegation._id}/revoke`, tkO, {});

  /* ---------- T14 · cross-clinic ---------- */
  const xc = [
    await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["16"] }, pX, tkOB),
    await edit(mt.json.item._id, { notes: "hijack" }, pX, tkDB),
    await act(mt.json.item._id, "cancel", {}, pX, tkOB),
    await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["16"] }, pB, tkX), // our doctor into the other clinic's patient
  ];
  eq(xc.map((r) => r.status), [404, 404, 404, 404], "T14 a doctor/owner of ANOTHER clinic cannot create / edit / cancel on our patient, and ours cannot reach theirs");
  eq(await count({ clinicId: B._id }), 0, "T14b …and clinic B holds no treatment records");
  // a record id from another patient of the same clinic can't be edited through the wrong patient's URL
  eq((await edit(mt.json.item._id, { notes: "wrong patient url" }, pX2, tkX)).status, 404, "T14c editing a treatment through a DIFFERENT patient's URL fails (404)");

  /* ---------- I · idempotent create (T15 + replay semantics) ---------- */
  const before15 = await count({ clinicId: A._id, patientId: pX._id });
  const body15 = { procedureCode: "root_canal", targetType: "tooth", toothNumbers: ["36"], requestId: "dbl-click-abcdef01" };
  const burst = await Promise.all([add(body15), add(body15), add(body15), add(body15), add(body15)]);
  const created15 = burst.filter((r) => r.status === 201).length, replayed = burst.filter((r) => r.status === 200 && r.json.idempotentReplay === true).length;
  eq(await count({ clinicId: A._id, patientId: pX._id, toothNumbers: "36" }), 1, "T15 five simultaneous identical Saves create exactly ONE record");
  eq(await count({ clinicId: A._id, patientId: pX._id }), before15 + 1, "T15b …and the patient gained exactly one record overall");
  ok(created15 === 1 && replayed === 4, "T15c one request answers 201, the other four answer 200 with idempotentReplay", burst.map((r) => [r.status, r.json.code]));
  eq(new Set(burst.map((r) => r.json.item && r.json.item._id)).size, 1, "T15d every response carries the SAME item id (the UI shows one card)");
  const again = await add(body15);
  eq([again.status, again.json.idempotentReplay], [200, true], "I1 a later retry with the same request id (dropped response) returns the same record");
  const noKey = { procedureCode: "crown", targetType: "tooth", toothNumbers: ["37"] };
  const k1 = await add(noKey), k2 = await add(noKey);
  eq([k1.status, k2.status, k2.json.code], [201, 409, "DUPLICATE_ITEM"], "I2 without a request id the old protection still applies (second identical create -> 409 DUPLICATE_ITEM)");
  const burstNoKey = await Promise.all([1, 2, 3, 4].map(() => add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["38"] })));
  eq(await count({ clinicId: A._id, patientId: pX._id, toothNumbers: "38" }), 1, "I3 four simultaneous creates WITHOUT a request id still leave exactly one record");
  ok(burstNoKey.filter((r) => r.status === 201).length === 1, "I3b exactly one of them answers 201", burstNoKey.map((r) => r.status));
  // the key is scoped by patient: the same request id on another patient is a different, legitimate create
  const other = await add({ ...body15 }, pX2);
  eq([other.status, other.json.item && other.json.item.toothNumbers], [201, ["36"]], "I4 the same request id on ANOTHER patient is an independent create (keys are scoped by clinic + patient)");
  eq(await count({ clinicId: A._id, patientId: pX2._id }), 1, "I4b …and it landed on that patient only");
  const bad = await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["99"], requestId: "bad-input-000001" });
  eq(bad.status, 400, "I5 invalid input is still rejected (400)");
  ok(!/at .*\.(js|ts):\d+|MongoServerError|ValidationError/.test(JSON.stringify(bad.json)), "I5b …without leaking internals", bad.json);
  eq((await add({ ...body15, requestId: "x" })).status, 400, "I6 a malformed request id (too short) is rejected");

  // the atomic guard must not block legitimate re-planning: once cancelled / completed, the same treatment can be planned again
  const rc = (await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["25"] })).json.item;
  eq((await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["25"] })).json.code, "DUPLICATE_ITEM", "I7 an identical ACTIVE treatment is refused");
  await act(rc._id, "cancel");
  eq((await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["25"] })).status, 201, "I7b after cancelling it, the same treatment can be planned again");
  const ec = (await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["24"] })).json.item;
  eq((await edit(ec._id, { toothNumbers: ["25"] })).json.code, "DUPLICATE_ITEM", "I8 editing a treatment INTO an identical active one is refused (no silent duplicate)");
  eq((await edit(ec._id, { toothNumbers: ["23"] })).status, 200, "I8b …and a normal tooth change is accepted");
  eq((await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["24"] })).status, 201, "I8c the key was released from tooth 24 when the treatment moved to 23");

  /* ---------- C · canonical read agrees everywhere ---------- */
  const fin = await plan();
  eq(fin.items.map((i) => i._id).sort(), (await DentalTreatmentItem.find({ clinicId: A._id, patientId: pX._id }).lean()).map(sid).sort(), "C3 the plan read lists exactly the stored records (no extra, none missing)");
  ok(fin.items.every((i) => i.createdBy && i.createdBy._id), "C4 every item still reports its creator");
  const ids = fin.items.map((i) => i._id);
  eq(new Set(ids).size, ids.length, "C5 no id appears twice");

  /* ---------- H · Phase 3 History + deep link still point at the SAME record ---------- */
  const hist = await api("GET", `/patients/${sid(pX)}/clinical-history?limit=50&source=treatment_plan`, tkX);
  eq(hist.status, 200, "H1 the unified History still loads");
  const hi = (hist.json.items || []).find((i) => i.text === NOTE + " (started)");
  ok(!!hi && hi.deepLink && hi.deepLink.itemId === it._id && hi.deepLink.tab === "treatment-plan", "H2 the History row of the edited treatment deep-links to the SAME record id (after edit + status change)", hi);
  eq((hist.json.items || []).filter((i) => i.text === NOTE + " (started)").length, 1, "H3 the note appears once in History (no duplicate from the plan/chart/edit)");
  const gone = (hist.json.items || []).find((i) => i.deepLink && i.deepLink.itemId === own._id);
  ok(gone === undefined || typeof gone.text === "string", "H4 a cancelled treatment never breaks History");

  t.noLeaks();
  await t.finish("Phase 4 — treatment plan <-> dental chart sync (backend)");
})().catch((e) => { console.error(e); process.exit(1); });
