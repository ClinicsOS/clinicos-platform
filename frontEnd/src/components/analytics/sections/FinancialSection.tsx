"use client";
import { useI18n } from "@/lib/i18n";
import { CHART, jd, num } from "@/lib/analytics";
import { hasSignal } from "@/lib/analytics";
import { Loader, type SectionProps } from "../common";
import { BarList, DataTable, Empty, Footnote, Kpi, KpiGrid, Panel } from "../kit";
import { Donut, Legend, TrendChart } from "../charts";
import { procName } from "@/lib/analytics";

const METHOD_COLORS: Record<string, string> = { cash: CHART.teal, cliq: CHART.blue, card: CHART.violet, other: CHART.grey };

export default function FinancialSection(p: SectionProps) {
  const { t, lang } = useI18n();
  return (
    <Loader section="financial" filters={p.filters} owner={p.owner}>
      {(d) => {
        const contribution = d.netKind === "doctor_contribution";
        const netLabel = contribution ? t("an.k.netContribution") : t("an.k.netCash");
        const ser = [
          { key: "collected", label: t("an.k.collected"), color: CHART.teal, kind: "bar" as const },
          { key: "invoiced", label: t("an.k.invoiced"), color: CHART.sky, kind: "line" as const },
          { key: "expenses", label: t("an.k.expenses"), color: CHART.amber, kind: "bar" as const },
          { key: "net", label: netLabel, color: CHART.blue, kind: "line" as const },
        ];
        const ps = d.paymentStatus;
        return (
          <>
            <KpiGrid>
              <Kpi testId="kpi-collected" label={t("an.k.collected")} hint={t("an.h.collected")} c={d.kpis.collected} fmt="jd" unit="JD" tone="teal" />
              <Kpi testId="kpi-invoiced" label={t("an.k.invoiced")} hint={t("an.h.invoiced")} c={d.kpis.invoiced} fmt="jd" unit="JD" good="neutral" />
              <Kpi testId="kpi-expenses" label={t("an.k.expenses")} hint={contribution ? t("an.h.expensesDoctor") : t("an.h.expenses")} c={d.kpis.expenses} fmt="jd" unit="JD" good="down" />
              <Kpi testId="kpi-net" label={netLabel} hint={contribution ? t("an.h.netContribution") : t("an.h.netCash")} c={d.kpis.netCash} fmt="jd" unit="JD" tone="sky" />
            </KpiGrid>

            <div className="mb-4 grid gap-3 lg:grid-cols-3">
              <Panel className="lg:col-span-2" title={t("an.p.trend")} hint={t("an.h.trend")}>
                {hasSignal(d.trend.points, ["collected", "invoiced", "expenses"]) ? (
                  <><Legend series={ser} /><TrendChart points={d.trend.points} series={ser} granularity={d.trend.granularity} money testId="an-fin-trend" /></>
                ) : <Empty text={t("an.empty.money")} />}
              </Panel>
              <Panel title={t("an.p.outstanding")} hint={t("an.h.outstanding")} testId="an-outstanding">
                <div className="text-2xl font-medium text-ink" dir="ltr" data-testid="outstanding-value">{jd(d.outstanding.amount)} <span className="text-xs text-mute">JD</span></div>
                <p className="mt-1 text-[11px] text-mute">{num(d.outstanding.invoices)} {t("an.invoicesOpen")}</p>
                <div className="mt-4 space-y-2 border-t border-edge pt-3 text-[11px]">
                  <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-mute">{t("an.p.paymentStatus")}</div>
                  {([["paid", "an.ps.paid", "bg-teal"], ["partially_paid", "an.ps.partial", "bg-amber-400"], ["unpaid", "an.ps.unpaid", "bg-red-500"]] as const).map(([k, label, dot]) => (
                    <div key={k} className="flex items-center justify-between gap-2" data-testid={`ps-${k}`}>
                      <span className="flex items-center gap-1.5 text-mute"><span className={`inline-block h-2 w-2 rounded-full ${dot}`} />{t(label)}</span>
                      <span className="text-ink" dir="ltr">{num(ps[k].invoices)} · {jd(ps[k].billed)}</span>
                    </div>
                  ))}
                  <p className="pt-1 text-[9px] text-mute">{t("an.h.paymentStatus")}</p>
                </div>
              </Panel>
            </div>

            <div className="mb-4 grid gap-3 lg:grid-cols-2">
              <Panel title={t("an.p.byMethod")} hint={t("an.h.byMethod")}>
                {d.collectedByMethod.length ? (
                  <Donut testId="an-methods" fmt={jd} centerLabel="JD" slices={d.collectedByMethod.map((m: any) => ({ key: m.method, label: t(`an.method.${m.method}`), value: m.amount, color: METHOD_COLORS[m.method] ?? CHART.grey }))} />
                ) : <Empty compact text={t("an.empty.money")} />}
              </Panel>
              <Panel title={d.scope.clinicWide ? t("an.p.revByDoctor") : t("an.p.revMine")} hint={t("an.h.revByDoctor")}>
                {d.revenueByDoctor.length ? (
                  <BarList fmt="jd" rows={d.revenueByDoctor.map((r: any) => ({ key: r.doctorId ?? "unassigned", label: r.unassigned ? t("an.unassigned") : r.name, value: r.collected }))} />
                ) : <Empty compact text={t("an.empty.money")} />}
                {d.revenueByDoctor.some((r: any) => r.unassigned && r.collected > 0) && <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-300">{t("an.unassignedNote")}</p>}
              </Panel>
            </div>

            <div className="mb-4 grid gap-3 lg:grid-cols-2">
              <Panel title={t("an.p.billedByService")} hint={t("an.h.billedByService")}>
                {d.billedByService.byTreatment.length || d.billedByService.manual.amount > 0 ? (
                  <BarList fmt="jd" rows={[
                    ...d.billedByService.byTreatment.map((r: any) => ({ key: r.code, label: procName(p.meta.treatmentKind, r.code, t, lang), sub: `×${r.treatments}`, value: r.amount })),
                    ...(d.billedByService.manual.amount > 0 ? [{ key: "manual", label: t("an.manualLines"), sub: `×${d.billedByService.manual.lines}`, value: d.billedByService.manual.amount }] : []),
                  ]} />
                ) : <Empty compact text={t("an.empty.money")} />}
              </Panel>
              <Panel title={t("an.p.expByCategory")} hint={t("an.h.expByCategory")}>
                {d.expenses.byCategory.length ? (
                  <BarList color="bg-amber-400" fmt="jd" rows={d.expenses.byCategory.map((c: any) => ({
                    key: c.category, label: t(`ex.cat.${c.category}`), value: c.total,
                    onClick: () => p.openLedger({ from: d.range.from, to: d.range.to }, { category: c.category }),
                  }))} />
                ) : <Empty compact text={t("an.empty.expenses")} />}
                {d.expenses.byCategory.length > 0 && <p className="mt-3 text-[9px] text-mute">{t("an.drill")}</p>}
              </Panel>
            </div>

            <Panel title={t("an.p.doctorRows")} className={d.scope.clinicWide ? "" : "hidden"}>
              <DataTable testId="an-fin-doctors" rowKey={(r: any) => r.doctorId ?? "unassigned"} initialSort={{ key: "collected", dir: "desc" }} rows={d.revenueByDoctor}
                cols={[
                  { key: "name", label: t("an.col.doctor"), value: (r: any) => (r.unassigned ? t("an.unassigned") : r.name), render: (r: any) => (r.unassigned ? <i className="text-mute">{t("an.unassigned")}</i> : r.name) },
                  { key: "collected", label: t("an.k.collected"), align: "end", render: (r: any) => jd(r.collected) },
                ]} />
            </Panel>
            <Footnote>{contribution ? t("an.note.contribution") : t("an.note.netCash")}</Footnote>
          </>
        );
      }}
    </Loader>
  );
}
