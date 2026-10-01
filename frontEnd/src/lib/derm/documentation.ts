import { MAX_TRACE_TEXT, allowsDevice, allowsProduct, type MetadataKind } from "./procedures";

/**
 * Dermatology & Aesthetic Medicine — PROCEDURE DOCUMENTATION CONFIG (Phase 3), frontend twin of
 * backEnd/src/config/dermDocumentation.ts (scripts/check-derm-registry-sync.js fails when the two drift).
 *
 * ONE place that says which documentation groups a procedure's session exposes and which fields each group has. The session
 * form AND the printable reports render from this — no component hard-codes "which procedure shows which fields".
 * These fields DOCUMENT what the clinician used / did. ClinicOS never suggests a product, brand, amount, unit, dose,
 * concentration, device or device setting, and never interprets what was entered.
 */
export const DOC_SCHEMA_VERSION = 1;

export type DocGroup = "product" | "device";
export type DocFieldKind = "text" | "date" | "textarea";
export interface DocField { key: string; kind: DocFieldKind; max: number }

export const DOC_FIELDS: Record<DocGroup, readonly DocField[]> = {
  product: [
    { key: "name", kind: "text", max: MAX_TRACE_TEXT.name },
    { key: "brand", kind: "text", max: MAX_TRACE_TEXT.brand },
    { key: "lotNumber", kind: "text", max: MAX_TRACE_TEXT.lot },
    { key: "expiryDate", kind: "date", max: 10 },
    { key: "quantity", kind: "text", max: MAX_TRACE_TEXT.quantity },
    { key: "unit", kind: "text", max: MAX_TRACE_TEXT.unit },
    { key: "notes", kind: "textarea", max: MAX_TRACE_TEXT.productNotes },
  ],
  device: [
    { key: "name", kind: "text", max: MAX_TRACE_TEXT.device },
    { key: "identifier", kind: "text", max: MAX_TRACE_TEXT.deviceId },
    { key: "settingsSummary", kind: "textarea", max: MAX_TRACE_TEXT.settings },
    { key: "notes", kind: "textarea", max: MAX_TRACE_TEXT.notes },
  ],
};

export const groupsFor = (metadata: MetadataKind): DocGroup[] => {
  const g: DocGroup[] = [];
  if (allowsProduct(metadata)) g.push("product");
  if (allowsDevice(metadata)) g.push("device");
  return g;
};

/** i18n key of a field's label: dt.doc.<group>.<field> (the same keys the session form and the reports use). */
export const docFieldLabelKey = (group: DocGroup, key: string) => `dt.doc.${group}.${key}`;
export const docGroupLabelKey = (group: DocGroup) => (group === "product" ? "dt.trace.product" : "dt.trace.device");
