import { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { Clinic } from "../models/Clinic";
import { User } from "../models/User";
import { hasAddon } from "../services/addons";
import { PolicyError, accessOf } from "../auth/policy";
import { analyticsScope, expenseScopeOf } from "../services/analytics/scope";
import { resolveRanges, PRESETS, MAX_RANGE_DAYS, WEEK_STARTS_ON } from "../services/analytics/range";
import { availableSections, treatmentKindOf, type Ctx } from "../services/analytics/context";
import { overviewSection, financialSection, appointmentsSection, patientsSection, treatmentsSection, expensesSection, doctorsSection, loyaltySection } from "../services/analytics/sections";
import { toCsv } from "../services/analytics/export";

/**
 * PHASE 6 — /api/analytics/*. Thin: authenticate → derive scope from the DATABASE identity → resolve the clinic-local range →
 * call ONE section builder (services/analytics/sections.ts) → send. The route gate (requireAccess("reports"), plus "reportsClinic"
 * for the clinic-wide-only sections) runs before any of this; the checks here are a second, independent layer.
 *
 * Nothing the client sends can widen the scope: clinicId is never read from the request, a doctor's scope is always their own id,
 * and every query value must be a plain string (an object / array from ?a[$ne]=x is a 400).
 */
async function buildCtx(req: Request): Promise<Ctx> {
  const s = analyticsScope(req);
  const es = expenseScopeOf(req);
  const q = req.query as Record<string, unknown>;
  const ranges = resolveRanges({ preset: q.preset, from: q.from, to: q.to });
  const cmpRaw = q.compare;
  if (cmpRaw !== undefined && typeof cmpRaw !== "string") throw new PolicyError(400, "INVALID_FILTER", "Invalid compare flag");
  // an owner narrowing to a doctor must name a doctor OF THIS CLINIC — another clinic's id (or a non-doctor) is "not found", never an empty 200
  if (s.level === "clinic" && s.doctorId && !(await User.exists({ _id: s.doctorId, clinicId: s.clinicId, role: "doctor" }))) throw new PolicyError(404, "DOCTOR_NOT_FOUND", "Doctor not found");
  const clinic = await Clinic.findById(s.clinicId).select("specialty status planExpiresAt addons").lean();
  if (!clinic) throw new PolicyError(404, "CLINIC_NOT_FOUND", "Clinic not found");
  return {
    s,
    es,
    ranges,
    clinic: { specialty: String((clinic as any).specialty ?? ""), loyaltyEntitled: hasAddon(clinic as any, "loyalty") },
    compare: cmpRaw !== "0" && cmpRaw !== "false",
  };
}

const BUILDERS = {
  overview: overviewSection,
  financial: financialSection,
  appointments: appointmentsSection,
  patients: patientsSection,
  treatments: treatmentsSection,
  doctors: doctorsSection,
  expenses: expensesSection,
  loyalty: loyaltySection,
} as const;
export type SectionName = keyof typeof BUILDERS;
const isSection = (v: unknown): v is SectionName => typeof v === "string" && Object.prototype.hasOwnProperty.call(BUILDERS, v);

const noStore = (res: Response) => res.set("Cache-Control", "no-store");

export const section = (name: SectionName) =>
  asyncHandler(async (req: Request, res: Response) => {
    const ctx = await buildCtx(req);
    noStore(res);
    return res.json(await BUILDERS[name](ctx));
  });

/** GET /api/analytics/meta — what this caller may open (tabs), the presets, and the clinic-local "today". No figures. */
export const meta = asyncHandler(async (req: Request, res: Response) => {
  const ctx = await buildCtx(req);
  noStore(res);
  return res.json({
    sections: availableSections(ctx),
    role: ctx.s.role,
    scope: { level: ctx.s.level, doctorId: ctx.s.doctorId ?? null, clinicWide: ctx.s.clinicWide },
    canCompareDoctors: ctx.s.canSeeClinicWide,
    treatmentKind: treatmentKindOf(ctx.clinic.specialty),
    presets: PRESETS,
    maxRangeDays: MAX_RANGE_DAYS,
    weekStartsOn: WEEK_STARTS_ON,
    timeZone: ctx.ranges.timeZone,
    today: ctx.ranges.today,
    range: { from: ctx.ranges.current.from, to: ctx.ranges.current.to },
  });
});

/** GET /api/analytics/export?section=<name>&format=csv + the same filters. Same scope, same builder, same numbers as the screen. */
export const exportSection = asyncHandler(async (req: Request, res: Response) => {
  const sec = req.query.section;
  const format = req.query.format ?? "csv";
  if (!isSection(sec)) throw new PolicyError(400, "INVALID_SECTION", "Unknown section");
  if (format !== "csv") throw new PolicyError(400, "INVALID_FORMAT", "Only CSV export is supported");
  if (sec === "loyalty" && accessOf(req.role, "reportsClinic") === "none") throw new PolicyError(403, "FORBIDDEN_ROLE", "Forbidden");
  const ctx = await buildCtx(req);
  if (!availableSections(ctx).includes(sec)) throw new PolicyError(404, "SECTION_NOT_AVAILABLE", "This section is not available");
  const data = await BUILDERS[sec](ctx);
  const { filename, body } = toCsv(sec, data as any);
  noStore(res);
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`);
  res.set("X-Content-Type-Options", "nosniff");
  return res.send(body);
});
