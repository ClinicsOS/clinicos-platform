"use client";
import { useMemo, useState } from "react";
import { IconAlertTriangle, IconPlus, IconRefresh } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import Modal from "@/components/Modal";
import { SkeletonList } from "@/components/Skeleton";
import { useAuth } from "@/store/auth";
import { useDermBridge } from "@/store/dermBridge";
import type { TreatmentItem } from "@/lib/derm/treatmentTypes";
import { useTreatmentPlan } from "@/lib/derm/treatmentHooks";
import { dermErrorCode } from "@/lib/derm/hooks";
import { money } from "./shared";
import TreatmentCard from "./TreatmentCard";
import TreatmentForm from "./TreatmentForm";
import SessionPanel from "./SessionPanel";
import FollowUpForm from "./FollowUpForm";
import AddToInvoiceModal from "./AddToInvoiceModal";

type Filter = "active" | "planned" | "in_progress" | "completed" | "billing";

interface Props {
  patientId: string;
  patientName: string;
  canWrite: boolean;
  /** Switches the Patient Profile to the Clinical Map (the parent owns the tabs). */
  onOpenMap: () => void;
}

/**
 * Treatment Plan tab (Dermatology & Aesthetics). Reads ONE endpoint; every mutation refetches from the server. The plan
 * lists what the clinician intends / did — the money side (estimates vs invoices) is kept visibly separate.
 */
export default function TreatmentPlanTab({ patientId, patientName, canWrite, onOpenMap }: Props) {
  const { t } = useI18n();
  const user = useAuth((s) => s.user);
  const q = useTreatmentPlan(patientId);
  const requestFocus = useDermBridge((s) => s.requestFocus);
  const [filter, setFilter] = useState<Filter>("active");
  const [showCancelled, setShowCancelled] = useState(false);
  const [dlg, setDlg] = useState<null | { kind: "add" } | { kind: "edit"; item: TreatmentItem } | { kind: "session"; item: TreatmentItem } | { kind: "followup"; item: TreatmentItem } | { kind: "bill"; item: TreatmentItem }>(null);

  const data = q.data;
  const items = data?.items ?? [];

  // an item that changed (start / complete ...) is re-read from the server: keep the open dialog pointing at the fresh copy
  const fresh = (i: TreatmentItem) => items.find((x) => x._id === i._id) ?? i;

  const phaseName = useMemo(() => new Map((data?.plan.phases ?? []).map((p) => [p.number, p.name])), [data]);
  const shown = useMemo(() => {
    const byFilter = items.filter((i) => {
      if (i.status === "cancelled") return showCancelled;
      if (filter === "active") return i.status === "planned" || i.status === "in_progress";
      if (filter === "billing") return i.status === "completed" && i.billing.state === "none";
      return i.status === filter;
    });
    const groups = new Map<number, TreatmentItem[]>();
    byFilter.forEach((i) => groups.set(i.phase, [...(groups.get(i.phase) ?? []), i]));
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [items, filter, showCancelled]);

  const viewOnMap = (ids: string[]) => { if (!ids.length) return; requestFocus(patientId, ids); onOpenMap(); };
  const forbidden = q.isError && dermErrorCode(q.error) === "FORBIDDEN";

  const tabs: { k: Filter; n?: number }[] = [
    { k: "active", n: (data?.summary.planned ?? 0) + (data?.summary.inProgress ?? 0) },
    { k: "planned", n: data?.summary.planned }, { k: "in_progress", n: data?.summary.inProgress },
    { k: "completed", n: data?.summary.completed }, { k: "billing", n: data?.summary.needsBilling },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-ink">{t("dt.plan.title")}</h3>
        {canWrite && <button type="button" className="btn-teal ms-auto inline-flex items-center gap-1 !py-1.5 text-xs" onClick={() => setDlg({ kind: "add" })}><IconPlus size={14} />{t("dt.add")}</button>}
      </div>

      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {([["planned", data.summary.planned], ["in_progress", data.summary.inProgress], ["completed", data.summary.completed], ["billing", data.summary.needsBilling], ["cancelled", data.summary.cancelled]] as const).map(([k, n]) => (
            <div key={k} className="card px-3 py-2">
              <div className="text-base font-medium text-ink">{n}</div>
              <div className="text-[10px] text-mute">{k === "billing" ? t("dt.billing.needs") : t(`dt.status.${k}`)}</div>
            </div>
          ))}
        </div>
      )}
      {data && data.summary.estimatedTotal > 0 && (
        <p className="rounded-lg bg-soft px-3 py-2 text-[11px] text-mute">
          {t("dt.estimateBar").replace("{total}", money(data.summary.estimatedTotal)).replace("{remaining}", money(data.summary.estimatedRemaining))}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label={t("dt.plan.title")}>
        {tabs.map(({ k, n }) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${filter === k ? "border-teal bg-teal/15 text-teal" : "border-edge bg-soft text-mute hover:text-ink"}`}>
            {k === "active" ? t("dt.filter.active") : k === "billing" ? t("dt.billing.needs") : t(`dt.status.${k}`)}{n != null ? ` (${n})` : ""}
          </button>
        ))}
        <label className="ms-auto flex items-center gap-1.5 text-[11px] text-mute">
          <input type="checkbox" className="accent-teal" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />{t("dt.showCancelled")}
        </label>
      </div>

      {forbidden && <div role="alert" className="card p-4 text-sm text-red-300">{t("dm.err.forbidden")}</div>}
      {q.isLoading && <SkeletonList rows={3} />}
      {q.isError && !forbidden && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300">
          <IconAlertTriangle size={14} />{t("dt.err.load")}
          <button type="button" className="ms-2 inline-flex items-center gap-1 underline" onClick={() => void q.refetch()}><IconRefresh size={12} />{t("dm.retry")}</button>
        </div>
      )}
      {data && shown.length === 0 && (
        <p className="rounded-xl border border-dashed border-edge p-6 text-center text-xs text-mute">{items.length === 0 ? t("dt.empty") : t("dt.emptyFilter")}</p>
      )}

      {shown.map(([phase, list]) => (
        <section key={phase} className="space-y-2" aria-label={`${t("dt.phase")} ${phase}`}>
          {(shown.length > 1 || phaseName.get(phase)) && <h4 className="text-[11px] font-medium uppercase tracking-wide text-mute">{t("dt.phase")} {phase}{phaseName.get(phase) ? ` — ${phaseName.get(phase)}` : ""}</h4>}
          {list.map((it) => (
            <TreatmentCard key={it._id} item={it} sessions={data!.sessions} visits={data!.visits} patientId={patientId} patientName={patientName} canWrite={canWrite}
              currentDoctorId={user?.role === "doctor" ? user.id : undefined} phaseName={phaseName.get(it.phase)}
              onViewMap={viewOnMap} onStart={() => setDlg({ kind: "session", item: it })} onEdit={() => setDlg({ kind: "edit", item: it })}
              onFollowUp={() => setDlg({ kind: "followup", item: it })} onBill={() => setDlg({ kind: "bill", item: it })} />
          ))}
        </section>
      ))}

      {dlg?.kind === "add" && (
        <Modal title={t("dt.form.title")} size="lg" onClose={() => setDlg(null)}>
          <div className="px-5 py-4"><TreatmentForm patientId={patientId} mode="create" prefill={{ regions: [] }} onSaved={() => setDlg(null)} onCancel={() => setDlg(null)} /></div>
        </Modal>
      )}
      {dlg?.kind === "edit" && (
        <Modal title={t("dt.form.editTitle")} size="lg" onClose={() => setDlg(null)}>
          <div className="px-5 py-4"><TreatmentForm patientId={patientId} mode="edit" item={fresh(dlg.item)} onSaved={() => setDlg(null)} onCancel={() => setDlg(null)} /></div>
        </Modal>
      )}
      {dlg?.kind === "session" && data && (
        <Modal title={t("dt.session.title")} size="lg" onClose={() => setDlg(null)}>
          <div className="px-5 py-4"><SessionPanel patientId={patientId} patientName={patientName} item={fresh(dlg.item)} sessions={data.sessions} currentDoctorId={user?.role === "doctor" ? user.id : undefined} onClose={() => setDlg(null)} /></div>
        </Modal>
      )}
      {dlg?.kind === "followup" && data && (
        <Modal title={t("dt.fu.title")} size="lg" onClose={() => setDlg(null)}>
          <div className="px-5 py-4"><FollowUpForm patientId={patientId} item={fresh(dlg.item)} sessions={data.sessions} onSaved={() => setDlg(null)} onCancel={() => setDlg(null)} /></div>
        </Modal>
      )}
      {dlg?.kind === "bill" && <AddToInvoiceModal patientId={patientId} item={fresh(dlg.item)} onClose={() => setDlg(null)} />}
    </div>
  );
}
