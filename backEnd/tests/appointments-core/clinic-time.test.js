/* Appointments core — clinic-local calendar semantics.
   Pure unit tests of utils/timezone.ts (compiled to dist/ by `npm run build`); no database, no network.
   Run:  npm run build && node --test tests/appointments-core/clinic-time.test.js
   Run it under different PROCESS timezones to prove the result never depends on the server's own zone:
         TZ=UTC node --test tests/appointments-core/clinic-time.test.js   |   TZ=America/New_York node --test tests/appointments-core/clinic-time.test.js */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const DIST = process.env.P10_DIST || path.resolve(__dirname, "../../dist");
const tz = require(path.join(DIST, "utils/timezone"));

const AMMAN = "Asia/Amman";
const iso = (d) => d.toISOString();

/** Which clinic-local day does an Amman wall-clock moment belong to, according to the [start,end) windows the API now uses? */
function dayOf(ymd, hhmm) {
  const at = tz.clinicLocalToUtc(ymd, hhmm, AMMAN);
  for (const probe of [tz.addDaysYmd(ymd, -1), ymd, tz.addDaysYmd(ymd, 1)]) {
    const { start, end } = tz.clinicDayRange(probe, AMMAN);
    if (at >= start && at < end) return probe;
  }
  return null;
}

test("the reported bug: Oct 9 00:30 Amman belongs to Oct 9, not Oct 8", () => {
  assert.equal(dayOf("2026-10-09", "00:30"), "2026-10-09");
  const { start, end } = tz.clinicDayRange("2026-10-09", AMMAN);
  assert.equal(iso(start), "2026-10-08T21:00:00.000Z"); // Amman is UTC+3 → local midnight = 21:00Z the evening before
  assert.equal(iso(end), "2026-10-09T21:00:00.000Z");
  // …and the instant 00:30 Amman is INSIDE Oct 9's window and OUTSIDE Oct 8's
  const at = tz.clinicLocalToUtc("2026-10-09", "00:30", AMMAN);
  const oct8 = tz.clinicDayRange("2026-10-08", AMMAN);
  assert.ok(at >= start && at < end);
  assert.ok(!(at >= oct8.start && at < oct8.end));
});

test("23:00 23:30 23:59 | 00:00 00:01 00:30 01:00 land on the right local day", () => {
  for (const t of ["23:00", "23:30", "23:59"]) assert.equal(dayOf("2026-10-08", t), "2026-10-08", `Oct 8 ${t}`);
  for (const t of ["00:00", "00:01", "00:30", "01:00"]) assert.equal(dayOf("2026-10-09", t), "2026-10-09", `Oct 9 ${t}`);
});

test("today → tomorrow: windows are contiguous and gap-free (end of day N === start of day N+1)", () => {
  const a = tz.clinicDayRange("2026-10-08", AMMAN);
  const b = tz.clinicDayRange("2026-10-09", AMMAN);
  assert.equal(a.end.getTime(), b.start.getTime());
});

test("October 31 23:59 → November 1 00:00", () => {
  assert.equal(dayOf("2026-10-31", "23:59"), "2026-10-31");
  assert.equal(dayOf("2026-11-01", "00:00"), "2026-11-01");
  assert.equal(tz.addDaysYmd("2026-10-31", 1), "2026-11-01");
});

test("December 31 23:59 → January 1 00:00", () => {
  assert.equal(dayOf("2026-12-31", "23:59"), "2026-12-31");
  assert.equal(dayOf("2027-01-01", "00:00"), "2027-01-01");
  assert.equal(tz.addDaysYmd("2026-12-31", 1), "2027-01-01");
});

test("month/leap-year arithmetic", () => {
  assert.equal(tz.addDaysYmd("2028-02-28", 1), "2028-02-29"); // leap year
  assert.equal(tz.addDaysYmd("2027-02-28", 1), "2027-03-01");
  assert.equal(tz.addDaysYmd("2026-03-01", -1), "2026-02-28");
  assert.equal(tz.addDaysYmd("2026-10-08", 38), "2026-11-15"); // the "jump a month ahead" case
});

test("clinicYmdOf is the inverse: instant → clinic-local calendar day", () => {
  assert.equal(tz.clinicYmdOf(new Date("2026-10-08T21:30:00Z"), AMMAN), "2026-10-09"); // 00:30 Amman
  assert.equal(tz.clinicYmdOf(new Date("2026-10-08T20:59:59Z"), AMMAN), "2026-10-08"); // 23:59:59 Amman
  assert.equal(tz.clinicYmdOf(new Date("2026-10-08T21:00:00Z"), AMMAN), "2026-10-09"); // exactly 00:00 Amman
});

test("clinicLocalToUtc round-trips through clinicYmdOf for every half hour of a day", () => {
  for (let m = 0; m < 24 * 60; m += 30) {
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const at = tz.clinicLocalToUtc("2026-10-09", hhmm, AMMAN);
    assert.equal(tz.clinicYmdOf(at, AMMAN), "2026-10-09", hhmm);
  }
});

test("invalid input is rejected, never silently rolled over", () => {
  assert.equal(tz.isValidYmd("2026-10-09"), true);
  for (const bad of ["2026-02-30", "2026-13-01", "2026-1-5", "10/09/2026", "", "2026-10-09T00:00:00Z", "abc"]) {
    assert.equal(tz.isValidYmd(bad), false, bad);
  }
  assert.throws(() => tz.clinicDayRange("2026-02-30", AMMAN), RangeError);
  assert.throws(() => tz.clinicLocalToUtc("2026-10-09", "25:00x", AMMAN), RangeError);
});

test("the helper is zone-generic (DST day in New York is 23h long) — future per-clinic timezone support", () => {
  const NY = "America/New_York";
  const { start, end } = tz.clinicDayRange("2026-03-08", NY); // spring-forward day
  assert.equal((end.getTime() - start.getTime()) / 36e5, 23);
  const fall = tz.clinicDayRange("2026-11-01", NY); // fall-back day
  assert.equal((fall.end.getTime() - fall.start.getTime()) / 36e5, 25);
});

test("result never depends on the process timezone (TZ env)", () => {
  // Same literal expectations as above — run this file under TZ=UTC / TZ=America/New_York / TZ=Asia/Amman and they must all hold.
  assert.equal(iso(tz.clinicLocalToUtc("2026-10-09", "00:30", AMMAN)), "2026-10-08T21:30:00.000Z");
  assert.equal(iso(tz.clinicLocalToUtc("2026-10-09", "12:00", AMMAN)), "2026-10-09T09:00:00.000Z");
});
