import { type MetadataKind, allowsDevice, allowsProduct, MAX_TRACE_TEXT } from "./dermProcedures";

/**
 * Dermatology & Aesthetic Medicine — PROCEDURE DOCUMENTATION CONFIG (Phase 3).
 *
 * ONE central place that says which documentation GROUPS a procedure's session may carry and which fields each group has.
 * The procedure catalog (`dermProcedures.ts`) stays the source of procedure identity; this file only maps the catalog's
 * `metadata` kind to field groups. UI (SessionPanel) and reports both read the frontend twin of this file, so no component
 * hard-codes "which procedure shows which fields".
 *
 * These groups DOCUMENT what the clinician used / did. ClinicOS never suggests a product, brand, amount, unit, dose,
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

/** The optional groups a procedure's session exposes (the general notes fields are always available). */
export const groupsFor = (metadata: MetadataKind): DocGroup[] => {
  const g: DocGroup[] = [];
  if (allowsProduct(metadata)) g.push("product");
  if (allowsDevice(metadata)) g.push("device");
  return g;
};
