"use client";

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
  const isAuthed = hydrated && !!token;
  const { data: clinic } = useQuery({
    queryKey: ["clinic"],
    queryFn: async () => (await api.get<Clinic>("/clinic")).data,
    enabled: isAuthed,
    staleTime: 3_000,
  });

  const canShow = !isAuthed || clinic?.planInfo?.limits.aiAssistant === true;

  if (!hydrated || !canShow) return null;

  return (
    <div
      className={`fixed z-50 bottom-5 ${isRtl ? "left-5" : "right-5"} flex flex-col items-end`}
      dir={isRtl ? "rtl" : "ltr"}
    >
      {open && <ChatWindow onClose={() => setOpen(false)} />}

      {!open && (
        <div className="relative flex flex-col items-center">
          <span
            className={`mb-2 px-3 py-1.5 rounded-lg bg-card2 border border-edge text-ink text-sm whitespace-nowrap shadow-lg transition-all duration-200 ${
              hovered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none"
            }`}
          >
            {BOT_NAME[lang]}
          </span>

          <button
            onClick={() => setOpen(true)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className="relative w-16 h-16 rounded-full flex items-center justify-center"
            aria-label={BOT_NAME[lang]}
          >
            <span className="pulse-ring absolute inset-0 rounded-full bg-teal/40" />
            <span className="pulse-ring absolute inset-0 rounded-full bg-teal/40" style={{ animationDelay: "1s" }} />
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
