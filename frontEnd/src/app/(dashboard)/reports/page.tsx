"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  IconChevronLeft,
  IconChevronRight,
  IconTrendingUp,
  IconUsers,
  IconCalendarStats,
  IconCash,
  IconLock,
  IconArrowRight,
  IconDownload,
  IconFileTypeXls,
  IconFileTypePdf,
} from "@tabler/icons-react";

interface MonthlyReport {
  year: number;
  month: number;
  revenue: number;
  totalAppointments: number;
  byStatus: Record<string, number>;
  newPatients: number;
  topDoctors: { id: string; name: string; count: number }[];
  daily: { date: string; revenue: number; appointments: number }[];
}

export default function ReportsPage() {
  const { t, lang } = useI18n();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);

  const shiftMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMonth(m);
    setYear(y);
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["monthly-report", year, month],
    queryFn: async () =>
      (await api.get<MonthlyReport>(`/reports/monthly?year=${year}&month=${month}`)).data,
    retry: false,
  });

  // If plan is not Pro, backend returns 402 — show the upgrade prompt
  if (axios.isAxiosError(error) && error.response?.status === 402) {
    return <ReportsLockedScreen />;
  }

  const monthName = new Date(year, month - 1, 1).toLocaleDateString(lang === "ar" ? "ar" : undefined, {
    month: "long",
    year: "numeric",
  });

  const maxDaily = Math.max(1, ...(data?.daily.map((d) => d.revenue) ?? []));

  const exportCSV = () => {
    if (!data) return;
    const rows = [
      ["Date", "Revenue (JD)", "Appointments"],
      ...data.daily.map((d) => [d.date, d.revenue, d.appointments]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    // Add BOM so Excel opens Arabic characters correctly
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clinicos-report-${year}-${String(month).padStart(2, "0")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    // Uses the browser's native print → save as PDF
    window.print();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-medium text-ink">{t("reports.title")}</h1>
        <div className="ms-auto flex items-center gap-1.5">
          <button
            onClick={() => shiftMonth(-1)}
            className="rounded-lg border border-edge bg-card p-1.5 text-mute hover:text-ink"
          >
            <IconChevronLeft size={14} className="rtl-flip" />
          </button>
          <div className="min-w-32 text-center text-xs font-medium text-ink">{monthName}</div>
          <button
            onClick={() => shiftMonth(1)}
            className="rounded-lg border border-edge bg-card p-1.5 text-mute hover:text-ink"
          >
            <IconChevronRight size={14} className="rtl-flip" />
          </button>
          <button
            onClick={exportCSV}
            disabled={!data}
            className="ms-3 flex items-center gap-1.5 rounded-lg border border-edge bg-card px-2.5 py-1.5 text-[11px] text-ink hover:bg-soft disabled:opacity-50"
          >
            <IconFileTypeXls size={13} className="text-teal" />
            {t("reports.exportExcel")}
          </button>
          <button
            onClick={exportPDF}
            disabled={!data}
            className="flex items-center gap-1.5 rounded-lg border border-edge bg-card px-2.5 py-1.5 text-[11px] text-ink hover:bg-soft disabled:opacity-50"
          >
            <IconFileTypePdf size={13} className="text-blue" />
            {t("reports.exportPdf")}
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="card flex items-center justify-center py-16 text-sm text-mute">
          {t("common.loading")}
        </div>
      )}

      {data && (
        <>
          {/* KPI cards */}
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiCard
              icon={<IconCash size={18} className="text-teal" />}
              label={t("reports.revenue")}
              value={`${data.revenue} JD`}
              accent="teal"
            />
            <KpiCard
              icon={<IconCalendarStats size={18} className="text-blue" />}
              label={t("reports.appointments")}
              value={String(data.totalAppointments)}
              accent="blue"
            />
            <KpiCard
              icon={<IconUsers size={18} className="text-sky" />}
              label={t("reports.newPatients")}
              value={String(data.newPatients)}
              accent="sky"
            />
            <KpiCard
              icon={<IconTrendingUp size={18} className="text-amber-400" />}
              label={t("reports.avgDaily")}
              value={`${Math.round(data.revenue / 30)} JD`}
              accent="amber"
            />
          </div>

          <div className="mb-4 grid gap-3 lg:grid-cols-3">
            {/* Chart */}
            <div className="card p-4 lg:col-span-2">
              <div className="mb-3 text-xs font-medium text-ink">{t("reports.dailyRevenue")}</div>
              <div className="flex h-40 items-end gap-0.5" dir="ltr">
                {data.daily.map((d) => {
                  const pct = maxDaily > 0 ? (d.revenue / maxDaily) * 100 : 0;
                  const day = new Date(d.date + "T00:00:00").getDate();
                  return (
                    <div key={d.date} className="group flex flex-1 flex-col items-center justify-end" title={`${d.date}: ${d.revenue} JD`}>
                      <div
                        className="w-full min-h-[1px] rounded-t bg-teal transition-all group-hover:bg-blue"
                        style={{ height: `${pct}%` }}
                      />
                      {day % 5 === 0 && (
                        <div className="mt-1 text-[8px] text-mute">{day}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Status breakdown */}
            <div className="card p-4">
              <div className="mb-3 text-xs font-medium text-ink">{t("reports.byStatus")}</div>
              {["completed", "confirmed", "scheduled", "cancelled", "no_show"].map((s) => {
                const count = data.byStatus[s] || 0;
                const pct = data.totalAppointments > 0 ? (count / data.totalAppointments) * 100 : 0;
                return (
                  <div key={s} className="mb-2 last:mb-0">
                    <div className="mb-0.5 flex justify-between text-[10px] text-mute">
                      <span>{t(`status.${s}`)}</span>
                      <span className="text-ink">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-soft">
                      <div
                        className={`h-full ${
                          s === "completed"
                            ? "bg-teal"
                            : s === "confirmed"
                            ? "bg-blue"
                            : s === "cancelled"
                            ? "bg-red-500"
                            : "bg-amber-500"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Top doctors */}
          <div className="card p-4">
            <div className="mb-3 text-xs font-medium text-ink">{t("reports.topDoctors")}</div>
            {data.topDoctors.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-mute">{t("reports.noDoctors")}</p>
            ) : (
              data.topDoctors.map((d, i) => (
                <div
                  key={d.id}
                  className="flex items-center gap-3 border-b border-edge py-2 last:border-0"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-soft text-[10px] font-medium text-blue">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">
                    {d.name}
                  </span>
                  <span className="text-[10px] text-mute">
                    {d.count} {t("reports.apptsShort")}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: "teal" | "blue" | "sky" | "amber";
}) {
  return (
    <div className="card p-4">
      <div className="mb-1.5 flex items-center gap-2">
        {icon}
        <span className="text-[9px] tracking-widest text-mute">{label}</span>
      </div>
      <div className="text-lg font-medium text-ink">{value}</div>
    </div>
  );
}

function ReportsLockedScreen() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-md pt-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
        <IconLock size={26} />
      </div>
      <h1 className="text-lg font-medium text-ink">{t("reports.lockedTitle")}</h1>
      <p className="mx-auto mt-2 max-w-sm text-xs text-mute">{t("reports.lockedSub")}</p>
      <Link
        href="/settings?tab=subscription"
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal px-5 py-2.5 text-sm font-medium text-navy hover:brightness-110"
      >
        {t("sub.upgrade")} <IconArrowRight size={15} className="rtl-flip" />
      </Link>
    </div>
  );
}
