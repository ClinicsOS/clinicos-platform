"use client";
import { ReactNode, useEffect, useRef, useState } from "react";
import { IconAlertTriangle, IconChevronLeft, IconChevronRight, IconCircleCheck } from "@tabler/icons-react";
import { useLT, type LoyaltyTransactionType } from "@/lib/loyalty";
import { CountUp as LyxCountUp, LoyaltyEmptyState, LoyaltyErrorState, LoyaltyLoader, LoyaltySurface, type EmptyKind } from "./ui/LoyaltyUI";

/*
 * Shared building blocks of the Loyalty screens. Since Phase 8 they are thin wrappers over the ClinicOS Loyalty design system (ui/LoyaltyUI.tsx), so
 * every screen that already used them adopts the premium surfaces, 3D empty states and branded loading / error states automatically.
 */

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <LoyaltySurface as="section" className={className}>
      {children}
    </LoyaltySurface>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <LoyaltyLoader className={className} />;
}

/** Count-up for real numbers (instant under reduced motion / when unchanged). */
export const CountUp = LyxCountUp;

/** Premium empty state: a floating 3D glass tile, never filled with fake data. */
export function EmptyState({ icon, title, text, action, kind, compact }: { icon?: ReactNode; title: string; text: string; action?: ReactNode; kind?: EmptyKind; compact?: boolean }) {
  return <LoyaltyEmptyState kind={kind} icon={icon} title={title} text={text} action={action} compact={compact} />;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <LoyaltyErrorState message={message} onRetry={onRetry} />;
}

/** Inline, server-confirmed feedback (only ever shown after a real response). */
export function useFlash() {
  const [flash, setFlash] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = (type: "ok" | "err", text: string) => {
    setFlash({ type, text });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 4500);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const node = (
    <div role="status" aria-live="polite">
      {flash && (
        <div className="lyx-flash" data-t={flash.type}>
          {flash.type === "ok" ? <IconCircleCheck size={15} className="mt-0.5 shrink-0" /> : <IconAlertTriangle size={15} className="mt-0.5 shrink-0" />}
          <span className="min-w-0 break-words">{flash.text}</span>
        </div>
      )}
    </div>
  );
  return { show, node };
}

export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  const { t } = useLT();
  if (pages <= 1) return null;
  const btn = "flex h-10 w-10 items-center justify-center rounded-xl border border-edge bg-soft text-ink transition-colors hover:border-[color:var(--lyx-line2)] disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="flex items-center justify-between gap-3 px-1 pt-3 text-xs text-mute">
      <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t("Previous page", "الصفحة السابقة")}>
        <IconChevronLeft size={16} className="rtl-flip" />
      </button>
      <span>
        {t("Page", "صفحة")} {page} / {pages}
      </span>
      <button className={btn} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t("Next page", "الصفحة التالية")}>
        <IconChevronRight size={16} className="rtl-flip" />
      </button>
    </div>
  );
}

export function Avatar({ name, tierColor }: { name: string; tierColor?: string }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-200 to-amber-500 text-[11px] font-semibold text-[#3a280a]"
      style={tierColor ? { boxShadow: `0 0 0 2px #0b0d13, 0 0 0 3.5px ${tierColor}` } : undefined}
    >
      {initials || "?"}
    </span>
  );
}

export function useTxLabel() {
  const { t } = useLT();
  const map: Record<LoyaltyTransactionType, string> = {
    earn_visit: t("Visit points", "نقاط زيارة"),
    earn_spending: t("Spending points", "نقاط إنفاق"),
    manual_credit: t("Manual credit", "إضافة يدوية"),
    manual_debit: t("Manual debit", "خصم يدوي"),
    reward_redemption: t("Reward redemption", "استبدال مكافأة"),
    expiration: t("Expiration", "انتهاء صلاحية"),
    reversal: t("Reversal", "عكس حركة"),
    correction: t("Correction", "تصحيح"),
  };
  return (type: LoyaltyTransactionType) => map[type] ?? type;
}
