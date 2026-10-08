/* Phase 10 — TENANT ISOLATION / IDOR / ENUMERATION / ROLE MATRIX / NON-AUTHORITATIVE CLIENT VALUES (compiled server, real HTTP). */
const { boot, world } = require("./lib");

(async () => {
  const t = await boot({ name: "sec10idor", port: 5102, env: { LOYALTY_PUBLIC_READ_MAX: "100000", LOYALTY_STAFF_WRITE_MAX: "100000", LOYALTY_STAFF_SENSITIVE_MAX: "100000" } });
  const { ok, eq, http, m } = t;
  await world(t);
  const { A, B, T, U } = t;
  const sess = (acc, clinic) => t.sessionFor(acc.id || acc._id, clinic._id);

  // ---------- Clinic A world ----------
  const pA1 = await t.mkPatient(A, "Ahmad Alpha", "0791020001"), pA2 = await t.mkPatient(A, "Amal Second", "0791020002");
  const accA1 = await t.enroll(pA1), accA2 = await t.enroll(pA2);
  await t.credit(A._id, accA1.id, 1000); await t.credit(A._id, accA2.id, 600);
  const rwA = (await http("POST", "/loyalty/rewards", { token: T.owner, body: { name: "A Facial", pointsRequired: 500 } })).json.reward;
  const rwA2 = (await http("POST", "/loyalty/rewards", { token: T.owner, body: { name: "A Scaling", pointsRequired: 300 } })).json.reward;
  // ---------- Clinic B world ----------
  const pB1 = await t.mkPatient(B, "Bilal Beta", "0791020003");
  const accB1 = await t.enroll(pB1, T.ownerB);
  await t.credit(B._id, accB1.id, 900);
  const rwB = (await http("POST", "/loyalty/rewards", { token: T.ownerB, body: { name: "B Massage", pointsRequired: 100 } })).json.reward;
  ok(rwA && rwA.id && rwB && rwB.id, "setup: rewards exist in both clinics");

  const sA1 = sess(accA1, A), sA2 = sess(accA2, A), sB1 = sess(accB1, B);
  // pending redemption + pending check-in in A
  const red = await http("POST", `/public/loyalty/clinic-a/rewards/${rwA.id}/redeem`, { token: sA1, body: {} });
  eq(red.status, 201, "setup: A's patient requests a reward");
  const redId = String((await m.LoyaltyRedemption.findOne({ clinicId: A._id }).lean())._id);
  const ci = await http("POST", "/public/loyalty/clinic-a/checkin", { token: sA2, body: { via: "qr" } });
  eq(ci.status, 201, "setup: A's patient requests a check-in");
  const ciId = String((await m.LoyaltyCheckIn.findOne({ clinicId: A._id }).lean())._id);
  // a confirmed redemption in A (for the reversal attack)
  const pA3 = await t.mkPatient(A, "Aya Third", "0791020004"); const accA3 = await t.enroll(pA3); await t.credit(A._id, accA3.id, 700);
  await http("POST", `/public/loyalty/clinic-a/rewards/${rwA.id}/redeem`, { token: sess(accA3, A), body: {} });
  const redDone = await m.LoyaltyRedemption.findOne({ clinicId: A._id, accountId: accA3.id }).lean();
  eq((await http("POST", `/loyalty/redemptions/${redDone._id}/confirm`, { token: T.rec, body: {} })).status, 200, "setup: A's reception confirms a redemption");
  const apptA = await m.Appointment.create({ clinicId: A._id, patientId: pA2._id, doctorId: U.docA._id, startAt: new Date(Date.now() + 3600e3), duration: 30, status: "scheduled" });
  const snapshot = async () => JSON.stringify({
    accounts: (await m.LoyaltyAccount.find({ clinicId: A._id }).sort({ _id: 1 }).lean()).map((a) => [String(a._id), a.pointsBalance, a.status, a.seq]),
    tx: await m.LoyaltyTransaction.countDocuments({ clinicId: A._id }),
    rewards: (await m.LoyaltyReward.find({ clinicId: A._id }).sort({ _id: 1 }).lean()).map((r) => [String(r._id), r.name, r.pointsRequired, r.status]),
    reds: (await m.LoyaltyRedemption.find({ clinicId: A._id }).sort({ _id: 1 }).lean()).map((r) => [String(r._id), r.status]),
    cis: (await m.LoyaltyCheckIn.find({ clinicId: A._id }).sort({ _id: 1 }).lean()).map((r) => [String(r._id), r.status]),
    settings: JSON.stringify((await m.LoyaltySettings.findOne({ clinicId: A._id }).lean()) || {}),
  });
  const before = await snapshot();

  /* ---------- clinic B (owner, the strongest B role) attacks every A resource ---------- */
  const attacks = [
    ["GET", `/loyalty/members/${accA1.id}`], ["GET", `/loyalty/members/${accA1.id}/transactions`], ["GET", `/loyalty/members/${accA1.id}/insights`],
    ["POST", `/loyalty/members/${accA1.id}/adjust`, { direction: "credit", points: 5000, reason: "cross-clinic attack" }],
    ["POST", `/loyalty/members/${accA1.id}/adjust`, { direction: "debit", points: 500, reason: "cross-clinic attack" }],
    ["POST", "/loyalty/members", { patientId: String(pA1._id) }],
    ["GET", `/loyalty/rewards/${rwA.id}`], ["PATCH", `/loyalty/rewards/${rwA.id}`, { pointsRequired: 1 }], ["POST", `/loyalty/rewards/${rwA.id}/deactivate`, {}],
    ["POST", `/loyalty/rewards/${rwA.id}/activate`, {}], ["DELETE", `/loyalty/rewards/${rwA.id}`],
    ["POST", `/loyalty/redemptions/${redId}/confirm`, {}], ["POST", `/loyalty/redemptions/${redId}/reject`, {}],
    ["POST", `/loyalty/redemptions/${redDone._id}/reverse`, { reason: "cross-clinic attack" }], ["POST", `/loyalty/redemptions/${redDone._id}/confirm`, {}],
    ["POST", `/loyalty/checkins/${ciId}/confirm`, {}], ["POST", `/loyalty/checkins/${ciId}/reject`, {}],
    ["POST", `/loyalty/checkins/${ciId}/confirm`, { appointmentId: String(apptA._id) }],
  ];
  for (const [method, url, body] of attacks) {
    const r = await http(method, url, { token: T.ownerB, body });
    ok([404, 400].includes(r.status), `B owner ${method} ${url.replace(/[a-f0-9]{24}/g, ":id")} → 404/400`, { s: r.status, body: r.text.slice(0, 100) });
  }
  eq(await snapshot(), before, "after ALL cross-clinic attacks by B, clinic A's accounts / ledger / rewards / redemptions / check-ins / settings are byte-identical");
  // lists never include the other tenant
  const idsIn = (text, ids) => ids.filter((i) => text.includes(i));
  const aIds = [accA1.id, accA2.id, accA3.id, String(pA1._id), String(pA2._id), rwA.id, redId, ciId];
  for (const url of ["/loyalty/members", "/loyalty/transactions", "/loyalty/rewards", "/loyalty/redemptions?scope=pending", "/loyalty/redemptions?scope=history", "/loyalty/checkins", "/loyalty/activity", "/loyalty/analytics", "/loyalty/overview", "/loyalty/tiers/history", "/loyalty/tiers/analytics"]) {
    const r = await http("GET", url, { token: T.ownerB });
    ok(r.status === 200, `B: GET ${url} works`, r.status);
    eq(idsIn(r.text, aIds), [], `B: GET ${url} contains none of clinic A's ids`);
  }
  for (const q of ["?clinicId=" + A._id, "?clinic=" + A._id, `?accountId=${accA1.id}`]) {
    const r = await http("GET", "/loyalty/members" + q, { token: T.ownerB });
    ok(r.status === 200 || r.status === 400, "B: /members" + q.slice(0, 20) + " is handled", r.status);
    eq(idsIn(r.text, aIds), [], "B: a clinicId/accountId query parameter does not widen the scope " + q.slice(0, 14));
  }
  { const r = await http("GET", `/loyalty/transactions?accountId=${accA1.id}`, { token: T.ownerB }); ok(r.status === 200 || r.status === 404, "B: transactions of A's account id → empty/404", r.status); eq(idsIn(r.text, aIds), [], "…and nothing of A is listed"); }
  // body clinicId / mass assignment in writes
  for (const [method, url, body] of [
    ["POST", "/loyalty/rewards", { name: "Mass A", pointsRequired: 10, clinicId: String(A._id) }],
    ["PATCH", "/loyalty/settings", { program: { enabled: true }, clinicId: String(A._id) }],
    ["POST", "/loyalty/members", { patientId: String(pB1._id), clinicId: String(A._id) }],
    ["POST", `/loyalty/members/${accB1.id}/adjust`, { direction: "credit", points: 5, reason: "mass assignment", clinicId: String(A._id) }],
    ["POST", `/loyalty/members/${accB1.id}/adjust`, { direction: "credit", points: 5, reason: "mass assignment", pointsBalance: 99999 }],
    ["POST", `/loyalty/members/${accB1.id}/adjust`, { direction: "credit", points: 5, reason: "mass assignment", tier: "tier4" }],
    ["POST", `/loyalty/members/${accB1.id}/adjust`, { direction: "credit", points: 5, reason: "mass assignment", balanceAfter: 1 }],
    ["POST", "/loyalty/members", { patientId: String(pB1._id), pointsBalance: 99999 }],
    ["POST", "/loyalty/members", { patientId: String(pB1._id), tier: { key: "tier4" } }],
  ]) {
    const r = await http(method, url, { token: T.ownerB, body });
    eq(r.status, 400, `strict schema: ${method} ${url.replace(/[a-f0-9]{24}/g, ":id")} with ${Object.keys(body).slice(-1)[0]} → 400`);
  }
  eq(await t.balance(accB1.id), 900, "B's balance untouched by the mass-assignment attempts");
  eq(await snapshot(), before, "…and A is still untouched");

  /* ---------- tiers / settings isolation ---------- */
  const tiersBody = (names) => ({ enabled: true, progressionMetric: "lifetime_points", tiers: { tier1: { name: names[0] }, tier2: { name: names[1], threshold: 1000 }, tier3: { name: names[2], threshold: 3000 }, tier4: { name: names[3], threshold: 7000 } } });
  eq((await http("PUT", "/loyalty/tiers/config", { token: T.owner, body: tiersBody(["A-Base", "A-Silver", "A-Gold", "A-VIP"]) })).status, 200, "A configures its tiers");
  eq((await http("PUT", "/loyalty/tiers/config", { token: T.ownerB, body: tiersBody(["B-Base", "B-Silver", "B-Gold", "B-VIP"]) })).status, 200, "B configures its tiers");
  const cfgA = await http("GET", "/loyalty/tiers/config", { token: T.rec });
  eq(cfgA.json.config.tiers.map((x) => x.name), ["A-Base", "A-Silver", "A-Gold", "A-VIP"], "A's tier names are A's own");
  ok(!cfgA.text.includes("B-"), "A's tier config shows nothing of B");
  eq((await http("PUT", "/loyalty/tiers/config", { token: T.ownerB, body: { ...tiersBody(["x1", "x2", "x3", "x4"]), clinicId: String(A._id) } })).status, 400, "tier config body with a clinicId → 400");
  eq((await http("GET", "/loyalty/tiers/config", { token: T.rec })).json.config.tiers[1].name, "A-Silver", "A's config is unchanged by B's attempts");
  const setB = await http("PATCH", "/loyalty/settings", { token: T.ownerB, body: { earning: { visits: { enabled: true, pointsPerVisit: 77 } } } });
  eq(setB.status, 200, "B changes its earning rule");
  const setA = await http("GET", "/loyalty/settings", { token: T.owner });
  ok(!JSON.stringify(setA.json).includes('"pointsPerVisit":77'), "…and A's settings do not show B's value", setA.json && setA.json.settings && setA.json.settings.earning);

  /* ---------- patient sessions across clinics ---------- */
  const xr = async (slug, tok, method, path, body) => http(method, `/public/loyalty/${slug}${path}`, { token: tok, body });
  for (const [path, method, body] of [["/me", "GET"], ["/activity", "GET"], ["/rewards", "GET"], ["/checkin", "GET"], ["/checkin", "POST", {}], ["/checkin/cancel", "POST", {}], [`/rewards/${rwB.id}/redeem`, "POST", {}]]) {
    const r = await xr("clinic-b", sA1, method, path, body);
    ok(r.status === 401, `A's patient token on clinic B ${method} ${path.replace(/[a-f0-9]{24}/g, ":id")} → 401`, r.status);
    const r2 = await xr("clinic-a", sB1, method, path.replace(rwB.id, rwA.id), body);
    ok(r2.status === 401, `B's patient token on clinic A ${method} ${path.replace(/[a-f0-9]{24}/g, ":id")} → 401`, r2.status);
  }
  // within the right clinic: other clinic's reward id / invalid ids
  let r = await xr("clinic-a", sA2, "POST", `/rewards/${rwB.id}/redeem`, {});
  eq(r.status, 404, "A's patient cannot redeem B's reward (404 REWARD_NOT_FOUND)");
  r = await xr("clinic-a", sA2, "POST", `/rewards/zzz/redeem`, {});
  eq(r.status, 404, "invalid reward id → 404");
  r = await xr("clinic-a", sA2, "POST", `/rewards/${new t.mongoose.Types.ObjectId()}/redeem`, {});
  eq(r.status, 404, "unknown reward id → 404");
  eq(await m.LoyaltyRedemption.countDocuments({ accountId: accA2.id }), 0, "none of those created a redemption");
  // the account always comes from the session — never from the request
  for (const [method, path, body] of [["POST", "/checkin", { accountId: accA1.id }], ["POST", "/checkin", { clinicId: String(B._id) }], ["POST", `/rewards/${rwA2.id}/redeem`, { accountId: accA1.id }], ["POST", `/rewards/${rwA2.id}/redeem`, { points: 1 }], ["POST", `/rewards/${rwA2.id}/redeem`, { pointsCost: 1, pointsRequired: 1 }], ["POST", "/checkin", { status: "confirmed" }], ["POST", "/checkin", { via: "carrier-pigeon" }]]) {
    const rr = await xr("clinic-a", sA2, method, path, body);
    eq(rr.status, 400, `patient ${method} ${path.replace(/[a-f0-9]{24}/g, ":id")} with ${Object.keys(body)[0]}=… → 400 (strict body)`);
  }
  const me2 = await http("GET", `/public/loyalty/clinic-a/me?accountId=${accA1.id}&clinicId=${B._id}`, { token: sA2 });
  eq([me2.status, me2.json.member.displayName], [200, "Amal"], "?accountId= / ?clinicId= on /me are ignored — the session decides");
  const act2 = await http("GET", `/public/loyalty/clinic-a/activity?accountId=${accA1.id}`, { token: sA2 });
  ok(act2.status === 200 || act2.status === 400, "?accountId= on /activity is handled", act2.status);
  ok(!act2.text.includes(accA1.id), "…and never answers for another account");
  // patient responses expose no internal identifiers or personal data
  const publicTexts = [];
  for (const path of ["/me", "/activity", "/rewards", "/checkin"]) publicTexts.push((await xr("clinic-a", sA2, "GET", path)).text);
  const allPub = publicTexts.join("\n");
  for (const [label, needle] of [["account id", accA2.id], ["patient id", String(pA2._id)], ["clinic id", String(A._id)], ["phone", "0791020002"], ["surname", "Second"], ["file number", `"fileNumber"`], ["user id", String(U.ownerA._id)]]) ok(!allPub.includes(needle), `patient API responses never contain the ${label}`);
  ok(!/"_id"|"__v"|clinicId|patientId|accountId/.test(allPub), "patient API responses carry no database field names");

  /* ---------- enumeration protection ---------- */
  const arch = await t.mkPatient(A, "Archived Person", "0791020010", { isArchived: true });
  const susp = await t.mkPatient(A, "Suspended Person", "0791020011"); const accS = await t.enroll(susp); await m.LoyaltyAccount.updateOne({ _id: accS.id }, { $set: { status: "suspended" } });
  const dup1 = await t.mkPatient(A, "Twin One", "0791020012"), dup2 = await t.mkPatient(A, "Twin Two", "+962791020012");
  const idf = (slug, phone) => http("POST", `/public/loyalty/${slug}/identify`, { body: { phone } });
  const unknown = await idf("clinic-a", "0799999901");
  const answers = {
    "an unknown number": unknown,
    "an archived patient": await idf("clinic-a", "0791020010"),
    "a suspended member": await idf("clinic-a", "0791020011"),
    "a number shared by two patients": await idf("clinic-a", "0791020012"),
    "another clinic's patient": await idf("clinic-a", "0791020003"),
  };
  for (const [label, r] of Object.entries(answers)) {
    eq([r.status, r.text], [unknown.status, unknown.text], `identify answers for ${label} are BYTE-IDENTICAL to an unknown number (no enumeration)`);
  }
  eq(await m.LoyaltyAccount.countDocuments({ patientId: { $in: [arch._id, dup1._id, dup2._id] } }), 0, "none of those cases created an account");
  eq(await m.Patient.countDocuments({ clinicId: A._id, phone: "0799999901" }), 0, "an unknown number created no Patient");
  ok(!unknown.text.includes("0799999901") && !/patient|loyalty account|enrol/i.test(unknown.json.message), "the answer neither echoes the number nor says why");
  const pubInfo = await http("GET", "/public/loyalty/clinic-a");
  ok(!/_id|ownerEmail|addons|plan|status/.test(JSON.stringify(pubInfo.json)), "the public clinic info exposes no ids / plan / add-on data", pubInfo.json);
  const notFound = await http("GET", "/public/loyalty/no-such-clinic");
  eq([notFound.status, notFound.json.code], [404, "NOT_FOUND"], "unknown slug → generic 404");

  /* ---------- client values are never authoritative ---------- */
  const pX = await t.mkPatient(A, "Xavier Client", "0791020020"); const accX = await t.enroll(pX);
  for (const body of [{ phone: "0791020020", points: 999999 }, { phone: "0791020020", pointsBalance: 999999, tier: "tier4" }, { phone: "0791020020", clinicId: String(B._id) }, { phone: "0791020020", accountId: accA1.id }, { phone: "0791020020", newlyEnrolled: true }]) {
    const rr = await http("POST", "/public/loyalty/clinic-a/identify", { body });
    ok([200, 400].includes(rr.status), "identify with extra client fields is handled: " + Object.keys(body).slice(1).join(","), rr.status);
    if (rr.status === 200) eq(String(t.jwt.decode(rr.json.token).aid), accX.id, "…a session for a different account can never be requested: " + Object.keys(body).slice(1).join(","));
  }
  const accXdb = await m.LoyaltyAccount.findById(accX.id).lean();
  eq([accXdb.pointsBalance, accXdb.tier && accXdb.tier.key], [0, "tier1"], "client-supplied points / tier changed nothing");

  /* ---------- role matrix (staff) ---------- */
  const roleCases = [
    // [label, method, url, body, {owner, doc, rec}]
    ["manual adjustment", "POST", `/loyalty/members/${accA2.id}/adjust`, { direction: "credit", points: 1, reason: "role matrix check" }, [200, 200, 403]],
    ["reward create", "POST", "/loyalty/rewards", { name: "Role Matrix", pointsRequired: 50 }, [201, 201, 403]],
    ["settings change", "PATCH", "/loyalty/settings", { branding: { displayName: "Role Matrix Clinic" } }, [200, 200, 403]],
    ["tier config", "PUT", "/loyalty/tiers/config", tiersBody(["A-Base", "A-Silver", "A-Gold", "A-VIP"]), [200, 200, 403]],
    ["tier recalculate", "POST", "/loyalty/tiers/recalculate", {}, [200, 200, 403]],
    ["staff enrolment", "POST", "/loyalty/members", { patientId: String((await t.mkPatient(A, "Role Enroll", "0791020030"))._id) }, [201, 201, 201]],
  ];
  for (const [label, method, url, body, expected] of roleCases) {
    const got = [];
    for (const tk of [T.owner, T.doc, T.rec]) {
      const rr = await http(method, url, { token: tk, body });
      got.push(rr.status);
    }
    // the receptionist is tried LAST so a 403 proves the role gate, not a state conflict
    const norm = got.map((s) => (s >= 200 && s < 300 ? (s === 201 ? 201 : 200) : s));
    ok(JSON.stringify(norm) === JSON.stringify(expected) || (label === "staff enrolment" && norm[0] === 201 && norm[1] === 409), `role matrix — ${label}: owner/doctor/receptionist = ${JSON.stringify(expected)}`, norm);
  }
  // reception can do the desk work
  const ci2 = await http("POST", `/loyalty/checkins/${ciId}/confirm`, { token: T.rec, body: {} });
  eq(ci2.status, 200, "role matrix — receptionist CAN confirm a check-in");
  const rd = await http("POST", `/loyalty/redemptions/${redId}/confirm`, { token: T.rec, body: {} });
  eq(rd.status, 200, "role matrix — receptionist CAN confirm a redemption");
  eq((await http("POST", `/loyalty/redemptions/${redId}/reverse`, { token: T.rec, body: { reason: "reception reversal" } })).status, 403, "role matrix — receptionist CANNOT reverse");
  eq((await http("POST", `/loyalty/redemptions/${redId}/reverse`, { token: T.docB, body: { reason: "cross clinic doctor" } })).status, 404, "role matrix — another clinic's doctor cannot reverse");
  eq((await http("DELETE", `/loyalty/rewards/${rwA2.id}`, { token: T.rec })).status, 403, "role matrix — receptionist CANNOT delete a reward");
  eq((await http("GET", "/loyalty/rewards", { token: T.rec })).status, 200, "role matrix — receptionist can VIEW rewards");
  eq((await http("GET", "/loyalty/overview", { token: T.rec })).status, 200, "role matrix — receptionist can view the overview");
  // the clinic without the add-on gets nothing, in either direction
  eq((await http("GET", "/loyalty/rewards", { token: T.ownerC })).status, 402, "no add-on → rewards 402");
  eq((await http("POST", `/loyalty/redemptions/${redId}/confirm`, { token: T.ownerC, body: {} })).status, 402, "no add-on → confirm 402 (even before the id is looked at)");
  eq((await http("POST", "/public/loyalty/clinic-noaddon/identify", { body: { phone: "0791020001" } })).status, 503, "no add-on → public identify 503");
  eq((await http("POST", "/public/loyalty/clinic-progoff/identify", { body: { phone: "0791020001" } })).status, 503, "programme switched off → public identify 503");

  /* ---------- appointment / invoice scoping (the ids the brief lists) ---------- */
  const apptB = await m.Appointment.create({ clinicId: B._id, patientId: pB1._id, doctorId: U.docB._id, startAt: new Date(Date.now() + 3600e3), duration: 30, status: "scheduled" });
  const cr = await http("POST", "/public/loyalty/clinic-b/checkin", { token: sB1, body: {} });
  const ciB = String((await m.LoyaltyCheckIn.findOne({ clinicId: B._id }).lean())._id);
  const linkOther = await http("POST", `/loyalty/checkins/${ciB}/confirm`, { token: T.ownerB, body: { appointmentId: String(apptA._id) } });
  eq([linkOther.status, linkOther.json.code], [400, "INVALID_APPOINTMENT"], "B cannot link A's appointment to its own check-in (INVALID_APPOINTMENT)");
  const linkOwn = await http("POST", `/loyalty/checkins/${ciB}/confirm`, { token: T.ownerB, body: { appointmentId: String(apptB._id), points: 500 } });
  eq(linkOwn.status, 400, "check-in confirm rejects a `points` field");
  const linkOk = await http("POST", `/loyalty/checkins/${ciB}/confirm`, { token: T.ownerB, body: { appointmentId: String(apptB._id) } });
  eq(linkOk.status, 200, "B links its OWN appointment");
  eq((await m.Appointment.findById(apptB._id).lean()).status, "scheduled", "linking an appointment never changes it");
  eq(await t.balance(accB1.id), 900, "a confirmed check-in awarded no points");
  const invA = await m.Invoice.create({ clinicId: A._id, invoiceNumber: 1, patientId: pA1._id, items: [{ description: "x", price: 100, qty: 1 }], total: 100, payments: [], status: "unpaid" });
  const payB = await http("POST", `/invoices/${invA._id}/payments`, { token: T.ownerB, body: { amount: 100, method: "cash" } });
  ok([403, 404].includes(payB.status), "B cannot pay A's invoice (404/403)", payB.status);
  eq((await m.Invoice.findById(invA._id).lean()).payments.length, 0, "…and no payment was recorded on A's invoice");

  t.noLeaks();
  await t.finish("SEC10 TENANT ISOLATION / IDOR / ENUMERATION / ROLES");
})().catch((e) => { console.error("SUITE CRASHED", e); process.exit(2); });
