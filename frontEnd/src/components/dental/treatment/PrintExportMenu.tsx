"use client";
import { useEffect, useRef, useState } from "react";
import { IconChevronDown, IconFileText, IconHistory, IconPrinter } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";

/**
 * ONE "Print / Export" menu (not print buttons scattered everywhere) offering the three report types.
 * Each option opens the print-only /dental-report page in a new tab — the report itself fetches its own
 * server-authorized data; this menu only builds the link.
 *
 * Positioning: the menu is `position: fixed`, placed via the trigger button's own bounding rect, rather than
 * `absolute` under it. The Patient Profile header ("Hero" card) sets `overflow-hidden` (to clip its decorative
 * orbiting-avatar animation) — an `absolute` dropdown nested inside that card gets silently clipped to almost
 * nothing there, while `fixed` (the same technique Modal.tsx already uses) is unaffected by an ancestor's
 * overflow and always renders in full, wherever this menu is mounted.
 */
export default function PrintExportMenu({ patientId }: { patientId: string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [financial, setFinancial] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = 288; // w-72
    const rtl = lang === "ar";
    let left = rtl ? rect.left : rect.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    setPos({ top: rect.bottom + 6, left });
  };

  const toggle = () => {
    if (!open) place();
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onReflow = () => place();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => { window.removeEventListener("resize", onReflow); window.removeEventListener("scroll", onReflow, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const openReport = (type: "full" | "plan" | "history", withFinancial: boolean) => {
    const url = `/dental-report?patient=${patientId}&type=${type}${withFinancial ? "&financial=1" : ""}`;
    window.open(url, "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  return (
    <div>
      <button ref={btnRef} type="button" aria-expanded={open} className="btn-ghost !bg-sky/10 !text-[#DCEBF7] !border-[#8FB3CC]/50 !py-2 text-xs" onClick={toggle}>
        <IconPrinter size={14} /> {t("dn.rep.menu")} <IconChevronDown size={12} className={open ? "rotate-180" : ""} />
      </button>
      {open && pos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 w-72 rounded-xl border border-edge bg-card p-2 shadow-xl" style={{ top: pos.top, left: pos.left }}>
            <button type="button" className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start text-[12px] hover:bg-soft" onClick={() => openReport("full", financial)}>
              <IconFileText size={15} className="mt-0.5 shrink-0 text-teal" />
              <span><span className="block font-medium text-ink">{t("dn.rep.full")}</span></span>
            </button>
            <label className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-mute">
              <input type="checkbox" checked={financial} onChange={(e) => setFinancial(e.target.checked)} />
              {t("dn.rep.optFinancial")}
            </label>
            <div className="my-1 h-px bg-edge" />
            <button type="button" className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start text-[12px] hover:bg-soft" onClick={() => openReport("plan", false)}>
              <IconFileText size={15} className="mt-0.5 shrink-0 text-sky" />
              <span className="font-medium text-ink">{t("dn.rep.planOnly")}</span>
            </button>
            <button type="button" className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start text-[12px] hover:bg-soft" onClick={() => openReport("history", false)}>
              <IconHistory size={15} className="mt-0.5 shrink-0 text-mute" />
              <span className="font-medium text-ink">{t("dn.rep.historyOnly")}</span>
            </button>
            <p className="px-2.5 pb-1 pt-2 text-[9.5px] leading-relaxed text-mute">{t("dn.rep.openIn")}</p>
          </div>
        </>
      )}
    </div>
  );
}
