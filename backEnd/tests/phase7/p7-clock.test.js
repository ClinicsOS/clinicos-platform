/* PHASE 7 — time-boundary QA.
 *   PART 1  pure calendar maths: every preset at 23:59:59.999 / 00:00:00.000 / 00:00:01 clinic-local, on month ends, year end, a leap day and
 *           DST transition days, in 4 zones (Asia/Amman has no DST since 2022; New_York / London / Auckland do) → nothing may hard-code +02/+03.
 *   PART 2  the REAL compiled server (TZ=UTC, like production) on a shifted clock that crosses 31 Dec 23:59 → 1 Jan 00:00 Amman while the suite
 *           is running: a payment / walk-in / expense / appointment taken before midnight and one after, then every page that shows "today",
 *           "yesterday", "this week", "this month", "last month", "this year" and the deprecated monthly report must agree.
 *   node tests/phase7/p7-clock.test.js */
const { boot7, wh } = require("./p7lib");

const FAKE_START = "2026-12-31T23:59:12+03:00"; // clinic-local; the suite crosses midnight ~50 s later

(async () => {
  const t = await boot7({ name: "p7_clock", port: 5308, fakeNow: new Date(FAKE_START).toISOString() });
  const { tz } = t;
  const R = require(`${t.D}/services/analytics/range`);
  const api = t.api;
  const sid = (d) => String(d._id);

  // ═══════════════════════════ PART 1 — pure maths ═══════════════════════════
  const ZONES = ["Asia/Amman", "America/New_York", "Europe/London", "Pacific/Auckland"];
  const DAYS = ["2026-01-31", "2026-02-28", "2028-02-29", "2026-03-01", "2026-03-08", "2026-03-29", "2026-04-05", "2026-10-25", "2026-11-01", "2026-12-31", "2027-01-01", "2026-07-01"];
  const PRESETS = ["today", "yesterday", "this_week", "last_week", "this_month", "last_month", "last_30", "this_year"];
  const bad = [];
  let n = 0;
  for (const zone of ZONES) for (const day of DAYS) {
    // the three instants around the local midnight that STARTS `day`, and the one that ends it
    const startOfDay = tz.clinicLocalToUtc(day, "00:00", zone);
    const instants = { "00:00:00.000": new Date(startOfDay.getTime()), "00:00:01": new Date(startOfDay.getTime() + 1000), "23:59:59.999": new Date(tz.clinicLocalToUtc(tz.addDaysYmd(day, 1), "00:00", zone).getTime() - 1) };
    for (const [label, now] of Object.entries(instants)) {
      if (tz.clinicYmdOf(now, zone) !== day) { bad.push(`${zone} ${day} ${label}: clinicYmdOf=${tz.clinicYmdOf(now, zone)}`); continue; }
      const dr = tz.clinicDayRange(day, zone);
      n++;
      if (!(dr.start <= now && now < dr.end)) bad.push(`${zone} ${day} ${label}: now outside its own day range`);
      if (tz.clinicYmdOf(new Date(dr.end.getTime() - 1), zone) !== day) bad.push(`${zone} ${day} ${label}: end-1ms is not the same day`);
      if (tz.clinicYmdOf(dr.end, zone) !== tz.addDaysYmd(day, 1)) bad.push(`${zone} ${day} ${label}: end is not the next day's midnight`);
      for (const preset of PRESETS) {
        const r = R.resolveRanges({ preset }, now, zone);
        n++;
        if (r.today !== day) bad.push(`${zone} ${day} ${label} ${preset}: today=${r.today}`);
        for (const [nm, rg] of [["current", r.current], ["previous", r.previous]]) {
          if (tz.clinicYmdOf(rg.start, zone) !== rg.from) bad.push(`${zone} ${day} ${label} ${preset} ${nm}: start is not 00:00 of ${rg.from}`);
          if (tz.clinicYmdOf(new Date(rg.end.getTime() - 1), zone) !== rg.to) bad.push(`${zone} ${day} ${label} ${preset} ${nm}: end-1ms is not ${rg.to}`);
          if (!(rg.start < rg.end)) bad.push(`${zone} ${day} ${preset} ${nm}: empty range`);
        }
        if (!(r.previous.end <= r.current.start)) bad.push(`${zone} ${day} ${label} ${preset}: previous overlaps current`);
        if (preset === "today" && !(r.current.start.getTime() === dr.start.getTime() && r.current.end.getTime() === dr.end.getTime())) bad.push(`${zone} ${day} ${label}: analytics "today" ≠ clinicDayRange`);
        if (preset === "this_month" && !r.current.from.endsWith("-01")) bad.push(`${zone} ${day} ${label}: this_month does not start on the 1st (${r.current.from})`);
        if (preset === "this_week" && R.weekdayOf(r.current.from) !== R.WEEK_STARTS_ON) bad.push(`${zone} ${day} ${label}: this_week does not start on the configured weekday`);
        if (preset === "last_month" && !(r.current.to < r.today.slice(0, 7) + "-01")) bad.push(`${zone} ${day} ${label}: last_month reaches into this month`);
        if (preset === "this_year" && !r.current.from.endsWith("-01-01")) bad.push(`${zone} ${day} ${label}: this_year does not start on 1 Jan`);
      }
      const today = tz.clinicTodayRange(now, zone);
      if (today.ymd !== day || today.start.getTime() !== dr.start.getTime() || today.end.getTime() !== dr.end.getTime()) bad.push(`${zone} ${day} ${label}: clinicTodayRange disagrees`);
      const mr = tz.clinicMonthRange(Number(day.slice(0, 4)), Number(day.slice(5, 7)), zone);
      if (!(mr.start <= now && now < mr.end) && !(mr.start <= now && now <= mr.end)) bad.push(`${zone} ${day} ${label}: clinicMonthRange does not contain the instant`);
    }
  }
  t.eq(bad.slice(0, 8), [], `A1 ${n} boundary assertions across ${ZONES.length} zones × ${DAYS.length} dates × 3 instants × all presets`);
  // month lengths and the year turn, explicitly
  const mlen = (y, m) => { const r = tz.clinicMonthRange(y, m, "Asia/Amman"); return Math.round((r.end.getTime() - r.start.getTime() + 1) / 864e5); };
  t.eq([mlen(2026, 1), mlen(2026, 2), mlen(2028, 2), mlen(2026, 4), mlen(2026, 12)], [31, 28, 29, 30, 31], "A2 month lengths incl. a leap February");
  t.eq(R.resolveRanges({ preset: "last_month" }, new Date("2027-01-01T00:00:30+03:00"), "Asia/Amman").current.from, "2026-12-01", "A3 'last month' at 00:00:30 on 1 Jan is December of the previous year");
  t.eq(R.resolveRanges({ preset: "last_month" }, new Date("2026-12-31T23:59:59+03:00"), "Asia/Amman").current.from, "2026-11-01", "A3b …and at 23:59:59 on 31 Dec it is still November");
  t.eq(R.resolveRanges({ preset: "this_year" }, new Date("2027-01-01T00:00:01+03:00"), "Asia/Amman").previous.from, "2026-01-01", "A4 'this year' at 00:00:01 on 1 Jan compares with the previous year");
  t.eq(R.resolveRanges({ preset: "this_month" }, new Date("2026-03-31T00:00:01+03:00"), "Asia/Amman").previous.to, "2026-02-28", "A5 31 March compares with the whole of a 28-day February (clamped, no 'Feb 31')");
  // the custom-range validation at the edges (needs a token: wired in PART 2)
  // ═══════════════════════════ PART 2 — live server across midnight ═══════════════════════════
  const C = await t.mkClinic("p7clock", { specialty: "dentistry", plan: "pro", workingHours: wh(), slotDuration: 30, planExpiresAt: new Date("2030-01-01") });
  const owner = await t.mkUser(C, "owner"), dr = await t.mkUser(C, "doctor", 1), rec = await t.mkUser(C, "receptionist");
  const TK = { o: t.tok(owner), d: t.tok(dr), r: t.tok(rec) };
  const pat = await t.mkPatient(C, "Clock Patient", "0797000001");
  const inv = await api("POST", "/invoices", TK.o, { patientId: sid(pat), doctorId: sid(dr), items: [{ description: "Service", price: 100, qty: 1 }], discount: 0 });
  t.eq(inv.status, 201, "B1 invoice created");

  const pay = async (amount, token = TK.o) => {
    const r = await api("POST", `/invoices/${inv.json._id}/payments`, token, { amount });
    const pays = r.json.payments || [];
    return { status: r.status, at: pays.length ? new Date(pays[pays.length - 1].paidAt) : null };
  };
  const p1 = await pay(20);
  const ymd1 = p1.at && tz.clinicYmdOf(p1.at);
  t.eq(ymd1, "2026-12-31", "B2 the first payment is stamped 31 Dec (clinic-local) — server clock", p1.at && p1.at.toISOString());
  const secsToMidnight = (tz.clinicLocalToUtc("2027-01-01", "00:00").getTime() - p1.at.getTime()) / 1000;
  t.ok(secsToMidnight > 3, "B2b the setup ran fast enough: still before midnight when the first payment was taken", secsToMidnight);

  const w1 = await api("POST", "/appointments", TK.r, { source: "walk_in", patientId: sid(pat), doctorId: sid(dr) });
  t.eq([w1.status, tz.clinicYmdOf(new Date(w1.json.startAt))], [201, "2026-12-31"], "B3 a walk-in just before midnight belongs to 31 Dec");
  const ex1 = await api("POST", "/expenses", TK.o, { title: "Before midnight", category: "other", scope: "clinic", amount: 10, status: "paid", date: "2026-12-31" });
  t.eq(ex1.status, 201, "B4 an expense dated 31 Dec");

  const Q = (preset) => `preset=${preset}&compare=0`;
  const fin = async (preset, token = TK.o, extra = "") => (await api("GET", `/analytics/financial?${Q(preset)}${extra}`, token)).json;
  const collected = (j) => j.kpis && j.kpis.collected.current;
  const dash = async (token = TK.o) => (await api("GET", "/dashboard/stats", token)).json;

  // pre-midnight snapshot
  const dPre = await dash();
  t.eq([dPre.today.total, dPre.today.revenue], [1, 20], "C1 dashboard before midnight: 1 visit, revenue 20");
  t.money(collected(await fin("today")), 20, "C2 Reports → Today before midnight: collected 20");

  // wait for the server clock to pass midnight (server − real offset measured from the first payment's own timestamp)
  const offsetMs = p1.at.getTime() - Date.now(); // ≈ server − real, accurate to the request latency (a few ms)
  const target = tz.clinicLocalToUtc("2027-01-01", "00:00").getTime() + 2500 - offsetMs; // real time at which the server clock is 00:00:02.5
  await t.sleep(Math.max(0, target - Date.now()));

  const p2 = await pay(15);
  t.eq(p2.at && tz.clinicYmdOf(p2.at), "2027-01-01", "D1 a payment at 00:00:02 is 1 Jan (clinic-local) — although it is still 31 Dec in UTC", p2.at && p2.at.toISOString());
  t.eq(p2.at && p2.at.toISOString().slice(0, 10), "2026-12-31", "D1b (control) the same instant in UTC IS 31 Dec — the exact case the old UTC code got wrong");
  const w2 = await api("POST", "/appointments", TK.r, { source: "walk_in", patientId: sid(pat), doctorId: sid(dr) });
  t.eq([w2.status, tz.clinicYmdOf(new Date(w2.json.startAt))], [201, "2027-01-01"], "D2 a walk-in just after midnight belongs to 1 Jan");
  const ex2 = await api("POST", "/expenses", TK.o, { title: "After midnight", category: "other", scope: "clinic", amount: 7, status: "paid", date: "2027-01-01" });
  t.eq(ex2.status, 201, "D3 an expense dated 1 Jan");

  // dashboards after midnight
  for (const [who, tk, isRec] of [["owner", TK.o, false], ["doctor", TK.d, false], ["receptionist", TK.r, true]]) {
    const d = await dash(tk);
    if (who === "doctor") {
      t.eq(d.today.total, 1, `E1 ${who}: dashboard today = 1 appointment (the 1 Jan walk-in)`);
    } else {
      t.eq(d.today.total, 1, `E1 ${who}: dashboard today = 1 appointment (the 1 Jan walk-in)`);
    }
    if (isRec) t.eq(d.today.revenue, null, "E2 receptionist: no revenue number at all");
    else t.money(d.today.revenue, who === "doctor" ? 15 : 15, `E2 ${who}: today's revenue = 15 (only the payment after midnight)`);
    t.eq(d.week.length, 7, `E3 ${who}: the week strip has 7 days`);
    t.eq([d.week[6].date, d.week[6].count, d.week[5].date, d.week[5].count], ["2027-01-01", 1, "2026-12-31", 1], `E4 ${who}: the strip ends 31 Dec (1) → 1 Jan (1)`);
  }

  const expect = { today: 15, yesterday: 20, this_week: null, this_month: 15, last_month: 20, last_30: 35, this_year: 15 };
  for (const [preset, want] of Object.entries(expect)) {
    if (want === null) continue;
    t.money(collected(await fin(preset)), want, `F1 Reports → ${preset}: collected ${want} (owner)`);
    t.money(collected(await fin(preset, TK.d)), want, `F1b …same for Doctor (their own invoices)`);
  }
  // 1 Jan 2027 is a Friday → the week (Sun-based) started Sun 27 Dec: both payments are in "this week"
  t.money(collected(await fin("this_week")), 35, "F2 this_week (Sun 27 Dec → Fri 1 Jan) holds both payments");
  const cust = async (from, to) => collected((await api("GET", `/analytics/financial?from=${from}&to=${to}&compare=0`, TK.o)).json);
  t.money(await cust("2026-12-31", "2026-12-31"), 20, "F3 custom 31 Dec → 31 Dec = 20");
  t.money(await cust("2027-01-01", "2027-01-01"), 15, "F3b custom 1 Jan → 1 Jan = 15");
  t.money(await cust("2026-12-31", "2027-01-01"), 35, "F3c custom across the year turn = 35");
  t.money(await cust("2026-12-01", "2026-12-31"), 20, "F3d custom full December = 20");

  // expenses on both sides
  const exSum = async (preset) => (await api("GET", `/analytics/financial?${Q(preset)}`, TK.o)).json.kpis.expenses.current;
  t.money(await exSum("today"), 7, "G1 expenses today = 7");
  t.money(await exSum("yesterday"), 10, "G2 expenses yesterday = 10");
  t.money(await exSum("this_month"), 7, "G3 expenses this month (January) = 7");
  t.money(await exSum("last_month"), 10, "G4 expenses last month (December) = 10");
  const mo = (await api("GET", "/expenses/summary", TK.o)).json;
  t.ok(mo && !/NaN|undefined/.test(JSON.stringify(mo)), "G5 expense summary is clean across the month turn");

  // appointment list by day
  const listDay = async (ymd) => (await api("GET", `/appointments?date=${ymd}`, TK.r)).json;
  const arr = (j) => (Array.isArray(j) ? j : j.appointments || []);
  t.eq([arr(await listDay("2026-12-31")).length, arr(await listDay("2027-01-01")).length], [1, 1], "H1 the day list shows each walk-in on its own day");

  for (const [from, to, want] of [["2026-02-30", "2026-03-01", 400], ["2026-03-05", "2026-03-01", 400], ["2026-1-1", "2026-01-02", 400], ["2000-01-01", "2026-01-01", 400], ["2028-02-29", "2028-02-29", 200]]) {
    t.eq((await api("GET", `/analytics/financial?from=${from}&to=${to}&compare=0`, TK.o)).status, want, `A6 custom range ${from} → ${to} is ${want}`);
  }

  // legacy monthly report
  t.money((await api("GET", "/reports/monthly?year=2026&month=12", TK.o)).json.revenue, 20, "I1 legacy monthly report: December 2026 = 20");
  t.money((await api("GET", "/reports/monthly?year=2027&month=1", TK.o)).json.revenue, 15, "I2 …January 2027 = 15");
  t.eq((await api("GET", "/reports/monthly?year=2027&month=13", TK.o)).status, 400, "I3 month 13 is a 400");
  t.eq((await api("GET", "/reports/monthly?year=abc&month=1", TK.o)).status, 400, "I3b year 'abc' is a 400");

  // Today/Yesterday agree across Dashboard ↔ Analytics ↔ Overview
  const ov = await api("GET", `/analytics/overview?${Q("today")}`, TK.o);
  t.clean(ov, "J1 Overview 'today' answers cleanly");
  t.money(await (async () => collected((await api("GET", `/analytics/financial?${Q("today")}`, TK.o)).json))(), (await dash()).today.revenue, "J2 Dashboard 'today revenue' = Reports 'today collected'");

  t.noLeaks("no response of the clock suite leaked internals");
  await t.finish("PHASE 7 — time boundaries");
})().catch((e) => { console.error(e); process.exit(1); });
