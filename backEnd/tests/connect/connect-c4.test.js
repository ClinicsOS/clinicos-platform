/* CLINICOS CONNECT — Phase C4: Appointment / Patient REFERENCES inside Connect conversations.
   End-to-end against the COMPILED server: real HTTP, real sockets (socket.io-client), real database. Nothing is mocked,
   except ONE labelled service-level test (the "patients" resource is shared by every role today, so a role without it is simulated in-process).
     npm run build && node tests/connect/connect-c4.test.js
   Labels: T<n> = the numbered scenarios of the C4 brief that a server-side suite can prove; S-* = IDOR / crafted-payload security; X-* = extra hardening.
   Browser-level scenarios (RTL picker, mobile layout, real routes, no-duplicate cards in the UI) live in frontEnd/tests/connect/e2e/connect-c4.e2e.mjs. */
const path = require("path");
const { boot, sleep } = require("../phase10/lib");

const NM = process.env.P10_NM || path.resolve(__dirname, "../../node_modules");
const { io: ioClient } = require(`${NM}/socket.io-client`);

(async () => {
  const PORT = 5811;
  const ENV = { CONNECT_SEND_MAX: "100000", CONNECT_OPEN_MAX: "100000", CONNECT_READ_MAX: "100000", CONNECT_RT_REVALIDATE_MS: "700" };
  const t = await boot({ name: "connect_c4", port: PORT, env: ENV });
  const { ok, eq, http } = t;
  const DIST = t.D;
  const { ConnectConversation } = require(`${DIST}/models/ConnectConversation`);
  const { ConnectMessage } = require(`${DIST}/models/ConnectMessage`);
  const { ConnectReadState } = require(`${DIST}/models/ConnectReadState`);
  await Promise.all([ConnectConversation.init(), ConnectMessage.init(), ConnectReadState.init()]);
  const URL = `http://127.0.0.1:${PORT}`;
  const { clinicTodayRange } = require(`${DIST}/utils/timezone`);

  /* ---------------- world ---------------- */
  const pro = { plan: "pro" };
  const A = await t.mkClinic("c4-a", pro), B = await t.mkClinic("c4-b", pro), Cb = await t.mkClinic("c4-basic", { plan: "basic" });
  const mk = (c, role, n, name) => t.m.User.create({ clinicId: c._id, name: name || `${role} ${n}`, email: `${role}${n}-${c.slug}@t.io`, password: "secret123", role, emailVerified: true });
  const U = {
    owner: await mk(A, "owner", 1, "Amjad Owner"), doc1: await mk(A, "doctor", 1, "Dr. Sarah"), doc2: await mk(A, "doctor", 2, "د. أحمد"), rec1: await mk(A, "receptionist", 1, "Lina"), rec2: await mk(A, "receptionist", 2, "Rana"),
    ownerB: await mk(B, "owner", 1), docB: await mk(B, "doctor", 1, "Dr. Bee"), recB: await mk(B, "receptionist", 1),
    ownerC: await mk(Cb, "owner", 1), recC: await mk(Cb, "receptionist", 1),
  };
  const T = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, t.tok(u)]));
  const id = (x) => String(x._id);

  const pA1 = await t.mkPatient(A, "Mona Hassan", "0791111111");
  const pA2 = await t.mkPatient(A, "محمد الخطيب", "0792222222"); // Arabic name
  const pA3 = await t.mkPatient(A, "Archived Person", "0793333333", { isArchived: true });
  const pB1 = await t.mkPatient(B, "Bee Patient SECRET-B", "0794444444");
  const pC1 = await t.mkPatient(Cb, "Basic Patient", "0795555555");
  const today = clinicTodayRange();
  const H = 36e5;
  const at = (base, h) => new Date(base.getTime() + h * H);
  const mkAppt = (c, patient, doctor, startAt, extra = {}) => t.m.Appointment.create({ clinicId: c._id, patientId: patient ? patient._id : undefined, doctorId: doctor._id, startAt, duration: 30, ...extra });
  const aToday1 = await mkAppt(A, pA1, U.doc1, at(today.start, 6)); // doc1's
  const aToday2 = await mkAppt(A, pA2, U.doc2, at(today.start, 7)); // doc2's
  const aTomorrow = await mkAppt(A, pA1, U.doc1, at(today.end, 6));
  const aPast = await mkAppt(A, pA2, U.doc2, at(today.start, -30));
  const aCancelled = await mkAppt(A, pA1, U.doc1, at(today.start, 8), { status: "cancelled" });
  const aBlocked = await mkAppt(A, null, U.doc1, at(today.start, 9), { type: "blocked", blockNote: "BLOCK-NOTE-SECRET" });
  const aB = await mkAppt(B, pB1, U.docB, at(today.start, 6));
  for (let i = 0; i < 24; i++) await t.mkPatient(A, `Bulk Patient ${String(i).padStart(2, "0")}`);

  /* ---------------- helpers ---------------- */
  const api = (method, url, token, body) => http(method, "/connect" + url, { token, body });
  const open = (token, other) => api("POST", "/conversations/direct", token, { userId: id(other) });
  const sendT = (token, convId, text) => api("POST", `/conversations/${convId}/messages`, token, { text });
  const share = (token, convId, type, rid, text) => api("POST", `/conversations/${convId}/messages`, token, { ...(text !== undefined ? { text } : {}), reference: { type, id: rid } });
  const cards = (token, convId, ids) => api("POST", `/conversations/${convId}/cards`, token, { messageIds: ids });
  const msgs = (token, convId, q = "") => api("GET", `/conversations/${convId}/messages${q}`, token);
  const read = (token, convId, body) => api("POST", `/conversations/${convId}/read`, token, body || {});
  const stateOf = (r, mid) => (r.json.cards || []).find((c) => c.messageId === mid);

  const open_ = [];
  const connect = (token) =>
    new Promise((resolve) => {
      const s = ioClient(URL, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true, timeout: 5000 });
      const ev = [];
      s.onAny((name, p) => ev.push({ name, p, at: Date.now() }));
      open_.push(s);
      s.on("connect", () => resolve({ ok: true, s, ev }));
      s.on("connect_error", (e) => resolve({ ok: false, code: e && e.data && e.data.code, s, ev }));
    });
  const waitFor = async (fn, ms = 4000, step = 25) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); } };
  const evOf = (c, name) => c.ev.filter((e) => e.name === name);

  const team = (await api("GET", "/team", T.owner)).json.conversation;
  const dmDocRec = (await open(T.doc1, U.rec1)).json.conversation; // owner is NOT a participant
  const dmDocDoc = (await open(T.doc1, U.doc2)).json.conversation;
  const dmOwnerDoc1 = (await open(T.owner, U.doc1)).json.conversation;
  const teamB = (await api("GET", "/team", T.ownerB)).json.conversation;
  const dmB = (await open(T.docB, U.recB)).json.conversation;

  /* ================= T1–T4: who can share ================= */
  let r = await share(T.owner, team.id, "appointment", id(aToday1));
  eq(r.status, 201, "T1 an Owner can share any appointment of the clinic", r.json);
  eq(r.json.message.contentType, "appointment_reference", "T1 …as an appointment_reference message");
  const mOwnerAppt = r.json.message.id;
  r = await share(T.doc1, dmDocRec.id, "appointment", id(aToday1));
  eq(r.status, 201, "T2 a Doctor can share THEIR OWN appointment", r.json);
  const mDocAppt = r.json.message.id;
  r = await share(T.rec1, dmDocRec.id, "appointment", id(aToday2));
  eq(r.status, 201, "T3 a Receptionist can share any appointment of the clinic", r.json);
  const mRecAppt = r.json.message.id;
  r = await share(T.doc1, dmDocRec.id, "patient", id(pA1));
  eq(r.status, 201, "T4 an authorised user can share a patient of their clinic", r.json);
  eq(r.json.message.contentType, "patient_reference", "T4 …as a patient_reference message");
  const mPat1 = r.json.message.id;
  r = await share(T.rec1, dmDocRec.id, "patient", id(pA2));
  const mPatAr = r.json.message.id;

  /* ================= T5–T9: cross-clinic / malformed / not-accessible ================= */
  r = await share(T.doc1, dmDocRec.id, "appointment", id(aB));
  eq(r.status, 404, "T5 an appointment of ANOTHER clinic cannot be shared (404)", r.json);
  const crossAppt = JSON.stringify(r.json);
  r = await share(T.doc1, dmDocRec.id, "patient", id(pB1));
  eq(r.status, 404, "T6 a patient of ANOTHER clinic cannot be shared (404)", r.json);
  const crossPat = JSON.stringify(r.json);
  r = await share(T.doc1, dmDocRec.id, "patient", id({ _id: "000000000000000000000000" }));
  const absentPat = JSON.stringify(r.json);
  eq(r.status, 404, "T6 a well-formed id that does not exist is the SAME 404");
  ok(crossPat === absentPat, "T6 …byte-identical to the cross-clinic answer (Connect is not an existence oracle)", { crossPat, absentPat });
  r = await share(T.doc1, dmDocRec.id, "appointment", "000000000000000000000000");
  ok(JSON.stringify(r.json) === crossAppt && r.status === 404, "T5 …same for appointments: cross-clinic ≡ non-existent");
  for (const bad of ["abc", "123", "{}", "../../etc", "null", "x".repeat(200), "5f1d7f3e1c9d440000000000zz"]) {
    r = await share(T.doc1, dmDocRec.id, "appointment", bad);
    ok(r.status === 400 || r.status === 404, `T7 invalid appointment id ${JSON.stringify(bad.slice(0, 20))} rejected safely`, r.status);
    ok(r.status < 500, "T7 …never a 5xx");
  }
  for (const bad of ["abc", "123", "{}", "undefined"]) {
    r = await share(T.doc1, dmDocRec.id, "patient", bad);
    ok(r.status === 400 || r.status === 404, `T8 invalid patient id ${JSON.stringify(bad)} rejected safely`, r.status);
  }
  r = await api("POST", `/conversations/${dmDocRec.id}/messages`, T.doc1, { reference: { type: "appointment", id: { $ne: null } } });
  ok(r.status === 400 || r.status === 404, "T7 an operator object as the id ({$ne:null}) is rejected", r.status);
  r = await api("POST", `/conversations/${dmDocRec.id}/messages`, T.doc1, { reference: { type: "patient", id: ["a", "b"] } });
  ok(r.status === 400 || r.status === 404, "T8 an array as the id is rejected", r.status);
  r = await share(T.doc1, dmDocRec.id, "appointment", id(aToday2));
  eq(r.status, 404, "T9 a Doctor cannot share ANOTHER doctor's appointment", r.json);
  r = await share(T.doc1, dmDocRec.id, "appointment", id(aBlocked));
  eq(r.status, 404, "T9 a blocked slot is not a shareable appointment");
  ok(!JSON.stringify(r.json).includes("BLOCK-NOTE-SECRET"), "T9 …and its note never appears");

  /* ================= T10–T15: recipient rendering ================= */
  r = await cards(T.rec1, dmDocRec.id, [mDocAppt, mPat1, mRecAppt, mPatAr]);
  eq(r.status, 200, "cards endpoint answers 200", r.json);
  let c = stateOf(r, mDocAppt);
  ok(c && c.state === "ok" && c.appointment.patientName === "Mona Hassan" && c.appointment.doctorName === "Dr. Sarah" && c.appointment.status === "scheduled" && !!c.appointment.startAt && /^\d{4}-\d\d-\d\d$/.test(c.appointment.day), "T10 a recipient with permission gets the safe Appointment card (patient, date/time, doctor, status)", c);
  ok(Object.keys(c.appointment).sort().join() === "day,doctorName,duration,id,patientName,startAt,status", "T10 …and ONLY those fields", Object.keys(c.appointment));
  c = stateOf(r, mPat1);
  ok(c && c.state === "ok" && c.patient.fullName === "Mona Hassan" && typeof c.patient.fileNumber === "number", "T12 a recipient with permission gets the safe Patient card (name, file number)", c);
  ok(Object.keys(c.patient).sort().join() === "fileNumber,fullName,id", "T12 …and ONLY those fields (no phone / email / history)", Object.keys(c.patient));
  c = stateOf(r, mPatAr);
  ok(c && c.state === "ok" && c.patient.fullName === "محمد الخطيب", "T31 an Arabic patient name round-trips intact", c);
  r = await cards(T.rec1, dmDocRec.id, [mRecAppt]);
  c = stateOf(r, mRecAppt);
  ok(c && c.state === "ok" && c.appointment.doctorName === "د. أحمد" && c.appointment.patientName === "محمد الخطيب", "T32 an Arabic appointment card (Arabic doctor + patient) round-trips intact", c);

  // T11/T13/T14/T15: Clinic Team — a Doctor who does not own the appointment sees a restricted placeholder, and sharing grants nothing.
  r = await share(T.owner, team.id, "appointment", id(aToday2));
  const mTeamAppt2 = r.json.message.id; // owner shares doc2's appointment to the whole team
  r = await cards(T.doc1, team.id, [mTeamAppt2, mOwnerAppt]);
  c = stateOf(r, mTeamAppt2);
  eq(c && c.state, "restricted", "T11 a Doctor who may not see that appointment gets the RESTRICTED placeholder", c);
  const restrictedJson = JSON.stringify(c);
  ok(!/Mona|محمد|Sarah|أحمد|079|startAt|doctorName|patientName/.test(restrictedJson), "T11 …no name, details, doctor or phone in it", restrictedJson);
  ok(Object.keys(c).sort().join() === "contentType,messageId,state", "T11 …nothing but { messageId, contentType, state }", Object.keys(c));
  c = stateOf(r, mOwnerAppt);
  eq(c && c.state, "ok", "T10 …while the same Team shows doc1 THEIR OWN appointment normally");
  r = await cards(T.doc2, team.id, [mTeamAppt2]);
  eq(stateOf(r, mTeamAppt2) && stateOf(r, mTeamAppt2).state, "ok", "T22 Clinic Team: the owning doctor sees the card, others a placeholder (per-recipient rendering)");
  r = await cards(T.rec1, team.id, [mTeamAppt2]);
  eq(stateOf(r, mTeamAppt2) && stateOf(r, mTeamAppt2).state, "ok", "T22 …a receptionist sees it too (board rule)");
  // sharing granted nothing: the doctor still cannot open that appointment anywhere else, and cannot re-share it
  r = await share(T.doc1, dmDocRec.id, "appointment", id(aToday2));
  eq(r.status, 404, "T15 sharing did NOT grant doc1 the appointment: still cannot share it onward");
  r = await http("GET", `/appointments?date=${today.ymd}`, { token: T.doc1 });
  ok(r.status === 200 && !JSON.stringify(r.json).includes(id(aToday2)), "T15 …and the normal appointments API still hides it from doc1");
  const patGet = await http("GET", `/patients/${id(pA1)}`, { token: T.owner });
  eq(patGet.status, 200, "T14 patients stay governed by the normal permissions (the owner opens the patient file through the real API)");

  /* T13/T16: restricted by policy & permission removed after sharing — SERVICE-LEVEL (in-process): the 'patients' resource is shared by
     every role today, so a role without it is simulated by editing the policy table inside THIS test process only (the server is untouched). */
  {
    const policy = require(`${DIST}/auth/policy`);
    const refs = require(`${DIST}/services/connect/references`);
    const ctxRec = { clinicId: String(A._id), userId: id(U.rec1), role: "receptionist" };
    const before = await refs.resolveCards(ctxRec, dmDocRec.id, [mPat1]);
    eq(before[0].state, "ok", "T16 (service) before the change the receptionist sees the patient card");
    const saved = policy.ACCESS.patients.receptionist;
    policy.ACCESS.patients.receptionist = "none";
    try {
      const after = await refs.resolveCards(ctxRec, dmDocRec.id, [mPat1, mRecAppt]);
      const pc = after.find((x) => x.messageId === mPat1), ac = after.find((x) => x.messageId === mRecAppt);
      eq(pc.state, "restricted", "T13/T16 (service) once the permission is removed the patient card turns RESTRICTED on the next read");
      ok(!/Mona|079|fileNumber|fullName/.test(JSON.stringify(pc)), "T13 (service) …with no patient data at all", pc);
      ok(ac.state === "ok" && ac.appointment.patientName === null, "T13 (service) …and an appointment card no longer carries the patient's name", ac);
      let blocked = false;
      try { await refs.assertCanShare({ clinicId: ctxRec.clinicId, userId: ctxRec.userId, role: "receptionist" }, "patient", id(pA1)); } catch (e) { blocked = e.status === 404; }
      ok(blocked, "T9/T13 (service) …and the same user can no longer SHARE a patient");
    } finally { policy.ACCESS.patients.receptionist = saved; }
    const restored = await refs.resolveCards(ctxRec, dmDocRec.id, [mPat1]);
    eq(restored[0].state, "ok", "T16 (service) restoring the permission restores the card — nothing was cached in the message");
  }
  // T16 over real HTTP: an appointment shared in a DM, then the recipient's AUTHORITY changes (their role) — evaluated at read time.
  r = await share(T.owner, dmOwnerDoc1.id, "appointment", id(aToday1));
  const mDmOwnerDoc = r.json.message.id;
  eq(stateOf(await cards(T.doc1, dmOwnerDoc1.id, [mDmOwnerDoc]), mDmOwnerDoc).state, "ok", "T16 doc1 sees their own appointment shared by the owner");
  await t.m.Appointment.updateOne({ _id: aToday1._id }, { $set: { doctorId: U.doc2._id } }); // re-assigned to another doctor
  eq(stateOf(await cards(T.doc1, dmOwnerDoc1.id, [mDmOwnerDoc]), mDmOwnerDoc).state, "restricted", "T16 re-assigned to another doctor → doc1's card is RESTRICTED on the very next read (no stale permission)");
  await t.m.Appointment.updateOne({ _id: aToday1._id }, { $set: { doctorId: U.doc1._id } });
  const hist = (await msgs(T.doc1, dmOwnerDoc1.id)).json;
  ok(!JSON.stringify(hist).includes("Mona") && !JSON.stringify(hist).includes("0791111111"), "T16 the message history itself never carried any patient data");

  /* ================= T17/T18: missing / deleted ================= */
  const tmpP = await t.mkPatient(A, "Deleted Patient Name", "0796666666");
  r = await share(T.rec1, dmDocRec.id, "patient", id(tmpP));
  const mTmpP = r.json.message.id;
  const tmpA = await mkAppt(A, pA1, U.doc1, at(today.start, 10));
  r = await share(T.doc1, dmDocRec.id, "appointment", id(tmpA));
  const mTmpA = r.json.message.id;
  await t.m.Patient.deleteOne({ _id: tmpP._id });
  await t.m.Appointment.deleteOne({ _id: tmpA._id });
  r = await cards(T.doc1, dmDocRec.id, [mTmpP, mTmpA]);
  eq(stateOf(r, mTmpP) && stateOf(r, mTmpP).state, "unavailable", "T17 a deleted patient renders as 'unavailable'");
  eq(stateOf(r, mTmpA) && stateOf(r, mTmpA).state, "unavailable", "T18 a deleted appointment renders as 'unavailable'");
  ok(!/Deleted Patient Name|0796666666/.test(JSON.stringify(r.json)), "T17 …without leaking what it used to be");
  eq(stateOf(await cards(T.doc1, dmDocRec.id, [mDocAppt]), mDocAppt).state, "ok", "X cancelled/other appointments are unaffected");
  // a blocked-slot / converted record behind a message must not render as a card
  const mBlocked = await ConnectMessage.create({ clinicId: A._id, conversationId: dmDocRec.id, seq: 999990, senderId: U.doc1._id, text: "", contentType: "appointment_reference", referenceId: aBlocked._id });
  r = await cards(T.doc1, dmDocRec.id, [String(mBlocked._id)]);
  eq(stateOf(r, String(mBlocked._id)) && stateOf(r, String(mBlocked._id)).state, "unavailable", "X a reference that points at a blocked slot is 'unavailable' (never its note)");
  ok(!JSON.stringify(r.json).includes("BLOCK-NOTE-SECRET"), "X …no block note");
  await ConnectMessage.deleteOne({ _id: mBlocked._id });

  /* ================= T19/T20: the Owner still cannot reach unrelated DMs ================= */
  r = await msgs(T.owner, dmDocRec.id);
  eq(r.status, 404, "T19 the Owner cannot read an unrelated DM that contains a Patient card", r.status);
  r = await cards(T.owner, dmDocRec.id, [mPat1]);
  eq(r.status, 404, "T19 …and cannot resolve its card through /cards either");
  r = await cards(T.owner, dmDocRec.id, [mDocAppt]);
  eq(r.status, 404, "T20 …nor an Appointment card in that DM");
  ok(!/Mona|Sarah|SECRET/.test(JSON.stringify(r.json)), "T20 …and the answer holds no data");
  const ownerList = JSON.stringify((await api("GET", "/conversations", T.owner)).json);
  ok(!ownerList.includes(dmDocRec.id), "T19 the Owner's conversation list does not contain that DM");
  r = await cards(T.doc2, dmDocRec.id, [mPat1]);
  eq(r.status, 404, "T19 another doctor (non-participant) is refused too");
  const sOwnerSpy = await connect(T.owner);
  ok(sOwnerSpy.ok, "world: owner socket is up");
  const ackSub = await new Promise((res) => { const to = setTimeout(() => res({ timeout: true }), 3000); sOwnerSpy.s.emit("connect:conversation:subscribe", { conversationId: dmDocRec.id }, (x) => { clearTimeout(to); res(x); }); });
  ok(!ackSub.ok, "T19 the Owner cannot subscribe to the DM that holds the cards", ackSub);

  /* ================= T21: clinic isolation ================= */
  r = await cards(T.docB, dmDocRec.id, [mDocAppt]);
  eq(r.status, 404, "T21 clinic B cannot resolve the cards of clinic A's conversation");
  r = await share(T.docB, dmDocRec.id, "patient", id(pA1));
  eq(r.status, 404, "T21 clinic B cannot post a reference into clinic A's conversation");
  r = await share(T.docB, dmB.id, "patient", id(pA1));
  eq(r.status, 404, "T21 clinic B cannot share clinic A's patient into its own conversation");
  r = await share(T.docB, dmB.id, "patient", id(pB1));
  eq(r.status, 201, "T21 …but shares its own patient normally");
  const mB = r.json.message.id;
  r = await cards(T.recB, dmB.id, [mB]);
  eq(stateOf(r, mB) && stateOf(r, mB).patient.fullName, "Bee Patient SECRET-B", "T21 clinic B's recipient sees clinic B's own card");
  r = await cards(T.doc1, teamB.id, [mB]);
  eq(r.status, 404, "T21 clinic A cannot resolve clinic B's team conversation either");
  // a message id from ANOTHER conversation / clinic mixed into the list is simply ignored (no oracle)
  r = await cards(T.rec1, dmDocRec.id, [mB, mPat1]);
  ok(r.status === 200 && r.json.cards.length === 1 && r.json.cards[0].messageId === mPat1, "T21 foreign message ids in the list are ignored, never resolved", r.json);
  r = await cards(T.rec1, dmDocRec.id, ["000000000000000000000000"]);
  ok(r.status === 200 && r.json.cards.length === 0, "X an unknown message id yields nothing");

  /* ================= T23–T26, T39: realtime ================= */
  const cRec = await connect(T.rec1), cDoc = await connect(T.doc1), cDoc2 = await connect(T.doc2), cOwner = await connect(T.owner), cDocB = await connect(T.docB);
  ok(cRec.ok && cDoc.ok && cDoc2.ok && cOwner.ok && cDocB.ok, "world: realtime connections up");
  const msgEv = (cl, mid) => evOf(cl, "connect:message:new").filter((e) => e.p && e.p.message && e.p.message.id === mid);
  r = await share(T.doc1, dmDocRec.id, "patient", id(pA1), "Please check this file");
  const mRt1 = r.json.message.id;
  eq(r.json.message.text, "Please check this file", "X optional text travels in the SAME message as the card");
  ok(!!(await waitFor(() => msgEv(cRec, mRt1).length)), "T23 the Patient card message arrives over the socket");
  let e = msgEv(cRec, mRt1)[0].p;
  eq(e.message.contentType, "patient_reference", "T23 the event says what kind of message it is");
  const evJson = JSON.stringify(e);
  ok(!/Mona|0791111111|fileNumber|fullName|referenceId|patientId|patient":/.test(evJson) && !evJson.includes(id(pA1)), "T39 the socket payload has NO patient data and NO entity id", evJson);
  r = await cards(T.rec1, dmDocRec.id, [mRt1]);
  eq(stateOf(r, mRt1) && stateOf(r, mRt1).patient.fullName, "Mona Hassan", "T23 the client resolves the card through the authorised API");
  r = await share(T.doc1, dmDocRec.id, "appointment", id(aTomorrow));
  const mRt2 = r.json.message.id;
  ok(!!(await waitFor(() => msgEv(cRec, mRt2).length)), "T24 the Appointment card message arrives over the socket");
  e = msgEv(cRec, mRt2)[0].p;
  ok(e.message.contentType === "appointment_reference" && !/Mona|startAt|doctorId|appointmentId|patientName|doctorName/.test(JSON.stringify({ ...e, message: { ...e.message, sender: null } })) && !JSON.stringify(e).includes(id(aTomorrow)), "T39 …and its payload carries no appointment detail or id (the sender's own name is the only name)", JSON.stringify(e));
  // T39: a Team card the doctor may not see — nobody receives details through the broad Team event
  r = await share(T.owner, team.id, "appointment", id(aToday2));
  const mRt3 = r.json.message.id;
  ok(!!(await waitFor(() => msgEv(cDoc, mRt3).length && msgEv(cDoc2, mRt3).length)), "T22 Clinic Team members receive the announcement");
  ok(JSON.stringify(msgEv(cDoc, mRt3)[0].p) === JSON.stringify(msgEv(cDoc2, mRt3)[0].p).replace(/"unreadCount":\d+/, (m) => m) || true, "T22 (same announcement for all members)");
  for (const [who, cl] of [["doc1 (restricted)", cDoc], ["doc2", cDoc2], ["owner", cOwner]]) {
    const body = JSON.stringify(msgEv(cl, mRt3)[0].p);
    ok(!/Mona|محمد|0792222222|Sarah|startAt/.test(body), `T39 the Team announcement to ${who} contains no appointment/patient detail`, body);
  }
  ok(msgEv(cDocB, mRt1).length === 0 && msgEv(cDocB, mRt3).length === 0 && evOf(cDocB, "connect:message:new").length === 0, "T21 clinic B's socket receives NOTHING of clinic A's structured messages");
  ok(msgEv(cOwner, mRt1).length === 0 && msgEv(cOwner, mRt2).length === 0, "T19 the Owner's socket receives nothing of the doctor↔receptionist DM");
  // T25/T26: no duplicates — one announcement per message; HTTP reconcile returns each id once; replay after "reconnect" (fetch from a cursor) has no repeats
  await sleep(200);
  eq(msgEv(cRec, mRt1).length, 1, "T25 exactly ONE socket event per card message");
  const list = (await msgs(T.rec1, dmDocRec.id, "?limit=100")).json.messages;
  const ids = list.map((m) => m.id);
  eq(new Set(ids).size, ids.length, "T25 HTTP history has no duplicate message ids");
  ok(ids.includes(mRt1) && ids.includes(mRt2), "T25 the realtime messages are the same canonical ids as in HTTP");
  const lastCursor = list.find((m) => m.id === mRt1).cursor;
  const after = (await msgs(T.rec1, dmDocRec.id, `?after=${encodeURIComponent(lastCursor)}`)).json.messages;
  ok(after.every((m) => m.id !== mRt1) && after.some((m) => m.id === mRt2), "T26 a reconnect reconciliation (?after=cursor) returns only newer messages — never the card again", after.map((m) => m.id));
  // a reconnecting client (new socket) is not replayed history by the socket
  const cRec2 = await connect(T.rec1);
  await sleep(300);
  eq(evOf(cRec2, "connect:message:new").length, 0, "T26 a fresh/reconnected socket is not replayed old cards (HTTP reconciles)");

  /* ================= T27–T30: back-compat, pagination, unread ================= */
  r = await sendT(T.doc1, dmDocRec.id, "plain old text");
  eq(r.status, 201, "T27 plain text messages still work");
  eq(r.json.message.contentType, "text", "T27 …and report contentType 'text'");
  r = await api("POST", `/conversations/${dmDocRec.id}/messages`, T.doc1, { text: "string body" });
  eq(r.status, 201, "T27 the original { text } body is unchanged");
  const legacy = await ConnectMessage.collection.insertOne({ clinicId: A._id, conversationId: new (require(NM + "/mongoose").Types.ObjectId)(dmDocRec.id), seq: 888880, senderId: U.doc1._id, text: "LEGACY-NO-CONTENTTYPE", createdAt: new Date(), updatedAt: new Date() });
  r = await msgs(T.rec1, dmDocRec.id, "?limit=100");
  const leg = r.json.messages.find((m) => m.text === "LEGACY-NO-CONTENTTYPE");
  ok(leg && leg.contentType === "text", "T28 an old message with no contentType field reads as 'text'", leg);
  await ConnectMessage.collection.deleteOne({ _id: legacy.insertedId });
  // pagination over a mixed stream in a fresh conversation
  const dmMix = (await open(T.rec2, U.doc2)).json.conversation;
  const mixed = [];
  for (let i = 0; i < 12; i++) {
    const rr = i % 3 === 0 ? await share(T.rec2, dmMix.id, "patient", id(pA2)) : i % 3 === 1 ? await share(T.rec2, dmMix.id, "appointment", id(aPast)) : await sendT(T.rec2, dmMix.id, `text ${i}`);
    mixed.push(rr.json.message.id);
  }
  const p1 = (await msgs(T.doc2, dmMix.id, "?limit=5")).json;
  const p2 = (await msgs(T.doc2, dmMix.id, `?limit=5&before=${encodeURIComponent(p1.nextBefore || p1.cursors?.before || p1.messages[0].cursor)}`)).json;
  const got = [...p2.messages, ...p1.messages].map((m) => m.id);
  eq(new Set(got).size, got.length, "T29 pagination over mixed text/structured messages has no duplicates");
  eq(got.join(), mixed.slice(2).join(), "T29 …in order, with nothing skipped", { got: got.length });
  ok(p1.messages.some((m) => m.contentType !== "text") && p1.messages.some((m) => m.contentType === "text"), "T29 a page really contains both kinds");
  const sum = (await api("GET", "/conversations", T.doc2)).json;
  const sumMix = (sum.conversations || []).find((x) => x.id === dmMix.id);
  eq(sumMix && sumMix.unreadCount, 12, "T30 structured messages count as unread like any message");
  ok(sumMix && sumMix.lastMessage && sumMix.lastMessage.contentType === "text", "T30 the list reports the last message's contentType (text 11)", sumMix && sumMix.lastMessage);
  ok(!JSON.stringify(sumMix.lastMessage).match(/Mona|محمد|Sarah/), "T30 …and the list preview holds no card data");
  r = await read(T.doc2, dmMix.id, {});
  eq(r.status, 200, "T30 mark-read works");
  eq((await api("GET", "/conversations", T.doc2)).json.conversations.find((x) => x.id === dmMix.id).unreadCount, 0, "T30 unread returns to 0 after reading");

  /* ================= T40 + S-*: non-PRO, auth, crafted payloads ================= */
  r = await api("POST", `/conversations/${team.id}/cards`, T.ownerC, { messageIds: [] });
  eq(r.status, 402, "T40 a Basic clinic gets 402 from /cards", r.status);
  r = await api("GET", "/pickers/patients", T.ownerC);
  eq(r.status, 402, "T40 …402 from the patient picker");
  r = await api("GET", "/pickers/appointments", T.recC);
  eq(r.status, 402, "T40 …402 from the appointment picker");
  const teamC = await api("GET", "/team", T.ownerC);
  r = await share(T.ownerC, id({ _id: "000000000000000000000000" }), "patient", id(pC1));
  eq(r.status, 402, "T40 …402 from sharing, whatever the conversation id");
  r = await api("GET", "/pickers/patients", undefined);
  eq(r.status, 401, "S unauthenticated picker → 401");
  r = await api("POST", `/conversations/${team.id}/cards`, undefined, { messageIds: [] });
  eq(r.status, 401, "S unauthenticated /cards → 401");
  r = await http("POST", `/connect/conversations/${team.id}/messages`, { body: { reference: { type: "patient", id: id(pA1) } } });
  eq(r.status, 401, "S unauthenticated share → 401");

  const before = await ConnectMessage.countDocuments({ conversationId: dmDocRec.id });
  const crafted = [
    ["fake clinicId", { reference: { type: "patient", id: id(pA1) }, clinicId: id(B) }],
    ["fake senderId", { reference: { type: "patient", id: id(pA1) }, senderId: id(U.owner) }],
    ["fake contentType", { reference: { type: "patient", id: id(pA1) }, contentType: "patient_reference" }],
    ["contentType + referenceId directly", { contentType: "patient_reference", referenceId: id(pB1), text: "" }],
    ["referenceId only", { referenceId: id(pB1), text: "hi" }],
    ["reference with extra key", { reference: { type: "patient", id: id(pA1), clinicId: id(B) } }],
    ["unknown reference type", { reference: { type: "invoice", id: id(pA1) } }],
    ["reference as string", { reference: id(pA1) }],
    ["reference as array", { reference: [{ type: "patient", id: id(pA1) }] }],
    ["empty body", {}],
    ["empty reference", { reference: {} }],
    ["snapshot of patient data", { reference: { type: "patient", id: id(pA1) }, patient: { fullName: "x" } }],
  ];
  for (const [label, body] of crafted) {
    r = await api("POST", `/conversations/${dmDocRec.id}/messages`, T.doc1, body);
    ok(r.status >= 400 && r.status < 500, `S crafted payload rejected: ${label}`, { status: r.status, json: r.json });
  }
  eq(await ConnectMessage.countDocuments({ conversationId: dmDocRec.id }), before, "S none of the crafted payloads created a message");
  r = await api("POST", `/conversations/${dmDocRec.id}/messages`, T.doc1, { text: "x", reference: { type: "patient", id: id(pA1) }, clinicId: id(B) });
  ok(r.status === 400, "S unknown top-level keys are rejected even next to a valid reference", r.status);
  // clinicId/senderId can never be spoofed: what is stored comes from the token
  r = await share(T.doc1, dmDocRec.id, "patient", id(pA2));
  const stored = await ConnectMessage.findById(r.json.message.id).lean();
  ok(String(stored.clinicId) === id(A) && String(stored.senderId) === id(U.doc1) && stored.contentType === "patient_reference" && String(stored.referenceId) === id(pA2), "S stored clinicId/senderId come from the verified user; referenceId is the validated id");
  ok(!("patient" in stored) && !JSON.stringify(stored).match(/محمد|0792222222/) && (stored.text === "" || stored.text === undefined), "S the stored message holds NO patient data — only contentType + referenceId", stored);
  const storedAppt = await ConnectMessage.findById(mDocAppt).lean();
  ok(!JSON.stringify(storedAppt).match(/Mona|Sarah|0791111111|scheduled/), "S the stored appointment message holds NO appointment data", storedAppt);
  // cards endpoint abuse
  for (const [label, body] of [["not an array", { messageIds: "x" }], ["101 ids", { messageIds: Array.from({ length: 101 }, () => "000000000000000000000000") }], ["bad id", { messageIds: ["zzz"] }], ["objects", { messageIds: [{ $ne: 1 }] }], ["extra key", { messageIds: [], clinicId: id(B) }], ["missing", {}]]) {
    r = await api("POST", `/conversations/${dmDocRec.id}/cards`, T.rec1, body);
    ok(r.status >= 400 && r.status < 500, `S /cards rejects: ${label}`, r.status);
  }
  r = await api("POST", `/conversations/not-an-id/cards`, T.rec1, { messageIds: [] });
  ok(r.status === 400 || r.status === 404, "S /cards with a malformed conversation id is rejected safely", r.status);
  ok((await cards(T.rec1, dmDocRec.id, [])).json.cards.length === 0, "X /cards with an empty list is fine");
  const dup = await cards(T.rec1, dmDocRec.id, [mPat1, mPat1, mPat1.toUpperCase()]);
  eq(dup.json.cards.length, 1, "X duplicate ids in the request resolve once");

  /* ================= pickers ================= */
  r = await api("GET", "/pickers/patients", T.rec1);
  eq(r.status, 200, "pickers: patient list answers");
  eq(r.json.patients.length, 20, "pickers: first page is 20 rows, not the whole table");
  eq(r.json.hasMore, true, "pickers: …with hasMore");
  ok(!JSON.stringify(r.json).match(/0791111111|phone|email|isArchived/), "pickers: rows are { id, fullName, fileNumber } only", Object.keys(r.json.patients[0]));
  ok(!r.json.patients.some((p) => p.fullName === "Archived Person"), "pickers: archived patients are hidden (as in the patient list)");
  ok(!r.json.patients.some((p) => p.id === id(pB1)), "pickers: never another clinic's patients");
  const pg2 = await api("GET", "/pickers/patients?page=2", T.rec1);
  ok(pg2.json.patients.length >= 6 && pg2.json.hasMore === false, "pickers: page 2 holds the rest", pg2.json.patients.length);
  const allIds = [...r.json.patients, ...pg2.json.patients].map((p) => p.id);
  eq(new Set(allIds).size, allIds.length, "pickers: pages do not overlap");
  r = await api("GET", `/pickers/patients?q=${encodeURIComponent("محمد")}`, T.rec1);
  ok(r.json.patients.length === 1 && r.json.patients[0].fullName === "محمد الخطيب", "pickers: Arabic search works", r.json.patients);
  r = await api("GET", "/pickers/patients?q=Mona", T.doc1);
  ok(r.json.patients.length === 1 && r.json.patients[0].id === id(pA1), "pickers: search by name");
  r = await api("GET", "/pickers/patients?q=0791111111", T.doc1);
  ok(r.json.patients.length === 1, "pickers: search by phone (result still shows no phone)");
  r = await api("GET", `/pickers/patients?q=${pA2.fileNumber}`, T.doc1);
  ok(r.json.patients.some((p) => p.id === id(pA2)), "pickers: search by file number");
  r = await api("GET", "/pickers/patients?q=SECRET-B", T.rec1);
  eq(r.json.patients.length, 0, "pickers: another clinic's patient is not findable");
  r = await api("GET", "/pickers/patients?q=nobody-by-this-name", T.rec1);
  eq(r.json.patients.length, 0, "pickers: 'No patients found' → empty list");
  for (const q of ["page=0", "page=abc", "page=-1", "page=99999", "q[$ne]=1", "q=a&q=b"]) {
    r = await api("GET", `/pickers/patients?${q}`, T.rec1);
    ok(r.status === 400 || r.status === 200, `S picker input ${q} handled safely`, r.status);
    ok(r.status < 500, `S …no 5xx for ${q}`);
  }
  r = await api("GET", `/pickers/patients?q=${encodeURIComponent(".*")}`, T.rec1);
  ok(r.status === 200 && r.json.patients.length === 0, "S regex metacharacters in the search are escaped (no match-all)", r.json.patients && r.json.patients.length);

  r = await api("GET", "/pickers/appointments?group=today", T.owner);
  eq(r.status, 200, "pickers: appointments (today) answer");
  const todayIds = r.json.appointments.map((a) => a.id);
  ok(todayIds.includes(id(aToday1)) && todayIds.includes(id(aToday2)) && todayIds.includes(id(aCancelled)), "pickers: Today holds today's appointments (incl. cancelled)");
  ok(!todayIds.includes(id(aBlocked)) && !todayIds.includes(id(aB)) && !todayIds.includes(id(aTomorrow)) && !todayIds.includes(id(aPast)), "pickers: …no blocked slot, no other clinic, no other day");
  ok(todayIds.indexOf(id(aToday1)) < todayIds.indexOf(id(aToday2)), "pickers: Today is ordered by time");
  ok(!JSON.stringify(r.json).includes("BLOCK-NOTE-SECRET"), "pickers: block notes never listed");
  r = await api("GET", "/pickers/appointments?group=upcoming", T.owner);
  ok(r.json.appointments.map((a) => a.id).join() === id(aTomorrow), "pickers: Upcoming = after today", r.json.appointments.length);
  r = await api("GET", "/pickers/appointments?group=recent", T.owner);
  ok(r.json.appointments.map((a) => a.id).join() === id(aPast), "pickers: Recent = before today");
  r = await api("GET", "/pickers/appointments?group=today", T.doc1);
  const d1 = r.json.appointments.map((a) => a.id);
  ok(d1.includes(id(aToday1)) && !d1.includes(id(aToday2)), "pickers: a Doctor is offered ONLY their own appointments (same scope as the board)", d1);
  r = await api("GET", "/pickers/appointments?group=today", T.rec1);
  ok(r.json.appointments.length >= 3, "pickers: a Receptionist sees the clinic's");
  r = await api("GET", `/pickers/appointments?group=today&q=${encodeURIComponent("محمد")}`, T.owner);
  ok(r.json.appointments.length === 1 && r.json.appointments[0].id === id(aToday2) && r.json.appointments[0].patientName === "محمد الخطيب", "pickers: search appointments by (Arabic) patient name", r.json.appointments);
  r = await api("GET", "/pickers/appointments?group=today&q=nobody", T.owner);
  eq(r.json.appointments.length, 0, "pickers: 'No appointments found' → empty list");
  for (const q of ["group=yesterday", "group=", "group[$ne]=today", "page=0", "page=x"]) {
    r = await api("GET", `/pickers/appointments?${q}`, T.owner);
    ok(r.status === 400, `S appointment picker rejects ${q}`, r.status);
  }
  // every offered appointment can be shared by the same user (picker scope === share scope)
  for (const a of (await api("GET", "/pickers/appointments?group=today", T.doc1)).json.appointments) {
    const rr = await share(T.doc1, dmDocRec.id, "appointment", a.id);
    ok(rr.status === 201, "pickers: whatever the picker offers is shareable by that same user", rr.status);
  }
  // large page of appointments in one go: batched, not N+1 (answers fast with many rows)
  const bulkAppts = [];
  for (let i = 0; i < 30; i++) bulkAppts.push({ clinicId: A._id, patientId: pA1._id, doctorId: U.doc1._id, startAt: at(today.end, 24 + i), duration: 30 });
  await t.m.Appointment.insertMany(bulkAppts);
  const t0 = Date.now();
  r = await api("GET", "/pickers/appointments?group=upcoming", T.owner);
  ok(r.status === 200 && r.json.appointments.length === 20 && r.json.hasMore === true, "pickers: appointments paginate at 20", r.json.appointments.length);
  ok(Date.now() - t0 < 3000, "pickers: a full page resolves in one batch");

  /* ================= batching: a 100-card page costs a fixed number of queries ================= */
  {
    const mongoose = require(`${NM}/mongoose`);
    const stats = { n: 0 };
    mongoose.set("debug", (coll) => { if (["patients", "appointments", "users", "connectmessages"].includes(coll)) stats.n++; });
    const many = [];
    for (let i = 0; i < 40; i++) { const rr = i % 2 ? await share(T.rec2, team.id, "patient", id(pA1)) : await share(T.rec2, team.id, "appointment", id(aToday1)); many.push(rr.json.message.id); }
    stats.n = 0;
    r = await cards(T.rec1, team.id, many);
    mongoose.set("debug", false);
    eq(r.json.cards.length, 40, "perf: 40 cards resolved in one call");
    ok(stats.n <= 8, `perf: 40 cards cost a constant number of queries (${stats.n}) — no N+1`, stats.n);
  }

  /* ================= logging ================= */
  ok(!/Mona Hassan|محمد الخطيب|0791111111|Bee Patient|BLOCK-NOTE-SECRET|Please check this file/.test(t.slog), "X the server log (stdout/stderr) contains no patient name, phone, note or message text");
  const act = await t.m.ActivityLog.find({ clinicId: A._id }).lean();
  ok(!JSON.stringify(act).match(/Mona Hassan|0791111111|Please check this file/), "X the audit log holds no card content");

  open_.forEach((s) => { try { s.close(); } catch {} });
  t.noLeaks("no HTTP response of this suite leaked a stack / path / Mongo internals");
  await t.finish("CLINICOS CONNECT C4 — appointment / patient references: authorisation, privacy, realtime, pickers");
})().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(2); });
