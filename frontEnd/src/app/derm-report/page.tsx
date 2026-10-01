"use client";
import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import axios from "axios";
import { useI18n } from "@/lib/i18n";
import { useDermReport } from "@/lib/derm/treatmentHooks";
import { parseOptions, type ReportType } from "@/lib/derm/reportModel";
import { regionLabel } from "@/lib/derm/regions";
import { DermReportDocument, reportCss } from "@/components/derm/report/DermReportDocument";

/**
 * Print-only Dermatology & Aesthetic reports (Patient File / Treatment Plan / Procedure-Session / Clinical History).
 * Deliberately OUTSIDE the (dashboard) route group — no sidebar / nav chrome — so the browser's native Print / Save as PDF
 * prints exactly this document (same strategy as /dental-report). All content comes from ONE server-authorized endpoint
 * (GET /api/derm/patients/:id/report); nothing is assembled from client-held data. Specialty, tenant and role checks happen
 * on the server: this page only lays the payload out.
 */
export default function DermReportPage() {
  return (
    <Suspense fallback={null}>
      <ReportBody />
    </Suspense>
  );
}

const TYPES: readonly ReportType[] = ["full", "plan", "session", "history"];

function Center({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return <div className={`flex min-h-screen items-center justify-center p-8 text-center text-sm text-[#5e6b7a] ${busy ? "animate-pulse" : ""}`}>{children}</div>;
}

function ReportBody() {
  const params = useSearchParams();
  const { t, lang } = useI18n();
  const patientId = params.get("patient") ?? "";
  const rawType = params.get("type") as ReportType | null;
  const type: ReportType = rawType && TYPES.includes(rawType) ? rawType : "full";
  const wantFinancial = params.get("financial") === "1" && (type === "full" || type === "history");
  const options = useMemo(() => parseOptions(params.get("inc"), wantFinancial), [params, wantFinancial]);
  const sessionId = params.get("session") ?? undefined;

  const q = useDermReport(patientId, wantFinancial, !!patientId);
  const rt = useMemo(() => (id: string, surface?: string | null) => {
    const base = regionLabel(id, lang === "ar" ? "ar" : "en");
    return surface ? `${base} · ${t(`dm.surface.${surface}`)}` : base;
  }, [lang, t]);

  if (!patientId) return <Center>{t("dr.err.noPatient")}</Center>;
  if (q.isLoading) return <Center busy>{t("dr.loading")}</Center>;
  if (q.isError || !q.data) {
    const status = axios.isAxiosError(q.error) ? q.error.response?.status : undefined;
    const msg = wantFinancial && (status === 402 || status === 403) ? t("dr.err.financial") : status === 403 ? t("dr.err.forbidden") : status === 404 ? t("dr.err.notFound") : t("dr.err.load");
    return (
      <Center>
        <div>
          <p>{msg}</p>
          <p className="mt-3 flex justify-center gap-2">
            {wantFinancial && (status === 402 || status === 403) && (
              <a className="rounded border border-[#c7d4de] px-3 py-1.5 text-xs" href={`/derm-report?patient=${encodeURIComponent(patientId)}&type=${type}`}>{t("dr.err.withoutFinancial")}</a>
            )}
            <button className="rounded border border-[#c7d4de] px-3 py-1.5 text-xs" onClick={() => q.refetch()}>{t("dr.retry")}</button>
          </p>
        </div>
      </Center>
    );
  }
  return (
    <div>
      <style>{reportCss}</style>
      <div className="toolbar">
        <button onClick={() => window.close()}>{t("dr.close")}</button>
        <button className="primary" onClick={() => window.print()}>{t("dr.print")}</button>
      </div>
      <DermReportDocument data={q.data} type={type} lang={lang} t={t} rt={rt} options={options} sessionId={sessionId} />
    </div>
  );
}
