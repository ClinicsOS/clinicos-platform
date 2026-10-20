"use client";
import { IconX, IconPlus } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { getToothMeta, toothName, type DentitionType } from "@/lib/dental/fdi";
import { deriveTargetMode } from "@/lib/dental/procedures";
import { teethSummary } from "@/lib/dental/teethFormat";
import type { ToothTreatment, TreatmentsByTooth } from "@/lib/dental/toothSummary";
import { treatmentsOf } from "@/lib/dental/toothSummary";
import { procLabel } from "@/lib/dental/procedures";
import { StatusPill } from "./treatment/shared";

/**
 * PHASE 5 — details of a SERIAL (multi-tooth) selection: "4 Teeth Selected", the teeth (each removable), quick arch selection and the
 * ONE action that matters — add a treatment for all of them. Presentation only: the selection itself lives in DentalChartTab and is
 * shared by the 2D grid and the 3D scene.
 */
export default function MultiSelectPanel(p: {
  teeth: string[];
  dentition: DentitionType;
  byTooth: TreatmentsByTooth;
  canWrite: boolean;
  variant: "side" | "sheet" | "inline";
  onRemove: (fdi: string) => void;
  onClear: () => void;
  onArch: (jaw: "upper" | "lower") => void;
  onAddTreatment: () => void;
  onExit: () => void;
}) {
  const { t, lang } = useI18n();
  const n = p.teeth.length;
  const mode = deriveTargetMode("multi_tooth", p.teeth, p.dentition);
  const wrap =
    p.variant === "side" ? "dn-panel-in absolute bottom-3 right-3 top-3 z-20 w-[300px]"
    : p.variant === "sheet" ? "dn-sheet-in fixed inset-x-0 bottom-0 z-drawer max-h-[68vh]"
    : "w-full";
  // open work on the selected teeth (de-duplicated: one multi-tooth treatment appears once)
  const seen = new Map<string, ToothTreatment>();
  for (const f of p.teeth) for (const it of treatmentsOf(p.byTooth, f)) if (it.status !== "completed") seen.set(it._id, it);
  const open = Array.from(seen.values());
  return (
    <aside data-testid="multi-panel" data-count={n} data-mode={mode} dir={lang === "ar" ? "rtl" : "ltr"} className={wrap} aria-label={t("dn2.multi.title").replace("{n}", String(n))}>
      <div className={`card flex max-h-full flex-col overflow-hidden shadow-2xl ${p.variant === "sheet" ? "rounded-b-none" : ""}`}>
        <div className="flex items-start gap-2 border-b border-edge px-3.5 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium tracking-[0.14em] text-mute">{t("dn2.multi.mode").toUpperCase()}</div>
            <div className="mt-0.5 text-[13px] font-medium text-ink" data-testid="multi-title" aria-live="polite">{t("dn2.multi.title").replace("{n}", String(n))}</div>
          </div>
          <button type="button" onClick={p.onExit} aria-label={t("dn2.multi.exit")} className="rounded-md p-1 text-mute hover:bg-soft hover:text-ink"><IconX size={15} /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
          {n === 0 ? (
            <p className="text-[11px] leading-relaxed text-mute">{t("dn2.multi.empty")}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5" data-testid="multi-teeth">
                {p.teeth.map((f) => {
                  const m = getToothMeta(f);
                  return (
                    <span key={f} data-fdi={f} title={m ? toothName(m, t) : f} className="inline-flex items-center gap-1 rounded-full border border-teal/50 bg-teal/10 py-0.5 ps-2 pe-0.5 font-mono text-[11px] text-teal" dir="ltr">
                      {f}
                      <button type="button" aria-label={`${t("dn2.multi.remove")} ${f}`} onClick={() => p.onRemove(f)} className={`rounded-full p-0.5 hover:bg-teal/25 ${p.variant === "sheet" ? "min-h-[28px] min-w-[28px]" : ""}`}><IconX size={11} /></button>
                    </span>
                  );
                })}
              </div>
              <p className="text-[11px] text-mute" data-testid="multi-summary">{n > 3 ? <>{teethSummary(p.teeth, t)} · </> : null}{t(`dn2.mode.${mode}`).replace("{n}", String(n))}</p>
            </>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" data-testid="multi-upper" className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => p.onArch("upper")}>{t("dn2.multi.upper")}</button>
            <button type="button" data-testid="multi-lower" className="btn-ghost !px-2 !py-1 text-[11px]" onClick={() => p.onArch("lower")}>{t("dn2.multi.lower")}</button>
            <button type="button" data-testid="multi-clear" className="btn-ghost !px-2 !py-1 text-[11px]" disabled={!n} onClick={p.onClear}>{t("dn2.multi.clear")}</button>
          </div>
          {open.length > 0 && (
            <div data-testid="multi-open-work">
              <div className="mb-1 text-[10px] font-medium tracking-wide text-mute">{t("dn2.multi.openWork")}</div>
              <ul className="space-y-1">
                {open.slice(0, 6).map((it) => (
                  <li key={it._id} className="flex flex-wrap items-center gap-x-2 text-[11px] text-ink">
                    <span className="min-w-0 break-words">{procLabel(t, it)}</span>
                    <span className="font-mono text-[10px] text-mute" dir="ltr">{it.toothNumbers.filter((f) => p.teeth.includes(f)).join(",")}</span>
                    <StatusPill status={it.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="border-t border-edge px-3.5 py-2.5">
          {p.canWrite ? (
            <button type="button" data-testid="multi-add-treatment" disabled={n < 2} onClick={p.onAddTreatment}
              className={`btn-teal w-full !py-1.5 text-[11px] disabled:opacity-50 ${p.variant === "sheet" ? "min-h-[44px]" : ""}`}>
              <IconPlus size={13} /> {t("dn2.multi.add")}
            </button>
          ) : <div className="text-[10px] text-mute">{t("dn.readOnly")}</div>}
          {p.canWrite && n < 2 && <p className="mt-1 text-[10px] text-mute">{t("dn.err.needTeeth")}</p>}
        </div>
      </div>
    </aside>
  );
}
