"use client";
import { forwardRef } from "react";
import { useI18n } from "@/lib/i18n";
import { getToothMeta, toothName } from "@/lib/dental/fdi";
import { SURFACE_LABELS } from "@/lib/dental/taxonomy";
import { procLabel } from "@/lib/dental/procedures";
import type { ToothSummary } from "@/lib/dental/toothSummary";
import { ProcSwatch, StatusPill } from "./treatment/shared";

/**
 * Hover PREVIEW of one tooth: diagnosis + its Treatment Plan items (name + the plan's own status), nothing editable.
 * Hover = preview, click/tap = the full tooth panel (which has the same information, history and the "View Plan" action),
 * the Treatment Plan = where treatments are managed. Pure presentation: everything comes from the already-loaded plan data
 * (see lib/dental/toothSummary.ts) — it makes no request and holds no state of its own.
 *
 * It is positioned imperatively by the chart (transform on every pointer move, clamped to the chart) and is
 * `pointer-events: none`, so the pointer can never "fall off" the tooth onto the tooltip: it cannot flicker, cannot steal
 * the click that selects the tooth, and cannot block the 3D camera.
 */
interface Props {
  summary: ToothSummary;
  /** false while the treatment plan is loading / failed: then we must NOT claim "No treatment planned". */
  planReady: boolean;
}

const ToothHoverSummary = forwardRef<HTMLDivElement, Props>(function ToothHoverSummary({ summary, planReady }, ref) {
  const { t, lang } = useI18n();
  const meta = getToothMeta(summary.fdi);
  if (!meta) return null;
  const empty = planReady && summary.total === 0;
  return (
    <div
      ref={ref}
      role="tooltip"
      data-testid="tooth-hover-summary"
      data-fdi={summary.fdi}
      dir={lang === "ar" ? "rtl" : "ltr"}
      className="pointer-events-none absolute left-0 top-0 z-10 w-max max-w-[260px] rounded-xl border border-white/10 bg-[#06263F]/95 px-3 py-2 text-[11px] text-[#E6F3FA] shadow-xl backdrop-blur-sm"
      style={{ willChange: "transform" }}
    >
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[13px] text-teal" dir="ltr">{meta.fdi}</span>
        <span className="min-w-0 break-words text-[11px] text-[#CFE9F2]">{toothName(meta, t)}</span>
      </div>

      {summary.diagnoses.length > 0 && (
        <div className="mt-1.5" data-testid="tt-diagnoses">
          <div className="text-[9px] font-medium tracking-wide text-[#8FB3CC]">{t("dn.diagnoses")}</div>
          {summary.diagnoses.map((d, i) => (
            <div key={`${d.code}|${d.surfaces.join("")}|${i}`} className="break-words text-[11px]">
              <span className="text-amber-400">●</span> {t(`dn.c.${d.code}`)}
              {d.surfaces.length > 0 && <span className="ms-1 font-mono text-[9px] text-sky" dir="ltr">{d.surfaces.map((s) => SURFACE_LABELS[s as keyof typeof SURFACE_LABELS] ?? s).join(",")}</span>}
            </div>
          ))}
        </div>
      )}

      {summary.total > 0 && (
        <div className="mt-1.5" data-testid="tt-treatments">
          <div className="text-[9px] font-medium tracking-wide text-[#8FB3CC]">{t("dn.forTooth")}</div>
          <ul className="mt-0.5 space-y-1">
            {summary.shown.map((x) => (
              <li key={x._id} data-status={x.status} data-code={x.procedureCode} className="flex items-start justify-between gap-2">
                <span className="flex min-w-0 items-start gap-1.5">
                  <span className="mt-0.5"><ProcSwatch code={x.procedureCode} status={x.status} /></span>
                  <span className="line-clamp-2 min-w-0 break-words">
                    {procLabel(t, x)}
                    {x.surfaces.length > 0 && <span className="ms-1 font-mono text-[9px] text-sky" dir="ltr">{x.surfaces.map((s) => SURFACE_LABELS[s]).join(",")}</span>}
                  </span>
                </span>
                <span className="shrink-0"><StatusPill status={x.status} /></span>
              </li>
            ))}
          </ul>
          {summary.hidden > 0 && <div data-testid="tt-more" className="mt-1 text-[10px] text-[#8FB3CC]">{t("dn.tt.more").replace("{n}", String(summary.hidden))}</div>}
        </div>
      )}

      {empty && <div data-testid="tt-none" className="mt-1.5 text-[10px] text-[#8FB3CC]">{t("dn.tt.none")}</div>}

      <div className="mt-1.5 border-t border-white/10 pt-1 text-[9px] text-[#8FB3CC]">{t("dn.tt.click")}</div>
    </div>
  );
});

export default ToothHoverSummary;
