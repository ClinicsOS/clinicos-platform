/* Phase 10 — POINTS / LEDGER / REDEMPTION / CHECK-IN / TIER / ENROLMENT INTEGRITY under abuse and concurrency (compiled server, real HTTP). */
const { boot, world } = require("./lib");

(async () => {
  const t = await boot({ name: "sec10int", port: 5103, env: { LOYALTY_PUBLIC_READ_MAX: "100000", LOYALTY_STAFF_WRITE_MAX: "100000", LOYALTY_STAFF_SENSITIVE_MAX: "100000" } });
  const { ok, eq, http, m } = t;
  await world(t);
  const { A, B, T, U } = t;
  const sess = (acc, clinic = A) => t.sessionFor(acc.id || acc._id, clinic._id);
  const ledger = (accountId, q = {}) => m.LoyaltyTransaction.find({ accountId, ...q }).sort({ seq: 1 }).lean();
  const sumLedger = async (accountId) => (await ledger(accountId)).reduce((s, x) => s + x.pointsDelta, 0);
  const consistent = async (accountId, label) => {
    const a = await m.LoyaltyAccount.findById(accountId).lean();
    const rows = await ledger(accountId);
    const chain = rows.every((r, i) => r.seq === i + 1 && r.balanceAfter === r.balanceBefore + r.pointsDelta && (i === 0 || r.balanceBefore === rows[i - 1].balanceAfter));
    ok(a.pointsBalance === rows.reduce((s, x) => s + x.pointsDelta, 0) && a.pointsBalance >= 0 && chain, `${label}: balance = sum of the ledger, never negative, seq/before/after chain unbroken`, { bal: a.pointsBalance, sum: rows.reduce((s, x) => s + x.pointsDelta, 0), n: rows.length });
  };

  // earning rules: 50 points per completed visit; 2 points per 5 JOD actually paid
  eq((await http("PATCH", "/loyalty/settings", { token: T.owner, body: { earning: { visits: { enabled: true, pointsPerVisit: 50 }, spending: { enabled: true, spendAmount: 5, pointsPerSpendAmount: 2 } } } })).status, 200, "setup: earning rules");
  await t.sleep(30); // the spending rule only counts payments made AFTER it was activated

  /* =================== A. 25 concurrent enrolments → ONE account =================== */
  const pC = await t.mkPatient(A, "Concurrent Carla", "0791030001");
  const fmts = ["0791030001", "+962791030001", "962791030001", "00962791030001", "079 103 0001", "791030001", "+962 79 103 0001", "07-9103-0001", "0791030001 ", " 0791030001"];
  const ids = Array.from({ length: 25 }, (_, i) => http("POST", "/public/loyalty/clinic-a/identify", { body: { phone: fmts[i % fmts.length] } }));
  const rs = await Promise.all(ids);
  eq(rs.map((x) => x.status), Array(25).fill(200), "25 concurrent public identifications of an un-enrolled patient all succeed");
  eq(await m.LoyaltyAccount.countDocuments({ patientId: pC._id }), 1, "…and exactly ONE LoyaltyAccount exists");
  eq(rs.filter((x) => x.json.newlyEnrolled).length, 1, "…exactly one response says newlyEnrolled");
  eq(new Set(rs.map((x) => t.jwt.decode(x.json.token).aid)).size, 1, "…all 25 sessions point at that one account");
  const accC = await m.LoyaltyAccount.findOne({ patientId: pC._id }).lean();
  eq([accC.pointsBalance, accC.seq, await m.LoyaltyTransaction.countDocuments({ accountId: accC._id })], [0, 0, 0], "…with 0 points and no ledger row (no signup bonus)");
  // staff + public racing for the SAME patient
  const pM = await t.mkPatient(A, "Mixed Mona", "0791030002");
  const mixed = await Promise.all([...Array.from({ length: 10 }, () => http("POST", "/loyalty/members", { token: T.rec, body: { patientId: String(pM._id) } })), ...Array.from({ length: 15 }, () => http("POST", "/public/loyalty/clinic-a/identify", { body: { phone: "0791030002" } }))]);
  eq(await m.LoyaltyAccount.countDocuments({ patientId: pM._id }), 1, "10 staff + 15 public enrolments racing → ONE account");
  ok(mixed.every((x) => [200, 201, 409].includes(x.status)), "…every response is 200/201/409 (no 500)", mixed.map((x) => x.status));
  // 25 different patients at once → 25 distinct accounts
  const many = []; for (let i = 0; i < 25; i++) many.push(await t.mkPatient(A, "Bulk " + i, "07910400" + String(10 + i)));
  const bulk = await Promise.all(many.map((p) => http("POST", "/public/loyalty/clinic-a/identify", { body: { phone: p.phone } })));
  eq(bulk.map((x) => x.status), Array(25).fill(200), "25 different patients self-enrol at once");
  eq(await m.LoyaltyAccount.countDocuments({ patientId: { $in: many.map((p) => p._id) } }), 25, "…25 accounts, one each");
  eq(new Set(bulk.map((x) => t.jwt.decode(x.json.token).aid)).size, 25, "…and no two sessions share an account (no cross-talk)");
  // unknown phone never creates anything
  const patN = await m.Patient.countDocuments({}), accN = await m.LoyaltyAccount.countDocuments({});
  await Promise.all(Array.from({ length: 15 }, (_, i) => http("POST", "/public/loyalty/clinic-a/identify", { body: { phone: "07990000" + String(10 + i) } })));
  eq([await m.Patient.countDocuments({}), await m.LoyaltyAccount.countDocuments({})], [patN, accN], "15 concurrent unknown numbers created no Patient and no Account");
  // archived / other clinic / suspended
  const arch = await t.mkPatient(A, "Archived Ann", "0791030090", { isArchived: true });
  await http("POST", "/public/loyalty/clinic-a/identify", { body: { phone: "0791030090" } });
  eq(await m.LoyaltyAccount.countDocuments({ patientId: arch._id }), 0, "an archived patient is never enrolled");

  /* =================== B. earning idempotency =================== */
  const pE = await t.mkPatient(A, "Earner Eli", "0791030100"); const accE = await t.enroll(pE);
  const appt = await m.Appointment.create({ clinicId: A._id, patientId: pE._id, doctorId: U.docA._id, startAt: new Date(Date.now() + 36e5), duration: 30, status: "scheduled" });
  const setStatus = (id, status, token = T.owner) => http("PATCH", `/appointments/${id}/status`, { token, body: { status } });
  const done = await Promise.all(Array.from({ length: 8 }, () => setStatus(appt._id, "completed")));
  ok(done.every((x) => x.status === 200), "8 concurrent 'complete' requests all answer 200", done.map((x) => x.status));
  eq(await t.balance(accE.id), 50, "a visit earns its points exactly ONCE under 8 concurrent completions");
  eq((await ledger(accE.id, { type: "earn_visit" })).length, 1, "…one earn_visit ledger row");
  await setStatus(appt._id, "completed");
  eq(await t.balance(accE.id), 50, "repeating 'completed' again changes nothing");
  await setStatus(appt._id, "scheduled");
  eq(await t.balance(accE.id), 0, "leaving 'completed' reverses the points (through a NEW reversal row)");
  const rowsAfterRev = await ledger(accE.id);
  eq(rowsAfterRev.map((x) => x.type), ["earn_visit", "reversal"], "…history is append-only: earn row + reversal row, nothing edited or deleted");
  await setStatus(appt._id, "completed");
  eq([await t.balance(accE.id), (await ledger(accE.id)).length], [0, 2], "toggling completed → scheduled → completed does NOT mint a second award");
  await consistent(accE.id, "after status toggling");
  // another clinic's staff cannot complete A's appointment (so cannot award A's patient)
  const cross = await setStatus(appt._id, "cancelled", T.ownerB);
  eq(cross.status, 404, "B's staff cannot change A's appointment status");
  // blocked time / non-patient
  eq((await http("PATCH", `/appointments/${appt._id}/status`, { token: T.owner, body: { status: "completed", points: 9999 } })).status, 200, "an unknown `points` field in a status change is ignored (not trusted)");
  eq(await t.balance(accE.id), 0, "…and awarded nothing");

  // payments (the HTTP "add payment" route uses an aggregation-pipeline $expr update that the FerretDB test engine does not implement —
  // so payments are recorded on the model exactly as earlier phases' tests do, and the Loyalty payment HOOK is attacked directly)
  const pS = await t.mkPatient(A, "Spender Sam", "0791030101"); const accS = await t.enroll(pS);
  const invDoc = await m.Invoice.create({ clinicId: A._id, invoiceNumber: 9001, patientId: pS._id, items: [{ description: "Treatment", price: 20, qty: 1 }], total: 20, payments: [{ amount: 10, method: "cash", paidAt: new Date() }], status: "partially_paid" });
  await t.pts.onInvoicePayment(invDoc, String(invDoc.payments[0]._id));
  eq(await t.balance(accS.id), 4, "10 JOD paid → 4 points (2 per 5 JOD)");
  invDoc.payments.push({ amount: 10, method: "cash", paidAt: new Date() }); invDoc.status = "paid"; await invDoc.save();
  const pay2 = String(invDoc.payments[1]._id);
  await Promise.all(Array.from({ length: 20 }, () => t.pts.onInvoicePayment(invDoc, pay2)));
  eq(await t.balance(accS.id), 8, "20 concurrent hook calls for the SAME payment (double request / retry) → awarded once (total 8)");
  eq((await ledger(accS.id, { type: "earn_spending" })).length, 2, "…exactly one ledger row per payment");
  for (let i = 0; i < 3; i++) for (const p of invDoc.payments) await t.pts.onInvoicePayment(invDoc, String(p._id));
  eq(await t.balance(accS.id), 8, "replaying the hook 6 more times (webhook / retry style) awards nothing more");
  const over = await http("POST", `/invoices/${invDoc._id}/payments`, { token: T.owner, body: { amount: 5, method: "cash" } });
  eq(over.status, 400, "paying beyond the invoice total → 400");
  for (const bad of [0, -5, null, "10", 1e12]) {
    const r = await http("POST", `/invoices/${invDoc._id}/payments`, { token: T.owner, body: { amount: bad, method: "cash" } });
    eq(r.status, 400, `payment amount ${JSON.stringify(bad)} refused (400)`);
  }
  eq((await m.Invoice.findById(invDoc._id).lean()).payments.length, 2, "…refused payments recorded nothing");
  eq(await t.balance(accS.id), 8, "invalid payments awarded nothing");
  const crossPay = await http("POST", `/invoices/${invDoc._id}/payments`, { token: T.ownerB, body: { amount: 5, method: "cash" } });
  eq(crossPay.status, 404, "clinic B cannot pay clinic A's invoice (404)");
  eq((await http("POST", "/invoices", { token: T.ownerB, body: { patientId: String(pS._id), items: [{ description: "x", price: 10, qty: 1 }] } })).status, 404, "clinic B cannot invoice clinic A's patient (404)");
  // zero / sub-step / negative amounts handed straight to the hook
  const inv0 = await m.Invoice.create({ clinicId: A._id, invoiceNumber: 9002, patientId: pS._id, items: [{ description: "tiny", price: 4, qty: 1 }], total: 4, payments: [{ amount: 4, method: "cash", paidAt: new Date() }], status: "paid" });
  await t.pts.onInvoicePayment(inv0, String(inv0.payments[0]._id));
  eq(await t.balance(accS.id), 8, "a payment below the spend step (4 JOD < 5 JOD) earns nothing");
  const invNeg = { _id: inv0._id, clinicId: A._id, patientId: pS._id, payments: [{ _id: "aaaaaaaaaaaaaaaaaaaaaaaa", amount: -50, paidAt: new Date() }, { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", amount: Number.NaN, paidAt: new Date() }, { _id: "cccccccccccccccccccccccc", amount: 0, paidAt: new Date() }] };
  for (const id of ["aaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbb", "cccccccccccccccccccccccc"]) await t.pts.onInvoicePayment(invNeg, id);
  eq(await t.balance(accS.id), 8, "negative / NaN / zero payment amounts reaching the hook earn nothing");
  await t.pts.onInvoicePayment(invDoc, "not-a-real-payment-id");
  eq(await t.balance(accS.id), 8, "an unknown payment id earns nothing");
  await consistent(accS.id, "after payments");

  /* =================== C. manual adjustments =================== */
  const pAd = await t.mkPatient(A, "Adjust Adam", "0791030200"); const accAd = await t.enroll(pAd);
  const adj = (body, token = T.owner, id = accAd.id) => http("POST", `/loyalty/members/${id}/adjust`, { token, body });
  eq((await adj({ direction: "credit", points: 100, reason: "goodwill gesture" })).status, 200, "owner credits 100");
  eq((await adj({ direction: "debit", points: 30, reason: "correction of a typo" }, T.doc)).status, 200, "doctor debits 30");
  eq(await t.balance(accAd.id), 70, "balance 70");
  for (const [label, body] of [["0", { direction: "credit", points: 0, reason: "zero is invalid" }], ["negative", { direction: "credit", points: -5, reason: "negative is invalid" }], ["decimal", { direction: "credit", points: 1.5, reason: "decimal is invalid" }], ["string", { direction: "credit", points: "5", reason: "string is invalid" }], ["NaN→null", { direction: "credit", points: null, reason: "null is invalid" }], ["1e21", { direction: "credit", points: 1e21, reason: "overflow attempt" }], ["MAX_SAFE", { direction: "credit", points: Number.MAX_SAFE_INTEGER, reason: "overflow attempt" }], ["1,000,001", { direction: "credit", points: 1000001, reason: "above per-transaction limit" }], ["no reason", { direction: "credit", points: 5 }], ["short reason", { direction: "credit", points: 5, reason: "ab" }], ["blank reason", { direction: "credit", points: 5, reason: "     " }], ["bad direction", { direction: "set", points: 5, reason: "not credit or debit" }], ["negative debit", { direction: "debit", points: -5, reason: "negative debit trick" }]]) {
    eq((await adj(body)).status, 400, `adjust ${label} → 400`);
  }
  eq((await http("POST", `/loyalty/members/${accAd.id}/adjust`, { token: T.owner, rawBody: '{"direction":"credit","points":Infinity,"reason":"infinity"}' })).status, 400, "Infinity literal (invalid JSON) → 400");
  eq((await adj({ direction: "debit", points: 71, reason: "more than the balance" })).status, 409, "debit larger than the balance → 409 (never negative)");
  eq(await t.balance(accAd.id), 70, "…balance still 70");
  eq((await adj({ direction: "credit", points: 5, reason: "receptionist attempt" }, T.rec)).status, 403, "receptionist cannot adjust");
  eq(await t.balance(accAd.id), 70, "…balance still 70");
  await m.LoyaltyAccount.updateOne({ _id: accAd.id }, { $set: { pointsBalance: 99_999_999 } }); // test fixture only: park the balance at the ceiling
  const cap = await adj({ direction: "credit", points: 5, reason: "above the balance ceiling" });
  ok(cap.status === 409 || cap.status === 400, "credit above the 100 000 000 balance ceiling is refused", cap.status);
  await m.LoyaltyAccount.updateOne({ _id: accAd.id }, { $set: { pointsBalance: 70 } });
  const tx = await ledger(accAd.id);
  ok(tx.length === 2 && tx.every((x) => x.reason && x.createdBy && x.type.startsWith("manual_")), "every manual change is a ledger row with a reason and an actor", tx.map((x) => [x.type, !!x.reason, !!x.createdBy]));
  const al = await m.ActivityLog.find({ action: { $in: ["loyalty.points.manual_credit", "loyalty.points.manual_debit"] } }).lean();
  ok(al.length >= 2 && !JSON.stringify(al).includes("0791030200") && !JSON.stringify(al).includes("Adjust Adam"), "manual adjustments are audit-logged with no phone / name");
  const conc = await Promise.all(Array.from({ length: 20 }, () => adj({ direction: "debit", points: 10, reason: "concurrent debit race" })));
  eq(conc.filter((x) => x.status === 200).length, 7, "20 concurrent debits of 10 against a balance of 70 → exactly 7 succeed");
  eq(await t.balance(accAd.id), 0, "…balance exactly 0, never negative");
  await consistent(accAd.id, "after the debit race");

  /* =================== D. rewards + redemptions =================== */
  const mkReward = async (name, cost, token = T.owner) => (await http("POST", "/loyalty/rewards", { token, body: { name, pointsRequired: cost } })).json.reward;
  const rw500a = await mkReward("Reward 500 A", 500), rw500b = await mkReward("Reward 500 B", 500), rw200 = await mkReward("Reward 200", 200);
  const request = (acc, reward, clinic = A) => http("POST", `/public/loyalty/${clinic.slug}/rewards/${reward.id}/redeem`, { token: sess(acc, clinic), body: {} });
  const redOf = (accountId, rewardId) => m.LoyaltyRedemption.findOne({ accountId, rewardId }).sort({ requestedAt: -1 }).lean();

  // client cannot lower the price
  const pR = await t.mkPatient(A, "Redeem Rana", "0791030300"); const accR = await t.enroll(pR); await t.credit(A._id, accR.id, 500);
  eq((await http("POST", `/public/loyalty/clinic-a/rewards/${rw500a.id}/redeem`, { token: sess(accR), body: { pointsCost: 1, pointsRequired: 1, points: 1 } })).status, 400, "patient sends pointsCost=1 for a 500-point reward → 400");
  const rq = await request(accR, rw500a);
  eq([rq.status, rq.json.request.points], [201, 500], "the request carries the SERVER's price (500)");
  eq(await t.balance(accR.id), 500, "requesting moves no points");
  const repeat = await Promise.all(Array.from({ length: 10 }, () => request(accR, rw500a)));
  eq(repeat.filter((x) => x.json.state === "created").length, 0, "10 more taps on the same reward create no second request");
  eq(await m.LoyaltyRedemption.countDocuments({ accountId: accR.id, rewardId: rw500a.id }), 1, "…still one redemption row");
  // price edit while pending: the snapshot stands
  eq((await http("PATCH", `/loyalty/rewards/${rw500a.id}`, { token: T.owner, body: { pointsRequired: 100 } })).status, 200, "owner lowers the reward to 100 while a request is pending");
  const redR = await redOf(accR.id, rw500a.id);
  const conf = await http("POST", `/loyalty/redemptions/${redR._id}/confirm`, { token: T.rec, body: {} });
  ok(conf.status === 200 && conf.json.points === 500, "confirm deducts the snapshot (500), not the edited price", conf.json && conf.json.points);
  eq(await t.balance(accR.id), 0, "balance 0 after exactly one deduction");
  await consistent(accR.id, "after confirm");
  eq((await http("PATCH", `/loyalty/rewards/${rw500a.id}`, { token: T.owner, body: { pointsRequired: 500 } })).status, 200, "reward price restored");

  // patient cannot resolve anything
  const pPr = await t.mkPatient(A, "Pending Pia", "0791030301"); const accPr = await t.enroll(pPr); await t.credit(A._id, accPr.id, 800);
  await request(accPr, rw200);
  const redPr = await redOf(accPr.id, rw200.id);
  for (const action of ["confirm", "reject", "reverse"]) {
    eq((await http("POST", `/loyalty/redemptions/${redPr._id}/${action}`, { token: sess(accPr), body: { reason: "patient attack" } })).status, 401, `patient token cannot ${action} a redemption`);
    eq((await http("POST", `/public/loyalty/clinic-a/redemptions/${redPr._id}/${action}`, { token: sess(accPr), body: {} })).status, 404, `no public ${action} route exists`);
  }
  eq(await t.balance(accPr.id), 800, "patient attempts moved nothing");
  // 20 concurrent confirms → ONE deduction
  const race = await Promise.all(Array.from({ length: 20 }, (_, i) => http("POST", `/loyalty/redemptions/${redPr._id}/confirm`, { token: [T.rec, T.rec2, T.owner, T.doc][i % 4], body: {} })));
  eq(race.filter((x) => x.status === 200).length, 1, "20 concurrent confirms → exactly ONE succeeds");
  ok(race.every((x) => [200, 409].includes(x.status)), "…all others are 409", race.map((x) => x.status));
  eq(await t.balance(accPr.id), 600, "…one deduction of 200");
  eq((await ledger(accPr.id, { type: "reward_redemption" })).length, 1, "…one ledger row");
  await consistent(accPr.id, "after 20 concurrent confirms");

  // confirm vs reject race
  const pCr = await t.mkPatient(A, "Race Rim", "0791030302"); const accCr = await t.enroll(pCr); await t.credit(A._id, accCr.id, 300);
  await request(accCr, rw200);
  const redCr = await redOf(accCr.id, rw200.id);
  const cr = await Promise.all([...Array.from({ length: 5 }, () => http("POST", `/loyalty/redemptions/${redCr._id}/confirm`, { token: T.rec, body: {} })), ...Array.from({ length: 5 }, () => http("POST", `/loyalty/redemptions/${redCr._id}/reject`, { token: T.rec2, body: {} }))]);
  const final = await m.LoyaltyRedemption.findById(redCr._id).lean();
  ok(["confirmed", "rejected"].includes(final.status), "confirm/reject race ends in exactly one terminal state", final.status);
  ok((await ledger(accCr.id, { type: "reward_redemption" })).length <= 1 && (await t.balance(accCr.id)) >= 100, "confirm/reject race: AT MOST one debit ever exists and the balance never goes below 100 (hard guarantee: unique ledger key)");
  t.dbLimit((await t.balance(accCr.id)) === (final.status === "confirmed" ? 100 : 300) && (await ledger(accCr.id, { type: "reward_redemption" })).length === (final.status === "confirmed" ? 1 : 0), "confirm-vs-reject race leaves status and ledger in agreement (needs MongoDB's atomic findOneAndUpdate)", { status: final.status, balance: await t.balance(accCr.id) });
  await consistent(accCr.id, "after confirm/reject race");

  // exactly 500 points, two 500-point rewards, confirmed concurrently — five rounds
  for (let round = 1; round <= 5; round++) {
    const p = await t.mkPatient(A, "Double Spend " + round, "07910304" + String(10 + round)); const a = await t.enroll(p); await t.credit(A._id, a.id, 500);
    const [x1, x2] = await Promise.all([request(a, rw500a), request(a, rw500b)]);
    eq([x1.status, x2.status], [201, 201], `round ${round}: both 500-point requests are accepted as PENDING (no reservation)`);
    const r1 = await redOf(a.id, rw500a.id), r2 = await redOf(a.id, rw500b.id);
    const both = await Promise.all([http("POST", `/loyalty/redemptions/${r1._id}/confirm`, { token: T.rec, body: {} }), http("POST", `/loyalty/redemptions/${r2._id}/confirm`, { token: T.rec2, body: {} })]);
    const codes = both.map((x) => x.status).sort();
    eq(codes, [200, 409], `round ${round}: exactly one of two competing confirms wins (200 + 409)`);
    eq(both.find((x) => x.status === 409).json.code, "INSUFFICIENT_BALANCE", `round ${round}: the loser is told INSUFFICIENT_BALANCE`);
    eq(await t.balance(a.id), 0, `round ${round}: balance exactly 0 — never negative, never double-spent`);
    eq((await ledger(a.id, { type: "reward_redemption" })).length, 1, `round ${round}: one redemption row`);
    await consistent(a.id, `round ${round}`);
  }

  // inactive / expired / other-clinic rewards
  const rwOff = await mkReward("Switched off", 50);
  await http("POST", `/loyalty/rewards/${rwOff.id}/deactivate`, { token: T.owner, body: {} });
  const pO = await t.mkPatient(A, "Offer Ola", "0791030500"); const accO = await t.enroll(pO); await t.credit(A._id, accO.id, 1000);
  eq((await request(accO, rwOff)).status, 409, "a deactivated reward cannot be requested (409)");
  const rwExp = await mkReward("Expired reward", 50);
  await m.LoyaltyReward.updateOne({ _id: rwExp.id }, { $set: { validUntil: new Date(Date.now() - 864e5) } });
  eq((await request(accO, rwExp)).status, 409, "an expired reward cannot be requested (409)");
  const rwFut = await mkReward("Future reward", 50);
  await m.LoyaltyReward.updateOne({ _id: rwFut.id }, { $set: { validFrom: new Date(Date.now() + 864e5) } });
  eq((await request(accO, rwFut)).status, 409, "a not-yet-valid reward cannot be requested (409)");
  const rwB = await mkReward("B reward", 50, T.ownerB);
  eq((await http("POST", `/public/loyalty/clinic-a/rewards/${rwB.id}/redeem`, { token: sess(accO), body: {} })).status, 404, "another clinic's reward → 404");
  eq((await request({ id: accO.id }, rw500a)).status, 201, "sanity: a normal request still works");
  const tooPoor = await t.mkPatient(A, "Poor Pat", "0791030501"); const accPoor = await t.enroll(tooPoor);
  const poor = await request(accPoor, rw200);
  eq([poor.status, poor.json.code], [409, "INSUFFICIENT_BALANCE"], "not enough points → 409 INSUFFICIENT_BALANCE");
  eq(await m.LoyaltyRedemption.countDocuments({ accountId: accPoor.id }), 0, "…and no request row");
  // pending request then reward deactivated then points spent elsewhere → confirm refuses
  const pS2 = await t.mkPatient(A, "Spent Sue", "0791030502"); const accS2 = await t.enroll(pS2); await t.credit(A._id, accS2.id, 200);
  await request(accS2, rw200);
  await adj({ direction: "debit", points: 150, reason: "points used elsewhere" }, T.owner, accS2.id);
  const c2 = await http("POST", `/loyalty/redemptions/${(await redOf(accS2.id, rw200.id))._id}/confirm`, { token: T.rec, body: {} });
  eq([c2.status, c2.json.code], [409, "INSUFFICIENT_BALANCE"], "confirm after the balance dropped → 409, nothing deducted");
  eq(await t.balance(accS2.id), 50, "…balance untouched by the failed confirm");

  // reversal
  const origRow = (await ledger(accR.id, { type: "reward_redemption" }))[0];
  eq((await http("POST", `/loyalty/redemptions/${redR._id}/reverse`, { token: T.rec, body: { reason: "reception tries" } })).status, 403, "receptionist cannot reverse");
  eq((await http("POST", `/loyalty/redemptions/${redR._id}/reverse`, { token: T.ownerB, body: { reason: "other clinic tries" } })).status, 404, "other clinic cannot reverse");
  eq((await http("POST", `/loyalty/redemptions/${redR._id}/reverse`, { token: T.owner, body: {} })).status, 400, "reverse without a reason → 400");
  const rev = await Promise.all(Array.from({ length: 10 }, (_, i) => http("POST", `/loyalty/redemptions/${redR._id}/reverse`, { token: i % 2 ? T.owner : T.doc, body: { reason: "customer changed mind" } })));
  eq(rev.filter((x) => x.status === 200).length, 1, "10 concurrent reversals → exactly ONE succeeds");
  ok(rev.every((x) => [200, 409].includes(x.status)), "…the rest are 409", rev.map((x) => x.status));
  eq(await t.balance(accR.id), 500, "balance restored once (500)");
  const rows = await ledger(accR.id);
  eq(rows.filter((x) => x.type === "reversal").length, 1, "…exactly one reversal row");
  const origAfter = rows.find((x) => String(x._id) === String(origRow._id));
  eq(JSON.stringify(origAfter), JSON.stringify(origRow), "the ORIGINAL redemption row is byte-identical after the reversal (history never edited)");
  eq((await http("POST", `/loyalty/redemptions/${redR._id}/reverse`, { token: T.owner, body: { reason: "again and again" } })).status, 409, "reversing a third time → 409");
  eq((await http("POST", `/loyalty/redemptions/${(await redOf(accO.id, rw500a.id))._id}/reverse`, { token: T.owner, body: { reason: "pending was never confirmed" } })).status, 409, "a redemption that was never confirmed (still pending) cannot be reversed (409)");
  await consistent(accR.id, "after reversal");
  eq((await http("POST", `/loyalty/redemptions/${redR._id}/reverse`, { token: T.owner, body: { reason: "ok reason here", points: 9999 } })).status, 400, "reverse with a client amount → 400");

  /* =================== E. check-in =================== */
  const pK = await t.mkPatient(A, "Check Kamal", "0791030600"); const accK = await t.enroll(pK); const sK = sess(accK);
  const balK = await t.balance(accK.id), txK = await m.LoyaltyTransaction.countDocuments({ clinicId: A._id });
  const reqs = await Promise.all(Array.from({ length: 15 }, () => http("POST", "/public/loyalty/clinic-a/checkin", { token: sK, body: { via: "nfc" } })));
  eq(reqs.filter((x) => x.status === 201).length, 1, "15 concurrent check-in taps → exactly ONE request is created");
  eq(await m.LoyaltyCheckIn.countDocuments({ accountId: accK.id }), 1, "…one row");
  const ciK = await m.LoyaltyCheckIn.findOne({ accountId: accK.id }).lean();
  eq((await http("POST", `/loyalty/checkins/${ciK._id}/confirm`, { token: sK, body: {} })).status, 401, "the patient cannot confirm their own check-in (patient token on staff route)");
  eq((await http("POST", `/public/loyalty/clinic-a/checkin/${ciK._id}/confirm`, { token: sK, body: {} })).status, 404, "…and no public confirm route exists");
  eq((await http("POST", `/loyalty/checkins/${ciK._id}/confirm`, { token: T.ownerB, body: {} })).status, 404, "another clinic cannot confirm it");
  const cc = await Promise.all([...Array.from({ length: 6 }, () => http("POST", `/loyalty/checkins/${ciK._id}/confirm`, { token: T.rec, body: {} })), ...Array.from({ length: 6 }, () => http("POST", `/loyalty/checkins/${ciK._id}/reject`, { token: T.rec2, body: {} }))]);
  const ciFinal = await m.LoyaltyCheckIn.findById(ciK._id).lean();
  ok(["confirmed", "rejected"].includes(ciFinal.status), "confirm vs reject race → exactly one final status", ciFinal.status);
  t.dbLimit(cc.filter((x) => x.status === 200).length === 1, "check-in: exactly one of 12 racing confirm/reject calls succeeds (needs MongoDB's atomic findOneAndUpdate)", cc.map((x) => x.status));
  ok(cc.every((x) => [200, 409].includes(x.status)), "…the rest are 409");
  eq([await t.balance(accK.id), await m.LoyaltyTransaction.countDocuments({ clinicId: A._id })], [balK, txK], "a check-in (confirmed or not) writes no points and no ledger row");
  const canc = await http("POST", "/public/loyalty/clinic-a/checkin/cancel", { token: sK, body: {} });
  ok([200, 429].includes(canc.status), "the patient cancelling afterwards is a harmless no-op (or is rate limited after the 15-tap flood)", canc.status);
  if (canc.status === 429) eq(canc.json, { message: "Too many requests, please try again shortly", code: "RATE_LIMITED" }, "…and the 429 body reveals nothing but the generic message");
  eq((await m.LoyaltyCheckIn.findById(ciK._id).lean()).status, ciFinal.status, "…and does not change the resolved check-in");
  // expired
  const pX = await t.mkPatient(A, "Expire Ed", "0791030601"); const accX = await t.enroll(pX);
  await http("POST", "/public/loyalty/clinic-a/checkin", { token: sess(accX), body: {} });
  const ciX = await m.LoyaltyCheckIn.findOne({ accountId: accX.id }).lean();
  await m.LoyaltyCheckIn.updateOne({ _id: ciX._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const ex = await http("POST", `/loyalty/checkins/${ciX._id}/confirm`, { token: T.rec, body: {} });
  eq([ex.status, ex.json.code], [409, "CHECKIN_EXPIRED"], "confirming an expired check-in → 409 CHECKIN_EXPIRED");
  // cancelled
  const pY = await t.mkPatient(A, "Cancel Yara", "0791030602"); const accY = await t.enroll(pY);
  await http("POST", "/public/loyalty/clinic-a/checkin", { token: sess(accY), body: {} });
  await http("POST", "/public/loyalty/clinic-a/checkin/cancel", { token: sess(accY), body: {} });
  const ciY = await m.LoyaltyCheckIn.findOne({ accountId: accY.id }).lean();
  eq((await http("POST", `/loyalty/checkins/${ciY._id}/confirm`, { token: T.rec, body: {} })).status, 409, "confirming a cancelled check-in → 409");
  // suspended member / archived patient
  const pZ = await t.mkPatient(A, "Suspended Zed", "0791030603"); const accZ = await t.enroll(pZ);
  eq((await http("POST", "/public/loyalty/clinic-a/checkin", { token: sess(accZ), body: {} })).status, 201, "setup: Zed checks in");
  await m.LoyaltyAccount.updateOne({ _id: accZ.id }, { $set: { status: "suspended" } });
  const ciZ = await m.LoyaltyCheckIn.findOne({ accountId: accZ.id }).lean();
  eq((await http("POST", `/loyalty/checkins/${ciZ._id}/confirm`, { token: T.rec, body: {} })).status, 409, "a suspended member's pending check-in cannot be confirmed (409)");
  eq((await http("POST", "/public/loyalty/clinic-a/checkin", { token: sess(accZ), body: {} })).status, 401, "a suspended member cannot request one (401)");
  // check-in disabled
  await http("PATCH", "/loyalty/settings", { token: T.owner, body: { checkin: { enabled: false } } });
  const pW = await t.mkPatient(A, "Disabled Wael", "0791030604"); const accW = await t.enroll(pW);
  eq((await http("POST", "/public/loyalty/clinic-a/checkin", { token: sess(accW), body: {} })).status, 409, "check-in switched off → patient request 409");
  await http("PATCH", "/loyalty/settings", { token: T.owner, body: { checkin: { enabled: true } } });

  /* =================== F. tiers =================== */
  const body = (o = {}) => ({ enabled: true, progressionMetric: o.metric === undefined ? "lifetime_points" : o.metric, tiers: { tier1: { name: "Base" }, tier2: { name: "Silver", threshold: (o.t || [1000, 3000, 7000])[0] }, tier3: { name: "Gold", threshold: (o.t || [1000, 3000, 7000])[1] }, tier4: { name: "VIP", threshold: (o.t || [1000, 3000, 7000])[2] }, ...(o.extra || {}) } });
  const put = (b, tk = T.owner) => http("PUT", "/loyalty/tiers/config", { token: tk, body: b });
  eq((await put(body())).status, 200, "tiers configured by lifetime earned points");
  const pT = await t.mkPatient(A, "Tier Tala", "0791030700"); const accT = await t.enroll(pT);
  eq((await http("POST", `/loyalty/members/${accT.id}/adjust`, { token: T.owner, body: { direction: "credit", points: 50000, reason: "huge manual credit", tier: "tier4" } })).status, 400, "adjust + tier field → 400");
  await t.credit(A._id, accT.id, 50000);
  eq((await m.LoyaltyAccount.findById(accT.id).lean()).tier.key, "tier1", "a 50 000-point MANUAL credit does not promote (manual credits do not count toward progression)");
  for (const [method, path] of [["POST", "/me/tier"], ["PUT", "/me"], ["PATCH", "/me"], ["POST", "/tier"], ["PUT", "/tier"], ["POST", "/me/points"], ["POST", "/points"]]) {
    const r = await http(method, `/public/loyalty/clinic-a${path}`, { token: sess(accT), body: { tier: "tier4", points: 99999, key: "tier4" } });
    ok([404, 405].includes(r.status), `patient ${method} ${path} (choose a tier / points) → no such route`, r.status);
  }
  eq((await m.LoyaltyAccount.findById(accT.id).lean()).tier.key, "tier1", "…tier still tier1");
  await t.svc.creditPoints({ clinicId: String(A._id), accountId: accT.id, type: "earn_visit", points: 1200, sourceType: "appointment", sourceId: "p10-tier-1" });
  const aT = await m.LoyaltyAccount.findById(accT.id).lean();
  eq([aT.tier.key, aT.progress.earnedPoints], ["tier2", 1200], "earned points (ledger earn rows) DO promote, by the configured metric");
  const accTbefore = await m.LoyaltyAccount.findById(accT.id).lean();
  await t.svc.debitPoints({ clinicId: String(A._id), accountId: accT.id, type: "manual_debit", points: 40000, reason: "take most of it back", sourceType: "manual" });
  const aT2 = await m.LoyaltyAccount.findById(accT.id).lean();
  eq([aT2.progress.earnedPoints, aT2.tier.key], [accTbefore.progress.earnedPoints, "tier2"], "a manual debit / spending points does not lower the lifetime metric or demote");
  // validation
  for (const [label, b] of [
    ["duplicate thresholds", body({ t: [1000, 1000, 7000] })], ["descending", body({ t: [3000, 1000, 7000] })], ["negative", body({ t: [-1, 3000, 7000] })],
    ["zero", body({ t: [0, 3000, 7000] })], ["fractional points", body({ t: [1000.5, 3000, 7000] })], ["huge", body({ t: [1000, 3000, 1e15] })],
    ["unknown metric", body({ metric: "vip_please" })], ["no metric", body({ metric: null })], ["fifth tier", body({ extra: { tier5: { name: "Mythic", threshold: 99999 } } })],
    ["renamed key", { ...body(), tiers: { VIP: { name: "VIP", threshold: 10 } } }], ["unknown top-level field", { ...body(), forceTier: "tier4" }],
    ["clinicId in body", { ...body(), clinicId: String(B._id) }], ["string thresholds", body({ t: ["1000", "3000", "7000"] })], ["NaN thresholds", body({ t: [null, 3000, 7000] })],
  ]) eq((await put(b)).status, 400, `tier config: ${label} → 400`);
  eq((await put(body(), T.rec)).status, 403, "tier config: receptionist → 403");
  eq((await put(body(), T.ownerB)).status, 200, "(B configures its own tiers — allowed)");
  eq((await http("GET", "/loyalty/tiers/config", { token: T.rec })).json.config.tiers[1].threshold, 1000, "…and A's thresholds are untouched by B");
  const keys = (await http("GET", "/loyalty/tiers/config", { token: T.rec })).json.config.tiers.map((x) => x.key);
  eq(keys, ["tier1", "tier2", "tier3", "tier4"], "tier keys are stable (tier1..tier4), only names are editable");

  /* =================== G. settings validation =================== */
  for (const [label, b] of [["negative points per visit", { earning: { visits: { enabled: true, pointsPerVisit: -5 } } }], ["huge points per visit", { earning: { visits: { enabled: true, pointsPerVisit: 1e12 } } }], ["fractional", { earning: { visits: { enabled: true, pointsPerVisit: 2.5 } } }], ["string", { earning: { visits: { enabled: true, pointsPerVisit: "50" } } }], ["zero spend step", { earning: { spending: { enabled: true, spendAmount: 0, pointsPerSpendAmount: 1 } } }], ["operator", { earning: { visits: { enabled: true, pointsPerVisit: { $gt: 1 } } } }], ["unknown section", { backdoor: { on: true } }], ["pointsBalance in settings", { pointsBalance: 1 }]]) {
    eq((await http("PATCH", "/loyalty/settings", { token: T.owner, body: b })).status, 400, `settings: ${label} → 400`);
  }
  eq((await http("PATCH", "/loyalty/settings", { token: T.rec, body: { program: { enabled: true } } })).status, 403, "settings: receptionist → 403");

  /* deterministic desk actions (so the audit assertions below do not depend on which side of a race won) */
  {
    const p1 = await t.mkPatient(A, "Desk One", "0791030800"), p2 = await t.mkPatient(A, "Desk Two", "0791030801");
    const a1 = await t.enroll(p1), a2 = await t.enroll(p2); await t.credit(A._id, a2.id, 300);
    await http("POST", "/public/loyalty/clinic-a/checkin", { token: sess(a1), body: {} });
    await http("POST", "/public/loyalty/clinic-a/checkin", { token: sess(a2), body: {} });
    const c1 = await m.LoyaltyCheckIn.findOne({ accountId: a1.id }).lean(), c2 = await m.LoyaltyCheckIn.findOne({ accountId: a2.id }).lean();
    eq((await http("POST", `/loyalty/checkins/${c1._id}/confirm`, { token: T.rec, body: {} })).status, 200, "desk: reception confirms a check-in");
    eq((await http("POST", `/loyalty/checkins/${c2._id}/reject`, { token: T.rec, body: {} })).status, 200, "desk: reception rejects a check-in");
    await request(a2, rw200);
    const rr = await redOf(a2.id, rw200.id);
    eq((await http("POST", `/loyalty/redemptions/${rr._id}/reject`, { token: T.rec, body: { reason: "out of stock today" } })).status, 200, "desk: reception rejects a redemption with a reason");
    eq(await t.balance(a2.id), 300, "desk: a rejected redemption moved no points");
  }

  /* =================== H. audit log coverage =================== */
  const actions = new Set((await m.ActivityLog.find({}).select("action").lean()).map((x) => x.action));
  for (const a of ["loyalty.public.self_enrolled", "loyalty.points.manual_credit", "loyalty.points.manual_debit", "loyalty.checkin.confirmed", "loyalty.checkin.rejected", "loyalty.checkin.requested", "loyalty.reward.created", "loyalty.reward.updated", "loyalty.reward.deactivated", "loyalty.redemption.requested", "loyalty.redemption.confirmed", "loyalty.redemption.reversed", "loyalty.redemption.rejected", "loyalty.settings_updated", "loyalty.tiers.enabled", "loyalty.points.visit_awarded", "loyalty.points.spending_awarded", "loyalty.points.reversed"]) ok(actions.has(a), `audit trail records ${a}`);
  const logText = JSON.stringify(await m.ActivityLog.find({}).lean());
  ok(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(logText) && !logText.includes("secret123") && !/\b07\d{8}\b/.test(logText), "the audit trail holds no token, no password and no phone number");

  t.noLeaks();
  ok(!/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(t.slog.replace(/\s/g, "")), "server log has no token");
  await t.finish("SEC10 POINTS / REDEMPTION / CHECK-IN / TIER / ENROLMENT INTEGRITY");
})().catch((e) => { console.error("SUITE CRASHED", e); process.exit(2); });
