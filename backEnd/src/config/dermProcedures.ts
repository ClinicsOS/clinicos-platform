import { REGION_GROUPS, validateRegionRefs, type DermRecordType, type RegionRef, type RegionRefInput } from "./dermatology";

/**
 * Dermatology & Aesthetic Medicine — PROCEDURE CATALOG (Phase 2).
 *
 * These are DOCUMENTATION categories: they record what the clinician decided to do / did. The system never recommends
 * a procedure, dose, unit, volume, device setting, technique or product. The stable `code` is what is stored on every
 * treatment item; labels (EN/AR) live in the frontend twin `frontEnd/src/lib/derm/procedures.ts`
 * (scripts/check-derm-registry-sync.js fails when the two drift). A code is never renamed or reused.
 *
 * `metadata` decides which OPTIONAL traceability block a session may carry — nothing more:
 *   none            no extra block
 *   product         product name / brand / lot / expiry / quantity used   (documentation only)
 *   device          device / identifier / settings summary / notes         (documentation only)
 *   product_device  both blocks
 */
export const PROCEDURE_CATALOG_VERSION = 1;

/**
 * Display names (EN / AR) of every procedure code. They exist on the backend ONLY so a session can store a SNAPSHOT of the
 * name that was current when the work was documented — renaming a label later never changes what an old record says.
 * They must equal the frontend twin (`frontEnd/src/lib/derm/procedures.ts`); scripts/check-derm-registry-sync.js fails when they drift.
 */
export const PROCEDURE_LABELS: Readonly<Record<string, { en: string; ar: string }>> = {
  topical_treatment: { en: "Topical Treatment", ar: "علاج موضعي (دهان)" },
  oral_systemic_treatment: { en: "Oral / Systemic Treatment", ar: "علاج فموي / جهازي" },
  local_treatment: { en: "Local Treatment", ar: "علاج موضعي مباشر" },
  intralesional_treatment: { en: "Intralesional Treatment", ar: "علاج داخل الآفة" },
  dressing_wound_care: { en: "Dressing / Wound Care", ar: "تضميد / عناية بالجروح" },
  cryotherapy: { en: "Cryotherapy", ar: "العلاج بالتبريد" },
  electrocautery: { en: "Electrocautery", ar: "الكي الكهربائي" },
  curettage: { en: "Curettage", ar: "كشط" },
  minor_procedure: { en: "Minor Dermatologic Procedure", ar: "إجراء جلدي صغير" },
  lesion_removal: { en: "Lesion Removal", ar: "إزالة آفة" },
  biopsy: { en: "Biopsy", ar: "خزعة" },
  phototherapy: { en: "Phototherapy", ar: "العلاج الضوئي" },
  medical_laser: { en: "Medical Laser Treatment", ar: "علاج بالليزر الطبي" },
  botulinum_toxin: { en: "Botulinum Toxin Procedure", ar: "إجراء البوتوكس (توكسين البوتولينوم)" },
  dermal_filler: { en: "Dermal Filler Procedure", ar: "إجراء الفيلر" },
  skin_booster: { en: "Skin Booster Procedure", ar: "إجراء محفّزات الجلد (سكين بوستر)" },
  mesotherapy: { en: "Mesotherapy", ar: "الميزوثيرابي" },
  prp: { en: "PRP", ar: "البلازما الغنية بالصفائح (PRP)" },
  thread_procedure: { en: "Thread Procedure", ar: "إجراء الخيوط" },
  microneedling: { en: "Microneedling", ar: "الميكرونيدلنج" },
  chemical_peel: { en: "Chemical Peel", ar: "التقشير الكيميائي" },
  facial_treatment: { en: "Facial Treatment", ar: "علاج للوجه (فاشيال)" },
  scar_treatment: { en: "Scar Treatment", ar: "علاج الندبات" },
  pigmentation_treatment: { en: "Pigmentation Treatment", ar: "علاج التصبغات" },
  laser_hair_reduction: { en: "Laser Hair Reduction", ar: "تقليل الشعر بالليزر" },
  laser_skin_treatment: { en: "Laser Skin Treatment", ar: "علاج البشرة بالليزر" },
  ipl_light: { en: "IPL / Light-Based Treatment", ar: "العلاج بالضوء (IPL)" },
  radiofrequency: { en: "Radiofrequency Treatment", ar: "العلاج بالترددات الراديوية" },
  hifu_ultrasound: { en: "HIFU / Ultrasound-Based Treatment", ar: "العلاج بالموجات فوق الصوتية (HIFU)" },
  hair_scalp_treatment: { en: "Hair / Scalp Treatment", ar: "علاج الشعر / فروة الرأس" },
  body_treatment: { en: "Body Treatment", ar: "علاج للجسم" },
};

export const METADATA_KINDS = ["none", "product", "device", "product_device"] as const;
export type MetadataKind = (typeof METADATA_KINDS)[number];

export interface ProcedureDef {
  code: string;
  recordType: DermRecordType;
  metadata: MetadataKind;
}

const P = (recordType: DermRecordType, metadata: MetadataKind, codes: string[]): ProcedureDef[] => codes.map((code) => ({ code, recordType, metadata }));

export const PROCEDURES: readonly ProcedureDef[] = [
  // ---- Dermatology (medical / clinical treatments)
  ...P("dermatology", "product", ["topical_treatment", "local_treatment", "dressing_wound_care", "intralesional_treatment"]),
  ...P("dermatology", "none", ["oral_systemic_treatment", "curettage", "minor_procedure", "lesion_removal", "biopsy"]),
  ...P("dermatology", "device", ["cryotherapy", "electrocautery", "phototherapy", "medical_laser"]),
  // ---- Aesthetic
  ...P("aesthetic", "product", ["botulinum_toxin", "dermal_filler", "skin_booster", "mesotherapy", "prp", "chemical_peel", "thread_procedure", "facial_treatment"]),
  ...P("aesthetic", "product_device", ["microneedling"]),
  ...P("aesthetic", "device", ["laser_hair_reduction", "laser_skin_treatment", "ipl_light", "radiofrequency", "hifu_ultrasound"]),
  ...P("aesthetic", "none", ["scar_treatment", "pigmentation_treatment", "hair_scalp_treatment", "body_treatment"]),
];

const byCode = new Map(PROCEDURES.map((p) => [p.code, p]));
export const getProcedure = (code: string): ProcedureDef | undefined => byCode.get(code);
export const PROCEDURE_CODES: readonly string[] = PROCEDURES.map((p) => p.code);

// ---------------------------------------------------------------- lifecycle / priority / targets
export const PLAN_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const TARGET_TYPES = ["single_region", "multi_region", "general"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];
export const MAX_PHASE = 20;
export const MAX_TARGET_REGIONS = 12;
export const MAX_ITEMS_PER_PATIENT = 300;
/** A GENERAL treatment ("full-face", "general scalp") may name the AREA GROUP it concerns — never a fake region id. */
export const GENERAL_AREAS = REGION_GROUPS;

export const MAX_TREATMENT_TEXT = { notes: 1000, cancelReason: 300, sourceDiagnosis: 300 } as const;
export const MAX_SESSION_TEXT = { procedureNotes: 2000, observations: 2000, outcome: 1000, followUpInstructions: 1000 } as const;
export const MAX_TRACE_TEXT = { name: 120, brand: 120, lot: 60, quantity: 60, unit: 20, productNotes: 300, device: 120, deviceId: 80, settings: 500, notes: 500 } as const;
export const MAX_FOLLOWUP_TEXT = { assessment: 2000, progress: 2000, complications: 2000, notes: 2000, nextStep: 1000, voidNote: 500 } as const;

export const FOLLOWUP_OUTCOMES = ["improved", "unchanged", "worsened", "satisfactory", "needs_further_treatment"] as const;
export type FollowUpOutcome = (typeof FOLLOWUP_OUTCOMES)[number];

// ---------------------------------------------------------------- pure validation (no DB; unit-tested)
export interface TargetInput {
  procedureCode: string;
  recordType: string;
  targetType: string;
  regions?: readonly RegionRefInput[];
  generalArea?: string | null;
}
export type TargetResult =
  | { ok: true; procedure: ProcedureDef; targetType: TargetType; regions: RegionRef[]; generalArea?: (typeof GENERAL_AREAS)[number] }
  | { ok: false; message: string };

/**
 * A treatment's identity + target. Rules:
 *  - the procedure must be in the catalog AND belong to the item's record type (a dermatology item can never carry an
 *    aesthetic procedure, and vice versa — the two catalogs stay distinct);
 *  - single_region = exactly 1 region; multi_region = 2..12 regions; general = NO regions (no fake ids) with an
 *    optional area group (face / scalp / body);
 *  - regions are checked against the authoritative Phase-1 registry (known, active, valid surface, no duplicates).
 */
export function validateTarget(input: TargetInput): TargetResult {
  const procedure = byCode.get(input.procedureCode);
  if (!procedure) return { ok: false, message: "Unknown procedure" };
  if (input.recordType !== "dermatology" && input.recordType !== "aesthetic") return { ok: false, message: "Invalid record type" };
  if (procedure.recordType !== input.recordType) return { ok: false, message: "This procedure does not belong to the selected record type" };
  if (!(TARGET_TYPES as readonly string[]).includes(input.targetType)) return { ok: false, message: "Invalid target type" };
  const targetType = input.targetType as TargetType;
  const given = input.regions ?? [];

  if (targetType === "general") {
    if (given.length) return { ok: false, message: "A general treatment has no anatomical regions" };
    const area = input.generalArea ?? undefined;
    if (area !== undefined && !(GENERAL_AREAS as readonly string[]).includes(area)) return { ok: false, message: "Invalid general area" };
    return { ok: true, procedure, targetType, regions: [], generalArea: area as (typeof GENERAL_AREAS)[number] | undefined };
  }
  if (input.generalArea) return { ok: false, message: "A general area only applies to a general treatment" };
  if (targetType === "single_region" && given.length !== 1) return { ok: false, message: "A single-region treatment needs exactly one region" };
  if (targetType === "multi_region" && (given.length < 2 || given.length > MAX_TARGET_REGIONS)) {
    return { ok: false, message: `A multi-region treatment needs 2 to ${MAX_TARGET_REGIONS} regions` };
  }
  const refs = validateRegionRefs(given);
  if (!refs.ok) return refs;
  return { ok: true, procedure, targetType, regions: refs.regions };
}

// ---------------------------------------------------------------- traceability blocks (documentation only)
export interface ProductInfo { name?: string; brand?: string; lotNumber?: string; expiryDate?: string; quantity?: string; unit?: string; notes?: string }
export interface DeviceInfo { name?: string; identifier?: string; settingsSummary?: string; notes?: string }

/** Which optional blocks a procedure exposes. A block the procedure does not allow is rejected server-side. */
export const allowsProduct = (k: MetadataKind) => k === "product" || k === "product_device";
export const allowsDevice = (k: MetadataKind) => k === "device" || k === "product_device";
