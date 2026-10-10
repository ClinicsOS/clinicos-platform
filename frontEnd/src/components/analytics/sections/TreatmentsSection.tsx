"use client";
import { useI18n } from "@/lib/i18n";
import { CHART, jd, num, procName } from "@/lib/analytics";
import { Loader, type SectionProps } from "../common";
import { BarList, DataTable, Empty, Footnote, Kpi, KpiGrid, Panel } from "../kit";
import { Donut } from "../charts";

export default function TreatmentsSection(p: SectionProps) {
  const { t, lang } = useI18n();
  const kind = p.meta.treatmentKind;
  return (
    <Loader section="treatments" filters={p.filters} owner={p.owner}>
      {(d) => {
        const k = d.kpis;
        const noData = k.completed.current === 0 && (k.planned?.current ?? 0) === 0 && (k.cancelled?.current ?? 0) === 0;
        return (
          <>
            <KpiGrid cols={3}>
              <Kpi testId="kpi-completed" label={t("an.k.txCompleted")} hint={t("an.h.txCompleted")} c={k.completed} />
              {k.planned && <Kpi testId="kpi-planned" label={t("an.k.txPlanned")} hint={t("an.h.txPlanned")} c={k.planned} good="neutral" />}
              {k.started && <Kpi testId="kpi-started" label={t("an.k.txStarted")} c={k.started} good="neutral" />}
              {k.cancelled && <Kpi testId="kpi-cancelled" label={t("an.k.txCancelled")} c={k.cancelled} good="down" />}
              {k.completionRate && <Kpi testId="kpi-tx-rate" label={t("an.k.txCompletionRate")} hint={t("an.h.txCompletionRate")} c={k.completionRate} fmt="pct" />}
              <Kpi testId="kpi-tx-value" label={t("an.k.txValue")} hint={t("an.h.txValue")} c={k.estimatedValue} fmt="jd" unit="JD" good="neutral" />
            </KpiGrid>
            {noData ? <Panel><Empty text={t("an.empty.treatments")} /></Panel> : (
              <>
                <div className="mb-4 grid gap-3 lg:grid-cols-3">
                  <Panel className="lg:col-span-2" title={t("an.p.byProcedure")} hint={t("an.h.byProcedure")}>
                    <BarList rows={d.byProcedure.map((r: any) => ({ key: r.code, label: procName(kind, r.code, t, lang), sub: r.estimatedValue ? `${jd(r.estimatedValue)} JD` : undefined, value: r.count }))} empty={t("an.empty.treatments")} />
                  </Panel>
                  <Panel title={t("an.p.invoicing")} hint={t("an.h.invoicing")}>
                    {d.invoicing.invoiced + d.invoicing.notInvoiced > 0 ? (
                      <Donut testId="an-invoicing" centerLabel={t("an.k.txCompleted")} slices={[
                        { key: "inv", label: t("an.tx.invoiced"), value: d.invoicing.invoiced, color: CHART.teal },
                        { key: "not", label: t("an.tx.notInvoiced"), value: d.invoicing.notInvoiced, color: CHART.amber },
                      ]} />
                    ) : <Empty compact />}
                  </Panel>
                </div>
                {d.dental && (
                  <Panel className="mb-4" title={t("an.p.dental")} hint={t("an.h.dental")} testId="an-dental">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div><div className="text-[10px] uppercase tracking-wide text-mute">{t("an.dental.crown")}</div><div className="text-xl font-medium text-ink" dir="ltr" data-testid="dental-crown">{num(d.dental.crown)}</div></div>
                      <div><div className="text-[10px] uppercase tracking-wide text-mute">{t("an.dental.filling")}</div><div className="text-xl font-medium text-ink" dir="ltr" data-testid="dental-filling">{num(d.dental.filling)}</div></div>
                      <div>
                        <div className="mb-1 text-[10px] uppercase tracking-wide text-mute">{t("an.dental.topTeeth")}</div>
                        {d.dental.topTeeth.length ? <div className="flex flex-wrap gap-1.5">{d.dental.topTeeth.map((x: any) => <span key={x.tooth} className="pill bg-soft text-ink" dir="ltr">#{x.tooth} · {x.count}</span>)}</div> : <span className="text-[11px] text-mute">—</span>}
                      </div>
                    </div>
                  </Panel>
                )}
                <Panel title={d.scope.clinicWide ? t("an.p.txByDoctor") : t("an.p.mine")} hint={t("an.h.txByDoctor")}>
                  <DataTable testId="an-tx-doctors" rowKey={(r: any) => r.doctorId ?? "unassigned"} initialSort={{ key: "count", dir: "desc" }} rows={d.byDoctor}
                    cols={[
                      { key: "name", label: t("an.col.doctor"), value: (r: any) => (r.unassigned ? t("an.unassigned") : r.name), render: (r: any) => (r.unassigned ? <i className="text-mute">{t("an.unassigned")}</i> : r.name) },
                      { key: "count", label: t("an.k.txCompleted"), align: "end", render: (r: any) => num(r.count) },
                      { key: "estimatedValue", label: t("an.k.txValue"), align: "end", render: (r: any) => jd(r.estimatedValue) },
                    ]} />
                </Panel>
              </>
            )}
            <Footnote>{t("an.note.treatments")}</Footnote>
          </>
        );
      }}
    </Loader>
  );
}
