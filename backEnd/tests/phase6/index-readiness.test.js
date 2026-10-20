/* PHASE 6 — the production index-readiness tool (dist/scripts/indexReadiness.js).
   Run:  cd backEnd && npx tsc -p . && node tests/phase6/index-readiness.test.js     (needs a MongoDB-protocol server on 127.0.0.1:27017, e.g. FerretDB)
   Proves: report-only writes NOTHING; --create is refused without the typed database name and after a failed duplicate preflight;
   a counter BEHIND the highest invoice number is detected; the tool never prints the connection string; it never deletes a document. */
const { spawnSync } = require("child_process");
const path = require("path");
const mongoose = require(path.resolve(__dirname, "../../node_modules/mongoose"));
const BASE = (process.env.P10_MONGO || "mongodb://127.0.0.1:27017").replace(/\/$/, "");
const DB = `p6_idx_${Date.now()}`;
const URI = `${BASE}/${DB}`;
const SCRIPT = path.resolve(__dirname, "../../dist/scripts/indexReadiness.js");
let pass = 0, fail = 0; const failures = [];
const ok = (c, label, extra) => { if (c) pass++; else { fail++; failures.push(label + (extra ? " :: " + String(extra).slice(0, 300) : "")); } };
const run = (...args) => spawnSync("node", [SCRIPT, ...args], { env: { ...process.env, MONGO_URI: URI }, encoding: "utf8" });

(async () => {
  await mongoose.connect(URI);
  const col = (n) => mongoose.connection.collection(n);
  const clinic = new mongoose.Types.ObjectId(), clinic2 = new mongoose.Types.ObjectId();
  await col("invoices").insertMany([{ clinicId: clinic, invoiceNumber: 1 }, { clinicId: clinic, invoiceNumber: 7 }, { clinicId: clinic2, invoiceNumber: 3 }]);
  await col("invoicecounters").insertMany([{ clinicId: clinic, seq: 5 }, { clinicId: clinic2, seq: 3 }]);
  const snapshot = async () => ({ inv: await col("invoices").countDocuments(), ctr: await col("invoicecounters").countDocuments(), seq: (await col("invoicecounters").find({}).sort({ seq: 1 }).toArray()).map((c) => c.seq).join(","), idx: (await col("invoices").indexes()).length });

  const before = await snapshot();
  const r1 = run();
  const after = await snapshot();
  ok(r1.status === 2, "T1 report-only exits 2 when a counter is behind", r1.status + " " + r1.stderr);
  ok(/REPORT ONLY \(nothing is written\)/.test(r1.stdout), "T2 states that it is report-only");
  ok(/counter BEHIND the highest number: 1/.test(r1.stdout), "T3 detects the counter that is behind the highest invoice number (5 < 7)", r1.stdout.slice(-400));
  ok(/clinics with invoices: 2/.test(r1.stdout), "T4 counts clinics with invoices");
  ok(JSON.stringify(before) === JSON.stringify(after), "T5 report-only changed no document / counter value (and built no index on invoices)", JSON.stringify({ before, after }));
  ok(!r1.stdout.includes(URI) && !r1.stdout.includes("mongodb://") && !r1.stderr.includes("mongodb://"), "T6 never prints the connection string");
  ok(r1.stdout.includes(`database "${DB}"`), "T7 prints the database NAME so the operator can see what it points to");
  ok(/PatientDoctorAccess/.test(r1.stdout) && /DentalTreatmentItem/.test(r1.stdout) && /InvoiceCounter/.test(r1.stdout), "T8 covers the Phase 1–5 collections");
  ok(/REQUIRED BEFORE DEPLOY/.test(r1.stdout) && /SAFE DURING DEPLOY/.test(r1.stdout), "T9 labels every collection REQUIRED / SAFE");

  const r2 = run("--create");
  ok(r2.status === 1 && /--create needs --confirm-db/.test(r2.stderr), "T10 --create is refused without --confirm-db", r2.stderr);
  const r3 = run("--create", "--confirm-db", "some_other_db");
  ok(r3.status === 1 && /--create needs --confirm-db/.test(r3.stderr), "T11 --create is refused when the typed database name differs", r3.stderr);
  ok(JSON.stringify(await snapshot()) === JSON.stringify(before), "T12 refused runs changed nothing");

  // duplicate preflight: two invoices with the same number in one clinic => FAIL + --create refused, nothing deleted
  await col("invoices").insertOne({ clinicId: clinic2, invoiceNumber: 3 });
  const r4 = run();
  ok(/FAIL Invoice \{clinicId, invoiceNumber\}: 1 duplicate group/.test(r4.stdout), "T13 a duplicate invoice number is reported by the preflight", r4.stdout.slice(0, 900));
  const r5 = run("--create", "--confirm-db", DB);
  ok(r5.status === 1 && /Refusing to build indexes: a duplicate preflight failed/.test(r5.stderr), "T14 --create refuses to build indexes while a duplicate exists", r5.stderr);
  ok((await col("invoices").countDocuments()) === 4, "T15 the duplicate was NOT deleted (the tool never deletes data)");

  // consistent counters => no 'behind'
  await col("invoices").deleteOne({ clinicId: clinic2, invoiceNumber: 3 }); // remove one of the two duplicates (test fixture only)
  await col("invoicecounters").updateOne({ clinicId: clinic }, { $set: { seq: 7 } });
  const r6 = run();
  ok(/counter BEHIND the highest number: 0/.test(r6.stdout), "T16 counters at/above the highest number are reported consistent", r6.stdout.slice(-300));

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  console.log(`\nindex-readiness: ${pass} passed, ${fail} failed`);
  if (fail) console.log("FAILED:\n - " + failures.join("\n - "));
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error("CRASH", e); try { await mongoose.connection.dropDatabase(); } catch {} process.exit(2); });
