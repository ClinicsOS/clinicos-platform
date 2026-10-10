"use client";
import { useI18n } from "@/lib/i18n";
import { CHART, hasSignal, num, pct } from "@/lib/analytics";
import { Loader, type SectionProps } from "../common";
import { DataTable, Empty, Footnote, Kpi, KpiGrid, Panel } from "../kit";
import { CategoryBars, Donut, Legend, TrendChart } from "../charts";

const STATUS_COLORS: Record<string, string> = { completed: CHART.teal, confirmed: CHART.blue, scheduled: CHART.sky, cancelled: CHART.red, no_show: CHART.amber };
const SOURCE_COLORS: Record<string, string> = { dashboard: CHART.blue, public: CHART.violet, walk_in: CHART.teal };
const WD = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export default function AppointmentsSection(p: SectionProps) {
  const { t } = useI18n();
  return (
    <Loader section="appointments" filters={p.filters} owner={p.owner}>
      {(d) => {
        const k = d.kpis, w = d.walkIn;
        const ser = [
          { key: "total", label: t("an.k.appointments"), color: CHART.blue, kind: "area" as const },
          { key: "completed", label: t("an.k.completed"), color: CHART.teal, kind: "line" as const },
          { key: "walkIn", label: t("an.k.walkIns"), color: CHART.violet, kind: "line" as const },
        ];
        const none = k.total.current === 0;
        return (
          <>
            <KpiGrid cols={5}>
              <Kpi testId="kpi-total" label={t("an.k.appointments")} hint={t("an.h.appointments")} c={k.total} good="neutral" />
              <Kpi testId="kpi-completed" label={t("an.k.completed")} c={k.completed} />
              <Kpi testId="kpi-cancelled" label={t("an.k.cancelled")} c={k.cancelled} good="down" />
              <Kpi testId="kpi-noshow" label={t("an.k.noShow")} c={k.noShow} good="down" />
              <Kpi testId="kpi-open" label={t("an.k.open")} hint={t("an.h.open")} c={k.open} good="neutral" />
            </KpiGrid>
            <KpiGrid cols={3}>
              <Kpi testId="kpi-completion" label={t("an.k.completionRate")} hint={t("an.h.rate")} c={k.completionRate} fmt="pct" />
              <Kpi testId="kpi-cancel-rate" label={t("an.k.cancellationRate")} hint={t("an.h.rate")} c={k.cancellationRate} fmt="pct" good="down" />
              <Kpi testId="kpi-noshow-rate" label={t("an.k.noShowRate")} hint={t("an.h.rate")} c={k.noShowRate} fmt="pct" good="down" />
            </KpiGrid>

            {none ? <Panel><Empty text={t("an.empty.appointments")} /></Panel> : (
              <>
                <div className="mb-4 grid gap-3 lg:grid-cols-3">
                  <Panel className="lg:col-span-2" title={t("an.p.apptTrend")} hint={t("an.h.apptTrend")}>
                    <Legend series={ser} />
                    <TrendChart points={d.trend.points} series={ser} granularity={d.trend.granularity} />
                  </Panel>
                  <div className="grid content-start gap-3">
                    <Panel title={t("an.p.byStatus")}>
                      <Donut testId="an-status" centerLabel={t("an.k.appointments")} slices={["completed", "confirmed", "scheduled", "cancelled", "no_show"].map((s) => ({ key: s, label: t(`status.${s}`), value: d.byStatus[s] ?? 0, color: STATUS_COLORS[s] }))} />
                    </Panel>
                    <Panel title={t("an.p.bySource")} hint={t("an.h.source")}>
                      <Donut testId="an-source" centerLabel={t("an.k.appointments")} slices={["dashboard", "public", "walk_in"].map((s) => ({ key: s, label: t(`an.src.${s}`), value: d.bySource[s] ?? 0, color: SOURCE_COLORS[s] }))} />
                    </Panel>
                  </div>
                </div>

                <div className="mb-4 grid gap-3 lg:grid-cols-2">
                  <Panel title={t("an.p.byWeekday")} hint={t("an.h.peak")} right={d.peaks.weekday ? <span className="text-[10px] text-mute">{t("an.peak")}: <b className="text-ink">{t(`an.wd.${d.peaks.weekday.weekday}`)}</b></span> : null}>
                    {hasSignal(d.byWeekday, ["appointments"]) ? (
                      <CategoryBars testId="an-weekday" data={d.byWeekday.map((r: any) => ({ ...r, label: t(`an.wds.${r.weekday}`) }))} xKey="label" yKey="appointments" name={t("an.k.appointments")} />
                    ) : <Empty compact />}
                  </Panel>
                  <Panel title={t("an.p.byHour")} hint={t("an.h.peak")} right={d.peaks.hour ? <span className="text-[10px] text-mute">{t("an.peak")}: <b className="text-ink" dir="ltr">{String(d.peaks.hour.hour).padStart(2, "0")}:00</b></span> : null}>
                    {hasSignal(d.byHour, ["appointments"]) ? (
                      <CategoryBars testId="an-hour" data={d.byHour} xKey="hour" yKey="appointments" name={t("an.k.appointments")} color={CHART.sky} xFormatter={(h) => `${String(h).padStart(2, "0")}`} />
                    ) : <Empty compact />}
                  </Panel>
                </div>
              </>
            )}

            <Panel className="mb-4" title={t("an.p.walkIn")} hint={t("an.h.walkIn")} testId="an-walkin">
              <KpiGrid cols={4}>
                <Kpi testId="kpi-wi-total" label={t("an.k.walkIns")} c={w.kpis.total} good="neutral" />
                <Kpi testId="kpi-wi-completed" label={t("an.k.completed")} c={w.kpis.completed} />
                <Kpi testId="kpi-wi-share" label={t("an.k.walkInShare")} hint={t("an.h.walkInShare")} c={w.kpis.share} fmt="pct" good="neutral" />
                <Kpi testId="kpi-wi-completion" label={t("an.k.walkInCompletion")} c={w.kpis.completionRate} fmt="pct" />
              </KpiGrid>
              {w.kpis.total.current > 0 ? (
                <CategoryBars data={w.byHour} xKey="hour" yKey="walkIns" name={t("an.k.walkIns")} color={CHART.violet} height={150} xFormatter={(h) => `${String(h).padStart(2, "0")}`} />
              ) : <Empty compact text={t("an.empty.walkIn")} />}
            </Panel>

            {d.byDoctor.length > 0 && (
              <Panel title={d.scope.clinicWide ? t("an.p.byDoctor") : t("an.p.mine")}>
                <DataTable testId="an-appt-doctors" rowKey={(r: any) => r.doctorId} initialSort={{ key: "total", dir: "desc" }} rows={d.byDoctor}
                  cols={[
                    { key: "name", label: t("an.col.doctor") },
                    { key: "total", label: t("an.k.appointments"), align: "end", render: (r: any) => num(r.total) },
                    { key: "completed", label: t("an.k.completed"), align: "end", render: (r: any) => num(r.completed) },
                    { key: "cancelled", label: t("an.k.cancelled"), align: "end", render: (r: any) => num(r.cancelled) },
                    { key: "noShow", label: t("an.k.noShow"), align: "end", render: (r: any) => num(r.noShow) },
                    { key: "walkIn", label: t("an.k.walkIns"), align: "end", render: (r: any) => num(r.walkIn) },
                    { key: "completionPct", label: t("an.k.completionRate"), align: "end", value: (r: any) => (r.total > 0 ? r.completed / r.total : null), render: (r: any) => (r.total > 0 ? pct(Math.round((r.completed / r.total) * 1000) / 10) : "—") },
                  ]} />
              </Panel>
            )}
            <Footnote>{t("an.note.appointments")}</Footnote>
          </>
        );
      }}
    </Loader>
  );
}
