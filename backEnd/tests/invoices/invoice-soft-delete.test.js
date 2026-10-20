/* PHASE 2 — INVOICE DELETION LIFECYCLE: soft delete -> Deleted Invoices -> restore / permanent delete. ATTACKER-STYLE, end-to-end against the
   COMPILED server (real HTTP, real database, nothing mocked). Reuses tests/phase10/lib.js.
     npm run build && node tests/invoices/invoice-soft-delete.test.js
   Optional env: P10_MONGO (default mongodb://127.0.0.1:27017), P10_DIST, P10_OUT.
   World: Clinic A (dentistry, pro): Owner, Dr Ahmad (X), Dr Mahmoud (Y), Receptionist.  Clinic B: Owner, Doctor.

   The required scenarios are tagged  T1 … T24  (the numbers of the Phase 2 specification):
     T1 active invoice listed · T2 doctor soft-deletes own · T3 gone from Active · T4 in Deleted · T5 deletedAt · T6 deletedBy · T7 reason
     T8 gone from the patient's invoice list · T9 revenue · T10 paid / unpaid / outstanding · T11 dashboard KPIs · T12 reports
     T13 restore = SAME invoice · T14 no duplicate · T15 back in the numbers · T16 permanent delete of a deleted invoice
     T17 active invoice cannot be permanently deleted · T18/T19/T20 doctor A vs doctor B · T21 cross-clinic · T22 receptionist
     T23 printable financial sources still work · T24 (Phase 1 suites) is run by the release checklist, not here.
   Extra groups: E (lifecycle edge cases), N (invoice numbering), B (dental billing link), L (loyalty), X (clinic export / purge), Z (leaks). */
const path = require("path");
const { boot } = require("../phase10/lib");
const DIST = process.env.P10_DIST || path.resolve(__dirname, "../../dist");
const tz = require(path.join(DIST, "utils/timezone"));
const AMMAN = "Asia/Amman";

(async () => {
  const t = await boot({ name: "invoice_soft_delete", port: 5811, env: { NODE_OPTIONS: `--require ${path.join(__dirname, "../multi-doctor/ferret-date-shim.js")} --require ${path.join(__dirname, "../analytics/agg-emulator.js")} --require ${path.join(__dirname, "../phase7/expr-shim.js")}` } });
  const { ok, eq, http, m } = t;
  const { Appointment, Invoice, ActivityLog } = m;
  const sid = (x) => String(x._id);
  const near = (a, b) => Math.abs(a - b) < 0.0005;

  const wh = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, from: "09:00", to: "17:00" }));
  const A = await t.mkClinic("isd-a", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const B = await t.mkClinic("isd-b", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const owner = await t.mkUser(A, "owner"), docX = await t.mkUser(A, "doctor", 1), docY = await t.mkUser(A, "doctor", 2), rec = await t.mkUser(A, "receptionist");
  const ownerB = await t.mkUser(B, "owner"), docB = await t.mkUser(B, "doctor");
  const tkO = t.tok(owner), tkX = t.tok(docX), tkY = t.tok(docY), tkR = t.tok(rec), tkOB = t.tok(ownerB), tkDB = t.tok(docB);
  const api = (method, url, token, body) => http(method, url, { token, body });
  const p1 = await t.mkPatient(A, "Patient One"), p2 = await t.mkPatient(A, "Patient Two"), p3 = await t.mkPatient(A, "Patient Three");
  const pB = await t.mkPatient(B, "B patient");

  /* ---------------- fixtures ---------------- */
  const payNow = (inv, amount) => Invoice.updateOne({ _id: inv._id }, { $push: { payments: { amount, method: "cash", paidAt: new Date() } }, $set: { status: amount >= inv.total ? "paid" : "partially_paid" } });
  const mkInv = async (token, body) => (await api("POST", "/invoices", token, { items: [{ description: "Service", price: 100, qty: 1 }], ...body })).json;
  const iX1 = await mkInv(tkX, { patientId: sid(p1) });                                                              // X · 100 · paid in full
  const iX2 = await mkInv(tkX, { patientId: sid(p1), items: [{ description: "Whitening", price: 80, qty: 1 }] });    // X · 80 · 30 paid  (partially paid)
  const iY1 = await mkInv(tkY, { patientId: sid(p2), items: [{ description: "Filling", price: 60, qty: 1 }] });     // Y · 60 · paid in full
  const iL = await Invoice.create({ clinicId: A._id, invoiceNumber: 70900, patientId: p3._id, items: [{ description: "Legacy", price: 25, qty: 1 }], total: 25, status: "unpaid" }); // no doctor
  const iB = await Invoice.create({ clinicId: B._id, invoiceNumber: 1, patientId: pB._id, doctorId: docB._id, items: [{ description: "B", price: 999, qty: 1 }], total: 999, status: "unpaid" });
  await payNow(iX1, 100); await payNow({ _id: iX2._id, total: 80 }, 30); await payNow(iY1, 60); await payNow(iB, 999);
  eq([iX1.invoiceNumber > 0, !!iX2._id, !!iY1._id], [true, true, true], "S0 fixtures created through POST /invoices");
  const inv = (x) => `INV-${String(x.invoiceNumber).padStart(4, "0")}`;
  const nums = (res) => (res.json || []).map((i) => i.invoiceNumber).sort((a, b) => a - b);
  const numsOf = (...xs) => xs.map((x) => x.invoiceNumber).sort((a, b) => a - b);
  const dbDoc = (x) => Invoice.findById(x._id).lean();

  // every figure the product shows, in one snapshot
  const figures = async () => {
    const dashO = (await api("GET", "/dashboard/stats", tkO)).json, dashX = (await api("GET", "/dashboard/stats", tkX)).json;
    const repO = (await api("GET", "/reports/monthly", tkO)).json, repX = (await api("GET", "/reports/monthly", tkX)).json;
    const fin = (await api("GET", "/analytics/financial?preset=today&compare=0", tkO)).json;
    const finX = (await api("GET", "/analytics/financial?preset=today&compare=0", tkX)).json;
    const ov = (await api("GET", "/analytics/overview?preset=today&compare=0", tkO)).json;
    return {
      dashO: dashO.today.revenue, dashX: dashX.today.revenue, repO: repO.revenue, repX: repX.revenue,
      todayDay: (repO.daily || []).reduce((s, d) => s + (d.revenue || 0), 0),
      collected: fin.kpis.collected.current, invoiced: fin.kpis.invoiced.current, outAmount: fin.outstanding.amount, outCount: fin.outstanding.invoices,
      stPaid: fin.paymentStatus.paid.invoices, stPart: fin.paymentStatus.partially_paid.invoices, stUnpaid: fin.paymentStatus.unpaid.invoices,
      collectedX: finX.kpis.collected.current, invoicedX: finX.kpis.invoiced.current, outAmountX: finX.outstanding.amount,
      ovCollected: ov.kpis ? (ov.kpis.collected ? ov.kpis.collected.current : null) : null,
      revByDoc: Object.fromEntries((fin.revenueByDoctor || []).map((d) => [d.doctorId || "unassigned", d.collected])),
    };
  };

  /* ============ T1 · an active invoice appears normally ============ */
  eq(nums(await api("GET", "/invoices", tkO)), numsOf(iX1, iX2, iY1, iL), "T1 owner: Active Invoices = the 4 invoices of the clinic (none of clinic B)");
  eq(nums(await api("GET", "/invoices", tkX)), numsOf(iX1, iX2), "T1b Dr Ahmad: only his own 2 (existing doctor scope)");
  eq(nums(await api("GET", "/invoices", tkR)), numsOf(iX1, iX2, iY1, iL), "T1c receptionist: unchanged, clinic-wide");
  const before = await figures();
  eq([before.dashO, before.dashX, before.repO, before.repX], [190, 130, 190, 130], "T1d BEFORE: dashboard revenue owner 190 / X 130, monthly report 190 / 130");
  eq([before.collected, before.invoiced, before.outCount, before.stPaid, before.stPart, before.stUnpaid], [190, 265, 2, 2, 1, 1], "T1e BEFORE: analytics collected 190, invoiced 265, outstanding on 2 invoices, status 2 paid / 1 partial / 1 unpaid");
  ok(near(before.outAmount, 75) && near(before.collectedX, 130) && near(before.invoicedX, 180), "T1f BEFORE: outstanding 75 (50 + 25), Dr Ahmad collected 130 / invoiced 180", before);
  const dentalFin = async (tk, p) => (await api("GET", `/dental/patients/${sid(p)}/report?financial=1`, tk)).json.financial;
  eq((await dentalFin(tkO, p1)), { totalInvoiced: 180, totalPaid: 130, outstandingBalance: 50 }, "T1g BEFORE: patient One's printable financial summary = 180 / 130 / 50");
  const snap = await dbDoc(iX2); // the document as it is before any deletion

  /* ============ T2 · an authorized doctor soft-deletes his own invoice ============ */
  const del1 = await api("DELETE", `/invoices/${sid(iX2)}`, tkX, { reason: "  entered twice  " });
  eq(del1.status, 200, "T2 Dr Ahmad moves his own invoice to Deleted Invoices (200)");
  ok(del1.json && del1.json.deletedAt && del1.json._id === sid(iX2), "T2b …the response is the SAME invoice, now stamped", del1.json);
  const afterDel = await dbDoc(iX2);
  ok(!!afterDel, "T2c the document is STILL in the database (soft delete never removes it)");
  eq(await Invoice.countDocuments({ clinicId: A._id }), 4, "T2d …and the clinic still holds 4 invoice documents");

  /* ============ T3 / T4 · gone from Active, present in Deleted ============ */
  eq(nums(await api("GET", "/invoices", tkO)), numsOf(iX1, iY1, iL), "T3 owner Active Invoices no longer lists it");
  eq(nums(await api("GET", "/invoices", tkX)), numsOf(iX1), "T3b …nor does Dr Ahmad's");
  eq(nums(await api("GET", "/invoices", tkR)), numsOf(iX1, iY1, iL), "T3c …nor the receptionist's");
  eq(nums(await api("GET", `/invoices?search=${encodeURIComponent(inv(iX2))}`, tkO)), [], "T3d …and the INV-number search ('View Invoice' deep link) finds nothing in Active");
  eq(nums(await api("GET", `/invoices?search=Patient%20One`, tkO)), numsOf(iX1), "T3e …nor does a patient-name search");
  const delList = await api("GET", "/invoices/deleted", tkX);
  eq([delList.status, nums(delList)], [200, numsOf(iX2)], "T4 Deleted Invoices (Dr Ahmad) lists it");
  const row = delList.json[0];
  ok(row.patientId && row.patientId.fullName === "Patient One" && row.doctorId && row.doctorId.name === docX.name && row.deletedBy && row.deletedBy.name === docX.name, "T4b …with patient, doctor and 'deleted by' names populated", row);
  ok(row.total === 80 && row.status === "partially_paid" && row.payments.length === 1 && row.payments[0].amount === 30, "T4c …and its amount / payment status / payments exactly as they were", row);
  eq(nums(await api("GET", "/invoices/deleted", tkO)), numsOf(iX2), "T4d the owner sees it in Deleted Invoices too");
  eq(nums(await api("GET", `/invoices/deleted?search=${encodeURIComponent(inv(iX2))}`, tkO)), numsOf(iX2), "T4e …and finds it by invoice number there");
  eq(nums(await api("GET", `/invoices/deleted?doctorId=${sid(docX)}`, tkO)), numsOf(iX2), "T4f …and by the owner's doctor filter");
  eq(nums(await api("GET", `/invoices/deleted?doctorId=${sid(docY)}`, tkO)), [], "T4g …(a different doctor's filter shows nothing)");

  /* ============ T5 / T6 / T7 · audit fields ============ */
  ok(afterDel.deletedAt instanceof Date && Math.abs(Date.now() - new Date(afterDel.deletedAt).getTime()) < 60000, "T5 deletedAt = now", afterDel.deletedAt);
  eq(String(afterDel.deletedBy), sid(docX), "T6 deletedBy = the authenticated user (Dr Ahmad), not anything the client sent");
  eq(afterDel.deleteReason, "entered twice", "T7 the reason is stored (trimmed)");
  const d2 = await api("DELETE", `/invoices/${sid(iY1)}`, tkO, { deletedBy: sid(docX), deletedAt: "2001-01-01", clinicId: sid(B) });
  eq(d2.status, 200, "T6b owner deletes Dr Mahmoud's invoice (clinic-wide scope) ignoring forged body fields");
  const d2doc = await dbDoc(iY1);
  ok(String(d2doc.deletedBy) === sid(owner) && new Date(d2doc.deletedAt).getFullYear() >= 2026 && String(d2doc.clinicId) === sid(A) && (d2doc.deleteReason === null || d2doc.deleteReason === undefined), "T6c deletedBy = owner, deletedAt = server time, clinic unchanged, no reason = none", d2doc);
  eq((await api("PATCH", `/invoices/${sid(iY1)}/restore`, tkO)).status, 200, "T6d …(restored again for the later scenarios)");
  eq((await api("DELETE", `/invoices/${sid(iX1)}`, tkO, { reason: "x".repeat(301) })).status, 400, "T7b a reason over 300 characters is refused (400)");
  ok(!(await dbDoc(iX1)).deletedAt, "T7c …and nothing was deleted");

  /* ============ T8 · the patient's invoice list ============ */
  eq(nums(await api("GET", `/invoices?patientId=${sid(p1)}`, tkO)), numsOf(iX1), "T8 patient One's invoice list (owner) no longer shows it");
  eq(nums(await api("GET", `/invoices?patientId=${sid(p1)}`, tkX)), numsOf(iX1), "T8b …(Dr Ahmad)");
  eq(nums(await api("GET", `/invoices?patientId=${sid(p1)}`, tkR)), numsOf(iX1), "T8c …(receptionist)");
  eq(nums(await api("GET", `/invoices/deleted?patientId=${sid(p1)}`, tkO)), numsOf(iX2), "T8d …it is reachable only through the explicit Deleted Invoices list");
  eq((await dentalFin(tkO, p1)), { totalInvoiced: 100, totalPaid: 100, outstandingBalance: 0 }, "T8e the patient's printable dental financial summary no longer counts it (100 / 100 / 0)");

  /* ============ T9 – T12 · every financial figure ============ */
  const after = await figures();
  eq([after.dashO, after.dashX], [160, 100], "T9/T11 Dashboard revenue: owner 190 → 160, Dr Ahmad 130 → 100");
  eq([after.repO, after.repX, after.todayDay], [160, 100, 160], "T9b/T12 Monthly report revenue + its daily series: 190 → 160, Dr Ahmad 130 → 100");
  eq([after.collected, after.invoiced, after.collectedX, after.invoicedX], [160, 185, 100, 100], "T9c/T12 Analytics: collected 190 → 160, invoiced 265 → 185; Dr Ahmad 130/180 → 100/100");
  eq([after.outCount, after.stPaid, after.stPart, after.stUnpaid], [1, 2, 0, 1], "T10 outstanding is now on 1 invoice; payment status 2 paid / 0 partial / 1 unpaid");
  ok(near(after.outAmount, 25) && near(after.outAmountX, 0), "T10b outstanding amount 75 → 25 (owner), 0 for Dr Ahmad", after);
  eq(after.revByDoc[sid(docX)], 100, "T12b revenue by doctor: Dr Ahmad 130 → 100");
  ok(JSON.stringify(after).indexOf("Whitening") < 0, "T12c nothing of the deleted invoice's lines appears in any report");
  const csv = await api("GET", "/analytics/export?section=financial&format=csv&preset=today", tkO);
  eq(csv.status, 200, "T12d the financial CSV export still works");
  // the AI assistant's stats tool is bound by the same rule
  const aiStats = await require(path.join(DIST, "services/ai/tools/dashboard/getClinicStats")).getClinicStatsExecute({ period: "today" }, { conversationId: "c", conversationObjectId: sid(A), clinicId: sid(A), userId: sid(owner), role: "owner" });
  eq(aiStats.revenueJOD, 160, "T11b the AI assistant's getClinicStats revenue excludes it too (160)");

  /* ============ T13 – T15 · restore ============ */
  const countBefore = await Invoice.countDocuments({ clinicId: A._id });
  const rest = await api("PATCH", `/invoices/${sid(iX2)}/restore`, tkX);
  eq(rest.status, 200, "T13 Dr Ahmad restores it (200)");
  const back = await dbDoc(iX2);
  eq([String(back._id), back.invoiceNumber, back.total, back.discount, back.status], [sid(iX2), iX2.invoiceNumber, snap.total, snap.discount, snap.status], "T13b SAME document: same _id, invoice number, total, discount and payment status");
  eq(JSON.stringify(back.items), JSON.stringify(snap.items), "T13c …same items (ids included)");
  eq(JSON.stringify(back.payments), JSON.stringify(snap.payments), "T13d …same payments (ids, amounts, dates)");
  ok(back.deletedAt === null && back.deletedBy === null && back.deleteReason === null, "T13e deletedAt / deletedBy / deleteReason are cleared (null)", back);
  ok(back.restoredAt instanceof Date && String(back.restoredBy) === sid(docX), "T13f restoredAt / restoredBy are recorded (audit)", back);
  eq(await Invoice.countDocuments({ clinicId: A._id }), countBefore, "T14 no duplicate: the clinic still holds exactly the same number of invoice documents");
  eq(await Invoice.countDocuments({ clinicId: A._id, invoiceNumber: iX2.invoiceNumber }), 1, "T14b …and the invoice number exists once");
  eq(nums(await api("GET", "/invoices", tkO)), numsOf(iX1, iX2, iY1, iL), "T15 it is back in Active Invoices");
  eq(nums(await api("GET", "/invoices/deleted", tkO)), [], "T15b …and gone from Deleted Invoices");
  eq(nums(await api("GET", `/invoices?patientId=${sid(p1)}`, tkX)), numsOf(iX1, iX2), "T15c …and in the patient's invoice list");
  const again = await figures();
  eq(JSON.stringify(again), JSON.stringify(before), "T15d EVERY figure (dashboard, reports, analytics, outstanding, status counts, revenue by doctor) is exactly what it was before the deletion");
  eq((await dentalFin(tkO, p1)), { totalInvoiced: 180, totalPaid: 130, outstandingBalance: 50 }, "T15e …including the patient's printable financial summary");
  eq(await ActivityLog.countDocuments({ action: "invoice.restored" }), 2, "T15f restore is audited (this one + the T6d one)");

  /* ============ T16 · permanent deletion of a DELETED invoice ============ */
  eq((await api("DELETE", `/invoices/${sid(iX2)}`, tkX, { reason: "duplicate" })).status, 200, "T16 (setup) it is moved to Deleted Invoices again");
  ok(String((await dbDoc(iX2)).restoredBy) === sid(docX), "T16a …the earlier restore stays in the audit fields");
  const wrong = await api("DELETE", `/invoices/${sid(iX2)}/permanent`, tkO, { confirm: "INV-9999" });
  eq([wrong.status, wrong.json.code], [400, "CONFIRMATION_MISMATCH"], "T16b a wrong invoice number as confirmation is refused");
  eq((await api("DELETE", `/invoices/${sid(iX2)}/permanent`, tkO, {})).status, 400, "T16c …and so is no confirmation at all");
  eq((await api("DELETE", `/invoices/${sid(iX2)}/permanent`, tkO, { confirm: String(iX2.invoiceNumber + 1) })).status, 400, "T16d …and the number of a different invoice");
  ok(!!(await dbDoc(iX2)), "T16e …the document is still there after every refused attempt");
  const figDel = await figures();
  const gone = await api("DELETE", `/invoices/${sid(iX2)}/permanent`, tkO, { confirm: inv(iX2).toLowerCase() });
  eq([gone.status, gone.json.deleted, gone.json.invoiceNumber], [200, true, iX2.invoiceNumber], "T16f typing the invoice number (any common spelling) permanently deletes it");
  eq(await Invoice.countDocuments({ _id: iX2._id }), 0, "T16g …the document is removed from the database");
  eq(nums(await api("GET", "/invoices/deleted", tkO)), [], "T16h …and from Deleted Invoices");
  eq(JSON.stringify(await figures()), JSON.stringify(figDel), "T16i …and every figure is unchanged by the permanent deletion (it was already excluded)");
  eq((await api("PATCH", `/invoices/${sid(iX2)}/restore`, tkO)).status, 404, "T16j a permanently deleted invoice cannot be restored (404)");
  const audits = await ActivityLog.find({ "details.invoiceId": sid(iX2) }).sort({ createdAt: 1 }).lean();
  eq(audits.map((a) => a.action), ["invoice.soft_deleted", "invoice.restored", "invoice.soft_deleted", "invoice.permanently_deleted"], "T16k the whole life of the invoice is in the audit trail, including the permanent deletion");
  const lastAudit = audits[audits.length - 1];
  ok(lastAudit.details.invoiceNumber === iX2.invoiceNumber && lastAudit.details.total === 80 && lastAudit.details.paid === 30 && lastAudit.details.deleteReason === "duplicate" && lastAudit.details.actorUserId === sid(owner) && lastAudit.details.actorRole === "owner", "T16l …which keeps the number, amounts, reason and the OWNER as the actor of the permanent deletion (Phase 3: owner only)", lastAudit.details);
  const viaQuery = await mkInv(tkX, { patientId: sid(p1), items: [{ description: "Q", price: 10, qty: 1 }] });
  await api("DELETE", `/invoices/${sid(viaQuery)}`, tkX);
  eq((await http("DELETE", `/invoices/${sid(viaQuery)}/permanent?confirm=${viaQuery.invoiceNumber}`, { token: tkO })).status, 200, "T16m the confirmation may also travel as ?confirm= (a proxy that drops the DELETE body cannot make it unsafe)");
  const viaNum = await mkInv(tkX, { patientId: sid(p1), items: [{ description: "N", price: 10, qty: 1 }] });
  await api("DELETE", `/invoices/${sid(viaNum)}`, tkX);
  eq((await api("DELETE", `/invoices/${sid(viaNum)}/permanent`, tkO, { confirm: viaNum.invoiceNumber })).status, 200, "T16n …and as a plain number");

  /* ============ T17 · an ACTIVE invoice cannot be permanently deleted ============ */
  {
    const r = await api("DELETE", `/invoices/${sid(iY1)}/permanent`, tkO, { confirm: inv(iY1) });
    eq([r.status, r.json.code], [409, "INVOICE_NOT_DELETED"], "T17 owner: permanent delete of an ACTIVE invoice → 409 INVOICE_NOT_DELETED");
    const rd = await api("DELETE", `/invoices/${sid(iY1)}/permanent`, tkY, { confirm: inv(iY1) });
    eq(rd.status, 403, "T17 Dr Mahmoud (own): PHASE 3 — a doctor never reaches the permanent-delete handler at all (403, owner only)");
  }
  const y1 = await dbDoc(iY1);
  ok(y1 && !y1.deletedAt && y1.total === 60 && y1.payments.length === 1, "T17b …the active invoice is untouched");
  eq((await api("DELETE", `/invoices/${sid(iY1)}`, tkY)).status, 200, "T17c the normal DELETE only moves it to Deleted Invoices …");
  ok(!!(await dbDoc(iY1)), "T17d …it never removes the document");
  eq((await api("PATCH", `/invoices/${sid(iY1)}/restore`, tkY)).status, 200, "T17e (restored again)");

  /* ============ T18 / T19 / T20 · Dr Ahmad against Dr Mahmoud's invoices ============ */
  const r18 = await api("DELETE", `/invoices/${sid(iY1)}`, tkX, { reason: "not mine" });
  eq([r18.status, r18.json.message], [404, "Invoice not found"], "T18 Dr Ahmad cannot delete Dr Mahmoud's invoice by changing the id (404, same as an unknown id)");
  ok(!(await dbDoc(iY1)).deletedAt, "T18b …nothing changed");
  eq((await api("DELETE", `/invoices/${sid(iL)}`, tkX)).status, 404, "T18c …nor the legacy / unassigned invoice");
  ok(!(await dbDoc(iL)).deletedAt, "T18d …which stays active");
  await api("DELETE", `/invoices/${sid(iY1)}`, tkO);
  eq((await api("PATCH", `/invoices/${sid(iY1)}/restore`, tkX)).status, 404, "T19 Dr Ahmad cannot restore Dr Mahmoud's deleted invoice (404)");
  ok(!!(await dbDoc(iY1)).deletedAt, "T19b …it is still in Deleted Invoices");
  eq(nums(await api("GET", "/invoices/deleted", tkX)), [], "T19c …and Dr Ahmad's Deleted Invoices does not list it");
  eq((await api("GET", `/invoices/deleted?doctorId=${sid(docY)}`, tkX)).status, 403, "T19d …nor can he ask for Dr Mahmoud's (403)");
  eq((await api("GET", "/invoices/deleted?doctorId=unassigned", tkX)).status, 403, "T19e …nor the unassigned bucket (403)");
  const r20 = await api("DELETE", `/invoices/${sid(iY1)}/permanent`, tkX, { confirm: inv(iY1) });
  eq(r20.status, 403, "T20 Dr Ahmad cannot permanently delete Dr Mahmoud's deleted invoice, even typing its number (PHASE 3: permanent deletion is owner-only, so 403 before anything is looked up)");
  ok(!!(await dbDoc(iY1)), "T20b …the document is still there");
  eq(nums(await api("GET", "/invoices/deleted", tkY)), numsOf(iY1), "T20c Dr Mahmoud (the owner of that invoice) sees it in his Deleted Invoices");
  eq(String((await api("GET", "/invoices/deleted", tkY)).json[0].deletedBy.name), owner.name, "T20d …with the owner shown as who deleted it");
  eq((await api("PATCH", `/invoices/${sid(iY1)}/restore`, tkY)).status, 200, "T20e …and restores it himself");

  /* ============ T21 · cross-clinic ============ */
  eq((await api("DELETE", `/invoices/${sid(iX1)}`, tkOB, {})).status, 404, "T21 clinic B's OWNER cannot delete clinic A's invoice (404)");
  eq((await api("DELETE", `/invoices/${sid(iX1)}`, tkDB, {})).status, 404, "T21b …nor clinic B's doctor");
  await api("DELETE", `/invoices/${sid(iX1)}`, tkO);
  eq((await api("PATCH", `/invoices/${sid(iX1)}/restore`, tkOB)).status, 404, "T21c …nor restore it");
  eq((await api("DELETE", `/invoices/${sid(iX1)}/permanent`, tkOB, { confirm: inv(iX1) })).status, 404, "T21d …nor permanently delete it");
  eq(nums(await api("GET", "/invoices/deleted", tkOB)), [], "T21e clinic B's Deleted Invoices does not list it");
  ok(!!(await dbDoc(iX1)).deletedAt, "T21f …it is still in A's Deleted Invoices");
  eq((await api("PATCH", `/invoices/${sid(iX1)}/restore`, tkO)).status, 200, "T21g (restored by A's owner)");
  eq((await api("DELETE", `/invoices/${sid(iB)}`, tkO, {})).status, 404, "T21h clinic A's owner cannot delete clinic B's invoice (404)");
  ok(!(await dbDoc(iB)).deletedAt, "T21i …B's invoice is untouched");
  eq((await api("DELETE", `/invoices/${sid(iB)}`, tkOB, {})).status, 200, "T21j B's own owner can");
  eq((await api("PATCH", `/invoices/${sid(iB)}/restore`, tkOB)).status, 200, "T21k …and restore");
  eq((await api("DELETE", `/invoices/${sid(iX1)}`, t.tok(owner, { clinicId: sid(B) }), {})).status, 200, "T21l a token claiming another clinicId is ignored: the clinic always comes from the database (still A)");
  await api("PATCH", `/invoices/${sid(iX1)}/restore`, tkO);

  /* ============ T22 · receptionist ============ */
  for (const [label, call] of [
    ["DELETE /:id", () => api("DELETE", `/invoices/${sid(iX1)}`, tkR, {})],
    ["PATCH /:id/restore", () => api("PATCH", `/invoices/${sid(iX1)}/restore`, tkR)],
    ["DELETE /:id/permanent", () => api("DELETE", `/invoices/${sid(iX1)}/permanent`, tkR, { confirm: inv(iX1) })],
    ["GET /deleted", () => api("GET", "/invoices/deleted", tkR)],
  ]) eq([(await call()).status], [403], `T22 receptionist ${label} → 403`);
  await api("DELETE", `/invoices/${sid(iY1)}`, tkO);
  eq((await api("GET", "/invoices/deleted?search=anything", tkR)).status, 403, "T22b …she cannot read deleted financial data (not even through a search)");
  ok(!!(await dbDoc(iY1)).deletedAt && !(await dbDoc(iX1)).deletedAt, "T22c …and none of her attempts changed anything");
  await api("PATCH", `/invoices/${sid(iY1)}/restore`, tkO);
  eq([(await api("GET", "/invoices", tkR)).status, (await api("POST", "/invoices", tkR, { patientId: sid(p3), items: [{ description: "Desk", price: 5, qty: 1 }] })).status], [200, 201], "T22d she can still list and create invoices, exactly as before");
  const me = (await api("GET", "/auth/me", tkR)).json;
  ok(me.access && me.access.invoices === "clinic" && me.access.invoicesDelete === "none" && me.access.invoicesPurge === "none", "T22e /auth/me tells the UI: invoices clinic, invoicesDelete none, invoicesPurge none", me.access);
  const meX = (await api("GET", "/auth/me", tkX)).json, meO = (await api("GET", "/auth/me", tkO)).json;
  ok(meX.access.invoicesDelete === "self" && meX.access.invoicesPurge === "none" && meO.access.invoicesDelete === "clinic" && meO.access.invoicesPurge === "clinic", "T22f …doctor: delete self / purge none (Phase 3), owner: clinic", [meX.access, meO.access]);
  eq([(await api("GET", "/dashboard/stats", tkR)).json.today.revenue], [null], "T22g the receptionist still gets no revenue figure on the dashboard");
  eq((await api("GET", "/reports/monthly", tkR)).status, 403, "T22h …and no reports");

  /* ============ T23 · printable financial sources keep working for active invoices ============ */
  const f2 = await figures();
  eq([f2.repO, (await api("GET", "/reports/monthly", tkO)).status], [160, 200], "T23 the monthly report (printable) works and shows the active books (190 − the 30 of the permanently deleted invoice = 160)");
  eq((await dentalFin(tkO, p1)), { totalInvoiced: 100, totalPaid: 100, outstandingBalance: 0 }, "T23b the patient's printable dental report: the financial summary works for the active invoice (100 / 100 / 0)");
  const view = await api("GET", `/invoices?search=${encodeURIComponent(inv(iX1))}`, tkX);
  eq(nums(view), numsOf(iX1), "T23c 'View Invoice' (the INV- deep link used by the patient profile) finds an active invoice");
  eq((await api("GET", `/dental/patients/${sid(p1)}/report`, tkX)).status, 200, "T23d the dental report without the financial section works");

  /* ============ E · lifecycle edge cases ============ */
  eq((await api("DELETE", `/invoices/${sid(iX1)}`, tkX, {})).status, 200, "E1 (setup) delete");
  const dd = await api("DELETE", `/invoices/${sid(iX1)}`, tkX, {});
  eq([dd.status, dd.json.code], [409, "INVOICE_ALREADY_DELETED"], "E1b deleting an already deleted invoice → 409");
  const delAt1 = (await dbDoc(iX1)).deletedAt;
  await api("DELETE", `/invoices/${sid(iX1)}`, tkO, { reason: "later" });
  eq(String((await dbDoc(iX1)).deletedAt), String(delAt1), "E1c …and the original deletion time / reason are not overwritten");
  eq((await api("PATCH", `/invoices/${sid(iY1)}/restore`, tkY)).json.code, "INVOICE_NOT_DELETED", "E2 restoring an ACTIVE invoice → 409 INVOICE_NOT_DELETED");
  eq([(await api("PUT", `/invoices/${sid(iX1)}`, tkX, { items: [{ description: "hack", price: 1, qty: 1 }], discount: 0 })).status], [404], "E3 a deleted invoice cannot be edited (404)");
  eq((await api("POST", `/invoices/${sid(iX1)}/payments`, tkX, { amount: 1, method: "cash" })).status, 404, "E3b …nor take a payment (404)");
  eq((await api("POST", `/invoices/${sid(iX1)}/payments`, tkR, { amount: 1, method: "cash" })).status, 404, "E3c …not even from the receptionist (404)");
  const x1 = await dbDoc(iX1);
  ok(x1.items[0].description === "Service" && x1.payments.length === 1 && x1.total === 100, "E3d …nothing changed on the deleted invoice");
  for (const bad of ["not-an-id", "123", "z".repeat(24)]) eq((await api("DELETE", `/invoices/${bad}`, tkO, {})).status, 400, `E4 malformed id '${bad.slice(0, 8)}' → 400`);
  eq((await api("DELETE", `/invoices/${"a".repeat(24)}`, tkO, {})).status, 404, "E4b an id that does not exist → 404");
  eq((await api("DELETE", `/invoices/${"a".repeat(24)}/permanent`, tkO, { confirm: "1" })).status, 404, "E4c …permanent: 404");
  eq((await api("PATCH", `/invoices/${"a".repeat(24)}/restore`, tkO)).status, 404, "E4d …restore: 404");
  for (const [m_, u] of [["DELETE", `/invoices/${sid(iX1)}`], ["PATCH", `/invoices/${sid(iX1)}/restore`], ["DELETE", `/invoices/${sid(iX1)}/permanent`], ["GET", "/invoices/deleted"]]) eq((await http(m_, u)).status, 401, `E5 ${m_} ${u.replace(sid(iX1), ':id')} needs a token`);
  eq((await api("DELETE", `/invoices/${sid(iX1)}`, tkO, { reason: { $ne: 1 } })).status, 400, "E6 an operator object as the reason is a 400");
  eq((await api("PATCH", `/invoices/${sid(iX1)}/restore`, tkO)).status, 200, "E7 (restore)");
  // the two real sides of a double click
  const iC = await mkInv(tkX, { patientId: sid(p1), items: [{ description: "Race", price: 12, qty: 1 }] });
  const race = await Promise.all([api("DELETE", `/invoices/${sid(iC)}`, tkX, {}), api("DELETE", `/invoices/${sid(iC)}`, tkX, {})]);
  const codes = race.map((r) => r.status).sort();
  t.dbLimit(JSON.stringify(codes) === JSON.stringify([200, 409]), "E8 a double-clicked DELETE: exactly one 200 and one 409", codes);
  ok(codes.every((c) => c === 200 || c === 409) && !!(await dbDoc(iC)).deletedAt, "E8b …and in every case the invoice ends up soft-deleted exactly once, never removed");
  await api("PATCH", `/invoices/${sid(iC)}/restore`, tkX);
  // an invoice with payments can be deleted (payment status is a separate concept) and keeps its status
  const iP = await mkInv(tkX, { patientId: sid(p1), items: [{ description: "Paid", price: 20, qty: 1 }] }); await payNow(iP, 20);
  await api("DELETE", `/invoices/${sid(iP)}`, tkX, {});
  ok((await dbDoc(iP)).status === "paid" && (await dbDoc(iP)).payments.length === 1, "E9 deleting a paid invoice does not touch its payment status or payments");
  await api("PATCH", `/invoices/${sid(iP)}/restore`, tkX);
  // a forged body cannot ride along
  const iF = await mkInv(tkX, { patientId: sid(p1), items: [{ description: "Forge", price: 7, qty: 1 }] });
  await api("DELETE", `/invoices/${sid(iF)}`, tkX, { reason: "r", total: 1, status: "paid", payments: [{ amount: 7 }], doctorId: sid(docY), items: [] });
  const fd = await dbDoc(iF);
  ok(fd.total === 7 && fd.status === "unpaid" && fd.payments.length === 0 && String(fd.doctorId) === sid(docX) && fd.items.length === 1, "E10 extra body fields on DELETE change nothing (total / status / payments / doctor / items)", fd);
  await api("PATCH", `/invoices/${sid(iF)}/restore`, tkX, { total: 1, deletedAt: null });
  ok((await dbDoc(iF)).total === 7, "E10b …nor on restore");

  /* ============ N · invoice numbering ============ */
  const top = await Invoice.findOne({ clinicId: A._id }).sort({ invoiceNumber: -1 }).lean();
  await api("DELETE", `/invoices/${sid(top)}`, tkO, {});
  const nxt = await mkInv(tkO, { patientId: sid(p1), items: [{ description: "Next", price: 1, qty: 1 }] });
  eq(nxt.invoiceNumber, top.invoiceNumber + 1, "N1 a SOFT-deleted invoice keeps its number: the next invoice is max + 1, the number is never handed out twice");
  eq((await api("PATCH", `/invoices/${sid(top)}/restore`, tkO)).status, 200, "N2 …and restoring it never collides with anything");
  eq((await Invoice.find({ clinicId: A._id }).lean()).map((i) => i.invoiceNumber).filter((n, i, a) => a.indexOf(n) !== i), [], "N3 no duplicate invoice numbers in the clinic");

  /* ============ B · dental billing link (Treatment Plan "Add to invoice") ============ */
  const pD = await t.mkPatient(A, "Dental Dina");
  const visit = (p, doc, ago = 6 * 36e5) => Appointment.create({ clinicId: A._id, doctorId: doc._id, patientId: p._id, startAt: new Date(Date.now() - ago), duration: 30, status: "completed" });
  const v1 = await visit(pD, docY);
  const planIt = async (tk, p, body) => (await api("POST", `/dental/patients/${sid(p)}/treatment-plan/items`, tk, body)).json.item._id;
  const run = async (tk, p, itemId, v) => { await api("POST", `/dental/patients/${sid(p)}/treatment-plan/items/${itemId}/start`, tk, { appointmentId: sid(v) }); return api("POST", `/dental/patients/${sid(p)}/treatment-plan/items/${itemId}/complete`, tk, { appointmentId: sid(v) }); };
  const bill = (tk, p, itemId, body = {}) => api("POST", `/dental/patients/${sid(p)}/treatment-plan/items/${itemId}/invoice`, tk, { price: 80, description: "Crown 16", ...body });
  const itD = await planIt(tkY, pD, { procedureCode: "crown", targetType: "tooth", toothNumbers: ["16"] });
  eq((await run(tkY, pD, itD, v1)).status, 200, "B0 Dr Mahmoud completes a crown");
  const bD = await bill(tkR, pD, itD);
  eq(bD.status, 201, "B1 the receptionist bills it → invoice created");
  const iD = bD.json.invoice;
  const dash0 = (await api("GET", "/dental/dashboard", tkO)).json;
  ok(dash0.recentActivity.some((e) => e.kind === "invoiced" && e.invoiceNumber === iD.invoiceNumber), "B1b (control) the dental dashboard's activity feed shows the invoiced event while the invoice is active", dash0.recentActivity);
  const planOf = async (tk) => (await api("GET", `/dental/patients/${sid(pD)}/treatment-plan`, tk)).json;
  let pl = await planOf(tkO);
  ok(pl.items[0].billing.state === "invoiced" && pl.items[0].billing.amount === 80 && pl.summary.invoicedTotal === 80 && pl.summary.invoicedCount === 1, "B2 plan: invoiced 80, count 1", pl.summary);
  eq((await api("DELETE", `/invoices/${iD._id}`, tkY, { reason: "billed by mistake" })).status, 200, "B3 Dr Mahmoud moves that invoice to Deleted Invoices");
  pl = await planOf(tkO);
  const bl = pl.items[0].billing;
  ok(bl.state === "invoiced" && bl.invoiceDeleted === true && bl.amount === undefined && bl.invoiceStatus === undefined && bl.invoiceNumber === iD.invoiceNumber, "B4 the treatment stays linked ('invoiced', so it cannot be billed twice) but carries NO amount / status", bl);
  ok(pl.summary.invoicedTotal === 0 && pl.summary.invoicedCount === 0, "B5 the plan's invoiced total and count exclude it (0 / 0)", pl.summary);
  const rebill = await bill(tkR, pD, itD);
  eq([rebill.status, rebill.json.code], [409, "INVOICE_DELETED"], "B6 billing it again while its invoice is deleted → 409 INVOICE_DELETED (no silent double billing)");
  eq(await Invoice.countDocuments({ patientId: pD._id }), 1, "B6b …and no second invoice exists");
  const itD2 = await planIt(tkY, pD, { procedureCode: "filling", targetType: "surface", toothNumbers: ["26"], surfaces: ["O"] });
  await run(tkY, pD, itD2, await visit(pD, docY, 5 * 36e5));
  eq((await bill(tkY, pD, itD2, { price: 40, description: "Filling 26", invoiceId: iD._id })).status, 404, "B7 a line cannot be added to a deleted invoice (404)");
  const dash = (await api("GET", "/dental/dashboard", tkO)).json;
  ok(!dash.recentActivity.some((e) => e.kind === "invoiced" && e.invoiceNumber === iD.invoiceNumber), "B8 the dental dashboard's activity feed no longer shows the deleted invoice as an invoiced event");
  ok(dash.needsBilling.some((n) => n._id === itD2) && !dash.needsBilling.some((n) => n._id === itD), "B9 …and does not offer the linked treatment under 'Needs billing' (control: the genuinely unbilled one is offered)", dash.needsBilling);
  eq((await api("PATCH", `/invoices/${iD._id}/restore`, tkY)).status, 200, "B10 restore");
  pl = await planOf(tkO);
  ok(pl.items[0].billing.amount === 80 && pl.items[0].billing.invoiceDeleted === undefined && pl.summary.invoicedTotal === 80, "B11 the plan shows the invoiced amount again (80)", pl.items[0].billing);
  eq((await bill(tkR, pD, itD)).json.alreadyInvoiced, true, "B12 billing is idempotent again (same invoice, no new one)");
  await api("DELETE", `/invoices/${iD._id}`, tkY, {});
  eq((await api("DELETE", `/invoices/${iD._id}/permanent`, tkO, { confirm: iD.invoiceNumber })).status, 200, "B13 the owner permanently deletes that invoice");
  const reb = await bill(tkR, pD, itD, { price: 85, description: "Crown 16 (re-billed)" });
  eq([reb.status, reb.json.alreadyInvoiced], [201, false], "B14 now the treatment is billable again (the link self-heals) and a NEW invoice is created");
  pl = await planOf(tkO);
  ok(pl.items.find((i) => i._id === itD).billing.amount === 85, "B15 the plan shows the new invoice (85)", pl.items.find((i) => i._id === itD).billing);

  /* ============ L · loyalty tier reconciliation ============ */
  const tiers = require(path.join(DIST, "services/loyaltyTiers"));
  const acct = { _id: new t.mongoose.Types.ObjectId(), patientId: p2._id };
  const truth1 = await tiers.computeTruth(sid(A), acct);
  await api("DELETE", `/invoices/${sid(iY1)}`, tkY, {});
  const truth2 = await tiers.computeTruth(sid(A), acct);
  ok(truth1.paidFils === 60000 && truth2.paidFils === 0, "L1 loyalty tier reconciliation counts the payments of ACTIVE invoices only (60.000 → 0)", [truth1.paidFils, truth2.paidFils]);
  await api("PATCH", `/invoices/${sid(iY1)}/restore`, tkY);
  eq((await tiers.computeTruth(sid(A), acct)).paidFils, 60000, "L2 …and again after the restore");

  /* ============ X · clinic export / purge ============ */
  await api("DELETE", `/invoices/${sid(iX1)}`, tkO, { reason: "export check" });
  const exp = (await api("GET", "/clinic/export", tkO)).json;
  const exported = (exp.invoices || []).find((i) => i._id === sid(iX1));
  ok(!!exported && !!exported.deletedAt, "X1 the clinic data export is a full backup: it keeps soft-deleted invoices, flagged with deletedAt", exported && exported.deletedAt);
  await api("PATCH", `/invoices/${sid(iX1)}/restore`, tkO);

  /* ============ Z · nothing internal leaks ============ */
  t.noLeaks("Z1 no response of this suite leaked a stack / path / Mongo internals");
  const lifeFailures = t.seen.filter((x) => x.url.startsWith("/invoices") && x.status >= 500);
  eq(lifeFailures.length, 0, "Z2 no invoice request ever returned a 5xx");

  await t.finish("Phase 2 — invoice soft delete / restore / permanent delete");
})().catch((e) => { console.error(e); process.exit(1); });
