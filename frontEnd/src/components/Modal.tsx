"use client";
import { ReactNode } from "react";
import { IconX } from "@tabler/icons-react";

/**
 * size="md" (default) — unchanged behaviour for every existing modal.
 * size="lg" — NEW: wider, and the body scrolls inside the viewport so long
 *             forms (the full patient file, expenses) never overflow the
 *             screen on a laptop or phone. Put a sticky footer inside with
 *             `sticky bottom-0` if the actions should stay visible.
 */
export default function Modal({
  title,
  onClose,
  children,
  size = "md",
  subtitle,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  size?: "md" | "lg";
  subtitle?: ReactNode;
}) {
  if (size === "lg") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4"
        onClick={onClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="card flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-5 pb-3 pt-4">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-ink">{title}</h3>
              {subtitle && <div className="mt-0.5 text-[11px] text-mute">{subtitle}</div>}
            </div>
            <button onClick={onClose} className="text-mute hover:text-ink" aria-label="Close">
              <IconX size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="card w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-medium text-ink">{title}</h3>
          <button onClick={onClose} className="text-mute hover:text-ink" aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
