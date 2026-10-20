"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/store/auth";
import { api } from "@/lib/api";
import Cube3D from "@/components/Cube3D";
import { ChatWindow } from "./ChatWindow";
import type { Clinic } from "@/lib/types";

const BOT_NAME = { ar: "اسأل نبض", en: "Ask Nabd" };

/**
 * Floating chat bubble, mounted once in the root layout.
 *
 * Visibility rule: always shown to visitors/patients (not authenticated —
 * this is the public marketing/lead-gen bot, unrelated to any clinic's
 * plan). For a logged-in clinic user, it's a Pro-only feature — hidden
 * until we've confirmed clinic.planInfo.limits.aiAssistant is true, never
 * shown optimistically. The backend enforces the same rule independently
 * (see chatController.ts) — this is UX polish, not the real gate.
 */
export function ChatWidget() {
  // The public patient Loyalty page (/c/<clinic>/loyalty) is a focused, branded experience — no floating bot there.
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const { lang } = useI18n();
  const isRtl = lang === "ar";
  const token = useAuth((s) => s.token);

  useEffect(() => setHydrated(true), []);
  // Closing the panel (button or Escape) hands the keyboard focus back to the launcher.
  useEffect(() => {
    if (wasOpen.current && !open) launcherRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // Same queryKey as the dashboard layout's own /clinic fetch — when this
  // widget renders inside the dashboard, react-query reuses that cached
  // data instead of firing a second request. On public pages (no token)
  // this query is disabled and never runs.
  // Phase 10: never fire a staff-authenticated request from the public patient
  // page (/c/...), even when a staff session happens to exist in this browser.
  const onPatientPage = !!pathname?.startsWith("/c/");
  const isAuthed = hydrated && !!token && !onPatientPage;
  const { data: clinic } = useQuery({
    queryKey: ["clinic"],
    queryFn: async () => (await api.get<Clinic>("/clinic")).data,
    enabled: isAuthed,
    staleTime: 3_000,
  });

  const canShow = !isAuthed || clinic?.planInfo?.limits.aiAssistant === true;

  if (!hydrated || !canShow || pathname?.startsWith("/c/")) return null;

  // PHASE 6 — pointer / stacking architecture (see PHASE6-FINAL-REPORT §6–§7):
  //  • ROOT  : `fixed`, `pointer-events-none`, sized by its content only. Collapsed, its box IS the 56 px launcher (the tooltip is `absolute`, so it adds
  //            no layout box); open, it is the chat panel. Nothing invisible is ever larger than what is drawn.
  //  • LAUNCHER / PANEL : the only `pointer-events-auto` nodes. The launcher's hit box equals the visible circle (no 64 px box around a 56 px disc);
  //            pulse rings, tooltip and any scale/transform are decorative (`pointer-events-none`) and are not part of the button's box.
  //  • LAYER : `z-nabd` — above page content and dropdowns, BELOW drawers / modals / dialogs / toasts (src/lib/layers.ts).
  //  • SAFE AREA : offsets add env(safe-area-inset-*), so the launcher never sits under a phone's home indicator / notch.
  const side = isRtl ? "left" : "right";
  const rootStyle = {
    bottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))",
    [side]: `calc(1.25rem + env(safe-area-inset-${side}, 0px))`,
  } as const;

  return (
    <div data-testid="nabd-root" className="pointer-events-none fixed z-nabd" style={rootStyle} dir={isRtl ? "rtl" : "ltr"}>
      {/* ChatWindow's root carries pointer-events-auto (see ChatWindow.tsx). */}
      {open && <ChatWindow onClose={() => setOpen(false)} />}

      {!open && (
        <div className="relative">
          {/* Purely informational label — absolutely positioned, never interactive, never part of the layout box. */}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute bottom-full end-0 mb-2 whitespace-nowrap rounded-lg border border-edge bg-card2 px-3 py-1.5 text-sm text-ink shadow-lg transition-all duration-200 ${
              hovered ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
            }`}
          >
            {BOT_NAME[lang]}
          </span>

          <button
            ref={launcherRef}
            type="button"
            data-testid="nabd-launcher"
            onClick={() => setOpen(true)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            className="pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full border border-edge bg-card2 shadow-2xl transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            aria-label={BOT_NAME[lang]}
            aria-haspopup="dialog"
            aria-expanded={false}
          >
            {/* Decorative pulse rings scale to 1.7x (beyond the button box) — must not catch clicks/hover. */}
            <span aria-hidden="true" className="pulse-ring pointer-events-none absolute inset-0 rounded-full bg-teal/40" />
            <span aria-hidden="true" className="pulse-ring pointer-events-none absolute inset-0 rounded-full bg-teal/40" style={{ animationDelay: "1s" }} />
            <span className="pointer-events-none relative flex h-full w-full items-center justify-center overflow-hidden rounded-full">
              <Cube3D size={34} spin />
            </span>
          </button>
        </div>
      )}

      <style jsx>{`
        @keyframes pulseRing {
          0% {
            transform: scale(0.9);
            opacity: 0.55;
          }
          100% {
            transform: scale(1.7);
            opacity: 0;
          }
        }
        .pulse-ring {
          animation: pulseRing 2s cubic-bezier(0.2, 0.7, 0.3, 1) infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .pulse-ring {
            animation: none;
            display: none;
          }
        }
      `}</style>
    </div>
  );
}
