"use client";
import { useI18n } from "@/lib/i18n";

/**
 * Premium loading state for the clinical map: a calm anatomical silhouette with a slow scan line — never a bare spinner
 * over an empty rectangle. No fake percentages (real progress is not available). Motion stops for prefers-reduced-motion.
 */
export default function DermLoading() {
  const { t } = useI18n();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" role="status" aria-live="polite">
      <div className="relative h-[58%] max-h-[420px] min-h-[180px] aspect-[2/5]">
        <svg viewBox="0 0 120 300" className="dm-pulse h-full w-full text-[#7FB6D6]" fill="none" stroke="currentColor" aria-hidden="true">
          <g strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.85">
            <ellipse cx="60" cy="24" rx="13" ry="16" />
            <path d="M54 39v10M66 39v10" />
            <path d="M40 54c6-5 14-6 20-6s14 1 20 6l3 8-1 20-4 34c-1 8-3 14-3 22H45c0-8-2-14-3-22l-4-34-1-20z" />
            <path d="M38 60c-7 8-12 26-14 44l-4 34M82 60c7 8 12 26 14 44l4 34" strokeWidth="9" opacity="0.35" />
            <path d="M52 156c-3 26-4 52-4 78l-1 44M68 156c3 26 4 52 4 78l1 44" strokeWidth="12" opacity="0.35" />
          </g>
        </svg>
        <span className="dm-scan pointer-events-none absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-[#7FB6D6] to-transparent" aria-hidden="true" />
      </div>
      <div className="text-xs text-[#CFE9F2]">{t("dm.loading3d")}</div>
    </div>
  );
}
