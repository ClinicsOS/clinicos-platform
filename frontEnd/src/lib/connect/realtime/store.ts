"use client";
// CLINICOS CONNECT (C3) — tiny in-memory store for what the realtime layer knows right now. Nothing here is persisted, and none of it is
// authoritative: it is connection status, ephemeral typing signals and "poke" counters that wake the HTTP reconciliation in the hooks.
import { create } from "zustand";
import { typingExpire, typingWith, type TypingMap } from "./events";
import type { RtTypingEvent } from "../types";

/** "unavailable" = the API answers over HTTP but the realtime endpoint does not (switched off / blocked on this network): Connect runs on the C2 polling, silently. */
export type RtStatus = "off" | "connecting" | "connected" | "reconnecting" | "offline" | "denied" | "unavailable";

interface RtState {
  status: RtStatus;
  /** When the current non-connected state began (ms), for the "show the chip only after a moment" rule. */
  since: number;
  /** Server refusal that ended the session (PLAN_LIMIT, SUSPENDED, …) — the screens react through their HTTP answers. */
  deniedCode: string | null;
  /** Bumped after every (re)connect / foreground return: hooks do ONE HTTP catch-up when it changes. */
  reconcileTick: number;
  /** Per-conversation catch-up requests (a realtime message arrived with a gap before it). */
  catchUp: Record<string, number>;
  typing: TypingMap;
  /** The latest incoming message that deserves a (subtle) 3D pulse. */
  pulse: { nonce: number; conversationId: string; type: "direct" | "clinic_team"; senderId: string; kind: "text" | "appointment" | "patient" } | null;
  setStatus: (s: RtStatus, deniedCode?: string | null) => void;
  bumpReconcile: () => void;
  requestCatchUp: (conversationId: string) => void;
  applyTyping: (e: RtTypingEvent, myId: string, ttlMs: number) => void;
  expireTyping: () => void;
  firePulse: (conversationId: string, type: "direct" | "clinic_team", senderId: string, kind?: "text" | "appointment" | "patient") => void;
  reset: () => void;
}

const initial = { status: "off" as RtStatus, since: 0, deniedCode: null as string | null, reconcileTick: 0, catchUp: {} as Record<string, number>, typing: {} as TypingMap, pulse: null as RtState["pulse"] };

export const useRt = create<RtState>((set, get) => ({
  ...initial,
  setStatus: (status, deniedCode = null) => {
    const prev = get();
    if (prev.status === status && prev.deniedCode === deniedCode) return;
    set({ status, deniedCode, since: status === "connected" ? 0 : prev.status === "connected" || prev.since === 0 ? Date.now() : prev.since });
  },
  bumpReconcile: () => set((s) => ({ reconcileTick: s.reconcileTick + 1 })),
  requestCatchUp: (id) => set((s) => ({ catchUp: { ...s.catchUp, [id]: (s.catchUp[id] ?? 0) + 1 } })),
  applyTyping: (e, myId, ttlMs) => {
    const next = typingWith(get().typing, e, Date.now(), ttlMs, myId);
    if (next !== get().typing) set({ typing: next });
  },
  expireTyping: () => {
    const next = typingExpire(get().typing, Date.now());
    if (next !== get().typing) set({ typing: next });
  },
  firePulse: (conversationId, type, senderId, kind = "text") => set((s) => ({ pulse: { nonce: (s.pulse?.nonce ?? 0) + 1, conversationId, type, senderId, kind } })),
  reset: () => set({ ...initial }),
}));
