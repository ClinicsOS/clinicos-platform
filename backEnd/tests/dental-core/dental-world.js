/* Dental Chart — Treatment Summary: browser-test world.
   Boots the COMPILED backend on a fixed port with a fresh database, seeds a PRO dentistry clinic (owner / doctor / receptionist),
   a second dentistry clinic (other tenant), and patients with diagnoses + treatments — all through the REAL API as the staff
   themselves — then writes everything the browser tests need to <out>/dental-world.json and keeps serving until killed.
     node tests/dental-core/dental-world.js <out-dir>       (needs `npm run build` and a MongoDB-protocol server; same env as dental-sync.test.js) */
const fs = require("fs");
const { boot } = require("../phase10/lib");

(async () => {
  const out = process.argv[2] || __dirname;
  const t = await boot({ name: "dental_summary_w", port: 5701 });
  const A = await t.mkClinic("dent-a", { specialty: "dentistry", plan: "pro" });
  const B = await t.mkClinic("dent-b", { specialty: "dentistry", plan: "pro" });
  const U = { owner: await t.mkUser(A, "owner"), doc: await t.mkUser(A, "doctor"), rec: await t.mkUser(A, "receptionist"), ownerB: await t.mkUser(B, "owner") };
  const T = Object.fromEntries(Object.entries(U).map(([k, u]) => [k, t.tok(u)]));
  const id = (x) => String(x._id);
  const base = (p) => `/dental/patients/${id(p)}`;
  const call = (method, url, token, body) => t.http(method, url, { token, body });
  const must = (r, what) => { if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.json)}`); return r.json; };

  const pEn = await t.mkPatient(A, "Mona Hassan", "0791111111");
  const pAr = await t.mkPatient(A, "محمد الخطيب", "0792222222");
  const pKid = await t.mkPatient(A, "Child Patient", "0793333333");
  const pMix = await t.mkPatient(A, "Mixed Patient", "0794444444");
  const pEmpty = await t.mkPatient(A, "Empty Patient", "0795555555");
  const pB = await t.mkPatient(B, "Other Clinic Patient", "0796666666");
  const visit = (p) => t.m.Appointment.create({ clinicId: A._id, doctorId: U.doc._id, patientId: p._id, startAt: new Date(Date.now() + 36e5), duration: 30, status: "confirmed" });

  const dx = async (p, fdi, code, surfaces) => must(await call("POST", `${base(p)}/teeth/${fdi}/diagnoses`, T.doc, { code, ...(surfaces ? { surfaces } : {}) }), `dx ${fdi}`);
  const add = async (p, body, token = T.doc) => must(await call("POST", `${base(p)}/treatment-plan/items`, token, body), `add ${body.procedureCode} ${body.toothNumbers}`).item;
  const act = async (p, item, what, v) => must(await call("POST", `${base(p)}/treatment-plan/items/${item._id}/${what}`, T.doc, { appointmentId: id(v) }), `${what} ${item._id}`);
  const tooth = (fdi, procedureCode, extra = {}) => ({ procedureCode, targetType: "tooth", toothNumbers: [fdi], ...extra });
  const surf = (fdi, surfaces, procedureCode = "filling") => ({ procedureCode, targetType: "surface", toothNumbers: [fdi], surfaces });

  /* ---- Mona Hassan (adult, English): the main subject ---- */
  const vEn = await visit(pEn);
  await dx(pEn, "16", "caries", ["O"]);
  await dx(pEn, "15", "caries", ["M"]); // next to 16: must show ITS diagnosis only, never 16's treatments
  await add(pEn, surf("16", ["O"]));                                                      // 16: Filling (planned)
  const rct16 = await add(pEn, tooth("16", "root_canal")); await act(pEn, rct16, "start", vEn); await act(pEn, rct16, "complete", vEn); // 16: Root Canal (completed)
  await add(pEn, tooth("16", "crown"));                                                   // 16: Crown (planned)
  const f26 = await add(pEn, surf("26", ["M", "O"])); await act(pEn, f26, "start", vEn);  // 26: Filling (in progress)
  const c26 = await add(pEn, tooth("26", "crown")); await act(pEn, c26, "start", vEn); await act(pEn, c26, "complete", vEn); // 26: Crown (completed)
  await add(pEn, tooth("36", "other", { customName: "Re-treatment of the previously root-filled lower first molar with post removal" })); // very long name
  // 46: many treatments (+ N more)
  await add(pEn, surf("46", ["O"])); await add(pEn, surf("46", ["M"])); await add(pEn, tooth("46", "root_canal")); await add(pEn, tooth("46", "sealant")); await add(pEn, tooth("46", "veneer"));
  const c46 = await add(pEn, tooth("46", "crown")); await act(pEn, c46, "start", vEn);
  await add(pEn, { procedureCode: "bridge", targetType: "multi_tooth", toothNumbers: ["24", "25"] }); // multi-tooth: shows on both
  const x18 = await add(pEn, tooth("18", "crown")); must(await call("POST", `${base(pEn)}/treatment-plan/items/${x18._id}/cancel`, T.doc, { reason: "test" }), "cancel 18"); // cancelled: never shown
  await add(pEn, { procedureCode: "scaling", targetType: "general" }); // whole-mouth: on no tooth

  /* ---- Arabic patient ---- */
  await dx(pAr, "21", "caries", ["M", "O"]);
  await add(pAr, tooth("21", "other", { customName: "حشوة تجميلية" }));
  await add(pAr, tooth("11", "crown"));

  /* ---- primary dentition ---- */
  must(await call("PUT", `${base(pKid)}/dentition`, T.doc, { dentitionType: "primary" }), "dentition primary");
  await dx(pKid, "74", "caries", ["O"]);
  await add(pKid, { procedureCode: "filling", targetType: "surface", toothNumbers: ["55"], surfaces: ["O"] });
  await add(pKid, tooth("65", "extraction"));

  /* ---- mixed dentition (permanent 16 and primary 55 side by side; both jaws have teeth) ---- */
  must(await call("PUT", `${base(pMix)}/dentition`, T.doc, { dentitionType: "mixed" }), "dentition mixed");
  const cur = await call("PUT", `${base(pMix)}/current-teeth`, T.doc, { teeth: ["16", "26", "11", "21", "55", "54", "53", "63", "64", "65", "36", "46", "31", "41", "75", "85", "73", "83"] });
  await add(pMix, surf("16", ["D"]));
  await add(pMix, surf("55", ["O"]));
  await add(pMix, tooth("65", "crown"));

  /* ---- other tenant: same tooth number 16, different clinic ---- */
  const pBplan = must(await call("POST", `${base(pB)}/treatment-plan/items`, T.ownerB, tooth("16", "extraction")), "other clinic");

  // the Patient objects the app keeps in its "selected patient" store
  const full = async (p) => (await call("GET", `/patients/${id(p)}`, T.doc)).json;
  const patients = {};
  for (const [k, p] of Object.entries({ en: pEn, ar: pAr, kid: pKid, mix: pMix, empty: pEmpty })) patients[k] = await full(p);
  const users = {};
  for (const [k, u] of Object.entries(U)) users[k] = { id: id(u), name: u.name, email: u.email, role: u.role, clinicId: id(u.clinicId), slug: k === "ownerB" ? B.slug : A.slug, token: T[k] };

  fs.writeFileSync(`${out}/dental-world.json`, JSON.stringify({
    base: `http://localhost:5701/api`, users, patients, patientB: { id: id(pB), itemId: pBplan.item._id },
    ids: { visitEn: id(vEn) }, currentTeethStatus: cur.status,
  }, null, 1));
  console.log("DENTAL WORLD READY on :5701");
})().catch((e) => { console.error("WORLD FAILED:", e.message); process.exit(1); });
