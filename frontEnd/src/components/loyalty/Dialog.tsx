"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { IconX } from "@tabler/icons-react";
import { useLT } from "@/lib/loyalty";
import { LyxPortal } from "./ui/LoyaltyUI";

/**
 * Loyalty modal (Phase 6, restyled in Phase 8 as LoyaltyModal — rendered through a portal into the Loyalty root so it is never trapped inside a
 * glass / transformed ancestor). Accessible modal for the Loyalty area: role="dialog", Escape closes, focus moves in and is restored,
 * Tab stays inside, page scroll is locked while open. `busy` blocks closing so an in-flight request can't be dismissed.
 */
export default function Dialog({
  open,
  onClose,
  title,
  children,
  busy = false,
  wide = false,
  testId,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  busy?: boolean;
  wide?: boolean;
  testId?: string;
  /** CSS selector inside the dialog to focus first (defaults to the first focusable element). */
  initialFocus?: string;
}) {
  const { t } = useLT();
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    prev.current = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? []);
    const first = (initialFocus ? ref.current?.querySelector<HTMLElement>(initialFocus) : null) ?? focusables()[0];
    const raf = requestAnimationFrame(() => first?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const a = f[0];
        const z = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) (e.preventDefault(), z.focus());
        else if (!e.shiftKey && document.activeElement === z) (e.preventDefault(), a.focus());
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      prev.current?.focus?.();
    };
  }, [open, busy, onClose, initialFocus]);

  if (!open) return null;
  return (
    <LyxPortal>
      <div className="lyx-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
        <div ref={ref} role="dialog" aria-modal="true" aria-label={title} data-testid={testId} data-wide={wide ? "true" : undefined} className="lyx-dialog">
          <div className="lyx-dialog-h">
            <h2 className="lyx-display">{title}</h2>
            <button type="button" onClick={onClose} disabled={busy} aria-label={t("Close", "إغلاق")} className="lyx-dialog-x">
              <IconX size={16} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </LyxPortal>
  );
}
