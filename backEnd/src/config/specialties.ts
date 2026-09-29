/**
 * ClinicOS Specialty Registry — central source of truth (backend).
 *
 * These are the 12 official ClinicOS specialty categories. `id` is a
 * PERMANENT, stable, machine-readable identifier — it's what gets
 * stored in Clinic.specialty for every NEW clinic from now on
 * (see controllers/authController.ts -> registerSchema).
 *
 * Mirrors frontEnd/src/lib/specialties.ts exactly (same 12 ids/labels).
 * Keep both files in sync by hand — this project runs the frontend and
 * backend as two separate deployments (Next.js on Vercel, Express on
 * Render), so a shared package isn't worth the build complexity for a
 * 12-item list. The same approach is already used for subscription
 * plans: config/plans.ts is backend-only, and the frontend keeps its
 * own small independent copy of the plan labels (see
 * components/admin/PlanBadge.tsx).
 *
 * BACKWARD COMPATIBILITY — READ BEFORE TOUCHING:
 * Existing clinics created before this registry may still have
 * free-text values in Clinic.specialty ("Dentist", "Dental Clinic",
 * "أسنان", etc). Those documents are left untouched on purpose:
 *   - The Mongoose schema (models/Clinic.ts) still declares `specialty`
 *     as a plain required String with NO enum. Adding an enum there
 *     would make Mongoose re-validate the WHOLE document (including
 *     `specialty`) on every future `.save()` of an old clinic — e.g.
 *     an unrelated working-hours edit — and reject it. That would
 *     silently break existing clinics, which is unacceptable.
 *   - SPECIALTY_IDS below is only enforced at the REQUEST layer (Zod),
 *     specifically for the new-signup endpoint. That's a validation of
 *     what a brand-new clinic is allowed to submit, not a validation
 *     of what an existing clinic document is allowed to already contain.
 *   - Never assume a `specialty` value read from the database is one
 *     of these 12 ids — always fall back safely (see
 *     getSpecialtyLabel below), never throw, never hide the legacy
 *     value.
 */

export interface SpecialtyDef {
  id: string;
  en: string;
  ar: string;
}

export const SPECIALTIES = [
  { id: "dentistry", en: "Dentistry", ar: "طب الأسنان" },
  {
    id: "dermatology_aesthetics",
    en: "Dermatology & Aesthetic Medicine",
    ar: "الجلدية والتجميل",
  },
  { id: "obgyn", en: "Obstetrics & Gynecology", ar: "النسائية والتوليد" },
  { id: "pediatrics", en: "Pediatrics", ar: "طب الأطفال" },
  {
    id: "internal_medicine",
    en: "Internal Medicine & Medical Specialties",
    ar: "الباطنية والتخصصات الطبية",
  },
  {
    id: "orthopedics_rehab",
    en: "Orthopedics & Rehabilitation",
    ar: "العظام والمفاصل والتأهيل",
  },
  { id: "ophthalmology", en: "Ophthalmology", ar: "طب وجراحة العيون" },
  { id: "ent", en: "ENT", ar: "الأنف والأذن والحنجرة" },
  {
    id: "neurology_mental_health",
    en: "Neurology & Mental Health",
    ar: "الأعصاب والصحة النفسية",
  },
  {
    id: "surgery",
    en: "Surgery & Surgical Specialties",
    ar: "الجراحة والتخصصات الجراحية",
  },
  {
    id: "general_family_medicine",
    en: "General & Family Medicine",
    ar: "الطب العام وطب الأسرة",
  },
  {
    id: "diagnostics",
    en: "Radiology, Laboratory & Diagnostics",
    ar: "الأشعة والمختبرات والتشخيص",
  },
] as const satisfies readonly SpecialtyDef[];

/** Every valid id for a NEW clinic. Used directly by z.enum() in authController. */
export type SpecialtyId = (typeof SPECIALTIES)[number]["id"];

export const SPECIALTY_IDS = SPECIALTIES.map((s) => s.id) as [SpecialtyId, ...SpecialtyId[]];

const byId = new Map<string, SpecialtyDef>(SPECIALTIES.map((s) => [s.id, s]));

export const isRegistrySpecialty = (value: string): value is SpecialtyId => byId.has(value);

/**
 * Safe display helper — never throws, never returns undefined.
 * - Known registry id (new clinics)      -> localized label.
 * - Legacy free-text value (old clinics) -> the original string, as-is.
 */
export function getSpecialtyLabel(value: string, lang: "en" | "ar" = "en"): string {
  const def = byId.get(value);
  if (!def) return value; // legacy clinic — show exactly what's stored, never hide it
  return lang === "ar" ? def.ar : def.en;
}
