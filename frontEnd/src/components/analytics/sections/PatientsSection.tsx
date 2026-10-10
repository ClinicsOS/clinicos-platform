"use client";
import { useI18n } from "@/lib/i18n";
import { CHART, hasSignal, num } from "@/lib/analytics";
import { Loader, type SectionProps } from "../common";
import { Empty, Footnote, Kpi, KpiGrid, Panel } from "../kit";
import { Donut, Legend, TrendChart } from "../charts";

export default function PatientsSection(p: SectionProps) {
  const { t } = useI18n();
  return (
    <Loader section="patients" filters={p.filters} owner={p.owner}>
      {(d) => {
        const k = d.kpis;
        const ser = [
          { key: "seen", label: t("an.k.patientsSeen"), color: CHART.teal, kind: "area" as const },
          ...(k.registered ? [{ key: "registered", label: t("an.k.registered"), color: CHART.blue, kind: "line" as const }] : []),
        ];
        return (
          <>
            <KpiGrid cols={k.registered ? 5 : 4}>
              <Kpi testId="kpi-seen" label={t("an.k.patientsSeen")} hint={t("an.h.patientsSeen")} c={k.seen} />
              <Kpi testId="kpi-new" label={t("an.k.newPatients")} hint={t("an.h.newPatients")} c={k.newPatients} />
              <Kpi testId="kpi-returning" label={t("an.k.returning")} hint={t("an.h.returning")} c={k.returningPatients} />
              <Kpi testId="kpi-visits-per" label={t("an.k.visitsPerPatient")} hint={t("an.h.visitsPerPatient")} c={k.visitsPerPatient} fmt="dec" good="neutral" />
              {k.registered && <Kpi testId="kpi-registered" label={t("an.k.registered")} hint={t("an.h.registered")} c={k.registered} good="neutral" />}
            </KpiGrid>
            <div className="mb-4 grid gap-3 lg:grid-cols-3">
              <Panel className="lg:col-span-2" title={t("an.p.patientsTrend")} hint={t("an.h.patientsTrend")}>
                {hasSignal(d.trend.points, ["seen", "registered"]) ? <><Legend series={ser} /><TrendChart points={d.trend.points} series={ser} granularity={d.trend.granularity} /></> : <Empty text={t("an.empty.patients")} />}
              </Panel>
              <Panel title={t("an.p.newVsReturning")} hint={t("an.h.newVsReturning")}>
                {d.newVsReturning.new + d.newVsReturning.returning > 0 ? (
                  <Donut testId="an-new-returning" centerLabel={t("an.k.patientsSeen")} slices={[
                    { key: "new", label: t("an.k.newPatients"), value: d.newVsReturning.new, color: CHART.teal },
                    { key: "returning", label: t("an.k.returning"), value: d.newVsReturning.returning, color: CHART.blue },
                  ]} />
                ) : <Empty compact text={t("an.empty.patients")} />}
                {d.totalPatients !== null && <p className="mt-3 border-t border-edge pt-3 text-[11px] text-mute">{t("an.k.totalPatients")}: <b className="text-ink" dir="ltr">{num(d.totalPatients)}</b></p>}
              </Panel>
            </div>
            <Panel title={t("an.p.retention")}>
              <p className="text-[11px] text-mute" data-testid="an-retention-note">{t("an.retentionDeferred")}</p>
            </Panel>
            <Footnote>{p.meta.scope.clinicWide ? t("an.note.patients") : t("an.note.patientsDoctor")}</Footnote>
          </>
        );
      }}
    </Loader>
  );
}
