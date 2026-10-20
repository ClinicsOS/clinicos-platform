"use client";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { SURFACE_LABELS, type SurfaceId } from "@/lib/dental/taxonomy";
import { surfaceLabel } from "@/lib/dental/surfaces";
import { procLabel } from "@/lib/dental/procedures";
import { teethSummary } from "@/lib/dental/teethFormat";
import type { BillingView, PlanStatus, Priority, TargetType, TimelineEntry, VisitRef } from "@/lib/dental/types";
import { STATE_TOKENS, TYPE_TOKENS, semanticOfStatus, stateChipStyle, type ObjectKind } from "@/lib/dental/visualTheme";

/** Procedure code -> the TYPE token the chart draws for it (only these have a dedicated colour; every other procedure is shown through its STATE only). */
const SWATCH_KIND: Record<string, ObjectKind> = { crown: "crown", filling: "filling", bridge: "bridge", implant: "implant", root_canal: "rootCanal" };

/**
 * The chart's own picture of a procedure TYPE (gold crown cap, cobalt filling dot, bronze bridge, titanium implant, dark root-canal dot), shown next
 * to the procedure name wherever a treatment is listed, so the plan, the tooth panel and the chart legend share ONE visual key (visualTheme.ts).
 * Ghost (dashed / hollow) while planned or in progress, solid once completed; cancelled is neutral. Decorative: the name is the label.
 */
export function ProcSwatch({ code, status }: { code: string; status: PlanStatus }) {
  const kind = SWATCH_KIND[code];
  if (!kind) return null;
  const color = status === "cancelled" ? STATE_TOKENS.cancelled.css : TYPE_TOKENS[kind].css;
  const ghost = status === "planned" || status === "in_progress";
  const shape = kind === "crown" ? "h-2.5 w-3 rounded-t-md" : kind === "bridge" ? "h-2.5 w-3 rounded-sm" : kind === "implant" ? "h-3 w-1.5 rounded-b-full" : "h-2.5 w-2.5 rounded-full";
  return (
    <i aria-hidden data-swatch={kind} className={`inline-block shrink-0 ${shape} ${ghost ? "border bg-transparent" : ""} ${ghost && kind !== "filling" ? "border-dashed" : ""}`}
      style={ghost ? { borderColor: color } : { background: color }} />
  );
}

export function StatusPill({ status }: { status: PlanStatus }) {
  const { t } = useI18n();
  const sem = semanticOfStatus(status);
  // Shape + colour together (never colour alone): ○ planned, ◆ in progress, ✓ completed, ✕ cancelled. Same colours as the chart badge.
  return (
    <span data-status={status} className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium" style={stateChipStyle(sem)}>
      <span aria-hidden>{STATE_TOKENS[sem].glyph}</span> {t(`dn.ps.${status}`)}
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
export function TargetText({ targetType, toothNumbers, surfaces, toothSurfaces }: { targetType: TargetType; toothNumbers: string[]; surfaces: SurfaceId[]; toothSurfaces?: Record<string, SurfaceId[]> }) {
  const { t } = useI18n();
  if (targetType === "general" || !toothNumbers.length) return <span>{t("dn.tg.general")}</span>;
  // PHASE 5 — different surfaces on different teeth: "16·M,O  17·O  18·D"
  const perTooth = toothSurfaces && Object.keys(toothSurfaces).length > 0;
  if (perTooth) {
    const text = toothNumbers.map((f) => `${f}·${(toothSurfaces![f] ?? []).map((s) => surfaceLabel(f, s)).join(",")}`).join("  ");
    return <span dir="ltr" className="font-mono" title={text}>{toothNumbers.length > 5 ? `${toothNumbers.length} ${t("dn2.teethCount")} · ${text.slice(0, 40)}…` : text}</span>;
  }
  if (toothNumbers.length > LONG_LIST) return <span dir="auto" title={toothNumbers.join(", ")}>{teethSummary(toothNumbers, t)}</span>; // 4+ teeth: "Upper 14–24 · Lower 34–44"
  return (
    <span dir="ltr" className="font-mono">
      {toothNumbers.join(", ")}
      {surfaces.length > 0 && <span className="text-sky"> · {surfaces.map((s) => (toothNumbers.length === 1 ? surfaceLabel(toothNumbers[0], s) : SURFACE_LABELS[s])).join(",")}</span>}
    </span>
  );
}

// PHASE 7 — always the CLINIC's calendar day (Asia/Amman), never the viewer's browser zone; an unparsable value renders as nothing, not "Invalid Date".
export const shortDate = (iso: string, lang: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(lang === "ar" ? "ar-JO" : "en-GB", { day: "numeric", month: "short", timeZone: "Asia/Amman" });
};

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

/** Payment status of the invoice a treatment sits on. Same three statuses (and the same words) as the Invoices page. */
const PAY_STYLE: Record<string, { cls: string; key: string }> = {
  paid: { cls: "border-teal/40 bg-teal/10 text-teal", key: "inv.paid" },
  partially_paid: { cls: "border-amber-500/40 bg-amber-500/10 text-amber-400", key: "inv.partial" },
  unpaid: { cls: "border-red-500/40 bg-red-500/10 text-red-400", key: "inv.unpaid" },
};

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
        {/* the invoice's OWN payment status (read live from the invoice — never stored on the treatment) */}
        {billing.invoiceStatus && PAY_STYLE[billing.invoiceStatus] && (
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${PAY_STYLE[billing.invoiceStatus].cls}`}>{t(PAY_STYLE[billing.invoiceStatus].key)}</span>
        )}
        {typeof billing.amount === "number" && <span className="text-ink" dir="ltr">{money(billing.amount)}</span>}
        <span className="text-mute" dir="ltr">{invLabel(billing.invoiceNumber)}</span>
        {/* PHASE 4: for a doctor viewing a colleague's invoice the server redacts invoiceId/amount — no link to a page they can't open */}
        {billing.invoiceId ? <Link href={invHref(billing.invoiceNumber)} className="text-sky hover:underline">{t("dn.inv.view")}</Link> : null}
      </div>
    );
  }
  if (billing.state === "pending") return <div className="text-[11px] text-mute animate-pulse">{t("dn.inv.pending")}</div>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] text-mute">{t("dn.inv.notInvoiced")}</span>
      {canBill ? <button type="button" className="btn-ghost !px-2.5 !py-1 text-[11px]" onClick={onAdd}>{t("dn.inv.add")}</button> : null}
    </div>
  );
}
