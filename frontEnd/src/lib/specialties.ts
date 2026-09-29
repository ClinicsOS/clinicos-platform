import {
  IconDental,
  IconSparkles,
  IconGenderFemale,
  IconBabyCarriage,
  IconStethoscope,
  IconBone,
  IconEye,
  IconEar,
  IconBrain,
  IconCut,
  IconFirstAidKit,
  IconMicroscope,
  type TablerIcon,
} from "@tabler/icons-react";

/**
 * ClinicOS Specialty Registry — central source of truth (frontend).
 *
 * Mirrors backEnd/src/config/specialties.ts exactly — same 12 ids and
 * labels. Keep both files in sync by hand; this project runs the
 * frontend and backend as two separate deployments (Next.js on Vercel,
 * Express on Render), so a shared package isn't worth the added build
 * complexity for a 12-item list — the same approach already used for
 * subscription plans (see components/admin/PlanBadge.tsx, which keeps
 * its own small independent copy of the plan labels rather than
 * importing backEnd/src/config/plans.ts).
 *
 * `id` is a PERMANENT, stable, machine-readable identifier — the value
 * a NEW signup submits and Clinic.specialty stores. Existing clinics
 * may still hold pre-registry free-text values (e.g. "Dentist",
 * "أسنان") — those are untouched. Never assume a `specialty` string
 * you read from the API is one of these 12 ids; always go through
 * getSpecialtyLabel() below, which falls back safely.
 *
 * TEMPORARY ICONS: SPECIALTY_ICONS below uses @tabler/icons-react,
 * already installed in this project, as a placeholder. To swap in the
 * final 3D icon set, replace the values in that one map with an <img
 * src="/specialty-icons/<id>.webp" /> (or similar) — every place that
 * renders a specialty icon reads from this single map, so nothing
 * else in the app needs to change.
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

export type SpecialtyId = (typeof SPECIALTIES)[number]["id"];

/** Temporary icon fallback — one Tabler icon per specialty. See note above before swapping for final 3D assets. */
export const SPECIALTY_ICONS: Record<SpecialtyId, TablerIcon> = {
  dentistry: IconDental,
  dermatology_aesthetics: IconSparkles,
  obgyn: IconGenderFemale,
  pediatrics: IconBabyCarriage,
  internal_medicine: IconStethoscope,
  orthopedics_rehab: IconBone,
  ophthalmology: IconEye,
  ent: IconEar,
  neurology_mental_health: IconBrain,
  surgery: IconCut,
  general_family_medicine: IconFirstAidKit,
  diagnostics: IconMicroscope,
};

/** Generic fallback icon for a legacy/unrecognized specialty value. */
export const DEFAULT_SPECIALTY_ICON: TablerIcon = IconStethoscope;

const byId = new Map<string, SpecialtyDef>(SPECIALTIES.map((s) => [s.id, s]));

export const isRegistrySpecialty = (value: string): value is SpecialtyId => byId.has(value);

/**
 * Safe display helper — never throws, never returns undefined/blank.
 * - Known registry id (new clinics)      -> localized label.
 * - Legacy free-text value (old clinics) -> the original string, as-is.
 */
export function getSpecialtyLabel(value: string | undefined | null, lang: "en" | "ar"): string {
  if (!value) return "";
  const def = byId.get(value);
  if (!def) return value; // legacy clinic — show exactly what's stored, never hide it
  return lang === "ar" ? def.ar : def.en;
}

/** Icon for a specialty value; falls back to a generic one for legacy/unknown values. */
export function getSpecialtyIcon(value: string | undefined | null): TablerIcon {
  if (value && isRegistrySpecialty(value)) return SPECIALTY_ICONS[value];
  return DEFAULT_SPECIALTY_ICON;
}
