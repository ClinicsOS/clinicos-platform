"use client";
import { useState } from "react";
import Link from "next/link";
import { IconCalendarPlus, IconChevronDown, IconChevronUp, IconMap2, IconReceipt } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { MAX_TREATMENT_TEXT } from "@/lib/derm/procedures";
import type { FollowUp, TreatmentItem, TreatmentSession, VisitRef } from "@/lib/derm/treatmentTypes";
import { useCancelTreatment, useFollowUps } from "@/lib/derm/treatmentHooks";
import { RecordTypeBadge, fmtDate, fmtDateTime } from "../dermUi";
import FollowUpCard from "./FollowUpCard";
import { PriorityPill, StatusPill, TargetChips, billingState, invHref, invLabel, money, scheduleNextVisitHref, treatmentErrorKey, useProcLabel, useTargetText, visitText } from "./shared";

interface Props {
  item: TreatmentItem;
  sessions: TreatmentSession[];
  visits: Record<string, VisitRef>;
  patientId: string;
  patientName: string;
  canWrite: boolean;
  currentDoctorId?: string;
  phaseName?: string;
  onViewMap: (regionIds: string[]) => void;
  onStart: () => void;
  onEdit: () => void;
  onFollowUp: () => void;
  onBill: () => void;
  highlight?: boolean;
}

/**
 * One treatment plan item. Everything shown is the clinician's record: status, target, sessions, follow-ups. The
 * ESTIMATE is labelled as such and is never presented as an amount owed; "Needs billing" only says the completed treatment
 * has not been put on an invoice yet.
 */
export default function TreatmentCard({ item: it, sessions, visits, patientId, patientName, canWrite, currentDoctorId, phaseName, onViewMap, onStart, onEdit, onFollowUp, onBill, highlight }: Props) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const procLabel = useProcLabel();
  const targetText = useTargetText();
  const cancel = useCancelTreatment(patientId);
  const [open, setOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [cancelErr, setCancelErr] = useState<string | null>(null);
  const fuQ = useFollowUps(patientId, { itemId: it._id }, open);

  const active = it.status === "planned" || it.status === "in_progress";
  const mine = sessions.filter((s) => s.itemId === it._id);
  const regionIds = it.regions.map((r) => r.id);
  const bs = billingState(it.status, it.billing);
  const cancelledEntry = it.statusHistory.find((h) => h.status === "cancelled");
  const nextHref = scheduleNextVisitHref(t, { patientId, patientName, procedure: procLabel(it.procedureCode), target: targetText(it), currentDoctorId });

  const doCancel = async () => {
    setCancelErr(null);
    try { await cancel.mutateAsync({ itemId: it._id, reason: reason.trim() }); toast.success(t("dt.cancelled.toast")); setCancelling(false); } catch (e) { setCancelErr(t(treatmentErrorKey(e))); }
  };

  return (
    <article id={`dt-item-${it._id}`} className={`rounded-xl border bg-card p-3 ${highlight ? "border-teal" : "border-edge"} ${it.status === "cancelled" ? "opacity-75" : ""}`} aria-label={procLabel(it.procedureCode)}>
      <div className="flex flex-wrap items-center gap-1.5">
        <RecordTypeBadge type={it.recordType} />
        <StatusPill status={it.status} />
        <PriorityPill priority={it.priority} />
        <span className="rounded-full border border-edge bg-soft px-2 py-0.5 text-[10px] text-mute">{phaseName ? `${t("dt.phase")} ${it.phase} — ${phaseName}` : `${t("dt.phase")} ${it.phase}`}</span>
      </div>

      <div className="mt-1.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-medium text-ink">{procLabel(it.procedureCode)}</h4>
          <div className="mt-1 flex flex-wrap gap-1.5"><TargetChips targetType={it.targetType} regions={it.regions} generalArea={it.generalArea} onRegion={undefined} /></div>
          {it.notes && <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-mute">{it.notes}</p>}
          {it.sourceAssessmentId && (
            <p className="mt-1 text-[11px] text-mute">{t("dt.fromAssessment")}{it.sourceDiagnosis ? <> · {t("dt.form.diagnosisSnapshot")}: <span className="text-ink">{it.sourceDiagnosis}</span></> : null}</p>
          )}
          {it.status === "cancelled" && (
            <p className="mt-1 text-[11px] italic text-mute">
              {t("dt.cancelledBy").replace("{name}", cancelledEntry?.by?.name ?? "—").replace("{d}", cancelledEntry ? fmtDate(cancelledEntry.at, lang) : "")}
              {it.cancelReason ? ` — ${it.cancelReason}` : ""}
            </p>
          )}
        </div>
        {it.estimatedPrice != null && (
          <div className="shrink-0 text-end">
            <div className="text-[9px] text-mute">{t("dt.estimate")}</div>
            <div className="text-[12px] font-medium text-ink" dir="ltr">{money(it.estimatedPrice)}</div>
          </div>
        )}
      </div>

      {/* progress facts */}
      {(it.stats.sessionCount > 0 || it.stats.nextFollowUpDueAt || it.stats.followUpCount > 0) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-mute">
          {it.stats.sessionCount > 0 && <span>{t("dt.sessions")}: <b className="text-ink">{it.stats.sessionCount}</b></span>}
          {it.stats.lastSessionAt && <span>{t("dt.lastSession")}: <b className="text-ink">{fmtDate(it.stats.lastSessionAt, lang)}</b></span>}
          {it.stats.nextFollowUpDueAt && <span>{t("dt.nextFollowUp")}: <b className="text-ink">{fmtDate(it.stats.nextFollowUpDueAt, lang)}</b></span>}
          {it.stats.followUpCount > 0 && <span>{t("dt.followUps")}: <b className="text-ink">{it.stats.followUpCount}</b></span>}
        </div>
      )}

      {/* billing: a LINK to the invoice; the invoice is the only financial truth */}
      {it.status === "completed" && (
        <div className="mt-2 border-t border-edge pt-2 text-[11px]">
          {bs === "invoiced" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">{t("dt.billing.invoiced")}</span>
              <span dir="ltr" className="font-mono text-ink">{invLabel(it.billing.invoiceNumber ?? 0)}</span>
              {it.billing.amount != null && <span dir="ltr" className="text-mute">{money(it.billing.amount)}</span>}
              <Link href={invHref(it.billing.invoiceNumber ?? 0)} className="ms-auto inline-flex items-center gap-1 text-teal underline"><IconReceipt size={12} />{t("dt.billing.view")}</Link>
            </div>
          )}
          {bs === "pending" && <span className="text-mute">{t("dt.billing.pending")}</span>}
          {bs === "needs" && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-300" title={t("dt.billing.needsTip")}>{t("dt.billing.needs")}</span>
              <button type="button" className="btn-teal ms-auto !px-3 !py-1 text-[11px]" onClick={onBill}><IconReceipt size={12} className="me-1 inline" />{t("dt.inv.add")}</button>
            </div>
          )}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className="btn-ghost !px-3 !py-1 text-[11px]" onClick={() => onViewMap(regionIds)} disabled={regionIds.length === 0} title={regionIds.length === 0 ? t("dt.viewMap.general") : undefined}>
          <IconMap2 size={12} className="me-1 inline" />{t("dt.viewMap")}
        </button>
        {canWrite && active && (
          <>
            <button type="button" className="btn-teal !px-3 !py-1 text-[11px]" onClick={onStart}>{t(it.status === "in_progress" ? "dt.continue" : "dt.start")}</button>
            <button type="button" className="btn-ghost !px-3 !py-1 text-[11px]" onClick={onEdit}>{t("dm.edit")}</button>
            <button type="button" className="btn-ghost !px-3 !py-1 text-[11px] hover:!border-red-400 hover:!text-red-400" onClick={() => { setCancelErr(null); setCancelling((v) => !v); }}>{t("dt.cancelTx")}</button>
          </>
        )}
        {canWrite && it.status !== "planned" && it.status !== "cancelled" && (
          <button type="button" className="btn-ghost !px-3 !py-1 text-[11px]" onClick={onFollowUp}>{t("dt.fu.add")}</button>
        )}
        {(it.status === "in_progress" || it.status === "completed") && (
          <Link href={nextHref} className="btn-ghost !px-3 !py-1 text-[11px]"><IconCalendarPlus size={12} className="me-1 inline" />{t("dt.scheduleNext")}</Link>
        )}
      </div>

      {cancelling && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-red-500/30 bg-red-500/5 p-2">
          <p className="text-[11px] text-red-100">{t("dt.cancelExplain")}</p>
          <input className="inp text-[11px]" maxLength={MAX_TREATMENT_TEXT.cancelReason} placeholder={t("dt.cancelReason")} aria-label={t("dt.cancelReason")} value={reason} onChange={(e) => setReason(e.target.value)} />
          {cancelErr && <div role="alert" className="text-[11px] text-red-300">{cancelErr}</div>}
          <div className="flex gap-1.5">
            <button type="button" className="btn-ghost !px-3 !py-1 text-[11px] !border-red-400 !text-red-400 disabled:opacity-50" disabled={cancel.isPending} onClick={() => void doCancel()}>{t("dt.cancelConfirm")}</button>
            <button type="button" className="btn-ghost !px-3 !py-1 text-[11px]" onClick={() => setCancelling(false)}>{t("dt.keep")}</button>
          </div>
        </div>
      )}

      <button type="button" className="mt-2 inline-flex items-center gap-1 text-[11px] text-sky hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}{t("dt.details")}
      </button>
      {open && (
        <div className="mt-2 space-y-3 dn-fade-in">
          <div>
            <div className="lbl">{t("dt.history")}</div>
            <ol className="space-y-1">
              {it.statusHistory.map((h, i) => (
                <li key={i} className="rounded-lg border border-edge bg-card2 px-2.5 py-1.5 text-[11px] text-ink">
                  {t(`dt.h.${h.status}`)} · <span className="text-mute">{fmtDateTime(h.at, lang)}{h.by ? ` · ${h.by.name}` : ""}{h.appointmentId && visits[h.appointmentId] ? ` · ${visitText(visits[h.appointmentId], lang, t("dt.walkIn"))}` : ""}</span>
                  {h.note && <div className="text-mute">{h.note}</div>}
                </li>
              ))}
            </ol>
          </div>
          {mine.length > 0 && (
            <div>
              <div className="lbl">{t("dt.sessions")}</div>
              <div className="space-y-1">
                {mine.map((s) => (
                  <div key={s._id} className="rounded-lg border border-edge bg-card2 px-2.5 py-1.5 text-[11px]">
                    <div className="text-ink">{t("dt.session.no").replace("{n}", String(s.sessionNumber))} · <span className="text-mute">{visitText(visits[s.appointmentId], lang, t("dt.walkIn")) || fmtDate(s.startedAt, lang)} · {s.status === "ended" ? t("dt.session.ended") : t("dt.session.open")}{s.autoClosed ? ` · ${t("dt.session.auto")}` : ""}{s.performedBy ? ` · ${s.performedBy.name}` : ""}</span></div>
                    {s.procedureNotes && <p className="mt-0.5 whitespace-pre-wrap text-mute">{s.procedureNotes}</p>}
                    {s.outcome && <p className="mt-0.5 text-mute">{t("dt.session.outcome")}: {s.outcome}</p>}
                    {s.product && (s.product.name || s.product.lotNumber) && <p className="mt-0.5 text-mute">{t("dt.trace.product")}: {[s.product.name, s.product.brand, s.product.lotNumber && `${t("dt.trace.lot")} ${s.product.lotNumber}`, [s.product.quantity, s.product.unit].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</p>}
                    {s.device && (s.device.name || s.device.identifier) && <p className="mt-0.5 text-mute">{t("dt.trace.device")}: {[s.device.name, s.device.identifier, s.device.settingsSummary].filter(Boolean).join(" · ")}</p>}
                    <a className="mt-1 inline-flex items-center gap-1 text-[10.5px] text-sky hover:underline" href={`/derm-report?patient=${encodeURIComponent(patientId)}&type=session&session=${encodeURIComponent(s._id)}`} target="_blank" rel="noopener noreferrer">{t("dr.printSession")}</a>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="lbl">{t("dt.followUps")}</div>
            {fuQ.isLoading ? <p className="text-[11px] text-mute">{t("common.loading")}</p> : fuQ.isError ? <p role="alert" className="text-[11px] text-red-300">{t("dm.err.load")} <button type="button" className="underline" onClick={() => void fuQ.refetch()}>{t("dm.retry")}</button></p> : (fuQ.data ?? []).length === 0 ? <p className="text-[11px] text-mute">{t("dt.fu.none")}</p> : (
              <div className="space-y-2">{(fuQ.data as FollowUp[]).map((f) => <FollowUpCard key={f._id} f={f} patientId={patientId} canWrite={canWrite} session={f.sessionId ? mine.find((x) => x._id === f.sessionId) : undefined} onViewMap={onViewMap} />)}</div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
