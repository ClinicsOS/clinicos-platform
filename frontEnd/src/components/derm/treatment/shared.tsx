"use client";
import { useI18n } from "@/lib/i18n";
import { procedureLabel, type PlanStatus, type Priority } from "@/lib/derm/procedures";
import type { DermRegionRef } from "@/lib/derm/types";
import type { RegionGroup } from "@/lib/derm/regions";
import type { BillingView, VisitRef } from "@/lib/derm/treatmentTypes";
import { RegionChip, useRegionText } from "../dermUi";
import axios from "axios";

/** Procedure label in the UI language (all labels live in the catalog twin, never in components). */
export function useProcLabel() {
  const { lang } = useI18n();
  return (code: string) => procedureLabel(code, lang);
}

const STATUS_CLS: Record<PlanStatus, string> = {
  planned: "border-sky/40 bg-sky/10 text-sky",
  in_progress: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  completed: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  cancelled: "border-edge bg-soft text-mute line-through",
};
export function StatusPill({ status }: { status: PlanStatus }) {
  const { t } = useI18n();
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[status]}`}>{t(`dt.status.${status}`)}</span>;
}
export function PriorityPill({ priority }: { priority: Priority }) {
  const { t } = useI18n();
  if (priority === "normal") return null; // only the exceptions are shown
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${priority === "high" ? "border-red-400/40 bg-red-400/10 text-red-300" : "border-edge bg-soft text-mute"}`}>{t(`dt.priority.${priority}`)}</span>;
}

/** Target of a treatment: region chips (single / multi) or the general area — never a fake region. */
export function TargetChips({ targetType, regions, generalArea, onRegion }: { targetType: string; regions: DermRegionRef[]; generalArea?: RegionGroup; onRegion?: (id: string) => void }) {
  const { t } = useI18n();
  if (targetType === "general" || regions.length === 0) {
    return <span className="inline-flex items-center rounded-full border border-edge bg-soft px-2.5 py-1 text-[11px] text-ink">{generalArea ? `${t("dt.target.general")} · ${t(`dm.group.${generalArea}`)}` : t("dt.target.general")}</span>;
  }
  return <>{regions.map((r) => <RegionChip key={r.id} id={r.id} surface={r.surface} onClick={onRegion ? () => onRegion(r.id) : undefined} />)}</>;
}
export function useTargetText() {
  const { t } = useI18n();
  const rt = useRegionText();
  return (x: { targetType: string; regions: DermRegionRef[]; generalArea?: RegionGroup }) =>
    x.targetType === "general" || !x.regions.length ? (x.generalArea ? `${t("dt.target.general")} · ${t(`dm.group.${x.generalArea}`)}` : t("dt.target.general")) : x.regions.map((r) => rt(r.id, r.surface)).join(", ");
}

/** Money: JD with up to 3 decimals, like the invoice module. */
export const money = (n: number) => `${Number(n.toFixed(3)).toString()} JD`;
export const invLabel = (n: number) => `INV-${String(n).padStart(4, "0")}`;
/** Opens the EXISTING invoices screen on that invoice (it already understands ?invoice=INV-0012). */
export const invHref = (n: number) => `/invoices?invoice=${invLabel(n)}`;

/**
 * "Schedule Next Visit": the EXISTING /appointments?schedule=<patientId>&name=&doctor=&note= deep link (the appointments
 * screen opens New Appointment pre-filled). Nothing else is chosen for the clinician: date, time and interval stay theirs,
 * and every normal scheduling rule still applies.
 */
export function scheduleNextVisitHref(t: (k: string) => string, x: { patientId: string; patientName: string; procedure: string; target?: string; currentDoctorId?: string }) {
  const note = `${t("dt.scheduleNote")}: ${x.procedure}${x.target ? ` — ${x.target}` : ""}`.slice(0, 200);
  const p = new URLSearchParams({ schedule: x.patientId, name: x.patientName, note });
  if (x.currentDoctorId) p.set("doctor", x.currentDoctorId);
  return `/appointments?${p.toString()}`;
}

export function visitText(v: VisitRef | undefined, lang: string, walkIn: string) {
  if (!v) return "";
  const d = new Date(v.startAt).toLocaleDateString(lang === "ar" ? "ar-JO" : "en-GB", { year: "numeric", month: "short", day: "numeric" });
  return v.source === "walk_in" ? `${d} · ${walkIn}` : d;
}

/** Billing line under a treatment. "Needs billing" = completed and not invoiced — it does NOT mean anything is owed. */
export function billingState(status: PlanStatus, b: BillingView): "needs" | "invoiced" | "pending" | "none" {
  if (b.state === "invoiced") return "invoiced";
  if (b.state === "pending") return "pending";
  return status === "completed" ? "needs" : "none";
}

/** Server error code -> translated message (never a raw technical string). */
const ERR: Record<string, string> = {
  ITEM_LOCKED: "dt.err.locked", ITEM_CHANGED: "dt.err.changed", ITEM_NOT_STARTABLE: "dt.err.notStartable", ITEM_NOT_IN_PROGRESS: "dt.err.notInProgress",
  VISIT_NOT_ACTIVE: "dt.err.visitNotActive", NO_SESSION_IN_VISIT: "dt.err.noSession", SESSION_CLOSED: "dt.err.sessionClosed", SESSION_CONFLICT: "dt.err.sessionConflict",
  TREATMENT_NOT_COMPLETED: "dt.err.notCompleted", TREATMENT_CANCELLED: "dt.err.cancelled", BILLING_IN_PROGRESS: "dt.err.billingBusy", BILLING_CONFLICT: "dt.err.billingConflict",
  INVOICE_NOT_EDITABLE: "dt.err.invoicePaid", INVOICE_NOT_FOUND: "dt.err.invoiceMissing", INVOICE_CHANGED: "dt.err.invoiceChanged", INVOICE_CREATE_FAILED: "dt.err.invoiceFailed",
  INVALID_TARGET: "dt.err.target", RECORD_TYPE_MISMATCH: "dt.err.recordType", ITEM_LIMIT: "dt.err.limit", METADATA_NOT_ALLOWED: "dt.err.metadata",
  REGION_NOT_IN_TREATMENT: "dt.err.regionNotIn", INVALID_DATE: "dt.err.date", INVALID_REGION: "dt.err.region", MISSING_LINK: "dt.err.link", EMPTY_FOLLOWUP: "dt.err.emptyFollowUp",
  LINK_MISMATCH: "dt.err.link", STALE: "dt.err.stale", ENTERED_IN_ERROR: "dt.err.voided", DUPLICATE_REQUEST: "dt.err.duplicate", FORBIDDEN: "dt.err.forbidden", NETWORK: "dt.err.network",
  PLAN_LIMIT: "dt.err.plan", SUSPENDED: "dt.err.plan", PLAN_EXPIRED: "dt.err.plan",
};
export function treatmentErrorKey(e: unknown): string {
  if (!axios.isAxiosError(e)) return "dt.err.generic";
  if (!e.response) return ERR.NETWORK;
  const code = (e.response.data as { code?: string } | undefined)?.code;
  if (code && ERR[code]) return ERR[code];
  if (e.response.status === 403) return ERR.FORBIDDEN;
  if (e.response.status === 402) return ERR.PLAN_LIMIT;
  return "dt.err.generic";
}
export const treatmentErrorCode = (e: unknown): string | null => (axios.isAxiosError(e) ? ((e.response?.data as { code?: string } | undefined)?.code ?? null) : null);
