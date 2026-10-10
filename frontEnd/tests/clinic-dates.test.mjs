/* Appointments core — frontend clinic-calendar helpers (src/lib/dates.ts).
   Pure unit tests, no browser, no network, no new dependency. Imports the TypeScript source directly, so it needs a
   Node that can strip types (Node >= 22.18, or Node 22.6+ with --experimental-strip-types):
       node --test tests/clinic-dates.test.mjs
   Run it under different PROCESS timezones — the answers must never change (the browser's zone must not matter):
       TZ=UTC node --test tests/clinic-dates.test.mjs
       TZ=America/New_York node --test tests/clinic-dates.test.mjs */
import test from "node:test";
import assert from "node:assert/strict";
import * as d from "../src/lib/dates.ts";

test("the reported bug: 00:30 clinic time on Oct 9 belongs to Oct 9", () => {
  const iso = d.combineToUTC("2026-10-09", "00:30");
  assert.equal(iso, "2026-10-08T21:30:00.000Z"); // Amman is UTC+3
  assert.equal(d.ymd(iso), "2026-10-09");
  assert.equal(d.fmtTime(iso), "00:30");
});

test("combineToUTC → ymd/fmtTime round-trips for every half hour, incl. 23:00-01:00", () => {
  for (let m = 0; m < 24 * 60; m += 30) {
    const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    for (const day of ["2026-10-08", "2026-10-31", "2026-12-31"]) {
      const iso = d.combineToUTC(day, hhmm);
      assert.equal(d.ymd(iso), day, `${day} ${hhmm}`);
      assert.equal(d.fmtTime(iso), hhmm, `${day} ${hhmm}`);
    }
  }
});

test("month and year rollover", () => {
  assert.equal(d.addDaysYmd("2026-10-31", 1), "2026-11-01");
  assert.equal(d.addDaysYmd("2026-12-31", 1), "2027-01-01");
  assert.equal(d.addDaysYmd("2027-01-01", -1), "2026-12-31");
  assert.equal(d.addDaysYmd("2028-02-28", 1), "2028-02-29");
  assert.equal(d.addDaysYmd("2026-10-08", 38), "2026-11-15");
  assert.equal(d.addMonthsYmd("2026-01-31", 1), "2026-02-28"); // day clamps to the shorter month
  assert.equal(d.addMonthsYmd("2026-10-08", 1), "2026-11-08");
  assert.equal(d.addMonthsYmd("2026-12-15", 1), "2027-01-15");
  assert.equal(d.addMonthsYmd("2026-01-15", -1), "2025-12-15");
});

test("weekday of a calendar date is timezone-independent", () => {
  assert.equal(d.weekdayOfYmd("2026-10-08"), 4); // Thursday
  assert.equal(d.weekdayOfYmd("2026-10-09"), 5); // Friday
  assert.equal(d.weekdayOfYmd("2026-11-15"), 0); // Sunday
  assert.equal(d.dayOfWeek("2026-10-08T21:30:00Z"), 5); // 00:30 Amman on Oct 9 = Friday, not Thursday
});

test("validation: impossible dates are rejected, never rolled over", () => {
  assert.equal(d.isValidYmd("2026-10-09"), true);
  for (const bad of ["2026-02-30", "2026-13-01", "2026-1-5", "", "abc", "2026-10-09T00:00"]) assert.equal(d.isValidYmd(bad), false, bad);
  assert.throws(() => d.addDaysYmd("2026-02-30", 1), RangeError);
  assert.throws(() => d.combineToUTC("2026-02-30", "10:00"), RangeError);
});

test("calendar display strings do not shift with the browser timezone", () => {
  assert.match(d.fmtCalendarDate("2026-10-09", "en", { weekday: "short", day: "numeric", month: "short", year: "numeric" }), /Fri.*Oct.*9.*2026/);
  assert.match(d.fmtCalendarDate("2026-11-15", "en", { month: "long", year: "numeric" }), /November.*2026/);
});

test("clinicLocalToUtc is zone-generic (DST day is 23h in New York) — ready for a per-clinic timezone", () => {
  const start = d.clinicLocalToUtc("2026-03-08", "00:00", "America/New_York");
  const next = d.clinicLocalToUtc("2026-03-09", "00:00", "America/New_York");
  assert.equal((next - start) / 36e5, 23);
});
