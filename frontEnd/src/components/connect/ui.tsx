"use client";
// CLINICOS CONNECT (C2) — small shared pieces: avatar, role label, layout measuring, media queries.
import { useLayoutEffect, useRef, useState, useEffect } from "react";
import { IconUsers } from "@tabler/icons-react";
import s from "./connect.module.css";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Up to two initials; works for Latin and Arabic names (first letter of the first two words). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0])
    .join("")
    .toUpperCase();
}

export const roleKey = (role: string | undefined): "owner" | "doctor" | "receptionist" | "other" =>
  role === "owner" || role === "doctor" || role === "receptionist" ? role : "other";

export function roleLabel(t: (k: string) => string, role: string | undefined): string {
  const k = roleKey(role);
  return k === "other" ? "" : t(`msg.role.${k}`);
}

export function Avatar({ name, role, team, small }: { name?: string; role?: string; team?: boolean; small?: boolean }) {
  if (team) {
    return (
      <span className={cx(s.av, small && s.sm)} data-role="team" aria-hidden="true">
        <IconUsers stroke={1.7} />
      </span>
    );
  }
  return (
    <span className={cx(s.av, small && s.sm)} data-role={roleKey(role)} aria-hidden="true">
      <span>{initialsOf(name ?? "?")}</span>
    </span>
  );
}

export type ShellLayout = "desktop" | "tablet" | "mobile";
/** Layout from the width of the Messages panel itself (not the window), so it adapts to the sidebar/ZOOM too. */
export function useShellLayout<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [layout, setLayout] = useState<ShellLayout>("desktop");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (w: number) => setLayout(w >= 1000 ? "desktop" : w >= 640 ? "tablet" : "mobile");
    apply(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => apply(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, layout] as const;
}

export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}
