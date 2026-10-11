/* CLINICOS CONNECT — Phase C5 test world (C4 world + a staff member to remove while signed in; fast socket re-check).
   Boots the COMPILED backend on a fixed port with a fresh database, seeds clinics / staff / conversations through the REAL API,
   writes everything the browser tests need to <out>/c5-world.json, then keeps serving until it is killed.
     node tests/connect/c5-world.js <out-dir>          (needs `npm run build` and a MongoDB-protocol server; same env as connect-c1.test.js) */
const fs = require("fs");
const path = require("path");
const { boot, sleep } = require("../phase10/lib");

(async () => {
  const out = process.argv[2] || __dirname;
  const t = await boot({ name: "connect_c5w", port: 5701, env: { CONNECT_SEND_MAX: "100000", CONNECT_OPEN_MAX: "100000", CONNECT_READ_MAX: "100000", CONNECT_RT_REVALIDATE_MS: "1500" } });
  const { M, mongoose } = t;
  const pro = { plan: "pro" };
  const A = await t.mkClinic("c4-a", pro), B = await t.mkClinic("c4-b", pro);
  const Basic = await t.mkClinic("c4-basic", { plan: "basic" });
  const Expired = await t.mkClinic("c4-expired", { plan: "pro", planExpiresAt: new Date(Date.now() - 864e5) });
  const mk = (c, role, name, email) => t.m.User.create({ clinicId: c._id, name, email: `${email}@c4.io`, password: "secret123", role, emailVerified: true });
  const U = {
    owner: await mk(A, "owner", "Amjad Owner", "owner-a"),
    doc: await mk(A, "doctor", "Dr. Sarah Khalil", "doc-a"),
    doc2: await mk(A, "doctor", "د. أحمد المصري", "doc4-a"),
    rec: await mk(A, "receptionist", "Lina Reception", "rec-a"),
    gone: await mk(A, "receptionist", "Former Colleague", "gone-a"),
    victim: await mk(A, "receptionist", "Victim Reception", "victim-a"),
    ownerBb: await mk(B, "receptionist", "Bee Reception", "rec-b"),
    ownerB: await mk(B, "owner", "Zed Outsider", "owner-b"),
    docB: await mk(B, "doctor", "Dr. Bilal Other", "doc-b"),
    ownerBasic: await mk(Basic, "owner", "Basic Owner", "owner-basic"),
    ownerExp: await mk(Expired, "owner", "Expired Owner", "owner-exp"),
  };
  await t.m.User.updateOne({ _id: U.gone._id }, { isActive: false });
  const T = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, t.tok(u)]));
  const id = (x) => String(x._id);
  const call = (method, url, token, body) => t.http(method, "/connect" + url, { token, body });

  // --- seed (through the API, as the staff themselves)
  const team = (await call("GET", "/team", T.owner)).json.conversation;
  await call("POST", `/conversations/${team.id}/messages`, T.doc, { text: "Good morning team" });
  await call("POST", `/conversations/${team.id}/messages`, T.rec, { text: "صباح الخير، المريض الأول وصل" });
  await call("POST", `/conversations/${team.id}/messages`, T.owner, { text: "Welcome — mixed text: مرحبا بكم in ClinicOS 2026" });
  const dmDocRec = (await call("POST", "/conversations/direct", T.doc, { userId: id(U.rec) })).json.conversation;
  for (let i = 1; i <= 75; i++) await call("POST", `/conversations/${dmDocRec.id}/messages`, i % 2 ? T.doc : T.rec, { text: `msg ${String(i).padStart(3, "0")}` });
  // a private chat between two colleagues that the OWNER is not part of, with a distinctive secret
  const dmDocDoc2 = (await call("POST", "/conversations/direct", T.doc, { userId: id(U.doc2) })).json.conversation;
  await call("POST", `/conversations/${dmDocDoc2.id}/messages`, T.doc, { text: "PRIVATE-SECRET-DOC-DOC2" });
  // owner <-> doctor chat with one unread for the owner
  const dmOwnerDoc = (await call("POST", "/conversations/direct", T.doc, { userId: id(U.owner) })).json.conversation;
  await call("POST", `/conversations/${dmOwnerDoc.id}/messages`, T.doc, { text: "Hello owner, quick question" });
  // a chat with a deactivated colleague (history stays readable, writing is blocked)
  const gone = await mongoose.connection.db.collection("users").findOne({ _id: U.gone._id });
  await t.m.User.updateOne({ _id: U.gone._id }, { isActive: true });
  const dmGone = (await call("POST", "/conversations/direct", T.rec, { userId: id(U.gone) })).json.conversation;
  await call("POST", `/conversations/${dmGone.id}/messages`, T.rec, { text: "bye" });
  await t.m.User.updateOne({ _id: U.gone._id }, { isActive: false });

  // --- C4: patients, appointments, and cards seeded through the REAL API (as the staff themselves)
  const { clinicTodayRange } = require(`${t.D}/utils/timezone`);
  const today = clinicTodayRange();
  const pEn = await t.mkPatient(A, "Mona Hassan", "0791111111");
  const pAr = await t.mkPatient(A, "محمد الخطيب", "0792222222");
  const pGone = await t.mkPatient(A, "Vanishing Patient", "0793333333");
  const pB = await t.mkPatient(B, "Outsider Patient", "0794444444");
  for (let i = 0; i < 24; i++) await t.mkPatient(A, `Bulk Patient ${String(i).padStart(2, "0")}`);
  const mkAppt = (c, p, d, h, extra = {}) => t.m.Appointment.create({ clinicId: c._id, patientId: p._id, doctorId: d._id, startAt: new Date(today.start.getTime() + h * 36e5), duration: 30, ...extra });
  const aDoc = await mkAppt(A, pEn, U.doc, 8);
  const aDoc2 = await mkAppt(A, pAr, U.doc2, 9);
  const aGone = await mkAppt(A, pEn, U.doc, 10);
  const aFuture = await mkAppt(A, pAr, U.doc, 30); // tomorrow: exercises the &date= deep link
  const aB = await mkAppt(B, pB, U.docB, 8);
  // a card to a record that is deleted afterwards, and an unrelated private DM that holds cards (the Owner must never see it)
  const gone1 = await call("POST", `/conversations/${dmDocRec.id}/messages`, T.doc, { reference: { type: "patient", id: id(pGone) } });
  const gone2 = await call("POST", `/conversations/${dmDocRec.id}/messages`, T.doc, { reference: { type: "appointment", id: id(aGone) } });
  await t.m.Patient.deleteOne({ _id: pGone._id });
  await t.m.Appointment.deleteOne({ _id: aGone._id });
  await call("POST", `/conversations/${dmDocDoc2.id}/messages`, T.doc, { reference: { type: "patient", id: id(pAr) }, text: "PRIVATE-CARD-NOTE" });
  await call("POST", `/conversations/${dmDocDoc2.id}/messages`, T.doc2, { reference: { type: "appointment", id: id(aDoc2) } });

  const world = {
    base: t.BASE,
    users: Object.fromEntries(Object.entries(U).map(([k, u]) => [k, { id: id(u), name: u.name, email: u.email, role: u.role, clinicId: String(u.clinicId), token: T[k], slug: k === "ownerB" || k === "docB" || k === "ownerBb" ? B.slug : k === "ownerBasic" ? Basic.slug : k === "ownerExp" ? Expired.slug : A.slug }])),
    clinics: { A: id(A), B: id(B), Basic: id(Basic), Expired: id(Expired) },
    conversations: { team: team.id, dmDocRec: dmDocRec.id, dmDocDoc2: dmDocDoc2.id, dmOwnerDoc: dmOwnerDoc.id, dmGone: dmGone.id },
    secret: "PRIVATE-SECRET-DOC-DOC2",
    c4: { pEn: id(pEn), pAr: id(pAr), pB: id(pB), aDoc: id(aDoc), aDoc2: id(aDoc2), aFuture: id(aFuture), aB: id(aB), goneMsgs: [gone1.json.message.id, gone2.json.message.id], privateNote: "PRIVATE-CARD-NOTE", today: today.ymd, names: { en: "Mona Hassan", ar: "محمد الخطيب" } },
  };
  fs.writeFileSync(path.join(out, "c5-world.json"), JSON.stringify(world, null, 1));
  console.log("C5 WORLD READY on :5701");
  void gone;
  for (;;) await sleep(60000);
})().catch((e) => { console.error(e); process.exit(1); });
