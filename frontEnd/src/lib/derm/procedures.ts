import type { RecordType, RegionGroup } from "./regions";

/**
 * Dermatology & Aesthetic Medicine — PROCEDURE CATALOG (Phase 2), frontend twin of backEnd/src/config/dermProcedures.ts.
 *
 * DOCUMENTATION categories only: they record what the clinician decided / did. Nothing here recommends a procedure, a
 * dose, a unit, a volume, a device setting or a technique. Codes, record types and metadata kinds must match the backend
 * (scripts/check-derm-registry-sync.js fails otherwise). `category` and the labels are UI-only. A code is never renamed.
 * All procedure labels live HERE (one place) — components never carry procedure strings.
 */
export const PROCEDURE_CATALOG_VERSION = 1;

export type MetadataKind = "none" | "product" | "device" | "product_device";
export const METADATA_KINDS: readonly MetadataKind[] = ["none", "product", "device", "product_device"];

export type ProcedureCategory =
  | "derm_medical" | "derm_minor" | "derm_light"
  | "aes_injectables" | "aes_skin" | "aes_devices" | "aes_hair_body";

export interface ProcedureDef {
  code: string;
  recordType: RecordType;
  metadata: MetadataKind;
  category: ProcedureCategory;
  labels: { en: string; ar: string };
}

const P = (recordType: RecordType, category: ProcedureCategory, metadata: MetadataKind, code: string, en: string, ar: string): ProcedureDef => ({ code, recordType, metadata, category, labels: { en, ar } });

export const PROCEDURES: readonly ProcedureDef[] = [
  // ---- Dermatology — medical / clinical treatments
  P("dermatology", "derm_medical", "product", "topical_treatment", "Topical Treatment", "علاج موضعي (دهان)"),
  P("dermatology", "derm_medical", "none", "oral_systemic_treatment", "Oral / Systemic Treatment", "علاج فموي / جهازي"),
  P("dermatology", "derm_medical", "product", "local_treatment", "Local Treatment", "علاج موضعي مباشر"),
  P("dermatology", "derm_medical", "product", "intralesional_treatment", "Intralesional Treatment", "علاج داخل الآفة"),
  P("dermatology", "derm_medical", "product", "dressing_wound_care", "Dressing / Wound Care", "تضميد / عناية بالجروح"),
  // ---- Dermatology — minor procedures
  P("dermatology", "derm_minor", "device", "cryotherapy", "Cryotherapy", "العلاج بالتبريد"),
  P("dermatology", "derm_minor", "device", "electrocautery", "Electrocautery", "الكي الكهربائي"),
  P("dermatology", "derm_minor", "none", "curettage", "Curettage", "كشط"),
  P("dermatology", "derm_minor", "none", "minor_procedure", "Minor Dermatologic Procedure", "إجراء جلدي صغير"),
  P("dermatology", "derm_minor", "none", "lesion_removal", "Lesion Removal", "إزالة آفة"),
  P("dermatology", "derm_minor", "none", "biopsy", "Biopsy", "خزعة"),
  // ---- Dermatology — light / laser
  P("dermatology", "derm_light", "device", "phototherapy", "Phototherapy", "العلاج الضوئي"),
  P("dermatology", "derm_light", "device", "medical_laser", "Medical Laser Treatment", "علاج بالليزر الطبي"),
  // ---- Aesthetic — injectables
  P("aesthetic", "aes_injectables", "product", "botulinum_toxin", "Botulinum Toxin Procedure", "إجراء البوتوكس (توكسين البوتولينوم)"),
  P("aesthetic", "aes_injectables", "product", "dermal_filler", "Dermal Filler Procedure", "إجراء الفيلر"),
  P("aesthetic", "aes_injectables", "product", "skin_booster", "Skin Booster Procedure", "إجراء محفّزات الجلد (سكين بوستر)"),
  P("aesthetic", "aes_injectables", "product", "mesotherapy", "Mesotherapy", "الميزوثيرابي"),
  P("aesthetic", "aes_injectables", "product", "prp", "PRP", "البلازما الغنية بالصفائح (PRP)"),
  P("aesthetic", "aes_injectables", "product", "thread_procedure", "Thread Procedure", "إجراء الخيوط"),
  // ---- Aesthetic — skin
  P("aesthetic", "aes_skin", "product_device", "microneedling", "Microneedling", "الميكرونيدلنج"),
  P("aesthetic", "aes_skin", "product", "chemical_peel", "Chemical Peel", "التقشير الكيميائي"),
  P("aesthetic", "aes_skin", "product", "facial_treatment", "Facial Treatment", "علاج للوجه (فاشيال)"),
  P("aesthetic", "aes_skin", "none", "scar_treatment", "Scar Treatment", "علاج الندبات"),
  P("aesthetic", "aes_skin", "none", "pigmentation_treatment", "Pigmentation Treatment", "علاج التصبغات"),
  // ---- Aesthetic — energy / light devices
  P("aesthetic", "aes_devices", "device", "laser_hair_reduction", "Laser Hair Reduction", "تقليل الشعر بالليزر"),
  P("aesthetic", "aes_devices", "device", "laser_skin_treatment", "Laser Skin Treatment", "علاج البشرة بالليزر"),
  P("aesthetic", "aes_devices", "device", "ipl_light", "IPL / Light-Based Treatment", "العلاج بالضوء (IPL)"),
  P("aesthetic", "aes_devices", "device", "radiofrequency", "Radiofrequency Treatment", "العلاج بالترددات الراديوية"),
  P("aesthetic", "aes_devices", "device", "hifu_ultrasound", "HIFU / Ultrasound-Based Treatment", "العلاج بالموجات فوق الصوتية (HIFU)"),
  // ---- Aesthetic — hair / body
  P("aesthetic", "aes_hair_body", "none", "hair_scalp_treatment", "Hair / Scalp Treatment", "علاج الشعر / فروة الرأس"),
  P("aesthetic", "aes_hair_body", "none", "body_treatment", "Body Treatment", "علاج للجسم"),
];

export const CATEGORY_LABELS: Record<ProcedureCategory, { recordType: RecordType; en: string; ar: string }> = {
  derm_medical: { recordType: "dermatology", en: "Medical treatments", ar: "علاجات طبية" },
  derm_minor: { recordType: "dermatology", en: "Minor procedures", ar: "إجراءات صغيرة" },
  derm_light: { recordType: "dermatology", en: "Light & laser", ar: "الضوء والليزر" },
  aes_injectables: { recordType: "aesthetic", en: "Injectables", ar: "الحقن التجميلية" },
  aes_skin: { recordType: "aesthetic", en: "Skin treatments", ar: "علاجات البشرة" },
  aes_devices: { recordType: "aesthetic", en: "Energy & light devices", ar: "أجهزة الطاقة والضوء" },
  aes_hair_body: { recordType: "aesthetic", en: "Hair & body", ar: "الشعر والجسم" },
};
export const CATEGORY_ORDER: readonly ProcedureCategory[] = ["derm_medical", "derm_minor", "derm_light", "aes_injectables", "aes_skin", "aes_devices", "aes_hair_body"];

const byCode = new Map(PROCEDURES.map((p) => [p.code, p]));
export const PROCEDURE_CODES: readonly string[] = PROCEDURES.map((p) => p.code);
export const getProcedure = (code: string): ProcedureDef | undefined => byCode.get(code);
export const procedureLabel = (code: string, lang: "en" | "ar"): string => byCode.get(code)?.labels[lang] ?? code;
export const proceduresFor = (recordType: RecordType): ProcedureDef[] => PROCEDURES.filter((p) => p.recordType === recordType);
export const categoriesFor = (recordType: RecordType): ProcedureCategory[] => CATEGORY_ORDER.filter((c) => CATEGORY_LABELS[c].recordType === recordType);
export const allowsProduct = (k: MetadataKind) => k === "product" || k === "product_device";
export const allowsDevice = (k: MetadataKind) => k === "device" || k === "product_device";

// ---------------------------------------------------------------- enums (mirror the backend)
export const PLAN_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const TARGET_TYPES = ["single_region", "multi_region", "general"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];
export const GENERAL_AREAS: readonly RegionGroup[] = ["face", "scalp", "body"];
export const FOLLOWUP_OUTCOMES = ["improved", "unchanged", "worsened", "satisfactory", "needs_further_treatment"] as const;
export type FollowUpOutcome = (typeof FOLLOWUP_OUTCOMES)[number];
export const MAX_PHASE = 20;
export const MAX_TARGET_REGIONS = 12;
export const MAX_TREATMENT_TEXT = { notes: 1000, cancelReason: 300 } as const;
export const MAX_SESSION_TEXT = { procedureNotes: 2000, observations: 2000, outcome: 1000, followUpInstructions: 1000 } as const;
export const MAX_TRACE_TEXT = { name: 120, brand: 120, lot: 60, quantity: 60, unit: 20, productNotes: 300, device: 120, deviceId: 80, settings: 500, notes: 500 } as const;
export const MAX_FOLLOWUP_TEXT = { assessment: 2000, progress: 2000, complications: 2000, notes: 2000, nextStep: 1000, voidNote: 500 } as const;
