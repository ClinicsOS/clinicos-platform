"use client";
import { useEffect, useRef, type RefObject } from "react";

/**
 * Accessible modal behaviour for the patient app's sheets (Phase 9): focus moves into the dialog, Tab is trapped inside it, Escape closes,
 * and focus returns to whatever opened it. Also reports open/closed so the screens behind can recede.
 */
export function useDialog(open: boolean, onClose: () => void, opts: { onOpenChange?: (open: boolean) => void; initialFocus?: string } = {}): RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const changeRef = useRef(opts.onOpenChange);
  changeRef.current = opts.onOpenChange;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    changeRef.current?.(true);
    const node = ref.current;
    const focusables = () => (node ? Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null || el === document.activeElement) : []);
    const t = setTimeout(() => {
      const first = (opts.initialFocus ? node?.querySelector<HTMLElement>(opts.initialFocus) : null) ?? focusables()[0] ?? node;
      first?.focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const f = focusables();
      if (!f.length) return;
      const a = f[0];
      const z = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === a || !node.contains(document.activeElement))) {
        e.preventDefault();
        z.focus();
      } else if (!e.shiftKey && document.activeElement === z) {
        e.preventDefault();
        a.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      changeRef.current?.(false);
      try {
        if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return ref;
}
