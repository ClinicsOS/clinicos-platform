"use client";
import { IconAlertTriangle, IconClipboardList, IconMap2 } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useDermMap } from "@/lib/derm/hooks";
import { useDermOverview } from "@/lib/derm/treatmentHooks";
import { TypeGlyph, fmtDate } from "./dermUi";

/**
 * Patient Profile overview for Dermatology & Aesthetics clinics: compact counts + the two entry points (Clinical Map /
 * Treatment Plan). Counts only — no severity, no scoring, and it never repeats the Core patient financial summary
 * ("Needs billing" = completed treatment not yet invoiced; it does not mean the patient owes money).
 */
export default function DermOverviewCard({ patientId, onOpenMap, onOpenPlan }: { patientId: string; onOpenMap: () => void; onOpenPlan: () => void }) {
  const { t, lang } = useI18n();
  const map = useDermMap(patientId);
  const ov = useDermOverview(patientId);
  const m = map.data;
  const d = ov.data;
  const tiles: { k: string; label: string; n: number; warn?: boolean }[] = d ? [
    { k: "a", label: t("dt.ov.assessments"), n: d.activeAssessments },
    { k: "p", label: t("dt.status.planned"), n: d.planned },
    { k: "i", label: t("dt.status.in_progress"), n: d.inProgress },
    { k: "c", label: t("dt.status.completed"), n: d.completed },
    { k: "b", label: t("dt.billing.needs"), n: d.needsBilling, warn: d.needsBilling > 0 },
  ] : [];
  return (
    <div className="card mt-3 space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-ink"><IconMap2 size={16} className="text-teal" />{t("dm.overview.title")}</div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-mute">
          {(map.isLoading || ov.isLoading) && <span>{t("common.loading")}</span>}
          {(map.isError || ov.isError) && <span role="alert" className="inline-flex items-center gap-1 text-red-300"><IconAlertTriangle size={13} />{t("dm.err.load")}<button type="button" className="ms-1 underline" onClick={() => { void map.refetch(); void ov.refetch(); }}>{t("dm.retry")}</button></span>}
          {m && m.total > 0 && (
            <>
              <span className="inline-flex items-center gap-1.5"><TypeGlyph type="dermatology" />{t("dm.type.dermatology")}: <b className="text-ink">{m.byType.dermatology}</b></span>
              <span className="inline-flex items-center gap-1.5"><TypeGlyph type="aesthetic" />{t("dm.type.aesthetic")}: <b className="text-ink">{m.byType.aesthetic}</b></span>
              <span>{t("dm.overview.regions").replace("{n}", String(Object.keys(m.regions).length))}</span>
            </>
          )}
          {m && m.total === 0 && d && d.planned + d.inProgress + d.completed === 0 && <span>{t("dm.overview.none")}</span>}
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          <button type="button" className="btn-ghost !py-2 text-xs" onClick={onOpenPlan}><IconClipboardList size={14} className="me-1 inline" />{t("dt.ov.openPlan")}</button>
          <button type="button" className="btn-teal !py-2 text-xs" onClick={onOpenMap}>{t("dm.overview.open")}</button>
        </div>
      </div>
      {d && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {tiles.map((x) => (
            <div key={x.k} className={`rounded-lg border px-3 py-2 ${x.warn ? "border-amber-400/40 bg-amber-400/5" : "border-edge bg-card2"}`}>
              <div className="text-base font-medium text-ink">{x.n}</div>
              <div className="text-[10px] text-mute">{x.label}</div>
            </div>
          ))}
        </div>
      )}
      {d && (d.upcomingFollowUpAt || d.lastActivityAt) && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-mute">
          {d.upcomingFollowUpAt && <span>{t("dt.ov.upcoming")}: <b className="text-ink">{fmtDate(d.upcomingFollowUpAt, lang)}</b></span>}
          {d.lastActivityAt && <span>{t("dt.ov.last")}: <b className="text-ink">{fmtDate(d.lastActivityAt, lang)}</b></span>}
        </div>
      )}
    </div>
  );
}
