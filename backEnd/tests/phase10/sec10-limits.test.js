/* Phase 10 — RATE LIMITING / ABUSE CONTROLS (public + staff). A dedicated server with LOW ceilings so every limit can really be hit. */
const { boot, world } = require("./lib");

(async () => {
  const t = await boot({ name: "sec10lim", port: 5104, env: { LOYALTY_STAFF_WRITE_MAX: "12", LOYALTY_STAFF_SENSITIVE_MAX: "4", LOYALTY_PUBLIC_READ_MAX: "15", LOYALTY_SELF_ENROLL_MAX_PER_HOUR: "6" } });
  const { ok, eq, http, m } = t;
  await world(t);
  const { A, B, T } = t;
  // fresh users: world() already spent part of the original owners' sensitive buckets while switching the programme on
  const mk = async (c, role, n) => t.tok(await t.mkUser(c, role, n));
  const L = { owner: await mk(A, "owner", 7), doc: await mk(A, "doctor", 7), doc2: await mk(A, "doctor", 8), rec: await mk(A, "receptionist", 7), rec2: await mk(A, "receptionist", 8), ownerB: await mk(B, "owner", 7), ownerB2: await mk(B, "owner", 9), docB: await mk(B, "doctor", 7) };
  const GENERIC_429 = { message: "Too many requests, please slow down and try again shortly", code: "RATE_LIMITED" };

  /* ---------- staff: sensitive actions (manual adjustment) ---------- */
  const p = await t.mkPatient(A, "Limit Lina", "0791050001"); const acc = await t.enroll(p);
  const adjust = (tk, n = 1) => http("POST", `/loyalty/members/${acc.id}/adjust`, { token: tk, body: { direction: "credit", points: n, reason: "limit test credit" } });
  const first = [];
  for (let i = 0; i < 5; i++) first.push(await adjust(L.owner));
  eq(first.map((x) => x.status), [200, 200, 200, 200, 429], "owner: 4 manual adjustments allowed per minute, the 5th is 429");
  eq(first[4].json, GENERIC_429, "the 429 body is the generic message + code — no internals, no limits, no stack");
  ok(!!first[4].headers.get("ratelimit-limit") || !!first[4].headers.get("ratelimit-policy") || !!first[4].headers.get("retry-after"), "standard RateLimit / Retry-After headers are sent", [...first[4].headers.keys()].filter((k) => /rate|retry/i.test(k)));
  eq(await t.balance(acc.id), 4, "the throttled request changed nothing (balance = 4 credits of 1)");
  eq((await adjust(L.doc)).status, 200, "the DOCTOR is not throttled by the owner's usage (limits are per user, not per clinic or IP)");
  eq((await http("POST", `/loyalty/members/${acc.id}/adjust`, { token: L.ownerB, body: { direction: "credit", points: 1, reason: "other clinic" } })).status, 404, "another clinic's owner still gets the normal 404 (own bucket)");
  eq((await http("GET", "/loyalty/overview", { token: L.owner })).status, 200, "reads are not throttled by write limits");
  const reads = []; for (let i = 0; i < 25; i++) reads.push((await http("GET", "/loyalty/members", { token: L.owner })).status);
  ok(reads.every((s) => s === 200), "25 consecutive staff reads all succeed", reads);

  /* ---------- staff: ordinary writes (desk work) ---------- */
  const rec = [];
  for (let i = 0; i < 14; i++) rec.push((await http("POST", `/loyalty/checkins/${new t.mongoose.Types.ObjectId()}/confirm`, { token: L.rec, body: {} })).status);
  eq(rec.slice(0, 12).every((s) => s === 404), true, "receptionist: the first 12 desk actions are processed normally (404 for unknown ids)");
  eq(rec.slice(12), [429, 429], "…the 13th and 14th in the same minute are 429");
  eq((await http("POST", `/loyalty/checkins/${new t.mongoose.Types.ObjectId()}/confirm`, { token: L.rec2, body: {} })).status, 404, "a second receptionist is unaffected");
  // anonymous / invalid tokens never reach the limiter (they are 401 first) and cannot exhaust a real user's bucket
  for (let i = 0; i < 20; i++) await http("POST", `/loyalty/members/${acc.id}/adjust`, { token: "garbage", body: {} });
  eq((await http("POST", `/loyalty/members/${acc.id}/adjust`, { token: L.docB, body: { direction: "credit", points: 1, reason: "doctor B first call" } })).status, 404, "garbage-token traffic did not consume anyone's bucket");
  // reward / settings / tier configuration share the sensitive bucket
  const cfg = [];
  for (let i = 0; i < 5; i++) cfg.push((await http("POST", "/loyalty/rewards", { token: L.ownerB2, body: { name: "Limit reward " + i, pointsRequired: 100 + i } })).status);
  eq(cfg, [201, 201, 201, 201, 429], "reward creation: 4 per minute per user, the 5th is 429");
  eq((await http("PATCH", "/loyalty/settings", { token: L.ownerB2, body: { program: { enabled: true } } })).status, 429, "…settings changes are in the same sensitive bucket (429)");
  eq((await http("PUT", "/loyalty/tiers/config", { token: L.ownerB2, body: { enabled: false } })).status, 429, "…and tier configuration too (429)");
  eq((await http("GET", "/loyalty/rewards", { token: L.ownerB2 })).status, 200, "…while reading the catalog still works");

  /* ---------- public: identification layering ---------- */
  const known = await t.mkPatient(A, "Known Kamel", "0791050010"); await t.enroll(known);
  const ip1 = "10.140.1.1";
  const idf = (slug, phone, ip) => http("POST", `/public/loyalty/${slug}/identify`, { body: { phone }, ip });
  const out = [];
  for (let i = 0; i < 9; i++) out.push((await idf("clinic-a", "07966" + String(50000 + i), ip1)).status);
  eq(out.slice(0, 8), Array(8).fill(404), "8 failed lookups from one address at one clinic are answered normally (404)");
  eq(out[8], 429, "the 9th failure at the SAME clinic from the SAME address is 429 (clinic + IP bucket)");
  const g = await idf("clinic-a", "0791050010", ip1);
  eq(g.status, 429, "…while that bucket is full even a correct number from that address is held back for the window");
  eq(g.json, { message: "Too many requests, please try again shortly", code: "RATE_LIMITED" }, "…with the generic body");
  // the same address on ANOTHER clinic has its own clinic bucket but shares the per-IP failure ceiling (12)
  const b = [];
  for (let i = 0; i < 6; i++) b.push((await idf("clinic-b", "07966" + String(60000 + i), ip1)).status);
  eq(b, [404, 404, 429, 429, 429, 429], "same address at clinic B: the per-address failure ceiling (12) is shared across clinics — and the two 429s above counted as failures too, so only 2 more are answered");
  // a different address is unaffected
  eq((await idf("clinic-a", "0791050010", "10.140.1.2")).status, 200, "another address identifies normally");
  // successes are NOT counted against the failure buckets
  const ip3 = "10.140.2.1"; const succ = [];
  for (let i = 0; i < 20; i++) succ.push((await idf("clinic-a", "0791050010", ip3)).status);
  eq(succ.every((s) => s === 200), true, "20 successful identifications from one address (a clinic's shared Wi-Fi) are never throttled");
  eq((await idf("clinic-a", "0799999999", ip3)).status, 404, "…and a failure after many successes is still a normal 404");
  // hard ceiling on every attempt
  const ip4 = "10.140.3.1"; let hit = 0, n = 0;
  for (; n < 66; n++) { const r = await idf("clinic-a", "0791050010", ip4); if (r.status === 429) { hit = n + 1; break; } }
  ok(hit > 0 && hit <= 61, "an absolute ceiling stops even successful attempts (429 by the 61st in 15 minutes from one address)", hit);
  // per-phone throttle (distributed guessing of ONE number)
  const target = "0799000123"; const ph = [];
  for (let i = 0; i < 7; i++) ph.push((await idf("clinic-a", target, `10.141.0.${i + 1}`)).status);
  eq(ph, [404, 404, 404, 404, 404, 429, 429], "the SAME number guessed from different addresses is throttled after 5 failures (per clinic + number)");
  eq((await idf("clinic-b", target, "10.141.1.1")).status, 404, "…and that throttle is scoped to the clinic");
  eq((await idf("clinic-a", "0791050010", "10.141.2.1")).status, 200, "…and does not affect other numbers");
  ok(!(await m.ActivityLog.find({ action: "loyalty.public.identify_throttled" }).lean()).some((x) => JSON.stringify(x).includes(target)), "the throttle log entry never contains the number");

  /* ---------- public: reads, check-in, rewards ---------- */
  const sess = t.sessionFor(acc.id, A._id);
  const rr = []; for (let i = 0; i < 17; i++) rr.push((await http("GET", "/public/loyalty/clinic-a/me", { token: sess, ip: "10.142.0.1" })).status);
  eq([rr.slice(0, 15).every((s) => s === 200), rr[15], rr[16]], [true, 429, 429], "public reads: 15 per minute per address (test ceiling), then 429");
  eq((await http("GET", "/public/loyalty/clinic-a/me", { token: sess, ip: "10.142.0.2" })).status, 200, "another address is unaffected");
  // check-in is limited per MEMBER, not per address
  await http("PATCH", "/loyalty/settings", { token: L.owner, body: { checkin: { enabled: true } } }).catch(() => {});
  const m1 = await t.mkPatient(A, "Wait One", "0791050021"), m2 = await t.mkPatient(A, "Wait Two", "0791050022");
  const a1 = await t.enroll(m1), a2 = await t.enroll(m2);
  const s1 = t.sessionFor(a1.id, A._id), s2 = t.sessionFor(a2.id, A._id);
  const shared = "10.143.0.9";
  const flood = []; for (let i = 0; i < 10; i++) flood.push((await http("POST", "/public/loyalty/clinic-a/checkin", { token: s1, body: {}, ip: shared })).status);
  eq(flood.filter((s) => s === 429).length, 2, "check-in: a member's own flood is limited (8 per 15 min → the 9th and 10th are 429)");
  const other = await http("POST", "/public/loyalty/clinic-a/checkin", { token: s2, body: {}, ip: shared });
  ok([200, 201].includes(other.status), "…but ANOTHER member on the SAME address (a waiting room) is not affected", other.status);
  eq(await m.LoyaltyCheckIn.countDocuments({ accountId: a1.id }), 1, "the flood created ONE check-in request");
  // reward requests per member
  await t.credit(A._id, a1.id, 10000);
  const rws = []; for (let i = 0; i < 12; i++) rws.push((await http("POST", "/loyalty/rewards", { token: i < 4 ? L.owner : L.doc2, body: { name: "Spam reward " + i, pointsRequired: 10 + i } })).status);
  ok(rws.filter((s) => s === 201).length >= 4, "(setup) rewards created for the request-flood test", rws);
  const ids = (await m.LoyaltyReward.find({ clinicId: A._id, name: /Spam reward/ }).lean()).map((r) => String(r._id));
  const reqs = []; for (const id of ids.slice(0, 12)) reqs.push((await http("POST", `/public/loyalty/clinic-a/rewards/${id}/redeem`, { token: s1, body: {}, ip: "10.143.1.1" })).status);
  const created = reqs.filter((s) => s === 201).length;
  ok(created <= 10, "reward requests: a member cannot create more than 10 in 15 minutes", { created, reqs });
  ok(reqs.includes(429) || ids.length < 11, "…the 11th request is 429", reqs);

  /* ---------- self-enrolment ceiling per clinic ---------- */
  const many = []; for (let i = 0; i < 9; i++) many.push(await t.mkPatient(B, "Cap " + i, "07910600" + String(10 + i)));
  const capRes = []; for (const x of many) capRes.push((await idf("clinic-b", x.phone, t.newIp())).status);
  eq(capRes.slice(0, 6), Array(6).fill(200), "self-enrolment ceiling (test: 6 per hour per clinic): the first 6 new members are enrolled");
  eq(capRes.slice(6), [429, 429, 429], "…the 7th+ new self-enrolments in the hour are 429");
  eq(await m.LoyaltyAccount.countDocuments({ patientId: { $in: many.map((x) => x._id) } }), 6, "…exactly 6 accounts were created");
  const existing = await idf("clinic-b", many[0].phone, t.newIp());
  eq(existing.status, 200, "…an already-enrolled member is NOT affected by the ceiling (not an enrolment)");

  /* ---------- recovery after the window (real wait) ---------- */
  console.log("waiting 62 s for the staff window to reset…");
  await t.sleep(62000);
  eq((await adjust(L.owner)).status, 200, "after the 60-second window the owner can adjust again (limits recover)");
  eq((await http("POST", `/loyalty/checkins/${new t.mongoose.Types.ObjectId()}/confirm`, { token: L.rec, body: {} })).status, 404, "…and the receptionist's desk actions are processed again");

  t.noLeaks();
  await t.finish("SEC10 RATE LIMITS / ABUSE CONTROLS");
})().catch((e) => { console.error("SUITE CRASHED", e); process.exit(2); });
