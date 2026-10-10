/* Appointments core — end-to-end API checks against the COMPILED server (real HTTP, real database, nothing mocked).
   Reuses the project's existing harness (tests/phase10/lib.js): needs `npm run build` (dist/) and a MongoDB-protocol server.
     npm run build && node tests/appointments-core/appointments-api.test.js
   Optional env: P10_MONGO (default mongodb://127.0.0.1:27017), P10_DIST, P10_OUT (where the .result.json is written). */
const path = require("path");
const { boot } = require("../phase10/lib");

const DIST = process.env.P10_DIST || path.resolve(__dirname, "../../dist");
// P10_TZ_DIST lets the suite be pointed at an OLD build (to prove it catches the bug) while still using the new time helpers to build its inputs.
const tz = require(path.join(process.env.P10_TZ_DIST || DIST, "utils/timezone"));
const AMMAN = "Asia/Amman";

(async () => {
  const t = await boot({ name: "appts_core", port: 5201 });
  const { ok, eq, http, m } = t;

  // ---- world: one 24h clinic (so every hour incl. 00:00-01:00 is bookable), one other tenant ----
  const allWeek = (from, to) => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, from, to }));
  const A = await t.mkClinic("appts-a", { plan: "pro", workingHours: allWeek("00:00", "00:00"), slotDuration: 30 });
  const B = await t.mkClinic("appts-b", { plan: "pro", workingHours: allWeek("00:00", "00:00"), slotDuration: 30 });
  const owner = await t.mkUser(A, "owner");
  const dA = await t.mkUser(A, "doctor", 1);
  const dB = await t.mkUser(A, "doctor", 2);
  const dC = await t.mkUser(A, "doctor", 3);
  const ownerB = await t.mkUser(B, "owner");
  const tok = t.tok(owner);
  const tokB = t.tok(ownerB);
  const pats = [];
  for (let i = 0; i < 12; i++) pats.push(await t.mkPatient(A, "Patient " + i));
  const pOther = await t.mkPatient(B, "Other tenant patient");

  // ---- dates: a clinic-local day comfortably in the future ----
  const today = tz.clinicYmdOf(new Date(), AMMAN);
  const D = tz.addDaysYmd(today, 20);        // "day N"
  const D1 = tz.addDaysYmd(D, 1);            // "day N+1"
  const at = (ymd, hhmm) => tz.clinicLocalToUtc(ymd, hhmm, AMMAN).toISOString();
  const book = (body, token = tok) => http("POST", "/appointments", { token, body });
  const list = async (query, token = tok) => (await http("GET", "/appointments?" + query, { token }));
  const ids = (r) => (r.json || []).map((a) => a._id);
  const idOf = (r) => r.json && r.json._id;
  const has = (r, id) => ids(r).includes(id);
  let pi = 0;
  const nextPatient = () => String(pats[pi++ % pats.length]._id);
  const mk = async (doc, ymd, hhmm, duration = 30, extra = {}) => {
    const r = await book({ patientId: nextPatient(), doctorId: String(doc._id), startAt: at(ymd, hhmm), duration, ...extra });
    return r;
  };

  /* ================= A. midnight / timezone ================= */
  const r0030 = await mk(dA, D1, "00:30");
  eq(r0030.status, 201, "A1 create Day+1 00:30 (the reported bug case)");
  const dayN = await list(`date=${D}`);
  const dayN1 = await list(`date=${D1}`);
  ok(!has(dayN, idOf(r0030)), "A2 00:30 appointment does NOT appear under the previous day");
  ok(has(dayN1, idOf(r0030)), "A3 00:30 appointment appears under its own day");

  const r2330 = await mk(dA, D, "23:30");
  eq(r2330.status, 201, "A4 create Day 23:30 (ends exactly at midnight)");
  const r2359 = await mk(dB, D, "23:59", 10);
  // 23:59 + 10min crosses midnight: clinic closes at 00:00 → must be refused by the working-hours rule, not mis-filed
  eq(r2359.status, 400, "A5 23:59 + 10 min crosses the 00:00 closing boundary → rejected by the existing hours rule");
  const r0000 = await mk(dB, D1, "00:00");
  eq(r0000.status, 201, "A6 create Day+1 00:00");
  const r0001 = await mk(dC, D1, "00:01");
  eq(r0001.status, 201, "A7 create Day+1 00:01");
  const r0100 = await mk(dA, D1, "01:00");
  eq(r0100.status, 201, "A8 create Day+1 01:00");
  const nN = await list(`date=${D}`);
  const nN1 = await list(`date=${D1}`);
  ok(has(nN, idOf(r2330)) && !has(nN1, idOf(r2330)), "A9 23:30 stays on Day");
  ok([r0000, r0001, r0030, r0100].every((r) => has(nN1, idOf(r)) && !has(nN, idOf(r))), "A10 00:00 / 00:01 / 00:30 / 01:00 all belong to Day+1 and none leak into Day");

  // month boundary: Oct 31 23:30 → Nov 1 00:00, year boundary Dec 31 23:30 → Jan 1 00:00
  for (const [lastDay, label] of [["2026-10-31", "Oct 31 → Nov 1"], ["2026-12-31", "Dec 31 → Jan 1"]]) {
    const first = tz.addDaysYmd(lastDay, 1);
    const late = await mk(dC, lastDay, "23:30");
    const early = await mk(dC, first, "00:00");
    eq([late.status, early.status], [201, 201], `A11 create ${label} boundary pair`);
    const L = await list(`date=${lastDay}`), F = await list(`date=${first}`);
    ok(has(L, idOf(late)) && !has(L, idOf(early)) && has(F, idOf(early)) && !has(F, idOf(late)), `A12 ${label}: each appointment is under its own day only`);
  }

  // input hardening of the date filter
  eq((await list("date=2026-02-30")).status, 400, "A13 impossible date → 400 (not a 500 / not rolled over)");
  eq((await list("date=garbage")).status, 400, "A14 garbage date → 400");
  // a full ISO instant is still accepted and resolved to the clinic day it falls on (backward compatible)
  const iso = await list(`date=${encodeURIComponent(at(D1, "00:30"))}`);
  ok(iso.status === 200 && has(iso, idOf(r0030)), "A15 legacy ISO-instant ?date= resolves to the clinic-local day");

  /* ================= B. several doctors at the same time ================= */
  const S = tz.addDaysYmd(D, 3);
  const b1 = await mk(dA, S, "10:00");
  const b2 = await mk(dB, S, "10:00");
  const b3 = await mk(dC, S, "10:00");
  eq([b1.status, b2.status, b3.status], [201, 201, 201], "B1 three different doctors, identical start time → all accepted (index/collision are per-doctor)");
  const sameDoc = await mk(dA, S, "10:00");
  eq([sameDoc.status, sameDoc.json && sameDoc.json.code], [409, "SLOT_TAKEN"], "B2 same doctor, same time → rejected");
  const overlapDoc = await mk(dA, S, "10:15", 30);
  eq(overlapDoc.status, 409, "B3 same doctor, overlapping time → rejected");
  const all = await list(`date=${S}`);
  ok([b1, b2, b3].every((r) => has(all, idOf(r))), "B4 All Doctors: the list returns all three simultaneous appointments");
  eq(new Set(ids(all)).size, ids(all).length, "B5 no duplicate records in one response");
  const onlyB = await list(`date=${S}&doctorId=${dB._id}`);
  eq(ids(onlyB), [idOf(b2)], "B6 doctor filter returns only that doctor's appointment");

  /* ================= C. long appointments ================= */
  const L90 = await mk(dA, S, "14:00", 90);
  const inside = await mk(dB, S, "14:30", 30);
  eq([L90.status, inside.status], [201, 201], "C1 Doctor A 14:00-15:30 and Doctor B 14:30-15:00 coexist");
  const insideSame = await mk(dA, S, "14:30", 30);
  eq(insideSame.status, 409, "C2 …but the SAME doctor cannot book inside the 90-minute appointment");
  const afterLong = await mk(dA, S, "15:30", 30);
  eq(afterLong.status, 201, "C3 back-to-back after the long appointment (15:30) is allowed (touching ≠ overlapping)");
  const longDay = await list(`date=${S}`);
  eq(ids(longDay).filter((id) => id === idOf(L90)).length, 1, "C4 the 90-minute appointment is returned ONCE (one record, not one per 30-min cell)");

  /* ================= D. walk-in keeps its special behaviour ================= */
  const W = await book({ patientId: nextPatient(), doctorId: String(dA._id), source: "walk_in", reason: "just arrived" });
  eq(W.status, 201, "D1 walk-in is created (server clock, no startAt needed)");
  const W2 = await book({ patientId: nextPatient(), doctorId: String(dA._id), source: "walk_in" });
  eq(W2.status, 201, "D2 a second walk-in for the same doctor at the same moment is still allowed");
  const wToday = await list(`date=${tz.clinicYmdOf(new Date(), AMMAN)}&source=walk_in`);
  ok(has(wToday, idOf(W)) && has(wToday, idOf(W2)), "D3 walk-ins are returned for today's clinic day and the source filter still works");
  const wPub = await http("GET", `/public/clinics/${A.slug}/slots?doctorId=${dA._id}&date=${tz.clinicYmdOf(new Date(), AMMAN)}`);
  eq(wPub.status, 200, "D4 public slots endpoint still answers");

  /* ================= E. reschedule / cancel / status ================= */
  const R = await mk(dA, tz.addDaysYmd(D, 5), "09:00");
  eq(R.status, 201, "E0 create appointment to reschedule");
  const R1 = await http("PATCH", `/appointments/${idOf(R)}/status`, { token: tok, body: { startAt: at(tz.addDaysYmd(D, 6), "00:30") } });
  eq(R1.status, 200, "E1 reschedule across midnight (Day+5 09:00 → Day+6 00:30)");
  const before = await list(`date=${tz.addDaysYmd(D, 5)}`);
  const after = await list(`date=${tz.addDaysYmd(D, 6)}`);
  ok(!has(before, idOf(R)) && has(after, idOf(R)), "E2 after rescheduling it is under the new day only");
  const R2 = await http("PATCH", `/appointments/${idOf(R)}/status`, { token: tok, body: { startAt: at(tz.addDaysYmd(D, 9), "11:00"), doctorId: String(dB._id) } });
  eq(R2.status, 200, "E3 reschedule to another day AND another doctor");
  const clash = await mk(dA, tz.addDaysYmd(D, 10), "10:00");
  const R3 = await http("PATCH", `/appointments/${idOf(R)}/status`, { token: tok, body: { startAt: at(tz.addDaysYmd(D, 10), "10:00"), doctorId: String(dA._id) } });
  eq([clash.status, R3.status], [201, 409], "E4 rescheduling onto the same doctor's occupied time → 409");
  const C1 = await http("PATCH", `/appointments/${idOf(R)}/status`, { token: tok, body: { status: "confirmed" } });
  eq(C1.json && C1.json.status, "confirmed", "E5 status update works");
  const C2 = await http("PATCH", `/appointments/${idOf(R)}/status`, { token: tok, body: { status: "cancelled", cancelReason: "test" } });
  eq(C2.json && C2.json.status, "cancelled", "E6 cancel works");
  const freed = await mk(dB, tz.addDaysYmd(D, 9), "11:00");
  eq(freed.status, 201, "E7 a cancelled appointment frees its slot for a new booking");

  /* ================= F. tenant scoping ================= */
  const xt = await list(`date=${S}`, tokB);
  eq(xt.json, [], "F1 another clinic sees none of this clinic's appointments for the same date");
  const xb = await http("POST", "/appointments", { token: tokB, body: { patientId: String(pOther._id), doctorId: String(dA._id), startAt: at(S, "12:00"), duration: 30 } });
  eq(xb.status, 404, "F2 another clinic cannot book with this clinic's doctor");
  const noAuth = await http("GET", `/appointments?date=${S}`);
  eq(noAuth.status, 401, "F3 unauthenticated list is refused");

  /* ================= G. public booking grid shares the day-boundary fix ================= */
  const G = tz.addDaysYmd(D, 12);
  const gBook = await http("POST", `/public/clinics/${A.slug}/book`, { body: { doctorId: String(dA._id), startAt: at(tz.addDaysYmd(G, 1), "00:30"), fullName: "Public Pat", phone: "0791234567" } });
  eq(gBook.status, 201, "G1 public booking at Day+1 00:30 is accepted");
  const slotsD = await http("GET", `/public/clinics/${A.slug}/slots?doctorId=${dA._id}&date=${G}`);
  const slotsD1 = await http("GET", `/public/clinics/${A.slug}/slots?doctorId=${dA._id}&date=${tz.addDaysYmd(G, 1)}`);
  ok(slotsD.json.slots.includes("00:30"), "G2 00:30 is still FREE on the earlier day (the booking no longer bleeds into it)");
  ok(!slotsD1.json.slots.includes("00:30") && slotsD1.json.slots.includes("01:00"), "G3 00:30 is taken on its own day; neighbours stay free");
  const todayY = tz.clinicYmdOf(new Date(), AMMAN);
  const slotsToday = await http("GET", `/public/clinics/${A.slug}/slots?doctorId=${dA._id}&date=${todayY}`);
  const nowMs = Date.now();
  ok(slotsToday.json.slots.every((s) => tz.clinicLocalToUtc(todayY, s, AMMAN).getTime() > nowMs), "G4 today's public slots never include a time that has already passed (clinic clock, not server clock)");
  eq((await http("GET", `/public/clinics/${A.slug}/slots?doctorId=${dA._id}&date=2026-02-30`)).status, 400, "G5 impossible date still → 400");

  /* ================= H. uniqueness is unchanged (no schema/index work was needed) ================= */
  // Asserted on the model's index DEFINITION: FerretDB (the test engine) does not implement partialFilterExpression, so this
  // particular index cannot be built there — on real MongoDB it is built exactly as defined here.
  const defs = m.Appointment.schema.indexes();
  const uniq = defs.find(([keys, opts]) => opts && opts.unique && keys.clinicId === 1 && keys.doctorId === 1 && keys.startAt === 1);
  ok(!!uniq && !!uniq[1].partialFilterExpression, "H1 the per-doctor unique index {clinicId, doctorId, startAt} is unchanged in the model (it includes doctorId, so simultaneous DIFFERENT doctors were never blocked by the database)");
  t.dbLimit(false, "H2 DB-level enforcement of that partial unique index (needs real MongoDB; FerretDB lacks partialFilterExpression) — same-doctor conflicts are still enforced by the application-level overlap check (B2/B3/C2)");

  t.noLeaks("no response leaked internals");
  await t.finish("Appointments core — API");
})().catch((e) => { console.error(e); process.exit(1); });
