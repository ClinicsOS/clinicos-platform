/* Phase 10 — PILOT END-TO-END SCENARIO (the 24 steps of the brief), over real HTTP against the compiled server.
   Everything a clinic and a patient do in a first real day, in order, with the money-like invariants checked after every step. */
const { boot, spawnServer, SECRET } = require("./lib");
const ADMIN_SECRET = "admin-test-secret-0123456789-abcdef";

(async () => {
  const t = await boot({ name: "sec10pilot", port: 5106, env: { ADMIN_JWT_SECRET: ADMIN_SECRET, LOYALTY_PUBLIC_READ_MAX: "100000", LOYALTY_STAFF_WRITE_MAX: "100000", LOYALTY_STAFF_SENSITIVE_MAX: "100000" } });
  const { ok, eq, http, m, jwt } = t;
  const adminTok = jwt.sign({ sub: "admin", email: "root@clinicos.test" }, ADMIN_SECRET, { expiresIn: "1h" });
  const P = await t.mkClinic("pilot-dental", { addons: {} });   // Clinic A — the pilot clinic: NO add-on yet
  const Q = await t.mkClinic("other-clinic");                      // Clinic B — a neighbour with the add-on already on
  const owner = await t.mkUser(P, "owner"), doctor = await t.mkUser(P, "doctor"), reception = await t.mkUser(P, "receptionist");
  const ownerQ = await t.mkUser(Q, "owner");
  const T = { owner: t.tok(owner), doc: t.tok(doctor), rec: t.tok(reception), ownerQ: t.tok(ownerQ) };
  const sumLedger = async (id) => (await m.LoyaltyTransaction.find({ accountId: id }).lean()).reduce((s, x) => s + x.pointsDelta, 0);
  const invariants = async (accId, label) => {
    const a = await m.LoyaltyAccount.findById(accId).lean();
    ok(a.pointsBalance === (await sumLedger(accId)) && a.pointsBalance >= 0, `invariant after ${label}: balance (${a.pointsBalance}) = Σ ledger, never negative`);
  };

  // 1. add-on enabled (by the PLATFORM ADMIN — the clinic itself cannot)
  eq((await http("GET", "/loyalty/overview", { token: T.owner })).status, 402, "step 1a: before activation the clinic gets 402 ADDON_REQUIRED");
  eq((await http("GET", "/public/loyalty/pilot-dental")).json.available, false, "step 1b: …and its public page is unavailable");
  const act = await http("POST", `/admin/clinics/${P._id}/addons/loyalty/activate`, { token: adminTok, body: { setupFee: 0, monthlyPrice: 20 } });
  ok([200, 201].includes(act.status), "step 1c: platform admin activates the Loyalty add-on", act);
  eq((await http("PATCH", "/loyalty/settings", { token: T.owner, body: { program: { enabled: true }, checkin: { enabled: true }, earning: { visits: { enabled: true, pointsPerVisit: 50 }, spending: { enabled: true, spendAmount: 5, pointsPerSpendAmount: 2 } } } })).status, 200, "step 1d: the owner switches the programme, check-in and earning rules on");
  await t.sleep(30);
  eq((await http("PUT", "/loyalty/tiers/config", { token: T.owner, body: { enabled: true, progressionMetric: "lifetime_points", tiers: { tier1: { name: "Member" }, tier2: { name: "Silver", threshold: 100 }, tier3: { name: "Gold", threshold: 300 }, tier4: { name: "VIP", threshold: 700 } } } })).status, 200, "step 1e: tiers by earned points (Silver at 100)");
  const rw = (await http("POST", "/loyalty/rewards", { token: T.owner, body: { name: "Free Scaling", description: "Teeth cleaning", pointsRequired: 40 } })).json.reward;
  eq(!!rw, true, "step 1f: a reward is on offer (40 points)");

  // 2. an existing Patient without a LoyaltyAccount
  const patient = await t.mkPatient(P, "Sara Al-Khalil", "0791234567");
  eq(await m.LoyaltyAccount.countDocuments({ patientId: patient._id }), 0, "step 2: the patient exists in the clinic records and has NO Loyalty account");

  // 3. scans the clinic QR (…/c/pilot-dental/loyalty?src=qr)
  const info = await http("GET", "/public/loyalty/pilot-dental");
  eq([info.status, info.json.available, info.json.clinic.name], [200, true, "Clinic pilot-dental"], "step 3: the QR page loads and the clinic's programme is available");

  // 4+5. enters the phone → ONE account is created by self-enrolment
  const id1 = await http("POST", "/public/loyalty/pilot-dental/identify", { body: { phone: "079 123 4567" } });
  eq([id1.status, id1.json.newlyEnrolled], [200, true], "step 4: phone entered → welcomed in (newlyEnrolled)");
  const acc = await m.LoyaltyAccount.findOne({ patientId: patient._id }).lean();
  eq(await m.LoyaltyAccount.countDocuments({ patientId: patient._id }), 1, "step 5: exactly ONE account was created");
  eq(acc.enrollmentSource, "self_enrollment", "step 5b: and it is recorded honestly as self-enrolment");

  // 6. sees the card
  const me = await http("GET", "/public/loyalty/pilot-dental/me", { token: id1.json.token });
  eq([me.status, me.json.member.displayName, me.json.member.balance, me.json.tier.name], [200, "Sara", 0, "Member"], "step 6: the card shows first name only, 0 points, starting tier");
  ok(!me.text.includes("0791234567") && !me.text.includes("Al-Khalil") && !me.text.includes(String(acc._id)), "step 6b: no phone, surname or database id on the card");

  // 7. no signup points
  eq([acc.pointsBalance, await m.LoyaltyTransaction.countDocuments({ accountId: acc._id })], [0, 0], "step 7: NO signup points and no ledger row");

  // 8. requests check-in
  const ci = await http("POST", "/public/loyalty/pilot-dental/checkin", { token: id1.json.token, body: { via: "qr" } });
  eq([ci.status, ci.json.checkIn.status], [201, "pending"], "step 8: the patient requests a check-in (pending)");
  eq(await t.balance(acc._id), 0, "step 8b: requesting a check-in moves no points");

  // 9. reception sees pending and confirms
  const queue = await http("GET", "/loyalty/checkins?scope=pending", { token: T.rec });
  eq(queue.status, 200, "step 9a: reception opens the queue");
  const row = queue.json.checkIns.find((x) => x.patient && x.patient.fullName === "Sara Al-Khalil");
  ok(!!row, "step 9b: the pending request is visible to reception, with the patient's name", queue.json.checkIns.length);
  const confirm = await http("POST", `/loyalty/checkins/${row.id}/confirm`, { token: T.rec, body: {} });
  eq([confirm.status, confirm.json.checkIn && confirm.json.checkIn.status], [200, "confirmed"], "step 9c: reception confirms the arrival");
  eq(await t.balance(acc._id), 0, "step 9d: a confirmed check-in awards no points by itself");
  const ciSeen = await http("GET", "/public/loyalty/pilot-dental/checkin", { token: id1.json.token });
  eq(ciSeen.json.checkIn.status, "confirmed", "step 9e: the patient sees 'confirmed'");

  // 10. appointment / visit lifecycle under the EXISTING rules
  const appt = await m.Appointment.create({ clinicId: P._id, patientId: patient._id, doctorId: doctor._id, startAt: new Date(Date.now() + 36e5), duration: 30, status: "scheduled" });
  for (const st of ["confirmed"]) eq((await http("PATCH", `/appointments/${appt._id}/status`, { token: T.rec, body: { status: st } })).status, 200, `step 10a: appointment → ${st}`);
  eq(await t.balance(acc._id), 0, "step 10b: scheduled/confirmed appointments earn nothing");
  eq((await http("PATCH", `/appointments/${appt._id}/status`, { token: T.doc, body: { status: "completed" } })).status, 200, "step 10c: the doctor completes the visit");

  // 11. points only per the configured rules
  eq(await t.balance(acc._id), 50, "step 11a: the completed visit earned exactly the configured 50 points");
  const invoice = await m.Invoice.create({ clinicId: P._id, invoiceNumber: 1, patientId: patient._id, appointmentId: appt._id, items: [{ description: "Cleaning", price: 20, qty: 1 }], total: 20, payments: [{ amount: 20, method: "cash", paidAt: new Date() }], status: "paid" });
  await t.pts.onInvoicePayment(invoice, String(invoice.payments[0]._id));
  await t.pts.onInvoicePayment(invoice, String(invoice.payments[0]._id)); // a retry
  eq(await t.balance(acc._id), 58, "step 11b: paying 20 JOD earned 8 points ONCE (2 per 5 JOD), the retry added nothing");
  const kinds = (await m.LoyaltyTransaction.find({ accountId: acc._id }).sort({ seq: 1 }).lean()).map((x) => x.type);
  eq(kinds, ["earn_visit", "earn_spending"], "step 11c: the ledger holds exactly the two earning rows");
  await invariants(acc._id, "earning");

  // 12. patient sees the updated balance
  const me2 = await http("GET", "/public/loyalty/pilot-dental/me", { token: id1.json.token });
  eq(me2.json.member.balance, 58, "step 12: the patient's card shows 58");

  // 13. tier progress updates
  const dbAcc = await m.LoyaltyAccount.findById(acc._id).lean();
  eq([dbAcc.progress.earnedPoints, dbAcc.tier.key], [58, "tier1"], "step 13b: earned-points progress is 58 and the tier is still Member (Silver needs 100)");
  ok(JSON.stringify(me2.json.tier).includes("100") || JSON.stringify(me2.json).includes("Silver"), "step 13c: the card shows the road to Silver", me2.json.tier);
  await t.svc.creditPoints({ clinicId: String(P._id), accountId: String(acc._id), type: "earn_visit", points: 50, sourceType: "appointment", sourceId: "pilot-extra-visit" });
  eq((await m.LoyaltyAccount.findById(acc._id).lean()).tier.key, "tier2", "step 13d: after 108 earned points the member is promoted to Silver by the tier engine");
  eq(await t.balance(acc._id), 108, "step 13e: balance now 108");

  // 14. selects a reward and requests redemption
  const rewards = await http("GET", "/public/loyalty/pilot-dental/rewards", { token: id1.json.token });
  const offered = rewards.json.rewards.find((x) => x.name === "Free Scaling");
  eq([offered.pointsRequired, offered.canRedeem], [40, true], "step 14a: the patient sees the 40-point reward as redeemable");
  const rq = await http("POST", `/public/loyalty/pilot-dental/rewards/${offered.id}/redeem`, { token: id1.json.token, body: {} });
  eq([rq.status, rq.json.request.status, rq.json.request.points], [201, "pending", 40], "step 14b: the request is created as PENDING at the server's price");
  eq(await t.balance(acc._id), 108, "step 14c: no points moved by the request");

  // 15. reception confirms → points deducted ONCE through the ledger
  const pend = await http("GET", "/loyalty/redemptions?scope=pending", { token: T.rec });
  const red = pend.json.redemptions.find((x) => x.rewardNameSnapshot === "Free Scaling");
  ok(!!red, "step 15a: reception sees the request");
  const done = await Promise.all([http("POST", `/loyalty/redemptions/${red.id}/confirm`, { token: T.rec, body: {} }), http("POST", `/loyalty/redemptions/${red.id}/confirm`, { token: T.owner, body: {} })]);
  eq(done.map((x) => x.status).sort(), [200, 409], "step 15b: two staff confirm at the same moment → exactly one wins");
  eq(await t.balance(acc._id), 68, "step 15c: 40 points were deducted ONCE (108 → 68)");
  const redTx = await m.LoyaltyTransaction.find({ accountId: acc._id, type: "reward_redemption" }).lean();
  eq([redTx.length, redTx[0].pointsDelta, redTx[0].balanceBefore, redTx[0].balanceAfter], [1, -40, 108, 68], "step 15d: one ledger row: −40, 108 → 68");
  await invariants(acc._id, "redemption");
  eq((await m.LoyaltyAccount.findById(acc._id).lean()).tier.key, "tier2", "step 15e: spending points on a reward does not demote the member");

  // 16. activity updates
  const act2 = await http("GET", "/public/loyalty/pilot-dental/activity?page=1&limit=10", { token: id1.json.token });
  const kindsSeen = act2.json.activity.map((x) => x.kind);
  ok(["visit", "spending", "redemption"].every((k) => kindsSeen.includes(k)), "step 16a: the patient's activity lists the visit, the payment and the redemption", kindsSeen);
  ok(!/"id"\s*:\s*"[a-f0-9]{24}"/.test(act2.text), "step 16b: activity rows carry opaque keys, no database ids");

  // 17. returns later via NFC
  const id2 = await http("POST", "/public/loyalty/pilot-dental/identify", { body: { phone: "+962791234567" } });
  eq([id2.status, id2.json.newlyEnrolled], [200, false], "step 17a: a later NFC tap + phone → recognised as an existing member (not new)");
  const ci2 = await http("POST", "/public/loyalty/pilot-dental/checkin", { token: id2.json.token, body: { via: "nfc" } });
  ok([200, 201].includes(ci2.status), "step 17b: checking in again via NFC works", ci2.status);

  // 18. existing account reused, no duplicate membership
  eq(await m.LoyaltyAccount.countDocuments({ patientId: patient._id }), 1, "step 18a: still exactly ONE membership for the patient");
  eq(String(jwt.decode(id2.json.token).aid), String(acc._id), "step 18b: the new session is bound to the SAME account");
  eq(await t.balance(acc._id), 68, "step 18c: balance unchanged by coming back");

  // 19. Clinic A cannot see Clinic B and vice versa
  const patientQ = await t.mkPatient(Q, "Basel Neighbour", "0795550001");
  eq((await http("PATCH", "/loyalty/settings", { token: T.ownerQ, body: { program: { enabled: true } } })).status, 200, "step 19a: the neighbour clinic runs its own programme");
  const accQ = await t.enroll(patientQ, T.ownerQ); await t.credit(Q._id, accQ.id, 500);
  eq((await http("GET", `/loyalty/members/${accQ.id}`, { token: T.owner })).status, 404, "step 19b: the pilot clinic's owner cannot open the neighbour's member");
  eq((await http("GET", `/loyalty/members/${acc._id}`, { token: T.ownerQ })).status, 404, "step 19c: …nor the other way round");
  ok(!(await http("GET", "/loyalty/members", { token: T.owner })).text.includes("Basel"), "step 19d: member lists never mix clinics");
  eq((await http("POST", "/public/loyalty/pilot-dental/identify", { body: { phone: "0795550001" } })).status, 404, "step 19e: the neighbour's patient is unknown at the pilot clinic's page");
  eq((await http("GET", "/public/loyalty/other-clinic/me", { token: id1.json.token })).status, 401, "step 19f: the pilot patient's session is useless at the neighbour's page");

  // 20+. closing checks
  eq(await m.LoyaltyAccount.countDocuments({ clinicId: P._id }), 1, "step 20: the pilot clinic has exactly one account after the whole day");
  ok((await m.ActivityLog.countDocuments({ action: "loyalty.public.self_enrolled" })) === 1 && (await m.ActivityLog.countDocuments({ action: "loyalty.redemption.confirmed" })) === 1, "step 21: the audit trail has one self-enrolment and one redemption confirmation");
  await invariants(acc._id, "the whole scenario");
  eq((await http("POST", `/admin/clinics/${P._id}/addons/loyalty/suspend`, { token: adminTok, body: {} })).status === 200, true, "step 22: platform admin suspends the add-on (e.g. unpaid invoice)");
  eq([(await http("GET", "/loyalty/overview", { token: T.owner })).status, (await http("GET", "/public/loyalty/pilot-dental/me", { token: id2.json.token })).status], [402, 503], "step 23: the clinic's dashboard (402) and the patient's page (503) stop at once");
  eq(await t.balance(acc._id), 68, "step 24: and nothing about the member's data was changed by the suspension");
  t.noLeaks();
  await t.finish("SEC10 PILOT END-TO-END (24 steps)");
})().catch((e) => { console.error("SUITE CRASHED", e); process.exit(2); });
