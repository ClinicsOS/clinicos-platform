/* PHASE 5 — DENTAL CHART V2 · MULTI / SERIAL TEETH + SURFACES (backend half). End-to-end against the COMPILED server (real HTTP, real database,
   nothing mocked). The chart derivation (planVisual.ts) is the SAME pure module the Dental Chart imports, so "2D / 3D show it" is verified from the very
   payload the server returns.
     npm run build && node tests/dental/dental-chart-v2.test.js
   Optional env: P10_MONGO (default mongodb://127.0.0.1:27017), P10_DIST, P10_OUT.

   Tagged with the Phase 5 specification numbers:
     26 eligible treatment can select several teeth      27 the teeth persist           28 the Treatment Plan lists all of them
     29 2D shows all   30 3D shows all (one shared derivation)   31 editing updates the SAME record   32 removing one tooth keeps the rest
     33 adding a tooth does not duplicate   34 rapid Save creates no duplicate   35 unauthorized doctor denied   36 delegated doctor allowed
     37 revoked delegation blocks   38 invalid tooth numbers rejected   39 single-tooth treatments stay valid   40 Phase 4 duplicate protection intact
   Surfaces:  11 D/O persists · 12 MOD persists · 13 surface edit updates the same record · 16 stored surface data stays compatible
   Extra groups: S (per-tooth surfaces) · M (targeting strategy / catalog) · P (primary + mixed dentition) · L (legacy record compatibility). */
const path = require("path");
const { pathToFileURL } = require("url");
const { boot } = require("../phase10/lib");
const DIST = process.env.P10_DIST || path.resolve(__dirname, "../../dist");
const FE = path.resolve(__dirname, "../../../frontEnd/src");

(async () => {
  const planVisual = await import(pathToFileURL(path.join(FE, "lib/dental/planVisual.ts")).href);
  const toothStates = await import(pathToFileURL(path.join(FE, "lib/dental/toothStates.ts")).href);
  const chartOf = (items) => planVisual.applyPlanToVisual({}, items, toothStates.emptyVisualState);
  const cat = require(path.join(DIST, "config/dentalProcedures.js"));

  const t = await boot({ name: "dental_chart_v2", port: 5822, env: { NODE_OPTIONS: `--require ${path.join(__dirname, "../multi-doctor/ferret-date-shim.js")} --require ${path.join(__dirname, "../analytics/agg-emulator.js")} --require ${path.join(__dirname, "../phase7/expr-shim.js")}` } });
  const { ok, eq, http } = t;
  const { DentalTreatmentItem } = t.M("DentalTreatmentItem");
  const sid = (x) => String(x._id);
  const api = (method, url, token, body) => http(method, url, { token, body });
  const wh = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, isOpen: true, from: "09:00", to: "17:00" }));

  const A = await t.mkClinic("v2-a", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const B = await t.mkClinic("v2-b", { specialty: "dentistry", plan: "pro", workingHours: wh, slotDuration: 30 });
  const owner = await t.mkUser(A, "owner"), docX = await t.mkUser(A, "doctor", 1), docY = await t.mkUser(A, "doctor", 2);
  const ownerB = await t.mkUser(B, "owner");
  const tkO = t.tok(owner), tkX = t.tok(docX), tkY = t.tok(docY), tkOB = t.tok(ownerB);

  const reg = async (tk, name, phone) => (await api("POST", "/patients", tk, { fullName: name, phone })).json;
  const pX = await reg(tkX, "Vera Multi", "0791600001");
  const pKid = await reg(tkX, "Kareem Primary", "0791600002");
  const pMix = await reg(tkX, "Mona Mixed", "0791600003");
  const base = (p) => `/dental/patients/${sid(p)}`;
  const plan = async (p = pX, token = tkX) => (await api("GET", `${base(p)}/treatment-plan`, token)).json;
  const add = (body, p = pX, token = tkX) => api("POST", `${base(p)}/treatment-plan/items`, token, body);
  const edit = (id, body, p = pX, token = tkX) => api("PUT", `${base(p)}/treatment-plan/items/${id}`, token, body);
  const act = (id, what, body = {}, p = pX, token = tkX) => api("POST", `${base(p)}/treatment-plan/items/${id}/${what}`, token, body);
  const count = (filter) => DentalTreatmentItem.countDocuments(filter);
  const rowOf = (id) => DentalTreatmentItem.findById(id).lean();
  const teeth = (item) => [...item.toothNumbers];

  /* ---------- M · the catalog: which procedures accept which target shapes ---------- */
  const byCode = Object.fromEntries(cat.PROCEDURES.map((p) => [p.code, p]));
  const toothLevel = ["filling", "root_canal", "extraction", "crown", "implant", "sealant", "veneer", "other"];
  ok(toothLevel.every((c) => byCode[c].targets.includes("multi_tooth")), "M1 every tooth-level procedure (filling, root canal, extraction, crown, implant, sealant, veneer, other) accepts several teeth");
  ok(["bridge", "denture", "scaling", "whitening"].every((c) => byCode[c].targets.includes("multi_tooth")), "M2 bridge / denture / scaling / whitening accept several teeth too");
  eq(byCode.bridge.targets, ["multi_tooth"], "M3 a bridge is still multi-tooth only (one abutment is not a bridge)");
  eq(["scaling", "whitening", "denture"].map((c) => byCode[c].defaultTarget), ["general", "general", "general"], "M4 whole-mouth procedures still DEFAULT to general (no tooth forced on them)");
  eq(cat.PROCEDURES.filter((p) => p.surfaceCapable).map((p) => p.code).sort(), ["filling", "other", "sealant"], "M5 only filling / sealant / other are surface-capable");
  const upper = ["11", "12", "13", "14", "15", "16", "17", "18", "21", "22", "23", "24", "25", "26", "27", "28"];
  const lower = ["31", "32", "33", "34", "35", "36", "37", "38", "41", "42", "43", "44", "45", "46", "47", "48"];
  eq([cat.deriveTargetMode("multi_tooth", upper, "permanent"), cat.deriveTargetMode("multi_tooth", lower, "permanent"), cat.deriveTargetMode("multi_tooth", ["11", "12"], "permanent")], ["arch", "arch", "multi_tooth"], "M6 targeting strategy: a whole arch is 'arch', a selection of teeth is 'multi_tooth'");
  eq([cat.deriveTargetMode("tooth", ["11"]), cat.deriveTargetMode("surface", ["26"]), cat.deriveTargetMode("general", [])], ["single_tooth", "single_tooth", "general"], "M7 …one tooth (± surfaces) is 'single_tooth', no tooth is 'general'");
  eq(cat.deriveTargetMode("multi_tooth", ["51", "52", "53", "54", "55", "61", "62", "63", "64", "65"], "primary"), "arch", "M8 a primary upper arch is recognised as an arch");

  /* ---------- 26 / 27 / 28 · serial teeth for every eligible treatment ---------- */
  const serial = ["11", "12", "13", "14"];
  const created = {};
  for (const code of ["filling", "root_canal", "extraction", "crown", "implant", "sealant", "veneer", "bridge", "scaling", "whitening", "denture"]) {
    const body = { procedureCode: code, targetType: "multi_tooth", toothNumbers: serial, ...(code === "filling" || code === "sealant" ? { surfaces: ["O"] } : {}) };
    const r = await add(body);
    created[code] = r.json.item;
    eq(r.status, 201, `26 ${code}: a serial selection 11,12,13,14 is accepted (201)`);
  }
  const oth = await add({ procedureCode: "other", customName: "Fluoride varnish", targetType: "multi_tooth", toothNumbers: ["21", "22", "23"] });
  eq(oth.status, 201, "26 'other' accepts several teeth");
  eq((await rowOf(created.crown._id)).toothNumbers, serial, "27 the four teeth are stored intact, in order, on ONE record");
  eq((await rowOf(created.crown._id)).targetType, "multi_tooth", "27b targetType is multi_tooth");
  eq(await count({ clinicId: A._id, patientId: pX._id, procedureCode: "crown" }), 1, "27c ONE record — not four (one per tooth)");
  const p1 = await plan();
  eq(p1.items.find((i) => i._id === created.crown._id).toothNumbers, serial, "28 the Treatment Plan lists all four teeth on that one item");
  const view = chartOf(p1.items);
  ok(serial.every((f) => view[f] && view[f].treatments.some((x) => x.kind === "crown" && x.status === "planned")), "29/30 a serial CROWN is drawn on all four teeth by the shared 2D/3D derivation", Object.keys(view));
  ok(serial.every((f) => view[f].treatments.some((x) => x.kind === "filling" && x.surfaces.join() === "O")), "29/30b a serial FILLING (O) is drawn on all four teeth", view["12"]);
  ok(!view["15"], "29/30c and not on a tooth that was not selected");

  /* ---------- 11 / 12 / 13 · surfaces ---------- */
  const s1 = await add({ procedureCode: "filling", targetType: "surface", toothNumbers: ["26"], surfaces: ["D", "O"] });
  eq((await rowOf(s1.json.item._id)).surfaces, ["D", "O"], "11 D+O persists in canonical order (D, O)");
  const s2 = await add({ procedureCode: "filling", targetType: "surface", toothNumbers: ["36"], surfaces: ["O", "D", "M"] });
  eq((await rowOf(s2.json.item._id)).surfaces, ["M", "D", "O"], "12 MOD persists (input order O,D,M -> canonical M,D,O)");
  const s1e = await edit(s1.json.item._id, { surfaces: ["M", "D", "O"], toothNumbers: ["26"], targetType: "surface", procedureCode: "filling" });
  eq([s1e.status, s1e.json.item._id, s1e.json.item.surfaces], [200, s1.json.item._id, ["M", "D", "O"]], "13 a surface edit (DO -> MOD) updates the SAME record");
  eq(await count({ clinicId: A._id, patientId: pX._id, toothNumbers: "26" }), 1, "13b …and creates no duplicate");

  /* ---------- 31 / 32 / 33 · editing a serial treatment ---------- */
  const ser = (await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["31", "32", "33", "34"] })).json.item;
  const total0 = await count({ clinicId: A._id, patientId: pX._id });
  const e31 = await edit(ser._id, { targetType: "multi_tooth", toothNumbers: ["31", "32", "33", "41"] });
  eq([e31.status, e31.json.item._id], [200, ser._id], "31 editing the teeth (remove 34, add 41) updates the SAME record");
  eq(e31.json.item.toothNumbers, ["31", "32", "33", "41"], "31b the new set is stored sorted");
  eq(await count({ clinicId: A._id, patientId: pX._id }), total0, "33 adding a tooth created no new record");
  const afterEdit = chartOf((await plan()).items);
  ok(!!afterEdit["41"] && afterEdit["41"].treatments.some((x) => x.kind === "crown"), "31c the chart derivation follows: 41 gained the crown");
  ok(!(afterEdit["34"] && afterEdit["34"].treatments.length), "32 the removed tooth (34) no longer has the crown");
  ok(["31", "32", "33"].every((f) => afterEdit[f].treatments.some((x) => x.kind === "crown")), "32b the remaining teeth keep it");
  const e32 = await edit(ser._id, { targetType: "multi_tooth", toothNumbers: ["31"] });
  eq(e32.status, 400, "32c shrinking a multi-tooth treatment to ONE tooth as multi_tooth is refused (it needs two) …");
  eq((await rowOf(ser._id)).toothNumbers, ["31", "32", "33", "41"], "32d …and the record is unchanged");
  const e32b = await edit(ser._id, { targetType: "tooth", toothNumbers: ["31"] });
  eq([e32b.status, e32b.json.item._id, e32b.json.item.toothNumbers, e32b.json.item.targetType], [200, ser._id, ["31"], "tooth"], "32e …but converting it to a single-tooth treatment keeps the SAME record with the remaining tooth");

  /* ---------- 34 · rapid Save ---------- */
  const rapidBody = { procedureCode: "root_canal", targetType: "multi_tooth", toothNumbers: ["45", "46", "47"], requestId: "v2-rapid-save-001" };
  const burst = await Promise.all([1, 2, 3, 4, 5].map(() => add(rapidBody)));
  eq(await count({ clinicId: A._id, patientId: pX._id, toothNumbers: "45" }), 1, "34 five simultaneous Saves of the same serial selection create ONE record");
  ok(burst.filter((r) => r.status === 201).length === 1 && new Set(burst.map((r) => r.json.item && r.json.item._id)).size === 1, "34b …and every response carries the same id", burst.map((r) => r.status));
  const burstNoKey = await Promise.all([1, 2, 3].map(() => add({ procedureCode: "extraction", targetType: "multi_tooth", toothNumbers: ["18", "28", "38", "48"] })));
  eq(await count({ clinicId: A._id, patientId: pX._id, toothNumbers: "48", procedureCode: "extraction" }), 1, "34c …also without a request id (Phase 4 atomic twin key)");
  ok(burstNoKey.filter((r) => r.status === 201).length === 1, "34d exactly one answers 201", burstNoKey.map((r) => r.status));

  /* ---------- 40 · Phase 4 duplicate protection ---------- */
  const dup = await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["11", "12", "13", "14"] });
  eq([dup.status, dup.json.code], [409, "DUPLICATE_ITEM"], "40 an identical ACTIVE serial treatment is refused (409 DUPLICATE_ITEM)");
  const near = await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["11", "12", "13", "15"] });
  eq(near.status, 201, "40b a DIFFERENT tooth set is a different treatment (allowed)");
  const intoTwin = await edit(near.json.item._id, { targetType: "multi_tooth", toothNumbers: ["11", "12", "13", "14"] });
  eq([intoTwin.status, intoTwin.json.code], [409, "DUPLICATE_ITEM"], "40c editing a serial treatment INTO an identical active one is refused");

  /* ---------- S · per-tooth surfaces ---------- */
  const mixSurf = await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["16", "17", "18"], toothSurfaces: { 16: ["O"], 17: ["O", "M"], 18: ["D"] } });
  eq(mixSurf.status, 201, "S1 a serial filling with DIFFERENT surfaces per tooth is accepted");
  const msRow = await rowOf(mixSurf.json.item._id);
  eq(msRow.toothSurfaces, { 16: ["O"], 17: ["M", "O"], 18: ["D"] }, "S2 the per-tooth map is stored (canonical surface order)");
  eq(msRow.surfaces, ["M", "D", "O"], "S3 `surfaces` is the UNION (what every report / invoice line already reads)");
  eq(mixSurf.json.item.toothSurfaces, { 16: ["O"], 17: ["M", "O"], 18: ["D"] }, "S4 the API returns the map");
  const mv = chartOf((await plan()).items);
  eq([16, 17, 18].map((f) => mv[f].treatments.find((x) => x.kind === "filling").surfaces), [["O"], ["M", "O"], ["D"]], "S5 the shared 2D/3D derivation gives EACH tooth its own surfaces");
  const sharedSurf = await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["24", "25"], surfaces: ["O", "D"] });
  eq([sharedSurf.status, (await rowOf(sharedSurf.json.item._id)).surfaces, (await rowOf(sharedSurf.json.item._id)).toothSurfaces], [201, ["D", "O"], undefined], "S6 the SAME surfaces on every tooth are stored once, with no per-tooth map");
  const collapsed = await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["34", "35"], toothSurfaces: { 34: ["O", "M"], 35: ["M", "O"] } });
  eq([(await rowOf(collapsed.json.item._id)).surfaces, (await rowOf(collapsed.json.item._id)).toothSurfaces], [["M", "O"], undefined], "S7 a per-tooth map whose lists are all identical collapses to plain shared surfaces (one canonical shape)");
  const wholeTooth = await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["44", "45"] });
  eq([wholeTooth.status, (await rowOf(wholeTooth.json.item._id)).surfaces], [201, []], "S8 a serial filling with NO surfaces (whole tooth) is allowed, like the single-tooth one");
  eq((await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["14", "15"], toothSurfaces: { 14: ["O"] } })).status, 400, "S9 a per-tooth map must cover every selected tooth (15 has none) -> 400");
  eq((await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["14", "15"], toothSurfaces: { 14: ["O"], 15: [] } })).status, 400, "S10 an empty list for a tooth -> 400");
  eq((await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["14", "15"], toothSurfaces: { 14: ["O"], 15: ["X"] } })).status, 400, "S11 an invalid surface -> 400");
  eq((await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["14", "15"], toothSurfaces: { 14: ["O"], 15: ["M"], 16: ["D"] } })).status, 400, "S12 surfaces for a tooth that is not selected -> 400");
  eq((await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["14", "15"], surfaces: ["O"] })).status, 400, "S13 a whole-tooth procedure (crown) cannot carry surfaces on several teeth -> 400");
  eq((await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["14", "15"], toothSurfaces: { 14: ["O"], 15: ["M"] } })).status, 400, "S14 …nor per-tooth surfaces");
  eq((await add({ procedureCode: "filling", targetType: "surface", toothNumbers: ["14"], surfaces: ["O"], toothSurfaces: { 14: ["O"] } })).status, 400, "S15 per-tooth surfaces on a single-tooth treatment -> 400");
  eq((await add({ procedureCode: "bridge", targetType: "multi_tooth", toothNumbers: ["14", "15", "16"], surfaces: ["O"] })).status, 400, "S16 a bridge cannot carry surfaces");
  // twin rules with maps
  const mapTwin = await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["16", "17", "18"], toothSurfaces: { 16: ["O"], 17: ["O", "M"], 18: ["D"] } });
  eq([mapTwin.status, mapTwin.json.code], [409, "DUPLICATE_ITEM"], "S17 the identical per-tooth treatment is a duplicate");
  const mapOther = await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["16", "17", "18"], toothSurfaces: { 16: ["O"], 17: ["O"], 18: ["D"] } });
  eq(mapOther.status, 201, "S18 the same teeth with DIFFERENT per-tooth surfaces is a different treatment");
  const mapShared = await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["16", "17", "18"], surfaces: ["M", "D", "O"] });
  eq(mapShared.status, 201, "S19 …and so is the same teeth with shared surfaces (the union alone is not an identity)");
  // editing
  const msEdit = await edit(mixSurf.json.item._id, { targetType: "multi_tooth", toothNumbers: ["16", "17", "18"], toothSurfaces: { 16: ["O", "D"], 17: ["M", "O"], 18: ["D"] } });
  eq([msEdit.status, msEdit.json.item._id, msEdit.json.item.toothSurfaces[16]], [200, mixSurf.json.item._id, ["D", "O"]], "S20 editing one tooth's surfaces updates the SAME record");
  const dropTooth = await edit(mixSurf.json.item._id, { targetType: "multi_tooth", toothNumbers: ["16", "17"] });
  eq([dropTooth.status, dropTooth.json.item.toothSurfaces], [200, undefined], "S21 removing a tooth WITHOUT restating the per-tooth surfaces drops the (now stale) map instead of keeping surfaces of a removed tooth");
  const dropRow = await rowOf(mixSurf.json.item._id);
  eq([dropRow.toothNumbers, dropRow.toothSurfaces === undefined || dropRow.toothSurfaces === null], [["16", "17"], true], "S21b …in the database too");
  const reMap = await edit(mixSurf.json.item._id, { toothSurfaces: { 16: ["O"], 17: ["M"] } });
  eq([reMap.status, reMap.json.item.toothSurfaces, reMap.json.item.surfaces], [200, { 16: ["O"], 17: ["M"] }, ["M", "O"]], "S22 setting ONLY the map keeps the rest of the target");
  const clearMap = await edit(mixSurf.json.item._id, { toothSurfaces: null, surfaces: ["O"] });
  eq([clearMap.status, clearMap.json.item.toothSurfaces, clearMap.json.item.surfaces], [200, undefined, ["O"]], "S23 null clears the per-tooth surfaces (shared surface O on both teeth)");
  // in-progress / completed locks still apply to a serial treatment
  const appt = await t.m.Appointment.create({ clinicId: A._id, doctorId: docX._id, patientId: pX._id, startAt: new Date(Date.now() - 36e5), duration: 30, status: "confirmed" });
  const startedSerial = (await add({ procedureCode: "veneer", targetType: "multi_tooth", toothNumbers: ["12", "11", "21", "22"] })).json.item;
  eq(startedSerial.toothNumbers, ["11", "12", "21", "22"], "S24 the serial teeth are sorted on create");
  await act(startedSerial._id, "start", { appointmentId: sid(appt) });
  eq((await edit(startedSerial._id, { targetType: "multi_tooth", toothNumbers: ["11", "12"] })).status, 409, "S25 once started, the TEETH of a serial treatment are locked (cancel + recreate, as for every treatment)");
  eq((await edit(startedSerial._id, { notes: "still editable" })).status, 200, "S26 …but notes / price / priority / phase stay editable");

  /* ---------- 38 · invalid input ---------- */
  eq((await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["11", "99"] })).status, 400, "38 an invalid FDI code in the selection -> 400");
  eq((await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["11", "55"] })).status, 400, "38b a PRIMARY code on a permanent chart -> 400 (no primary/permanent mix-up)");
  eq((await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["11", "11"] })).status, 400, "38c a duplicated tooth -> 400");
  eq((await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["11"] })).status, 400, "38d one tooth as multi_tooth -> 400");
  eq((await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: [] })).status, 400, "38e no tooth -> 400");
  eq((await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: [...upper, ...lower, "55"] })).status, 400, "38f more than 32 teeth -> 400");
  eq((await add({ procedureCode: "scaling", targetType: "general", toothNumbers: ["11"] })).status, 400, "38g a general treatment with a tooth -> 400");
  eq((await add({ procedureCode: "crown", targetType: "general" })).status, 400, "38h a crown is not a general treatment -> 400");
  const fullArch = await add({ procedureCode: "whitening", targetType: "multi_tooth", toothNumbers: upper });
  eq(fullArch.status, 201, "38i a whole arch (16 teeth) is a valid serial selection");

  /* ---------- 39 · single-tooth treatments stay valid ---------- */
  const singles = [
    await add({ procedureCode: "crown", targetType: "tooth", toothNumbers: ["27"] }),
    await add({ procedureCode: "filling", targetType: "surface", toothNumbers: ["37"], surfaces: ["O"] }),
    await add({ procedureCode: "filling", targetType: "tooth", toothNumbers: ["47"] }),
    await add({ procedureCode: "sealant", targetType: "surface", toothNumbers: ["46"], surfaces: ["O"] }),
    await add({ procedureCode: "scaling", targetType: "general" }),
  ];
  eq(singles.map((r) => r.status), [201, 201, 201, 201, 201], "39 single-tooth / surface / general treatments are still created exactly as before");
  eq((await rowOf(singles[1].json.item._id)).toothSurfaces === undefined, true, "39b …without any per-tooth map");

  /* ---------- 35 / 36 / 37 · authorization on a serial treatment ---------- */
  const target = (await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["13", "23"] })).json.item;
  const guard = async (label, token) => {
    const before = await count({ clinicId: A._id, patientId: pX._id });
    const mk = await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["14", "24"], requestId: "v2-auth-" + label }, pX, token);
    const ed = await edit(target._id, { targetType: "multi_tooth", toothNumbers: ["13", "23", "33"] }, pX, token);
    const ca = await act(target._id, "cancel", {}, pX, token);
    return { codes: [mk.status, ed.status, ca.status], same: before === (await count({ clinicId: A._id, patientId: pX._id })) };
  };
  const denied = await guard("deny", tkY);
  eq(denied.codes, [404, 404, 404], "35 a doctor with NO access cannot create / edit / cancel a serial treatment (404)");
  ok(denied.same && (await rowOf(target._id)).toothNumbers.join() === "13,23", "35b …and nothing changed");
  eq((await guard("xc", tkOB)).codes, [404, 404, 404], "35c a user of ANOTHER clinic is denied too");
  const del = await api("POST", "/patient-access/delegations", tkO, { fromDoctorId: sid(docX), toDoctorId: sid(docY), scope: "all" });
  const viaDel = await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["14", "24"], requestId: "v2-deleg-0001" }, pX, tkY);
  eq(viaDel.status, 201, "36 a delegated doctor CAN create a serial treatment while the delegation is active");
  eq((await edit(viaDel.json.item._id, { targetType: "multi_tooth", toothNumbers: ["14", "24", "34"] }, pX, tkY)).status, 200, "36b …and edit its teeth");
  eq((await api("POST", `/patient-access/delegations/${del.json.delegation._id}/revoke`, tkO, {})).status, 200, "37a the delegation is revoked");
  const rev = await guard("revoked", tkY);
  eq(rev.codes, [404, 404, 404], "37 after revocation the same token is denied on every serial mutation");
  ok(rev.same, "37b …and nothing was created");

  /* ---------- P · primary + mixed dentition ---------- */
  eq((await api("PUT", `${base(pKid)}/dentition`, tkX, { dentitionType: "primary" })).status, 200, "P0 the child's chart is primary");
  const kid = await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["54", "55", "64", "65"], surfaces: ["O"] }, pKid);
  eq([kid.status, kid.json.item && kid.json.item.toothNumbers], [201, ["54", "55", "64", "65"]], "P1 a serial filling on PRIMARY molars is accepted");
  eq((await add({ procedureCode: "filling", targetType: "multi_tooth", toothNumbers: ["16", "17"], surfaces: ["O"] }, pKid)).status, 400, "P2 permanent codes are refused on a primary chart");
  eq((await add({ procedureCode: "whitening", targetType: "multi_tooth", toothNumbers: ["51", "52", "53", "54", "55", "61", "62", "63", "64", "65"] }, pKid)).status, 201, "P3 a primary arch is a valid serial selection");
  eq((await api("PUT", `${base(pMix)}/dentition`, tkX, { dentitionType: "mixed" })).status, 200, "P4 the third patient is mixed");
  const mix = await add({ procedureCode: "crown", targetType: "multi_tooth", toothNumbers: ["16", "55"] }, pMix);
  eq([mix.status, mix.json.item && mix.json.item.toothNumbers], [201, ["16", "55"]], "P5 mixed dentition: a permanent and a primary tooth can share one serial treatment");
  const mixView = chartOf((await plan(pMix)).items);
  ok(mixView["16"] && mixView["55"], "P6 …and both are drawn (primary 55 is never mapped onto permanent 15)", Object.keys(mixView));

  /* ---------- L · legacy records written before Phase 5 ---------- */
  const legacy = await DentalTreatmentItem.create({
    clinicId: A._id, patientId: pX._id, planId: p1.items[0].planId, procedureCode: "bridge", catalogVersion: 1, targetType: "multi_tooth", toothNumbers: ["35", "36", "37"],
    surfaces: [], status: "planned", priority: "normal", phase: 1, dentitionType: "permanent", statusHistory: [{ status: "planned", at: new Date(), by: docX._id }], createdBy: docX._id,
  });
  const lp = await plan();
  const lrow = lp.items.find((i) => i._id === sid(legacy));
  ok(!!lrow && lrow.toothSurfaces === undefined && lrow.toothNumbers.join() === "35,36,37", "L1 a record without toothSurfaces is read exactly as before");
  eq((await edit(sid(legacy), { notes: "legacy ok" })).status, 200, "L2 …and can still be edited");
  eq((await add({ procedureCode: "bridge", targetType: "multi_tooth", toothNumbers: ["35", "36", "37"] })).json.code, "DUPLICATE_ITEM", "L3 a legacy item (no twin key) still blocks an identical new one (application-level twin check)");

  /* ---------- C · canonical read ---------- */
  const fin = await plan();
  eq(fin.items.map((i) => i._id).sort(), (await DentalTreatmentItem.find({ clinicId: A._id, patientId: pX._id }).lean()).map(sid).sort(), "C1 the plan lists exactly the stored records (no extra, none missing)");
  eq(new Set(fin.items.map((i) => i._id)).size, fin.items.length, "C2 no id appears twice");
  eq(await count({ clinicId: B._id }), 0, "C3 clinic B holds nothing");

  t.noLeaks();
  await t.finish("Phase 5 — dental chart V2: serial teeth + surfaces (backend)");
})().catch((e) => { console.error(e); process.exit(1); });
