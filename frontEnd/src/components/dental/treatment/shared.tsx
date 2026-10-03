"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { SURFACE_LABELS, type SurfaceId } from "@/lib/dental/taxonomy";
import { procLabel } from "@/lib/dental/procedures";
import { teethSummary } from "@/lib/dental/teethFormat";
import type { BillingView, PlanStatus, Priority, TargetType, TimelineEntry, VisitRef } from "@/lib/dental/types";

// Shape + colour together (never colour alone): ○ planned, ◆ in progress, ✓ completed, ✕ cancelled.
const STATUS_STYLE: Record<PlanStatus, { cls: string; glyph: string }> = {
  planned: { cls: "border-sky/40 bg-sky/10 text-sky", glyph: "○" },
  in_progress: { cls: "border-purple-400/40 bg-purple-500/10 text-purple-300", glyph: "◆" },
  completed: { cls: "border-emerald-400/40 bg-emerald-500/10 text-emerald-300", glyph: "✓" },
  cancelled: { cls: "border-edge bg-soft text-mute", glyph: "✕" },
};

export function StatusPill({ status }: { status: PlanStatus }) {
  const { t } = useI18n();
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${s.cls}`}>
      <span aria-hidden>{s.glyph}</span> {t(`dn.ps.${status}`)}
    </span>
  );
}

export function PriorityPill({ priority }: { priority: Priority }) {
  const { t } = useI18n();
  const glyph = priority === "high" ? "▲" : priority === "low" ? "▽" : "–";
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] ${priority === "high" ? "text-amber-400" : "text-mute"}`}>
      <span aria-hidden>{glyph}</span> {t(`dn.pr.${priority}`)}
    </span>
  );
}

export const money = (n: number) => `${n.toFixed(2)} JD`;

/** Lists up to this many teeth are shown number by number; longer ones are summarised as ranges (a veneer case can be 16 teeth). */
export const LONG_LIST = 3;

/** "16 · M,O"   |   "14, 15, 16"   |   "Upper 14–24 · Lower 34–44"   |   "General / Full mouth" — a real tooth list, never a fake tooth. */
export function TargetText({ targetType, toothNumbers, surfaces }: { targetType: TargetType; toothNumbers: string[]; surfaces: SurfaceId[] }) {
  const { t } = useI18n();
  if (targetType === "general" || !toothNumbers.length) return <span>{t("dn.tg.general")}</span>;
  if (toothNumbers.length > LONG_LIST) return <span dir="auto" title={toothNumbers.join(", ")}>{teethSummary(toothNumbers, t)}</span>; // 4+ teeth: "Upper 14–24 · Lower 34–44"
  return (
    <span dir="ltr" className="font-mono">
      {toothNumbers.join(", ")}
      {surfaces.length > 0 && <span className="text-sky"> · {surfaces.map((s) => SURFACE_LABELS[s]).join(",")}</span>}
    </span>
  );
}

export const shortDate = (iso: string, lang: string) =>
  new Date(iso).toLocaleDateString(lang === "ar" ? "ar-JO" : "en-GB", { day: "numeric", month: "short" });

export function visitText(v: VisitRef | undefined, lang: string, walkIn: string) {
  if (!v) return "";
  return `${shortDate(v.startAt, lang)}${v.source === "walk_in" ? ` · ${walkIn}` : ""}`;
}

const KIND_GLYPH: Record<TimelineEntry["kind"], string> = {
  plan_created: "○", treatment_started: "◆", session: "▸", session_finished: "▪", treatment_completed: "✓", treatment_cancelled: "✕",
  invoiced: "¤", invoice_released: "↺",
};

/** Same display format the rest of ClinicOS uses for invoice numbers (INV-0012). */
/** Builds the /appointments?schedule=... deep link that opens New Appointment pre-filled for this patient
 * ("Schedule Next Visit"). All normal scheduling rules still apply — this only saves re-searching the patient. */
export function scheduleNextVisitHref(
  t: (k: string) => string,
  x: { patientId: string; patientName: string; procedureCode: string; customName?: string; targetType: TargetType; toothNumbers: string[]; currentDoctorId?: string }
) {
  const target = x.targetType === "general" || !x.toothNumbers.length ? "" : ` — ${x.toothNumbers.length > LONG_LIST ? teethSummary(x.toothNumbers, t) : x.toothNumbers.join(",")}`;
  const note = `${t("dn.scheduleNote")}: ${procLabel(t, x)}${target}`;
  const p = new URLSearchParams({ schedule: x.patientId, name: x.patientName, note });
  if (x.currentDoctorId) p.set("doctor", x.currentDoctorId);
  return `/appointments?${p.toString()}`;
}

export const invLabel = (n: number) => `INV-${String(n).padStart(4, "0")}`;
/** Opens the EXISTING invoices screen on that invoice (it already understands ?invoice=INV-0012). */
export const invHref = (n: number) => `/invoices?invoice=${invLabel(n)}`;

/** One treatment-history line — used by Tooth History AND the patient-level Dental History. */
export function TimelineRow({ e, visits, showTarget }: { e: TimelineEntry; visits?: Record<string, VisitRef>; showTarget: boolean }) {
  const { t, lang } = useI18n();
  const visit = e.appointmentId ? visitText(visits?.[e.appointmentId], lang, t("dn.walkIn")) : "";
  return (
    <div className="flex items-start gap-2 rounded-lg border border-edge bg-card2 px-2.5 py-1.5">
      <span aria-hidden className="mt-px w-3 shrink-0 text-center text-[11px] text-teal">{KIND_GLYPH[e.kind]}</span>
      <div className="min-w-0 flex-1 text-[11px] leading-snug">
        <div className="text-ink">
          {t(`dn.h.${e.kind}`)}
          {e.kind === "session" && e.sessionNumber ? ` ${e.sessionNumber}` : ""} — {procLabel(t, e)}
        </div>
        <div className="text-[10px] text-mute">
          {showTarget && <><TargetText targetType={e.targetType} toothNumbers={e.toothNumbers} surfaces={e.surfaces} /> · </>}
          {visit && <>{t("dn.h.visit")} {visit} · </>}
          {e.by && <>{t("dn.h.by")} {e.by.name} · </>}
          <span dir="ltr">{shortDate(e.at, lang)}</span>
        </div>
        {e.kind === "invoiced" && e.invoiceNumber != null && (
          <div className="text-[10px] text-mute"><span dir="ltr">{invLabel(e.invoiceNumber)}{typeof e.amount === "number" ? ` · ${money(e.amount)}` : ""}</span></div>
        )}
        {e.reason && <div className="text-[10px] italic text-mute">{e.reason}</div>}
      </div>
    </div>
  );
}

/**
 * Invoice description: readable default, editable by the user. Only a DEFAULT text — the link to the invoice line is by
 * stable ids on the server, never by this (translated) text.
 *   "Filling / Restoration — Tooth 16 — M,O"   "Bridge — Teeth 14,15,16"   "Cleaning / Scaling — General"
 */
export function invoiceDescription(
  t: (k: string) => string,
  lang: string,
  x: { procedureCode: string; customName?: string; targetType: TargetType; toothNumbers: string[]; surfaces: SurfaceId[] }
) {
  const label = procLabel(t, x);
  if (x.targetType === "general" || !x.toothNumbers.length) return `${label} — ${t("dn.generalTx")}`;
  const sep = lang === "ar" ? "،" : ",";
  const what = x.toothNumbers.length > LONG_LIST ? teethSummary(x.toothNumbers, t) : x.toothNumbers.length > 1 ? `${t("dn.inv.teeth")} ${x.toothNumbers.join(sep)}` : `${t("dn.inv.tooth")} ${x.toothNumbers[0]}`;
  return `${label} — ${what}${x.surfaces.length ? ` — ${x.surfaces.join(",")}` : ""}`;
}

/**
 * The financial state of ONE completed treatment, identical in the plan, the tooth panel and the visit:
 * not invoiced -> [Add to Invoice];  invoiced -> "Invoiced 35.00 JD · INV-0012" + [View Invoice]; never a balance.
 */
export function BillingLine({ billing, canBill, onAdd }: { billing: BillingView; canBill: boolean; onAdd: () => void }) {
  const { t } = useI18n();
  if (billing.state === "invoiced" && billing.invoiceNumber != null) {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">¤ {t("dn.inv.invoiced")}</span>
        {typeof billing.amount === "number" && <span className="text-ink" dir="ltr">{money(billing.amount)}</span>}
        <span className="text-mute" dir="ltr">{invLabel(billing.invoiceNumber)}</span>
        <Link href={invHref(billing.invoiceNumber)} className="text-sky hover:underline">{t("dn.inv.view")}</Link>
      </div>
    );
  }
  if (billing.state === "pending") return <div className="text-[11px] text-mute animate-pulse">{t("dn.inv.pending")}</div>;
  return canBill ? <button type="button" className="btn-ghost !px-2.5 !py-1 text-[11px]" onClick={onAdd}>{t("dn.inv.add")}</button> : null;
}
