/* Dental clinical core — Treatment Plan / Dental Chart consistency, duplicate prevention and isolation.
   End-to-end against the COMPILED server (real HTTP, real database, nothing mocked). Reuses the project's harness
   (tests/phase10/lib.js): needs `npm run build` (dist/) and a MongoDB-protocol server.
     npm run build && node tests/dental-core/dental-sync.test.js
   Optional env: P10_MONGO (default mongodb://127.0.0.1:27017), P10_DIST, P10_OUT (where the .result.json is written).

   What "the chart and the plan agree" means on the server: there is ONE treatment entity (DentalTreatmentItem) that both
   screens read, and the clinical-event history (conditions / diagnoses) is a different, never auto-mixed record. These
   checks pin exactly that, plus the new rule that the same treatment cannot be planned twice on the same tooth. */
const path = require("path");
const { boot } = require("../phase10/lib");

(async () => {
  const t = await boot({ name: "dental_core", port: 5301 });
  const { ok, eq, http } = t;
  const { DentalTreatmentItem } = t.M("DentalTreatmentItem");
  const { DentalToothEvent } = t.M("DentalToothEvent");

  // ---- world: a dentistry clinic (+ staff of every role), a second patient, a second dentistry clinic (other tenant), a general clinic ----
  const A = await t.mkClinic("dent-a", { specialty: "dentistry", plan: "pro" });
  const B = await t.mkClinic("dent-b", { specialty: "dentistry", plan: "pro" });
  const owner = await t.mkUser(A, "owner");
  const doc = await t.mkUser(A, "doctor");
  const rec = await t.mkUser(A, "receptionist");
  const ownerB = await t.mkUser(B, "owner");
  const tk = t.tok(doc), tkOwner = t.tok(owner), tkRec = t.tok(rec), tkB = t.tok(ownerB);
  const pA = await t.mkPatient(A, "Alpha");
  const pA2 = await t.mkPatient(A, "Beta");
  const pB = await t.mkPatient(B, "Other tenant patient");
  const visit = await t.m.Appointment.create({ clinicId: A._id, doctorId: doc._id, patientId: pA._id, startAt: new Date(Date.now() + 36e5), duration: 30, status: "confirmed" });

  const base = (p) => `/dental/patients/${p._id}`;
  const plan = async (p = pA, token = tk) => (await http("GET", `${base(p)}/treatment-plan`, { token })).json;
  const record = async (p = pA, token = tk) => (await http("GET", `${base(p)}/record`, { token })).json;
  const add = (body, p = pA, token = tk) => http("POST", `${base(p)}/treatment-plan/items`, { token, body });
  const edit = (id, body, p = pA, token = tk) => http("PUT", `${base(p)}/treatment-plan/items/${id}`, { token, body });
  const act = (id, what, body = {}, p = pA, token = tk) => http("POST", `${base(p)}/treatment-plan/items/${id}/${what}`, { token, body });
  const crown = (fdi) => ({ procedureCode: "crown", targetType: "tooth", toothNumbers: [fdi] });
  const filling = (fdi, surfaces) => ({ procedureCode: "filling", targetType: "surface", toothNumbers: [fdi], surfaces });
  const active = (pl, fdi, code) => pl.items.filter((i) => i.toothNumbers.includes(fdi) && (!code || i.procedureCode === code) && (i.status === "planned" || i.status === "in_progress"));

  /* ================= A. one treatment, two screens: create + read ================= */
  const c16 = await add(crown("16"));
  eq(c16.status, 201, "A1 a Crown on 16 is created (planned)");
  eq(c16.json.item.status, "planned", "A2 …as PLANNED (intent, never performed work)");
  let pl = await plan();
  eq(active(pl, "16", "crown").length, 1, "A3 the Treatment Plan read shows it — this is the very record the Dental Chart draws from");
  eq(pl.summary.planned, 1, "A4 the plan summary counts it once");

  const f26 = await add(filling("26", ["O"]));
  eq(f26.status, 201, "A5 a Filling on 26 / Occlusal is created");
  pl = await plan();
  eq(pl.items.find((i) => i._id === f26.json.item._id).surfaces, ["O"], "A6 the surface is kept exactly (surface-level information is never lost)");

  /* ================= B. DUPLICATE PREVENTION ================= */
  const d1 = await add(crown("16"));
  eq([d1.status, d1.json.code], [409, "DUPLICATE_ITEM"], "B1 the same Crown on the same tooth is refused (409 DUPLICATE_ITEM)");
  eq(d1.json.itemId, c16.json.item._id, "B2 …and the answer points at the EXISTING item, so a client can open it instead of creating another");
  const d2 = await add(filling("26", ["O"]));
  eq([d2.status, d2.json.code], [409, "DUPLICATE_ITEM"], "B3 the same Filling on the same surface is refused");
  eq((await add(filling("26", ["M"]))).status, 201, "B4 a Filling on DIFFERENT surfaces of the same tooth is a different treatment (allowed)");
  eq((await add(crown("26"))).status, 201, "B5 a Crown on a tooth that has a Filling is a different treatment (allowed)");
  eq((await add(crown("17"))).status, 201, "B6 the same procedure on another tooth is allowed");
  eq((await add({ procedureCode: "scaling", targetType: "general" })).status, 201, "B7 whole-mouth treatments are not tooth-targeted: first Scaling…");
  eq((await add({ procedureCode: "scaling", targetType: "general" })).status, 201, "B8 …and a second one is still allowed (no tooth to double up on)");
  pl = await plan();
  eq(active(pl, "16", "crown").length, 1, "B9 after all of that there is still exactly ONE active Crown on 16");
  eq(active(pl, "26", "filling").filter((i) => i.surfaces.join("") === "O").length, 1, "B10 …and exactly one active Filling 26/O");

  // double submit / two screens saving at the same instant: exactly one survives, the rest are told so
  const burst = await Promise.all(Array.from({ length: 8 }, () => add(crown("18"))));
  const made = burst.filter((r) => r.status === 201).length, refused = burst.filter((r) => r.status === 409 && r.json.code === "DUPLICATE_ITEM").length;
  ok(made === 1 && refused === 7, "B11 eight simultaneous identical requests create exactly ONE Crown on 18", { made, refused, statuses: burst.map((r) => r.status) });
  pl = await plan();
  eq(active(pl, "18", "crown").length, 1, "B12 …and the plan really holds one (a racing duplicate never survives)");
  const survivor = burst.find((r) => r.status === 201);
  ok(burst.filter((r) => r.status === 409).every((r) => r.json.itemId === survivor.json.item._id), "B13 every loser is pointed at the survivor");

  /* ================= C. completed / cancelled history never blocks a new treatment ================= */
  const x = await add(crown("27")); const xid = x.json.item._id;
  eq((await act(xid, "cancel", { reason: "changed mind" })).status, 200, "C1 a Crown is cancelled");
  eq((await add(crown("27"))).status, 201, "C2 the same Crown can be planned again after the first was cancelled");
  pl = await plan();
  eq(pl.items.filter((i) => i.toothNumbers.includes("27")).map((i) => i.status).sort(), ["cancelled", "planned"], "C3 the cancelled one stays in the history (nothing deleted) next to the new one");
  const y = await add(crown("28")); const yid = y.json.item._id;
  eq((await act(yid, "start", { appointmentId: String(visit._id) })).status, 201, "C4 a Crown is started in a visit");
  eq((await add(crown("28"))).status, 409, "C5 an IN-PROGRESS treatment still blocks its twin");
  eq((await act(yid, "complete", { appointmentId: String(visit._id) })).status, 200, "C6 …and is completed");
  eq((await add(crown("28"))).status, 201, "C7 a COMPLETED Crown does not block planning another one later");

  /* ================= D. edits keep ONE treatment (no ghost, no duplicate) ================= */
  const e = await add(crown("36")); const eid = e.json.item._id;
  let r = await edit(eid, { procedureCode: "filling", targetType: "surface", toothNumbers: ["36"], surfaces: ["O"] });
  eq(r.status, 200, "D1 Crown → Filling on the same item");
  pl = await plan();
  eq([active(pl, "36", "crown").length, active(pl, "36", "filling").length, pl.items.filter((i) => i.toothNumbers.includes("36")).length], [0, 1, 1], "D2 no ghost Crown, no duplicate Filling: ONE item, now a Filling");
  r = await edit(eid, { procedureCode: "crown", targetType: "tooth", toothNumbers: ["36"], surfaces: [] });
  eq(r.status, 200, "D3 Filling → Crown");
  pl = await plan();
  eq([active(pl, "36", "crown").length, active(pl, "36", "filling").length, pl.items.filter((i) => i.toothNumbers.includes("36")).length], [1, 0, 1], "D4 the Filling is gone, the Crown is there, still ONE item (surfaces cleared)");
  eq(pl.items.find((i) => i._id === eid).surfaces, [], "D5 a whole-tooth Crown carries no surfaces");
  r = await edit(eid, { toothNumbers: ["37"] });
  eq(r.status, 200, "D6 the treatment is moved to another tooth");
  pl = await plan();
  eq([active(pl, "36").length, active(pl, "37", "crown").length], [0, 1], "D7 the OLD tooth is clear, the NEW tooth has it");
  const s = await add(filling("46", ["M"])); const sid = s.json.item._id;
  r = await edit(sid, { surfaces: ["D", "O"] });
  eq(r.status, 200, "D8 the surfaces of a Filling are changed");
  pl = await plan();
  eq(pl.items.find((i) => i._id === sid).surfaces, ["D", "O"], "D9 the new surfaces (canonical order), the old one is gone");
  eq((await edit(eid, { toothNumbers: ["16"] })).json.code, "DUPLICATE_ITEM", "D10 moving a Crown onto a tooth that already has the same planned Crown is refused");
  eq((await edit(sid, { surfaces: ["O"] }, pA)).status, 200, "D11 …while an edit that creates no twin is fine");
  eq((await edit(eid, { notes: "keep" })).status, 200, "D12 editing only notes / price never trips the duplicate rule");

  /* ================= E. status changes are one record read by both screens ================= */
  const z = await add(filling("47", ["O"])); const zid = z.json.item._id;
  eq((await act(zid, "start", { appointmentId: String(visit._id) })).status, 201, "E1 start (in progress)");
  eq((await edit(zid, { toothNumbers: ["48"] })).json.code, "ITEM_LOCKED", "E2 once started, tooth / surfaces can no longer be rewritten under the chart's feet");
  pl = await plan();
  eq(pl.items.find((i) => i._id === zid).status, "in_progress", "E3 the plan shows in_progress");
  eq((await act(zid, "complete", { appointmentId: String(visit._id) })).status, 200, "E4 complete");
  pl = await plan();
  eq(pl.items.find((i) => i._id === zid).status, "completed", "E5 the plan shows completed");
  eq(pl.summary.completed >= 2, true, "E6 the summary counts agree with the items");
  eq((await edit(zid, { notes: "x" })).json.code, "ITEM_LOCKED", "E7 completed treatment is read-only (history is never silently rewritten)");
  eq((await act(zid, "cancel")).status, 409, "E8 a completed treatment cannot be cancelled");
  const cc = pl.items.filter((i) => i.status === "cancelled").length;
  eq(pl.summary.cancelled, cc, "E9 cancelled items stay listed and counted (medical history is preserved)");

  /* ================= F. a CONDITION is not a TREATMENT (and the other way round) ================= */
  const before = (await plan()).items.length;
  const evBefore = (await record()).events.length;
  eq((await http("POST", `${base(pA)}/teeth/38/diagnoses`, { token: tk, body: { code: "caries", surfaces: ["O"] } })).status, 201, "F1 a Caries diagnosis is recorded");
  eq((await http("POST", `${base(pA)}/teeth/38/conditions`, { token: tk, body: { code: "existing_crown" } })).status, 201, "F2 an Existing Crown is recorded");
  eq((await plan()).items.length, before, "F3 neither created a treatment (a diagnosis does not decide Filling / Crown / Root Canal for the doctor)");
  await add(crown("35"));
  eq((await record()).events.length, evBefore + 2, "F4 creating a treatment wrote NOTHING into the clinical-event history (no second source of truth, no sync loop possible)");
  eq(await DentalToothEvent.countDocuments({ clinicId: A._id, patientId: pA._id, fdi: "35" }), 0, "F5 …verified in the database as well");
  const dx = (await record()).events.find((v) => v.fdi === "38" && v.code === "caries");
  const srcItem = await add({ ...crown("38"), sourceDiagnosisIds: [dx._id] });
  eq(srcItem.status, 201, "F6 the doctor MAY plan a Crown from that diagnosis (provenance only)…");
  eq((await record()).events.find((v) => v._id === dx._id).status, "active", "F7 …and the diagnosis itself is untouched");

  /* ================= G. isolation: patient / clinic ================= */
  pl = await plan(pA2);
  eq(pl.items.length, 0, "G1 another patient of the SAME clinic sees none of these treatments");
  eq((await add(crown("16"), pA2)).status, 201, "G2 …and can have their own Crown on 16 (the duplicate rule is per patient)");
  eq((await plan(pA)).items.filter((i) => i.toothNumbers.includes("16") && i.procedureCode === "crown").length, 1, "G3 …without touching patient 1's");
  eq((await http("GET", `${base(pA)}/treatment-plan`, { token: tkB })).status, 404, "G4 another clinic cannot read this patient's plan (404, same as 'not found')");
  eq((await add(crown("11"), pA, tkB)).status, 404, "G5 …nor create a treatment for them");
  eq((await edit(c16.json.item._id, { notes: "hacked" }, pB, tkB)).status, 404, "G6 an item id from another clinic is not reachable through your own patient");
  eq((await edit(c16.json.item._id, { notes: "hacked" }, pA2, tk)).status, 404, "G7 an item id from another patient is not reachable through a different patient of your clinic");
  eq((await http("GET", `${base(pB)}/treatment-plan`, { token: tk })).status, 404, "G8 clinic A cannot read clinic B's patient either");
  eq((await add(crown("16"), pB, tkB)).status, 201, "G9 clinic B has its own world: Crown on 16 is fine there");

  /* ================= H. permissions are exactly what they were ================= */
  eq((await add(crown("12"), pA, tkRec)).status, 403, "H1 a receptionist still cannot create a treatment");
  eq((await http("GET", `${base(pA)}/treatment-plan`, { token: tkRec })).status, 200, "H2 …but still can read the plan");
  eq((await add(crown("12"), pA, tkOwner)).status, 201, "H3 an owner can");
  eq((await http("GET", `${base(pA)}/treatment-plan`, { token: undefined })).status, 401, "H4 anonymous is refused");

  /* ================= I. data that already exists keeps loading (legacy duplicates from before this rule) ================= */
  const plain = await DentalTreatmentItem.findOne({ clinicId: A._id, patientId: pA._id, procedureCode: "crown", toothNumbers: "12" });
  const legacy = await DentalTreatmentItem.create({
    clinicId: A._id, patientId: pA._id, planId: plain.planId, procedureCode: "crown", catalogVersion: 1, targetType: "tooth", toothNumbers: ["12"], surfaces: [],
    status: "planned", priority: "normal", phase: 1, dentitionType: "permanent", statusHistory: [{ status: "planned", at: new Date(), by: doc._id }], createdBy: doc._id,
  });
  pl = await plan();
  eq(active(pl, "12", "crown").length, 2, "I1 a pre-existing duplicate (created before the rule existed) still loads");
  eq((await act(String(legacy._id), "cancel", { reason: "duplicate" })).status, 200, "I2 …and can be cleaned up with the normal Cancel (history kept)");
  eq(active(await plan(), "12", "crown").length, 1, "I3 one remains");

  /* ================= J. the visit view reads the same records ================= */
  const vt = await http("GET", `${base(pA)}/visits/${visit._id}/treatments`, { token: tk });
  eq(vt.status, 200, "J1 the visit's Dental section loads");
  ok(vt.json.pending.every((i) => i.status === "planned" || i.status === "in_progress"), "J2 it lists only active items");
  ok(!vt.json.pending.some((i) => i.status === "cancelled"), "J3 …never a cancelled one");

  t.noLeaks("no response leaked internals");
  await t.finish("Dental core — Treatment Plan / Chart consistency");
})().catch((e) => { console.error(e); process.exit(1); });
