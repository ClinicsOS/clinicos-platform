"use client";
import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconFileText, IconHistory, IconPrinter } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_OPTIONS, OPTION_KEYS, optionsToQuery, type ReportOptions } from "@/lib/derm/reportModel";

/**
 * ONE "Print / Export" menu on the Dermatology & Aesthetics patient profile (same philosophy as the Dentistry menu).
 * It only builds a link: each option opens the print-only /derm-report page in a new tab, which fetches its own
 * server-authorized data. The financial summary is opt-in (default OFF) and is additionally permission-gated server-side.
 * Positioned `fixed` from the trigger's rect so the profile hero's `overflow-hidden` can never clip it.
 */
export default function DermPrintExportMenu({ patientId }: { patientId: string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ReportOptions>({ ...DEFAULT_OPTIONS });
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = Math.min(304, window.innerWidth - 16);
    const rtl = lang === "ar";
    let left = rtl ? rect.left : rect.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPos({ top: rect.bottom + 6, left });
  };
  useEffect(() => {
    if (!open) return;
    const onReflow = () => place();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("resize", onReflow); window.removeEventListener("scroll", onReflow, true); window.removeEventListener("keydown", onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openReport = (type: "full" | "plan" | "history") => {
    const q = type === "full" ? `&${optionsToQuery(opts)}` : type === "history" && opts.financial ? "&financial=1" : "";
    window.open(`/derm-report?patient=${encodeURIComponent(patientId)}&type=${type}${q}`, "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  return (
    <div>
      <button ref={btnRef} type="button" aria-expanded={open} aria-haspopup="menu" className="btn-ghost !bg-sky/10 !text-[#DCEBF7] !border-[#8FB3CC]/50 !py-2 text-xs" onClick={() => { if (!open) place(); setOpen((v) => !v); }}>
        <IconPrinter size={14} /> {t("dr.menu")} <IconChevronDown size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div role="menu" className="fixed z-50 max-h-[80vh] overflow-y-auto rounded-xl border border-edge bg-card p-2 shadow-xl" style={{ top: pos.top, left: pos.left, width: Math.min(304, typeof window !== "undefined" ? window.innerWidth - 16 : 304) }}>
            <button type="button" role="menuitem" className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start text-[12px] hover:bg-soft" onClick={() => openReport("full")}>
              <IconFileText size={15} className="mt-0.5 shrink-0 text-teal" /><span className="font-medium text-ink">{t("dr.menu.full")}</span>
            </button>
            <fieldset className="px-2.5 pb-1.5 pt-0.5">
              <legend className="pb-1 text-[10px] uppercase tracking-wide text-mute">{t("dr.opt.include")}</legend>
              <div className="grid grid-cols-1 gap-0.5">
                {OPTION_KEYS.map((k) => (
                  <label key={k} className="flex items-center gap-2 text-[11px] text-mute">
                    <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
                    {t(`dr.opt.${k}`)}
                  </label>
                ))}
              </div>
              {opts.financial && <p className="mt-1 text-[9.5px] leading-snug text-mute">{t("dr.opt.financialNote")}</p>}
            </fieldset>
            <div className="my-1 h-px bg-edge" />
            <button type="button" role="menuitem" className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start text-[12px] hover:bg-soft" onClick={() => openReport("plan")}>
              <IconFileText size={15} className="mt-0.5 shrink-0 text-sky" /><span className="font-medium text-ink">{t("dr.menu.plan")}</span>
            </button>
            <button type="button" role="menuitem" className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start text-[12px] hover:bg-soft" onClick={() => openReport("history")}>
              <IconHistory size={15} className="mt-0.5 shrink-0 text-mute" /><span className="font-medium text-ink">{t("dr.menu.history")}</span>
            </button>
            <p className="px-2.5 pb-1 pt-2 text-[9.5px] leading-relaxed text-mute">{t("dr.menu.sessionHint")}</p>
            <p className="px-2.5 pb-1 text-[9.5px] leading-relaxed text-mute">{t("dr.menu.openIn")}</p>
          </div>
        </>
      )}
    </div>
  );
}
