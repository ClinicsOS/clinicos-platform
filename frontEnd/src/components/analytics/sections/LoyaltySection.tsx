"use client";
import { useI18n } from "@/lib/i18n";
import { CHART, hasSignal, num, pct } from "@/lib/analytics";
import { Loader, type SectionProps } from "../common";
import { DataTable, Empty, Footnote, Kpi, KpiGrid, Panel } from "../kit";
import { Donut, Legend, TrendChart } from "../charts";

/** Loyalty programme activity — counted from stored Loyalty records. There is deliberately NO revenue / ROI figure here. */
export default function LoyaltySection(p: SectionProps) {
  const { t } = useI18n();
  return (
    <Loader section="loyalty" filters={p.filters} owner={p.owner}>
      {(d) => {
        const pt = d.points, ck = d.checkIns, rd = d.redemptions;
        const ser = [
          { key: "pointsIssued", label: t("an.l.issued"), color: CHART.teal, kind: "area" as const },
          { key: "checkIns", label: t("an.l.checkIns"), color: CHART.blue, kind: "line" as const },
          { key: "newMembers", label: t("an.l.newMembers"), color: CHART.violet, kind: "line" as const },
        ];
        return (
          <>
            <KpiGrid cols={4}>
              <Kpi testId="kpi-l-enrolled" label={t("an.l.enrolled")} hint={t("an.h.l.enrolled")} value={d.enrolled} good="neutral" />
              <Kpi testId="kpi-l-active" label={t("an.l.active")} value={d.activeMembers} />
              <Kpi testId="kpi-l-new" label={t("an.l.newMembers")} value={d.newMembers} />
              <Kpi testId="kpi-l-outstanding" label={t("an.l.outstandingPoints")} hint={t("an.h.l.outstanding")} value={pt.outstanding} />
            </KpiGrid>
            <KpiGrid cols={4}>
              <Kpi testId="kpi-l-issued" label={t("an.l.issued")} hint={t("an.h.l.issued")} value={pt.issued} />
              <Kpi testId="kpi-l-redeemed" label={t("an.l.redeemed")} value={pt.redeemed} />
              <Kpi testId="kpi-l-checkins" label={t("an.l.checkIns")} value={ck.confirmed} sub={ck.confirmedShareOfResolved !== null ? <span className="text-[9px] text-mute">{pct(ck.confirmedShareOfResolved)} {t("an.l.confirmedShare")}</span> : null} />
              <Kpi testId="kpi-l-redemptions" label={t("an.l.redemptions")} value={rd.requested} sub={<span className="text-[9px] text-mute">{num(rd.confirmed)} {t("an.l.confirmed")}</span>} />
            </KpiGrid>
            <div className="mb-4 grid gap-3 lg:grid-cols-3">
              <Panel className="lg:col-span-2" title={t("an.p.loyaltyTrend")}>
                {hasSignal(d.trend.points, ["pointsIssued", "checkIns", "newMembers"]) ? <><Legend series={ser} /><TrendChart points={d.trend.points} series={ser} granularity={d.trend.granularity} /></> : <Empty text={t("an.empty.loyalty")} />}
              </Panel>
              <Panel title={t("an.p.tiers")}>
                {d.tiers.some((x: any) => x.members > 0) ? <Donut centerLabel={t("an.l.enrolled")} slices={d.tiers.map((x: any, i: number) => ({ key: x.tier, label: String(x.tier), value: x.members, color: [CHART.teal, CHART.blue, CHART.violet, CHART.amber, CHART.sky][i % 5] }))} /> : <Empty compact />}
              </Panel>
            </div>
            <Panel title={t("an.p.topRewards")}>
              <DataTable rowKey={(r: any) => r.name} initialSort={{ key: "confirmed", dir: "desc" }} rows={d.topRewards}
                cols={[
                  { key: "name", label: t("an.l.reward") },
                  { key: "requested", label: t("an.l.requested"), align: "end", render: (r: any) => num(r.requested) },
                  { key: "confirmed", label: t("an.l.confirmed"), align: "end", render: (r: any) => num(r.confirmed) },
                  { key: "pointsRedeemed", label: t("an.l.pointsRedeemed"), align: "end", render: (r: any) => num(r.pointsRedeemed) },
                ]} empty={t("an.empty.loyalty")} />
            </Panel>
            <Footnote>{t("an.note.loyalty")}</Footnote>
          </>
        );
      }}
    </Loader>
  );
}
