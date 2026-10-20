import { isValidFdiFor, type DentitionType } from "./fdi";
import { SURFACES, type SurfaceId } from "./taxonomy";

/**
 * Dental Procedure Catalog V1 (frontend mirror). The BACKEND catalog (config/dentalProcedures.ts) is the authority and
 * validates everything again; this copy only drives the UI (which target shapes / surfaces / multi-tooth a procedure
 * offers). Labels live in i18n as `dn.p.<code>`. The metadata controls product workflow only — it never recommends a
 * procedure for a diagnosis.
 */
export type TargetType = "tooth" | "surface" | "multi_tooth" | "general";
export type PlanStatus = "planned" | "in_progress" | "completed" | "cancelled";
export type Priority = "low" | "normal" | "high";

export const PRIORITIES: Priority[] = ["low", "normal", "high"];
export const MAX_PHASE = 20;

/**
 * "Other" = a procedure that is not in the catalog (abscess drainage, a gum surgery, re-treatment, an orthodontic visit…).
 * The doctor types a short name (customName) and that name is what every screen / invoice line / history entry shows.
 */
export const OTHER_PROCEDURE_CODE = "other";
export const CUSTOM_NAME_MIN = 2;
export const CUSTOM_NAME_MAX = 80;
export const cleanCustomName = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

export interface ProcedureDef {
  code: string;
  targets: readonly TargetType[];
  defaultTarget: TargetType;
  multiSession: boolean; // hint only
  /** PHASE 5 — acts on tooth SURFACES (filling, sealant, other): the only procedures that may carry surfaces on a several-teeth target. */
  surfaceCapable?: boolean;
}

/** PHASE 5 targeting strategy (derived from targetType + teeth, never stored): single_tooth | multi_tooth | arch | general. */
export type TargetMode = "single_tooth" | "multi_tooth" | "arch" | "general";

export const PROCEDURES: readonly ProcedureDef[] = [
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
  { code: OTHER_PROCEDURE_CODE, targets: ["tooth", "surface", "multi_tooth", "general"], defaultTarget: "tooth", multiSession: false, surfaceCapable: true },
];
export const findProcedure = (code: string) => PROCEDURES.find((p) => p.code === code);

/**
 * THE one place a procedure's display name is decided. Catalog procedures use the translation (dn.p.<code>);
 * "other" shows the name the doctor typed (falls back to the generic "Other" only for a record that has no name).
 */
export function procLabel(t: (k: string) => string, x: { procedureCode: string; customName?: string | null }): string {
  if (x.procedureCode === OTHER_PROCEDURE_CODE) {
    const name = cleanCustomName(x.customName);
    if (name) return name;
  }
  return t(`dn.p.${x.procedureCode}`);
}
/** Per-tooth surfaces of a multi-tooth treatment: { "16": ["O"], "17": ["M","O"] }. Absent = the same `surfaces` on every selected tooth. */
export type ToothSurfaces = Record<string, SurfaceId[]>;

export { surfacesForTooth } from "./planVisual";

/** Same rules as the server (UX only — the server rejects anything invalid regardless). Returns an i18n key or null. */
export function targetError(
  input: { procedureCode: string; targetType: TargetType; teeth: string[]; surfaces: SurfaceId[]; customName?: string; toothSurfaces?: ToothSurfaces | null },
  dentition: DentitionType
): string | null {
  const def = findProcedure(input.procedureCode);
  if (!def) return "dn.err.pickProcedure";
  if (def.code === OTHER_PROCEDURE_CODE) {
    const n = cleanCustomName(input.customName).length;
    if (n < CUSTOM_NAME_MIN || n > CUSTOM_NAME_MAX) return "dn.err.customName";
  }
  if (!def.targets.includes(input.targetType)) return "dn.err.target";
  for (const f of input.teeth) if (!isValidFdiFor(f, dentition)) return "dn.invalidFdi";
  switch (input.targetType) {
    case "general": return input.teeth.length ? "dn.err.target" : null;
    case "tooth": return input.teeth.length === 1 && !input.surfaces.length ? null : "dn.err.needTooth";
    case "surface": return input.teeth.length !== 1 ? "dn.err.needTooth" : input.surfaces.length ? null : "dn.err.needSurface";
    case "multi_tooth": {
      if (input.teeth.length < 2) return "dn.err.needTeeth";
      if (!def.surfaceCapable) return input.surfaces.length ? "dn.err.target" : null;
      if (input.toothSurfaces && Object.keys(input.toothSurfaces).length) return input.teeth.every((f) => input.toothSurfaces![f]?.length) ? null : "dn.err.needSurfaceEach";
      return null;
    }
  }
}

/** Derived targeting strategy (mirrors the server's deriveTargetMode). */
export function deriveTargetMode(targetType: TargetType, teeth: readonly string[], dentition: DentitionType): TargetMode {
  if (targetType === "general" || !teeth.length) return "general";
  if (targetType !== "multi_tooth") return "single_tooth";
  if (dentition === "mixed") return "multi_tooth";
  const jaws = dentition === "primary" ? [["5", "6"], ["7", "8"]] : [["1", "2"], ["3", "4"]];
  const per = dentition === "primary" ? 5 : 8;
  const set = new Set(teeth);
  for (const qs of jaws) {
    const jaw = qs.flatMap((q) => Array.from({ length: per }, (_, i) => `${q}${i + 1}`));
    if (set.size === jaw.length && jaw.every((f) => set.has(f))) return "arch";
  }
  return "multi_tooth";
}
export { SURFACES };
