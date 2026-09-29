import { SURFACES, isValidFdiFor, type DentitionType, type SurfaceId } from "./dental";

/**
 * Dental Procedure Catalog V1 — the ONE place procedure codes and workflow metadata live.
 * The metadata only drives PRODUCT WORKFLOW (which target shapes a procedure accepts, whether surfaces apply…).
 * It is not medical decision-making: nothing here recommends a procedure for a diagnosis.
 *
 * `code` is a plain string (stored as such), so the catalog can grow without a schema migration.
 * Labels are NOT here — they live in the frontend i18n (dn.p.<code>).
 */
export const PROCEDURE_CATALOG_VERSION = 1;

export const TARGET_TYPES = ["tooth", "surface", "multi_tooth", "general"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const PLAN_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MAX_PHASE = 20;
export const MAX_MULTI_TEETH = 32;

export interface ProcedureDef {
  code: string;
  /** Target shapes this procedure accepts. "surface" = one tooth + at least one surface. */
  targets: readonly TargetType[];
  defaultTarget: TargetType;
  /** Commonly needs more than one visit (UI hint only — any procedure may still have several sessions). */
  multiSession: boolean;
}

export const PROCEDURES: readonly ProcedureDef[] = [
  { code: "filling", targets: ["surface", "tooth"], defaultTarget: "surface", multiSession: false },
  { code: "root_canal", targets: ["tooth"], defaultTarget: "tooth", multiSession: true },
  { code: "extraction", targets: ["tooth"], defaultTarget: "tooth", multiSession: false },
  { code: "crown", targets: ["tooth"], defaultTarget: "tooth", multiSession: true },
  { code: "bridge", targets: ["multi_tooth"], defaultTarget: "multi_tooth", multiSession: true },
  { code: "implant", targets: ["tooth"], defaultTarget: "tooth", multiSession: true },
  { code: "scaling", targets: ["general"], defaultTarget: "general", multiSession: false },
  { code: "whitening", targets: ["general"], defaultTarget: "general", multiSession: false },
  { code: "sealant", targets: ["tooth", "surface"], defaultTarget: "tooth", multiSession: false },
  { code: "veneer", targets: ["tooth", "multi_tooth"], defaultTarget: "tooth", multiSession: true },
  { code: "denture", targets: ["general", "multi_tooth"], defaultTarget: "general", multiSession: true },
];

export const findProcedure = (code: string): ProcedureDef | undefined => PROCEDURES.find((p) => p.code === code);

// ---------- Lifecycle ----------
/** Allowed status transitions. Completed / cancelled are terminal: clinical history is never silently rewritten. */
export const STATUS_TRANSITIONS: Record<PlanStatus, readonly PlanStatus[]> = {
  planned: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};
export const canTransition = (from: PlanStatus, to: PlanStatus) => STATUS_TRANSITIONS[from].includes(to);

// ---------- Target validation (never trust the frontend) ----------
export interface TargetInput {
  procedureCode: string;
  targetType: string;
  toothNumbers?: readonly string[];
  surfaces?: readonly string[];
}
export type ValidatedTarget =
  | { ok: true; procedureCode: string; targetType: TargetType; toothNumbers: string[]; surfaces: SurfaceId[] }
  | { ok: false; message: string };

export function validateTarget(input: TargetInput, dentition: DentitionType): ValidatedTarget {
  const def = findProcedure(input.procedureCode);
  if (!def) return { ok: false, message: `Unknown procedure: ${input.procedureCode}` };
  const targetType = input.targetType as TargetType;
  if (!(TARGET_TYPES as readonly string[]).includes(targetType)) return { ok: false, message: `Invalid target type: ${input.targetType}` };
  if (!def.targets.includes(targetType)) return { ok: false, message: `${def.code} does not support the "${targetType}" target` };

  const teeth = [...(input.toothNumbers ?? [])];
  if (new Set(teeth).size !== teeth.length) return { ok: false, message: "Duplicate tooth in target" };
  for (const fdi of teeth) {
    if (!isValidFdiFor(fdi, dentition)) return { ok: false, message: `Invalid FDI tooth code for a ${dentition} dentition: ${fdi}` };
  }

  const rawSurfaces = [...(input.surfaces ?? [])];
  for (const s of rawSurfaces) if (!(SURFACES as readonly string[]).includes(s)) return { ok: false, message: `Invalid surface: ${s}` };
  const surfaces = SURFACES.filter((s) => rawSurfaces.includes(s)); // canonical order, deduped

  switch (targetType) {
    case "general":
      if (teeth.length || surfaces.length) return { ok: false, message: "A general / full-mouth treatment cannot have teeth or surfaces" };
      break;
    case "tooth":
      if (teeth.length !== 1) return { ok: false, message: "A tooth treatment needs exactly one tooth" };
      if (surfaces.length) return { ok: false, message: "A whole-tooth treatment cannot have surfaces" };
      break;
    case "surface":
      if (teeth.length !== 1) return { ok: false, message: "A surface treatment needs exactly one tooth" };
      if (!surfaces.length) return { ok: false, message: "Select at least one surface" };
      break;
    case "multi_tooth":
      if (teeth.length < 2 || teeth.length > MAX_MULTI_TEETH) return { ok: false, message: "A multi-tooth treatment needs at least two teeth" };
      if (surfaces.length) return { ok: false, message: "A multi-tooth treatment cannot have surfaces" };
      break;
  }
  const sorted = targetType === "multi_tooth" ? teeth.sort() : teeth;
  return { ok: true, procedureCode: def.code, targetType, toothNumbers: sorted, surfaces: surfaces as SurfaceId[] };
}
