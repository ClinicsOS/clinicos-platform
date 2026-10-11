"use client";
// CLINICOS CONNECT (C3) — optional, ephemeral "is typing…". Sending side: at most one signal per typingSendMs while the box has text, and an
// explicit "stopped" when it empties / the message is sent / the box loses focus / the screen is left. Receiving side: names that expire by
// themselves (RT_CLIENT.typingTtlMs). The server never stores any of it and only relays it to authorised participants of that conversation.
import { useCallback, useEffect, useRef } from "react";
import { RT_CLIENT } from "./config";
import { useRt } from "./store";
import { rtTyping } from "./provider";

export function useTypingSignal(conversationId: string, enabled: boolean) {
  const lastSent = useRef(0);
  const active = useRef(false);

  const stop = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    lastSent.current = 0;
    rtTyping(conversationId, false);
  }, [conversationId]);

  /** Call on every input change with the current text. */
  const notify = useCallback(
    (text: string) => {
      if (!enabled) return;
      if (text.trim().length === 0) return stop();
      const now = Date.now();
      if (active.current && now - lastSent.current < RT_CLIENT.typingSendMs) return; // throttled
      active.current = true;
      lastSent.current = now;
      rtTyping(conversationId, true);
    },
    [conversationId, enabled, stop],
  );

  useEffect(() => stop, [stop]); // leaving the conversation = stopped typing
  return { notify, stop };
}

const NONE: Record<string, { name: string; until: number }> = {};

/** Names currently typing in this conversation (never includes me — the store drops my own echo). */
export function useTypingNames(conversationId: string): string[] {
  const m = useRt((s) => s.typing[conversationId]) ?? NONE;
  return Object.keys(m).map((k) => m[k].name);
}
