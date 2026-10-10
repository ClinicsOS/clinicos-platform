/* Patient clinical record — clinical notes (+ edit history), the clinical timeline, and the Treatment <-> Invoice link.
   End-to-end against the COMPILED server (real HTTP, real database, nothing mocked). Reuses tests/phase10/lib.js.
     npm run build && node tests/clinical-record/clinical-record.test.js
   Optional env: P10_MONGO (default mongodb://127.0.0.1:27017), P10_DIST, P10_OUT. */
const { boot } = require("../phase10/lib");

(async () => {
  const t = await boot({ name: "clinical_record", port: 5302 });
  const { ok, eq, http } = t;
  const { ClinicalNote } = t.M("ClinicalNote");
  const { DentalTreatmentItem } = t.M("DentalTreatmentItem");
  const { DentalTreatmentSession } = t.M("DentalTreatmentSession");
  const { Invoice } = t.M("Invoice");

  // ---- world: dentistry clinic A (owner / doctor / receptionist), dentistry clinic B (other tenant), general clinic G ----
  const A = await t.mkClinic("rec-a", { specialty: "dentistry", plan: "pro" });
  const B = await t.mkClinic("rec-b", { specialty: "dentistry", plan: "pro" });
  const G = await t.mkClinic("rec-g", { specialty: "general", plan: "pro" });
  const owner = await t.mkUser(A, "owner"), doc = await t.mkUser(A, "doctor"), rec = await t.mkUser(A, "receptionist");
  const docB = await t.mkUser(B, "doctor"), ownerG = await t.mkUser(G, "owner");
  const tkDoc = t.tok(doc), tkOwner = t.tok(owner), tkRec = t.tok(rec), tkB = t.tok(docB), tkG = t.tok(ownerG);
  const pA = await t.mkPatient(A, "Alpha"), pA2 = await t.mkPatient(A, "Beta"), pB = await t.mkPatient(B, "Tenant B patient"), pG = await t.mkPatient(G, "General patient");
  const hour = 36e5;
  const mkVisit = (p, ago, extra = {}) => t.m.Appointment.create({ clinicId: A._id, doctorId: doc._id, patientId: p._id, startAt: new Date(Date.now() - ago), duration: 30, status: "completed", ...extra });
  const v1 = await mkVisit(pA, 48 * hour, { visitNote: "first visit note" });
  const v2 = await mkVisit(pA, 24 * hour);
  const vFuture = await t.m.Appointment.create({ clinicId: A._id, doctorId: doc._id, patientId: pA._id, startAt: new Date(Date.now() + 48 * hour), duration: 30, status: "scheduled" });
  const vBlocked = await t.m.Appointment.create({ clinicId: A._id, doctorId: doc._id, type: "blocked", startAt: new Date(Date.now() - 5 * hour), duration: 30, status: "scheduled" });
  const vOther = await mkVisit(pA2, 10 * hour);
  const vOtherClinic = await t.m.Appointment.create({ clinicId: B._id, doctorId: docB._id, patientId: pB._id, startAt: new Date(Date.now() - hour), duration: 30, status: "completed" });

  const base = (p) => `/patients/${p._id}`;
  const notes = (p = pA, token = tkDoc, qs = "") => http("GET", `${base(p)}/clinical-notes${qs}`, { token });
  const addNote = (body, p = pA, token = tkDoc) => http("POST", `${base(p)}/clinical-notes`, { token, body });
  const editNote = (id, body, p = pA, token = tkDoc) => http("PUT", `${base(p)}/clinical-notes/${id}`, { token, body });
  const revs = (id, p = pA, token = tkDoc) => http("GET", `${base(p)}/clinical-notes/${id}/revisions`, { token });
  const tl = (qs = "", p = pA, token = tkDoc) => http("GET", `${base(p)}/clinical-timeline${qs}`, { token });
  const rid = () => "r" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

  /* ================= A. create / read / scoping ================= */
  const n1 = await addNote({ text: "  Patient reports sensitivity on the lower left.  ", requestId: rid() });
  eq(n1.status, 201, "A1 a doctor can add a clinical note");
  eq(n1.json.note.text, "Patient reports sensitivity on the lower left.", "A2 text is trimmed");
  eq(n1.json.note.author.name, doc.name, "A3 the author comes from the logged-in user (not from the client)");
  eq(n1.json.note.sourceType, "patient", "A4 default source is the patient file");
  eq(n1.json.note.editCount, 0, "A5 a fresh note has no edits");
  eq(n1.json.note.edited, null, "A6 …and no 'edited' indicator");
  ok(!("revisions" in n1.json.note) && !("requestKey" in n1.json.note) && !("clinicId" in n1.json.note), "A7 internals (revisions, idempotency key, clinicId) are not exposed", Object.keys(n1.json.note));
  eq((await addNote({ text: "Owner note" }, pA, tkOwner)).status, 201, "A8 the owner can add a note");
  eq((await addNote({ text: "x" }, pA, tkRec)).status, 403, "A9 a receptionist cannot write clinical notes (existing clinical-write rule)");
  const recList = await notes(pA, tkRec);
  eq(recList.status, 200, "A10 …but can read the file like every other role");
  eq((await http("POST", `${base(pA)}/clinical-notes`, { body: { text: "x" } })).status, 401, "A11 anonymous is refused");
  eq((await addNote({ text: "" })).status, 400, "A12 empty note is rejected");
  eq((await addNote({ text: "   " })).status, 400, "A13 blank note is rejected");
  eq((await addNote({ text: "x".repeat(5001) })).status, 400, "A14 over-long note is rejected");
  eq((await addNote({ text: "x".repeat(5000) })).status, 201, "A15 the maximum length is accepted");
  eq((await addNote({ text: "x", sourceType: "bogus" })).status, 400, "A16 unknown source type is rejected");
  eq((await addNote({ text: "x", clinicId: String(B._id), authorId: String(docB._id) })).json.note.author.name, doc.name, "A17 clinicId/authorId in the body are ignored");
  const stored = await ClinicalNote.find({ patientId: pA._id }).lean();
  ok(stored.every((n) => String(n.clinicId) === String(A._id) && [String(doc._id), String(owner._id)].includes(String(n.authorId))), "A18 every stored note carries the caller's clinic and author");

  /* ================= B. scoping / isolation ================= */
  eq((await notes(pB, tkDoc)).status, 404, "B1 another clinic's patient: 404 (read)");
  eq((await addNote({ text: "leak" }, pB, tkDoc)).status, 404, "B2 another clinic's patient: 404 (write)");
  eq((await tl("", pB, tkDoc)).status, 404, "B3 another clinic's patient: 404 (timeline)");
  eq((await notes(pA, tkB)).status, 404, "B4 clinic B's doctor cannot read clinic A's patient");
  eq((await http("GET", `${base({ _id: "nope" })}/clinical-notes`, { token: tkDoc })).status, 404, "B5 malformed patient id: 404, not 500");
  const keep = n1.json.note._id;
  eq((await editNote(keep, { text: "hijack" }, pA, tkB)).status, 404, "B6 another clinic cannot edit a note");
  eq((await revs(keep, pA, tkB)).status, 404, "B7 another clinic cannot read its revisions");
  eq((await editNote(keep, { text: "wrong patient" }, pA2)).status, 404, "B8 a note cannot be reached through a different patient of the same clinic");
  eq((await notes(pA2)).json.notes.length, 0, "B9 patient Beta's file has none of Alpha's notes");
  ok(!JSON.stringify((await tl("", pA2)).json).includes("Patient reports"), "B10 …nor in Beta's timeline");
  // source records must belong to the SAME clinic and patient
  eq((await addNote({ text: "ok", sourceType: "appointment", sourceId: String(v1._id) })).status, 201, "B11 a note can belong to this patient's visit");
  eq((await addNote({ text: "x", sourceType: "appointment", sourceId: String(vOther._id) })).status, 404, "B12 …not to another patient's visit");
  eq((await addNote({ text: "x", sourceType: "appointment", sourceId: String(vOtherClinic._id) })).status, 404, "B13 …nor to another clinic's visit");
  eq((await addNote({ text: "x", sourceType: "appointment", sourceId: String(vBlocked._id) })).status, 404, "B14 …nor to a blocked slot");
  eq((await addNote({ text: "x", sourceType: "appointment" })).status, 404, "B15 a visit note needs its visit");
  eq((await addNote({ text: "x", sourceType: "patient", sourceId: String(v1._id) })).status, 404, "B16 a plain patient note cannot smuggle a source id");
  eq((await addNote({ text: "x", sourceType: "appointment", sourceId: "not-an-id" })).status, 400, "B17 malformed source id is rejected");
  const apptNote = (await notes(pA, tkDoc, `?sourceType=appointment&sourceId=${v1._id}`)).json.notes;
  eq(apptNote.length, 1, "B18 notes of a visit can be listed");
  eq(apptNote[0].doctor && apptNote[0].doctor.name, doc.name, "B19 a visit note carries the visit's doctor");

  /* ================= C. idempotent create (double click / retry / race) ================= */
  const r1 = rid();
  const c1 = await addNote({ text: "double-click me", requestId: r1 });
  const c2 = await addNote({ text: "double-click me", requestId: r1 });
  eq([c1.status, c2.status], [201, 200], "C1 the same request id twice: first creates, second replays");
  eq(c1.json.note._id, c2.json.note._id, "C2 …and returns the SAME note");
  const r2 = rid();
  const racers = await Promise.all(Array.from({ length: 8 }, () => addNote({ text: "race note", requestId: r2 })));
  eq(await ClinicalNote.countDocuments({ patientId: pA._id, text: "race note" }), 1, "C3 8 parallel identical submits store exactly ONE note");
  ok(racers.every((r) => r.status === 201 || r.status === 200), "C4 …and none of them errors", racers.map((r) => r.status));
  const d1 = await addNote({ text: "no key twice" }), d2 = await addNote({ text: "no key twice" });
  eq([d1.status, d2.status], [201, 200], "C5 without a request id the same text within seconds is still one note");
  eq((await addNote({ text: "no key twice", sourceType: "appointment", sourceId: String(v2._id) })).status, 201, "C6 the same text in a different place is a different note");
  const e1 = await addNote({ text: "intentional repeat", requestId: rid() }), e2 = await addNote({ text: "intentional repeat second", requestId: rid() });
  eq([e1.status, e2.status], [201, 201], "C7 different dialogs (different request ids) are different notes");
  eq((await addNote({ text: "same key other user", requestId: r1 }, pA, tkOwner)).status, 201, "C8 another user's identical request id is not confused with mine");

  /* ================= D. edit + revision history ================= */
  const id = n1.json.note._id;
  const ed1 = await editNote(id, { text: "Sensitivity on the lower left, cold stimulus.", expectedEditCount: 0 });
  eq(ed1.status, 200, "D1 the doctor can edit the note");
  eq(ed1.json.note.editCount, 1, "D2 edit count increments");
  eq(ed1.json.note.edited && ed1.json.note.edited.by.name, doc.name, "D3 'Edited' indicator carries who edited");
  ok(ed1.json.note.edited && !Number.isNaN(Date.parse(ed1.json.note.edited.at)), "D4 …and when");
  eq(ed1.json.note.createdAt === n1.json.note.createdAt, true, "D5 the note keeps its original creation time (timeline position)");
  const ed2 = await editNote(id, { text: "Third wording", expectedEditCount: 1 }, pA, tkOwner);
  eq(ed2.status, 200, "D6 a different authorised user can edit it too");
  eq(ed2.json.note.edited.by.name, owner.name, "D7 the indicator follows the latest editor");
  eq(ed2.json.note.author.name, doc.name, "D8 …while the author stays the original author");
  const rv = (await revs(id)).json.revisions;
  eq(rv.map((r) => r.text), ["Sensitivity on the lower left, cold stimulus.", "Patient reports sensitivity on the lower left."], "D9 previous contents are preserved, newest edit first");
  eq(rv.map((r) => r.editedBy.name), [owner.name, doc.name], "D10 each revision says who edited");
  ok(rv.every((r) => !Number.isNaN(Date.parse(r.editedAt)) && !Number.isNaN(Date.parse(r.versionAt))), "D11 …and when");
  ok(rv.every((r) => !("_id" in r)), "D12 revision rows expose no internal ids", Object.keys(rv[0]));
  eq((await editNote(id, { text: "Third wording", expectedEditCount: 2 })).json.unchanged, true, "D13 saving identical text is a no-op …");
  eq((await revs(id)).json.revisions.length, 2, "D14 …and adds no revision");
  const stale = await editNote(id, { text: "from a stale screen", expectedEditCount: 0 });
  eq([stale.status, stale.json.code], [409, "NOTE_CHANGED"], "D15 an edit from stale data is refused, not applied");
  eq(stale.json.note.text, "Third wording", "D16 …and the response carries the latest version");
  eq((await ClinicalNote.findById(id).lean()).text, "Third wording", "D17 the stored text is untouched by the refused edit");
  eq((await editNote(id, { text: "" })).status, 400, "D18 editing to empty is rejected");
  eq((await editNote(id, { text: "x".repeat(5001) })).status, 400, "D19 editing to over-long is rejected");
  eq((await editNote(id, { text: "rec edit" }, pA, tkRec)).status, 403, "D20 a receptionist cannot edit");
  eq((await editNote("0123456789abcdef01234567", { text: "x" })).status, 404, "D21 unknown note: 404");
  eq((await revs(keep)).status, 200, "D22 a receptionist-readable revisions endpoint answers for doctors");
  eq((await revs(id, pA, tkRec)).status, 200, "D23 revisions are readable by any role of the clinic (existing read rule)");
  eq((await revs(n1.json.note._id)).json.revisions.length, 2, "D24 revisions survive refetch (they are stored, not computed in the browser)");
  // many edits stay ordered and complete
  const fresh = (await addNote({ text: "v0" })).json.note._id;
  for (let i = 1; i <= 5; i++) eq((await editNote(fresh, { text: "v" + i, expectedEditCount: i - 1 })).status, 200, `D25.${i} sequential edit ${i}`);
  eq((await revs(fresh)).json.revisions.map((r) => r.text), ["v4", "v3", "v2", "v1", "v0"], "D26 five edits => five preserved revisions in order");
  // concurrent edits from the same starting version: only one may win (the rest get 409), nothing is lost
  const rc = (await addNote({ text: "race base" })).json.note._id;
  const edits = await Promise.all(Array.from({ length: 6 }, (_, i) => editNote(rc, { text: "racer " + i, expectedEditCount: 0 })));
  const won = edits.filter((r) => r.status === 200).length;
  const after = await ClinicalNote.findById(rc).lean();
  t.dbLimit(won === 1 && after.editCount === 1 && after.revisions.length === 1, "D27 6 concurrent edits from the same version: exactly 1 applied (needs real MongoDB atomicity)", { won, editCount: after.editCount, revisions: after.revisions.length });
  ok(after.revisions.length === after.editCount, "D28 whatever happened, every applied edit has exactly one revision", { editCount: after.editCount, revisions: after.revisions.length });
  ok(after.revisions.every((r) => r.text === "race base" || /^racer /.test(r.text)), "D29 …and no text was lost");
  // the edit limit protects the document size
  const lim = (await addNote({ text: "limit base" })).json.note._id;
  await ClinicalNote.updateOne({ _id: lim }, { $set: { editCount: 100 } });
  eq((await editNote(lim, { text: "one more" })).json.code, "NOTE_REVISION_LIMIT", "D30 a note at the edit limit asks for a new note instead of growing forever");

  /* ================= E. clinical timeline ================= */
  // dental data for patient A: a treatment planned -> started -> completed in visit v1, another cancelled, notes on a session
  const planItem = await http("POST", `/dental/patients/${pA._id}/treatment-plan/items`, { token: tkDoc, body: { procedureCode: "crown", targetType: "tooth", toothNumbers: ["16"] } });
  eq(planItem.status, 201, "E0 a treatment is planned");
  const itemId = planItem.json.item._id;
  eq((await http("POST", `/dental/patients/${pA._id}/treatment-plan/items/${itemId}/start`, { token: tkDoc, body: { appointmentId: String(v1._id) } })).status, 201, "E0b started");
  const sess = await DentalTreatmentSession.findOne({ itemId }).lean();
  await DentalTreatmentSession.updateOne({ _id: sess._id }, { $set: { notes: "prepared the tooth, shade A2" } });
  eq((await http("POST", `/dental/patients/${pA._id}/treatment-plan/items/${itemId}/complete`, { token: tkDoc, body: { appointmentId: String(v1._id) } })).status, 200, "E0c completed");
  const cx = await http("POST", `/dental/patients/${pA._id}/treatment-plan/items`, { token: tkDoc, body: { procedureCode: "filling", targetType: "surface", toothNumbers: ["26"], surfaces: ["O"] } });
  eq((await http("POST", `/dental/patients/${pA._id}/treatment-plan/items/${cx.json.item._id}/cancel`, { token: tkDoc, body: { reason: "patient declined" } })).status, 200, "E0d another is cancelled");
  // a note attached to that treatment, one attached to visit v2
  eq((await addNote({ text: "crown note", sourceType: "dental_treatment", sourceId: itemId })).status, 201, "E0e a note can belong to a treatment");
  eq((await addNote({ text: "x", sourceType: "dental_treatment", sourceId: String(cx.json.item._id).replace(/.$/, "0") })).status, 404, "E0f …only an existing treatment of this patient");

  const all = await tl("?limit=60");
  eq(all.status, 200, "E1 timeline loads");
  const ev = all.json.events;
  const keys = ev.map((e) => e.key);
  eq(new Set(keys).size, keys.length, "E2 NO duplicate timeline entries (every key unique)");
  const times = ev.map((e) => new Date(e.at).getTime());
  ok(times.every((x, i) => i === 0 || times[i - 1] >= x), "E3 newest first");
  eq(ev.filter((e) => e.kind === "visit").length, 2, "E4 past visits of THIS patient appear once each (not future, not blocked, not another patient's)");
  ok(!ev.some((e) => e.appointmentId === String(vFuture._id) || e.appointmentId === String(vBlocked._id) || e.appointmentId === String(vOther._id)), "E5 upcoming / blocked / other-patient visits are excluded");
  eq(ev.find((e) => e.key === `visit:${v1._id}`).content, "first visit note", "E6 the existing visit note is shown on its visit");
  const tr = ev.filter((e) => e.kind === "treatment" && e.itemId === itemId).map((e) => e.event).sort();
  eq(tr, ["completed", "in_progress", "planned"], "E7 one treatment => exactly one row per milestone (planned / started / completed)");
  eq(ev.filter((e) => e.kind === "treatment" && e.itemId === cx.json.item._id).map((e) => e.event).sort(), ["cancelled", "planned"], "E8 a cancelled treatment shows planned + cancelled once");
  eq(ev.find((e) => e.event === "cancelled").reason, "patient declined", "E9 the cancel reason is carried");
  ok(!ev.some((e) => e.event === "session" || e.event === "session_finished"), "E10 sessions are not repeated as separate events (no 'started'/'completed' twice)");
  eq(ev.filter((e) => e.event === "session_note").length, 1, "E11 a session note that carries text appears once, as a note");
  eq(ev.filter((e) => e.kind === "note" && e.event === "note" && e.content === "crown note").length, 1, "E12 a clinical note appears once");
  const cn = ev.find((e) => e.content === "crown note");
  eq([cn.context.procedureCode, cn.context.toothNumbers], ["crown", ["16"]], "E13 a treatment note shows its treatment context (procedure + tooth)");
  const vn = ev.find((e) => e.kind === "note" && e.context.sourceType === "appointment" && e.content === "ok");
  ok(vn && vn.context.visitAt, "E14 a visit note shows which visit it belongs to");
  const edited = ev.find((e) => e.noteId === id);
  eq([edited.content, edited.editCount > 0, !!edited.edited && !!edited.edited.by], ["Third wording", true, true], "E15 an edited note shows its latest text with the 'edited' marker");
  eq(ev.filter((e) => e.noteId === id).length, 1, "E16 …and appears once (not once per revision)");
  ok(!JSON.stringify(ev).includes("Patient reports sensitivity"), "E17 replaced text never leaks into the timeline");
  ok(!ev.some((e) => e.kind === "visit" && /invoice/i.test(e.event)), "E18 no accounting rows");
  // keyset paging: walking pages with a small limit returns exactly the same sequence, no gaps / repeats
  const walked = [];
  let cur = "";
  for (let guard = 0; guard < 80; guard++) {
    const pg = await tl(`?limit=4${cur ? "&before=" + encodeURIComponent(cur) : ""}`);
    eq(pg.status, 200, `E19.${guard} page loads`);
    walked.push(...pg.json.events.map((e) => e.key));
    if (!pg.json.nextCursor) break;
    cur = pg.json.nextCursor;
  }
  eq(walked, keys, "E19 paging with limit=4 walks the SAME sequence as one big page (no gaps, no repeats)");
  eq((await tl("?limit=4")).json.events.length, 4, "E20 the page size is honoured (bounded payload)");
  eq((await tl("?limit=999")).status, 400, "E21 limit above the cap is rejected");
  eq((await tl("?before=garbage")).status, 400, "E22 a malformed cursor is rejected");
  eq((await tl("?kind=bogus")).status, 400, "E23 unknown kind is rejected");
  const kinds = {};
  for (const k of ["visit", "treatment", "note"]) kinds[k] = (await tl(`?kind=${k}&limit=60`)).json.events;
  ok(kinds.visit.every((e) => e.kind === "visit") && kinds.treatment.every((e) => e.kind === "treatment") && kinds.note.every((e) => e.kind === "note"), "E24 filters return only their kind");
  eq(kinds.visit.length + kinds.treatment.length + kinds.note.length, ev.length, "E25 the filters partition the timeline (nothing lost, nothing counted twice)");
  eq((await tl("", pA, tkRec)).status, 200, "E26 any role of the clinic can read the timeline");
  eq((await tl("", pG, tkG)).json.events.filter((e) => e.kind === "treatment").length, 0, "E27 a non-dental clinic has no treatment rows");
  // a note in a general clinic works too (the Patient File is not dentistry-only)
  eq((await addNote({ text: "general clinic note" }, pG, tkG)).status, 201, "E28 clinical notes work in any specialty");
  eq((await tl("", pG, tkG)).json.events.some((e) => e.content === "general clinic note"), true, "E29 …and appear in that clinic's timeline");
  // the timeline is a pure read: calling it does not change anything
  const before = JSON.stringify([await ClinicalNote.countDocuments(), await DentalTreatmentItem.countDocuments()]);
  await tl("?limit=60"); await tl("?limit=60");
  eq(JSON.stringify([await ClinicalNote.countDocuments(), await DentalTreatmentItem.countDocuments()]), before, "E30 reading the timeline writes nothing");
  eq(JSON.stringify((await tl("?limit=60")).json.events), JSON.stringify((await tl("?limit=60")).json.events), "E31 and is deterministic (same input => same output)");

  /* ================= F. Treatment <-> Invoice (existing system; regression + edge cases) ================= */
  const bill = (iid, body = {}, p = pA, token = tkDoc) => http("POST", `/dental/patients/${p._id}/treatment-plan/items/${iid}/invoice`, { token, body: { price: 80, description: "Crown 16", ...body } });
  const plan = async (p = pA) => (await http("GET", `/dental/patients/${p._id}/treatment-plan`, { token: tkDoc })).json;
  const itemOf = async (iid) => (await plan()).items.find((i) => i._id === iid);
  eq((await itemOf(itemId)).billing.state, "none", "F1 a completed treatment starts as 'not invoiced'");
  const b1 = await bill(itemId);
  eq(b1.status, 201, "F2 Add to Invoice creates the invoice");
  eq(b1.json.item.billing.state, "invoiced", "F3 the plan item is now linked");
  const inv1 = await Invoice.findOne({ patientId: pA._id }).lean();
  eq([inv1.items.length, inv1.items[0].sourceType, String(inv1.items[0].sourceId), inv1.items[0].description, inv1.items[0].price], [1, "dental_treatment", itemId, "Crown 16", 80], "F4 the invoice line carries a real reference to the treatment (not just matching text)");
  const b2 = await bill(itemId);
  eq([b2.status, b2.json.alreadyInvoiced], [200, true], "F5 invoicing again is recognised, not duplicated");
  const racing = await Promise.all(Array.from({ length: 6 }, () => bill(itemId)));
  ok(racing.every((r) => r.status === 200 || r.status === 409), "F6 6 parallel clicks never error", racing.map((r) => r.status));
  eq(await Invoice.countDocuments({ patientId: pA._id }), 1, "F7 …and never create a second invoice");
  eq((await Invoice.findOne({ patientId: pA._id }).lean()).items.filter((l) => String(l.sourceId) === itemId).length, 1, "F8 …nor a second line for the same treatment");
  eq((await itemOf(itemId)).billing.invoiceStatus, "unpaid", "F9 billing state shows the invoice's own status: unpaid");
  // Payments are written straight into the invoice (what the invoice system's own "add payment" ends up storing): the
  // POST /invoices/:id/payments handler runs a loyalty aggregation that the FerretDB test engine cannot execute ($lte in $match).
  // What is under test here is that the treatment READS the invoice's state, not how a payment gets recorded.
  const pay = async (invId, amount) => {
    const inv = await Invoice.findById(invId);
    inv.payments.push({ amount, method: "cash", paidAt: new Date() });
    const paid = inv.payments.reduce((x, p) => x + p.amount, 0);
    inv.status = paid >= inv.total ? "paid" : "partially_paid";
    await inv.save();
    return { status: 201 };
  };
  eq((await pay(inv1._id, 30)).status, 201, "F10 a partial payment is recorded in the invoice system");
  eq((await itemOf(itemId)).billing.invoiceStatus, "partially_paid", "F11 the treatment shows 'partially paid' (read from the invoice, not stored twice)");
  eq((await pay(inv1._id, 50)).status, 201, "F12 the balance is paid");
  eq((await itemOf(itemId)).billing.invoiceStatus, "paid", "F13 the treatment shows 'paid'");
  eq((await itemOf(itemId)).estimatedPrice, null, "F14 the estimate is never overwritten by billing");
  // a fully paid invoice is not silently re-opened by a second treatment
  const t2 = await http("POST", `/dental/patients/${pA._id}/treatment-plan/items`, { token: tkDoc, body: { procedureCode: "filling", targetType: "surface", toothNumbers: ["27"], surfaces: ["O"] } });
  const t2id = t2.json.item._id;
  await http("POST", `/dental/patients/${pA._id}/treatment-plan/items/${t2id}/start`, { token: tkDoc, body: { appointmentId: String(v2._id) } });
  await http("POST", `/dental/patients/${pA._id}/treatment-plan/items/${t2id}/complete`, { token: tkDoc, body: { appointmentId: String(v2._id) } });
  eq((await bill(t2id, { price: 40, description: "Filling 27", invoiceId: String(inv1._id) })).json.code, "INVOICE_NOT_EDITABLE", "F15 a fully paid invoice cannot receive another treatment");
  eq((await bill(t2id, { price: 40, description: "Filling 27", invoiceId: String((await Invoice.create({ clinicId: B._id, invoiceNumber: 1, patientId: pB._id, items: [{ description: "x", price: 1, qty: 1 }], total: 1 }))._id) })).status, 404, "F16 an invoice of another clinic/patient cannot be targeted");
  eq((await bill(t2id, { price: 40, description: "Filling 27" }, pA, tkRec)).status, 201, "F17 invoicing keeps its EXISTING access rule (financial, not clinical)");
  const inv2 = await Invoice.findOne({ patientId: pA._id, "items.sourceId": t2id }).lean();
  ok(inv2 && String(inv2._id) !== String(inv1._id), "F18 it went to a NEW invoice");
  // the invoice line is removed by staff in the invoice system -> the treatment becomes billable again, no stale 'invoiced'
  const upd = await http("PUT", `/invoices/${inv2._id}`, { token: tkDoc, body: { items: [{ description: "Consultation", price: 10, qty: 1 }], discount: 0 } });
  eq(upd.status, 200, "F19 staff edit the invoice (remove the treatment line)");
  eq((await itemOf(t2id)).billing.state, "none", "F20 the treatment is shown as 'not invoiced' again (stale link ignored)");
  eq((await bill(t2id, { price: 45, description: "Filling 27 (again)", invoiceId: String(inv2._id) })).status, 201, "F21 and can be invoiced again");
  eq((await Invoice.findOne({ _id: inv2._id }).lean()).items.filter((l) => String(l.sourceId) === t2id).length, 1, "F22 exactly one live line for it");
  // editing an unrelated field of the invoice keeps the link
  const live = await Invoice.findOne({ _id: inv2._id }).lean();
  await http("PUT", `/invoices/${inv2._id}`, { token: tkDoc, body: { items: live.items.map((l) => ({ _id: String(l._id), description: l.description, price: l.price, qty: l.qty })), discount: 1 } });
  eq((await itemOf(t2id)).billing.state, "invoiced", "F23 editing the invoice discount keeps the treatment link");
  eq((await bill(itemId, {}, pA2)).status, 404, "F24 a treatment cannot be billed through another patient");
  eq((await http("POST", `/dental/patients/${pB._id}/treatment-plan/items/${itemId}/invoice`, { token: tkDoc, body: { price: 1, description: "x" } })).status, 404, "F25 …nor through another clinic's patient");
  const planAfter = await plan();
  eq(planAfter.items.filter((i) => i._id === itemId).length, 1, "F26 no duplicate treatment records were created by billing");

  /* ================= G. nothing existing changed ================= */
  eq((await http("GET", `/patients/${pA._id}`, { token: tkDoc })).json.fullName, "Alpha", "G1 the patient file still loads");
  eq((await http("GET", `/appointments?patientId=${pA._id}`, { token: tkDoc })).json.length >= 3, true, "G2 appointments still list");
  eq((await http("GET", `/invoices?patientId=${pA._id}`, { token: tkDoc })).json.length, 2, "G3 invoices still list");
  eq((await http("GET", `/dental/patients/${pA._id}/record`, { token: tkDoc })).status, 200, "G4 the dental record still loads");
  // legacy documents without any of the new fields behave: a patient with NO notes and NO treatments
  const bare = await t.mkPatient(A, "Bare legacy");
  const bareTl = await tl("", bare);
  eq([bareTl.status, bareTl.json.events, bareTl.json.nextCursor], [200, [], null], "G5 an existing patient with no history gets an empty timeline, not an error");
  eq((await notes(bare)).json.notes, [], "G6 …and an empty notes list");

  await t.finish("Clinical record — notes, revisions, timeline, treatment billing");
})().catch((e) => { console.error(e); process.exit(1); });
