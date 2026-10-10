import type { Ctx } from "./context";
import { envelope, treatmentKindOf } from "./context";
import { PolicyError } from "../../auth/policy";
import { compare, perUnit, ratePct, topOf, type Comparison } from "./metrics";
import { rollup, type DateRange } from "./range";
import { round3 } from "./agg";
import { coreFinancials } from "./summary";
import { collectedByDay, collectedByDoctor, collectedByMethod, billedByService, invoicedByDay, outstanding, paymentStatus, UNASSIGNED } from "./financial";
import { appointmentBreakdown, appointmentRates, appointmentsByDay, appointmentsByHour, appointmentsByWeekday, doctorNames, patientsSeenByDoctor } from "./appointments";
import { patientVisitStats, registeredPatients, registrationsByDay, totalPatients, patientsSeenByDay } from "./patients";
import { treatmentStats } from "./treatments";
import { expenseSeriesFor, expenseSummaryFor } from "./expenses";
import { User } from "../../models/User";
import { loyaltyStats } from "./loyalty";

/**
 * PHASE 6 — the section builders behind /api/analytics/*. Each one is a COMPOSITION of the shared metric modules (financial.ts,
 * appointments.ts, patients.ts, treatments.ts, summary.ts, the Phase 5 expense ledger): a section contains no metric formula of its own,
 * which is what keeps one number identical in every section. Nothing is computed in the browser.
 */

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const prevOf = (c: Ctx): DateRange => c.ranges.previous;

/** current vs previous for one number (previous is skipped — and the comparison is "none" — when comparison is off). */
const cmp = (c: Ctx, cur: number | null, prev: number | null, d = 3): Comparison => compare(cur, c.compare ? prev : null, d);

/** Everything the headline KPIs of a period need, in the minimum number of queries. */
async function periodCore(c: Ctx, r: DateRange) {
  const [fin, appt, pat, registered] = await Promise.all([
    coreFinancials(c.s, c.es, r),
    appointmentBreakdown(c.s, r),
    patientVisitStats(c.s, r),
    c.s.clinicWide ? registeredPatients(c.s, r) : Promise.resolve(null),
  ]);
  return { fin, appt, pat, registered };
}
type Core = Awaited<ReturnType<typeof periodCore>>;

// ───────────────────────────── trend (shared by Overview + Financial) ─────────────────────────────
async function financialTrend(c: Ctx) {
  const r = c.ranges.current, g = c.ranges.granularity;
  const [col, inv, exp] = await Promise.all([collectedByDay(c.s, r), invoicedByDay(c.s, r), expenseSeriesFor(c.es, r)]);
  const C = rollup(col, r, g), I = rollup(inv, r, g), E = rollup(exp, r, g);
  return {
    granularity: g,
    points: C.map((p, i) => ({ key: p.key, collected: round3(p.value), invoiced: round3(I[i].value), expenses: round3(E[i].value), net: round3(p.value - E[i].value) })),
  };
}

// ───────────────────────────── OVERVIEW ─────────────────────────────
export async function overviewSection(c: Ctx) {
  const r = c.ranges.current;
  const [cur, prev, standing, trend, insights] = await Promise.all([
    periodCore(c, r),
    c.compare ? periodCore(c, prevOf(c)) : Promise.resolve(null as Core | null),
    Promise.all([outstanding(c.s), c.s.clinicWide ? totalPatients(c.s, r) : Promise.resolve(null)]),
    financialTrend(c),
    insightsFor(c).catch(() => null), // an insight failure must never take the Overview down
  ]);
  const P = prev;
  const avgPatient = (x: Core) => perUnit(x.fin.collected, x.pat.seen);
  const avgVisit = (x: Core) => perUnit(x.fin.collected, x.appt.byStatus.completed);
  const rates = (x: Core) => appointmentRates(x.appt);
  return {
    ...envelope("overview", c),
    netKind: cur.fin.netKind,
    kpis: {
      collected: cmp(c, cur.fin.collected, P?.fin.collected ?? null),
      invoiced: cmp(c, cur.fin.invoiced, P?.fin.invoiced ?? null),
      expenses: cmp(c, cur.fin.businessExpenses, P?.fin.businessExpenses ?? null),
      netCash: cmp(c, cur.fin.netCash, P?.fin.netCash ?? null),
      appointments: cmp(c, cur.appt.total, P?.appt.total ?? null, 0),
      completed: cmp(c, cur.appt.byStatus.completed, P?.appt.byStatus.completed ?? null, 0),
      walkIns: cmp(c, cur.appt.walkIn.total, P?.appt.walkIn.total ?? null, 0),
      patientsSeen: cmp(c, cur.pat.seen, P?.pat.seen ?? null, 0),
      newPatients: cmp(c, cur.pat.newPatients, P?.pat.newPatients ?? null, 0),
      registeredPatients: cur.registered === null ? null : cmp(c, cur.registered, P?.registered ?? null, 0),
      cancellationRate: cmp(c, rates(cur).cancellationRate, P ? rates(P).cancellationRate : null, 1),
      noShowRate: cmp(c, rates(cur).noShowRate, P ? rates(P).noShowRate : null, 1),
      avgCollectedPerPatient: cmp(c, avgPatient(cur), P ? avgPatient(P) : null),
      avgCollectedPerVisit: cmp(c, avgVisit(cur), P ? avgVisit(P) : null),
    },
    standing: { outstanding: standing[0], totalPatients: standing[1] },
    trend,
    insights,
  };
}

/** Deterministic observations computed from the same metrics (no AI, no guesses). Each is null when there is no data. */
async function insightsFor(c: Ctx) {
  const r = c.ranges.current;
  const kind = treatmentKindOf(c.clinic.specialty);
  const [wd, hr, appt, treat, exp] = await Promise.all([
    appointmentsByWeekday(c.s, r),
    appointmentsByHour(c.s, r),
    appointmentBreakdown(c.s, r),
    kind ? treatmentStats(c.s, r, kind) : Promise.resolve(null),
    expenseSummaryFor(c.es, r),
  ]);
  const wdTop = topOf(WEEKDAYS.map((name, i) => ({ name, n: wd[i] })), (x) => x.n, (x) => x.name);
  const hrTop = topOf(hr.map((n, h) => ({ h, n })), (x) => x.n, (x) => String(x.h).padStart(2, "0"));
  const docs = Array.from(appt.perDoctor.entries()).map(([id, v]) => ({ id, n: v.completed }));
  const docTop = c.s.clinicWide ? topOf(docs, (x) => x.n, (x) => x.id) : null;
  const names = docTop ? await doctorNames(c.s.clinicId, [docTop.id]) : new Map<string, string>();
  const srcTop = topOf(Object.entries(appt.bySource).map(([source, n]) => ({ source, n })), (x) => x.n, (x) => x.source);
  const trTop = treat ? treat.byProcedure[0] ?? null : null;
  const catTop = topOf(exp.byCategory, (x) => x.total - x.personal, (x) => x.category);
  return {
    peakWeekday: wdTop ? { weekday: wdTop.name, appointments: wdTop.n } : null,
    peakHour: hrTop ? { hour: hrTop.h, appointments: hrTop.n } : null,
    highestVolumeDoctor: docTop && docTop.n > 0 ? { doctorId: docTop.id, name: names.get(docTop.id) ?? "", completedVisits: docTop.n } : null,
    topSource: srcTop ? { source: srcTop.source, appointments: srcTop.n } : null,
    topTreatment: trTop ? { code: trTop.code, completed: trTop.count } : null,
    largestExpenseCategory: catTop ? { category: catTop.category, total: round3(catTop.total - catTop.personal) } : null,
  };
}

// ───────────────────────────── FINANCIAL ─────────────────────────────
export async function financialSection(c: Ctx) {
  const r = c.ranges.current;
  const [cur, prev, out, trend, status, methods, byDoc, services] = await Promise.all([
    coreFinancials(c.s, c.es, r),
    c.compare ? coreFinancials(c.s, c.es, prevOf(c)) : Promise.resolve(null),
    outstanding(c.s),
    financialTrend(c),
    paymentStatus(c.s, r),
    collectedByMethod(c.s, r),
    collectedByDoctor(c.s, r),
    billedByService(c.s, r),
  ]);
  const names = await doctorNames(c.s.clinicId, Array.from(byDoc.keys()).filter((k) => k !== UNASSIGNED));
  const revenueByDoctor = Array.from(byDoc.entries())
    .map(([id, amount]) => ({ doctorId: id === UNASSIGNED ? null : id, name: id === UNASSIGNED ? null : names.get(id) ?? "", unassigned: id === UNASSIGNED, collected: round3(amount) }))
    .sort((a, b) => b.collected - a.collected || String(a.doctorId).localeCompare(String(b.doctorId)));
  return {
    ...envelope("financial", c),
    netKind: cur.netKind,
    kpis: {
      collected: cmp(c, cur.collected, prev?.collected ?? null),
      invoiced: cmp(c, cur.invoiced, prev?.invoiced ?? null),
      expenses: cmp(c, cur.businessExpenses, prev?.businessExpenses ?? null),
      netCash: cmp(c, cur.netCash, prev?.netCash ?? null),
    },
    outstanding: out,
    paymentStatus: status,
    trend,
    collectedByMethod: methods,
    revenueByDoctor,
    billedByService: services,
    expenses: {
      // personal money is the owner's household — returned only when the whole clinic is in scope, and never inside the business figures
      totals: c.s.clinicWide ? cur.expenses.totals : { ...cur.expenses.totals, personal: 0 },
      byCategory: cur.expenses.byCategory.map((x) => ({ category: x.category, total: round3(x.total - x.personal), clinic: x.clinic, doctor: x.doctor })).filter((x) => x.total > 0),
      byDoctor: c.s.clinicWide ? cur.expenses.byDoctor : cur.expenses.byDoctor.filter((d) => d.doctorId === (c.s.doctorId ?? "")),
      pending: cur.expenses.pending,
    },
  };
}

// ───────────────────────────── APPOINTMENTS (+ WALK-IN) ─────────────────────────────
export async function appointmentsSection(c: Ctx) {
  const r = c.ranges.current, g = c.ranges.granularity;
  const [cur, prev, byDay, wd, hr, wiHr] = await Promise.all([
    appointmentBreakdown(c.s, r),
    c.compare ? appointmentBreakdown(c.s, prevOf(c)) : Promise.resolve(null),
    appointmentsByDay(c.s, r),
    appointmentsByWeekday(c.s, r),
    appointmentsByHour(c.s, r),
    appointmentsByHour(c.s, r, true),
  ]);
  const rt = appointmentRates(cur), prt = prev ? appointmentRates(prev) : null;
  const pick = (f: "total" | "completed" | "walkIn") => rollup(new Map(Array.from(byDay.entries()).map(([k, v]) => [k, v[f]])), r, g);
  const T = pick("total"), Cm = pick("completed"), W = pick("walkIn");
  const ids = Array.from(cur.perDoctor.keys());
  const names = await doctorNames(c.s.clinicId, ids);
  const byDoctor = c.s.clinicWide || c.s.doctorId
    ? ids.map((id) => ({ doctorId: id, name: names.get(id) ?? "", ...cur.perDoctor.get(id)! })).sort((a, b) => b.total - a.total || a.doctorId.localeCompare(b.doctorId))
    : [];
  const wdRows = WEEKDAYS.map((name, i) => ({ weekday: name, appointments: wd[i] }));
  const hrRows = hr.map((n, h) => ({ hour: h, appointments: n }));
  const wdTop = topOf(wdRows, (x) => x.appointments, (x) => x.weekday), hrTop = topOf(hrRows, (x) => x.appointments, (x) => String(x.hour).padStart(2, "0"));
  return {
    ...envelope("appointments", c),
    kpis: {
      total: cmp(c, cur.total, prev?.total ?? null, 0),
      completed: cmp(c, cur.byStatus.completed, prev?.byStatus.completed ?? null, 0),
      cancelled: cmp(c, cur.byStatus.cancelled, prev?.byStatus.cancelled ?? null, 0),
      noShow: cmp(c, cur.byStatus.no_show, prev?.byStatus.no_show ?? null, 0),
      open: cmp(c, cur.byStatus.scheduled + cur.byStatus.confirmed, prev ? prev.byStatus.scheduled + prev.byStatus.confirmed : null, 0),
      completionRate: cmp(c, rt.completionRate, prt?.completionRate ?? null, 1),
      cancellationRate: cmp(c, rt.cancellationRate, prt?.cancellationRate ?? null, 1),
      noShowRate: cmp(c, rt.noShowRate, prt?.noShowRate ?? null, 1),
    },
    byStatus: cur.byStatus,
    bySource: cur.bySource,
    trend: { granularity: g, points: T.map((p, i) => ({ key: p.key, total: p.value, completed: Cm[i].value, walkIn: W[i].value })) },
    byDoctor,
    byWeekday: wdRows,
    byHour: hrRows,
    peaks: { weekday: wdTop ? { weekday: wdTop.weekday, appointments: wdTop.appointments } : null, hour: hrTop ? { hour: hrTop.hour, appointments: hrTop.appointments } : null },
    walkIn: {
      kpis: {
        total: cmp(c, cur.walkIn.total, prev?.walkIn.total ?? null, 0),
        completed: cmp(c, cur.walkIn.completed, prev?.walkIn.completed ?? null, 0),
        share: cmp(c, rt.walkInShare, prt?.walkInShare ?? null, 1),
        completionRate: cmp(c, rt.walkInCompletionRate, prt?.walkInCompletionRate ?? null, 1),
      },
      byHour: wiHr.map((n, h) => ({ hour: h, walkIns: n })),
      byDoctor: byDoctor.map((d) => ({ doctorId: d.doctorId, name: d.name, walkIns: d.walkIn, completed: d.walkInCompleted })).filter((d) => d.walkIns > 0),
    },
  };
}

// ───────────────────────────── PATIENTS ─────────────────────────────
export async function patientsSection(c: Ctx) {
  const r = c.ranges.current, g = c.ranges.granularity;
  const [cur, prev, seenDay, regDay, reg, regPrev, total] = await Promise.all([
    patientVisitStats(c.s, r),
    c.compare ? patientVisitStats(c.s, prevOf(c)) : Promise.resolve(null),
    patientsSeenByDay(c.s, r),
    c.s.clinicWide ? registrationsByDay(c.s, r) : Promise.resolve(null),
    c.s.clinicWide ? registeredPatients(c.s, r) : Promise.resolve(null),
    c.s.clinicWide && c.compare ? registeredPatients(c.s, prevOf(c)) : Promise.resolve(null),
    c.s.clinicWide ? totalPatients(c.s, r) : Promise.resolve(null),
  ]);
  const seenS = rollup(seenDay, r, g), regS = regDay ? rollup(regDay, r, g) : null;
  return {
    ...envelope("patients", c),
    kpis: {
      seen: cmp(c, cur.seen, prev?.seen ?? null, 0),
      newPatients: cmp(c, cur.newPatients, prev?.newPatients ?? null, 0),
      returningPatients: cmp(c, cur.returningPatients, prev?.returningPatients ?? null, 0),
      completedVisits: cmp(c, cur.completedVisits, prev?.completedVisits ?? null, 0),
      visitsPerPatient: cmp(c, cur.visitsPerPatient, prev?.visitsPerPatient ?? null, 2),
      registered: reg === null ? null : cmp(c, reg, regPrev, 0),
    },
    totalPatients: total,
    newVsReturning: { new: cur.newPatients, returning: cur.returningPatients },
    trend: { granularity: g, points: seenS.map((p, i) => ({ key: p.key, seen: p.value, registered: regS ? regS[i].value : null })) },
    notes: { retention: "deferred" },
  };
}

// ───────────────────────────── TREATMENTS (+ DENTAL) ─────────────────────────────
export async function treatmentsSection(c: Ctx) {
  const kind = treatmentKindOf(c.clinic.specialty);
  if (!kind) throw new PolicyError(404, "SECTION_NOT_AVAILABLE", "Treatment analytics are not available for this clinic's specialty");
  const [cur, prev] = await Promise.all([treatmentStats(c.s, c.ranges.current, kind), c.compare ? treatmentStats(c.s, prevOf(c), kind) : Promise.resolve(null)]);
  const names = await doctorNames(c.s.clinicId, cur.byDoctor.map((d) => d.doctorId ?? ""));
  const count = (code: string) => cur.byProcedure.find((p) => p.code === code)?.count ?? 0;
  return {
    ...envelope("treatments", c),
    kind,
    kpis: {
      completed: cmp(c, cur.completed, prev?.completed ?? null, 0),
      planned: cur.planned === null ? null : cmp(c, cur.planned, prev?.planned ?? null, 0),
      started: cur.started === null ? null : cmp(c, cur.started, prev?.started ?? null, 0),
      cancelled: cur.cancelled === null ? null : cmp(c, cur.cancelled, prev?.cancelled ?? null, 0),
      completionRate: cur.completionRate === null ? null : cmp(c, cur.completionRate, prev?.completionRate ?? null, 1),
      estimatedValue: cmp(c, cur.estimatedValue, prev?.estimatedValue ?? null),
    },
    invoicing: { invoiced: cur.invoiced, notInvoiced: cur.notInvoiced },
    byProcedure: cur.byProcedure,
    byDoctor: cur.byDoctor.map((d) => ({ ...d, name: d.doctorId ? names.get(d.doctorId) ?? "" : null, unassigned: !d.doctorId })),
    dental: kind === "dental" ? { crown: count("crown"), filling: count("filling"), topTeeth: cur.topTeeth } : null,
  };
}

// ───────────────────────────── EXPENSES ─────────────────────────────
export async function expensesSection(c: Ctx) {
  const r = c.ranges.current, g = c.ranges.granularity;
  const [cur, prev, all, clin, doc] = await Promise.all([
    coreFinancials(c.s, c.es, r),
    c.compare ? coreFinancials(c.s, c.es, prevOf(c)) : Promise.resolve(null),
    expenseSeriesFor(c.es, r, "business"),
    expenseSeriesFor(c.es, r, "clinic"),
    expenseSeriesFor(c.es, r, "doctor"),
  ]);
  const A = rollup(all, r, g), Cl = rollup(clin, r, g), D = rollup(doc, r, g);
  const e = cur.expenses, pe = prev?.expenses ?? null;
  const top = topOf(e.byCategory, (x) => x.total - x.personal, (x) => x.category);
  return {
    ...envelope("expenses", c),
    kpis: {
      total: cmp(c, e.totals.business, pe?.totals.business ?? null),
      clinic: c.s.level === "self" ? null : cmp(c, e.totals.clinic, pe?.totals.clinic ?? null),
      doctor: cmp(c, e.totals.doctor, pe?.totals.doctor ?? null),
    },
    // the owner's personal expenses are shown (muted, separate) only when the whole clinic is in scope — they are never part of `total`
    personal: c.s.clinicWide ? e.totals.personal : null,
    pending: e.pending,
    byCategory: e.byCategory.map((x) => ({ category: x.category, total: round3(x.total - x.personal), clinic: x.clinic, doctor: x.doctor })).filter((x) => x.total > 0),
    byDoctor: c.s.clinicWide ? e.byDoctor : e.byDoctor.filter((d) => d.doctorId === (c.s.doctorId ?? "")),
    largestCategory: top ? { category: top.category, total: round3(top.total - top.personal) } : null,
    trend: { granularity: g, points: A.map((p, i) => ({ key: p.key, total: round3(p.value), clinic: round3(Cl[i].value), doctor: round3(D[i].value) })) },
  };
}

// ───────────────────────────── DOCTORS (performance / comparison) ─────────────────────────────
/**
 * One row per doctor. Operational + financial only — no score, no ranking by "quality".
 *   Collected revenue   = Σ payments on invoices attributed to the doctor (financial.ts)
 *   Attributed expenses = expenses explicitly assigned to the doctor (Phase 5 ledger). Shared clinic expenses are NOT allocated.
 *   Net contribution    = collected − attributed expenses
 *   Avg collected / completed visit = collected ÷ completed appointments (cash basis: a payment may relate to an earlier visit)
 * `unassigned` = revenue on legacy invoices that have no treating doctor (kept apart, never given to anybody).
 * An owner sees every doctor; a doctor sees only their own row (the scope guarantees it, and the filter below double-checks).
 */
export async function doctorsSection(c: Ctx) {
  const r = c.ranges.current;
  const kind = treatmentKindOf(c.clinic.specialty);
  const [appt, byDoc, seen, treat, fin] = await Promise.all([
    appointmentBreakdown(c.s, r),
    collectedByDoctor(c.s, r),
    patientsSeenByDoctor(c.s, r),
    kind ? treatmentStats(c.s, r, kind) : Promise.resolve(null),
    coreFinancials(c.s, c.es, r),
  ]);
  const users: any[] = await User.find({ clinicId: c.s.clinicId, role: "doctor", ...(c.s.doctorId ? { _id: c.s.doctorId } : {}) }).select("name isActive").lean();
  const known = new Map(users.map((u) => [String(u._id), u]));
  const ids = new Set<string>(users.filter((u) => u.isActive || appt.perDoctor.has(String(u._id)) || byDoc.has(String(u._id))).map((u) => String(u._id)));
  // a doctor referenced by data but no longer a user of this clinic is never invented: only ids that resolve to a clinic doctor are rows
  const expByDoc = new Map(fin.expenses.byDoctor.map((d) => [d.doctorId, d.total]));
  const trByDoc = new Map((treat?.byDoctor ?? []).filter((d) => d.doctorId).map((d) => [d.doctorId as string, d.count]));
  const rows = Array.from(ids)
    .filter((id) => known.has(id) && (!c.s.doctorId || id === c.s.doctorId))
    .map((id) => {
      const a = appt.perDoctor.get(id) ?? { total: 0, completed: 0, cancelled: 0, noShow: 0, walkIn: 0, walkInCompleted: 0 };
      const collected = byDoc.get(id) ?? 0, exp = expByDoc.get(id) ?? 0;
      return {
        doctorId: id,
        name: known.get(id).name as string,
        active: !!known.get(id).isActive,
        appointments: a.total,
        completedVisits: a.completed,
        walkIns: a.walkIn,
        cancelled: a.cancelled,
        noShow: a.noShow,
        cancellationRate: ratePct(a.cancelled, a.total),
        noShowRate: ratePct(a.noShow, a.total),
        patientsSeen: seen.get(id) ?? 0,
        treatmentsCompleted: kind ? trByDoc.get(id) ?? 0 : null,
        collected: round3(collected),
        attributedExpenses: round3(exp),
        netContribution: round3(collected - exp),
        avgCollectedPerVisit: perUnit(collected, a.completed),
      };
    })
    .sort((a, b) => b.collected - a.collected || a.name.localeCompare(b.name));
  const unassigned = c.s.clinicWide ? round3(byDoc.get(UNASSIGNED) ?? 0) : null;
  return {
    ...envelope("doctors", c),
    comparison_enabled: c.s.clinicWide,
    rows,
    unassignedRevenue: unassigned,
    // clinic-level figures kept OUT of every doctor row (owner only): shared expenses are never allocated
    clinic: c.s.clinicWide
      ? { collected: fin.collected, businessExpenses: fin.businessExpenses, sharedClinicExpenses: fin.expenses.totals.clinic, doctorAttributedExpenses: fin.expenses.totals.doctor, netCash: fin.netCash }
      : null,
    treatmentKind: kind,
  };
}

// ───────────────────────────── LOYALTY ─────────────────────────────
export async function loyaltySection(c: Ctx) {
  if (!c.clinic.loyaltyEntitled) throw new PolicyError(403, "ADDON_NOT_ACTIVE", "Loyalty is not active for this clinic");
  const stats = await loyaltyStats(c.s, c.ranges.current, c.ranges.granularity);
  return { ...envelope("loyalty", c), ...stats };
}
