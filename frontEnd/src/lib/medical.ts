import type { Patient } from "@/lib/types";

/**
 * NEW FILE — the structured medical-history questions on a patient file.
 * IMPORTANT: keep the keys in sync with backEnd/src/config/medicalHistory.ts
 *
 * Labels live in lib/i18n.tsx as `med.<key>`; the placeholder shown in the
 * details field when the checkbox is turned on is `med.<key>.ph`.
 */
export type MedicalKey =
  | "diabetes" | "hypertension" | "heartDisease" | "respiratory" | "thyroid"
  | "kidneyDisease" | "liverDisease" | "bloodDisorder" | "neurological" | "cancer"
  | "otherChronic"
  | "drugAllergy" | "foodAllergy" | "latexAllergy" | "anesthesiaAllergy" | "otherAllergy"
  | "currentMedications" | "bloodThinners" | "previousSurgeries" | "familyHistory"
  | "infectiousDisease"
  | "smoking" | "pregnant" | "breastfeeding";

export interface MedicalGroup {
  id: "chronic" | "allergies" | "history" | "lifestyle";
  keys: MedicalKey[];
}

export const MEDICAL_GROUPS: MedicalGroup[] = [
  {
    id: "chronic",
    keys: [
      "diabetes", "hypertension", "heartDisease", "respiratory", "thyroid",
      "kidneyDisease", "liverDisease", "bloodDisorder", "neurological", "cancer", "otherChronic",
    ],
  },
  { id: "allergies", keys: ["drugAllergy", "foodAllergy", "latexAllergy", "anesthesiaAllergy", "otherAllergy"] },
  { id: "history", keys: ["currentMedications", "bloodThinners", "previousSurgeries", "familyHistory", "infectiousDisease"] },
  { id: "lifestyle", keys: ["smoking", "pregnant", "breastfeeding"] },
];

export const ALL_MEDICAL_KEYS: MedicalKey[] = MEDICAL_GROUPS.flatMap((g) => g.keys);

/** Only asked for female patients (or when gender isn't set yet). */
export const FEMALE_ONLY: MedicalKey[] = ["pregnant", "breastfeeding"];

/**
 * How loudly a "yes" should be shown across the app:
 *  - critical → red: must be seen before any procedure or prescription
 *  - caution  → amber: important context
 *  - info     → neutral
 */
export type Severity = "critical" | "caution" | "info";

const CRITICAL: MedicalKey[] = [
  "drugAllergy", "foodAllergy", "latexAllergy", "anesthesiaAllergy", "otherAllergy",
  "bloodThinners", "pregnant", "infectiousDisease", "bloodDisorder",
];
const CAUTION: MedicalKey[] = [
  "diabetes", "hypertension", "heartDisease", "respiratory", "kidneyDisease", "liverDisease",
  "neurological", "cancer", "breastfeeding", "currentMedications", "thyroid",
];

export const severityOf = (k: MedicalKey): Severity =>
  CRITICAL.includes(k) ? "critical" : CAUTION.includes(k) ? "caution" : "info";

export interface ActiveFlag {
  key: MedicalKey;
  details?: string;
  severity: Severity;
}

/** Every question answered "yes", most severe first. */
export function activeFlags(p: Pick<Patient, "medicalHistory">): ActiveFlag[] {
  const mh = p.medicalHistory ?? {};
  const order: Record<Severity, number> = { critical: 0, caution: 1, info: 2 };
  return ALL_MEDICAL_KEYS.filter((k) => mh[k]?.has)
    .map((k) => ({ key: k, details: mh[k]?.details, severity: severityOf(k) }))
    .sort((a, b) => order[a.severity] - order[b.severity]);
}

/** True once the medical checklist has been filled at least once. */
export const hasMedicalHistory = (p: Pick<Patient, "medicalHistory">) =>
  !!p.medicalHistory && Object.keys(p.medicalHistory).length > 0;

export const severityPill: Record<Severity, string> = {
  critical: "border border-red-500/40 bg-red-500/15 text-red-400",
  caution: "border border-amber-500/40 bg-amber-500/15 text-amber-400",
  info: "border border-edge bg-soft text-mute",
};

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const MARITAL = ["single", "married", "divorced", "widowed"] as const;
export const REFERRALS = ["social_media", "friend_family", "google", "doctor_referral", "walk_in", "other"] as const;
