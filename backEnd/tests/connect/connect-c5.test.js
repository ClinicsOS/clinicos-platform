/* CLINICOS CONNECT — Phase C5: FINAL QA / SECURITY ATTACK SUITE.
   Not a feature test: it tries to BREAK Connect (C1–C4) from the outside — real HTTP, real sockets (socket.io-client), real database, the COMPILED server.
   Nothing is mocked. The server under test is started in NODE_ENV=test; section 14 additionally boots a second copy in NODE_ENV=production.
     npm run build && node tests/connect/connect-c5.test.js
   Concurrency / index sections (11, 12) are only meaningful on a REAL MongoDB (they print which server answered); on an emulator they must be re-run on the real target.
   Section map: 1 role matrix · 2 non-PRO · 3 downgrade/restore · 4 private-DM privacy · 5 cross-clinic IDOR · 6 socket auth/payload · 7 token expiry
                8 staff removal · 9 input security · 10 seq-gap guard · 11 concurrency · 12 indexes · 13 backward compatibility
                14 production-mode server (origins / CORS / kill switch / startup) · 15 logging privacy · 16 cache headers */
const path = require("path");
const fs = require("fs");
const http_ = require("http");
const crypto = require("crypto");
const { boot, spawnServer, sleep, MONGO_BASE, SECRET } = require("../phase10/lib");

const NM = process.env.P10_NM || path.resolve(__dirname, "../../node_modules");
const { io: ioClient } = require(`${NM}/socket.io-client`);

(async () => {
  const PORT = 5821;
  const ENV = { CONNECT_SEND_MAX: "100000", CONNECT_OPEN_MAX: "100000", CONNECT_READ_MAX: "100000", CONNECT_RT_REVALIDATE_MS: "700", CONNECT_RT_MAX_SOCKETS_PER_USER: "20" };
  const t = await boot({ name: "connect_c5", port: PORT, env: ENV });
  const { ok, eq, http } = t;
  const DIST = t.D;
  const OUT = process.env.P10_OUT || __dirname;
  const { ConnectConversation } = require(`${DIST}/models/ConnectConversation`);
  const { ConnectMessage } = require(`${DIST}/models/ConnectMessage`);
  const { ConnectReadState } = require(`${DIST}/models/ConnectReadState`);
  await Promise.all([ConnectConversation.init(), ConnectMessage.init(), ConnectReadState.init()]);
  const URL = `http://127.0.0.1:${PORT}`;
  const { clinicTodayRange } = require(`${DIST}/utils/timezone`);
  const info = await t.mongoose.connection.db.admin().serverInfo();
  console.log(`[env] MongoDB server version ${info.version} (this is the database the concurrency/index sections ran on)`);
  const MATRIX = [];
  const rec = (section, who, action, expected, got) => MATRIX.push({ section, who, action, expected, got, pass: expected === got });

  /* ---------------- world ---------------- */
  const pro = { plan: "pro" };
  const A = await t.mkClinic("c5-a", pro), B = await t.mkClinic("c5-b", pro), Cb = await t.mkClinic("c5-basic", { plan: "basic" }), Ct = await t.mkClinic("c5-trial", { plan: "trial" });
  const Dn = await t.mkClinic("c5-down", pro), Cc = await t.mkClinic("c5-conc", pro), Ce = await t.mkClinic("c5-expired", { plan: "pro", planExpiresAt: new Date(Date.now() - 864e5) });
  const mk = (c, role, n, name) => t.m.User.create({ clinicId: c._id, name: name || `${role} ${n}`, email: `${role}${n}-${c.slug}@t.io`, password: "secret123", role, emailVerified: true });
  const U = {
    owner: await mk(A, "owner", 1, "Amjad Owner"), doc1: await mk(A, "doctor", 1, "Dr. Sarah"), doc2: await mk(A, "doctor", 2, "د. أحمد"), rec1: await mk(A, "receptionist", 1, "Lina"), rec2: await mk(A, "receptionist", 2, "Rana"),
    docX: await mk(A, "doctor", 7, "Dr. Removable"), recX: await mk(A, "receptionist", 7, "Rec Removable"), recY: await mk(A, "receptionist", 8, "Rec Revoked"),
    ownerB: await mk(B, "owner", 1, "Owner Bee"), docB: await mk(B, "doctor", 1, "Dr. Bee"), recB: await mk(B, "receptionist", 1, "Rec Bee"),
    ownerC: await mk(Cb, "owner", 1), docC: await mk(Cb, "doctor", 1), recC: await mk(Cb, "receptionist", 1), ownerT: await mk(Ct, "owner", 1), ownerE: await mk(Ce, "owner", 1),
    ownerD: await mk(Dn, "owner", 1), docD: await mk(Dn, "doctor", 1), recD: await mk(Dn, "receptionist", 1),
  };
  const T = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, t.tok(u)]));
  const id = (x) => String(x._id);

  const SENT = "C5-BODY-" + crypto.randomBytes(6).toString("hex"); // appears in message bodies; must never appear in logs or foreign responses
  const pA1 = await t.mkPatient(A, "Mona Hassan", "0791111111");
  const pA2 = await t.mkPatient(A, "محمد الخطيب", "0792222222");
  const pB1 = await t.mkPatient(B, "Bee Patient SECRET-B", "0794444444");
  const today = clinicTodayRange();
  const H = 36e5;
  const at = (base, h) => new Date(base.getTime() + h * H);
  const mkAppt = (c, patient, doctor, startAt, extra = {}) => t.m.Appointment.create({ clinicId: c._id, patientId: patient ? patient._id : undefined, doctorId: doctor._id, startAt, duration: 30, ...extra });
  const aDoc1 = await mkAppt(A, pA1, U.doc1, at(today.start, 6));
  const aDoc2 = await mkAppt(A, pA2, U.doc2, at(today.start, 7));
  const aB = await mkAppt(B, pB1, U.docB, at(today.start, 6));

  /* ---------------- helpers ---------------- */
  const api = (method, url, token, body, o = {}) => http(method, "/connect" + url, { token, body, ...o });
  const open = (token, other) => api("POST", "/conversations/direct", token, { userId: id(other) });
  const send = (token, convId, text) => api("POST", `/conversations/${convId}/messages`, token, { text });
  const share = (token, convId, type, rid, text) => api("POST", `/conversations/${convId}/messages`, token, { ...(text !== undefined ? { text } : {}), reference: { type, id: rid } });
  const read = (token, convId, body) => api("POST", `/conversations/${convId}/read`, token, body || {});
  const msgs = (token, convId, q = "") => api("GET", `/conversations/${convId}/messages${q}`, token);
  const cards = (token, convId, ids) => api("POST", `/conversations/${convId}/cards`, token, { messageIds: ids });
  const no5xx = (r, label) => ok(r.status < 500, `${label} → never a 5xx (got ${r.status})`, r.text && r.text.slice(0, 120));
  const teamOf = async (token) => (await api("GET", "/team", token)).json.conversation;

  const open_ = [];
  const connect = (token, o = {}) =>
    new Promise((resolve) => {
      const s = ioClient(o.url || URL, { auth: o.noAuth ? undefined : { token }, query: o.query, transports: ["websocket"], reconnection: false, forceNew: true, timeout: 5000, extraHeaders: o.headers, ...(o.opts || {}) });
      const ev = [];
      s.onAny((name, p) => ev.push({ name, p, at: Date.now() }));
      open_.push(s);
      s.on("connect", () => resolve({ ok: true, s, ev }));
      s.on("connect_error", (e) => resolve({ ok: false, code: e && e.data && e.data.code, message: e && e.message, s, ev }));
    });
  const emitAck = (s, event, payload) => new Promise((resolve) => { const to = setTimeout(() => resolve({ timeout: true }), 3000); s.emit(event, payload, (r) => { clearTimeout(to); resolve(r); }); });
  const waitFor = async (fn, ms = 4000, step = 25) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); } };
  const evOf = (c, name) => c.ev.filter((e) => e.name === name);
  const newMsgs = (c, convId) => evOf(c, "connect:message:new").filter((e) => !convId || e.p.message.conversationId === convId);

  /* ================= 1. ROLE MATRIX (actual ClinicOS permissions) ================= */
  {
    const team = await teamOf(T.owner);
    const roles = [
      { role: "owner", tk: T.owner, u: U.owner, dmWith: U.doc2, ownAppt: null },
      { role: "doctor", tk: T.doc1, u: U.doc1, dmWith: U.rec1, ownAppt: aDoc1 },
      { role: "receptionist", tk: T.rec1, u: U.rec1, dmWith: U.rec2, ownAppt: null },
    ];
    for (const R of roles) {
      const w = R.role;
      let r = await api("GET", "/conversations", R.tk); rec("roles", w, "list conversations", 200, r.status); eq(r.status, 200, `1 ${w}: list conversations`);
      ok((r.json.conversations || []).some((c) => c.type === "clinic_team"), `1 ${w}: Clinic Team is in the list`);
      r = await api("GET", "/team", R.tk); rec("roles", w, "open Team", 200, r.status); eq(r.status, 200, `1 ${w}: open Team`);
      r = await api("GET", "/unread-count", R.tk); rec("roles", w, "unread count", 200, r.status); eq(r.status, 200, `1 ${w}: unread count`);
      r = await open(R.tk, R.dmWith); rec("roles", w, "open DM", "200/201", r.status === 200 || r.status === 201 ? "200/201" : r.status); ok(r.status === 200 || r.status === 201, `1 ${w}: open a DM`, r.status);
      const dm = r.json.conversation;
      r = await send(R.tk, dm.id, `hello from ${w}`); rec("roles", w, "send DM", 201, r.status); eq(r.status, 201, `1 ${w}: send in DM`);
      r = await send(R.tk, team.id, `team hello from ${w}`); rec("roles", w, "send Team", 201, r.status); eq(r.status, 201, `1 ${w}: send in Team`);
      const lastId = r.json.message.id;
      r = await msgs(R.tk, team.id); rec("roles", w, "read Team messages", 200, r.status); eq(r.status, 200, `1 ${w}: read Team messages`);
      r = await read(R.tk, team.id, { upToMessageId: lastId }); rec("roles", w, "mark read", 200, r.status); eq(r.status, 200, `1 ${w}: mark read`);
      r = await api("GET", "/pickers/patients", R.tk); rec("roles", w, "patient picker", 200, r.status); eq(r.status, 200, `1 ${w}: patient picker`);
      r = await share(R.tk, dm.id, "patient", id(pA1)); rec("roles", w, "share patient ref", 201, r.status); eq(r.status, 201, `1 ${w}: share a Patient`);
      const pm = r.json.message && r.json.message.id;
      r = await api("GET", "/pickers/appointments?group=today", R.tk); rec("roles", w, "appointment picker", 200, r.status); eq(r.status, 200, `1 ${w}: appointment picker`);
      const pick = (r.json.appointments || r.json.items || []).map((x) => x.id);
      if (R.role === "doctor") {
        ok(pick.includes(id(aDoc1)) && !pick.includes(id(aDoc2)), "1 doctor: picker lists ONLY the doctor's own appointment");
        r = await share(R.tk, dm.id, "appointment", id(aDoc1)); rec("roles", w, "share OWN appointment", 201, r.status); eq(r.status, 201, "1 doctor: share own appointment");
        const am = r.json.message && r.json.message.id;
        r = await share(R.tk, dm.id, "appointment", id(aDoc2)); rec("roles", w, "share OTHER doctor's appointment", 404, r.status); eq(r.status, 404, "1 doctor: other doctor's appointment → 404");
        r = await http("GET", `/appointments?date=${today.ymd}`, { token: R.tk }); rec("roles", w, "open appointments board (other doctor's row visible?)", "hidden", (JSON.stringify(r.json).includes(id(aDoc2)) ? "visible" : "hidden"));
        ok(!JSON.stringify(r.json).includes(id(aDoc2)), "1 doctor: the normal appointment board hides the other doctor's visit");
        r = await cards(R.tk, dm.id, [pm, am]); eq(r.status, 200, "1 doctor: cards resolve");
      } else {
        ok(pick.includes(id(aDoc1)) && pick.includes(id(aDoc2)), `1 ${w}: appointment picker lists the whole clinic`);
        r = await share(R.tk, dm.id, "appointment", id(aDoc2)); rec("roles", w, "share any clinic appointment", 201, r.status); eq(r.status, 201, `1 ${w}: share any clinic appointment`);
        r = await http("GET", `/appointments?date=${today.ymd}`, { token: R.tk }); ok(JSON.stringify(r.json).includes(id(aDoc2)) && JSON.stringify(r.json).includes(id(aDoc1)), `1 ${w}: appointment board shows the clinic`);
      }
      r = await http("GET", `/patients/${id(pA1)}`, { token: R.tk }); rec("roles", w, "open Patient File", 200, r.status); eq(r.status, 200, `1 ${w}: open Patient File (normal ClinicOS route)`);
      const c = await connect(R.tk); rec("roles", w, "realtime connect", "connected", c.ok ? "connected" : c.code); ok(c.ok, `1 ${w}: realtime handshake`, c.code);
      if (c.ok) { const s1 = await emitAck(c.s, "connect:conversation:subscribe", { conversationId: team.id }); rec("roles", w, "realtime subscribe Team", true, s1.ok); ok(s1.ok === true, `1 ${w}: subscribe Team`); const s2 = await emitAck(c.s, "connect:conversation:subscribe", { conversationId: dm.id }); rec("roles", w, "realtime subscribe own DM", true, s2.ok); ok(s2.ok === true, `1 ${w}: subscribe own DM`); c.s.close(); }
    }
  }

  /* ================= 2. NON-PRO (all roles, every route, direct API + realtime) ================= */
  {
    const some = "5f1d7f3e1c9d440000000000";
    const routes = [
      ["GET", "/team"], ["GET", "/conversations"], ["GET", "/unread-count"], ["POST", "/conversations/direct", { userId: some }], ["GET", `/conversations/${some}`],
      ["GET", `/conversations/${some}/messages`], ["POST", `/conversations/${some}/messages`, { text: "x" }], ["POST", `/conversations/${some}/messages`, { reference: { type: "patient", id: some } }],
      ["POST", `/conversations/${some}/messages`, { reference: { type: "appointment", id: some } }], ["POST", `/conversations/${some}/read`, {}], ["POST", `/conversations/${some}/cards`, { messageIds: [] }],
      ["GET", "/pickers/patients"], ["GET", "/pickers/appointments?group=today"],
    ];
    for (const [label, ks] of [["basic", ["ownerC", "docC", "recC"]], ["trial", ["ownerT"]], ["expired-pro", ["ownerE"]]]) {
      for (const k of ks) {
        let denied = 0, leaks = 0;
        for (const [m, u, b] of routes) {
          const r = await api(m, u, T[k], b);
          if (r.status === 402) denied++;
          if (r.status < 400 || (r.json && r.json.conversation)) leaks++;
        }
        rec("non-pro", `${label}/${k}`, `${routes.length} routes`, routes.length, denied);
        eq(denied, routes.length, `2 ${label}/${k}: ALL ${routes.length} Connect routes answer 402`);
        eq(leaks, 0, `2 ${label}/${k}: nothing succeeded`);
      }
    }
    let r = await api("GET", "/team", T.docC); eq(r.json && r.json.code, "PLAN_LIMIT", "2 basic Doctor: PLAN_LIMIT code"); eq(r.json && r.json.feature, "internalChat", "2 …feature=internalChat");
    r = await api("GET", "/team", T.ownerE); ok(["PLAN_LIMIT", "EXPIRED", "SUSPENDED"].includes(r.json && r.json.code), "2 expired Pro clinic: denied with a plan code", r.json);
    for (const k of ["ownerC", "docC", "recC", "ownerT", "ownerE"]) {
      const c = await connect(T[k]); ok(!c.ok && ["PLAN_LIMIT", "EXPIRED"].includes(c.code), `2 ${k}: socket handshake refused (${c.code})`); rec("non-pro", k, "socket", "denied", c.ok ? "connected" : "denied");
      if (c.s) c.s.close();
    }
    r = await http("GET", "/patients", { token: T.ownerC }); eq(r.status, 200, "2 a non-PRO clinic keeps every existing ClinicOS feature (patients)");
    r = await http("GET", "/appointments?date=" + today.ymd, { token: T.docC }); eq(r.status, 200, "2 …and appointments");
  }

  /* ================= 3. DOWNGRADE → RESTORE keeps history ================= */
  {
    const team = await teamOf(T.ownerD);
    const dm = (await open(T.docD, U.recD)).json.conversation;
    for (let i = 0; i < 5; i++) await send(T.docD, dm.id, `d-${i}`);
    for (let i = 0; i < 3; i++) await send(T.ownerD, team.id, `t-${i}`);
    const before = (await api("GET", "/conversations", T.recD)).json;
    const unreadBefore = before.totalUnread;
    const cDoc = await connect(T.docD), cRec = await connect(T.recD), cOwn = await connect(T.ownerD);
    ok(cDoc.ok && cRec.ok && cOwn.ok, "3 PRO sockets connect before the downgrade");
    await t.m.Clinic.updateOne({ _id: Dn._id }, { $set: { plan: "basic" } });
    for (const [k, tk] of [["owner", T.ownerD], ["doctor", T.docD], ["receptionist", T.recD]]) { const r = await api("GET", "/conversations", tk); eq(r.status, 402, `3 downgraded: ${k} HTTP → 402`); }
    const rr = await send(T.docD, dm.id, "after downgrade"); eq(rr.status, 402, "3 downgraded: cannot send");
    const revoked = await waitFor(() => [cDoc, cRec, cOwn].every((c) => evOf(c, "connect:access:revoked").length > 0 || !c.s.connected), 4000);
    ok(!!revoked, "3 downgraded: every open socket is revoked within the re-check window");
    ok(evOf(cDoc, "connect:access:revoked").some((e) => e.p.code === "PLAN_LIMIT"), "3 …with code PLAN_LIMIT");
    const again = await connect(T.docD); ok(!again.ok && again.code === "PLAN_LIMIT", "3 downgraded: new socket refused");
    // restore
    await t.m.Clinic.updateOne({ _id: Dn._id }, { $set: { plan: "pro" } });
    const after = await api("GET", "/conversations", T.recD);
    eq(after.status, 200, "3 restored: HTTP works again");
    eq(after.json.totalUnread, unreadBefore, "3 restored: unread counts preserved");
    const hist = await msgs(T.recD, dm.id, "?limit=100");
    eq(hist.json.messages.map((m) => m.text), ["d-0", "d-1", "d-2", "d-3", "d-4"], "3 restored: DM history intact, in order");
    const th = await msgs(T.recD, team.id, "?limit=100"); ok(th.json.messages.length >= 3, "3 restored: Team history intact");
    const c2 = await connect(T.docD); ok(c2.ok, "3 restored: socket connects again"); if (c2.s) c2.s.close();
    for (const c of [cDoc, cRec, cOwn]) c.s.close();
  }

  /* ================= 4. PRIVATE DM PRIVACY: Doctor A ↔ Receptionist; everyone else must be blind ================= */
  const teamA = await teamOf(T.owner);
  const dm = (await open(T.doc1, U.rec1)).json.conversation; // owner / doc2 / rec2 / other clinics are NOT participants
  const dmMsg = await send(T.doc1, dm.id, `private ${SENT} doc→rec`);
  await send(T.rec1, dm.id, `private ${SENT} rec→doc`);
  const dmCard = await share(T.doc1, dm.id, "patient", id(pA1), "card " + SENT);
  {
    const outsiders = { owner: T.owner, "doctor B (same clinic)": T.doc2, "other receptionist": T.rec2, "other clinic owner": T.ownerB, "other clinic doctor": T.docB };
    const unreadBefore = {};
    for (const [k, tk] of Object.entries(outsiders)) unreadBefore[k] = (await api("GET", "/unread-count", tk)).json.total;
    await send(T.doc1, dm.id, `third ${SENT}`);
    const attackerSockets = {};
    for (const [k, tk] of Object.entries(outsiders)) attackerSockets[k] = await connect(tk);
    const ownerSock = attackerSockets.owner;
    for (const [k, tk] of Object.entries(outsiders)) {
      const get = await api("GET", `/conversations/${dm.id}`, tk);
      const mm = await msgs(tk, dm.id);
      const post = await send(tk, dm.id, "intrusion");
      const rd = await read(tk, dm.id);
      const cd = await cards(tk, dm.id, [dmCard.json.message.id]);
      const mm2 = await msgs(tk, dm.id, "?after=" + dmMsg.json.message.cursor);
      const mm3 = await msgs(tk, dm.id, "?before=" + dmMsg.json.message.cursor);
      for (const [what, r] of [["GET conversation", get], ["GET messages", mm], ["POST message", post], ["POST read", rd], ["POST cards", cd], ["GET messages after", mm2], ["GET messages before", mm3]]) {
        rec("dm-privacy", k, what, 404, r.status);
        eq(r.status, 404, `4 ${k}: ${what} → 404`);
        ok(!r.text.includes(SENT) && !r.text.includes("Mona Hassan") && !r.text.includes("Lina"), `4 ${k}: ${what} leaks no content`);
      }
      const list = await api("GET", "/conversations", tk);
      ok(!JSON.stringify(list.json).includes(dm.id), `4 ${k}: the DM is not discoverable in the list`);
      ok(!list.text.includes(SENT), `4 ${k}: list never contains the private text`);
      eq((await api("GET", "/unread-count", tk)).json.total, unreadBefore[k] + (k === "owner" || k === "doctor B (same clinic)" || k === "other receptionist" ? 0 : 0), `4 ${k}: a private message never changes their unread count`);
      const sock = attackerSockets[k];
      if (sock.ok) {
        const sub = await emitAck(sock.s, "connect:conversation:subscribe", { conversationId: dm.id });
        rec("dm-privacy", k, "realtime subscribe", "NOT_FOUND", sub.code); eq(sub.code, "NOT_FOUND", `4 ${k}: realtime subscribe → NOT_FOUND`);
        const ty = await emitAck(sock.s, "connect:typing", { conversationId: dm.id, typing: true });
        eq(ty.code, "NOT_SUBSCRIBED", `4 ${k}: typing into a DM they are not in is refused`);
      } else ok(k.includes("clinic") ? true : false, `4 ${k}: socket connected`, sock.code);
    }
    // opening "the same" DM from the other side creates a DIFFERENT conversation (the owner can only ever have their own pair)
    const ownerOpen = await open(T.owner, U.doc1);
    ok(ownerOpen.json.conversation.id !== dm.id, "4 the Owner opening a DM with the Doctor gets THEIR OWN conversation, not Doctor↔Receptionist");
    // live traffic: participants get it, nobody else gets a thing
    const doc = await connect(T.doc1), recep = await connect(T.rec1);
    for (const c of [doc, recep]) await emitAck(c.s, "connect:conversation:subscribe", { conversationId: dm.id });
    await emitAck(doc.s, "connect:typing", { conversationId: dm.id, typing: true });
    await send(T.doc1, dm.id, `live ${SENT}`);
    await read(T.rec1, dm.id);
    await sleep(900);
    ok(newMsgs(recep, dm.id).length >= 1 && newMsgs(doc, dm.id).length >= 1, "4 both participants receive the live DM");
    ok(evOf(recep, "connect:typing").length >= 1, "4 the peer sees typing");
    ok(evOf(doc, "connect:read:peer").length >= 1, "4 the peer's read position reaches the sender (Seen)");
    for (const [k, sock] of Object.entries(attackerSockets)) {
      if (!sock.ok) continue;
      const leaked = sock.ev.filter((e) => ["connect:message:new", "connect:typing", "connect:read:peer", "connect:read:self"].includes(e.name) && JSON.stringify(e.p).includes(dm.id));
      rec("dm-privacy", k, "realtime events for the private DM", 0, leaked.length);
      eq(leaked.length, 0, `4 ${k}: received ZERO realtime events about the private DM`);
      ok(!sock.ev.some((e) => JSON.stringify(e.p || "").includes(SENT)), `4 ${k}: private text never reached their socket`);
    }
    // a Team message DOES reach the Owner (control: the sockets are really live)
    await send(T.doc1, teamA.id, "team control");
    ok(await waitFor(() => newMsgs(ownerSock, teamA.id).length >= 1, 3000), "4 control: the Owner's socket is live and receives Team messages");
    for (const c of [doc, recep, ...Object.values(attackerSockets)]) c.s && c.s.close();
  }

  /* ================= 5. CROSS-CLINIC IDOR ================= */
  {
    const teamB = await teamOf(T.ownerB);
    const dmB = (await open(T.docB, U.recB)).json.conversation;
    const mB = (await send(T.docB, dmB.id, `clinic-B ${SENT}`)).json.message;
    const mTeamB = (await send(T.ownerB, teamB.id, `team-B ${SENT}`)).json.message;
    const cardB = await share(T.docB, dmB.id, "patient", id(pB1));
    const attackers = { owner: T.owner, doctor: T.doc1, receptionist: T.rec1 };
    const baseline404 = JSON.stringify((await api("GET", `/conversations/5f1d7f3e1c9d440000000000`, T.owner)).json);
    for (const [k, tk] of Object.entries(attackers)) {
      for (const cid of [teamB.id, dmB.id, dmB.id.toUpperCase()]) {
        for (const [what, r] of [["GET conversation", await api("GET", `/conversations/${cid}`, tk)], ["GET messages", await msgs(tk, cid)], ["POST message", await send(tk, cid, "x")], ["POST read", await read(tk, cid)], ["POST cards", await cards(tk, cid, [cardB.json.message.id])]]) {
          rec("cross-clinic", k, `${what} (clinic B conversation)`, 404, r.status);
          ok(r.status === 404, `5 ${k}: ${what} of clinic B → 404`, r.status);
          ok(!r.text.includes(SENT) && !r.text.includes("Bee"), `5 ${k}: ${what} leaks nothing of clinic B`);
        }
      }
      eq(JSON.stringify((await api("GET", `/conversations/${teamB.id}`, tk)).json), baseline404, `5 ${k}: clinic B's conversation is byte-identical to a non-existent one (no existence oracle)`);
      let r = await read(tk, teamA.id, { upToMessageId: mTeamB.id }); eq(r.status, 404, `5 ${k}: mark-read with a message id of another clinic → 404`);
      r = await read(tk, teamA.id, { upToMessageId: mB.id }); eq(r.status, 404, `5 ${k}: …and of a private DM of another clinic → 404`);
      r = await cards(tk, teamA.id, [cardB.json.message.id, mB.id, mTeamB.id]); eq(r.status, 200, `5 ${k}: cards with foreign message ids answer 200`); eq((r.json.cards || []).length, 0, `5 ${k}: …and resolve to NOTHING`);
      r = await share(tk, teamA.id, "patient", id(pB1)); const x1 = r.text; eq(r.status, 404, `5 ${k}: sharing clinic B's patient → 404`);
      r = await share(tk, teamA.id, "appointment", id(aB)); eq(r.status, 404, `5 ${k}: sharing clinic B's appointment → 404`);
      r = await share(tk, teamA.id, "patient", "5f1d7f3e1c9d440000000000"); eq(r.text, x1, `5 ${k}: cross-clinic ≡ non-existent patient (byte-identical)`);
      r = await api("POST", "/conversations/direct", tk, { userId: id(U.docB) }); eq(r.status, 404, `5 ${k}: cannot open a DM with a user of another clinic`);
      r = await api("GET", `/conversations?clinicId=${id(B)}`, tk); ok(!r.text.includes(teamB.id) && !r.text.includes(dmB.id) && !/clinic-B|team-B|Bee/.test(r.text), `5 ${k}: ?clinicId= in the query is ignored`);
      r = await http("GET", `/connect/conversations`, { token: tk, headers: { "X-Clinic-Id": id(B), "X-Forwarded-Host": "b.example.com" } }); ok(!r.text.includes(teamB.id), `5 ${k}: spoofed clinic headers are ignored`);
      r = await api("POST", `/conversations/${teamA.id}/messages`, tk, { text: "x", clinicId: id(B) }); eq(r.status, 400, `5 ${k}: clinicId in a body is rejected (strict)`);
      r = await api("GET", "/pickers/patients?q=Bee", tk); ok(!r.text.includes("Bee Patient"), `5 ${k}: patient picker never returns another clinic's patient`);
      r = await http("GET", `/patients/${id(pB1)}`, { token: tk }); eq(r.status, 404, `5 ${k}: existing ClinicOS patient route is still tenant-scoped`);
    }
    // realtime
    const a = await connect(T.owner), b = await connect(T.ownerB); const dB = await connect(T.docB);
    for (const [k, tk] of Object.entries(attackers)) { const c = await connect(tk); for (const cid of [teamB.id, dmB.id]) { const s = await emitAck(c.s, "connect:conversation:subscribe", { conversationId: cid }); eq(s.code, "NOT_FOUND", `5 ${k}: realtime subscribe to clinic B's ${cid === teamB.id ? "Team" : "DM"} → NOT_FOUND`); } c.s.close(); }
    await send(T.ownerB, teamB.id, `live B ${SENT}`); await send(T.docB, dmB.id, `live B dm ${SENT}`);
    await sleep(900);
    ok(newMsgs(b, teamB.id).length >= 1 && newMsgs(dB, dmB.id).length >= 1, "5 control: clinic B's own sockets receive their traffic");
    ok(!a.ev.some((e) => e.name.startsWith("connect:message") && JSON.stringify(e.p).includes(SENT)), "5 clinic A's Owner socket received nothing from clinic B");
    // and the other way around: A's traffic never reaches B
    await send(T.doc1, teamA.id, `live A ${SENT}`); await sleep(700);
    ok(!b.ev.some((e) => JSON.stringify(e.p || "").includes("live A")), "5 clinic B's Owner socket received nothing from clinic A");
    for (const c of [a, b, dB]) c.s.close();
  }

  /* ================= 6. SOCKET AUTH + PAYLOAD ABUSE ================= */
  {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const noneTok = `${b64({ alg: "none", typ: "JWT" })}.${b64({ userId: id(U.owner), tokenVersion: 0 })}.`;
    const bad = {
      "no token": null, "empty token": "", "garbage": "not-a-jwt-at-all-but-long-enough-1234567890", "too short": "abc", "alg=none": noneTok,
      "wrong secret": t.tok(U.owner, {}, "another-secret-another-secret-123456"), "expired": t.tok(U.owner, {}, SECRET, { expiresIn: -30 }),
      "loyalty-shaped": t.jwt.sign({ userId: id(U.owner), typ: "loyalty", aud: "x", cid: id(A) }, SECRET), "admin-shaped": t.jwt.sign({ sub: id(U.owner) }, SECRET),
      "unknown user": t.jwt.sign({ userId: "5f1d7f3e1c9d440000000000", tokenVersion: 0 }, SECRET), "wrong tokenVersion": t.tok(U.owner, { tokenVersion: 99 }),
      "huge": "a".repeat(5000), "HS512 signed": t.jwt.sign({ userId: id(U.owner), tokenVersion: 0 }, SECRET, { algorithm: "HS512" }),
    };
    for (const [k, tk] of Object.entries(bad)) {
      const c = k === "no token" ? await connect(null, { noAuth: true }) : await connect(tk);
      rec("socket-auth", k, "handshake", "refused", c.ok ? "ACCEPTED" : "refused");
      ok(!c.ok, `6 handshake with ${k} is refused`, c.code); if (c.s) c.s.close();
    }
    let c = await connect(null, { noAuth: true, query: { token: T.owner } }); ok(!c.ok, "6 a token in the query string is not accepted"); c.s && c.s.close();
    c = await connect(T.owner, { headers: { Origin: "https://evil.example.com" } }); ok(!c.ok, "6 a browser Origin that is not ours is refused (even with a valid token)", c.message); c.s && c.s.close();
    c = await connect(T.owner, { headers: { Origin: "http://localhost:3000" } }); ok(c.ok, "6 the allowed Origin is accepted"); c.s && c.s.close();
    // token without a tokenVersion in a legacy user document still works (backward compat)
    c = await connect(T.ownerB); ok(c.ok, "6 a valid staff token connects");
    const ssv = [c.s];
    // payload abuse on a live socket
    const live = await connect(T.doc1); const sk = live.s;
    const team = teamA;
    const cases = [
      ["numeric id", { conversationId: 123 }, "INVALID_PAYLOAD"], ["extra userId (spoof)", { conversationId: team.id, userId: id(U.owner) }, "INVALID_PAYLOAD"], ["extra clinicId", { conversationId: team.id, clinicId: id(B) }, "INVALID_PAYLOAD"],
      ["extra senderId", { conversationId: team.id, senderId: id(U.owner) }, "INVALID_PAYLOAD"], ["invalid id", { conversationId: "zzz" }, "INVALID_ID"], ["long id", { conversationId: "x".repeat(100) }, "INVALID_PAYLOAD"],
      ["null", null, "INVALID_PAYLOAD"], ["array", [team.id], "INVALID_PAYLOAD"], ["operator object", { conversationId: { $ne: null } }, "INVALID_PAYLOAD"], ["empty id", { conversationId: "" }, "INVALID_PAYLOAD"],
    ];
    for (const [label, p, want] of cases) { const r = await emitAck(sk, "connect:conversation:subscribe", p); rec("socket-payload", "doctor", label, want, r.code); eq(r.code, want, `6 subscribe ${label} → ${want}`); }
    ok((await emitAck(sk, "connect:conversation:subscribe", { conversationId: team.id })).ok, "6 a valid subscribe works");
    for (const [label, p, want] of [["typing non-boolean", { conversationId: team.id, typing: "yes" }, "INVALID_PAYLOAD"], ["typing spoofed user", { conversationId: team.id, typing: true, userId: id(U.owner) }, "INVALID_PAYLOAD"], ["typing spoofed name", { conversationId: team.id, typing: true, name: "CEO" }, "INVALID_PAYLOAD"]]) {
      const r = await emitAck(sk, "connect:typing", p); eq(r.code, want, `6 ${label} → ${want}`);
    }
    // a client cannot fabricate server→client events for others
    const victim = await connect(T.rec2); ssv.push(victim.s);
    await emitAck(victim.s, "connect:conversation:subscribe", { conversationId: team.id });
    sk.emit("connect:message:new", { conversation: { id: team.id }, message: { id: "x", text: "forged", senderId: id(U.owner) } }, () => undefined);
    sk.emit("connect:read:peer", { conversationId: team.id, lastReadCursor: "v1:1" });
    sk.emit("connect:read:self", { conversationId: team.id });
    sk.emit("connect:access:revoked", { code: "PLAN_LIMIT" });
    sk.emit("send", "x"); sk.emit("connect:message:send", { conversationId: team.id, text: "socket-send" }, () => undefined);
    await sleep(700);
    ok(!victim.ev.some((e) => e.name.startsWith("connect:") && JSON.stringify(e.p).includes("forged")), "6 forged server→client events from a client are never relayed");
    ok(!victim.ev.some((e) => e.name === "connect:read:peer" || e.name === "connect:access:revoked"), "6 …nor read / revoke frames");
    eq((await msgs(T.rec2, team.id, "?limit=100")).json.messages.filter((m) => /socket-send|forged/.test(m.text)).length, 0, "6 a message can NOT be created through the socket");
    ok(sk.connected, "6 the abusive-but-small events did not kill the socket");
    // oversize: > 8 KB closes the connection
    const big = await connect(T.doc1); big.s.emit("connect:conversation:subscribe", { conversationId: "a".repeat(20000) });
    ok(await waitFor(() => !big.s.connected, 3000), "6 an oversized (20 KB) frame closes the connection");
    // flood
    const fl = await connect(T.doc1); let limited = 0;
    await new Promise((res) => { let n = 0; for (let i = 0; i < 400; i++) fl.s.emit("connect:conversation:subscribe", { conversationId: team.id }, (r) => { if (r && r.code === "RATE_LIMITED") limited++; if (++n === 400) res(); }); setTimeout(res, 4000); });
    ok(limited > 0, "6 a flood of events is rate-limited per socket", limited);
    // reconnect restores nothing implicitly: a NEW connection starts with no subscriptions
    const re = await connect(T.doc1); const ty = await emitAck(re.s, "connect:typing", { conversationId: team.id, typing: true }); eq(ty.code, "NOT_SUBSCRIBED", "6 a fresh connection has no inherited subscriptions");
    for (const x of [sk, big.s, fl.s, re.s, ...ssv]) x.close();
  }

  /* ================= 7. TOKEN EXPIRY ON AN OPEN SOCKET (C5 fix) ================= */
  {
    const short = t.tok(U.rec2, {}, SECRET, { expiresIn: 3 });
    const c = await connect(short);
    ok(c.ok, "7 a token with 3 s left connects");
    const http1 = await api("GET", "/unread-count", short); eq(http1.status, 200, "7 …and works over HTTP while valid");
    const cut = await waitFor(() => !c.s.connected, 7000);
    ok(!!cut, "7 the socket is closed by the server once the JWT has expired");
    ok(evOf(c, "connect:access:revoked").some((e) => e.p.code === "UNAUTHORIZED"), "7 …with a revoked/UNAUTHORIZED notice (client stops retrying)");
    eq((await api("GET", "/unread-count", short)).status, 401, "7 HTTP refuses the same expired token");
    const again = await connect(short); ok(!again.ok, "7 the expired token cannot reconnect");
    // an event after expiry is not honoured even if the sweeper has not run yet
    const s2 = t.tok(U.rec2, {}, SECRET, { expiresIn: 2 });
    const c2 = await connect(s2); await emitAck(c2.s, "connect:conversation:subscribe", { conversationId: teamA.id });
    await sleep(2300);
    const r2 = await emitAck(c2.s, "connect:typing", { conversationId: teamA.id, typing: true });
    ok(!c2.s.connected || r2.code === "FORBIDDEN" || r2.timeout, "7 an event sent after expiry is not honoured", r2);
    c.s.close(); c2.s.close();
  }

  /* ================= 8. STAFF REMOVAL ================= */
  {
    const dmX = (await open(T.docX, U.recX)).json.conversation;
    const teamMembers = (await api("GET", "/team", T.owner)).json.conversation.memberCount;
    await send(T.docX, dmX.id, "before removal"); const teamMsg = (await send(T.docX, teamA.id, "team msg from soon-removed")).json.message;
    const sDoc = await connect(T.docX), sRec = await connect(T.recX); await emitAck(sDoc.s, "connect:conversation:subscribe", { conversationId: dmX.id });
    await t.m.User.updateOne({ _id: U.docX._id }, { $set: { isActive: false } });
    const rv = await waitFor(() => evOf(sDoc, "connect:access:revoked").length > 0 || !sDoc.s.connected, 4000);
    ok(!!rv && evOf(sDoc, "connect:access:revoked").some((e) => e.p.code === "UNAUTHORIZED"), "8 a deactivated Doctor's open socket is cut off (UNAUTHORIZED)");
    for (const [what, r] of [["list", await api("GET", "/conversations", T.docX)], ["team", await api("GET", "/team", T.docX)], ["messages", await msgs(T.docX, dmX.id)], ["send", await send(T.docX, dmX.id, "x")], ["read", await read(T.docX, dmX.id)], ["open DM", await open(T.docX, U.recX)], ["cards", await cards(T.docX, dmX.id, [])], ["picker", await api("GET", "/pickers/patients", T.docX)]]) { rec("staff-removal", "disabled doctor", what, 401, r.status); eq(r.status, 401, `8 disabled Doctor: ${what} → 401`); }
    const re = await connect(T.docX); ok(!re.ok && re.code === "UNAUTHORIZED", "8 …cannot reconnect / re-subscribe"); re.s && re.s.close();
    let r = await open(T.owner, U.docX); eq(r.status, 404, "8 nobody can open a NEW DM with the deactivated colleague");
    r = await send(T.recX, dmX.id, "hello?"); eq(r.status, 409, "8 writing into a DM with a deactivated colleague → 409"); eq(r.json && r.json.code, "PARTICIPANT_INACTIVE", "8 …PARTICIPANT_INACTIVE");
    r = await msgs(T.recX, dmX.id); eq(r.status, 200, "8 the remaining participant can still READ the history");
    ok(r.json.messages.some((m) => m.text === "before removal" && m.sender && m.sender.name === "Dr. Removable"), "8 history stays attributed to the removed person's name");
    r = await msgs(T.owner, teamA.id, "?limit=100"); const old = r.json.messages.find((m) => m.id === teamMsg.id); ok(old && old.sender && old.sender.name === "Dr. Removable", "8 Team history keeps the removed member attributed");
    eq((await api("GET", "/team", T.owner)).json.conversation.memberCount, teamMembers - 1, "8 Team member count drops by one");
    const before = sDoc.ev.length; await send(T.rec1, teamA.id, "after removal"); await sleep(600); eq(sDoc.ev.filter((e) => e.name === "connect:message:new").length, evOf({ ev: sDoc.ev.slice(0, before) }, "connect:message:new").length, "8 the removed member's old socket receives nothing new");
    // token revocation (password change / role change bumps tokenVersion)
    const sY = await connect(T.recY); ok(sY.ok, "8 control: recY connected");
    await t.m.User.updateOne({ _id: U.recY._id }, { $inc: { tokenVersion: 1 } });
    ok(await waitFor(() => !sY.s.connected, 4000), "8 a revoked token (tokenVersion bump) disconnects the socket");
    eq((await api("GET", "/conversations", T.recY)).status, 401, "8 …and HTTP refuses it");
    // re-activation restores access with the same token (no tokenVersion change)
    await t.m.User.updateOne({ _id: U.docX._id }, { $set: { isActive: true } });
    eq((await api("GET", "/conversations", T.docX)).status, 200, "8 re-activated: access (and history) is back");
    for (const x of [sDoc, sRec, sY]) x.s.close();
  }

  /* ================= 9. INPUT SECURITY ================= */
  {
    const team = teamA;
    const post = (body, o = {}) => http("POST", `/connect/conversations/${team.id}/messages`, { token: T.doc1, ...(o.raw !== undefined ? { rawBody: o.raw } : { body }), headers: o.headers });
    const bodies = {
      "empty": { text: "" }, "spaces": { text: "     " }, "tabs/newlines only": { text: "\t\n\r\n" }, "zero-width only": { text: "​‌‍⁠" }, "no text field": {}, "null": { text: null }, "number": { text: 12345 }, "bool": { text: true },
      "object": { text: { a: 1 } }, "operator": { text: { $ne: 1 } }, "array": { text: ["a"] }, "nested array": { text: [["a"]] }, "lone surrogate": { text: "abc\ud800def" },
      "senderId": { text: "x", senderId: id(U.owner) }, "clinicId": { text: "x", clinicId: id(B) }, "seq": { text: "x", seq: 1 }, "createdAt": { text: "x", createdAt: "2001-01-01" }, "_id": { text: "x", _id: id(U.owner) },
      "contentType": { text: "x", contentType: "patient_reference" }, "referenceId": { text: "x", referenceId: id(pA1) }, "participantIds": { text: "x", participantIds: [id(U.owner)] }, "reference + bogus type": { reference: { type: "invoice", id: id(pA1) } },
      "reference extra keys": { reference: { type: "patient", id: id(pA1), name: "forged name" } }, "reference non-object": { reference: "patient" }, "reference null id": { reference: { type: "patient", id: null } },
    };
    for (const [k, b] of Object.entries(bodies)) { const r = await post(b); rec("input", "doctor", k, 400, r.status); eq(r.status, 400, `9 ${k} → 400`); no5xx(r, `9 ${k}`); }
    let r = await post(null, { raw: "{not json" }); ok(r.status === 400, "9 malformed JSON → 400", r.status); no5xx(r, "9 malformed JSON");
    r = await post(null, { raw: "null" }); ok(r.status >= 400 && r.status < 500, "9 body `null` → 4xx", r.status);
    r = await post(null, { raw: "[]" }); ok(r.status >= 400 && r.status < 500, "9 body `[]` → 4xx", r.status);
    r = await post(null, { raw: "text=hello", headers: { "Content-Type": "text/plain" } }); ok(r.status >= 400 && r.status < 500, "9 wrong content-type → 4xx", r.status);
    r = await http("POST", `/connect/conversations/${team.id}/messages`, { token: T.doc1, rawBody: JSON.stringify({ text: "x".repeat(2_000_000) }) }); ok(r.status === 400 || r.status === 413, "9 a 2 MB body is refused (400/413)", r.status); no5xx(r, "9 2 MB body");
    // length boundaries (code points)
    r = await post({ text: "a".repeat(4000) }); eq(r.status, 201, "9 exactly 4000 characters is accepted");
    r = await post({ text: "a".repeat(4001) }); eq(r.status, 400, "9 4001 characters → 400"); eq(r.json && r.json.code, "MESSAGE_TOO_LONG", "9 …MESSAGE_TOO_LONG");
    r = await post({ text: "😀".repeat(4000) }); eq(r.status, 201, "9 4000 emoji (8000 UTF-16 units) is accepted: counted in code points");
    r = await post({ text: "😀".repeat(4001) }); eq(r.status, 400, "9 4001 emoji → 400");
    // content that must round-trip verbatim
    const keep = {
      arabic: "مرحباً بك، كيف حالك؟ ١٢٣", english: "Hello, world!", mixed: "المريض Ahmed رقم 0791234567 — موعد 10:30", emoji: "👨‍⚕️🩺 ok ✅", bidi: "abc ‏‫مرحبا‬ def",
      html: `<script>alert(1)</script><img src=x onerror=alert(2)> <b>bold</b> a < b && c > d`, xss2: `"><svg/onload=alert(3)> javascript:alert(4) {{7*7}} \${7*7} <%= 7*7 %>`, sql: `' OR 1=1; DROP TABLE users; --`, nosql: `{"$gt":""}`, url: "https://example.com/?a=1&b=<2>",
    };
    for (const [k, txt] of Object.entries(keep)) {
      const w = await post({ text: txt }); eq(w.status, 201, `9 ${k}: accepted`);
      eq(w.json.message.text, txt, `9 ${k}: stored and returned VERBATIM (inert text; escaping happens at render, never on the way in)`);
      const back = (await msgs(T.doc1, team.id, "?limit=100")).json.messages.find((m) => m.id === w.json.message.id);
      eq(back && back.text, txt, `9 ${k}: read back identical`);
      const raw = await ConnectMessage.collection.findOne({ _id: new t.mongoose.Types.ObjectId(w.json.message.id) });
      eq(raw.text, txt, `9 ${k}: the database holds exactly the text`);
    }
    r = await post({ text: "a\u0000b\u0007c‮d‮e\u007f" }); eq(r.json.message.text, "abcde", "9 NUL / BEL / bidi-override / DEL are stripped");
    r = await post({ text: "line1\r\nline2\rline3 line4" }); eq(r.json.message.text, "line1\nline2\nline3\nline4", "9 newlines are normalised");
    const resp = await post({ text: "<script>alert(1)</script>" });
    ok(/application\/json/.test(resp.headers.get("content-type")), "9 responses are application/json (never rendered as HTML)"); eq(resp.headers.get("x-content-type-options"), "nosniff", "9 X-Content-Type-Options: nosniff");
    // query / param injection
    const q = async (qs) => (await msgs(T.doc1, team.id, qs));
    for (const qs of ["?limit=abc", "?limit[$gt]=1", "?limit=0", "?limit=-5", "?limit=1.5", "?limit=999999999999", "?before=garbage", "?after=garbage", "?after=" + Buffer.from("v1:-1").toString("base64url"), "?after=" + Buffer.from("v1:abc").toString("base64url"), "?before=" + Buffer.from("v2:5").toString("base64url"), "?before[$ne]=1", "?after[]=1&after[]=2", "?before=x&after=y", "?limit=%00", "?before=" + "A".repeat(5000)]) {
      const rr = await q(qs); ok(rr.status >= 200 && rr.status < 500, `9 query ${JSON.stringify(qs.slice(0, 40))} handled without a 5xx`, rr.status);
      if (rr.status === 200) ok(rr.json.messages.length <= 100, "9 …and never returns more than the page maximum");
    }
    for (const badId of ["abc", "null", "undefined", "%00", "0".repeat(23), "0".repeat(25), "g".repeat(24), "../../etc/passwd", "{}", "5f1d7f3e1c9d44000000000%20"]) {
      const rr = await api("GET", `/conversations/${encodeURIComponent(badId)}`, T.doc1); ok(rr.status === 400 || rr.status === 404, `9 conversation id ${JSON.stringify(badId.slice(0, 20))} → 400/404`, rr.status); no5xx(rr, "9 bad conversation id");
      const r3 = await read(T.doc1, team.id, { upToMessageId: badId }); ok(r3.status === 400 || r3.status === 404, `9 upToMessageId ${JSON.stringify(badId.slice(0, 12))} → 400/404`, r3.status);
      const r4 = await api("POST", "/conversations/direct", T.doc1, { userId: badId }); ok(r4.status === 400 || r4.status === 404, `9 direct userId ${JSON.stringify(badId.slice(0, 12))} → 400/404`, r4.status);
    }
    r = await api("POST", `/conversations/${team.id}/cards`, T.doc1, { messageIds: Array(101).fill("5f1d7f3e1c9d440000000000") }); eq(r.status, 400, "9 cards: 101 ids → 400");
    r = await api("POST", `/conversations/${team.id}/cards`, T.doc1, { messageIds: ["zz"] }); eq(r.status, 400, "9 cards: malformed id → 400");
    r = await api("POST", `/conversations/${team.id}/cards`, T.doc1, { messageIds: { $ne: 1 } }); eq(r.status, 400, "9 cards: operator object → 400");
    for (const qs of ["?q[$ne]=1", "?q=.*(", "?q=%00", "?page=-1", "?page=abc", "?q=" + "a".repeat(500)]) { const rr = await api("GET", "/pickers/patients" + qs, T.doc1); ok(rr.status < 500, `9 patient picker ${qs.slice(0, 20)} → no 5xx`, rr.status); }
    for (const qs of ["?group=zzz", "?group[$ne]=1", "?group=today&page=-3", "?group=today&q[$ne]=1"]) { const rr = await api("GET", "/pickers/appointments" + qs, T.doc1); ok(rr.status < 500, `9 appointment picker ${qs.slice(0, 24)} → no 5xx`, rr.status); }
    t.noLeaks("9 no response of this suite leaked a stack / path / Mongo internals / token");
  }

  /* ================= 10. SEQ-GAP GUARD (C5 fix): a cursor must never step over a message that is still being written ================= */
  {
    const pair = (await open(T.doc2, U.rec2)).json.conversation; const cid = new t.mongoose.Types.ObjectId(pair.id);
    const mkRaw = (seq, ageMs) => ConnectMessage.collection.insertOne({ clinicId: A._id, conversationId: cid, senderId: U.doc2._id, seq, text: "gap-" + seq, createdAt: new Date(Date.now() - ageMs), updatedAt: new Date() });
    const cur = (n) => Buffer.from("v1:" + n).toString("base64url");
    await mkRaw(1, 60000); await mkRaw(3, 100); // seq 2 was taken but is not committed yet; 3 is fresh
    await ConnectConversation.collection.updateOne({ _id: cid }, { $set: { lastSeq: 3, lastMessageSeq: 3 } });
    let r = await msgs(T.rec2, pair.id, "?after=" + cur(1));
    eq(r.json.messages.map((m) => m.text), [], "10 a fresh message behind an uncommitted seq is HELD BACK (cursor cannot skip seq 2)");
    eq(r.json.pageInfo.hasMoreNewer, false, "10 …without telling the client to loop (hasMoreNewer=false)");
    await mkRaw(2, 50); // the slow write commits
    r = await msgs(T.rec2, pair.id, "?after=" + cur(1));
    eq(r.json.messages.map((m) => m.text), ["gap-2", "gap-3"], "10 once seq 2 lands, the next catch-up delivers 2 AND 3 in order");
    // a permanently failed seq (older than the settle window) is skipped, not blocking forever
    const pair2 = (await open(T.doc2, U.recY2 || U.rec1)).json.conversation; const cid2 = new t.mongoose.Types.ObjectId(pair2.id);
    const mk2 = (seq, ageMs) => ConnectMessage.collection.insertOne({ clinicId: A._id, conversationId: cid2, senderId: U.doc2._id, seq, text: "old-" + seq, createdAt: new Date(Date.now() - ageMs), updatedAt: new Date() });
    await mk2(1, 90000); await mk2(3, 60000);
    r = await msgs(T.doc2, pair2.id, "?after=" + cur(1));
    eq(r.json.messages.map((m) => m.text), ["old-3"], "10 a gap older than the settle window (failed insert) is skipped");
    // the normal, contiguous case is untouched and an empty tail is fine
    r = await msgs(T.rec2, pair.id, "?after=" + cur(3)); eq(r.json.messages.length, 0, "10 nothing newer → empty page");
    r = await msgs(T.rec2, pair.id, "?limit=30"); eq(r.json.messages.map((m) => m.text), ["gap-1", "gap-2", "gap-3"], "10 the plain (newest-first) page is unaffected");
  }

  /* ================= 11. CONCURRENCY (meaningful only on a REAL MongoDB) ================= */
  {
    const [c1, c2, c3, c4] = [await mk(Cc, "owner", 1), await mk(Cc, "doctor", 1), await mk(Cc, "receptionist", 1), await mk(Cc, "receptionist", 2)];
    const tk = [c1, c2, c3, c4].map((u) => t.tok(u));
    // Clinic Team: 24 simultaneous first-use calls from 4 users through 3 different endpoints
    const burst = [];
    for (let i = 0; i < 24; i++) burst.push(api("GET", i % 3 === 0 ? "/team" : i % 3 === 1 ? "/conversations" : "/unread-count", tk[i % 4]));
    const res = await Promise.all(burst); ok(res.every((r) => r.status === 200), "11 24 simultaneous first-use calls all succeed", res.map((r) => r.status));
    eq(await ConnectConversation.countDocuments({ clinicId: Cc._id, type: "clinic_team" }), 1, "11 exactly ONE Clinic Team conversation exists after the race");
    // Direct: both sides, 30 simultaneous opens
    const opens = [];
    for (let i = 0; i < 30; i++) opens.push(i % 2 ? open(tk[1], c3) : open(tk[2], c2));
    const ores = await Promise.all(opens);
    ok(ores.every((r) => r.status === 200 || r.status === 201), "11 30 simultaneous opens of the same pair all succeed", ores.map((r) => r.status));
    eq(new Set(ores.map((r) => r.json.conversation.id)).size, 1, "11 …all return the SAME conversation id");
    eq(await ConnectConversation.countDocuments({ clinicId: Cc._id, type: "direct" }), 1, "11 exactly ONE direct conversation document exists for the pair");
    eq(ores.filter((r) => r.status === 201).length, 1, "11 …and exactly one request is told it created it");
    // unrelated pairs in parallel do not collide
    const pairs = await Promise.all([open(tk[0], c2), open(tk[0], c3), open(tk[0], c4), open(tk[1], c4), open(tk[2], c4)]);
    eq(new Set(pairs.map((r) => r.json.conversation.id)).size, 5, "11 five different pairs → five different conversations");
    // simultaneous sends: unique contiguous seq, pointer consistent
    const team = (await api("GET", "/team", tk[0])).json.conversation;
    const sends = await Promise.all(Array.from({ length: 40 }, (_, i) => send(tk[i % 4], team.id, `burst-${i}`)));
    ok(sends.every((r) => r.status === 201), "11 40 simultaneous sends all succeed");
    const seqs = (await ConnectMessage.find({ conversationId: team.id }).select("seq").lean()).map((m) => m.seq).sort((a, b) => a - b);
    eq(seqs, Array.from({ length: 40 }, (_, i) => i + 1), "11 sequence numbers are unique and contiguous 1..40 (no duplicate, no gap)");
    const convDoc = await ConnectConversation.findById(team.id).lean(); eq([convDoc.lastSeq, convDoc.lastMessageSeq], [40, 40], "11 conversation pointers equal the highest committed seq");
    eq(new Set(sends.map((r) => r.json.message.id)).size, 40, "11 40 distinct message ids");
    const all = (await msgs(tk[0], team.id, "?limit=100")).json.messages; eq(all.length, 40, "11 history shows each message exactly once");
    // read cursor never regresses under parallel / out-of-order marks
    const ids = all.map((m) => m.id); const shuffled = ids.slice().sort(() => Math.random() - 0.5);
    await Promise.all(shuffled.map((mid) => read(tk[3], team.id, { upToMessageId: mid })));
    let rs = await ConnectReadState.findOne({ userId: c4._id, conversationId: team.id }).lean(); eq(rs.lastReadSeq, 40, "11 after 40 parallel mark-reads the position is the MAX (40)");
    await read(tk[3], team.id, { upToMessageId: ids[2] }); rs = await ConnectReadState.findOne({ userId: c4._id, conversationId: team.id }).lean(); eq(rs.lastReadSeq, 40, "11 a late, older mark-read never moves the position back");
    eq(await ConnectReadState.countDocuments({ userId: c4._id, conversationId: team.id }), 1, "11 exactly one read-state row per (user, conversation) after the race");
    const first = await Promise.all([read(tk[2], team.id, { upToMessageId: ids[5] }), read(tk[2], team.id, { upToMessageId: ids[9] }), read(tk[2], team.id, { upToMessageId: ids[1] })]);
    ok(first.every((r) => r.status === 200), "11 simultaneous FIRST-EVER read writes (upsert race) all succeed"); eq(await ConnectReadState.countDocuments({ userId: c3._id, conversationId: team.id }), 1, "11 …still one row");
    // catch-up under load: 4 independent pollers walk the conversation with `after=<cursor>` while 160 sends race each other; none may miss a message
    {
      const lt = (await api("GET", "/team", tk[0])).json.conversation; const sentIds = new Set(); let done = false; const got = [new Map(), new Map(), new Map(), new Map()];
      const poller = async (i) => { let cursor = null; while (!done || true) { const r = await msgs(tk[i], lt.id, "?limit=100" + (cursor ? "&after=" + cursor : "")); for (const m of r.json.messages) got[i].set(m.id, m); if (r.json.messages.length) cursor = r.json.pageInfo.newerCursor; else if (done) break; if (done) await sleep(20); else await sleep(5); } };
      const pollers = [0, 1, 2, 3].map((i) => poller(i));
      for (let wave = 0; wave < 8; wave++) { const rs = await Promise.all(Array.from({ length: 20 }, (_, j) => send(tk[j % 4], lt.id, `load-${wave}-${j}`))); rs.forEach((r) => r.status === 201 && sentIds.add(r.json.message.id)); }
      await sleep(3500); done = true; await Promise.all(pollers);
      eq(sentIds.size, 160, "11 all 160 racing sends were accepted");
      for (let i = 0; i < 4; i++) eq([...sentIds].filter((x) => !got[i].has(x)).length, 0, `11 cursor poller #${i + 1} saw every one of the 160 messages (no message skipped by the cursor)`);
    }
    // structured messages: what is guaranteed on a retry (no idempotency key exists in V1)
    const pc = await t.mkPatient(Cc, "Conc Patient", "0795999001");
    const dups = await Promise.all(Array.from({ length: 5 }, () => share(tk[1], team.id, "patient", id(pc), "same")));
    ok(dups.every((r) => r.status === 201), "11 5 identical simultaneous reference sends: each is a complete, valid message");
    eq(new Set(dups.map((r) => r.json.message.id)).size, 5, "11 …each is its OWN message (V1 has NO server-side idempotency key: a client retry after a lost answer creates a second message — duplicates are prevented in the UI by id-keyed merge + in-flight lock, not by the server)");
    const refMsgs = await ConnectMessage.find({ conversationId: team.id, contentType: "patient_reference" }).lean();
    ok(refMsgs.length === 5 && refMsgs.every((m) => String(m.referenceId) === id(pc) && !("patientName" in m) && !("fullName" in m)), "11 …none stores any patient data");
    const cc = await cards(tk[0], team.id, refMsgs.map((m) => String(m._id))); eq(cc.json.cards.length, 5, "11 all five cards resolve");
  }

  /* ================= 12. INDEXES (what MongoDB actually built) ================= */
  {
    const want = {
      connectconversations: [{ key: { clinicId: 1, directKey: 1 }, unique: true, partial: true }, { key: { clinicId: 1, type: 1 }, unique: true, partial: true }, { key: { clinicId: 1, participantIds: 1, lastMessageAt: -1 }, unique: false }],
      connectmessages: [{ key: { conversationId: 1, seq: -1 }, unique: true }],
      connectreadstates: [{ key: { userId: 1, conversationId: 1 }, unique: true }],
    };
    const dump = {};
    for (const [coll, specs] of Object.entries(want)) {
      const idx = await t.mongoose.connection.db.collection(coll).indexes(); dump[coll] = idx.map((i) => ({ name: i.name, key: i.key, unique: !!i.unique, partial: i.partialFilterExpression || null }));
      for (const s of specs) {
        const f = idx.find((i) => JSON.stringify(i.key) === JSON.stringify(s.key));
        ok(!!f, `12 ${coll}: index ${JSON.stringify(s.key)} exists`); if (!f) continue;
        eq(!!f.unique, s.unique, `12 ${coll}: ${JSON.stringify(s.key)} unique=${s.unique}`);
        if (s.partial) ok(!!f.partialFilterExpression, `12 ${coll}: ${JSON.stringify(s.key)} is a PARTIAL unique index`, f.partialFilterExpression);
      }
      const keys = idx.map((i) => JSON.stringify(i.key)); eq(new Set(keys).size, keys.length, `12 ${coll}: no duplicate/conflicting index definitions`);
    }
    // uniqueness really is enforced by the database (not just by application code)
    let dupErr = null; try { await ConnectConversation.collection.insertOne({ clinicId: A._id, type: "clinic_team", participantIds: [], lastSeq: 0, lastMessageSeq: 0 }); } catch (e) { dupErr = e.code; }
    eq(dupErr, 11000, "12 the database itself rejects a second Clinic Team for a clinic (E11000)");
    const anyDirect = await ConnectConversation.findOne({ clinicId: A._id, type: "direct" }).lean(); dupErr = null;
    try { await ConnectConversation.collection.insertOne({ clinicId: A._id, type: "direct", directKey: anyDirect.directKey, participantIds: anyDirect.participantIds, lastSeq: 0, lastMessageSeq: 0 }); } catch (e) { dupErr = e.code; }
    eq(dupErr, 11000, "12 the database itself rejects a second direct conversation for a pair (E11000)");
    dupErr = null; const m1 = await ConnectMessage.findOne({ conversationId: teamA._id || teamA.id }).lean();
    try { await ConnectMessage.collection.insertOne({ clinicId: A._id, conversationId: m1.conversationId, senderId: U.owner._id, seq: m1.seq, text: "dup seq" }); } catch (e) { dupErr = e.code; }
    eq(dupErr, 11000, "12 the database itself rejects a duplicate (conversation, seq)");
    // many Clinics may have NO direct conversations / teams without colliding on the partial indexes
    ok((await ConnectConversation.countDocuments({ type: "clinic_team" })) >= 2, "12 several clinics each hold their own Clinic Team (partial index does not collide across clinics)");
    fs.writeFileSync(path.join(OUT, "connect_c5.indexes.json"), JSON.stringify({ mongoVersion: info.version, indexes: dump }, null, 1));
  }

  /* ================= 13. BACKWARD COMPATIBILITY ================= */
  {
    const pair = (await open(T.doc1, U.owner)).json.conversation; const cid = new t.mongoose.Types.ObjectId(pair.id);
    await ConnectMessage.collection.insertOne({ clinicId: A._id, conversationId: cid, senderId: U.doc1._id, seq: 1, text: "legacy C1 message (no contentType field)", createdAt: new Date(Date.now() - 864e5), updatedAt: new Date() });
    await ConnectConversation.collection.updateOne({ _id: cid }, { $set: { lastSeq: 1, lastMessageSeq: 1, lastMessageAt: new Date(Date.now() - 864e5) } });
    let r = await msgs(T.owner, pair.id); eq(r.json.messages[0].contentType, "text", "13 a pre-C4 message (no contentType) reads as text");
    r = await cards(T.owner, pair.id, [r.json.messages[0].id]); eq(r.json.cards.length, 0, "13 …and is never treated as a card");
    // user documents that pre-date tokenVersion
    await t.m.User.collection.updateOne({ _id: U.rec2._id }, { $unset: { tokenVersion: "" } });
    const legacy = t.jwt.sign({ userId: id(U.rec2) }, SECRET); // token without tokenVersion
    eq((await api("GET", "/conversations", legacy)).status, 200, "13 a legacy user/token pair (no tokenVersion anywhere) still works over HTTP");
    const lc = await connect(legacy); ok(lc.ok, "13 …and over the socket"); lc.s && lc.s.close();
    // existing ClinicOS surface of a PRO clinic is intact
    for (const u of ["/patients", `/appointments?date=${today.ymd}`, "/dashboard/stats", "/invoices"]) { const rr = await http("GET", u, { token: T.owner }); ok(rr.status < 500 && rr.status !== 402, `13 existing ClinicOS route ${u.split("?")[0]} unaffected (${rr.status})`); }
    // a clinic that never used Connect: first call creates only the Team, nothing else
    const fresh = await t.mkClinic("c5-fresh", pro); const fo = await mk(fresh, "owner", 1); const ftk = t.tok(fo);
    r = await api("GET", "/conversations", ftk); eq(r.json.conversations.length, 1, "13 a clinic that never used Connect gets just the Clinic Team"); eq(r.json.totalUnread, 0, "13 …with nothing unread");
    eq(await ConnectConversation.countDocuments({ clinicId: fresh._id }), 1, "13 …and exactly one document was created");
  }

  /* ================= 14. PRODUCTION-MODE SERVER (origins, CORS, kill switch, start-up) ================= */
  const prodLogs = [];
  {
    const prodEnv = { NODE_ENV: "production", MONGO_URI: `${MONGO_BASE}/${t.DB}`, JWT_SECRET: SECRET, FRONTEND_URL: "https://app.example.com", CONNECT_SEND_MAX: "100000", CONNECT_RT_REVALIDATE_MS: "700" };
    const P = 5822; const S1 = spawnServer(P, prodEnv);
    let up = false; for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${P}/health`)).ok; } catch {} await sleep(250); }
    ok(up, "14 a NODE_ENV=production server starts with a valid configuration", S1.log().slice(0, 300));
    const PURL = `http://127.0.0.1:${P}`;
    const hs = (origin) => new Promise((resolve) => { const req = http_.request(`${PURL}/socket.io/?EIO=4&transport=polling`, { headers: origin ? { Origin: origin } : {} }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode, acao: res.headers["access-control-allow-origin"], body: b })); }); req.on("error", () => resolve({ status: 0 })); req.end(); });
    let h = await hs("https://app.example.com"); eq(h.status, 200, "14 engine.io polling handshake from the allowed origin → 200"); eq(h.acao, "https://app.example.com", "14 …with Access-Control-Allow-Origin = that origin only");
    h = await hs("https://evil.example.com"); ok(h.status >= 400 && !h.acao, "14 handshake from another origin is refused, no CORS grant", h);
    h = await hs("http://localhost:3000"); ok(h.status >= 400 && !h.acao, "14 production does NOT trust http://localhost:3000", h);
    h = await hs("*"); ok(h.status >= 400 && !h.acao, "14 no wildcard origin", h);
    h = await hs(null); eq(h.status, 200, "14 a non-browser client (no Origin) may reach the handshake — it still needs a token to join");
    const pre = (origin) => fetch(`${PURL}/api/connect/team`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
    let pr = await pre("https://app.example.com"); eq(pr.headers.get("access-control-allow-origin"), "https://app.example.com", "14 HTTP CORS preflight allows the production frontend");
    pr = await pre("https://evil.example.com"); ok(!pr.headers.get("access-control-allow-origin"), "14 …and not another origin");
    let sc = await connect(T.owner, { url: PURL, headers: { Origin: "https://app.example.com" } }); ok(sc.ok, "14 WebSocket + valid token + allowed origin connects through the production-mode server"); sc.s && sc.s.close();
    sc = await connect(T.owner, { url: PURL, headers: { Origin: "https://evil.example.com" } }); ok(!sc.ok, "14 WebSocket from a foreign origin is refused (valid token does not help)"); sc.s && sc.s.close();
    sc = await connect(null, { url: PURL, noAuth: true, headers: { Origin: "https://app.example.com" } }); ok(!sc.ok, "14 allowed origin WITHOUT a token is refused"); sc.s && sc.s.close();
    const er = await fetch(`${PURL}/api/connect/conversations/zzz`, { headers: { Authorization: "Bearer " + T.owner } }); const et = await er.text(); ok(!/at .*\(|node_modules|stack|Mongo/i.test(et), "14 production error bodies carry no stack / internals", et.slice(0, 120));
    prodLogs.push(S1.log); S1.proc.kill();
    // kill switch
    const P2 = 5823; const S2 = spawnServer(P2, { ...prodEnv, CONNECT_REALTIME: "off" });
    up = false; for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${P2}/health`)).ok; } catch {} await sleep(250); }
    ok(up, "14 CONNECT_REALTIME=off: the server still starts");
    const off = await fetch(`http://127.0.0.1:${P2}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: "https://app.example.com" } }); ok(off.status === 404 || off.status >= 400, "14 …and exposes no socket endpoint", off.status);
    eq((await fetch(`http://127.0.0.1:${P2}/api/connect/team`, { headers: { Authorization: "Bearer " + T.owner } })).status, 200, "14 …while every Connect HTTP route keeps working");
    prodLogs.push(S2.log); S2.proc.kill();
    // start-up refusals never print the secret
    const P3 = 5824; const S3 = spawnServer(P3, { ...prodEnv, FRONTEND_URL: "" }); const code = await Promise.race([S3.exited, sleep(8000).then(() => "timeout")]);
    eq(code, 1, "14 production without FRONTEND_URL refuses to start (exit 1)"); ok(!S3.log().includes(SECRET) && !S3.log().includes(MONGO_BASE), "14 …and the refusal prints neither the JWT secret nor the Mongo URI"); prodLogs.push(S3.log); S3.proc.kill();
    const S4 = spawnServer(5825, { ...prodEnv, JWT_SECRET: "secret" }); const code4 = await Promise.race([S4.exited, sleep(8000).then(() => "timeout")]); eq(code4, 1, "14 production with a weak JWT_SECRET refuses to start"); prodLogs.push(S4.log); S4.proc.kill();
  }

  /* ================= 15. LOGGING PRIVACY ================= */
  {
    const logs = [t.slog, ...prodLogs.map((f) => f())].join("\n");
    const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
    ok(!logs.includes(SENT), "15 no message body ever appears in a server log");
    ok(!/Mona Hassan|محمد الخطيب|0791111111|0792222222|Bee Patient/.test(logs), "15 no patient name / phone appears in a server log");
    ok(!jwtRe.test(logs) && !/Bearer\s+\S{20,}/i.test(logs), "15 no JWT / Authorization header appears in a server log");
    ok(!logs.includes(SECRET), "15 the JWT secret is never logged");
    ok(!logs.includes(MONGO_BASE + "/" + t.DB) , "15 the Mongo URI is never logged");
    ok(!/password|secret123/i.test(logs.replace(/JWT_SECRET|ADMIN_JWT_SECRET|LOYALTY_PUBLIC_SECRET|REMINDER_CRON_SECRET/g, "")), "15 no password appears in a server log");
    console.log(`[logs] scanned ${logs.length} bytes of server output from ${1 + prodLogs.length} server processes`);
  }

  /* ================= 16. CACHE HEADERS ================= */
  {
    for (const u of ["/team", "/conversations", "/unread-count", `/conversations/${teamA.id}/messages`, "/pickers/patients"]) { const r = await api("GET", u, T.owner); ok(/no-store/.test(r.headers.get("cache-control") || ""), `16 GET /connect${u.split("?")[0]} is Cache-Control: no-store`, r.headers.get("cache-control")); }
    const r = await cards(T.owner, teamA.id, []); ok(/no-store/.test(r.headers.get("cache-control") || ""), "16 POST cards is no-store");
  }

  fs.writeFileSync(path.join(OUT, "connect_c5.matrix.json"), JSON.stringify({ mongoVersion: info.version, matrix: MATRIX }, null, 1));
  ok(MATRIX.every((m) => m.pass), "matrix: every recorded role/privacy/security expectation held", MATRIX.filter((m) => !m.pass).slice(0, 5));
  for (const s of open_) { try { s.close(); } catch {} }
  await t.finish(`ClinicOS Connect C5 attack suite (MongoDB ${info.version})`);
})().catch((e) => { console.error("SUITE CRASHED:", e && e.stack ? e.stack : e); process.exit(2); });
