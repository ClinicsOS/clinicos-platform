/* CLINICOS CONNECT — Phase C3: realtime delivery layer (Socket.IO) — authentication, entitlement, rooms/privacy, delivery, read/Seen, typing, abuse, restart.
   End-to-end against the COMPILED server: real sockets (socket.io-client over WebSocket), real HTTP, real database. Nothing is mocked.
     npm run build && node tests/connect/connect-c3.test.js
   Needs `socket.io-client` (devDependency of backEnd). Optional env: P10_MONGO, P10_DIST, P10_NM, P10_OUT (as the other suites).
   Labels: T<n> = the numbered scenarios of the C3 brief that a server-side suite can prove; P-* = parity with the HTTP gate; X-* = extra hardening.
   Browser-level scenarios of the brief (duplicates in the UI, scroll, badge, 3D, reduced motion, tabs) live in frontEnd/tests/connect/e2e/connect-c3.e2e.mjs. */
const path = require("path");
const { boot, spawnServer, sleep, MONGO_BASE } = require("../phase10/lib");

const NM = process.env.P10_NM || path.resolve(__dirname, "../../node_modules");
const { io: ioClient } = require(`${NM}/socket.io-client`);

(async () => {
  const PORT = 5801;
  const ENV = { CONNECT_SEND_MAX: "100000", CONNECT_OPEN_MAX: "100000", CONNECT_READ_MAX: "100000", CONNECT_RT_REVALIDATE_MS: "700", CONNECT_RT_MAX_SOCKETS_PER_USER: "8" };
  const t = await boot({ name: "connect_c3", port: PORT, env: ENV });
  const { ok, eq, http } = t;
  const DIST = t.D;
  const { ConnectConversation } = require(`${DIST}/models/ConnectConversation`);
  const { ConnectMessage } = require(`${DIST}/models/ConnectMessage`);
  const { ConnectReadState } = require(`${DIST}/models/ConnectReadState`);
  await Promise.all([ConnectConversation.init(), ConnectMessage.init(), ConnectReadState.init()]);
  const URL = `http://127.0.0.1:${PORT}`;

  /* ---------------- world ---------------- */
  const pro = { plan: "pro" };
  const A = await t.mkClinic("c3-a", pro), B = await t.mkClinic("c3-b", pro);
  const Cb = await t.mkClinic("c3-basic", { plan: "basic" }), Dt = await t.mkClinic("c3-trial", { plan: "trial" });
  const Ex = await t.mkClinic("c3-expired-pro", { plan: "pro", planExpiresAt: new Date(Date.now() - 864e5) });
  const ExT = await t.mkClinic("c3-expired-trial", { plan: "trial", planExpiresAt: new Date(Date.now() - 864e5) });
  const Su = await t.mkClinic("c3-suspended", { plan: "pro", status: "suspended" });
  const mk = (c, role, n, name) => t.m.User.create({ clinicId: c._id, name: name || `${role} ${n}`, email: `${role}${n}-${c.slug}@t.io`, password: "secret123", role, emailVerified: true });
  const U = {
    owner: await mk(A, "owner", 1, "Amjad Owner"), doc1: await mk(A, "doctor", 1, "Dr. Sarah"), doc2: await mk(A, "doctor", 2, "د. أحمد"), doc3: await mk(A, "doctor", 3, "Dr. Third"), rec1: await mk(A, "receptionist", 1, "Lina"),
    ownerB: await mk(B, "owner", 1), docB: await mk(B, "doctor", 1), recB: await mk(B, "receptionist", 1),
    ownerC: await mk(Cb, "owner", 1), ownerD: await mk(Dt, "owner", 1), ownerX: await mk(Ex, "owner", 1), ownerXT: await mk(ExT, "owner", 1), ownerS: await mk(Su, "owner", 1),
  };
  const T = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, t.tok(u)]));
  const id = (x) => String(x._id);
  const api = (method, url, token, body) => http(method, "/connect" + url, { token, body });
  const open = (token, other) => api("POST", "/conversations/direct", token, { userId: id(other) });
  const send = (token, convId, text) => api("POST", `/conversations/${convId}/messages`, token, { text });
  const read = (token, convId, body) => api("POST", `/conversations/${convId}/read`, token, body || {});
  const msgs = (token, convId, q = "") => api("GET", `/conversations/${convId}/messages${q}`, token);

  /* ---------------- socket helpers ---------------- */
  const open_ = [];
  /** Connects and records EVERY event the server sends. Resolves { ok, s, ev } or { ok:false, code }. */
  const connect = (token, o = {}) =>
    new Promise((resolve) => {
      const s = ioClient(URL, { auth: { token }, transports: ["websocket"], reconnection: false, forceNew: true, timeout: 5000, ...(o.opts || {}) });
      const ev = [];
      s.onAny((name, p) => ev.push({ name, p, at: Date.now() }));
      open_.push(s);
      s.on("connect", () => resolve({ ok: true, s, ev }));
      s.on("connect_error", (e) => resolve({ ok: false, code: e && e.data && e.data.code, message: e && e.message, s, ev }));
    });
  const emitAck = (s, event, payload) => new Promise((resolve) => { const to = setTimeout(() => resolve({ timeout: true }), 3000); s.emit(event, payload, (r) => { clearTimeout(to); resolve(r); }); });
  const waitFor = async (fn, ms = 4000, step = 25) => { const end = Date.now() + ms; for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) return null; await sleep(step); } };
  const evOf = (c, name) => c.ev.filter((e) => e.name === name);
  const newMsgEv = (c, text) => evOf(c, "connect:message:new").find((e) => e.p && e.p.message && e.p.message.text === text);
  const clear = (...cs) => cs.forEach((c) => (c.ev.length = 0));

  /* ================= T1–T3: every role gets an authorised realtime session in a PRO clinic ================= */
  const c = {};
  for (const [n, who] of [[1, "owner"], [2, "doc1"], [3, "rec1"]]) {
    c[who] = await connect(T[who]);
    ok(c[who].ok && c[who].s.connected, `T${n} PRO ${who} establishes an authorised realtime session`, c[who].code);
  }
  c.doc2 = await connect(T.doc2); c.doc3 = await connect(T.doc3);
  c.ownerB = await connect(T.ownerB); c.docB = await connect(T.docB);
  ok(c.doc2.ok && c.doc3.ok && c.ownerB.ok && c.docB.ok, "world: the other connections of the suite are up");

  /* ================= T4 + P-*: the entitlement is the same as the HTTP gate ================= */
  const matrix = [
    ["pro / active", "owner", true, null], ["basic", "ownerC", false, "PLAN_LIMIT"], ["trial / active", "ownerD", false, "PLAN_LIMIT"],
    ["pro / expired", "ownerX", false, "PLAN_LIMIT"], ["trial / expired", "ownerXT", false, "EXPIRED"], ["pro / suspended", "ownerS", false, "SUSPENDED"],
  ];
  for (const [label, who, allowed, code] of matrix) {
    const sock = await connect(T[who]); // socket FIRST (the HTTP gate downgrades an expired paid plan as a side effect)
    const h = await api("GET", "/conversations", T[who]);
    if (allowed) ok(sock.ok && h.status === 200, `P ${label}: realtime AND HTTP both allow`, { sock: sock.code, http: h.status });
    else {
      ok(!sock.ok && sock.code === code, `T4 ${label}: realtime refuses with ${code}`, sock.code);
      ok(h.status === 402 && h.json.code === code, `P ${label}: the HTTP gate answers the same code (${code})`, h.json);
    }
    if (!allowed) ok(sock.s && sock.s.connected === false && evOf(sock, "connect:message:new").length === 0, `T4 ${label}: no usable subscription was established`);
  }

  /* ================= T5: unauthenticated / forged connections are refused ================= */
  const jwt = t.jwt;
  const sNone = await connect(undefined);
  ok(!sNone.ok && sNone.code === "UNAUTHORIZED", "T5 no token → refused", sNone.code);
  const sGarbage = await connect("not-a-token-at-all-not-a-token");
  ok(!sGarbage.ok && sGarbage.code === "UNAUTHORIZED", "T5 garbage token → refused", sGarbage.code);
  const sWrongKey = await connect(jwt.sign({ userId: id(U.owner), tokenVersion: 0 }, "some-other-secret-0123456789abcdef"));
  ok(!sWrongKey.ok && sWrongKey.code === "UNAUTHORIZED", "T5 token signed with another key → refused", sWrongKey.code);
  const sPatientShape = await connect(jwt.sign({ userId: id(U.owner), typ: "loyalty", aud: "x", cid: id(A) }, t.SECRET));
  ok(!sPatientShape.ok && sPatientShape.code === "UNAUTHORIZED", "T5 a token that is not a staff token (loyalty / admin shape) → refused", sPatientShape.code);
  const sNone2 = await connect(jwt.sign({ userId: id(U.owner), tokenVersion: 0 }, t.SECRET, { algorithm: "HS384" }));
  ok(!sNone2.ok && sNone2.code === "UNAUTHORIZED", "T5 a token with a different signing algorithm → refused", sNone2.code);
  const sExpiredTok = await connect(jwt.sign({ userId: id(U.owner), tokenVersion: 0 }, t.SECRET, { expiresIn: -10 }));
  ok(!sExpiredTok.ok && sExpiredTok.code === "UNAUTHORIZED", "T5 an expired token → refused", sExpiredTok.code);
  const sAlg = await connect(Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url") + "." + Buffer.from(JSON.stringify({ userId: id(U.owner) })).toString("base64url") + ".");
  ok(!sAlg.ok && sAlg.code === "UNAUTHORIZED", "T5 alg=none → refused", sAlg.code);

  /* ================= conversations used below ================= */
  const team = (await api("GET", "/team", T.owner)).json.conversation;
  const dmDocRec = (await open(T.doc1, U.rec1)).json.conversation; // owner is NOT a participant
  const dmDocDoc = (await open(T.doc1, U.doc2)).json.conversation; // doc3 is NOT a participant
  const dmOwnerDoc = (await open(T.owner, U.doc1)).json.conversation;
  const teamB = (await api("GET", "/team", T.ownerB)).json.conversation;
  const dmB = (await open(T.docB, U.recB)).json.conversation;

  /* ================= T7–T10, T25–T27: subscription is decided by the server ================= */
  ok((await emitAck(c.doc1.s, "connect:conversation:subscribe", { conversationId: dmDocRec.id })).ok === true, "T7 a participant may subscribe to their own direct conversation");
  ok((await emitAck(c.owner.s, "connect:conversation:subscribe", { conversationId: team.id })).ok === true, "T7 every member may subscribe to the Clinic Team");
  for (const [label, sock, cid] of [
    ["T7 clinic A cannot subscribe to clinic B's Clinic Team", c.doc1, teamB.id],
    ["T7 clinic A cannot subscribe to clinic B's direct conversation", c.owner, dmB.id],
    ["T9 the Owner cannot subscribe to an unrelated Doctor ↔ Receptionist DM", c.owner, dmDocRec.id],
    ["T10 a Doctor cannot subscribe to an unrelated Doctor ↔ Doctor DM", c.doc3, dmDocDoc.id],
    ["T10 a Receptionist cannot subscribe to an unrelated Doctor ↔ Doctor DM", c.rec1, dmDocDoc.id],
  ]) {
    const r = await emitAck(sock.s, "connect:conversation:subscribe", { conversationId: cid });
    ok(r.ok === false && r.code === "NOT_FOUND", label, r);
  }
  const ghost = await emitAck(c.owner.s, "connect:conversation:subscribe", { conversationId: "a".repeat(24) });
  eq(ghost.code, "NOT_FOUND", "T25 a well-formed id that does not exist answers exactly like a forbidden one (no existence oracle)");
  for (const bad of ["zzz", "", "a".repeat(23), "../../etc/passwd", "{$ne:1}"]) {
    const r = await emitAck(c.owner.s, "connect:conversation:subscribe", { conversationId: bad });
    ok(r.ok === false && (r.code === "INVALID_ID" || r.code === "INVALID_PAYLOAD"), `T25 invalid conversation id ${JSON.stringify(bad).slice(0, 24)} is handled safely`, r);
  }
  for (const bad of [null, 5, [], "x", { conversationId: { $ne: null } }, { conversationId: 7 }]) {
    const r = await emitAck(c.owner.s, "connect:conversation:subscribe", bad);
    ok(r.ok === false && r.code === "INVALID_PAYLOAD", `T25 malformed payload ${JSON.stringify(bad)} is rejected`, r);
  }
  ok((await fetch(`http://127.0.0.1:${PORT}/health`)).ok && c.owner.s.connected, "T25 the server and the connection are still healthy after all that");
  const spoofClinic = await emitAck(c.owner.s, "connect:conversation:subscribe", { conversationId: teamB.id, clinicId: id(B) });
  ok(spoofClinic.ok === false && spoofClinic.code === "INVALID_PAYLOAD", "T26 a payload carrying a clinicId is rejected", spoofClinic);
  const spoofClinic2 = await emitAck(c.owner.s, "connect:conversation:subscribe", { conversationId: team.id, clinicId: id(B) });
  ok(spoofClinic2.ok === false, "T26 …even for a conversation the caller could otherwise open", spoofClinic2);
  const spoofSender = await emitAck(c.doc1.s, "connect:typing", { conversationId: dmDocRec.id, typing: true, senderId: id(U.doc2) });
  ok(spoofSender.ok === false && spoofSender.code === "INVALID_PAYLOAD", "T27 a typing payload carrying a senderId is rejected", spoofSender);
  const spoofUser = await emitAck(c.doc1.s, "connect:typing", { conversationId: dmDocRec.id, typing: true, userId: id(U.doc2) });
  ok(spoofUser.ok === false && spoofUser.code === "INVALID_PAYLOAD", "T27 …and so is a userId", spoofUser);
  const spoofRole = await emitAck(c.rec1.s, "connect:conversation:subscribe", { conversationId: team.id, role: "owner" });
  ok(spoofRole.ok === false, "T26 …and a role", spoofRole);
  // identity in the handshake is read from the token only: extra fields change nothing
  const sSpoofAuth = await connect(T.rec1, { opts: { auth: { token: T.rec1, userId: id(U.owner), clinicId: id(B), role: "owner" } } });
  ok(sSpoofAuth.ok, "T26 handshake with spoofed identity fields still connects — as the TOKEN's user");
  eq((await emitAck(sSpoofAuth.s, "connect:conversation:subscribe", { conversationId: dmDocRec.id })).ok, true, "T26 …who is the Receptionist (a participant of that DM), not the spoofed Owner");
  eq((await emitAck(sSpoofAuth.s, "connect:conversation:subscribe", { conversationId: teamB.id })).code, "NOT_FOUND", "T26 …and not a member of clinic B");
  sSpoofAuth.s.close();
  // there is no way to create a message through the socket
  const before = await ConnectMessage.countDocuments({ conversationId: dmDocRec.id });
  for (const ev of ["connect:message:send", "connect:message:new", "message", "send", "connect:read", "connect:read:self", "connect:read:peer"]) c.doc1.s.emit(ev, { conversationId: dmDocRec.id, text: "forged", senderId: id(U.doc2) });
  await sleep(300);
  eq(await ConnectMessage.countDocuments({ conversationId: dmDocRec.id }), before, "T27 a message cannot be created (or spoofed) through the socket — only through the C1 HTTP API");
  ok(c.rec1.ev.length === 0 && c.owner.ev.length === 0, "T24/T27 forged client events were relayed to nobody", { rec: c.rec1.ev.length, owner: c.owner.ev.length });

  /* ================= T11–T13, T18–T21, T28–T29: delivery ================= */
  clear(c.owner, c.doc1, c.rec1, c.doc2, c.doc3, c.ownerB, c.docB);
  const t0 = Date.now();
  const m1 = await send(T.rec1, dmDocRec.id, "Hello doctor — realtime");
  eq(m1.status, 201, "T11 the C1 HTTP send still answers 201");
  const e1 = await waitFor(() => newMsgEv(c.doc1, "Hello doctor — realtime"));
  ok(!!e1, "T11 the DM recipient receives the new message immediately (no refresh, no polling)");
  ok(e1 && Date.now() - t0 < 1500, "T11 …within 1.5 s of the send", e1 && e1.at - t0);
  ok(e1 && e1.p.v === 1 && e1.p.message.id === m1.json.message.id && e1.p.message.cursor === m1.json.message.cursor, "T14/T15 the event carries the SERVER message id + cursor (canonical identity for UI reconciliation)");
  ok(e1 && e1.p.message.senderId === id(U.rec1) && e1.p.message.sender && e1.p.message.sender.name === "Lina", "T11 the sender identity is the authenticated sender, resolved on the server");
  eq(e1 && e1.p.unreadCount, 1, "T20 the event carries the recipient's real unread count (1)");
  eq(e1 && e1.p.preview, "Hello doctor — realtime", "T18 …and the list preview");
  eq(e1 && e1.p.conversation, { id: dmDocRec.id, type: "direct" }, "T11 …and the conversation reference");
  const persisted = await ConnectMessage.findById(m1.json.message.id).lean();
  ok(persisted && persisted.text === "Hello doctor — realtime", "PERSIST-FIRST: by the time the event exists the message is stored");
  // the recipient can fetch it over HTTP the instant the event arrives (it was committed before the emit)
  const got = await msgs(T.doc1, dmDocRec.id, `?after=${encodeURIComponent(m1.json.message.cursor)}`);
  eq(got.status, 200, "PERSIST-FIRST: HTTP read works right after the event");
  const eSelf = await waitFor(() => newMsgEv(c.rec1, "Hello doctor — realtime"));
  ok(!!eSelf && eSelf.p.unreadCount === 0 && eSelf.p.message.id === m1.json.message.id, "T14/T30 the sender's OWN other devices get the same message id with unread 0 (reconciled by id, never a second copy)");
  eq(evOf(c.doc1, "connect:message:new").length, 1, "T15 the recipient got exactly ONE event for one message");
  ok(![c.owner, c.doc2, c.doc3, c.ownerB, c.docB].some((x) => x.ev.length), "T12 NOBODY else received any event (Owner, other doctors, other clinic)", [c.owner, c.doc2, c.doc3, c.ownerB, c.docB].map((x) => x.ev.length));
  // unread counting + ordering
  await send(T.rec1, dmDocRec.id, "second");
  const e2 = await waitFor(() => newMsgEv(c.doc1, "second"));
  eq(e2 && e2.p.unreadCount, 2, "T20 the unread count keeps counting (2)");
  ok(e2 && e1 && e2.p.message.cursor !== e1.p.message.cursor, "T19 each message has its own ordered cursor");
  // Arabic / mixed / unicode
  const ar = "مرحباً دكتور، المريض وصل 123 ✅";
  const mixed = "Patient أحمد arrived — الساعة 10:30 😀 <b>x</b>";
  await send(T.rec1, dmDocRec.id, ar); await send(T.rec1, dmDocRec.id, mixed);
  ok(!!(await waitFor(() => newMsgEv(c.doc1, ar))), "T28 an Arabic message arrives intact");
  ok(!!(await waitFor(() => newMsgEv(c.doc1, mixed))), "T29 mixed Arabic/English/emoji/markup text arrives byte-for-byte (rendered as text by the UI)");
  // Clinic Team
  clear(c.owner, c.doc1, c.rec1, c.doc2, c.doc3, c.ownerB, c.docB);
  const tm = await send(T.doc1, team.id, "Team broadcast");
  for (const who of ["owner", "rec1", "doc2", "doc3"]) ok(!!(await waitFor(() => newMsgEv(c[who], "Team broadcast"))), `T13 the Clinic Team message reaches ${who}`);
  const own = await waitFor(() => newMsgEv(c.doc1, "Team broadcast"));
  ok(own && own.p.unreadCount === 0 && own.p.message.id === tm.json.message.id, "T13 the sender's own device gets it with unread 0");
  await sleep(200);
  ok(![c.ownerB, c.docB].some((x) => x.ev.length), "T8 clinic B received NOTHING from clinic A's team (or anything else)");
  const teamEv = newMsgEv(c.owner, "Team broadcast");
  eq(teamEv && teamEv.p.unreadCount, 1, "T20 Clinic Team unread is per member (1 for the Owner)");
  // clinic B's traffic does not reach clinic A
  clear(c.owner, c.doc1, c.rec1, c.doc2, c.doc3);
  await send(T.docB, dmB.id, "B-ONLY-SECRET"); await send(T.ownerB, teamB.id, "B-TEAM-SECRET");
  await sleep(500);
  ok(![c.owner, c.doc1, c.rec1, c.doc2, c.doc3].some((x) => JSON.stringify(x.ev).includes("B-")), "T8 clinic A received nothing of clinic B's DM or team");
  ok(!!newMsgEv(c.docB, "B-TEAM-SECRET") && c.ownerB.ev.some((e) => e.p && e.p.message && e.p.message.text === "B-TEAM-SECRET"), "T8 …while clinic B's own members did (the clinics are isolated, not broken)");

  /* ================= T9/T12: the Owner is not a private-DM audience ================= */
  clear(c.owner, c.doc3);
  const secret = "OWNER-MUST-NOT-SEE-THIS-دردشة-خاصة";
  await send(T.doc1, dmDocRec.id, secret); await send(T.rec1, dmDocRec.id, secret + " reply"); await send(T.doc1, dmDocDoc.id, secret + " doc-doc");
  await sleep(600);
  ok(!JSON.stringify(c.owner.ev).includes("OWNER-MUST-NOT") && !JSON.stringify(c.owner.ev).includes(dmDocRec.id) && !JSON.stringify(c.owner.ev).includes(dmDocDoc.id), "T9 the Owner received NO message, preview, conversation id or sender of the private DMs (even over HTTP-less realtime)", c.owner.ev.length);
  ok(!JSON.stringify(c.doc3.ev).includes("OWNER-MUST-NOT") && !JSON.stringify(c.doc3.ev).includes(dmDocDoc.id), "T10 an unrelated Doctor received nothing of the Doctor ↔ Doctor DM");
  ok(c.doc2.ev.some((e) => e.p && e.p.message && e.p.message.text === secret + " doc-doc"), "T9/T10 …while the real participant did");
  // the owner's own DM works for the owner and nobody else
  clear(c.owner, c.rec1, c.doc3, c.doc2);
  await send(T.doc1, dmOwnerDoc.id, "to the owner only");
  ok(!!(await waitFor(() => newMsgEv(c.owner, "to the owner only"))), "T9 the Owner DOES receive DMs they are a participant of");
  await sleep(300);
  ok(![c.rec1, c.doc3, c.doc2].some((x) => x.ev.length), "T12 …and nobody else does");

  /* ================= T22–T24: read state → Seen ================= */
  clear(c.doc1, c.rec1, c.owner, c.doc2, c.doc3);
  const lastFromRec = (await send(T.rec1, dmDocRec.id, "please read me")).json.message;
  await waitFor(() => newMsgEv(c.doc1, "please read me"));
  const peerBefore = (await api("GET", `/conversations/${dmDocRec.id}`, T.rec1)).json.conversation.peerLastReadCursor;
  clear(c.doc1, c.rec1, c.owner);
  const rd = await read(T.doc1, dmDocRec.id, { upToMessageId: lastFromRec.id });
  ok(rd.status === 200 && rd.json.unreadCount === 0, "T22 mark-read persists through the C1 API and answers the new unread count");
  const state = await ConnectReadState.findOne({ conversationId: dmDocRec.id, userId: id(U.doc1) }).lean();
  ok(state && state.lastReadSeq >= 1, "T22 the read position is stored (single C1 read-state store, no second receipt table)");
  const sSelf = await waitFor(() => evOf(c.doc1, "connect:read:self")[0]);
  ok(sSelf && sSelf.p.unreadCount === 0 && sSelf.p.conversationId === dmDocRec.id, "T30 the reader's own devices get the new unread count (0)");
  const sPeer = await waitFor(() => evOf(c.rec1, "connect:read:peer")[0]);
  ok(!!sPeer, "T23 the sender receives the read/Seen event in realtime");
  ok(sPeer && sPeer.p.conversationId === dmDocRec.id && typeof sPeer.p.lastReadCursor === "string", "T23 …with the reader's position as an opaque cursor");
  const peerNow = (await api("GET", `/conversations/${dmDocRec.id}`, T.rec1)).json.conversation.peerLastReadCursor;
  ok(sPeer && sPeer.p.lastReadCursor === peerNow, "T23 …equal to what the HTTP summary reports (one truth: MongoDB)");
  ok(peerBefore !== peerNow, "T23 the summary's peerLastReadCursor changed after the read");
  await sleep(300);
  ok(c.owner.ev.length === 0 && c.doc2.ev.length === 0 && c.doc3.ev.length === 0, "T23/T24 nobody else received a read event (Owner included)");
  // unauthorised read receipts
  const fake = await read(T.owner, dmDocRec.id);
  eq(fake.status, 404, "T24 the Owner cannot mark someone else's DM as read over HTTP (404, not 403)");
  const fakeB = await read(T.ownerB, dmDocRec.id);
  eq(fakeB.status, 404, "T24 another clinic cannot either");
  const rsFake = await ConnectReadState.countDocuments({ conversationId: dmDocRec.id, userId: id(U.owner) });
  eq(rsFake, 0, "T24 and no read row was created for the intruder");
  clear(c.rec1, c.doc1);
  c.owner.s.emit("connect:read:peer", { v: 1, conversationId: dmDocRec.id, lastReadCursor: "x" });
  await sleep(250);
  ok(c.rec1.ev.length === 0 && c.doc1.ev.length === 0, "T24 a fake 'read' event emitted by a client reaches nobody");
  // the Clinic Team has no per-member receipts: only the reader's own devices hear about their own read
  clear(c.owner, c.rec1, c.doc1, c.doc2);
  await read(T.owner, team.id);
  await sleep(400);
  ok(evOf(c.owner, "connect:read:self").length >= 1 && ![c.rec1, c.doc1, c.doc2].some((x) => evOf(x, "connect:read:peer").length || evOf(x, "connect:read:self").length), "T23 Clinic Team: only the reader is told (no per-member receipts, nothing to other members)");
  // replying marks the sender's own position; the unread count of the replier is 0
  const dmList = (await api("GET", "/conversations", T.doc1)).json.conversations.find((x) => x.id === dmDocRec.id);
  eq(dmList.unreadCount, 0, "T21 after reading, the conversation's unread is 0 for the reader");

  /* ================= T30: several devices of the same user ================= */
  const docTab2 = await connect(T.doc1), docTab3 = await connect(T.doc1);
  clear(c.doc1, docTab2, docTab3, c.rec1);
  const mm = await send(T.rec1, dmDocRec.id, "to all my tabs");
  for (const [n, tab] of [["tab 1", c.doc1], ["tab 2", docTab2], ["tab 3", docTab3]]) {
    const e = await waitFor(() => newMsgEv(tab, "to all my tabs"));
    ok(e && e.p.message.id === mm.json.message.id && e.p.unreadCount === 1, `T30 ${n} receives the message with the SAME id and the SAME unread (1) — not 1/2/3`);
  }
  clear(c.doc1, docTab2, docTab3);
  await read(T.doc1, dmDocRec.id);
  for (const [n, tab] of [["tab 1", c.doc1], ["tab 2", docTab2], ["tab 3", docTab3]]) {
    const e = await waitFor(() => evOf(tab, "connect:read:self")[0]);
    ok(e && e.p.unreadCount === 0, `T30 reading in one tab tells ${n} (unread 0)`);
  }
  docTab2.s.close(); docTab3.s.close();

  /* ================= T32–T33: typing (ephemeral, authorised, throttled) ================= */
  ok((await emitAck(c.rec1.s, "connect:conversation:subscribe", { conversationId: dmDocRec.id })).ok, "T32 typing needs a server-verified subscription");
  eq((await emitAck(c.owner.s, "connect:typing", { conversationId: dmDocRec.id, typing: true })).code, "NOT_SUBSCRIBED", "T32 a socket that is not subscribed (the Owner) cannot send typing for that DM");
  eq((await emitAck(c.doc3.s, "connect:typing", { conversationId: dmDocDoc.id, typing: true })).code, "NOT_SUBSCRIBED", "T32 …nor an unrelated Doctor for the Doctor ↔ Doctor DM");
  clear(c.doc1, c.rec1, c.owner, c.doc2, c.doc3, c.ownerB, c.docB);
  eq((await emitAck(c.rec1.s, "connect:typing", { conversationId: dmDocRec.id, typing: true })).ok, true, "T32 a participant may send typing");
  const ty = await waitFor(() => evOf(c.doc1, "connect:typing")[0]);
  ok(ty && ty.p.userId === id(U.rec1) && ty.p.name === "Lina" && ty.p.typing === true && ty.p.conversationId === dmDocRec.id, "T32 the other participant is told who is typing (identity from the server, not the client)");
  await sleep(250);
  ok(![c.owner, c.doc2, c.doc3, c.ownerB].some((x) => x.ev.length), "T32 nobody else receives typing for a DM");
  ok(evOf(c.rec1, "connect:typing").length === 0, "T32 the typist does not get their own typing back");
  clear(c.doc1);
  for (let i = 0; i < 25; i++) c.rec1.s.emit("connect:typing", { conversationId: dmDocRec.id, typing: true });
  await sleep(500);
  ok(evOf(c.doc1, "connect:typing").length <= 1, "T33 a burst of typing events is throttled (≤1 relayed in 0.5 s)", evOf(c.doc1, "connect:typing").length);
  await sleep(1700);
  const nTyping = evOf(c.doc1, "connect:typing").length;
  c.rec1.s.emit("connect:typing", { conversationId: dmDocRec.id, typing: true });
  ok(!!(await waitFor(() => evOf(c.doc1, "connect:typing").length > nTyping, 1000)), "T33 after the throttle window typing is relayed again");
  eq((await emitAck(c.rec1.s, "connect:typing", { conversationId: dmDocRec.id, typing: false })).ok, true, "T33 'stopped typing' is accepted");
  ok(!!(await waitFor(() => evOf(c.doc1, "connect:typing").some((e) => e.p.typing === false))), "T33 …and relayed immediately");
  eq(await ConnectConversation.countDocuments({ typing: { $exists: true } }), 0, "T32 typing is never stored in MongoDB");
  // team typing: members only
  for (const who of ["doc1", "owner", "doc2"]) await emitAck(c[who].s, "connect:conversation:subscribe", { conversationId: team.id });
  clear(c.owner, c.doc1, c.doc2, c.rec1, c.doc3, c.ownerB, c.docB);
  await emitAck(c.doc1.s, "connect:typing", { conversationId: team.id, typing: true });
  ok(!!(await waitFor(() => evOf(c.owner, "connect:typing")[0] && evOf(c.doc2, "connect:typing")[0] && evOf(c.rec1, "connect:typing")[0])), "T32 Clinic Team typing reaches the team's connected members");
  ok(![c.ownerB, c.docB].some((x) => x.ev.length), "T32 …and not another clinic");
  ok(evOf(c.owner, "connect:typing")[0].p.userId === id(U.doc1), "T32 …identified by the server");

  /* ================= T6: disabled / revoked users, and losing the entitlement while connected ================= */
  {
    const victim = await mk(A, "receptionist", 9, "Soon Disabled");
    const tk = t.tok(victim);
    const vs = await connect(tk);
    ok(vs.ok, "T6 setup: the user connects while active");
    eq((await emitAck(vs.s, "connect:conversation:subscribe", { conversationId: team.id })).ok, true, "T6 setup: and may subscribe");
    await t.m.User.updateOne({ _id: victim._id }, { isActive: false });
    const dropped = await waitFor(() => !vs.s.connected, 4000);
    ok(dropped, "T6 a deactivated user is disconnected (within the re-check interval)");
    ok(evOf(vs, "connect:access:revoked").length === 1 && evOf(vs, "connect:access:revoked")[0].p.code === "UNAUTHORIZED", "T6 …after being told why");
    const again = await connect(tk);
    ok(!again.ok && again.code === "UNAUTHORIZED", "T6 and cannot reconnect with the same (still validly signed) token", again.code);
    const h = await api("GET", "/conversations", tk);
    eq(h.status, 401, "T6 HTTP agrees (401)");
    // a message sent while they are being cut off is never delivered to them
    const v2 = await mk(A, "doctor", 8, "Revoked Token");
    const vt = t.tok(v2);
    const v2s = await connect(vt);
    await t.m.User.updateOne({ _id: v2._id }, { $inc: { tokenVersion: 1 } }); // password change / role change style revocation
    clear(v2s);
    await send(T.doc1, team.id, "after-revocation"); // delivery re-checks recipients against the database BEFORE emitting
    await sleep(500);
    ok(!newMsgEv(v2s, "after-revocation"), "T6 a stale token (revoked tokenVersion) receives NOTHING — recipients are re-validated before every delivery");
    ok(await waitFor(() => !v2s.s.connected, 3000), "T6 …and is disconnected");
  }
  {
    const pc = await t.mkClinic("c3-downgrade", pro);
    const po = await mk(pc, "owner", 1), pd = await mk(pc, "doctor", 1);
    const [so, sd] = [await connect(t.tok(po)), await connect(t.tok(pd))];
    ok(so.ok && sd.ok, "T4/entitlement setup: a PRO clinic is connected");
    const pteam = (await api("GET", "/team", t.tok(po))).json.conversation;
    await send(t.tok(po), pteam.id, "while pro");
    ok(!!(await waitFor(() => newMsgEv(sd, "while pro"))), "entitlement: delivery works while the clinic is PRO");
    await t.m.Clinic.updateOne({ _id: pc._id }, { plan: "basic" });
    clear(so, sd);
    await sleep(100);
    const httpSend = await send(t.tok(po), pteam.id, "after downgrade");
    eq(httpSend.status, 402, "entitlement: HTTP refuses the send after the downgrade (402)");
    ok(await waitFor(() => !sd.s.connected && !so.s.connected, 4000), "entitlement: both connected sockets are disconnected when the clinic loses Connect");
    ok(evOf(sd, "connect:access:revoked").some((e) => e.p.code === "PLAN_LIMIT"), "entitlement: …with PLAN_LIMIT");
    ok(!newMsgEv(sd, "after downgrade"), "entitlement: no event is delivered after the downgrade");
    const re = await connect(t.tok(pd));
    ok(!re.ok && re.code === "PLAN_LIMIT", "entitlement: reconnecting is refused (PLAN_LIMIT)");
    await t.m.Clinic.updateOne({ _id: pc._id }, { plan: "pro", status: "suspended" });
    const re2 = await connect(t.tok(pd));
    ok(!re2.ok && re2.code === "SUSPENDED", "entitlement: a suspended clinic is refused (SUSPENDED)");
  }

  /* ================= X: abuse, origin, payload, limits ================= */
  const evil = await connect(T.owner, { opts: { extraHeaders: { Origin: "https://evil.example" } } });
  ok(!evil.ok, "X a browser origin that is not allowed is refused at the handshake", evil.message);
  const good = await connect(T.owner, { opts: { extraHeaders: { Origin: "http://localhost:3000" } } });
  ok(good.ok, "X the allowed origin (local dev server) connects"); good.s.close();
  const pk = await connect(T.doc3);
  const huge = "x".repeat(40 * 1024);
  pk.s.emit("connect:typing", { conversationId: dmDocRec.id, typing: true, junk: huge });
  ok(await waitFor(() => !pk.s.connected, 3000), "X an oversized payload closes the connection (maxHttpBufferSize)");
  const fl = await connect(T.doc3);
  let rl = 0;
  const flAcks = [];
  for (let i = 0; i < 150; i++) fl.s.emit("connect:conversation:subscribe", { conversationId: "b".repeat(24) }, (r) => flAcks.push(r));
  await sleep(800);
  rl = flAcks.filter((r) => r && r.code === "RATE_LIMITED").length;
  ok(rl > 0, "X an event flood is rate-limited per socket (RATE_LIMITED acks)", rl);
  ok(fl.s.connected, "X …without disconnecting an ordinary burst");
  for (let i = 0; i < 400; i++) fl.s.emit("connect:conversation:subscribe", { conversationId: "b".repeat(24) });
  ok(await waitFor(() => !fl.s.connected, 3000), "X sustained flooding disconnects the socket");
  const many = []; // the suite already holds one socket for this user (c.doc2): 7 more fill the limit of 8
  for (let i = 0; i < 7; i++) many.push(await connect(T.doc2));
  const ninth = await connect(T.doc2);
  ok(many.every((x) => x.ok) && !ninth.ok && ninth.code === "TOO_MANY_CONNECTIONS", "X at most 8 sockets per user (the 9th is refused)", ninth.code);
  many.forEach((x) => x.s.close());
  eq((await fetch(`${URL}/socket.io/?EIO=4&transport=polling`).then((r) => r.status)), 200, "X engine.io handshake endpoint answers (CORS/origin checks apply to browsers)");
  const noOrigin = await fetch(`${URL}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: "https://evil.example" } });
  ok(noOrigin.status >= 400, "X a polling handshake from a foreign browser origin is refused", noOrigin.status);

  /* ================= T16–T17, T31: reconnect + restart; the database is the source of truth ================= */
  {
    // a client that goes away, misses messages, comes back: HTTP reconciliation (cursor) yields exactly what was missed, no duplicates
    const rc = await connect(T.doc2, { opts: { reconnection: true, reconnectionDelay: 150, reconnectionDelayMax: 400, randomizationFactor: 0 } });
    const known = (await msgs(T.doc2, dmDocDoc.id)).json;
    const lastCursor = known.pageInfo.newerCursor;
    clear(rc);
    await send(T.doc1, dmDocDoc.id, "live one");
    const liveEv = await waitFor(() => newMsgEv(rc, "live one"));
    ok(!!liveEv, "T16 setup: a live message is received before the drop");
    rc.s.io.engine.close(); // simulate a network drop (socket.io-client then reconnects by itself)
    await waitFor(() => !rc.s.connected, 2000);
    await send(T.doc1, dmDocDoc.id, "missed while offline 1");
    await send(T.doc1, dmDocDoc.id, "missed while offline 2");
    ok(!newMsgEv(rc, "missed while offline 1"), "T17 (setup) the offline client did not receive the events");
    const back = await waitFor(() => rc.s.connected, 5000);
    ok(back, "T16 the client reconnects by itself (re-authenticated from the token)");
    await sleep(300);
    ok(!newMsgEv(rc, "missed while offline 1") && !newMsgEv(rc, "missed while offline 2"), "T16 sockets do NOT replay old events (they are not durable storage)");
    const recovered = (await msgs(T.doc2, dmDocDoc.id, `?after=${encodeURIComponent(lastCursor)}`)).json.messages.map((m) => m.text);
    eq(recovered, ["live one", "missed while offline 1", "missed while offline 2"], "T17 HTTP reconciliation with the last known cursor recovers exactly the missed messages (in order)");
    const ids = new Set((await msgs(T.doc2, dmDocDoc.id)).json.messages.map((m) => m.id));
    eq(ids.size, (await msgs(T.doc2, dmDocDoc.id)).json.messages.length, "T16 no duplicate ids after reconnect + reconcile");
    // after reconnect, live delivery works again, and it needs no re-subscription for messages (user room)
    clear(rc);
    await send(T.doc1, dmDocDoc.id, "live again");
    ok(!!(await waitFor(() => newMsgEv(rc, "live again"))), "T16 live delivery resumes after the reconnect");
    rc.s.close();
  }
  {
    // T31: the whole backend restarts. Clients reconnect, then reconcile over HTTP. Nothing lives in socket memory.
    const rc = await connect(T.rec1, { opts: { reconnection: true, reconnectionDelay: 200, reconnectionDelayMax: 600, randomizationFactor: 0 } });
    const lastBefore = (await msgs(T.rec1, dmDocRec.id)).json.pageInfo.newerCursor;
    const sentBefore = (await send(T.doc1, dmDocRec.id, "before restart")).json.message;
    await waitFor(() => newMsgEv(rc, "before restart"));
    t.server.kill("SIGKILL");
    await sleep(500);
    ok(await waitFor(() => !rc.s.connected, 4000), "T31 the client notices the backend is gone");
    const second = spawnServer(PORT, { ...process.env, MONGO_URI: `${MONGO_BASE}/${t.DB}`, JWT_SECRET: t.SECRET, PORT: String(PORT), NODE_ENV: "test", ...ENV });
    let up = false;
    for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch { await sleep(250); } }
    ok(up, "T31 the backend restarts");
    // a message sent while the client is still reconnecting (persisted by the NEW process)
    const during = await send(T.doc1, dmDocRec.id, "sent right after restart");
    eq(during.status, 201, "T31 messages are accepted after the restart (MongoDB authoritative)");
    ok(await waitFor(() => rc.s.connected, 8000), "T31 the client reconnects automatically after the restart");
    const rec = (await msgs(T.rec1, dmDocRec.id, `?after=${encodeURIComponent(lastBefore)}`)).json.messages.map((m) => m.text);
    ok(rec.includes("before restart") && rec.includes("sent right after restart"), "T31 HTTP reconciliation restores everything, including what arrived during the outage", rec);
    eq(new Set(rec).size, rec.length, "T31 …with no duplicates");
    clear(rc);
    await send(T.doc1, dmDocRec.id, "live after restart");
    ok(!!(await waitFor(() => newMsgEv(rc, "live after restart"))), "T31 live delivery works against the restarted process");
    rc.s.close();
    // realtime switched OFF: Connect still works over HTTP
    const off = spawnServer(PORT + 1, { ...process.env, MONGO_URI: `${MONGO_BASE}/${t.DB}`, JWT_SECRET: t.SECRET, PORT: String(PORT + 1), NODE_ENV: "test", CONNECT_REALTIME: "off", ...ENV });
    let up2 = false;
    for (let i = 0; i < 80 && !up2; i++) { try { up2 = (await fetch(`http://127.0.0.1:${PORT + 1}/health`)).ok; } catch { await sleep(250); } }
    const offHttp = await fetch(`http://127.0.0.1:${PORT + 1}/api/connect/conversations`, { headers: { Authorization: "Bearer " + T.doc1 } });
    ok(up2 && offHttp.status === 200, "X CONNECT_REALTIME=off: the HTTP API keeps working (polling fallback)");
    const offSock = await new Promise((resolve) => { const s = ioClient(`http://127.0.0.1:${PORT + 1}`, { auth: { token: T.doc1 }, transports: ["websocket"], reconnection: false, forceNew: true, timeout: 2500 }); s.on("connect", () => resolve("connected")); s.on("connect_error", () => resolve("refused")); open_.push(s); });
    eq(offSock, "refused", "X CONNECT_REALTIME=off: no socket endpoint exists");
    off.proc.kill();
    second.proc.kill();
  }

  /* ================= logging: no message bodies ================= */
  ok(!/Hello doctor|OWNER-MUST-NOT|B-ONLY-SECRET|مرحباً دكتور/.test(t.slog), "X the server log (stdout/stderr) contains no message text");

  open_.forEach((s) => { try { s.close(); } catch {} });
  t.noLeaks("no HTTP response of this suite leaked a stack / path / Mongo internals");
  await t.finish("CLINICOS CONNECT C3 — realtime delivery, auth, entitlement, privacy, read/Seen, typing, reconnect");
})().catch((e) => { console.error("SUITE CRASHED:", e); process.exit(2); });
