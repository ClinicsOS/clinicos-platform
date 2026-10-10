"use client";
import { IconBulb } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { CHART, jd, num, procName } from "@/lib/analytics";
import { Loader, type SectionProps } from "../common";
import { Empty, Footnote, Kpi, KpiGrid, Panel } from "../kit";
import { Legend, TrendChart } from "../charts";
import { hasSignal } from "@/lib/analytics";

export default function OverviewSection(p: SectionProps) {
  const { t, lang } = useI18n();
  const series = [
    { key: "collected", label: t("an.k.collected"), color: CHART.teal, kind: "bar" as const },
    { key: "expenses", label: t("an.k.expenses"), color: CHART.amber, kind: "bar" as const },
    { key: "net", label: "", color: CHART.blue, kind: "line" as const },
  ];
  return (
    <Loader section="overview" filters={p.filters} owner={p.owner}>
      {(d) => {
        const contribution = d.netKind === "doctor_contribution";
        const netLabel = contribution ? t("an.k.netContribution") : t("an.k.netCash");
        const ser = series.map((s) => (s.key === "net" ? { ...s, label: netLabel } : s));
        const k = d.kpis, ins = d.insights;
        const tr = d.trend.points as any[];
        return (
          <>
            <KpiGrid>
              <Kpi testId="kpi-collected" label={t("an.k.collected")} hint={t("an.h.collected")} c={k.collected} fmt="jd" unit="JD" tone="teal" />
              <Kpi testId="kpi-invoiced" label={t("an.k.invoiced")} hint={t("an.h.invoiced")} c={k.invoiced} fmt="jd" unit="JD" good="neutral" />
              <Kpi testId="kpi-expenses" label={t("an.k.expenses")} hint={contribution ? t("an.h.expensesDoctor") : t("an.h.expenses")} c={k.expenses} fmt="jd" unit="JD" good="down" />
              <Kpi testId="kpi-net" label={netLabel} hint={contribution ? t("an.h.netContribution") : t("an.h.netCash")} c={k.netCash} fmt="jd" unit="JD" tone="sky" />
            </KpiGrid>
            <KpiGrid cols={5}>
              <Kpi testId="kpi-appointments" label={t("an.k.appointments")} hint={t("an.h.appointments")} c={k.appointments} good="neutral" />
              <Kpi testId="kpi-completed" label={t("an.k.completed")} hint={t("an.h.completed")} c={k.completed} />
              <Kpi testId="kpi-walkins" label={t("an.k.walkIns")} hint={t("an.h.walkIns")} c={k.walkIns} good="neutral" />
              <Kpi testId="kpi-seen" label={t("an.k.patientsSeen")} hint={t("an.h.patientsSeen")} c={k.patientsSeen} />
              <Kpi testId="kpi-new" label={t("an.k.newPatients")} hint={t("an.h.newPatients")} c={k.newPatients} />
            </KpiGrid>
            <KpiGrid>
              <Kpi testId="kpi-cancel" label={t("an.k.cancellationRate")} hint={t("an.h.cancellationRate")} c={k.cancellationRate} fmt="pct" good="down" />
              <Kpi testId="kpi-noshow" label={t("an.k.noShowRate")} hint={t("an.h.noShowRate")} c={k.noShowRate} fmt="pct" good="down" />
              <Kpi testId="kpi-avgpatient" label={t("an.k.avgPerPatient")} hint={t("an.h.avgPerPatient")} c={k.avgCollectedPerPatient} fmt="jd" unit="JD" good="neutral" />
              <Kpi testId="kpi-avgvisit" label={t("an.k.avgPerVisit")} hint={t("an.h.avgPerVisit")} c={k.avgCollectedPerVisit} fmt="jd" unit="JD" good="neutral" />
            </KpiGrid>

            <div className="mb-4 grid gap-3 lg:grid-cols-3">
              <Panel className="lg:col-span-2" title={t("an.p.trend")} hint={t("an.h.trend")}>
                {hasSignal(tr, ["collected", "expenses", "invoiced"]) ? (
                  <>
                    <Legend series={ser} />
                    <TrendChart points={tr} series={ser} granularity={d.trend.granularity} money />
                  </>
                ) : <Empty text={t("an.empty.money")} />}
              </Panel>
              <div className="grid content-start gap-3">
                <Panel title={t("an.p.standing")}>
                  <div className="space-y-3 text-[11px]">
                    <div className="flex items-baseline justify-between gap-2" data-testid="standing-outstanding">
                      <span className="text-mute">{t("an.k.outstanding")}</span>
                      <span className="text-sm font-medium text-ink" dir="ltr">{jd(d.standing.outstanding.amount)} <span className="text-[9px] text-mute">JD</span></span>
                    </div>
                    <p className="text-[10px] text-mute">{num(d.standing.outstanding.invoices)} {t("an.invoicesOpen")} · {t("an.h.outstanding")}</p>
                    {d.standing.totalPatients !== null && (
                      <div className="flex items-baseline justify-between gap-2 border-t border-edge pt-3">
                        <span className="text-mute">{t("an.k.totalPatients")}</span>
                        <span className="text-sm font-medium text-ink" dir="ltr">{num(d.standing.totalPatients)}</span>
                      </div>
                    )}
                  </div>
                </Panel>
                <Panel title={t("an.p.insights")} hint={t("an.h.insights")}>
                  {ins && Object.values(ins).some(Boolean) ? (
                    <ul className="space-y-2 text-[11px] text-ink" data-testid="an-insights">
                      {ins.peakWeekday && <Ins>{t("an.ins.peakWeekday")}: <b>{t(`an.wd.${ins.peakWeekday.weekday}`)}</b> ({ins.peakWeekday.appointments})</Ins>}
                      {ins.peakHour && <Ins>{t("an.ins.peakHour")}: <b dir="ltr">{String(ins.peakHour.hour).padStart(2, "0")}:00</b> ({ins.peakHour.appointments})</Ins>}
                      {ins.highestVolumeDoctor && <Ins>{t("an.ins.topDoctor")}: <b>{ins.highestVolumeDoctor.name}</b> ({ins.highestVolumeDoctor.completedVisits})</Ins>}
                      {ins.topSource && <Ins>{t("an.ins.topSource")}: <b>{t(`an.src.${ins.topSource.source}`)}</b> ({ins.topSource.appointments})</Ins>}
                      {ins.topTreatment && <Ins>{t("an.ins.topTreatment")}: <b>{procName(p.meta.treatmentKind, ins.topTreatment.code, t, lang)}</b> ({ins.topTreatment.completed})</Ins>}
                      {ins.largestExpenseCategory && <Ins>{t("an.ins.topExpense")}: <b>{t(`ex.cat.${ins.largestExpenseCategory.category}`)}</b> (<span dir="ltr">{jd(ins.largestExpenseCategory.total)} JD</span>)</Ins>}
                    </ul>
                  ) : <Empty compact text={t("an.empty")} />}
                </Panel>
              </div>
            </div>
            <Footnote>{contribution ? t("an.note.contribution") : t("an.note.netCash")}</Footnote>
          </>
        );
      }}
    </Loader>
  );
}

function Ins({ children }: { children: React.ReactNode }) {
  return <li className="flex items-start gap-2"><IconBulb size={13} className="mt-0.5 shrink-0 text-amber-400" /><span>{children}</span></li>;
}
