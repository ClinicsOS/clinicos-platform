/* PHASE 3 · PARTS B + C — UNIFIED CLINICAL HISTORY + NOTE DEEP LINKING. End-to-end against the COMPILED server (real HTTP, real database,
   nothing mocked); the browser-side rules (URL parsing, tooth / treatment resolution, day grouping) are the SAME pure modules the app imports.
     npm run build && node tests/patient-history/unified-clinical-history.test.js
   Optional env: P10_MONGO (default mongodb://127.0.0.1:27017), P10_DIST, P10_OUT.

   Tagged exactly as the Phase 3 specification:
     H1 … H19   unified history      (1 appointment · 2 treatment plan · 3 dental chart · 4 newest first · 5 source type · 6 doctor · 7 tooth · 8 surface
                                       9 treatment name · 10 no duplicates · 11 doctor B denied · 12 owner · 13 delegated · 14 revoked · 15 expired
                                       16 cross-clinic · 17 filter · 18 search · 19 pagination)
     D20 … D27  deep linking         (20 appointment link · 21 treatment link · 22 dental chart link · 23 selects the tooth · 24 focuses the treatment
                                       25 missing target · 26 invalid ids · 27 URL state never bypasses authorization)
   Extra groups: X (administrative noise stays out) · E (edited marker, clinic-local day, entered-in-error) · S (specialties) · L (leaks). */
const path = require("path");
const { pathToFileURL } = require("url");
const { boot } = require("../phase10/lib");
const DIST = process.env.P10_DIST || path.resolve(__dirname, "../../dist");
const FE = path.resolve(__dirname, "../../../frontEnd/src");
const tz = require(path.join(DIST, "utils/timezone"));
const AMMAN = "Asia/Amman";

(async () => {
  // the browser-side pure modules (TypeScript source, loaded by Node's type stripping)
  const deeplink = await import(pathToFileURL(path.join(FE, "lib/history/deeplink.ts")).href);
  const grouping = await import(pathToFileURL(path.join(FE, "lib/history/grouping.ts")).href);

  const t = await boot({ name: "unified_history", port: 5814, env: { NODE_OPTIONS: `--require ${path.join(__dirname, "../multi-doctor/ferret-date-shim.js")} --require ${path.join(__dirname, "../analytics/agg-emulator.js")} --require ${path.join(__dirname, "../phase7/expr-shim.js")}` } });
  const { ok, eq, http, m } = t;
  const { Appointment, Invoice, ActivityLog } = m;
  const { ClinicalNote } = t.M("ClinicalNote");
  const { DentalToothEvent } = t.M("DentalToothEvent");
  const { DentalTreatmentItem } = t.M("DentalTreatmentItem");
  const { DentalTreatmentSession } = t.M("DentalTreatmentSession");
  const { PatientDoctorAccess } = t.M("PatientDoctorAccess");
  const sid = (x) => String(x._id);
  const api = (method, url, token, body) => http(method, url, { token, body });
  const sleep = t.sleep;
  const DAY = 864e5;
  const ago = (days, hours = 0) => new Date(Date.now() - days * DAY - hours * 36e5);

  const wh = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, from: "09:00", to: "17:00" }));
  const A = await t.mkClinic("uh-a", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const B = await t.mkClinic("uh-b", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const G = await t.mkClinic("uh-general", { specialty: "general", plan: "pro", workingHours: wh, slotDuration: 30 });
  const R = await t.mkClinic("uh-derm", { specialty: "dermatology_aesthetics", plan: "pro", workingHours: wh, slotDuration: 30 });
  const owner = await t.mkUser(A, "owner"), docX = await t.mkUser(A, "doctor", 1), docY = await t.mkUser(A, "doctor", 2), rec = await t.mkUser(A, "receptionist");
  const ownerB = await t.mkUser(B, "owner"), docB = await t.mkUser(B, "doctor");
  const ownerG = await t.mkUser(G, "owner"), docG = await t.mkUser(G, "doctor");
  const ownerR = await t.mkUser(R, "owner"), docR = await t.mkUser(R, "doctor");
  const tkO = t.tok(owner), tkX = t.tok(docX), tkY = t.tok(docY), tkR = t.tok(rec), tkOB = t.tok(ownerB), tkDB = t.tok(docB), tkOG = t.tok(ownerG), tkDG = t.tok(docG), tkOR = t.tok(ownerR), tkDR = t.tok(docR);

  const reg = async (tk, name, phone) => (await api("POST", "/patients", tk, { fullName: name, phone })).json;
  const pX = await reg(tkX, "Xavier History", "0791100001");      // Dr Ahmad's (docX) patient — the subject of the suite
  const pY = await reg(tkY, "Yusuf Other", "0792200001");         // Dr Mahmoud's (docY) patient
  const pB = await t.mkPatient(B, "Outsider Bilal", "0794400001", { noAccess: true });
  const hist = (patient, token, qs = "") => api("GET", `/patients/${sid(patient)}/clinical-history${qs}`, token);
  const setAt = (Model, id, field, date) => Model.collection.updateOne({ _id: id }, { $set: { [field]: date } });

  /* ---------------- fixtures: every note is written through the REAL API as a clinician (so the data has the real production shape) ---------------- */
  // an appointment (3 days ago) with a visit note by Dr Ahmad
  const appt = await Appointment.create({ clinicId: A._id, doctorId: docX._id, patientId: pX._id, startAt: ago(3), duration: 30, status: "completed", visitNote: "Pain when chewing" });
  // an appointment WITHOUT a note (must never appear: no invented history)
  await Appointment.create({ clinicId: A._id, doctorId: docX._id, patientId: pX._id, startAt: ago(9), duration: 30, status: "completed" });
  // a treatment item with notes (created 2 days ago)
  const rct = (await api("POST", `/dental/patients/${sid(pX)}/treatment-plan/items`, tkX, { procedureCode: "root_canal", targetType: "tooth", toothNumbers: ["16"], notes: "Root canal recommended" })).json.item;
  ok(!!rct && !!rct._id, "S0 (setup) a Root Canal on tooth 16 with the note 'Root canal recommended' was added through the Treatment Plan API");
  await setAt(DentalTreatmentItem, new t.mongoose.Types.ObjectId(rct._id), "createdAt", ago(2));
  const gum = (await api("POST", `/dental/patients/${sid(pX)}/treatment-plan/items`, tkX, { procedureCode: "other", customName: "Gum surgery", targetType: "tooth", toothNumbers: ["36"], notes: "Sensitive gum area" })).json.item;
  await setAt(DentalTreatmentItem, new t.mongoose.Types.ObjectId(gum._id), "createdAt", ago(5));
  // a Dental Chart diagnosis with a note, tooth 26, distal surface (1 day ago)
  const dx = (await api("POST", `/dental/patients/${sid(pX)}/teeth/26/diagnoses`, tkX, { code: "caries", surfaces: ["D"], note: "Recurrent caries on distal surface" })).json.event;
  ok(!!dx && !!dx._id, "S0b (setup) a Caries diagnosis on tooth 26 (D) with a note was recorded through the Dental Chart API");
  await setAt(DentalToothEvent, new t.mongoose.Types.ObjectId(dx._id), "createdAt", ago(1));
  // a general condition WITHOUT a note (no history row)
  await api("POST", `/dental/patients/${sid(pX)}/teeth/38/conditions`, tkX, { code: "existing_crown" });
  // a session note on the root canal (visit 3 days ago)
  eq((await api("POST", `/dental/patients/${sid(pX)}/treatment-plan/items/${rct._id}/start`, tkX, { appointmentId: sid(appt) })).status, 201, "S0c (setup) the root canal is started on the visit");
  const sess = await DentalTreatmentSession.findOne({ itemId: rct._id }).lean();
  eq((await api("PUT", `/dental/patients/${sid(pX)}/treatment-sessions/${sid(sess)}/notes`, tkX, { notes: "Canals cleaned, temporary filling placed" })).status, 200, "S0d (setup) the session note is saved");
  await setAt(DentalTreatmentSession, sess._id, "startedAt", ago(0, 5));
  // clinical notes (Patient File): on the visit, on the treatment, and a general one
  const cnVisit = (await api("POST", `/patients/${sid(pX)}/clinical-notes`, tkX, { text: "Follow-up for the chewing pain", sourceType: "appointment", sourceId: sid(appt) })).json.note;
  await setAt(ClinicalNote, new t.mongoose.Types.ObjectId(cnVisit._id), "createdAt", ago(0, 8));
  const cnTreat = (await api("POST", `/patients/${sid(pX)}/clinical-notes`, tkX, { text: "Patient reported sensitivity", sourceType: "dental_treatment", sourceId: rct._id })).json.note;
  await setAt(ClinicalNote, new t.mongoose.Types.ObjectId(cnTreat._id), "createdAt", ago(0, 3));
  const cnGen = (await api("POST", `/patients/${sid(pX)}/clinical-notes`, tkO, { text: "General note by the owner" })).json.note;
  await setAt(ClinicalNote, new t.mongoose.Types.ObjectId(cnGen._id), "createdAt", ago(0, 1));
  eq([cnVisit, cnTreat, cnGen].every((n) => !!n && !!n._id), true, "S0e (setup) three clinical notes were written through the Clinical Notes API");

  const full = await hist(pX, tkX, "?limit=50");
  eq(full.status, 200, "S1 Dr Ahmad opens his patient's history (200)");
  const items = full.json.items;
  const find = (pred) => items.find(pred);

  /* ============ H1–H3 · the three required sources appear ============ */
  const iAppt = find((i) => i.text === "Pain when chewing");
  ok(iAppt && iAppt.sourceType === "appointment" && iAppt.sourceKind === "visit_note", "H1 an APPOINTMENT note ('Pain when chewing') appears in History", iAppt);
  const iPlan = find((i) => i.text === "Root canal recommended");
  ok(iPlan && iPlan.sourceType === "treatment_plan" && iPlan.sourceKind === "item_note", "H2 a TREATMENT PLAN note ('Root canal recommended') appears in History", iPlan);
  const iChart = find((i) => i.text === "Recurrent caries on distal surface");
  ok(iChart && iChart.sourceType === "dental_chart" && iChart.sourceKind === "tooth_note", "H3 a DENTAL CHART note ('Recurrent caries on distal surface') appears in History", iChart);
  ok(!!find((i) => i.text === "Canals cleaned, temporary filling placed" && i.sourceKind === "session_note"), "H3b the treatment SESSION note appears too (it is a Treatment Plan note)");
  ok(!!find((i) => i.text === "Follow-up for the chewing pain") && !!find((i) => i.text === "Patient reported sensitivity") && !!find((i) => i.text === "General note by the owner"), "H3c the Patient File's clinical notes (on a visit, on a treatment, general) are part of the same timeline");
  eq(items.length, 8, "H3d exactly the 8 real notes: visit note, 2 treatment-item notes, 1 session note, 1 tooth note, 3 clinical notes (the note-less visit and the note-less condition are NOT invented)");

  /* ============ H4 · newest first ============ */
  const times = items.map((i) => new Date(i.at).getTime());
  ok(times.every((x, i) => i === 0 || x <= times[i - 1]), "H4 items are sorted newest-first by their time", items.map((i) => [i.text.slice(0, 18), i.at]));
  eq((await hist(pX, tkX, "?limit=50")).json.items.map((i) => i.id), items.map((i) => i.id), "H4c …the same request twice returns the same order");
  const order = ["General note by the owner", "Patient reported sensitivity", "Canals cleaned, temporary filling placed", "Follow-up for the chewing pain", "Recurrent caries on distal surface", "Root canal recommended", "Pain when chewing", "Sensitive gum area"];
  eq(items.map((i) => i.text), order, "H4d the exact order: 1h, 3h, 5h and 8h ago, then 1 day (chart), 2 days (root canal), 3 days (visit), 5 days (gum item)");

  /* ============ H5 · source type ============ */
  eq([iAppt, iPlan, iChart].map((i) => i.sourceType), ["appointment", "treatment_plan", "dental_chart"], "H5 each item carries the right source type");
  eq(find((i) => i.text === "Follow-up for the chewing pain").sourceType, "appointment", "H5b a clinical note written ON A VISIT is an appointment-source item");
  eq(find((i) => i.text === "Patient reported sensitivity").sourceType, "treatment_plan", "H5c a clinical note written ON A TREATMENT is a treatment-plan item");
  eq(find((i) => i.text === "General note by the owner").sourceType, "clinical_note", "H5d a general clinical note is a clinical_note item");

  /* ============ H6 · doctor ============ */
  eq([iAppt.doctorId, iAppt.doctorName], [sid(docX), docX.name], "H6 the visit note is attributed to the visit's doctor");
  eq([iPlan.doctorId, iChart.doctorId], [sid(docX), sid(docX)], "H6b the treatment note and the chart note to the doctor who wrote them");
  eq([find((i) => i.text === "General note by the owner").doctorName], [owner.name], "H6c a note written by the owner shows the owner as its author (not the patient's doctor)");

  /* ============ H7–H9 · tooth, surface, treatment ============ */
  ok(iChart.toothNumber === "26" && JSON.stringify(iChart.toothNumbers) === '["26"]', "H7 the chart note carries tooth 26", iChart);
  eq([iPlan.toothNumber, iPlan.toothNumbers], ["16", ["16"]], "H7b the treatment note carries tooth 16");
  ok(iAppt.toothNumber === undefined && iAppt.surface === undefined && iAppt.treatment === undefined, "H7c a visit note has NO tooth / surface / treatment (nothing is invented)", iAppt);
  eq([iChart.surface, iChart.surfaces], ["D", ["D"]], "H8 the chart note carries the distal (D) surface");
  eq(iPlan.surface, undefined, "H8b a note without a surface has none");
  eq([iPlan.treatment.code, iPlan.treatment.name], ["root_canal", "Root canal"], "H9 the treatment note carries the treatment (code + name)");
  const iGum = find((i) => i.text === "Sensitive gum area");
  eq([iGum.treatment.code, iGum.treatment.customName, iGum.treatment.name, iGum.toothNumber], ["other", "Gum surgery", "Gum surgery", "36"], "H9b a free-text treatment returns the name the doctor typed");
  eq(find((i) => i.text === "Canals cleaned, temporary filling placed").treatment.sessionNumber, 1, "H9c a session note says which session it is");

  /* ============ H10 · no duplicates ============ */
  ok(new Set(items.map((i) => i.id)).size === items.length, "H10 every item id is unique");
  ok(items.every((i) => i.id === `${i.sourceType}:${i.sourceId}:${i.noteId}`), "H10b the id IS the stable key sourceType:sourceId:noteId");
  // the same treatment is reachable through three relationships (its own note, its session, a clinical note): three DIFFERENT notes, each once
  const viaItem = items.filter((i) => i.sourceId === rct._id);
  eq(viaItem.map((i) => i.noteId).sort().length, new Set(viaItem.map((i) => i.noteId)).size, "H10c the notes reachable through one treatment are all distinct");
  // reading through other filters and a tiny page size never repeats an item either
  let cur = null, seen = [], guard = 0;
  do { const r = (await hist(pX, tkX, `?limit=3${cur ? `&before=${encodeURIComponent(cur)}` : ""}`)).json; seen = seen.concat(r.items.map((i) => i.id)); cur = r.nextCursor; } while (cur && ++guard < 20);
  ok(new Set(seen).size === seen.length && seen.length === items.length, "H10d paging through the whole history 3 at a time returns each note exactly once", { seen: seen.length, total: items.length });
  // creating a clinical note again with the same request id (double click) must not create a second timeline row
  const rid = "dup-request-0001";
  const c1 = await api("POST", `/patients/${sid(pX)}/clinical-notes`, tkX, { text: "Double click note", requestId: rid });
  const c2 = await api("POST", `/patients/${sid(pX)}/clinical-notes`, tkX, { text: "Double click note", requestId: rid });
  eq([c1.status, c2.status, c2.json.duplicate], [201, 200, true], "H10e (setup) a double-clicked note is stored once");
  eq((await hist(pX, tkX, "?limit=50&q=Double click")).json.items.length, 1, "H10f …and appears in History once");

  /* ============ H11–H16 · authorization (the Phase 1 rule, evaluated on every request) ============ */
  const unknown = await api("GET", `/patients/${"a".repeat(24)}/clinical-history`, tkY);
  const denied = await hist(pX, tkY);
  eq([denied.status, denied.json.message], [404, "Patient not found"], "H11 Dr Mahmoud cannot read Dr Ahmad's patient's history by changing the patient id (404)");
  eq([denied.status, denied.json], [unknown.status, unknown.json], "H11b …and the answer is identical to an unknown id (no existence oracle)");
  ok(!JSON.stringify(denied.json).includes("Pain when chewing") && !JSON.stringify(denied.json).includes("Xavier"), "H11c …nothing of the patient leaks in the answer");
  for (const [label, qs] of [["with a source filter", "?source=dental_chart"], ["with a search for the exact note", "?q=Recurrent%20caries"], ["asking for 50 per page", "?limit=50"]]) {
    eq((await hist(pX, tkY, qs)).status, 404, `H11d Dr Mahmoud ${label} → 404`);
  }
  eq((await hist(pY, tkX)).status, 404, "H11e …and the reverse: Dr Ahmad cannot read Dr Mahmoud's patient (404)");
  const ownerView = await hist(pX, tkO, "?limit=50");
  eq([ownerView.status, ownerView.json.items.length], [200, 8 + 1], "H12 the OWNER reads the patient's whole history (clinic-wide visibility)");
  eq((await hist(pY, tkO)).status, 200, "H12b …and Dr Mahmoud's patient too");
  const recView = await hist(pX, tkR);
  eq(recView.status, 200, "H12c the receptionist can read it as she can read the rest of the patient file (policy: patientClinical = clinic)");

  const del = await api("POST", "/patient-access/delegations", tkO, { fromDoctorId: sid(docX), toDoctorId: sid(docY), scope: "all" });
  eq(del.status, 201, "H13 (setup) the owner lets Dr Mahmoud COVER Dr Ahmad's patients");
  const viaDel = await hist(pX, tkY, "?limit=50");
  eq([viaDel.status, viaDel.json.items.length], [200, 9], "H13 the covering doctor now reads the whole history (200)");
  const rv = await api("POST", `/patient-access/delegations/${del.json.delegation._id}/revoke`, tkO, {});
  eq(rv.status, 200, "H14 (setup) the owner REVOKES the coverage");
  eq([(await hist(pX, tkY)).status, (await hist(pX, tkY)).json.message], [404, "Patient not found"], "H14 revoked: the SAME token gets 404 on the very next call");

  const soon = await api("POST", "/patient-access/delegations", tkO, { fromDoctorId: sid(docX), toDoctorId: sid(docY), scope: "selected", patientIds: [sid(pX)], expiresAt: new Date(Date.now() + 3000).toISOString() });
  eq(soon.status, 201, "H15 (setup) a coverage that ends in 3 seconds");
  eq((await hist(pX, tkY)).status, 200, "H15 …works while valid");
  await sleep(3400);
  eq((await hist(pX, tkY)).status, 404, "H15 expired: 404, no clean-up job needed");
  const sched = await api("POST", "/patient-access/delegations", tkO, { fromDoctorId: sid(docX), toDoctorId: sid(docY), scope: "selected", patientIds: [sid(pX)], expiresAt: new Date(Date.now() + 3600e3).toISOString() });
  await PatientDoctorAccess.updateMany({ delegationId: new t.mongoose.Types.ObjectId(sched.json.delegation._id) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  eq((await hist(pX, tkY)).status, 404, "H15b a window forced into the past in the database also grants nothing");
  await api("POST", `/patient-access/delegations/${sched.json.delegation._id}/revoke`, tkO, {});

  eq([(await hist(pX, tkOB)).status, (await hist(pX, tkDB)).status], [404, 404], "H16 another clinic's owner AND doctor get 404");
  eq((await hist(pB, tkO)).status, 404, "H16b clinic A's owner cannot read clinic B's patient (404)");
  eq((await hist(pB, tkOB)).json.items.length, 0, "H16c clinic B's own owner reads his patient (empty), and none of clinic A's notes appear");
  eq((await api("GET", `/patients/${sid(pX)}/clinical-history`, t.tok(owner, { clinicId: sid(B) }))).status, 200, "H16d a token that CLAIMS another clinicId is ignored (clinic always comes from the database)");
  eq((await http("GET", `/patients/${sid(pX)}/clinical-history`)).status, 401, "H16e no token → 401");

  /* ============ H17 · filters ============ */
  const bySource = async (src) => (await hist(pX, tkX, `?limit=50&source=${src}`)).json.items;
  eq((await bySource("appointment")).map((i) => i.text).sort(), ["Follow-up for the chewing pain", "Pain when chewing"].sort(), "H17 Appointments filter = the visit note + the clinical note written on the visit");
  eq((await bySource("treatment_plan")).map((i) => i.text).sort(), ["Canals cleaned, temporary filling placed", "Patient reported sensitivity", "Root canal recommended", "Sensitive gum area"].sort(), "H17b Treatment Plan filter = item notes, session notes and clinical notes on a treatment");
  eq((await bySource("dental_chart")).map((i) => i.text), ["Recurrent caries on distal surface"], "H17c Dental Chart filter = the chart note only");
  eq((await bySource("clinical_note")).map((i) => i.text).sort(), ["Double click note", "General note by the owner"].sort(), "H17d General notes filter");
  eq((await bySource("all")).length, 9, "H17e All = everything (9 with the double-click note)");
  ok((await bySource("clinical_map")).length === 0 && full.json.sources.join() === "appointment,treatment_plan,dental_chart,clinical_note", "H17f a dentistry clinic offers exactly the filters appointment / treatment_plan / dental_chart / clinical_note", full.json.sources);

  /* ============ H18 · search ============ */
  const sq = async (q) => (await hist(pX, tkX, `?limit=50&q=${encodeURIComponent(q)}`)).json.items.map((i) => i.text).sort();
  eq(await sq("chewing"), ["Follow-up for the chewing pain", "Pain when chewing"].sort(), "H18 search by note text (case-insensitive substring)");
  eq(await sq("RECURRENT"), ["Recurrent caries on distal surface"], "H18b …case-insensitive");
  eq(await sq("26"), ["Recurrent caries on distal surface"], "H18c search by tooth number (26)");
  eq((await sq("16")).sort(), ["Canals cleaned, temporary filling placed", "Patient reported sensitivity", "Root canal recommended"].sort(), "H18d search by tooth 16 finds the treatment's note, its session note and the clinical note written on it");
  ok((await sq("root canal")).includes("Root canal recommended") && (await sq("root canal")).includes("Canals cleaned, temporary filling placed"), "H18e search by treatment name ('root canal')", await sq("root canal"));
  ok((await sq("gum surgery")).includes("Sensitive gum area"), "H18f …including a typed free-text treatment name");
  ok((await sq(docX.name)).length >= 5 && !(await sq(docX.name)).includes("General note by the owner"), "H18g search by doctor name (the owner's note is not Dr Ahmad's)", await sq(docX.name));
  eq(await sq("zzz-nothing-matches"), [], "H18h a search with no match is an empty page (not an error)");
  eq([(await hist(pX, tkX, `?q=${encodeURIComponent("(((.*[")}`)).status, (await hist(pX, tkX, `?q=${encodeURIComponent("$where")}`)).status], [200, 200], "H18i regex / operator characters in the search are treated as plain text (no error, no injection)");
  eq((await hist(pX, tkX, `?q=${encodeURIComponent("x".repeat(500))}`)).status, 400, "H18j an absurdly long search is refused (400)");
  eq(((await hist(pX, tkX, `?limit=50&source=dental_chart&q=${encodeURIComponent("chewing")}`)).json.items.length), 0, "H18k filter + search combine (AND)");

  /* ============ H19 · pagination ============ */
  const all9 = (await hist(pX, tkX, "?limit=50")).json.items; // now includes the double-click note created above
  const p1 = (await hist(pX, tkX, "?limit=4")).json;
  eq([p1.items.length, !!p1.nextCursor], [4, true], "H19 limit=4 returns 4 items and a cursor");
  const p2 = (await hist(pX, tkX, `?limit=4&before=${encodeURIComponent(p1.nextCursor)}`)).json;
  eq(p2.items.map((i) => i.id), all9.slice(4, 8).map((i) => i.id), "H19b the next page continues exactly where the first stopped");
  const p3 = (await hist(pX, tkX, `?limit=4&before=${encodeURIComponent(p2.nextCursor)}`)).json;
  eq([p3.items.length, p3.nextCursor], [all9.length - 8, null], "H19c the last page holds the rest and no cursor");
  eq((await hist(pX, tkX, "?limit=4&before=garbage")).status, 400, "H19d a malformed cursor is a 400, not a crash");
  eq((await hist(pX, tkX, "?limit=0")).status, 400, "H19e limit 0 → 400");
  eq((await hist(pX, tkX, "?limit=1000")).status, 400, "H19f an over-large limit → 400 (the payload is bounded)");
  eq((await hist(pX, tkX)).json.items.length <= 20, true, "H19g the default page is 20");
  // many same-instant notes must not be skipped or repeated by the cursor
  const same = ago(0, 30);
  for (let i = 0; i < 6; i++) { const n = (await api("POST", `/patients/${sid(pX)}/clinical-notes`, tkX, { text: `Tie note ${i}`, requestId: `tie-request-000${i}` })).json.note; await setAt(ClinicalNote, new t.mongoose.Types.ObjectId(n._id), "createdAt", same); }
  let c = null, tie = [], g2 = 0;
  do { const r = (await hist(pX, tkX, `?limit=2&q=Tie%20note${c ? `&before=${encodeURIComponent(c)}` : ""}`)).json; tie = tie.concat(r.items.map((i) => i.text)); c = r.nextCursor; } while (c && ++g2 < 20);
  eq(tie.sort(), [0, 1, 2, 3, 4, 5].map((i) => `Tie note ${i}`), "H19h six notes with the SAME timestamp, read 2 at a time: none skipped, none repeated");
  for (const n of await ClinicalNote.find({ patientId: pX._id, text: /^Tie note/ }).lean()) await ClinicalNote.deleteOne({ _id: n._id });

  /* ============ D20–D22 · the deep-link metadata is correct and points at something real ============ */
  const homeDate = tz.clinicYmdOf(new Date(iAppt.appointment.startAt), AMMAN);
  eq([iAppt.deepLink.tab, iAppt.deepLink.appointmentId, iAppt.deepLink.appointmentDate], ["appointment", sid(appt), homeDate], "D20 an appointment note links to ITS appointment (id + clinic-local day)");
  const dayList = await api("GET", `/appointments?date=${iAppt.deepLink.appointmentDate}&patientId=${sid(pX)}`, tkX);
  ok(dayList.status === 200 && dayList.json.some((a) => a._id === iAppt.deepLink.appointmentId), "D20b …and that appointment really is on that day for this doctor (a PAST visit still resolves)");
  const href = deeplink.buildHistoryHref(sid(pX), iAppt.deepLink);
  eq(href, `/appointments?appt=${sid(appt)}&date=${homeDate}&patient=${sid(pX)}&note=visit-note`, "D20c the URL the app navigates to (the existing ?appt=&date= deep link of the Appointments page)");

  eq([iPlan.deepLink.tab, iPlan.deepLink.itemId, iPlan.deepLink.noteId, iPlan.deepLink.sourceId], ["treatment-plan", rct._id, "item-notes", rct._id], "D21 a treatment-plan note links to its treatment by STABLE id");
  const sessionItem = find((i) => i.sourceKind === "session_note");
  eq([sessionItem.deepLink.itemId, sessionItem.deepLink.sessionId], [rct._id, sid(sess)], "D21b a session note links to the treatment AND the session by id");
  // the link does not depend on position or text: add newer items, edit the text — the ids stay
  await api("POST", `/dental/patients/${sid(pX)}/treatment-plan/items`, tkX, { procedureCode: "crown", targetType: "tooth", toothNumbers: ["46"], notes: "Newer item pushes the list down" });
  await api("PUT", `/dental/patients/${sid(pX)}/treatment-plan/items/${rct._id}`, tkX, { notes: "Root canal recommended (updated)" });
  const after = (await hist(pX, tkX, "?limit=50")).json.items;
  const same2 = after.find((i) => i.sourceId === rct._id && i.noteId === "item-notes");
  ok(same2 && same2.id === iPlan.id && same2.deepLink.itemId === iPlan.deepLink.itemId && same2.text === "Root canal recommended (updated)", "D21c after new items and a text edit the SAME note keeps the SAME id / deep link, and shows the CURRENT text", same2);
  const tplan = (await api("GET", `/dental/patients/${sid(pX)}/treatment-plan`, tkX)).json;
  ok(tplan.items.some((i) => i._id === iPlan.deepLink.itemId), "D21d …and the id is a real item of the Treatment Plan");

  eq([iChart.deepLink.tab, iChart.deepLink.toothNumber, iChart.deepLink.surface, iChart.deepLink.eventId, iChart.deepLink.noteId], ["dental-chart", "26", "D", dx._id, "note"], "D22 a chart note links to tooth 26, surface D and the entry id");
  const th = await api("GET", `/dental/patients/${sid(pX)}/teeth/26/history`, tkX);
  ok(th.status === 200 && JSON.stringify(th.json).includes(dx._id), "D22b …and that entry really is in tooth 26's history", th.status);
  eq(deeplink.buildHistoryHref(sid(pX), iChart.deepLink), `/patients/profile?patient=${sid(pX)}&tab=dental-chart&tooth=26&surface=D&event=${dx._id}&note=note&source=${dx._id}`, "D22c the URL: tab, tooth, surface, entry id, note id, source id");

  /* ============ D23 · the dental chart link selects the right tooth ============ */
  const fChart = deeplink.parseProfileFocus(new URL("http://x" + deeplink.buildHistoryHref(sid(pX), iChart.deepLink)).searchParams);
  eq([fChart.tab, fChart.tooth, fChart.surface, fChart.event, fChart.patient], ["dental-chart", "26", "D", dx._id, sid(pX)], "D23 parsing the URL back gives tab / tooth 26 / surface D / entry id / patient");
  eq(deeplink.focusedTooth(fChart, ["25", "26", "27"]), "26", "D23b the tooth selected is 26");
  eq(deeplink.focusedTooth(fChart, ["11", "12"]), null, "D23c a tooth the current dentition does not have selects nothing (no crash, no wrong tooth)");
  eq(deeplink.focusedSurface(fChart), "D", "D23d the distal surface is the one emphasised");
  const events = (await api("GET", `/dental/patients/${sid(pX)}/record`, tkX)).json.events;
  eq(deeplink.findFocusedEvent(events, fChart)?._id, dx._id, "D23e the chart entry to scroll to is found by its id in the record the chart loads");

  /* ============ D24 · the treatment plan link focuses the right treatment ============ */
  const fPlan = deeplink.parseProfileFocus(new URL("http://x" + deeplink.buildHistoryHref(sid(pX), iPlan.deepLink)).searchParams);
  eq([fPlan.tab, fPlan.item, fPlan.note], ["treatment-plan", rct._id, "item-notes"], "D24 the Treatment Plan URL parses back to the tab + item id + note id");
  const reversed = tplan.items.slice().reverse();
  eq(deeplink.findFocusedItem(reversed, fPlan)?._id, rct._id, "D24b the focused treatment is found by id whatever the order of the list");
  const twin = tplan.items.map((i) => ({ ...i, notes: "identical text" }));
  eq(deeplink.findFocusedItem(twin, fPlan)?._id, rct._id, "D24c …even when every treatment has the same text (never matched by text)");
  eq(deeplink.findFocusedItem(tplan.items.filter((i) => i._id !== rct._id), fPlan), null, "D24d a treatment that is not in the plan focuses nothing (null, not the neighbour)");

  /* ============ D25 · a missing target never crashes anything ============ */
  const gone = await DentalTreatmentItem.create({ clinicId: A._id, patientId: pX._id, planId: new t.mongoose.Types.ObjectId(), procedureCode: "filling", catalogVersion: 1, targetType: "tooth", toothNumbers: ["47"], dentitionType: "permanent", status: "planned", createdBy: docX._id });
  const orphan = (await api("POST", `/patients/${sid(pX)}/clinical-notes`, tkX, { text: "Note on a treatment that will be removed", sourceType: "dental_treatment", sourceId: sid(gone) })).json.note;
  await DentalTreatmentItem.deleteOne({ _id: gone._id });
  const goneAppt = await Appointment.create({ clinicId: A._id, doctorId: docX._id, patientId: pX._id, startAt: ago(20), duration: 30, status: "completed" });
  const orphanA = (await api("POST", `/patients/${sid(pX)}/clinical-notes`, tkX, { text: "Note on a visit that will be removed", sourceType: "appointment", sourceId: sid(goneAppt) })).json.note;
  await Appointment.deleteOne({ _id: goneAppt._id });
  const afterGone = await hist(pX, tkX, "?limit=50");
  eq(afterGone.status, 200, "D25 history still loads when notes point at records that no longer exist (200, no crash)");
  const oT = afterGone.json.items.find((i) => i.noteId === orphan._id), oA = afterGone.json.items.find((i) => i.noteId === orphanA._id);
  ok(oT && oT.sourceMissing === true && oT.text === "Note on a treatment that will be removed", "D25b the note itself stays readable and is flagged sourceMissing (the UI says 'Original record is no longer available')", oT);
  ok(oA && oA.sourceMissing === true && oA.text === "Note on a visit that will be removed", "D25c same for a removed visit", oA);
  eq(deeplink.buildHistoryHref(sid(pX), { ...oA.deepLink, appointmentId: undefined }), null, "D25d a link with no target id is not navigable (null) instead of a broken URL");
  eq(deeplink.findFocusedItem(tplan.items, { item: "f".repeat(24) }), null, "D25e a well-formed id that matches nothing focuses nothing");
  eq(deeplink.findFocusedItem(undefined, { item: "f".repeat(24) }), null, "D25f …and not-yet-loaded data is handled (null)");
  for (const n of [orphan, orphanA]) await ClinicalNote.deleteOne({ _id: n._id });

  /* ============ D26 · invalid ids / values fail gracefully ============ */
  const bad = deeplink.parseProfileFocus(new URLSearchParams("patient=zzz&tab=<script>&tooth=999&surface=X&event=not-an-id&item=%27%3Bdrop&note=%3Cb%3E&source=1"));
  eq(Object.values(bad).every((v) => v === null), true, "D26 every malformed URL parameter is dropped to null (no injection, no crash)");
  const hostile = deeplink.parseProfileFocus(new URLSearchParams(`tab=record&note=${"A".repeat(500)}&tooth=2x`));
  eq([hostile.tab, hostile.note, hostile.tooth], ["record", null, null], "D26b an over-long note id and a non-numeric tooth are dropped; the valid tab survives");
  eq(deeplink.buildHistoryHref("not-an-id", iChart.deepLink), null, "D26c a link cannot be built for a malformed patient id");
  eq(deeplink.buildHistoryHref(sid(pX), { tab: "javascript:alert(1)", sourceId: "x", noteId: "y" }), null, "D26d an unknown tab never becomes a URL");
  eq([(await api("GET", "/patients/not-an-id/clinical-history", tkX)).status, (await hist(pX, tkX, "?source=bogus")).status], [404, 400], "D26e the API: a malformed patient id → 404, an unknown source → 400");
  eq((await api("PUT", `/patients/${sid(pX)}/clinical-notes/not-an-id`, tkX, { text: "x" })).status, 404, "D26f a bad note id on the notes API is a 404 as before");

  /* ============ D27 · URL / query state can never bypass authorization ============ */
  const urlForX = deeplink.buildHistoryHref(sid(pX), iChart.deepLink);
  ok(urlForX.includes(`patient=${sid(pX)}`), "D27 (setup) Dr Mahmoud is given a deep link to Dr Ahmad's patient");
  for (const [label, url] of [
    ["history", `/patients/${sid(pX)}/clinical-history?source=dental_chart`],
    ["dental chart record", `/dental/patients/${sid(pX)}/record`],
    ["tooth history", `/dental/patients/${sid(pX)}/teeth/26/history`],
    ["treatment plan", `/dental/patients/${sid(pX)}/treatment-plan`],
    ["clinical timeline", `/patients/${sid(pX)}/clinical-timeline`],
    ["the patient file", `/patients/${sid(pX)}`],
    ["the patient's visits", `/appointments?patientId=${sid(pX)}&date=${homeDate}`],
  ]) {
    const r = await api("GET", url, tkY);
    ok(r.status === 404 || (r.status === 200 && Array.isArray(r.json) && r.json.length === 0), `D27b the deep link's target (${label}) is still refused to Dr Mahmoud`, { status: r.status, body: JSON.stringify(r.json).slice(0, 80) });
    ok(!JSON.stringify(r.json).includes("Recurrent caries") && !JSON.stringify(r.json).includes("Pain when chewing"), `D27c …${label}: no clinical text leaks`);
  }
  eq((await api("GET", `/appointments?appt=${sid(appt)}&date=${homeDate}`, tkY)).json.some?.((a) => a._id === sid(appt)) ?? false, false, "D27d the Appointments page's ?appt= link shows Dr Mahmoud nothing of Dr Ahmad's visit");
  // …and once Dr Mahmoud is validly delegated, the SAME link works, from the same endpoints
  const d2 = await api("POST", "/patient-access/delegations", tkO, { fromDoctorId: sid(docX), toDoctorId: sid(docY), scope: "all" });
  eq([(await api("GET", `/dental/patients/${sid(pX)}/record`, tkY)).status, (await api("GET", `/appointments?patientId=${sid(pX)}&date=${homeDate}`, tkY)).json.some((a) => a._id === sid(appt))], [200, true], "D27e with a valid delegation the same deep link's targets open (incl. the covered doctor's view of the past visit)");
  await api("POST", `/patient-access/delegations/${d2.json.delegation._id}/revoke`, tkO, {});
  eq((await api("GET", `/dental/patients/${sid(pX)}/record`, tkY)).status, 404, "D27f …and stop the moment the coverage is revoked");

  /* ============ X · administrative noise never becomes a clinical note ============ */
  const baseline = (await hist(pX, tkX, "?limit=50")).json.items.length;
  const inv = (await api("POST", "/invoices", tkO, { patientId: sid(pX), doctorId: sid(docX), items: [{ description: "Root canal 16", price: 120, qty: 1 }] })).json;
  await api("DELETE", `/invoices/${sid(inv)}`, tkO, { reason: "mistake" });
  await api("POST", `/dental/patients/${sid(pX)}/treatment-plan/items/${rct._id}/cancel`, tkX, { reason: "patient declined" }).catch(() => {});
  await api("GET", "/auth/me", tkX); await api("GET", "/reports/monthly", tkO);
  await ActivityLog.create({ action: "invoice.soft_deleted", actorEmail: "x@y.z", targetType: "clinic", targetId: sid(A), details: { invoiceId: sid(inv), note: "should never be in history" } });
  const noisy = (await hist(pX, tkX, "?limit=50")).json.items;
  eq(noisy.length, baseline, "X1 an invoice created + deleted, a treatment cancelled, a login-style call, a report and an audit-log row add NOTHING to the clinical history");
  ok(noisy.every((i) => ["visit_note", "clinical_note", "item_note", "session_note", "tooth_note", "tooth_resolution", "assessment_note", "follow_up_note"].includes(i.sourceKind)), "X2 every item is a genuine note kind");
  ok(!JSON.stringify(noisy).includes("should never be in history") && !JSON.stringify(noisy).includes("patient declined"), "X3 audit text and cancel reasons are not clinical notes");
  ok(!noisy.some((i) => i.text === "Root canal 16"), "X4 invoice lines are not notes");

  /* ============ E · edited marker, clinic-local days, entered in error, resolution ============ */
  const edit = await api("PUT", `/patients/${sid(pX)}/clinical-notes/${cnGen._id}`, tkO, { text: "General note by the owner (edited)", expectedEditCount: 0 });
  eq(edit.status, 200, "E1 (setup) the owner edits his note");
  const edited = (await hist(pX, tkX, "?limit=50&q=General note")).json.items[0];
  ok(edited.edited === true && !!edited.editedAt && edited.text === "General note by the owner (edited)", "E1b the timeline shows the CURRENT text and marks it edited", edited);
  ok(items.filter((i) => i.sourceKind !== "clinical_note").every((i) => i.edited === false), "E1c notes that were never edited are not marked");
  // clinic-local day: 22:30 UTC on Mar 10 is 01:30 on Mar 11 in Amman (UTC+3)
  const lateUtc = new Date("2026-03-10T22:30:00.000Z");
  const lateNote = (await api("POST", `/patients/${sid(pX)}/clinical-notes`, tkX, { text: "Late night note" })).json.note;
  await setAt(ClinicalNote, new t.mongoose.Types.ObjectId(lateNote._id), "createdAt", lateUtc);
  const late = (await hist(pX, tkX, "?limit=50&q=Late night")).json.items[0];
  eq([late.localDate, tz.clinicYmdOf(lateUtc, AMMAN)], ["2026-03-11", "2026-03-11"], "E2 an event at 22:30 UTC belongs to the NEXT clinic-local day (01:30 in Amman), computed by the server in the clinic's timezone");
  // grouping uses those days
  const gItems = [{ localDate: "2026-03-11" }, { localDate: "2026-03-11" }, { localDate: "2026-03-10" }, { localDate: "2026-03-07" }, { localDate: "2026-03-04" }, { localDate: "2026-02-20" }];
  const grp = grouping.groupByDay(gItems, "2026-03-11");
  eq(grp.map((x) => [x.kind, x.items.length]), [["today", 2], ["yesterday", 1], ["week", 1], ["date", 1], ["date", 1]], "E3 grouping: Today / Yesterday / Earlier this week (2–6 days ago) / one group per older day");
  eq(grouping.groupByDay([{ localDate: "2026-03-12" }], "2026-03-11")[0].kind, "today", "E3b a clock-skewed future day is shown as Today (never dropped)");
  eq(grouping.groupByDay([{ localDate: "2026-12-31" }, { localDate: "2027-01-01" }], "2027-01-01").map((x) => x.kind), ["yesterday", "today"], "E3c year rollover: Dec 31 is 'yesterday' on Jan 1 (ordering of input preserved)");
  await ClinicalNote.deleteOne({ _id: lateNote._id });
  // entered in error + resolution note
  const dx2 = (await api("POST", `/dental/patients/${sid(pX)}/teeth/14/diagnoses`, tkX, { code: "caries", surfaces: ["O"], note: "Wrongly entered caries" })).json.event;
  eq((await api("POST", `/dental/patients/${sid(pX)}/events/${dx2._id}/resolve`, tkX, { reason: "entered_in_error", note: "Wrong tooth" })).status, 200, "E4 (setup) a chart entry is marked entered-in-error with a note");
  const eie = (await hist(pX, tkX, "?limit=50&source=dental_chart")).json.items;
  ok(eie.some((i) => i.noteId === "note" && i.sourceId === dx2._id && i.status === "entered_in_error") && eie.some((i) => i.noteId === "resolution" && i.text === "Wrong tooth"), "E4b the entered-in-error entry stays in history, flagged, and its resolution note is a separate item", eie.map((i) => [i.noteId, i.status]));

  /* ============ S · specialties ============ */
  const pG = await t.mkPatient(G, "General Gina", "0795500001");
  const apG = await Appointment.create({ clinicId: G._id, doctorId: docG._id, patientId: pG._id, startAt: ago(2), duration: 30, status: "completed", visitNote: "General clinic visit note" });
  const gh = await hist(pG, tkDG, "?limit=50");
  eq([gh.status, gh.json.sources, gh.json.items.map((i) => i.text)], [200, ["appointment", "clinical_note"], ["General clinic visit note"]], "S1 a non-dental, non-derm clinic: visit notes + clinical notes only, and only those filters are offered");
  eq((await hist(pG, tkOG, "?source=dental_chart")).json.items.length, 0, "S1b asking a general clinic for dental-chart notes returns nothing (that module is not enabled there)");
  const pD = await t.mkPatient(R, "Derm Dana", "0796600001");
  const walk = await api("POST", "/appointments", t.tok(await t.mkUser(R, "receptionist")), { source: "walk_in", patientId: sid(pD), doctorId: sid(docR) });
  const asr = await api("POST", `/derm/patients/${sid(pD)}/assessments`, tkDR, { clientRequestId: "uh-derm-assess-1", recordType: "dermatology", regions: [{ id: "forehead" }], concern: "Acne", findings: "Papules", diagnosis: "Acne vulgaris", notes: "Derm assessment note" });
  const dit = await api("POST", `/derm/patients/${sid(pD)}/treatment-plan/items`, tkDR, { clientRequestId: "uh-derm-item-1", recordType: "dermatology", procedureCode: "cryotherapy", targetType: "single_region", regions: [{ id: "forehead" }], estimatedPrice: 50, priority: "normal", notes: "Derm plan note" });
  const dh = await hist(pD, tkDR, "?limit=50");
  eq(dh.status, 200, "S2 the dermatology clinic's history loads");
  ok(dh.json.sources.join() === "appointment,treatment_plan,clinical_map,clinical_note", "S2b it offers appointment / treatment_plan / clinical_map / clinical_note (no dental chart)", dh.json.sources);
  const dmap = dh.json.items.find((i) => i.text === "Derm assessment note"), dpl = dh.json.items.find((i) => i.text === "Derm plan note");
  ok(asr.status === 201 && dmap && dmap.sourceType === "clinical_map" && dmap.deepLink.tab === "clinical-map" && dmap.deepLink.assessmentId === (asr.json.assessment || asr.json)._id && dmap.regions[0].id === "forehead", "S2c the assessment note is a clinical_map item with its region and a stable assessment id", dmap);
  ok(dit.status === 201 && dpl && dpl.sourceType === "treatment_plan" && dpl.deepLink.tab === "derm-plan" && dpl.deepLink.itemId === (dit.json.item || dit.json)._id, "S2d the dermatology treatment note is a treatment_plan item with its item id", dpl);
  eq((await hist(pD, tkDG)).status, 404, "S2e (control) a doctor of ANOTHER clinic cannot read it");

  /* ============ L · no leaks ============ */
  const everything = JSON.stringify(full.json);
  ok(!/\b(password|tokenVersion|requestKey|revisions)\b/.test(everything), "L1 the history payload exposes no password / token version / idempotency key / revision array");
  ok(items.every((i) => i.clinicId === sid(A) && i.patientId === sid(pX)), "L2 every item belongs to the requested clinic and patient");
  t.noLeaks();
  await t.finish("Phase 3 · Parts B + C — unified clinical history + deep linking");
})().catch((e) => { console.error(e); process.exit(1); });
