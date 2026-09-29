"use client";
import { useMemo } from "react";
import { IconStethoscope } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useDentalRecord } from "@/lib/dental/hooks";
import { useTreatmentPlan } from "@/lib/dental/hooks";
import { StatusPill, TargetText, shortDate } from "./shared";

/**
 * Compact "what's this patient's dental situation" card for the top of Patient Profile — NOT a second Dental
 * Chart. Built entirely from the record + treatment-plan data the Dental Chart / Treatment Plan tabs already
 * fetch (useDentalRecord / useTreatmentPlan): no extra backend endpoint, so this can never disagree with them.
 */
export default function DentalOverviewCard({ patientId, onOpenChart, onOpenPlan }: { patientId: string; onOpenChart: () => void; onOpenPlan: () => void }) {
  const { t, lang } = useI18n();
  const rec = useDentalRecord(patientId);
  const plan = useTreatmentPlan(patientId);

  const activeDiagnoses = useMemo(() => (rec.data?.events ?? []).filter((e) => e.category === "diagnosis" && e.status === "active").length, [rec.data]);
  const active = useMemo(() => {
    const items = plan.data?.items ?? [];
    const inProgress = items.filter((i) => i.status === "in_progress");
    return inProgress[0] ?? items.filter((i) => i.status === "planned").sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
  }, [plan.data]);
  const lastActivity = useMemo(() => {
    const dates = [...(rec.data?.events ?? []).map((e) => e.createdAt), ...(plan.data?.timeline ?? []).map((e) => e.at)];
    return dates.length ? dates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b)) : null;
  }, [rec.data, plan.data]);
  const needsBilling = useMemo(() => (plan.data?.items ?? []).filter((i) => i.status === "completed" && i.billing.state === "none").length, [plan.data]);

  if (rec.isLoading || plan.isLoading) return <div className="card mb-3 h-24 animate-pulse p-3.5" aria-busy="true" />;
  if (rec.isError || !rec.data) return null; // e.g. 403 for a non-clinician role variant; the Dental Chart tab shows the real error

  const s = plan.data?.summary;
  const stat = (v: number | undefined, l: string) => (
    <div className="rounded-lg border border-edge bg-card2 px-2.5 py-1.5 text-center">
      <div className="text-sm font-medium text-ink">{v ?? 0}</div>
      <div className="text-[8px] tracking-wide text-mute">{l}</div>
    </div>
  );

  return (
    <div className="card mb-3 p-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-medium text-ink"><IconStethoscope size={14} className="text-teal" /> {t("dn.ov.title")}</h2>
        <span className="text-[10px] text-mute">{t("dn.dentition")}: <span className="text-ink">{t(`dn.dent.${rec.data.record.dentitionType}`)}</span></span>
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {stat(activeDiagnoses, t("dn.ov.diagnoses"))}
        {stat(s?.planned, t("dn.ov.planned"))}
        {stat(s?.inProgress, t("dn.ov.inProgress"))}
        {stat(s?.completed, t("dn.ov.completed"))}
        {stat(needsBilling, t("dn.ov.needsBilling"))}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-edge pt-2.5">
        <div className="min-w-0 flex-1 text-[11px]">
          <span className="text-mute">{t("dn.ov.activeWork")}: </span>
          {active ? (
            <span className="text-ink">
              {t(`dn.p.${active.procedureCode}`)} — <TargetText targetType={active.targetType} toothNumbers={active.toothNumbers} surfaces={active.surfaces} /> <StatusPill status={active.status} />
            </span>
          ) : (
            <span className="text-mute">{t("dn.ov.noActiveWork")}</span>
          )}
          <div className="mt-0.5 text-[9px] text-mute">{t("dn.ov.lastActivity")}: {lastActivity ? <span dir="ltr">{shortDate(lastActivity, lang)}</span> : t("dn.ov.noActivity")}</div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button type="button" className="btn-ghost !px-2.5 !py-1 text-[10px]" onClick={onOpenChart}>{t("dn.ov.openChart")}</button>
          <button type="button" className="btn-ghost !px-2.5 !py-1 text-[10px]" onClick={onOpenPlan}>{t("dn.ov.openPlan")}</button>
        </div>
      </div>
    </div>
  );
}
