/* Phase 10 — AUTHENTICATION, TOKEN SEPARATION, INPUT ATTACKS, HEADERS/CORS, PRODUCTION CONFIG (compiled server, real HTTP). */
const { boot, world, spawnServer, SECRET, MONGO_BASE } = require("./lib");
const crypto = require("crypto");

const ADMIN_SECRET = "admin-test-secret-0123456789-abcdef";
const PUB_SECRET = "loyalty-public-test-secret-0123456789";
const b64u = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

(async () => {
  const t = await boot({ name: "sec10auth", port: 5101, env: { ADMIN_JWT_SECRET: ADMIN_SECRET, LOYALTY_PUBLIC_SECRET: PUB_SECRET, FRONTEND_URL: "https://app.clinicos.test" } });
  const { ok, eq, http, jwt } = t;
  await world(t);
  const { A, B, T, U, m } = t;
  const pA = await t.mkPatient(A, "Ahmad Auth", "0791010001"), pB = await t.mkPatient(B, "Bilal Other", "0791010002");
  const accA = await t.enroll(pA), accB = await t.enroll(pB, T.ownerB);
  // the server runs with a SEPARATE public secret, so tokens for it must be signed with that one
  process.env.LOYALTY_PUBLIC_SECRET = PUB_SECRET;
  const pubTok = (accountId, clinicId, over = {}, secret = PUB_SECRET, opts = {}) =>
    jwt.sign({ typ: "loyalty_public", cid: String(clinicId), aid: String(accountId), ...over }, secret, { algorithm: "HS256", audience: "clinicos-loyalty-public", issuer: "clinicos", expiresIn: 600, ...opts });
  const good = pubTok(accA.id, A._id);
  eq((await http("GET", "/public/loyalty/clinic-a/me", { token: good })).status, 200, "sanity: a correctly signed patient token works");
  const adminTok = jwt.sign({ sub: "admin", email: "root@clinicos.test" }, ADMIN_SECRET, { expiresIn: "1h" });

  /* ---------- staff token attacks on a staff route ---------- */
  const staffGet = (token) => http("GET", "/loyalty/overview", { token });
  eq((await staffGet(undefined)).status, 401, "staff route without a token → 401");
  eq((await staffGet("abc")).status, 401, "malformed token → 401");
  eq((await staffGet("a.b.c")).status, 401, "three-part garbage token → 401");
  eq((await staffGet(t.tok(U.ownerA, {}, "some-other-secret-0123456789abcdef"))).status, 401, "token signed with a different secret → 401");
  eq((await staffGet(t.tok(U.ownerA, {}, SECRET, { expiresIn: -60 }))).status, 401, "expired staff token → 401");
  eq((await staffGet(`${b64u({ alg: "none", typ: "JWT" })}.${b64u({ userId: String(U.ownerA._id), tokenVersion: 0 })}.`)).status, 401, "alg=none token → 401");
  eq((await staffGet(jwt.sign({ userId: String(U.ownerA._id), tokenVersion: 0 }, SECRET, { algorithm: "HS512" }))).status, 401, "HS512 token with the right secret → 401 (algorithm is pinned to HS256)");
  eq((await staffGet(t.tok(U.ownerA, { sub: "admin" }))).status, 401, "staff-shaped token carrying sub=admin → 401");
  eq((await staffGet(t.tok(U.ownerA, { typ: "loyalty_public" }))).status, 401, "staff-shaped token carrying a loyalty `typ` → 401");
  eq((await staffGet(t.tok(U.ownerA, { aud: "clinicos-loyalty-public" }))).status, 401, "staff-shaped token carrying a loyalty audience → 401");
  eq((await staffGet(jwt.sign({ userId: { $ne: null }, tokenVersion: 0 }, SECRET))).status, 401, "userId as an operator object → 401");
  eq((await staffGet(jwt.sign({ userId: "not-an-object-id", tokenVersion: 0 }, SECRET))).status, 401, "userId that is not an ObjectId → 401");
  eq((await staffGet(jwt.sign({ tokenVersion: 0 }, SECRET))).status, 401, "token without userId → 401");
  eq((await http("GET", "/loyalty/overview", { headers: { Authorization: "Basic " + T.owner } })).status, 401, "non-Bearer scheme → 401");
  eq((await staffGet(t.tok(U.ownerA, { tokenVersion: 5 }))).status, 401, "stale tokenVersion (revoked session) → 401");
  await m.User.updateOne({ _id: U.recA._id }, { $set: { isActive: false } });
  eq((await staffGet(T.rec)).status, 401, "deactivated staff user → 401");
  await m.User.updateOne({ _id: U.recA._id }, { $set: { isActive: true } });
  eq((await staffGet(T.rec)).status, 200, "…and active again → 200");

  /* ---------- patient token on staff routes, in every shape ---------- */
  for (const [label, tk] of [["valid patient token", good], ["patient token signed with JWT_SECRET", pubTok(accA.id, A._id, {}, SECRET)]]) {
    for (const [method, url] of [["GET", "/loyalty/overview"], ["GET", "/loyalty/members"], ["POST", `/loyalty/members/${accA.id}/adjust`], ["GET", "/loyalty/redemptions"], ["POST", "/loyalty/rewards"], ["PUT", "/loyalty/tiers/config"], ["GET", "/loyalty/checkins"]]) {
      const r = await http(method, url, { token: tk, body: method === "GET" ? undefined : { direction: "credit", points: 999999, reason: "attack" } });
      eq(r.status, 401, `${label} on staff route ${method} ${url} → 401`);
    }
  }
  eq(await t.balance(accA.id), 0, "no patient-token attack changed a balance");

  /* ---------- admin token vs staff routes, staff token vs admin routes ---------- */
  eq((await staffGet(adminTok)).status, 401, "platform-admin token on a clinic Loyalty route → 401");
  eq((await http("GET", "/admin/clinics", { token: T.owner })).status, 401, "clinic OWNER token on a platform-admin route → 401");
  eq((await http("POST", `/admin/clinics/${t.C._id}/addons/loyalty/activate`, { token: T.owner, body: {} })).status, 401, "clinic owner cannot activate an add-on");
  eq((await http("POST", `/admin/clinics/${t.C._id}/addons/loyalty/activate`, { token: good, body: {} })).status, 401, "patient token cannot activate an add-on");
  eq((await http("POST", `/admin/clinics/${t.C._id}/addons/loyalty/activate`, { body: {} })).status, 401, "anonymous cannot activate an add-on");
  eq((await http("GET", "/admin/clinics", { token: jwt.sign({ sub: "admin" }, ADMIN_SECRET, { algorithm: "HS512" }) })).status, 401, "admin token with a non-pinned algorithm → 401");
  eq((await http("GET", "/admin/clinics", { token: jwt.sign({ sub: "admin" }, SECRET) })).status, 401, "admin-shaped token signed with the CLINIC secret → 401");
  eq((await http("GET", "/admin/clinics", { token: jwt.sign({ sub: "admin-2fa" }, ADMIN_SECRET) })).status, 401, "a 2FA-pending style token is not an admin session");

  /* ---------- clinic owner cannot grant themselves the add-on ---------- */
  const cBefore = await m.Clinic.findById(t.C._id).lean();
  const mass = await http("PATCH", "/clinic", { token: T.ownerC, body: { name: "Clinic C renamed", addons: { loyalty: { enabled: true, status: "active", currentPeriodEnd: new Date(Date.now() + 9e10) } }, plan: "pro", status: "active" } });
  ok(mass.status === 200 || mass.status === 400, "owner PATCH /clinic with an `addons` field is handled (not a 500)", mass.status);
  const cAfter = await m.Clinic.findById(t.C._id).lean();
  ok(!cAfter.addons || !cAfter.addons.loyalty || cAfter.addons.loyalty.status !== "active", "clinic owner cannot switch the Loyalty add-on on through the clinic API", cAfter.addons);
  eq((await http("GET", "/loyalty/overview", { token: T.ownerC })).status, 402, "clinic without the add-on still gets 402 ADDON_REQUIRED");
  eq((await http("POST", "/loyalty/members", { token: T.ownerC, body: { patientId: String(pA._id) } })).status, 402, "…on writes too");
  eq((await http("GET", "/public/loyalty/clinic-noaddon")).json.available, false, "public page of a clinic without the add-on is unavailable");

  /* ---------- patient token attacks on public routes ---------- */
  const pubGet = (url, token) => http("GET", `/public/loyalty/clinic-a${url}`, { token });
  eq((await pubGet("/me")).status, 401, "public /me without a token → 401");
  eq((await pubGet("/me", "garbage")).status, 401, "public /me malformed token → 401");
  eq((await pubGet("/me", pubTok(accA.id, A._id, {}, PUB_SECRET, { expiresIn: -30 }))).status, 401, "expired patient token → 401");
  eq((await pubGet("/me", pubTok(accA.id, A._id, {}, "wrong-secret-0123456789abcdef"))).status, 401, "patient token with a wrong signature → 401");
  eq((await pubGet("/me", pubTok(accA.id, A._id, {}, SECRET))).status, 401, "patient token signed with the CLINIC secret → 401");
  eq((await pubGet("/me", `${b64u({ alg: "none", typ: "JWT" })}.${b64u({ typ: "loyalty_public", cid: String(A._id), aid: accA.id, aud: "clinicos-loyalty-public", iss: "clinicos", exp: Math.floor(Date.now() / 1000) + 600 })}.`)).status, 401, "patient token alg=none → 401");
  eq((await pubGet("/me", jwt.sign({ typ: "loyalty_public", cid: String(A._id), aid: accA.id }, PUB_SECRET, { algorithm: "HS512", audience: "clinicos-loyalty-public", issuer: "clinicos", expiresIn: 600 }))).status, 401, "patient token HS512 → 401");
  eq((await pubGet("/me", pubTok(accA.id, A._id, {}, PUB_SECRET, { audience: "someone-else" }))).status, 401, "wrong audience → 401");
  eq((await pubGet("/me", pubTok(accA.id, A._id, {}, PUB_SECRET, { issuer: "evil" }))).status, 401, "wrong issuer → 401");
  eq((await pubGet("/me", pubTok(accA.id, A._id, { typ: "staff" }))).status, 401, "wrong typ → 401");
  eq((await pubGet("/me", pubTok(accA.id, A._id, { aid: { $ne: null } }))).status, 401, "account id as an operator object → 401");
  eq((await pubGet("/me", pubTok("not-an-id", A._id))).status, 401, "account id that is not an ObjectId → 401");
  eq((await pubGet("/me", t.tok(U.ownerA))).status, 401, "STAFF token on the public API → 401");
  eq((await pubGet("/me", adminTok)).status, 401, "ADMIN token on the public API → 401");
  // tamper: take a valid token and change the payload but keep the signature
  const [h, p, s] = good.split(".");
  const evil = JSON.parse(Buffer.from(p, "base64url").toString());
  evil.aid = accB.id; evil.cid = String(B._id);
  eq((await pubGet("/me", `${h}.${b64u(evil)}.${s}`)).status, 401, "payload swapped to another clinic's account, signature kept → 401");
  // clinic binding
  const rOther = await http("GET", "/public/loyalty/clinic-b/me", { token: good });
  ok(rOther.status === 401 || rOther.status === 404, "clinic A's patient token used on clinic B's slug is refused", rOther.status);
  ok(!rOther.text.includes("Ahmad") && !rOther.text.includes("Bilal"), "…and returns no member data");
  eq((await http("GET", "/public/loyalty/clinic-b/me", { token: pubTok(accA.id, B._id) })).status, 401, "token with clinic B's id but clinic A's account → 401 (account/clinic binding is re-checked)");
  eq((await http("GET", "/public/loyalty/clinic-a/me", { token: pubTok(accB.id, A._id) })).status, 401, "token with clinic A's id but clinic B's account → 401");
  const sus = await m.LoyaltyAccount.findByIdAndUpdate(accA.id, { $set: { status: "suspended" } });
  eq((await pubGet("/me", good)).status, 401, "a SUSPENDED member's still-valid token stops working at once");
  await m.LoyaltyAccount.updateOne({ _id: accA.id }, { $set: { status: "active" } });
  const gone = await t.mkPatient(A, "Deleted Soon", "0791010009"); const accGone = await t.enroll(gone);
  await m.LoyaltyAccount.deleteOne({ _id: accGone.id });
  eq((await pubGet("/me", pubTok(accGone.id, A._id))).status, 401, "token of a deleted account → 401");
  for (const url of ["/me", "/activity", "/rewards", "/checkin"]) eq((await pubGet(url, t.tok(U.ownerA))).status, 401, `staff token on public ${url} → 401`);
  for (const url of ["/me", "/activity", "/rewards", "/checkin"]) eq((await pubGet(url)).status, 401, `anonymous on public ${url} → 401`);
  const cp = await http("POST", "/public/loyalty/clinic-a/checkin", { token: t.tok(U.ownerA), body: {} });
  eq(cp.status, 401, "staff token cannot create a patient check-in");

  /* ---------- NoSQL / operator / shape injection ---------- */
  const idf = (body, slug = "clinic-a") => http("POST", `/public/loyalty/${slug}/identify`, { body });
  for (const [label, body] of [
    ["{$ne:null}", { phone: { $ne: null } }],
    ["{$gt:''}", { phone: { $gt: "" } }],
    ["{$regex:'.*'}", { phone: { $regex: ".*" } }],
    ["array of numbers", { phone: ["0791010001", "0791010002"] }],
    ["nested object", { phone: { a: { b: "0791010001" } } }],
    ["number", { phone: 791010001 }],
    ["null", { phone: null }],
    ["boolean", { phone: true }],
    ["extra operator key", { phone: "0791010001", $where: "1==1" }],
    ["__proto__", JSON.parse('{"phone":"0791010001","__proto__":{"x":1}}')],
  ]) {
    const r = await idf(body);
    ok(r.status === 400 || r.status === 404, `identify with ${label} is refused (never a session, never a 500)`, r.status);
    ok(!(r.json && r.json.token), `identify with ${label} issued no token`);
  }
  eq((await http("POST", "/public/loyalty/clinic-a/identify", { rawBody: "{bad json" , headers: {} })).status, 400, "invalid JSON → 400");
  eq((await idf({ phone: "0791010001".padEnd(5000, "1") })).status, 400, "5000-character phone → 400");
  eq((await idf({ phone: "0" + "7".repeat(300) })).status, 400, "300-digit phone → 400");
  for (const slug of ["$ne", "..%2f..", "a".repeat(200), "CLINIC-A", "clinic a", "%00", "{\"$gt\":\"\"}"]) {
    const r = await http("POST", `/public/loyalty/${encodeURIComponent(slug) === slug ? slug : slug}/identify`, { body: { phone: "0791010001" } });
    ok([400, 404].includes(r.status), `hostile slug ${JSON.stringify(slug).slice(0, 30)} → 404/400`, r.status);
  }
  const big = await http("POST", "/public/loyalty/clinic-a/identify", { rawBody: JSON.stringify({ phone: "0791010001", pad: "x".repeat(1_200_000) }) });
  eq(big.status, 413, "a 1.2 MB body is rejected with 413");

  // staff-side shapes
  for (const q of ["search[$ne]=x", "search[$regex]=.*", "page[$gt]=0", "limit=1000000", "limit=0", "page=-1", "limit=abc", "page=1e9", "accountId[$ne]=1", "type[$ne]=x"]) {
    const r = await http("GET", `/loyalty/members?${q}`, { token: T.owner });
    ok(r.status === 400 || r.status === 200, `GET /loyalty/members?${q} is validated (no 500)`, r.status);
    if (q.startsWith("limit=1000000") || q.startsWith("limit=0") || q.startsWith("page=-1")) eq(r.status, 400, `unbounded/invalid pagination refused: ${q}`);
  }
  for (const q of ["accountId[$ne]=1", "type[$ne]=x", "limit=5000", "page=0"]) {
    const r = await http("GET", `/loyalty/transactions?${q}`, { token: T.owner });
    ok(r.status === 400 || r.status === 200, `GET /loyalty/transactions?${q} → no 500`, r.status);
    if (q.startsWith("limit=5000")) eq(r.status, 400, "transactions: page size is capped server-side");
  }
  for (const id of ["zzz", "123", "{\"$ne\":1}", "%7B%24ne%3A1%7D", "..%2f..%2fadmin", "a".repeat(2000), "null", "undefined", "000000000000000000000000"]) {
    const r1 = await http("GET", `/loyalty/members/${id}`, { token: T.owner });
    ok([400, 404].includes(r1.status), `GET member ${id.slice(0, 20)} → 400/404, never 500`, r1.status);
    const r2 = await http("POST", `/loyalty/redemptions/${id}/confirm`, { token: T.owner, body: {} });
    ok([400, 404].includes(r2.status), `confirm redemption ${id.slice(0, 20)} → 400/404, never 500`, r2.status);
    const r3 = await http("POST", `/loyalty/checkins/${id}/confirm`, { token: T.owner, body: {} });
    ok([400, 404].includes(r3.status), `confirm check-in ${id.slice(0, 20)} → 400/404, never 500`, r3.status);
  }
  for (const body of [{ direction: "credit", points: { $gt: 0 }, reason: "operator attack" }, { direction: { $ne: "x" }, points: 5, reason: "operator attack" }, { direction: "credit", points: 5, reason: { $ne: null } }, { direction: "credit", points: 5, reason: "r".repeat(50000) }]) {
    const r = await http("POST", `/loyalty/members/${accA.id}/adjust`, { token: T.owner, body });
    eq(r.status, 400, `adjust with hostile shape ${JSON.stringify(body).slice(0, 50)} → 400`);
  }
  eq((await http("POST", "/loyalty/rewards", { token: T.owner, body: { name: "n".repeat(10000), pointsRequired: 10 } })).status, 400, "reward name of 10 000 characters → 400");
  eq((await http("POST", "/loyalty/rewards", { token: T.owner, body: { name: "ok name", pointsRequired: { $gt: 0 } } })).status, 400, "reward pointsRequired as operator → 400");
  eq((await http("PATCH", "/loyalty/settings", { token: T.owner, rawBody: '{"__proto__":{"polluted":true},"program":{"enabled":true}}' })).status >= 200, true, "__proto__ in a settings body does not crash the server");
  eq((await http("GET", "/loyalty/overview", { token: T.owner })).status, 200, "…and the server still answers normally afterwards");
  ok(({}).polluted === undefined, "…and Object.prototype of THIS process is untouched (sanity)");
  eq((await http("PATCH", "/loyalty/settings", { token: T.owner, body: { program: { enabled: true }, clinicId: String(B._id) } })).status, 400, "settings body with a clinicId is rejected (strict schema, clinic comes from the session)");

  /* ---------- headers, caching, CORS ---------- */
  const h1 = await http("GET", "/loyalty/overview", { token: T.owner });
  eq(h1.headers.get("cache-control"), "no-store", "staff Loyalty responses are Cache-Control: no-store");
  eq(h1.headers.get("x-content-type-options"), "nosniff", "nosniff on API");
  eq(h1.headers.get("x-frame-options"), "DENY", "X-Frame-Options DENY on API");
  ok(!h1.headers.get("x-powered-by"), "no X-Powered-By");
  const h2 = await http("GET", "/public/loyalty/clinic-a/me", { token: good });
  ok(/no-store/.test(h2.headers.get("cache-control") || ""), "patient responses are no-store", h2.headers.get("cache-control"));
  const cors = async (origin, path = "/loyalty/overview", method = "GET") => (await fetch(t.BASE + path, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "authorization,content-type" } })).headers;
  const evilH = await cors("https://evil.example");
  ok(!evilH.get("access-control-allow-origin"), "CORS: an unknown origin gets NO Access-Control-Allow-Origin", evilH.get("access-control-allow-origin"));
  const okH = await cors("https://app.clinicos.test");
  eq(okH.get("access-control-allow-origin"), "https://app.clinicos.test", "CORS: the configured FRONTEND_URL is allowed (exact origin, not *)");
  ok(okH.get("access-control-allow-origin") !== "*", "CORS: never a wildcard");
  const nullH = await cors("null");
  ok(!nullH.get("access-control-allow-origin"), "CORS: the `null` origin is not allowed");
  const subH = await cors("https://app.clinicos.test.evil.example");
  ok(!subH.get("access-control-allow-origin"), "CORS: a look-alike origin is not allowed");
  const evilPub = await cors("https://evil.example", "/public/loyalty/clinic-a/identify", "POST");
  ok(!evilPub.get("access-control-allow-origin"), "CORS: the public Loyalty API does not trust unknown origins either");
  ok(!/Set-Cookie/i.test(JSON.stringify([...h1.headers.keys()])), "the API sets no cookie (Bearer-token auth → CSRF not applicable)");

  /* ---------- add-on lifecycle (admin only) takes effect immediately ---------- */
  const E = await t.mkClinic("clinic-e"); const ownerE = await t.mkUser(E, "owner"); const TE = t.tok(ownerE);
  await http("PATCH", "/loyalty/settings", { token: TE, body: { program: { enabled: true } } });
  const pE = await t.mkPatient(E, "Eman Addon", "0791010020"); const accE = await t.enroll(pE, TE);
  const sessE = pubTok(accE.id, E._id);
  eq((await http("GET", "/public/loyalty/clinic-e/me", { token: sessE })).status, 200, "add-on active: patient session works");
  const susp = await http("POST", `/admin/clinics/${E._id}/addons/loyalty/suspend`, { token: adminTok, body: {} });
  ok([200, 201].includes(susp.status), "admin can suspend the add-on", susp);
  eq((await http("GET", "/loyalty/overview", { token: TE })).status, 402, "suspended add-on → staff API 402 at once");
  const pubS = await http("GET", "/public/loyalty/clinic-e/me", { token: sessE });
  ok([401, 503].includes(pubS.status), "suspended add-on → the patient's still-valid token stops working at once", pubS.status);
  eq((await http("POST", "/public/loyalty/clinic-e/identify", { body: { phone: "0791010020" } })).status, 503, "suspended add-on → identify answers 503 LOYALTY_UNAVAILABLE");
  eq((await http("POST", `/admin/clinics/${E._id}/addons/loyalty/reactivate`, { token: T.ownerE || TE, body: {} })).status, 401, "the clinic's own owner cannot reactivate it");
  const react = await http("POST", `/admin/clinics/${E._id}/addons/loyalty/reactivate`, { token: adminTok, body: {} });
  ok([200, 201].includes(react.status), "admin reactivates", react);
  eq((await http("GET", "/loyalty/overview", { token: TE })).status, 200, "reactivated → staff API works again");
  const E2 = await m.Clinic.findById(E._id).lean();
  await m.Clinic.updateOne({ _id: E._id }, { $set: { "addons.loyalty.currentPeriodEnd": new Date(Date.now() - 1000) } });
  eq((await http("GET", "/loyalty/overview", { token: TE })).status, 402, "an add-on whose paid period ended is not entitled (402)");
  await m.Clinic.updateOne({ _id: E._id }, { $set: { "addons.loyalty.currentPeriodEnd": new Date(Date.now() + 864e5) } });
  await m.Clinic.updateOne({ _id: E._id }, { $set: { status: "suspended" } });
  eq((await http("GET", "/loyalty/overview", { token: TE })).status, 402, "a suspended CLINIC cannot use Loyalty (402)");
  eq((await http("GET", "/public/loyalty/clinic-e")).status === 404 || (await http("GET", "/public/loyalty/clinic-e")).json.available === false, true, "a suspended clinic's public page is not served as available");

  /* ---------- startup configuration validation ---------- */
  const env = require(`${t.D}/config/env`);
  const strong = { NODE_ENV: "production", MONGO_URI: "mongodb://x/y", JWT_SECRET: crypto.randomBytes(32).toString("hex"), ADMIN_JWT_SECRET: crypto.randomBytes(32).toString("hex"), LOYALTY_PUBLIC_SECRET: crypto.randomBytes(32).toString("hex"), FRONTEND_URL: "https://app.example.com", REMINDER_CRON_SECRET: crypto.randomBytes(24).toString("hex") };
  eq(env.validateEnv(strong).errors, [], "env: a complete strong production configuration has no errors");
  for (const weak of ["secret", "123456", "development-secret", "changeme", "password", "test", "JWT_SECRET", "your-secret-key", "aaaaaaaaaaaaaaaaaaaaaaaa", "short-one", "ChangeMe-ABCDEFGHIJKLMNOP"]) {
    ok(env.validateEnv({ ...strong, JWT_SECRET: weak }).errors.some((e) => e.startsWith("JWT_SECRET")), `env: production rejects JWT_SECRET=${weak.length > 12 ? weak.slice(0, 8) + "…" : weak}`);
  }
  ok(env.validateEnv({ ...strong, JWT_SECRET: undefined }).errors.includes("JWT_SECRET is not set"), "env: production rejects a missing JWT_SECRET");
  ok(env.validateEnv({ ...strong, MONGO_URI: "" }).errors.includes("MONGO_URI is not set"), "env: production rejects a missing MONGO_URI");
  ok(env.validateEnv({ ...strong, ADMIN_JWT_SECRET: strong.JWT_SECRET }).errors.some((e) => /ADMIN_JWT_SECRET must differ/.test(e)), "env: admin secret equal to the staff secret is refused");
  ok(env.validateEnv({ ...strong, LOYALTY_PUBLIC_SECRET: strong.JWT_SECRET }).errors.some((e) => /LOYALTY_PUBLIC_SECRET must differ/.test(e)), "env: patient secret equal to the staff secret is refused");
  ok(env.validateEnv({ ...strong, LOYALTY_PUBLIC_SECRET: strong.ADMIN_JWT_SECRET }).errors.some((e) => /LOYALTY_PUBLIC_SECRET must differ/.test(e)), "env: patient secret equal to the admin secret is refused");
  ok(env.validateEnv({ ...strong, FRONTEND_URL: "" }).errors.some((e) => /FRONTEND_URL/.test(e)), "env: production needs FRONTEND_URL");
  ok(env.validateEnv({ ...strong, FRONTEND_URL: "http://app.example.com" }).errors.some((e) => /https/.test(e)), "env: production FRONTEND_URL must be https");
  ok(env.validateEnv({ ...strong, FRONTEND_URL: "https://*.example.com" }).errors.length > 0, "env: wildcard FRONTEND_URL refused");
  ok(env.validateEnv({ ...strong, LOYALTY_SELF_ENROLL_MAX_PER_HOUR: "abc" }).errors.some((e) => /LOYALTY_SELF_ENROLL_MAX_PER_HOUR/.test(e)), "env: a typo in a limit variable is refused instead of silently disabling the limit");
  const dev = env.validateEnv({ NODE_ENV: "development", JWT_SECRET: "secret", MONGO_URI: "x" });
  eq(dev.errors, [], "env: outside production the same findings are only warnings");
  ok(dev.warnings.length > 0, "env: …and they ARE reported as warnings");
  ok(!JSON.stringify(env.validateEnv({ ...strong, JWT_SECRET: "ChangeMe-ABCDEFGHIJKLMNOP" })).includes("ABCDEFGHIJKLMNOP"), "env: messages name the variable, never its value");

  // a real production start-up with a weak secret must refuse to run, and must not print the value
  const weakRun = spawnServer(5111, { NODE_ENV: "production", MONGO_URI: `${MONGO_BASE}/${t.DB}_weak`, JWT_SECRET: "ChangeMe-ZZZZQQQQWWWW", FRONTEND_URL: "https://app.example.com" });
  const code = await Promise.race([weakRun.exited, t.sleep(15000).then(() => "timeout")]);
  eq(code, 1, "start-up: production with a placeholder JWT_SECRET exits with code 1");
  ok(!weakRun.log().includes("ZZZZQQQQWWWW"), "start-up: the refusal message does not print the secret");
  ok(/JWT_SECRET/.test(weakRun.log()), "start-up: the refusal names the variable");
  // …and a correct production configuration starts, with production CORS/headers
  const prodPort = 5112;
  const prod = spawnServer(prodPort, { NODE_ENV: "production", MONGO_URI: `${MONGO_BASE}/${t.DB}_prod`, ...Object.fromEntries(Object.entries(strong).filter(([k]) => !["NODE_ENV", "MONGO_URI"].includes(k))), FRONTEND_URL: "https://app.example.com" });
  let up = false; for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${prodPort}/health`)).ok) { up = true; break; } } catch {} await t.sleep(250); }
  ok(up, "start-up: a strong production configuration starts", prod.log().slice(0, 300));
  if (up) {
    const pc = async (origin) => (await fetch(`http://127.0.0.1:${prodPort}/api/loyalty/overview`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET" } })).headers.get("access-control-allow-origin");
    eq(await pc("https://app.example.com"), "https://app.example.com", "production CORS: the configured origin is allowed");
    ok(!(await pc("http://localhost:3000")), "production CORS: localhost is NOT trusted");
    ok(!(await pc("https://evil.example")), "production CORS: strangers are not trusted");
    const hh = (await fetch(`http://127.0.0.1:${prodPort}/health`)).headers;
    ok(/max-age=\d+/.test(hh.get("strict-transport-security") || ""), "production: HSTS header present");
    ok(!prod.log().includes(strong.JWT_SECRET) && !prod.log().includes(strong.ADMIN_JWT_SECRET) && !prod.log().includes(PUB_SECRET), "production start-up log prints no secret");
    prod.proc.kill();
  }

  // key separation (in-process): once a dedicated LOYALTY_PUBLIC_SECRET exists, a token signed with the derived key no longer verifies
  {
    const saveP = process.env.LOYALTY_PUBLIC_SECRET, saveJ = process.env.JWT_SECRET;
    process.env.JWT_SECRET = strong.JWT_SECRET; delete process.env.LOYALTY_PUBLIC_SECRET;
    const derivedTok = t.pub.signPublicToken({ clinicId: String(A._id), accountId: accA.id });
    ok(!!t.pub.verifyPublicToken(derivedTok), "key separation: (no dedicated secret) the derived key verifies its own tokens");
    process.env.LOYALTY_PUBLIC_SECRET = PUB_SECRET;
    eq(t.pub.verifyPublicToken(derivedTok), null, "key separation: a token signed with the derived key is refused once a dedicated LOYALTY_PUBLIC_SECRET is configured");
    const dedicated = t.pub.signPublicToken({ clinicId: String(A._id), accountId: accA.id });
    process.env.JWT_SECRET = "another-jwt-secret-0123456789abcdef";
    ok(!!t.pub.verifyPublicToken(dedicated), "key separation: rotating JWT_SECRET does not invalidate patient sessions when a dedicated secret is set");
    ok(t.pub.verifyPublicToken(jwt.sign({ userId: String(U.ownerA._id), tokenVersion: 0 }, PUB_SECRET)) === null, "key separation: even a staff-shaped token signed with the public secret is not a patient session");
    process.env.JWT_SECRET = saveJ; process.env.LOYALTY_PUBLIC_SECRET = saveP;
  }

  /* ---------- the server log never contains a token or password ---------- */
  ok(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(t.slog), "server log contains no JWT");
  ok(!t.slog.includes("secret123"), "server log contains no password");
  t.noLeaks();
  await t.finish("SEC10 AUTH / INJECTION / HEADERS / CONFIG");
})().catch((e) => { console.error("SUITE CRASHED", e); process.exit(2); });
