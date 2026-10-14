"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  const { lang } = useI18n();
  const isRtl = lang === "ar";
  const token = useAuth((s) => s.token);

  useEffect(() => setHydrated(true), []);

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

  return (
    // Interaction vs. visuals are separate concerns: the fixed wrapper keeps
    // its z-50 stacking (visual), but is pointer-events-none so the empty box
    // around the bubble (tooltip slot, margins, pulse-ring overflow) never
    // swallows clicks meant for page controls underneath. Only the real
    // interactive pieces below opt back in with pointer-events-auto.
    <div
      className={`fixed z-50 bottom-5 ${isRtl ? "left-5" : "right-5"} flex flex-col items-end pointer-events-none`}
      dir={isRtl ? "rtl" : "ltr"}
    >
      {/* ChatWindow's root carries pointer-events-auto (see ChatWindow.tsx). */}
      {open && <ChatWindow onClose={() => setOpen(false)} />}

      {!open && (
        <div className="relative flex flex-col items-center">
          {/* Purely informational label — never interactive, even while visible. */}
          <span
            className={`pointer-events-none mb-2 px-3 py-1.5 rounded-lg bg-card2 border border-edge text-ink text-sm whitespace-nowrap shadow-lg transition-all duration-200 ${
              hovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
            }`}
          >
            {BOT_NAME[lang]}
          </span>

          <button
            onClick={() => setOpen(true)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="pointer-events-auto relative w-16 h-16 rounded-full flex items-center justify-center"
            aria-label={BOT_NAME[lang]}
          >
            {/* Decorative pulse rings scale to 1.7x (beyond the button box) — must not catch clicks/hover. */}
            <span className="pulse-ring pointer-events-none absolute inset-0 rounded-full bg-teal/40" />
            <span className="pulse-ring pointer-events-none absolute inset-0 rounded-full bg-teal/40" style={{ animationDelay: "1s" }} />
            <span className="relative w-14 h-14 rounded-full bg-card2 border border-edge shadow-2xl flex items-center justify-center overflow-hidden hover:brightness-110 transition">
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
