"use client";
/**
 * PHASE 3 — reusable focus / highlight behaviour for deep links (one mechanism for every screen).
 *
 *   <FocusProvider keys={[...]} run={searchString}>   — the Patient Profile says WHICH records the URL points at
 *   const f = useFocusTarget("item", item._id)         — a card says "I am record item:<id>"
 *   <div ref={f.ref} className={f.className}>          — …and receives the scroll + highlight when (and only when) it is that record
 *
 * How it waits for data WITHOUT timers: the element reports itself through a callback ref into state, so the effect that scrolls and highlights
 * runs exactly when the target is actually rendered — whether that is immediately, or after the data finishes loading, or after a modal opens.
 * Nothing polls, nothing guesses a delay. The only timer is the one that ENDS the highlight (≈2.4 s).
 *
 * Targets are matched by STABLE ids (`kind:id`), never by text or position. Respect for reduced motion: no smooth scrolling and a static
 * outline instead of the pulse (see .hl-focus in globals.css).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

interface FocusState { keys: ReadonlySet<string>; run: string }
const FocusCtx = createContext<FocusState>({ keys: new Set(), run: "" });

export const HIGHLIGHT_MS = 2400;

export function FocusProvider({ keys, run, children }: { keys: readonly string[]; run: string; children: ReactNode }) {
  const joined = keys.join("|");
  const value = useMemo<FocusState>(() => ({ keys: new Set(joined ? joined.split("|") : []), run }), [joined, run]);
  return <FocusCtx.Provider value={value}>{children}</FocusCtx.Provider>;
}

const prefersReducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Is this record the one the URL points at? (no scrolling / highlight — for components that only need to react, e.g. to open a section) */
export function useIsFocusTarget(kind: string, id: string | undefined | null): boolean {
  const ctx = useContext(FocusCtx);
  return !!id && ctx.keys.has(`${kind}:${id}`);
}

/** Does the URL point at this kind of record at all (any id)? Used to decide "the original record is no longer available". */
export function useFocusKeys(): ReadonlySet<string> {
  return useContext(FocusCtx).keys;
}

export function useFocusTarget(kind: string, id: string | undefined | null) {
  const ctx = useContext(FocusCtx);
  const isTarget = !!id && ctx.keys.has(`${kind}:${id}`);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [on, setOn] = useState(false);
  const handledRun = useRef<string | null>(null);

  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); }, []);

  useEffect(() => {
    if (!isTarget || !el || handledRun.current === ctx.run) return;
    handledRun.current = ctx.run; // once per navigation: a re-render or a data refresh never replays it
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    setOn(true);
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), HIGHLIGHT_MS); // ends the highlight; cleared only on unmount
  }, [isTarget, el, ctx.run]);

  const ref = useCallback((node: HTMLElement | null) => setEl(node), []);
  return {
    ref,
    isTarget,
    highlighted: on,
    className: on ? "hl-focus" : "",
    /** data attributes: a stable hook for tests / assistive tooling; carries no data. */
    attrs: { "data-focus-id": id ?? undefined, "data-focus-kind": kind, "data-focused": on ? "true" : undefined } as Record<string, string | undefined>,
  };
}
