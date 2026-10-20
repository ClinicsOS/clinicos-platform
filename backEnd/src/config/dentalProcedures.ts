import { PERMANENT_FDI, PRIMARY_FDI, SURFACES, isValidFdiFor, type DentitionType, type SurfaceId } from "./dental";

/**
 * Dental Procedure Catalog V1 — the ONE place procedure codes and workflow metadata live.
 * The metadata only drives PRODUCT WORKFLOW (which target shapes a procedure accepts, whether surfaces apply…).
 * It is not medical decision-making: nothing here recommends a procedure for a diagnosis.
 *
 * `code` is a plain string (stored as such), so the catalog can grow without a schema migration.
 * Labels are NOT here — they live in the frontend i18n (dn.p.<code>).
 */
export const PROCEDURE_CATALOG_VERSION = 1; // PHASE 5 changes target SHAPES only (more procedures accept several teeth); procedure codes are unchanged, so the version stays.

export const TARGET_TYPES = ["tooth", "surface", "multi_tooth", "general"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const PLAN_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MAX_PHASE = 20;
export const MAX_MULTI_TEETH = 32;

/**
 * "Other" = any procedure that is not in the catalog (abscess drainage, a specific gum surgery, a re-treatment, an
 * orthodontic visit…). It is a catalog entry like any other, but the doctor ALSO types a short name (`customName`),
 * which is then what every screen, invoice line and history entry shows. Nothing else about the workflow changes.
 */
export const OTHER_PROCEDURE_CODE = "other";
export const CUSTOM_NAME_MIN = 2;
export const CUSTOM_NAME_MAX = 80;
/** Collapses whitespace so "  Gum   surgery " and "Gum surgery" are the same name. */
export const cleanCustomName = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export interface ProcedureDef {
  code: string;
  /** Target shapes this procedure accepts. "surface" = one tooth + at least one surface. */
  targets: readonly TargetType[];
  defaultTarget: TargetType;
  /** Commonly needs more than one visit (UI hint only — any procedure may still have several sessions). */
  multiSession: boolean;
  /**
   * PHASE 5 — the procedure acts on tooth SURFACES (filling, sealant, free-text "other"). Only these may carry surfaces on a
   * MULTI-tooth target ("same surfaces on every selected tooth", or different surfaces per tooth via `toothSurfaces`).
   * Crown / root canal / extraction / implant / bridge / veneer / denture / scaling / whitening act on the whole tooth (or mouth).
   */
  surfaceCapable?: boolean;
}

/**
 * PHASE 5 — treatment TARGETING STRATEGY (derived, never stored — `targetType` + `toothNumbers` stay the single source of truth):
 *   single_tooth  one tooth, or one tooth + surfaces      (targetType tooth | surface)
 *   multi_tooth   serial / several teeth                  (targetType multi_tooth)
 *   arch          the multi-tooth selection is a WHOLE arch (every tooth of the upper or of the lower jaw for the dentition)
 *   general       no specific tooth                       (targetType general)
 */
export type TargetMode = "single_tooth" | "multi_tooth" | "arch" | "general";

export const PROCEDURES: readonly ProcedureDef[] = [
  // PHASE 5: every tooth-level procedure also accepts a serial / multi-tooth selection (the doctor plans "11, 12, 13, 14" ONCE instead of
  // four separate items). Whole-mouth procedures keep "general" as their default and also accept the teeth of the region being treated.
  { code: "filling", targets: ["surface", "tooth", "multi_tooth"], defaultTarget: "surface", multiSession: false, surfaceCapable: true },
  { code: "root_canal", targets: ["tooth", "multi_tooth"], defaultTarget: "tooth", multiSession: true },
  { code: "extraction", targets: ["tooth", "multi_tooth"], defaultTarget: "tooth", multiSession: false },
  { code: "crown", targets: ["tooth", "multi_tooth"], defaultTarget: "tooth", multiSession: true },
  { code: "bridge", targets: ["multi_tooth"], defaultTarget: "multi_tooth", multiSession: true },
  { code: "implant", targets: ["tooth", "multi_tooth"], defaultTarget: "tooth", multiSession: true },
  { code: "scaling", targets: ["general", "multi_tooth"], defaultTarget: "general", multiSession: false },
  { code: "whitening", targets: ["general", "multi_tooth"], defaultTarget: "general", multiSession: false },
  { code: "sealant", targets: ["tooth", "surface", "multi_tooth"], defaultTarget: "tooth", multiSession: false, surfaceCapable: true },
  { code: "veneer", targets: ["tooth", "multi_tooth"], defaultTarget: "tooth", multiSession: true },
  { code: "denture", targets: ["general", "multi_tooth"], defaultTarget: "general", multiSession: true },
  // Free-text procedure: accepts every target shape (one tooth, surfaces, several teeth, or general).
  { code: OTHER_PROCEDURE_CODE, targets: ["tooth", "surface", "multi_tooth", "general"], defaultTarget: "tooth", multiSession: false, surfaceCapable: true },
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
  /** Required (2-80 chars after trimming) when procedureCode is "other"; ignored for every other procedure. */
  customName?: string;
  /**
   * PHASE 5 — DIFFERENT surfaces per tooth on a multi-tooth treatment of a surface-capable procedure ({ "16": ["O"], "17": ["M","O"] }).
   * Absent = the same `surfaces` apply to every selected tooth. When present every selected tooth needs at least one surface and
   * `surfaces` becomes the union of them (it stays the field every other screen / report already reads).
   */
  toothSurfaces?: Record<string, readonly string[]> | null;
}
export type ValidatedTarget =
  | { ok: true; procedureCode: string; targetType: TargetType; toothNumbers: string[]; surfaces: SurfaceId[]; toothSurfaces?: Record<string, SurfaceId[]>; customName?: string }
  | { ok: false; message: string };

/** Derived targeting strategy of a validated target (see TargetMode). `arch` needs the dentition's teeth to recognise a full arch. */
export function deriveTargetMode(targetType: string, toothNumbers: readonly string[], dentition: DentitionType = "permanent"): TargetMode {
  if (targetType === "general" || !toothNumbers.length) return "general";
  if (targetType !== "multi_tooth") return "single_tooth";
  if (dentition === "mixed") return "multi_tooth"; // a mixed chart has no fixed "whole arch"
  const pool = dentition === "primary" ? PRIMARY_FDI : PERMANENT_FDI;
  const jaws = dentition === "primary" ? [["5", "6"], ["7", "8"]] : [["1", "2"], ["3", "4"]]; // upper, lower quadrants
  const set = new Set(toothNumbers);
  for (const quadrants of jaws) {
    const jaw = pool.filter((f) => quadrants.includes(f[0]));
    if (set.size === jaw.length && jaw.every((f) => set.has(f))) return "arch";
  }
  return "multi_tooth";
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function validateTarget(input: TargetInput, dentition: DentitionType): ValidatedTarget {
  const def = findProcedure(input.procedureCode);
  if (!def) return { ok: false, message: `Unknown procedure: ${input.procedureCode}` };
  let customName: string | undefined;
  if (def.code === OTHER_PROCEDURE_CODE) {
    const name = cleanCustomName(input.customName);
    if (name.length < CUSTOM_NAME_MIN) return { ok: false, message: "Enter the name of the treatment" };
    if (name.length > CUSTOM_NAME_MAX) return { ok: false, message: `The treatment name is too long (max ${CUSTOM_NAME_MAX} characters)` };
    customName = name;
  }
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
  let surfaces = SURFACES.filter((s) => rawSurfaces.includes(s)); // canonical order, deduped
  let toothSurfaces: Record<string, SurfaceId[]> | undefined;
  const rawMap = input.toothSurfaces ?? undefined;

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
    case "multi_tooth": {
      if (teeth.length < 2 || teeth.length > MAX_MULTI_TEETH) return { ok: false, message: "A multi-tooth treatment needs at least two teeth" };
      if (!def.surfaceCapable) {
        if (surfaces.length || (rawMap && Object.keys(rawMap).length)) return { ok: false, message: "A multi-tooth treatment cannot have surfaces" };
        break;
      }
      if (rawMap && Object.keys(rawMap).length) {
        // Different surfaces per tooth: every selected tooth needs its own (valid, non-empty) list and nothing may name a tooth outside the selection.
        const clean: Record<string, SurfaceId[]> = {};
        for (const key of Object.keys(rawMap)) {
          if (!teeth.includes(key)) return { ok: false, message: `Surfaces were given for a tooth that is not selected: ${key}` };
          const list = [...rawMap[key]];
          for (const s of list) if (!(SURFACES as readonly string[]).includes(s)) return { ok: false, message: `Invalid surface: ${s}` };
          const canon = SURFACES.filter((s) => list.includes(s));
          if (!canon.length) return { ok: false, message: `Select at least one surface for tooth ${key}` };
          clean[key] = canon as SurfaceId[];
        }
        for (const f of teeth) if (!clean[f]) return { ok: false, message: `Select at least one surface for tooth ${f}` };
        const lists = teeth.slice().sort().map((f) => clean[f]);
        if (lists.every((l) => sameSet(l, lists[0]))) {
          surfaces = lists[0] as typeof surfaces; // identical everywhere -> plain shared surfaces (one canonical shape, one twin key)
        } else {
          toothSurfaces = Object.fromEntries(teeth.slice().sort().map((f) => [f, clean[f]]));
          surfaces = SURFACES.filter((s) => Object.values(clean).some((l) => l.includes(s)));
        }
      }
      break;
    }
  }
  if (rawMap && Object.keys(rawMap).length && targetType !== "multi_tooth") return { ok: false, message: "Per-tooth surfaces only apply to a multi-tooth treatment" };
  const sorted = targetType === "multi_tooth" ? teeth.sort() : teeth;
  return { ok: true, procedureCode: def.code, targetType, toothNumbers: sorted, surfaces: surfaces as SurfaceId[], ...(toothSurfaces ? { toothSurfaces } : {}), ...(customName ? { customName } : {}) };
}
