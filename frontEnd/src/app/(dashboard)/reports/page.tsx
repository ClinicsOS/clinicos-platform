"use client";
// PHASE 6 — Reports & Analytics Center. The shell only: tabs (decided by the SERVER via /analytics/meta), global filters, export / print.
// Every figure is computed by the backend (src/services/analytics/*) from ClinicOS source data; this page draws what it returns.
// The old month-based page used /api/reports/monthly; that endpoint is untouched (nothing in the UI calls it any more).
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { IconArrowRight, IconLock } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useAccess, useClinicDoctors } from "@/lib/access";
import { useToast } from "@/components/Toast";
import { DEFAULT_FILTERS, downloadExport, filtersValid, useAnalytics, useAnalyticsMeta, type Filters, type SectionId } from "@/lib/analytics";
import { shortDate } from "@/lib/expenses";
import FilterBar from "@/components/analytics/FilterBar";
import { SectionError, SectionSkeleton } from "@/components/analytics/kit";
import type { SectionProps } from "@/components/analytics/common";
import OverviewSection from "@/components/analytics/sections/OverviewSection";
import FinancialSection from "@/components/analytics/sections/FinancialSection";
import AppointmentsSection from "@/components/analytics/sections/AppointmentsSection";
import PatientsSection from "@/components/analytics/sections/PatientsSection";
import TreatmentsSection from "@/components/analytics/sections/TreatmentsSection";
import DoctorsSection from "@/components/analytics/sections/DoctorsSection";
import ExpensesSection from "@/components/analytics/sections/ExpensesSection";
import LoyaltySection from "@/components/analytics/sections/LoyaltySection";

const VIEWS: Record<SectionId, (p: SectionProps) => JSX.Element> = {
  overview: OverviewSection, financial: FinancialSection, appointments: AppointmentsSection, patients: PatientsSection,
  treatments: TreatmentsSection, doctors: DoctorsSection, expenses: ExpensesSection, loyalty: LoyaltySection,
};

export default function ReportsPage() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const access = useAccess();
  const owner = access.isOwner;
  const metaQ = useAnalyticsMeta(access.can("reports")); // a role without reports access never calls the API (the layout also redirects it)
  const meta = metaQ.data;

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [tab, setTab] = useState<SectionId>("overview");
  const [exporting, setExporting] = useState(false);
  const { doctors } = useClinicDoctors(owner);

  // ?tab=… (shareable / reload-safe). Only a known section id is accepted; the server decides what is actually available.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("tab");
    if (q && q in VIEWS) setTab(q as SectionId);
  }, []);
  const pickTab = (s: SectionId) => {
    setTab(s);
    const u = new URL(window.location.href);
    u.searchParams.set("tab", s);
    window.history.replaceState(null, "", u.toString());
  };

  // an owner narrowed to one doctor sees that doctor's analytics, which has no clinic-wide Loyalty
  const tabs = useMemo(() => (meta?.sections ?? []).filter((s) => !(s === "loyalty" && filters.doctorId)), [meta, filters.doctorId]);
  const active: SectionId = tabs.includes(tab) ? tab : tabs[0] ?? "overview";

  // shares the cache entry with the section itself — only used for the range banner and to enable export
  const head = useAnalytics(active, filters, owner, !!meta);

  if (metaQ.isLoading || (!meta && !metaQ.error)) {
    return <div className="mx-auto max-w-6xl"><h1 className="mb-4 text-lg font-medium text-ink">{t("an.title")}</h1><SectionSkeleton /></div>;
  }
  if (axios.isAxiosError(metaQ.error) && metaQ.error.response?.status === 402) return <ReportsLockedScreen />;
  if (!meta) return <div className="mx-auto max-w-6xl"><h1 className="mb-4 text-lg font-medium text-ink">{t("an.title")}</h1><SectionError forbidden={axios.isAxiosError(metaQ.error) && metaQ.error.response?.status === 403} onRetry={() => void metaQ.refetch()} /></div>;

  const d = head.data as any;
  const fmtRange = (r?: { from: string; to: string }) => (r ? (r.from === r.to ? shortDate(r.from, lang) : `${shortDate(r.from, lang)} – ${shortDate(r.to, lang)}`) + ` ${r.to.slice(0, 4)}` : "");
  const rangeText = fmtRange(d?.range);
  const compareText = d?.comparison ? `${t("an.cmp.vs")} ${fmtRange(d.comparison.range)} · ${t(`an.basis.${d.comparison.basis}`)}` : "";

  const openLedger: SectionProps["openLedger"] = (range, extra) => {
    const p = new URLSearchParams({ from: range.from, to: range.to });
    if (extra?.category) p.set("category", extra.category);
    if (owner && filters.doctorId) p.set("doctorId", filters.doctorId);
    router.push(`/expenses?${p.toString()}`);
  };

  const doExport = async () => {
    if (!filtersValid(filters)) return;
    setExporting(true);
    try { await downloadExport(active, filters, owner); } catch { toast.error(t("common.error"), t("an.exportFailed")); } finally { setExporting(false); }
  };

  const View = VIEWS[active];
  return (
    <div className="mx-auto max-w-6xl pb-24" data-testid="analytics-center">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-lg font-medium text-ink">{t("an.title")}</h1>
          <p className="text-[11px] text-mute" data-testid="an-scope-line">{meta.scope.level === "self" ? t("an.scope.self") : meta.scope.clinicWide && !filters.doctorId ? t("an.scope.clinic") : t("an.scope.doctor")}</p>
        </div>
      </div>

      <FilterBar filters={filters} onChange={setFilters} meta={meta} owner={owner} doctors={doctors} canFilterDoctor={owner} rangeText={rangeText} compareText={filters.compare ? compareText : ""}
        onExport={doExport} exporting={exporting} onPrint={() => window.print()} exportable={!!d} />

      <div className="an-print-only mb-3 text-xs text-ink">{t("an.title")} — {t(`an.tab.${active}`)} — {rangeText} ({meta.timeZone})</div>

      <div className="an-noprint mb-4 overflow-x-auto">
        <div className="flex min-w-max gap-1 rounded-xl border border-edge bg-card p-1" role="tablist" data-testid="an-tabs">
          {tabs.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={active === s} data-testid={`tab-${s}`} onClick={() => pickTab(s)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${active === s ? "bg-teal text-navy" : "text-mute hover:text-ink"}`}>
              {t(`an.tab.${s}`)}
            </button>
          ))}
        </div>
      </div>

      <View key={`${active}`} filters={filters} owner={owner} meta={meta} openLedger={openLedger} />
    </div>
  );
}

function ReportsLockedScreen() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-md pt-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500/20 text-amber-400"><IconLock size={26} /></div>
      <h1 className="text-lg font-medium text-ink">{t("reports.lockedTitle")}</h1>
      <p className="mx-auto mt-2 max-w-sm text-xs text-mute">{t("reports.lockedSub")}</p>
      <Link href="/settings?tab=subscription" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-teal px-5 py-2.5 text-sm font-medium text-navy hover:brightness-110">
        {t("sub.upgrade")} <IconArrowRight size={15} className="rtl-flip" />
      </Link>
    </div>
  );
}
