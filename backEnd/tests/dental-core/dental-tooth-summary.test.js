/* Dental Chart — per-tooth Treatment Summary: server-side guarantees.
   The hover/details summary is built in the browser from the ALREADY-EXISTING Treatment Plan read (GET .../treatment-plan). This feature
   adds no endpoint and no field; these checks pin that the one read it relies on stays tenant-safe, patient-scoped and role-gated, and
   that tooth numbers are exact FDI strings (so 16 can never be confused with 15 / 116 / primary 56).
     npm run build && node tests/dental-core/dental-tooth-summary.test.js
   Same harness / environment as dental-sync.test.js (tests/phase10/lib.js). */
const { boot } = require("../phase10/lib");

(async () => {
  const t = await boot({ name: "dental_tooth_summary", port: 5302 });
  const { ok, eq, http } = t;

  const A = await t.mkClinic("ts-a", { specialty: "dentistry", plan: "pro" });
  const B = await t.mkClinic("ts-b", { specialty: "dentistry", plan: "pro" });
  const G = await t.mkClinic("ts-g", { specialty: "general", plan: "pro" });
  const docA = await t.mkUser(A, "doctor");
  const recA = await t.mkUser(A, "receptionist");
  const ownerB = await t.mkUser(B, "owner");
  const ownerG = await t.mkUser(G, "owner");
  const tkDoc = t.tok(docA), tkRec = t.tok(recA), tkB = t.tok(ownerB), tkG = t.tok(ownerG);
  const p1 = await t.mkPatient(A, "Patient One");
  const p2 = await t.mkPatient(A, "Patient Two");
  const pB = await t.mkPatient(B, "Other Clinic Patient");
  const base = (p) => `/dental/patients/${p._id}`;
  const add = (p, body, token) => http("POST", `${base(p)}/treatment-plan/items`, { token, body });
  const read = (p, token, q = "") => http("GET", `${base(p)}/treatment-plan${q}`, { token });
  const tooth = (fdi, code = "crown") => ({ procedureCode: code, targetType: "tooth", toothNumbers: [fdi] });

  // same tooth number (16) in three places: patient one, patient two (same clinic), and another clinic's patient
  eq((await add(p1, tooth("16"), tkDoc)).status, 201, "A1 patient one: Crown on 16");
  eq((await add(p1, { procedureCode: "filling", targetType: "surface", toothNumbers: ["15"], surfaces: ["M"] }, tkDoc)).status, 201, "A2 patient one: Filling on 15 (the neighbour)");
  eq((await add(p2, tooth("16", "extraction"), tkDoc)).status, 201, "A3 patient two (same clinic): Extraction on 16");
  const xB = await add(pB, tooth("16", "root_canal"), tkB);
  eq(xB.status, 201, "A4 other clinic: Root Canal on 16");

  /* ---- the read the summary depends on: scoped by patient, then by clinic ---- */
  const r1 = await read(p1, tkDoc);
  eq(r1.status, 200, "B1 the plan read works");
  const on16 = r1.json.items.filter((i) => i.toothNumbers.includes("16")).map((i) => i.procedureCode);
  eq(on16, ["crown"], "B2 patient one's tooth 16 holds ONLY its own treatment (never patient two's or the other clinic's)");
  ok(r1.json.items.every((i) => Array.isArray(i.toothNumbers) && i.toothNumbers.every((n) => typeof n === "string" && /^[1-8][1-8]$/.test(n))), "B3 tooth numbers are exact two-digit FDI strings");
  ok(r1.json.items.every((i) => ["planned", "in_progress", "completed", "cancelled"].includes(i.status)), "B4 statuses are the plan's own (no invented status)");
  const on15 = r1.json.items.filter((i) => i.toothNumbers.includes("15")).map((i) => i.procedureCode);
  eq(on15, ["filling"], "B5 the neighbour 15 has its own filling and none of 16's items");
  const r2 = await read(p2, tkDoc);
  eq(r2.json.items.filter((i) => i.toothNumbers.includes("16")).map((i) => i.procedureCode), ["extraction"], "B6 patient two (same clinic) sees only its own 16");

  /* ---- tenancy ---- */
  eq((await read(p1, tkB)).status, 404, "C1 another clinic's owner cannot read this patient's plan (404, no existence oracle)");
  eq((await read(pB, tkDoc)).status, 404, "C2 clinic A's doctor cannot read clinic B's patient");
  const spoof = await read(p1, tkDoc, `?clinicId=${B._id}`);
  eq(spoof.status, 200, "C3 a client-supplied clinicId query is ignored…");
  ok(!spoof.json.items.some((i) => String(i._id) === String(xB.json.item._id)), "C4 …and never exposes the other clinic's treatment");
  const spoofHdr = await http("GET", `${base(p1)}/treatment-plan`, { token: tkDoc, headers: { "x-clinic-id": String(B._id) } });
  ok(spoofHdr.status === 200 && !spoofHdr.json.items.some((i) => String(i._id) === String(xB.json.item._id)), "C5 a client-supplied clinic header is ignored too");
  eq((await read(p1, tkG)).status, 403, "C6 a non-dentistry clinic cannot use the dental API at all");
  eq((await http("GET", `${base(p1)}/treatment-plan`, { token: undefined })).status, 401, "C7 anonymous is refused");

  /* ---- roles: reading is unchanged (any role of the clinic), writing stays clinical-only ---- */
  eq((await read(p1, tkRec)).status, 200, "D1 the receptionist can still read (unchanged rule)");
  eq((await add(p1, tooth("21"), tkRec)).status, 403, "D2 …but still cannot create a treatment");

  /* ---- no second source / no new endpoint ---- */
  for (const url of [`${base(p1)}/teeth/16/treatments`, `${base(p1)}/teeth/16/treatment-summary`, `${base(p1)}/tooth-summary`, `/dental/treatments`]) {
    eq((await http("GET", url, { token: tkDoc })).status, 404, `E1 no extra treatment endpoint exists (${url.replace(/[0-9a-f]{24}/, ":id")})`);
  }
  const rec = await http("GET", `${base(p1)}/record`, { token: tkDoc });
  ok(rec.status === 200 && !JSON.stringify(rec.json).includes('"procedureCode"'), "E2 the chart/record read carries NO treatment items (treatments exist in one place only)");

  t.noLeaks("no response leaked internals");
  await t.finish("Dental chart — tooth treatment summary (server guarantees)");
})().catch((e) => { console.error(e); process.exit(1); });
