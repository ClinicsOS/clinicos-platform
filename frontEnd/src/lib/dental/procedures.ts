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
  { code: OTHER_PROCEDURE_CODE, targets: ["tooth", "surface", "multi_tooth", "general"], defaultTarget: "tooth", multiSession: false },
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
/** Same rules as the server (UX only — the server rejects anything invalid regardless). Returns an i18n key or null. */
export function targetError(
  input: { procedureCode: string; targetType: TargetType; teeth: string[]; surfaces: SurfaceId[]; customName?: string },
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
    case "multi_tooth": return input.teeth.length >= 2 ? null : "dn.err.needTeeth";
  }
}
export { SURFACES };
