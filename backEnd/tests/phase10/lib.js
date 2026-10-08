/* Phase 10 — shared harness for the security test-suites.
   Starts the COMPILED server (dist/index.js) as a separate process on its own port with a fresh database, then talks to it over real HTTP.
   Nothing is mocked: tokens are signed with the same secret the server uses, data is created through the models only where the product has no API for it. */
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
// Layout (all overridable): this folder is <repo>/backEnd/tests/phase10. Needs `npm run build` (dist/) and a MongoDB-protocol server.
const REPO = process.env.P10_REPO || path.resolve(__dirname, "../../..");
const BE = process.env.P10_BE || `${REPO}/backEnd`;
const W = BE;
const D = process.env.P10_DIST || `${BE}/dist`;
const NM = process.env.P10_NM || `${BE}/node_modules`;
const MONGO_BASE = (process.env.P10_MONGO || "mongodb://127.0.0.1:27017").replace(/\/$/, "");
const OUT = process.env.P10_OUT || __dirname;
const mongoose = require(`${NM}/mongoose`);
const jwt = require(`${NM}/jsonwebtoken`);
const SRC = `${BE}/src`;
const FSRC = `${REPO}/frontEnd`;

const SECRET = "test-secret-please-change-0123456789";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot({ name, port, env = {}, db } = {}) {
  const BASE = `http://127.0.0.1:${port}/api`;
  const DB = db || `${name}_${Date.now()}`;
  const penv = { ...process.env, MONGO_URI: `${MONGO_BASE}/${DB}`, JWT_SECRET: SECRET, PORT: String(port), NODE_ENV: "test", ...env };
  Object.assign(process.env, { MONGO_URI: penv.MONGO_URI, JWT_SECRET: SECRET, PORT: String(port), NODE_ENV: "test" });

  const t = { pass: 0, fail: 0, failures: [], name, port, BASE, DB, SECRET, W, D, SRC, FSRC, jwt, mongoose, sleep };
  t.ok = (cond, label, extra) => { if (cond) t.pass++; else { t.fail++; t.failures.push(label + (extra !== undefined ? " :: " + JSON.stringify(extra).slice(0, 400) : "")); } };
  t.limits = []; // checks whose cross-actor atomicity only MongoDB (not the FerretDB test engine) guarantees — see TEST-REPORT
  /** Passes when `cond`; otherwise records an OBSERVATION (never a silent pass, never a hidden failure): FerretDB's findOneAndUpdate is not atomic under concurrency. */
  t.dbLimit = (cond, label, detail) => { if (cond) t.pass++; else t.limits.push(label + (detail !== undefined ? " :: " + JSON.stringify(detail).slice(0, 300) : "")); };
  t.eq = (a, b, label) => t.ok(JSON.stringify(a) === JSON.stringify(b), label, { got: a, want: b });
  let ipSeq = 10 + Math.floor(Math.random() * 100);
  t.newIp = () => `10.${port % 250}.${Math.floor(++ipSeq / 250) % 250}.${ipSeq % 250}`;
  t.seen = []; // every response, for the generic "nothing internal ever leaks" check
  t.http = async (method, url, { token, body, ip, headers, rawBody, base } = {}) => {
    const r = await fetch((base || BASE) + url, {
      method,
      headers: { ...(rawBody === undefined && body === undefined && method === "GET" ? {} : { "Content-Type": "application/json" }), "X-Forwarded-For": ip || t.newIp(), ...(token ? { Authorization: "Bearer " + token } : {}), ...(headers || {}) },
      body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null; const text = await r.text(); try { json = JSON.parse(text); } catch {}
    t.seen.push({ method, url: url.replace(/\?.*/, ""), status: r.status, text });
    return { status: r.status, json, text, headers: r.headers };
  };
  /** Generic leak scan over everything this suite received. */
  t.noLeaks = (label) => {
    const bad = t.seen.filter((x) => /node_modules|\/home\/|\bat [A-Za-z.<>]+ \(|MongoServerError|MongooseError|\bstack\b|E11000|CastError|ValidationError|\$where|\.ts:\d+|\.js:\d+/.test(x.text));
    t.ok(bad.length === 0, label || "no response of this suite leaked a stack / path / Mongo internals", bad.slice(0, 3).map((x) => x.method + " " + x.url + " " + x.status + " " + x.text.slice(0, 120)));
    const jwtLeak = t.seen.filter((x) => x.status >= 400 && /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(x.text));
    t.ok(jwtLeak.length === 0, "no ERROR response echoed a token", jwtLeak.slice(0, 2).map((x) => x.url));
  };

  t.server = spawn("node", [path.join(D, "index.js")], { env: penv, stdio: ["ignore", "pipe", "pipe"] });
  t.slog = ""; t.server.stdout.on("data", (d) => (t.slog += d)); t.server.stderr.on("data", (d) => (t.slog += d));
  process.on("exit", () => { try { t.server.kill(); } catch {} });
  let up = false;
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) { up = true; break; } } catch {} await sleep(250); }
  if (!up) throw new Error("server did not start:\n" + t.slog);

  await mongoose.connect(penv.MONGO_URI);
  const M = (n) => require(`${D}/models/${n}`);
  t.M = M;
  t.m = {};
  for (const n of ["Clinic", "User", "Patient", "Appointment", "Invoice", "LoyaltyAccount", "LoyaltyTransaction", "LoyaltyCheckIn", "LoyaltyRedemption", "LoyaltyReward", "LoyaltyTierHistory", "ActivityLog", "LoyaltySettings"]) t.m[n] = M(n)[n];
  t.svc = require(`${D}/services/loyaltyService`);
  t.pub = require(`${D}/services/loyaltyPublic`);
  t.pts = require(`${D}/services/loyaltyPoints`);
  await Promise.all([t.m.LoyaltyAccount.init(), t.m.LoyaltyRedemption.init(), t.m.LoyaltyCheckIn.init(), t.m.LoyaltyTransaction.init()]).catch(() => {});

  const now = Date.now();
  t.now = now;
  t.addon = { enabled: true, status: "active", setupFee: 0, monthlyPrice: 0, activatedAt: new Date(), currentPeriodStart: new Date(now - 864e5), currentPeriodEnd: new Date(now + 30 * 864e5) };
  t.mkClinic = (slug, extra = {}) => t.m.Clinic.create({ name: "Clinic " + slug, slug, specialty: "general", planExpiresAt: new Date(now + 30 * 864e5), status: "active", addons: { loyalty: t.addon }, ...extra });
  t.mkUser = (c, role, n = 1) => t.m.User.create({ clinicId: c._id, name: `${role} ${n}`, email: `${role}${n}-${c.slug}@t.io`, password: "secret123", role, emailVerified: true });
  t.tok = (u, extra = {}, secret = SECRET, opts = {}) => jwt.sign({ userId: String(u._id), tokenVersion: 0, ...extra }, secret, opts);
  let fn = 100;
  t.mkPatient = (c, name, phone, extra = {}) => t.m.Patient.create({ clinicId: c._id, fileNumber: ++fn, fullName: name, phone: phone || "0795" + String(100000 + ++fn), ...extra });
  t.uniqPhone = () => "0795" + String(200000 + ++fn);
  t.enroll = async (p, tk) => (await t.http("POST", "/loyalty/members", { token: tk, body: { patientId: String(p._id) } })).json.member;
  t.balance = async (accountId) => (await t.m.LoyaltyAccount.findById(accountId).lean()).pointsBalance;
  t.credit = (clinicId, accountId, points) => t.svc.creditPoints({ clinicId: String(clinicId), accountId: String(accountId), type: "manual_credit", points, reason: "test credit", sourceType: "manual" });
  t.sessionFor = (accountId, clinicId) => t.pub.signPublicToken({ clinicId: String(clinicId), accountId: String(accountId) });

  t.finish = async (title) => {
    console.log(`${title}: ${t.pass} passed, ${t.fail} failed`);
    for (const f of t.failures) console.log("  FAIL: " + f);
    if (t.limits.length) console.log(`  ${t.limits.length} OBSERVATION(S) NOT VERIFIED on this test database (FerretDB):`);
    for (const f of t.limits) console.log("  NOT-VERIFIED: " + f);
    try { t.server.kill(); } catch {}
    try { await mongoose.disconnect(); } catch {}
    fs.writeFileSync(`${OUT}/${name}.result.json`, JSON.stringify({ title, pass: t.pass, fail: t.fail, failures: t.failures, notVerified: t.limits }, null, 1));
    process.exit(t.fail ? 1 : 0);
  };
  return t;
}

/** Standard two-clinic world: A (main), B (other tenant), C (no add-on), D (add-on but programme off). Programme switched on through the real API. */
async function world(t) {
  const { Clinic } = t.m;
  t.A = await t.mkClinic("clinic-a");
  t.B = await t.mkClinic("clinic-b");
  t.C = await t.mkClinic("clinic-noaddon", { addons: {} });
  t.Dp = await t.mkClinic("clinic-progoff");
  const U = {};
  U.ownerA = await t.mkUser(t.A, "owner"); U.docA = await t.mkUser(t.A, "doctor"); U.recA = await t.mkUser(t.A, "receptionist"); U.rec2A = await t.mkUser(t.A, "receptionist", 2);
  U.ownerB = await t.mkUser(t.B, "owner"); U.docB = await t.mkUser(t.B, "doctor"); U.recB = await t.mkUser(t.B, "receptionist");
  U.ownerC = await t.mkUser(t.C, "owner"); U.ownerD = await t.mkUser(t.Dp, "owner");
  t.U = U;
  t.T = { owner: t.tok(U.ownerA), doc: t.tok(U.docA), rec: t.tok(U.recA), rec2: t.tok(U.rec2A), ownerB: t.tok(U.ownerB), docB: t.tok(U.docB), recB: t.tok(U.recB), ownerC: t.tok(U.ownerC), ownerD: t.tok(U.ownerD) };
  for (const tk of [t.T.owner, t.T.ownerB]) await t.http("PATCH", "/loyalty/settings", { token: tk, body: { program: { enabled: true } } });
  await t.http("PATCH", "/loyalty/settings", { token: t.T.owner, body: { checkin: { enabled: true } } });
  await t.http("PATCH", "/loyalty/settings", { token: t.T.ownerB, body: { checkin: { enabled: true } } });
  const enrollBase = t.enroll; t.enroll = (p, tk = t.T.owner) => enrollBase(p, tk);
  return t;
}

/** Starts another copy of the server with a hand-made environment (used for production-mode checks). Resolves { proc, log(), exited: Promise<code> }. */
function spawnServer(port, env) {
  const base = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port) };
  const proc = spawn("node", [path.join(D, "index.js")], { env: { ...base, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; proc.stdout.on("data", (d) => (log += d)); proc.stderr.on("data", (d) => (log += d));
  const exited = new Promise((res) => proc.on("exit", (c) => res(c)));
  process.on("exit", () => { try { proc.kill(); } catch {} });
  return { proc, log: () => log, exited };
}

module.exports = { boot, world, spawnServer, W, SECRET, sleep, MONGO_BASE };
