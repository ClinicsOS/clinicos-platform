/* Walk-in workflow (Phase 3.5) — end-to-end against the COMPILED server (real HTTP, real database, nothing mocked).
   The server runs with a shifted clock (./fake-clock.js, test-only) so a walk-in is registered at a known clinic-local moment.
     npm run build && node tests/walk-in/walk-in.test.js
   Optional env: P10_MONGO (default mongodb://127.0.0.1:27017), P10_DIST, P10_OUT. */
const path = require("path");
const { boot } = require("../phase10/lib");
const DIST = process.env.P10_DIST || path.resolve(__dirname, "../../dist");
const tz = require(path.join(DIST, "utils/timezone"));
const FAKE = path.join(__dirname, "fake-clock.js");
const AMMAN = "Asia/Amman";
const hhmm = (d) => new Intl.DateTimeFormat("en-GB", { timeZone: AMMAN, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(d));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Day D (clinic-local, tomorrow so it is always inside the plan window): the server's clock starts at D 10:37:24.
  const today = tz.clinicYmdOf(new Date(), AMMAN);
  const D = tz.addDaysYmd(today, 1);
  const at = (ymd, t) => tz.clinicLocalToUtc(ymd, t, AMMAN);
  const T0 = at(D, "10:37"); T0.setSeconds(24);

  const t = await boot({ name: "walk_in", port: 5303, env: { NODE_OPTIONS: `--require ${FAKE}`, FAKE_NOW: T0.toISOString() } });
  const { ok, eq, http, m } = t;
  const { Appointment } = m;

  const wh = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, from: "09:00", to: "17:00" }));
  const A = await t.mkClinic("wi-a", { plan: "pro", workingHours: wh, slotDuration: 30 });
  const B = await t.mkClinic("wi-b", { plan: "pro", workingHours: wh, slotDuration: 30 });
  const owner = await t.mkUser(A, "owner"), rec = await t.mkUser(A, "receptionist"), docA = await t.mkUser(A, "doctor", 1), docB = await t.mkUser(A, "doctor", 2);
  const ownerB = await t.mkUser(B, "owner"), docOfB = await t.mkUser(B, "doctor");
  const tkRec = t.tok(rec), tkOwner = t.tok(owner), tkB = t.tok(ownerB);
  const pats = []; for (let i = 0; i < 8; i++) pats.push(await t.mkPatient(A, "Patient " + i));
  const pOfB = await t.mkPatient(B, "B patient");
  const sid = (x) => String(x._id);
  const walkIn = (body, token = tkRec) => http("POST", "/appointments", { token, body: { source: "walk_in", ...body } });
  const day = (ymd = D, token = tkRec, q = "") => http("GET", `/appointments?date=${ymd}${q}`, { token });
  const slots = (doc, ymd = D) => http("GET", `/public/clinics/wi-a/slots?doctorId=${sid(doc)}&date=${ymd}`);
  const patch = (id, body, token = tkRec) => http("PATCH", `/appointments/${id}/status`, { token, body });
  const count = (filter) => Appointment.countDocuments({ clinicId: A._id, ...filter });

  /* ================= A. creation: exact check-in time, no time picked ================= */
  const w1 = await walkIn({ patientId: sid(pats[0]), doctorId: sid(docA), reason: "Tooth pain" });
  eq(w1.status, 201, "A1 a walk-in needs only patient + doctor (no date, no time, no duration)");
  const W1 = w1.json || {};
  eq(W1.source, "walk_in", "A2 explicitly marked source = walk_in");
  const ci = new Date(W1.startAt);
  ok(Math.abs(ci - Date.now()) < 5000 || Math.abs(ci - T0) < 120000, "A3 check-in time is the server's current moment", [W1.startAt, T0]);
  ok(["10:37", "10:38"].includes(hhmm(ci)), "A4 clinic-local check-in time is 10:37 (not rounded to the 10:30 / 11:00 slot grid)", hhmm(ci));
  ok(ci.getTime() % 60000 !== 0 || ci.getMilliseconds() !== 0, "A5 seconds / milliseconds are preserved, not zeroed", W1.startAt);
  eq(tz.clinicYmdOf(ci, AMMAN), D, "A6 it belongs to the correct clinic-local day");
  eq([W1.status, W1.duration], ["scheduled", 30], "A7 existing statuses are reused (scheduled) and the duration is the clinic slot length");
  eq([W1.clinicId, W1.patientId, W1.doctorId], [sid(A), sid(pats[0]), sid(docA)], "A8 clinic, patient and doctor are real references");
  eq(W1.createdBy, sid(rec), "A9 the creating staff member is stored (a user reference)");
  eq((await Appointment.findById(W1._id).lean()).visitNote, "Tooth pain", "A10 the optional reason is kept in the existing visitNote");
  const w1b = await walkIn({ patientId: sid(pats[1]), doctorId: sid(docA), startAt: "2020-01-01T00:00:00.000Z", duration: 90, clinicId: sid(B) });
  eq(w1b.status, 201, "A11 a client-sent startAt / duration / clinicId does not break creation");
  ok(Math.abs(new Date(w1b.json.startAt) - new Date(W1.startAt)) < 60000 && w1b.json.duration === 30 && w1b.json.clinicId === sid(A), "A12 …and is ignored (server clock, clinic slot length, authenticated clinic)", w1b.json);
  eq((await walkIn({ patientId: sid(pats[2]) })).status, 400, "A13 doctor is required");
  eq((await walkIn({ patientId: sid(pats[2]), doctorId: "123" })).status, 400, "A14 a malformed doctor id is a 400");
  eq((await walkIn({ doctorId: sid(docA) })).status, 400, "A15 patient is required");
  eq((await http("POST", "/appointments", { token: tkRec, body: { source: "public", patientId: sid(pats[2]), doctorId: sid(docA) } })).status, 400, "A16 source 'public' can never be set through this endpoint");

  /* ================= B. coexistence with scheduled appointments ================= */
  // a scheduled 10:30–11:30 appointment is already running when the walk-in arrives (inserted directly: it is "in the past" for the API)
  const running = await Appointment.create({ clinicId: A._id, doctorId: docA._id, patientId: pats[3]._id, startAt: at(D, "10:30"), duration: 60, status: "confirmed" });
  const sch11 = await http("POST", "/appointments", { token: tkRec, body: { patientId: sid(pats[4]), doctorId: sid(docA), startAt: at(D, "12:00").toISOString(), duration: 30 } });
  eq(sch11.status, 201, "B1 a normal scheduled appointment can still be created");
  const w2 = await walkIn({ patientId: sid(pats[5]), doctorId: sid(docA) });
  eq(w2.status, 201, "B2 a walk-in is accepted for a doctor who is already inside a scheduled appointment (not SLOT_TAKEN)");
  const w3 = await walkIn({ patientId: sid(pats[6]), doctorId: sid(docA) });
  eq(w3.status, 201, "B3 several walk-ins near the same time coexist");
  const wB = await walkIn({ patientId: sid(pats[7]), doctorId: sid(docB) });
  eq(wB.status, 201, "B4 a walk-in for another doctor");
  const L = (await day()).json;
  const ids = L.map((a) => a._id);
  ok([W1._id, w1b.json._id, w2.json._id, w3.json._id, wB.json._id, sid(running), sch11.json._id].every((i) => ids.includes(i)), "B5 the day lists walk-ins AND scheduled appointments together, none replaced");
  eq(new Set(ids).size, ids.length, "B6 no duplicates in the day list");
  const wl = L.filter((a) => a.source === "walk_in").map((a) => +new Date(a.startAt));
  ok(wl.every((v, i) => i === 0 || wl[i - 1] <= v), "B7 ordered by real check-in time");
  eq(new Set(L.filter((a) => a.source === "walk_in").map((a) => a.startAt)).size, 5, "B8 every walk-in keeps its own exact instant");
  eq((await day(D, tkRec, "&source=walk_in")).json.length, 5, "B9 ?source=walk_in returns exactly the walk-ins");
  eq((await day(D, tkRec, "&source=dashboard")).json.filter((a) => a.source === "walk_in").length, 0, "B10 ?source=dashboard never contains a walk-in");

  /* ================= C. a walk-in never blocks online booking ================= */
  // docB has ONLY a walk-in (10:37). Every later slot must still be offered publicly.
  const sB = (await slots(docB)).json.slots;
  ok(sB.includes("11:00") && sB.includes("11:30") && sB.includes("12:00"), "C1 public slots after a walk-in are all still offered", sB);
  ok(!sB.includes("10:30") && !sB.includes("10:00"), "C2 (slots already in the past are not offered — unchanged)", sB);
  const sA = (await slots(docA)).json.slots;
  ok(sA.includes("11:30") && !sA.includes("11:00") && !sA.includes("12:00"), "C3 docA: only REAL appointments block (10:30–11:30 running, 12:00 booked); the 3 walk-ins block nothing", sA);
  const pub = (doc, time, ph) => http("POST", "/public/clinics/wi-a/book", { body: { doctorId: sid(doc), startAt: at(D, time).toISOString(), fullName: "Online Person", phone: ph } });
  eq((await pub(docB, "11:00", "0795551101")).status, 201, "C4 public booking at 11:00 succeeds right after a walk-in at 10:37");
  eq((await pub(docB, "11:30", "0795551102")).status, 201, "C5 …and 11:30");
  eq((await pub(docA, "12:00", "0795551103")).status, 409, "C6 public booking still refuses a legitimately booked slot (dashboard appointment 12:00)");
  eq((await pub(docA, "11:00", "0795551104")).status, 409, "C7 …and a slot inside a longer running appointment");
  const blk = await http("POST", "/appointments/block", { token: tkOwner, body: { doctorId: sid(docB), startAt: at(D, "14:00").toISOString(), duration: 30, note: "meeting" } });
  eq(blk.status, 201, "C8 a block can still be created");
  ok(!(await slots(docB)).json.slots.includes("14:00"), "C9 a block still removes the slot from public availability");
  eq((await pub(docB, "14:00", "0795551105")).status, 409, "C10 …and public booking of a blocked slot is refused");
  eq((await http("POST", "/appointments", { token: tkRec, body: { patientId: sid(pats[0]), doctorId: sid(docB), startAt: at(D, "11:00").toISOString(), duration: 30 } })).status, 409, "C11 dashboard booking over a real appointment is still refused");
  // completed / cancelled walk-in: still nothing
  await patch(wB.json._id, { status: "completed" });
  ok((await slots(docB)).json.slots.includes("12:00"), "C12 a completed walk-in still blocks nothing");

  /* ================= D. doctor assignment / status / edits ================= */
  const assign = await patch(W1._id, { doctorId: sid(docB) });
  eq([assign.status, assign.json && assign.json.doctorId], [200, sid(docB)], "D1 a walk-in can be (re)assigned to a doctor after it was registered (this used to fail with PAST_TIME)");
  eq((await Appointment.findById(W1._id).lean()).doctorId.toString(), sid(docB), "D2 the doctor relationship is persisted as a user reference");
  eq((await patch(W1._id, { doctorId: sid(docOfB) })).status, 404, "D3 a doctor of another clinic cannot be assigned");
  eq(new Date((await Appointment.findById(W1._id).lean()).startAt).getTime(), ci.getTime(), "D4 reassigning never changes the check-in time");
  eq((await patch(W1._id, { status: "cancelled", cancelReason: "left" })).json.status, "cancelled", "D5 cancel works");
  eq((await patch(W1._id, { status: "scheduled" })).status, 200, "D6 …and a cancelled walk-in can be reactivated (used to be PAST_TIME)");
  eq((await patch(W1._id, { status: "completed", visitNote: "done" })).json.status, "completed", "D7 complete works (loyalty/other hooks run as for any visit)");
  const moveBack = await patch(w2.json._id, { startAt: at(D, "09:00").toISOString() });
  eq([moveBack.status, moveBack.json && moveBack.json.code], [400, "PAST_TIME"], "D8 actually MOVING a walk-in into the past still goes through the normal scheduling rules");
  // normal appointments are unaffected
  const mv = await patch(sch11.json._id, { startAt: at(D, "15:00").toISOString() });
  eq(mv.status, 200, "D9 rescheduling a normal appointment still works");
  const mv2 = await patch(mv.json._id, { startAt: at(D, "11:00").toISOString() }); // inside docA's running 10:30–11:30 appointment
  eq([mv2.status, mv2.json && mv2.json.code], [409, "SLOT_TAKEN"], "D10 …and still refuses an overlap with a real appointment");
  const pastAppt = await Appointment.create({ clinicId: A._id, doctorId: docA._id, patientId: pats[0]._id, startAt: at(D, "09:00"), duration: 30, status: "cancelled" });
  const react = await patch(pastAppt._id, { status: "scheduled" });
  eq([react.status, react.json && react.json.code], [400, "PAST_TIME"], "D11 reactivating a NON-walk-in in the past is still refused (rule not loosened for normal appointments)");
  eq((await patch(sch11.json._id, { status: "cancelled" })).json.status, "cancelled", "D12 cancellation of a normal appointment works");

  /* ================= E. double-click / idempotency ================= */
  const rid = "req" + Date.now().toString(36) + "aaaa";
  const e1 = await walkIn({ patientId: sid(pats[0]), doctorId: sid(docA), requestId: rid });
  const e2 = await walkIn({ patientId: sid(pats[0]), doctorId: sid(docA), requestId: rid });
  eq([e1.status, e2.status], [201, 200], "E1 the second submit of the same dialog is recognised (200, not 201)");
  eq(e2.json._id, e1.json._id, "E2 …and returns the SAME record");
  eq(await count({ requestKey: { $exists: true }, patientId: pats[0]._id, doctorId: docA._id }), 1, "E3 exactly one record exists");
  const rid2 = "race" + Date.now().toString(36) + "bbbb";
  const burst = await Promise.all(Array.from({ length: 8 }, () => walkIn({ patientId: sid(pats[1]), doctorId: sid(docB), requestId: rid2 })));
  ok(burst.every((r) => r.status === 200 || r.status === 201), "E4 an 8-way parallel burst never errors", burst.map((r) => r.status));
  t.dbLimit(new Set(burst.map((r) => r.json && r.json._id)).size === 1, "E5 …and resolves to ONE record (atomic unique key)", burst.map((r) => r.status));
  t.dbLimit((await count({ requestKey: new RegExp(rid2 + "$") })) === 1, "E6 only one row stored for the burst");
  // no token (older client): same patient+doctor within seconds is the same click
  const n1 = await walkIn({ patientId: sid(pats[2]), doctorId: sid(docA) });
  const n2 = await walkIn({ patientId: sid(pats[2]), doctorId: sid(docA) });
  eq([n1.status, n2.status, n2.json._id === n1.json._id], [201, 200, true], "E7 without a token, an immediate repeat is de-duplicated");
  const n3 = await walkIn({ patientId: sid(pats[2]), doctorId: sid(docB) });
  eq(n3.status, 201, "E8 same patient, DIFFERENT doctor is a different visit");
  await Appointment.collection.updateOne({ _id: new t.mongoose.Types.ObjectId(n1.json._id) }, { $set: { createdAt: new Date(Date.now() - 60000) } }); // raw driver: mongoose treats createdAt as immutable
  const n4 = await walkIn({ patientId: sid(pats[2]), doctorId: sid(docA) });
  eq(n4.status, 201, "E9 a genuine repeat visit later is NOT blocked (no global uniqueness rule)");
  eq((await walkIn({ patientId: sid(pats[2]), doctorId: sid(docA), requestId: "x" })).status, 400, "E10 a malformed request id is rejected");
  // the key is scoped by the authenticated clinic
  const bw = await walkIn({ patientId: sid(pOfB), doctorId: sid(docOfB), requestId: rid }, tkB);
  eq([bw.status, bw.json && bw.json.clinicId], [201, sid(B)], "E11 the same request id in another clinic is a separate walk-in of THAT clinic");

  /* ================= F. tenant isolation ================= */
  const asB = await day(D, tkB);
  ok(Array.isArray(asB.json) && asB.json.every((a) => a.clinicId === sid(B)), "F1 clinic B never sees clinic A's walk-ins", asB.json.length);
  eq((await patch(w2.json._id, { status: "completed" }, tkB)).status, 404, "F2 clinic B cannot update A's walk-in");
  eq((await walkIn({ patientId: sid(pats[0]), doctorId: sid(docOfB) }, tkB)).status, 404, "F3 B cannot register a walk-in for A's patient");
  eq((await walkIn({ patientId: sid(pOfB), doctorId: sid(docA) }, tkB)).status, 404, "F4 …or assign A's doctor");
  eq((await patch(bw.json._id, { doctorId: sid(docA) }, tkB)).status, 404, "F5 …or move its own walk-in to A's doctor");
  eq((await http("POST", "/appointments", { body: { source: "walk_in", patientId: sid(pats[0]), doctorId: sid(docA) } })).status, 401, "F6 unauthenticated is refused");
  eq((await day(D, tkB, "&source=walk_in")).json.every((a) => a.clinicId === sid(B)), true, "F7 ?source=walk_in is tenant-scoped");

  /* ================= G. patient file / clinical timeline (Phase 3) ================= */
  const tlOf = (p) => http("GET", `/patients/${sid(p)}/clinical-timeline?limit=60`, { token: tkRec });
  const tlP = (await tlOf(pats[5])).json.events;      // pats[5] has exactly one walk-in (w2)
  const visitEvents = tlP.filter((e) => e.kind === "visit");
  eq(visitEvents.length, 1, "G1 one walk-in visit appears ONCE in the patient's clinical timeline");
  eq([visitEvents[0].appointmentId, visitEvents[0].context.visitSource], [w2.json._id, "walk_in"], "G2 …as the appointment itself, flagged walk_in");
  eq(tlP.filter((e) => e.kind !== "visit").length, 0, "G3 no second 'walk-in event' of any other kind exists");
  const tlE = (await tlOf(pats[0])).json.events.filter((e) => e.kind === "visit" && e.context.visitSource === "walk_in");
  eq(tlE.length, new Set(tlE.map((e) => e.key)).size, "G4 a patient with several walk-ins has unique timeline keys");
  eq((await http("GET", `/patients/${sid(pOfB)}/clinical-timeline`, { token: tkRec })).status, 404, "G5 another clinic's patient timeline is not reachable");
  // the idempotent repeat of E1/E2 produced one timeline visit
  eq(tlE.filter((e) => e.appointmentId === e1.json._id).length, 1, "G6 a double-submitted walk-in shows once");

  /* ================= H. historical walk-in records stay compatible ================= */
  const legacy = await Appointment.create({ clinicId: A._id, doctorId: docA._id, patientId: pats[6]._id, startAt: at(tz.addDaysYmd(D, -3), "09:15"), duration: 30, status: "completed", source: "walk_in" });
  eq(await Appointment.findById(legacy._id).lean().then((x) => [x.createdBy, x.requestKey]), [undefined, undefined], "H1 an old walk-in has neither new field");
  const lday = await day(tz.addDaysYmd(D, -3));
  eq(lday.json.map((a) => a._id), [sid(legacy)], "H2 it lists on its day");
  eq((await patch(legacy._id, { visitNote: "late note" })).status, 200, "H3 it can still be edited");
  ok((await tlOf(pats[6])).json.events.some((e) => e.appointmentId === sid(legacy) && e.context.visitSource === "walk_in"), "H4 and appears in the patient timeline");

  t.noLeaks("no response leaked internals");
  // ---- keep the first server's results, then run the day-boundary scenario on a second server ----
  const first = { pass: t.pass, fail: t.fail, failures: t.failures.slice(), limits: t.limits.slice() };
  try { t.server.kill(); } catch {}
  await t.mongoose.disconnect(); // the harness holds ONE connection per process; the second server gets a fresh one

  /* ================= I. around midnight ================= */
  const T1 = at(D, "00:00"); T1.setTime(T1.getTime() + 24 * 3600e3 - 4000); // D 23:59:56
  const t2 = await boot({ name: "walk_in_midnight", port: 5304, env: { NODE_OPTIONS: `--require ${FAKE}`, FAKE_NOW: T1.toISOString() } });
  const wh24 = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, from: "00:00", to: "00:00" }));
  const C = await t2.mkClinic("wi-c", { plan: "pro", workingHours: wh24, slotDuration: 30 });
  const oc = await t2.mkUser(C, "owner"), dc = await t2.mkUser(C, "doctor"), pc1 = await t2.mkPatient(C, "Night 1"), pc2 = await t2.mkPatient(C, "Night 2");
  const tk = t2.tok(oc);
  const mk = (p) => t2.http("POST", "/appointments", { token: tk, body: { source: "walk_in", patientId: sid(p), doctorId: sid(dc), requestId: "mid" + sid(p) } });
  const m1 = await mk(pc1);
  await sleep(6000);
  const m2 = await mk(pc2);
  eq([m1.status, m2.status], [201, 201], "I1 walk-ins are accepted just before and just after midnight");
  eq([tz.clinicYmdOf(new Date(m1.json.startAt), AMMAN), tz.clinicYmdOf(new Date(m2.json.startAt), AMMAN)], [D, tz.addDaysYmd(D, 1)], "I2 they fall on different clinic-local days");
  const l1 = (await t2.http("GET", `/appointments?date=${D}`, { token: tk })).json.map((a) => a._id);
  const l2 = (await t2.http("GET", `/appointments?date=${tz.addDaysYmd(D, 1)}`, { token: tk })).json.map((a) => a._id);
  eq([l1, l2], [[m1.json._id], [m2.json._id]], "I3 each lists under its own day (23:59 stays on D, 00:00:0x moves to D+1)");
  ok(hhmm(m2.json.startAt) === "00:00", "I4 the post-midnight walk-in's clinic time is 00:0x", hhmm(m2.json.startAt));
  t2.noLeaks("no leaks in the midnight run");

  // ---- merge both runs into one result ----
  t2.pass += first.pass; t2.fail += first.fail; t2.failures.unshift(...first.failures); t2.limits.unshift(...first.limits);
  await t2.finish("Walk-in workflow — creation, board data, availability, assignment, idempotency, isolation, timeline, midnight");
})().catch((e) => { console.error(e); process.exit(1); });
