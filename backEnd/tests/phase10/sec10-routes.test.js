/* Phase 10 — ROUTE-TABLE MATRIX. Every route registered on the staff Loyalty router and the public Loyalty router is enumerated FROM THE COMPILED APP
   (not from a hand-written list), so a route added later is automatically attacked too. */
const { boot, world } = require("./lib");

(async () => {
  const t = await boot({ name: "sec10routes", port: 5105, env: { LOYALTY_PUBLIC_READ_MAX: "100000", LOYALTY_STAFF_WRITE_MAX: "100000", LOYALTY_STAFF_SENSITIVE_MAX: "100000" } });
  const { ok, eq, http, m } = t;
  await world(t);
  const { A, T } = t;
  const staffRouter = require(`${t.D}/routes/loyaltyRoutes`).default;
  const publicRouter = require(`${t.D}/routes/loyaltyPublicRoutes`).default;
  const list = (router) => router.stack.filter((l) => l.route).flatMap((l) => Object.keys(l.route.methods).filter((x) => l.route.methods[x]).map((meth) => ({ method: meth.toUpperCase(), path: l.route.path })));
  const staffRoutes = list(staffRouter), publicRoutes = list(publicRouter);
  ok(staffRoutes.length >= 35, "enumerated the staff Loyalty routes from the compiled router", staffRoutes.length);
  ok(publicRoutes.length >= 9, "enumerated the public Loyalty routes from the compiled router", publicRoutes.length);
  const oid = () => String(new t.mongoose.Types.ObjectId());
  const fill = (p) => p.replace(/:[A-Za-z]+/g, () => oid());
  const pA = await t.mkPatient(A, "Matrix Mina", "0791070001"); const acc = await t.enroll(pA);
  const patientTok = t.sessionFor(acc.id, A._id);
  const wrong = { id: oid() };
  const SENSITIVE = [/\/members\/:id\/adjust$/, /^\/rewards$/, /^\/rewards\/:id$/, /\/rewards\/:id\/(activate|deactivate)$/, /^\/settings$/, /^\/tiers\/config$/, /^\/tiers\/(recalculate|preview)$/, /\/redemptions\/:id\/reverse$/];
  const WRITE = (r) => r.method !== "GET";

  for (const r of staffRoutes) {
    const url = "/loyalty" + fill(r.path);
    const body = WRITE(r) ? {} : undefined;
    const label = `${r.method} /loyalty${r.path}`;
    eq((await http(r.method, url, { body })).status, 401, `${label}: anonymous → 401`);
    eq((await http(r.method, url, { token: patientTok, body })).status, 401, `${label}: patient token → 401`);
    eq((await http(r.method, url, { token: "Bearer garbage", body })).status, 401, `${label}: garbage token → 401`);
    eq((await http(r.method, url, { token: T.ownerC, body })).status, 402, `${label}: clinic WITHOUT the add-on → 402`);
    if (SENSITIVE.some((rx) => rx.test(r.path)) && WRITE(r)) {
      const rec = await http(r.method, url, { token: T.rec, body });
      eq(rec.status, 403, `${label}: receptionist → 403 (owner/doctor only)`);
    }
  }
  // methods that are not registered do not exist
  for (const [meth, url] of [["DELETE", "/loyalty/members/" + acc.id], ["PUT", "/loyalty/members/" + acc.id], ["PATCH", "/loyalty/members/" + acc.id], ["DELETE", "/loyalty/transactions"], ["POST", "/loyalty/transactions"], ["PUT", "/loyalty/transactions/" + oid()], ["DELETE", "/loyalty/transactions/" + oid()], ["PATCH", "/loyalty/members/" + acc.id + "/balance"], ["POST", "/loyalty/members/" + acc.id + "/tier"]]) {
    const r = await http(meth, url, { token: T.owner, body: {} });
    ok([404, 405].includes(r.status), `${meth} ${url.replace(/[a-f0-9]{24}/g, ":id")} does not exist (no way to edit / delete the ledger or set a balance/tier) → ${r.status}`, r.status);
  }
  eq(await t.balance(acc.id), 0, "nothing in the matrix changed the balance");

  // public router
  const openPaths = new Set(["/:slug", "/:slug/identify"]);
  for (const r of publicRoutes) {
    const url = "/public/loyalty/clinic-a" + r.path.replace("/:slug", "").replace(/:[A-Za-z]+/g, () => oid());
    const label = `${r.method} /public/loyalty/:slug${r.path.replace("/:slug", "")}`;
    if (openPaths.has(r.path)) continue; // covered by their own assertions below / in the other suites
    eq((await http(r.method, url, { body: r.method === "GET" ? undefined : {} })).status, 401, `${label}: anonymous → 401`);
    eq((await http(r.method, url, { token: T.owner, body: r.method === "GET" ? undefined : {} })).status, 401, `${label}: staff token → 401`);
    eq((await http(r.method, url, { token: "garbage", body: r.method === "GET" ? undefined : {} })).status, 401, `${label}: garbage token → 401`);
    const own = await http(r.method, url, { token: patientTok, body: r.method === "GET" ? undefined : {} });
    ok(own.status !== 401 && own.status !== 500, `${label}: a valid patient session is accepted (status ${own.status})`, own.status);
    ok(!/"stack"|node_modules|MongoServerError/.test(own.text), `${label}: no internals in the response`);
  }
  eq((await http("GET", "/public/loyalty/clinic-a")).status, 200, "GET /public/loyalty/:slug is the only unauthenticated read (clinic name/brand only)");
  const info = (await http("GET", "/public/loyalty/clinic-a")).json;
  eq(Object.keys(info).sort(), ["available", "clinic"], "…and returns only { available, clinic }");
  eq(Object.keys(info.clinic).sort(), ["brandColor", "logoUrl", "name", "programName"], "…where clinic = { name, logoUrl, brandColor, programName }");
  // nothing else is mounted under the public Loyalty prefix
  for (const extra of ["/clinic-a/members", "/clinic-a/admin", "/clinic-a/settings", "/clinic-a/transactions", "/clinic-a/redemptions", "/clinic-a/rewards/all", "/clinic-a/me/adjust", "/clinic-a/export", "/clinic-a/..%2fclinic-b"]) {
    const r = await http("GET", "/public/loyalty" + extra, { token: patientTok });
    ok([404, 401].includes(r.status), `GET /public/loyalty${extra} is not a route → ${r.status}`, r.status);
  }
  // HTTP verbs on the identify endpoint
  for (const meth of ["GET", "PUT", "DELETE", "PATCH"]) ok([404, 405].includes((await http(meth, "/public/loyalty/clinic-a/identify", { body: meth === "GET" ? undefined : {} })).status), `${meth} /identify is not allowed`);
  // OPTIONS/HEAD/TRACE sanity
  const tr = await fetch(t.BASE + "/loyalty/overview", { method: "TRACE" }).catch(() => ({ status: 0 }));
  ok([0, 404, 405].includes(tr.status), "TRACE is not served", tr.status);
  t.noLeaks();
  await t.finish("SEC10 ROUTE-TABLE MATRIX");
})().catch((e) => { console.error("SUITE CRASHED", e); process.exit(2); });
