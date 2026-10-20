import axios from "axios";

/** PHASE 4 — user-facing text for a failed treatment mutation. Never shows the server's raw (English) message or a stack: only a localized sentence. */
export function treatmentErrorKey(e: unknown): string {
  if (!axios.isAxiosError(e)) return "ts.err.generic";
  if (!e.response) return "ts.err.network";
  const code = (e.response.data as { code?: string } | undefined)?.code;
  if (code === "DUPLICATE_ITEM") return "dn.err.duplicate";
  if (code === "ITEM_LOCKED" || code === "ITEM_NOT_STARTABLE" || code === "ITEM_NOT_IN_PROGRESS") return "ts.err.locked";
  if (code === "ITEM_CHANGED") return "ts.err.changed";
  if (e.response.status === 404 || e.response.status === 403) return "ts.err.gone";
  return "ts.err.generic";
}
export const treatmentErrorText = (e: unknown, t: (k: string) => string) => t(treatmentErrorKey(e));
