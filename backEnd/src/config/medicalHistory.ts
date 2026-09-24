/**
 * NEW FILE — single source of truth for the structured medical-history
 * questions on a patient file. Both the Mongoose schema (models/Patient.ts)
 * and the Zod validation (controllers/patientController.ts) are generated
 * from this list, so adding a new question later is a one-line change here
 * (plus its label in the frontend's lib/medical.ts + i18n).
 *
 * Every key is stored as { has: boolean, details?: string }:
 *   - has     → the checkbox (yes / no)
 *   - details → the free-text field that opens when the checkbox is on
 *               (e.g. "Type 2, on Metformin 500mg since 2019")
 *
 * IMPORTANT: keep this list in sync with frontEnd/src/lib/medical.ts
 */
export const MEDICAL_KEYS = [
  // ---- Chronic conditions ----
  "diabetes",
  "hypertension",
  "heartDisease",
  "respiratory",
  "thyroid",
  "kidneyDisease",
  "liverDisease",
  "bloodDisorder",
  "neurological",
  "cancer",
  "otherChronic",
  // ---- Allergies ----
  "drugAllergy",
  "foodAllergy",
  "latexAllergy",
  "anesthesiaAllergy",
  "otherAllergy",
  // ---- Medications & history ----
  "currentMedications",
  "bloodThinners",
  "previousSurgeries",
  "familyHistory",
  "infectiousDisease",
  // ---- Lifestyle & women's health ----
  "smoking",
  "pregnant",
  "breastfeeding",
] as const;

export type MedicalKey = (typeof MEDICAL_KEYS)[number];

export interface MedicalFlag {
  has: boolean;
  details?: string;
}

export type MedicalHistory = Partial<Record<MedicalKey, MedicalFlag>>;

export const BLOOD_TYPES = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
export const MARITAL_STATUSES = ["single", "married", "divorced", "widowed"] as const;
export const REFERRAL_SOURCES = [
  "social_media",
  "friend_family",
  "google",
  "doctor_referral",
  "walk_in",
  "other",
] as const;
