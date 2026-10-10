"use client";
import { useI18n } from "@/lib/i18n";
import { CHART, hasSignal, jd } from "@/lib/analytics";
import { Loader, type SectionProps } from "../common";
import { BarList, DataTable, Empty, Footnote, Kpi, KpiGrid, Panel } from "../kit";
import { Legend, TrendChart } from "../charts";

export default function ExpensesSection(p: SectionProps) {
  const { t } = useI18n();
  return (
    <Loader section="expenses" filters={p.filters} owner={p.owner}>
      {(d) => {
        const k = d.kpis;
        const ser = [
          { key: "clinic", label: t("an.shared"), color: CHART.teal, kind: "bar" as const },
          { key: "doctor", label: t("an.attributed"), color: CHART.sky, kind: "bar" as const },
        ];
        return (
          <>
            <KpiGrid cols={k.clinic ? 4 : 2}>
              <Kpi testId="kpi-exp-total" label={t("an.k.expenses")} hint={t("an.h.expenses")} c={k.total} fmt="jd" unit="JD" good="down" tone="amber" />
              {k.clinic && <Kpi testId="kpi-exp-shared" label={t("an.shared")} hint={t("an.h.shared")} c={k.clinic} fmt="jd" unit="JD" good="down" />}
              <Kpi testId="kpi-exp-doctor" label={t("an.attributed")} hint={t("an.h.attributed")} c={k.doctor} fmt="jd" unit="JD" good="down" />
              {d.pending !== undefined && <Kpi testId="kpi-exp-pending" label={t("an.k.pending")} hint={t("an.h.pending")} value={d.pending} fmt="jd" unit="JD" good="neutral" />}
            </KpiGrid>
            <div className="mb-4 grid gap-3 lg:grid-cols-3">
              <Panel className="lg:col-span-2" title={t("an.p.expTrend")} hint={t("an.h.trend")}>
                {hasSignal(d.trend.points, ["clinic", "doctor"]) ? <><Legend series={ser} /><TrendChart points={d.trend.points} series={ser} granularity={d.trend.granularity} money /></> : <Empty text={t("an.empty.expenses")} />}
              </Panel>
              <Panel title={t("an.p.expByCategory")} hint={t("an.h.expByCategory")}>
                {d.byCategory.length ? (
                  <>
                    <BarList color="bg-amber-400" fmt="jd" rows={d.byCategory.map((c: any) => ({ key: c.category, label: t(`ex.cat.${c.category}`), value: c.total, onClick: () => p.openLedger({ from: d.range.from, to: d.range.to }, { category: c.category }) }))} />
                    <p className="mt-3 text-[9px] text-mute">{t("an.drill")}</p>
                  </>
                ) : <Empty compact text={t("an.empty.expenses")} />}
              </Panel>
            </div>
            {d.byDoctor.length > 0 && (
              <Panel className="mb-4" title={d.scope.clinicWide ? t("an.p.expByDoctor") : t("an.p.mine")} hint={t("an.h.attributed")}>
                <DataTable rowKey={(r: any) => r.doctorId} initialSort={{ key: "total", dir: "desc" }} rows={d.byDoctor}
                  cols={[{ key: "name", label: t("an.col.doctor") }, { key: "total", label: t("an.attributed"), align: "end", render: (r: any) => jd(r.total) }]} />
              </Panel>
            )}
            {d.personal !== null && d.personal !== undefined && (
              <div className="mb-3 rounded-lg border border-edge bg-card2 px-3 py-2 text-[11px] text-mute" data-testid="an-personal">
                {t("an.personal")}: <b className="text-ink" dir="ltr">{jd(d.personal)} JD</b> — {t("an.personalNote")}
              </div>
            )}
            {d.largestCategory && <p className="mb-1 text-[11px] text-mute">{t("an.ins.topExpense")}: <b className="text-ink">{t(`ex.cat.${d.largestCategory.category}`)}</b> (<span dir="ltr">{jd(d.largestCategory.total)} JD</span>)</p>}
            <Footnote>{t("an.note.expenses")}</Footnote>
          </>
        );
      }}
    </Loader>
  );
}
