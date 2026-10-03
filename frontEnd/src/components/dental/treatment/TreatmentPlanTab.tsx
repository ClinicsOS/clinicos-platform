"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { IconAlertTriangle, IconCalendarPlus, IconPencil, IconPlus, IconRefresh } from "@tabler/icons-react";
import axios from "axios";
import { useI18n } from "@/lib/i18n";
import { errMsg } from "@/lib/api";
import { useToast } from "@/components/Toast";
import Modal from "@/components/Modal";
import type { Appointment } from "@/lib/types";
import { useAuth } from "@/store/auth";
import { useCancelTreatment, useDentalRecord, useSetPhases, useStartTreatment, useTreatmentPlan } from "@/lib/dental/hooks";
import type { TreatmentItem, TreatmentPlanResponse } from "@/lib/dental/types";
import { procLabel } from "@/lib/dental/procedures";
import TreatmentEditor from "./TreatmentEditor";
import AddToInvoiceModal from "./AddToInvoiceModal";
import { BillingLine, PriorityPill, StatusPill, TargetText, TimelineRow, money, scheduleNextVisitHref, shortDate, visitText } from "./shared";

const isSameDay = (a: string, b: Date) => new Date(a).toDateString() === b.toDateString();

/** Visits that can hold performed work: real visits (scheduled / public / dashboard / WALK-IN), not cancelled or missed. */
function candidateVisits(visits: Appointment[]) {
  const now = new Date();
  const ok = visits.filter((v) => v.type !== "blocked" && v.status !== "cancelled" && v.status !== "no_show");
  const rank = (v: Appointment) => (isSameDay(v.startAt, now) ? 0 : new Date(v.startAt) <= now ? 1 : 2);
  return ok.sort((a, b) => rank(a) - rank(b) || (rank(a) === 1 ? +new Date(b.startAt) - +new Date(a.startAt) : +new Date(a.startAt) - +new Date(b.startAt)));
}

export default function TreatmentPlanTab({ patientId, patientName, canWrite, visits }: { patientId: string; patientName: string; canWrite: boolean; visits: Appointment[] }) {
  const { t, lang } = useI18n();
  const user = useAuth((s) => s.user);
  const currentDoctorId = user?.role === "doctor" ? user.id : undefined;
  const q = useTreatmentPlan(patientId);
  const rec = useDentalRecord(patientId);
  const dentition = rec.data?.record.dentitionType ?? "permanent";
  const [editor, setEditor] = useState<{ item?: TreatmentItem } | null>(null);
  const [starting, setStarting] = useState<TreatmentItem | null>(null);
  const [billing, setBilling] = useState<TreatmentItem | null>(null); // "Add to Invoice" confirmation
  const [showCancelled, setShowCancelled] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  if (q.isError) {
    const forbidden = axios.isAxiosError(q.error) && q.error.response?.status === 403;
    return (
      <div className="card flex flex-col items-center gap-3 p-8 text-center" role="alert">
        <IconAlertTriangle size={22} className="text-amber-400" />
        <div className="text-sm text-ink">{forbidden ? t("dn.err.forbidden") : errMsg(q.error, t("dn.err.plan.load"))}</div>
        {!forbidden && <button type="button" className="btn-ghost text-xs" onClick={() => q.refetch()}><IconRefresh size={13} /> {t("dn.retry")}</button>}
      </div>
    );
  }
  if (q.isLoading || !q.data) return <div className="card flex h-40 items-center justify-center text-sm text-mute animate-pulse">{t("dn.loading")}</div>;
  const d = q.data;

  const cancelledCount = d.items.filter((i) => i.status === "cancelled").length;
  const shown = d.items.filter((i) => showCancelled || i.status !== "cancelled");
  const phaseNums = Array.from(new Set([...d.plan.phases.map((p) => p.number), ...shown.map((i) => i.phase)])).sort((a, b) => a - b);
  const nameOf = (n: number) => d.plan.phases.find((p) => p.number === n)?.name;

  return (
    <div className="space-y-3">
      {/* summary header — treatment-plan ESTIMATES only, never financial truth */}
      <div className="card p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label={t("dn.ps.planned")} value={d.summary.planned} glyph="○" />
          <Stat label={t("dn.ps.in_progress")} value={d.summary.inProgress} glyph="◆" />
          <Stat label={t("dn.ps.completed")} value={d.summary.completed} glyph="✓" />
          <div className="rounded-lg border border-edge bg-card2 px-2.5 py-2">
            <div className="text-[9px] tracking-wide text-mute">{t("dn.plan.total")}</div>
            <div className="mt-0.5 text-sm font-medium text-ink" dir="ltr">{money(d.summary.estimatedTotal)}</div>
            <div className="text-[9px] text-mute">{t("dn.plan.remaining")}: <span dir="ltr">{money(d.summary.estimatedRemaining)}</span></div>
            {d.summary.invoicedCount > 0 && <div className="text-[9px] text-emerald-300">{t("dn.inv.total")}: <span dir="ltr">{money(d.summary.invoicedTotal)}</span></div>}
          </div>
        </div>
        <p className="mt-2 text-[10px] text-mute">{t("dn.plan.estimateNote")}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-medium text-ink">{t("dn.plan.title")}</h2>
        <div className="flex items-center gap-2">
          {cancelledCount > 0 && <button type="button" className="text-[11px] text-mute hover:text-ink" onClick={() => setShowCancelled((v) => !v)}>{showCancelled ? t("dn.hideCancelled") : t("dn.showCancelled")} ({cancelledCount})</button>}
          {canWrite && <button type="button" className="btn-teal !px-3 !py-1.5 text-xs" onClick={() => setEditor({})}><IconPlus size={13} /> {t("dn.plan.add")}</button>}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card p-8 text-center">
          <div className="text-sm text-ink">{t("dn.plan.empty")}</div>
          <div className="mt-1 text-[11px] text-mute">{t("dn.plan.emptyHint")}</div>
        </div>
      ) : (
        phaseNums.map((n) => {
          const list = shown.filter((i) => i.phase === n);
          if (!list.length) return null;
          return (
            <section key={n} className="space-y-2">
              <PhaseHeader num={n} name={nameOf(n)} canWrite={canWrite} patientId={patientId} phases={d.plan.phases} />
              {list.map((it) => (
                <ItemCard key={it._id} it={it} d={d} canWrite={canWrite} onEdit={() => setEditor({ item: it })} onStart={() => setStarting(it)} onBill={() => setBilling(it)} patientId={patientId} patientName={patientName} currentDoctorId={currentDoctorId} />
              ))}
            </section>
          );
        })
      )}

      {/* patient-level Dental History (includes general treatments that belong to no tooth) */}
      {d.timeline.length > 0 && (
        <div className="card p-3">
          <button type="button" className="text-[12px] font-medium text-ink" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
            {t("dn.dentalHistory")} ({d.timeline.length}) {showHistory ? "▾" : "▸"}
          </button>
          {showHistory && (
            <div className="mt-2 max-h-80 space-y-1.5 overflow-y-auto">
              {d.timeline.slice(0, 60).map((e) => <TimelineRow key={e.id} e={e} visits={d.visits} showTarget />)}
            </div>
          )}
        </div>
      )}

      {editor && <TreatmentEditor patientId={patientId} dentition={dentition} item={editor.item} phases={d.plan.phases} onClose={() => setEditor(null)} />}
      {billing && <AddToInvoiceModal patientId={patientId} item={billing} onClose={() => setBilling(null)} />}
      {starting && <StartVisitModal item={starting} visits={candidateVisits(visits)} patientId={patientId} lang={lang} onClose={() => setStarting(null)} />}
    </div>
  );
}

function Stat({ label, value, glyph }: { label: string; value: number; glyph: string }) {
  return (
    <div className="rounded-lg border border-edge bg-card2 px-2.5 py-2">
      <div className="text-[9px] tracking-wide text-mute"><span aria-hidden>{glyph}</span> {label}</div>
      <div className="mt-0.5 text-sm font-medium text-ink">{value}</div>
    </div>
  );
}

function PhaseHeader({ num, name, canWrite, patientId, phases }: { num: number; name?: string; canWrite: boolean; patientId: string; phases: { number: number; name?: string }[] }) {
  const { t } = useI18n();
  const toast = useToast();
  const set = useSetPhases(patientId);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(name ?? "");
  const save = async () => {
    const next = phases.some((p) => p.number === num) ? phases.map((p) => (p.number === num ? { ...p, name: val.trim() || undefined } : p)) : [...phases, { number: num, name: val.trim() || undefined }];
    try { await set.mutateAsync(next); setEditing(false); } catch (e) { toast.error(t("dn.err.action"), errMsg(e, "")); }
  };
  return (
    <div className="flex items-center gap-2 text-[11px] font-medium tracking-wide text-mute">
      <span>{t("dn.phase").toUpperCase()} {num}{name ? ` — ${name}` : ""}</span>
      {canWrite && !editing && <button type="button" aria-label={t("dn.edit")} className="rounded p-0.5 hover:text-ink" onClick={() => { setVal(name ?? ""); setEditing(true); }}><IconPencil size={12} /></button>}
      {editing && (
        <>
          <input className="inp !py-0.5 text-[11px]" maxLength={60} placeholder={t("dn.phaseName")} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
          <button type="button" className="btn-ghost !px-2 !py-0.5 text-[10px]" disabled={set.isPending} onClick={save}>{t("dn.save")}</button>
        </>
      )}
      <span className="h-px flex-1 bg-edge" />
    </div>
  );
}

function ItemCard({ it, d, canWrite, onEdit, onStart, onBill, patientId, patientName, currentDoctorId }: { it: TreatmentItem; d: TreatmentPlanResponse; canWrite: boolean; onEdit: () => void; onStart: () => void; onBill: () => void; patientId: string; patientName: string; currentDoctorId?: string }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const cancel = useCancelTreatment(patientId);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const lock = useRef(false);
  const sessions = d.sessions.filter((s) => s.itemId === it._id);
  const active = it.status === "planned" || it.status === "in_progress";

  const doCancel = async () => {
    if (lock.current) return;
    lock.current = true;
    try { await cancel.mutateAsync({ id: it._id, reason: reason.trim() || undefined }); setCancelling(false); }
    catch (e) { toast.error(t("dn.err.action"), errMsg(e, "")); }
    finally { lock.current = false; }
  };

  return (
    <div className={`card p-3 ${it.status === "cancelled" ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-ink">{procLabel(t, it)}</span>
            <StatusPill status={it.status} />
            <PriorityPill priority={it.priority} />
          </div>
          <div className="mt-0.5 text-[12px] text-mute"><TargetText targetType={it.targetType} toothNumbers={it.toothNumbers} surfaces={it.surfaces} /></div>
          {it.notes && <p className="mt-1 text-[11px] text-mute">{it.notes}</p>}
          {it.status === "cancelled" && it.cancelReason && <p className="mt-1 text-[11px] italic text-mute">{it.cancelReason}</p>}
        </div>
        {it.estimatedPrice != null && (
          <div className="text-end">
            <div className="text-[9px] text-mute">{t("dn.price")}</div>
            <div className="text-[12px] font-medium text-ink" dir="ltr">{money(it.estimatedPrice)}</div>
          </div>
        )}
      </div>

      {/* Financial LINK only: estimate above is never overwritten by the invoiced amount; balances live in the invoice. */}
      {it.status === "completed" && (
        <div className="mt-2 border-t border-edge pt-2"><BillingLine billing={it.billing} canBill onAdd={onBill} /></div>
      )}

      {canWrite && active && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" className="btn-teal !px-3 !py-1 text-[11px]" onClick={onStart}>{it.status === "in_progress" ? t("dn.continue") : t("dn.start")}</button>
          <button type="button" className="btn-ghost !px-3 !py-1 text-[11px]" onClick={onEdit}>{t("dn.edit")}</button>
          <button type="button" className="btn-ghost !px-3 !py-1 text-[11px] hover:!border-red-400 hover:!text-red-400" onClick={() => setCancelling((v) => !v)}>{t("dn.cancelTx")}</button>
          {/* Particularly useful for multi-session treatment reviewed outside the live visit screen. Booking is available to any staff member, same as any other appointment. */}
          {it.status === "in_progress" && (
            <Link href={scheduleNextVisitHref(t, { patientId, patientName, procedureCode: it.procedureCode, customName: it.customName, targetType: it.targetType, toothNumbers: it.toothNumbers, currentDoctorId })} className="btn-ghost !px-3 !py-1 text-[11px]">
              <IconCalendarPlus size={12} /> {t("dn.scheduleNext")}
            </Link>
          )}
        </div>
      )}
      {cancelling && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-red-500/30 bg-red-500/5 p-2">
          <input className="inp text-[11px]" maxLength={300} placeholder={t("dn.cancelReason")} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-1.5">
            <button type="button" className="btn-ghost !px-3 !py-1 text-[11px] !border-red-400 !text-red-400 disabled:opacity-50" disabled={cancel.isPending} onClick={doCancel}>{t("dn.confirmCancel")}</button>
            <button type="button" className="btn-ghost !px-3 !py-1 text-[11px]" onClick={() => setCancelling(false)}>{t("dn.keep")}</button>
          </div>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="mt-2">
          <button type="button" className="text-[11px] text-sky hover:underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{t("dn.sessions")} ({sessions.length}) {open ? "▾" : "▸"}</button>
          {open && (
            <div className="mt-1 space-y-1">
              {sessions.map((s) => (
                <div key={s._id} className="rounded-lg border border-edge bg-card2 px-2.5 py-1.5 text-[11px]">
                  <span className="text-ink">{t("dn.session")} {s.sessionNumber}</span>
                  <span className="text-mute"> · {t("dn.h.visit")} {visitText(d.visits[s.appointmentId], lang, t("dn.walkIn")) || shortDate(s.startedAt, lang)}
                    {s.performedBy ? ` · ${s.performedBy.name}` : ""} · {s.status === "completed" ? t("dn.sessionEnded") : t("dn.ps.in_progress")}</span>
                  {s.notes && <p className="mt-0.5 text-[10px] text-mute">{s.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Start / Continue must be tied to an EXISTING visit (scheduled, dashboard, public or walk-in). */
function StartVisitModal({ item, visits, patientId, lang, onClose }: { item: TreatmentItem; visits: Appointment[]; patientId: string; lang: string; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const start = useStartTreatment(patientId);
  const [sel, setSel] = useState<string>(visits[0]?._id ?? "");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const go = async () => {
    if (!sel || lock.current) return;
    lock.current = true; setError("");
    try { await start.mutateAsync({ id: item._id, appointmentId: sel }); toast.success(item.status === "in_progress" ? t("dn.continue") : t("dn.start")); onClose(); }
    catch (e) { setError(errMsg(e, t("dn.err.action"))); }
    finally { lock.current = false; }
  };
  const docName = (v: Appointment) => (typeof v.doctorId === "object" ? v.doctorId?.name : "");
  return (
    <Modal title={item.status === "in_progress" ? t("dn.continue") : t("dn.start")} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-[12px] text-ink">{procLabel(t, item)} — <span className="text-mute"><TargetText targetType={item.targetType} toothNumbers={item.toothNumbers} surfaces={item.surfaces} /></span></div>
        {visits.length === 0 ? (
          <p className="rounded-lg border border-edge bg-card2 px-3 py-2 text-[11px] text-mute">{t("dn.noVisit")}</p>
        ) : (
          <>
            <label className="lbl">{t("dn.pickVisit")}</label>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {visits.map((v) => (
                <button key={v._id} type="button" aria-pressed={sel === v._id} onClick={() => setSel(v._id)}
                  className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-start text-[11px] ${sel === v._id ? "border-teal bg-teal/10 text-ink" : "border-edge bg-card2 text-mute hover:border-sky"}`}>
                  <span dir="ltr" className="font-mono">{new Date(v.startAt).toLocaleDateString(lang === "ar" ? "ar-JO" : "en-GB", { day: "numeric", month: "short" })} {new Date(v.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  {v.source === "walk_in" && <span className="rounded-full border border-edge px-1.5 text-[9px]">{t("dn.walkIn")}</span>}
                  <span className="ms-auto">{docName(v)}</span>
                  <span className="text-[9px]">{t(`status.${v.status}`)}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>{t("dn.cancel")}</button>
          <button type="button" className="btn-teal text-xs disabled:opacity-50" disabled={!sel || start.isPending} onClick={go}>{item.status === "in_progress" ? t("dn.continue") : t("dn.start")}</button>
        </div>
      </div>
    </Modal>
  );
}
