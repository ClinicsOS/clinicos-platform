/* Phase 7 — shared helpers for the integration / clock / security suites.
 * The server under test is the COMPILED backEnd (dist/), started as its own process with TZ=UTC (what production runs in — a defect that
 * only shows when the server's own timezone is not Amman must not hide behind the sandbox's local zone).
 * Needs: `npm run build`, a MongoDB-protocol server on P10_MONGO (default 127.0.0.1:27017). On FerretDB the two TEST-ONLY engines below
 * are required (aggregation operators + $expr); on real MongoDB run with AGG_EMULATOR=0 EXPR_SHIM=0 and no --require. */
const path = require("path");
const { boot } = require("../phase10/lib.js");
const tests = path.resolve(__dirname, "..");
const EMU = path.join(tests, "analytics", "agg-emulator.js");
const SHIM = path.join(__dirname, "expr-shim.js");
const FAKE = path.join(tests, "walk-in", "fake-clock.js");

/** boot() with the production-like environment; `fakeNow` shifts the server clock (ISO instant). */
async function boot7({ name, port, fakeNow, env = {} }) {
  process.env.P10_OUT = process.env.P10_OUT || require("os").tmpdir();
  const reqs = process.env.AGG_EMULATOR === "0" ? [] : [EMU, SHIM];
  if (fakeNow) reqs.unshift(FAKE);
  const t = await boot({ name, port, env: { TZ: "UTC", NODE_OPTIONS: reqs.map((r) => `--require ${r}`).join(" "), ...(fakeNow ? { FAKE_NOW: fakeNow } : {}), ...env } });
  t.tz = require(`${t.D}/utils/timezone`);
  // The shared helper numbers patients from a global counter (100, 102, …). The server now numbers by max(fileNumber)+1 like production, so a
  // helper-made patient must take the clinic's real next number too, or a later API-made patient would collide with the helper's counter.
  const baseMkPatient = t.mkPatient;
  t.mkPatient = async (c, name, phone, extra = {}) => {
    const last = await t.m.Patient.findOne({ clinicId: c._id }).sort({ fileNumber: -1 }).select("fileNumber").lean();
    return baseMkPatient(c, name, phone, { fileNumber: (last ? last.fileNumber : 0) + 1, ...extra });
  };
  t.api = (method, url, token, body, opts = {}) => t.http(method, url, { token, body, ...opts });
  /** Three-decimal comparison for money. */
  t.near = (a, b) => typeof a === "number" && Math.abs(a - b) < 0.0006;
  t.money = (a, b, label, extra) => t.ok(t.near(a, b), label, { got: a, want: b, ...(extra || {}) });
  /** A body that must never contain these strings (a number formatting failure shows up as NaN / Infinity / undefined text). */
  t.clean = (res, label) => t.ok(res.status === 200 && !/\bNaN\b|\bInfinity\b|\bundefined\b/.test(res.text), label, { status: res.status, bad: (res.text.match(/.{0,40}(NaN|Infinity|undefined).{0,20}/) || [])[0] });
  return t;
}
const wh = (from = "08:00", to = "20:00") => [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, from, to }));
module.exports = { boot7, wh };
