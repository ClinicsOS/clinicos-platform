"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { IconCalendarPlus } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { errMsg } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useCompleteTreatment, useFinishSession, useSessionNotes, useStartTreatment, useVisitTreatments } from "@/lib/dental/hooks";
import type { TreatmentItem, TreatmentSession } from "@/lib/dental/types";
import AddToInvoiceModal, { type BillableTreatment } from "./AddToInvoiceModal";
import { BillingLine, PriorityPill, StatusPill, TargetText, money, scheduleNextVisitHref } from "./shared";

/**
 * The Dentistry section INSIDE the existing visit (Appointment) modal — rendered for dentistry clinics only.
 * It never replaces Visit Notes; it lists the planned treatments that can be started now and the work performed
 * in THIS visit. Start / End session / Complete are separate actions, each protected against double clicks.
 */
export default function VisitDentalSection({ patientId, patientName, appointmentId, canWrite }: { patientId: string; patientName: string; appointmentId: string; canWrite: boolean }) {
  const { t } = useI18n();
  const user = useAuth((s) => s.user);
  const currentDoctorId = user?.role === "doctor" ? user.id : undefined;
  const q = useVisitTreatments(patientId, appointmentId);
  const start = useStartTreatment(patientId);
  const finish = useFinishSession(patientId);
  const complete = useCompleteTreatment(patientId);
  const saveNotes = useSessionNotes(patientId);
  const lock = useRef(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [billing, setBilling] = useState<BillableTreatment | null>(null); // same Add-to-Invoice action as the Treatment Plan

  // one action at a time: a second click while one is running is ignored (backend is idempotent as well)
  const run = async (id: string, fn: () => Promise<unknown>) => {
    if (lock.current) return;
    lock.current = true; setBusyId(id); setError("");
    try { await fn(); } catch (e) { setError(errMsg(e, t("dn.err.action"))); }
    finally { lock.current = false; setBusyId(null); }
  };

  if (q.isLoading) return <div className="mb-3 rounded-lg border border-edge bg-card2 px-3 py-2 text-[11px] text-mute animate-pulse">{t("dn.loading")}</div>;
  if (q.isError || !q.data) return <div role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">{errMsg(q.error, t("dn.err.plan.load"))}</div>;

  const inThisVisit = new Set(q.data.performed.map((s) => s.itemId));
  const pending = q.data.pending.filter((i) => !inThisVisit.has(i._id));
  const itemOf = (s: TreatmentSession) => q.data!.pending.find((i) => i._id === s.itemId);

  return (
    <div className="mb-3 space-y-2 rounded-lg border border-teal/30 bg-teal/5 p-2.5" aria-label={t("dn.dentalTx")}>
      <div className="text-[11px] font-medium tracking-wide text-teal">{t("dn.dentalTx").toUpperCase()}</div>
      {error && <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-[11px] text-red-400">{error}</div>}

      <div>
        <div className="mb-1 text-[10px] font-medium text-mute">{t("dn.pendingTx")}</div>
        {pending.length === 0 ? <div className="text-[11px] text-mute">{t("dn.noPending")}</div> : (
          <div className="space-y-1.5">
            {pending.map((i) => <PendingRow key={i._id} it={i} canWrite={canWrite} busy={busyId === i._id || start.isPending}
              onStart={() => run(i._id, () => start.mutateAsync({ id: i._id, appointmentId }))} />)}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1 text-[10px] font-medium text-mute">{t("dn.performedHere")}</div>
        {q.data.performed.length === 0 ? <div className="text-[11px] text-mute">—</div> : (
          <div className="space-y-1.5">
            {q.data.performed.map((s) => (
              <SessionRow key={s._id} s={s} item={itemOf(s)} canWrite={canWrite} busy={busyId === s.itemId} patientId={patientId} patientName={patientName} currentDoctorId={currentDoctorId}
                onBill={() => setBilling({ _id: s.itemId, procedureCode: s.procedureCode, targetType: s.targetType, toothNumbers: s.toothNumbers, surfaces: s.surfaces, estimatedPrice: s.estimatedPrice ?? null })}
                onSaveNotes={(notes) => run(s.itemId, () => saveNotes.mutateAsync({ sessionId: s._id, notes }))}
                onFinish={(notes) => run(s.itemId, () => finish.mutateAsync({ id: s.itemId, appointmentId, notes }))}
                onComplete={(notes) => run(s.itemId, () => complete.mutateAsync({ id: s.itemId, appointmentId, notes }))} />
            ))}
          </div>
        )}
      </div>
      {billing && <AddToInvoiceModal patientId={patientId} item={billing} onClose={() => setBilling(null)} />}
    </div>
  );
}

function PendingRow({ it, canWrite, busy, onStart }: { it: TreatmentItem; canWrite: boolean; busy: boolean; onStart: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-edge bg-card px-2.5 py-1.5">
      <div className="min-w-0 flex-1 text-[12px]">
        <span className="text-ink">{t(`dn.p.${it.procedureCode}`)}</span>{" "}
        <span className="text-mute text-[11px]"><TargetText targetType={it.targetType} toothNumbers={it.toothNumbers} surfaces={it.surfaces} /></span>
      </div>
      <StatusPill status={it.status} />
      <PriorityPill priority={it.priority} />
      {it.estimatedPrice != null && <span className="text-[10px] text-mute" dir="ltr">{money(it.estimatedPrice)}</span>}
      {canWrite && <button type="button" className="btn-teal !px-2.5 !py-1 text-[11px] disabled:opacity-50" disabled={busy} onClick={onStart}>{it.status === "in_progress" ? t("dn.continue") : t("dn.start")}</button>}
    </div>
  );
}

function SessionRow({ s, item, canWrite, busy, patientId, patientName, currentDoctorId, onBill, onSaveNotes, onFinish, onComplete }: {
  s: TreatmentSession; item?: TreatmentItem; canWrite: boolean; busy: boolean; patientId: string; patientName: string; currentDoctorId?: string; onBill: () => void;
  onSaveNotes: (n: string) => void; onFinish: (n: string) => void; onComplete: (n: string) => void;
}) {
  const { t } = useI18n();
  const [notes, setNotes] = useState(s.notes ?? "");
  const open = s.status === "in_progress";
  const itemDone = s.itemStatus === "completed";
  const canComplete = canWrite && (s.itemStatus === "in_progress");
  return (
    <div className="rounded-lg border border-edge bg-card px-2.5 py-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        <span className="text-ink">{t(`dn.p.${s.procedureCode}`)}</span>
        <span className="text-[11px] text-mute"><TargetText targetType={s.targetType} toothNumbers={s.toothNumbers} surfaces={s.surfaces} /></span>
        <span className="text-[10px] text-mute">· {t("dn.session")} {s.sessionNumber}</span>
        {s.itemStatus && <span className="ms-auto"><StatusPill status={itemDone ? "completed" : open ? "in_progress" : s.itemStatus} /></span>}
      </div>
      {open && canWrite ? (
        <div className="mt-1.5 space-y-1.5">
          <textarea dir="auto" className="inp min-h-14 text-[11px]" maxLength={1000} placeholder={t("dn.sessionNotes")} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn-ghost !px-2.5 !py-1 text-[11px] disabled:opacity-50" disabled={busy} onClick={() => onSaveNotes(notes)}>{t("dn.saveNotes")}</button>
            <button type="button" className="btn-ghost !px-2.5 !py-1 text-[11px] disabled:opacity-50" disabled={busy} onClick={() => onFinish(notes)}>{t("dn.finishSession")}</button>
            <button type="button" className="btn-teal !px-2.5 !py-1 text-[11px] disabled:opacity-50" disabled={busy || !canComplete} onClick={() => onComplete(notes)}>{t("dn.complete")}</button>
          </div>
        </div>
      ) : (
        <>
          {s.notes && <p className="mt-1 text-[10px] text-mute">{s.notes}</p>}
          {/* Financial permission is the existing invoicing one (not the clinical one), so it is offered regardless of canWrite. */}
          {itemDone && s.billing && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <BillingLine billing={s.billing} canBill onAdd={onBill} />
              <ScheduleNextVisitLink t={t} patientId={patientId} patientName={patientName} currentDoctorId={currentDoctorId} s={s} />
            </div>
          )}
          {!open && !itemDone && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {canComplete && item && (
                <>
                  <span className="text-[10px] text-mute">{t("dn.sessionEnded")}</span>
                  <button type="button" className="btn-teal !px-2.5 !py-1 text-[11px] disabled:opacity-50" disabled={busy} onClick={() => onComplete("")}>{t("dn.complete")}</button>
                </>
              )}
              {/* Particularly useful for multi-session treatment: a session just ended, the plan item is still in progress. */}
              <ScheduleNextVisitLink t={t} patientId={patientId} patientName={patientName} currentDoctorId={currentDoctorId} s={s} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** "Schedule Next Visit" — reuses the EXISTING Appointment booking flow (New Appointment, pre-filled), no
 * separate Dental scheduling system. Available to any staff member, same as booking any other appointment. */
function ScheduleNextVisitLink({ t, patientId, patientName, currentDoctorId, s }: { t: (k: string) => string; patientId: string; patientName: string; currentDoctorId?: string; s: TreatmentSession }) {
  const href = scheduleNextVisitHref(t, { patientId, patientName, procedureCode: s.procedureCode, targetType: s.targetType, toothNumbers: s.toothNumbers, currentDoctorId });
  return (
    <Link href={href} className="btn-ghost !px-2.5 !py-1 text-[11px]">
      <IconCalendarPlus size={12} /> {t("dn.scheduleNext")}
    </Link>
  );
}
