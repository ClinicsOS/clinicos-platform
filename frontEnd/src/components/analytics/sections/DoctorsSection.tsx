"use client";
import { useI18n } from "@/lib/i18n";
import { jd, num } from "@/lib/analytics";
import { ratePctText } from "../format";
import { Loader, type SectionProps } from "../common";
import { DataTable, Empty, Footnote, Kpi, KpiGrid, Panel } from "../kit";

/** Doctor performance / comparison. Operational + financial facts only: no score, no ranking by quality. */
export default function DoctorsSection(p: SectionProps) {
  const { t } = useI18n();
  const kind = p.meta.treatmentKind;
  return (
    <Loader section="doctors" filters={p.filters} owner={p.owner}>
      {(d) => {
        const comparing = d.comparison_enabled as boolean;
        const rows = d.rows as any[];
        return (
          <>
            {comparing && d.clinic && (
              <>
                <KpiGrid cols={4}>
                  <Kpi testId="kpi-clinic-collected" label={t("an.k.collected")} hint={t("an.h.collected")} value={d.clinic.collected} fmt="jd" unit="JD" tone="teal" />
                  <Kpi testId="kpi-clinic-expenses" label={t("an.k.expenses")} hint={t("an.h.expenses")} value={d.clinic.businessExpenses} fmt="jd" unit="JD" tone="amber"
                    sub={<span className="text-[9px] text-mute">{t("an.shared")} {jd(d.clinic.sharedClinicExpenses)} · {t("an.attributed")} {jd(d.clinic.doctorAttributedExpenses)}</span>} />
                  <Kpi testId="kpi-clinic-net" label={t("an.k.netCash")} hint={t("an.h.netCash")} value={d.clinic.netCash} fmt="jd" unit="JD" tone="sky" />
                  <Kpi testId="kpi-unassigned" label={t("an.unassigned")} hint={t("an.h.unassigned")} value={d.unassignedRevenue} fmt="jd" unit="JD" />
                </KpiGrid>
              </>
            )}
            <Panel title={comparing ? t("an.p.doctorCompare") : t("an.p.mine")} hint={t("an.h.doctorTable")}>
              {rows.length === 0 ? <Empty compact text={t("an.empty.doctors")} /> : (
                <DataTable testId="an-doctors" rowKey={(r: any) => r.doctorId} initialSort={{ key: "collected", dir: "desc" }} rows={rows}
                  cols={[
                    { key: "name", label: t("an.col.doctor"), render: (r: any) => <span>{r.name}{!r.active && <span className="ms-1.5 text-[9px] text-mute">({t("an.inactive")})</span>}</span> },
                    { key: "appointments", label: t("an.k.appointments"), align: "end", render: (r: any) => num(r.appointments) },
                    { key: "completedVisits", label: t("an.k.completed"), align: "end", render: (r: any) => num(r.completedVisits) },
                    { key: "walkIns", label: t("an.k.walkIns"), align: "end", render: (r: any) => num(r.walkIns) },
                    { key: "cancellationRate", label: t("an.k.cancellationRate"), align: "end", render: (r: any) => ratePctText(r.cancellationRate) },
                    { key: "noShowRate", label: t("an.k.noShowRate"), align: "end", render: (r: any) => ratePctText(r.noShowRate) },
                    { key: "patientsSeen", label: t("an.k.patientsSeen"), align: "end", render: (r: any) => num(r.patientsSeen) },
                    ...(kind ? [{ key: "treatmentsCompleted", label: t("an.k.txCompleted"), align: "end" as const, render: (r: any) => num(r.treatmentsCompleted) }] : []),
                    { key: "collected", label: t("an.k.collected"), align: "end", render: (r: any) => jd(r.collected) },
                    { key: "attributedExpenses", label: t("an.col.attributedExpenses"), hint: t("an.h.attributedExpenses"), align: "end", render: (r: any) => jd(r.attributedExpenses) },
                    { key: "netContribution", label: t("an.k.netContribution"), hint: t("an.h.netContribution"), align: "end", render: (r: any) => <b className={r.netContribution < 0 ? "text-amber-400" : "text-ink"}>{jd(r.netContribution)}</b> },
                    { key: "avgCollectedPerVisit", label: t("an.col.avgPerVisit"), hint: t("an.h.avgPerVisit"), align: "end", render: (r: any) => (r.avgCollectedPerVisit === null ? "—" : jd(r.avgCollectedPerVisit)) },
                  ]} />
              )}
            </Panel>
            <Footnote>{comparing ? t("an.note.doctors") : t("an.note.doctorsSelf")}</Footnote>
          </>
        );
      }}
    </Loader>
  );
}
