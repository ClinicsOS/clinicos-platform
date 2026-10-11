"use client";
// CLINICOS CONNECT (C3) — mounts ONE realtime connection for the signed-in user (from the dashboard layout, only when the plan/role
// may use Connect) and turns the server's events into React Query cache updates. The Messages screen and the navigation badge then
// update without a refresh, on every page. Nothing here is authoritative: every handler is idempotent (merge by server id), and
// every reconnect / long absence reconciles over the C1 HTTP API.
import { useCallback, useEffect, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { connectKeys } from "../keys";
import { applyRealtimeMessage } from "../messageStore";
import type { ConversationList, ConversationSummary, ThreadState, UnreadSummary } from "../types";
import { RT_CLIENT, RT_EVENTS } from "./config";
import {
  listWithMessage,
  listWithReadPeer,
  listWithReadSelf,
  messageFromEvent,
  parseMessageEvent,
  parseReadPeer,
  parseReadSelf,
  parseTyping,
  unreadFromList,
  unreadWithConversation,
  withTotals,
  sortConversations,
} from "./events";
import { isSending } from "./inflight";
import { ConnectSocket } from "./socket";
import { useRt } from "./store";

let current: ConnectSocket | null = null;

/** Safe no-ops when there is no connection (realtime off, not entitled, offline): everything still works over HTTP. */
export const rtSubscribe = (conversationId: string) => current?.subscribe(conversationId);
export const rtUnsubscribe = (conversationId: string) => current?.unsubscribe(conversationId);
export const rtTyping = (conversationId: string, typing: boolean) => current?.typing(conversationId, typing);

/** One HTTP reconciliation of everything the screens show. Only ACTIVE queries refetch (React Query), so this is as cheap as the open screens. */
export function reconcile(qc: QueryClient, uid: string) {
  void qc.invalidateQueries({ queryKey: connectKeys.list(uid) });
  void qc.invalidateQueries({ queryKey: connectKeys.unread(uid) });
  useRt.getState().bumpReconcile(); // open conversation(s) catch up with `after=<last cursor>`
}

export function ConnectRealtime({ enabled }: { enabled: boolean }) {
  const qc = useQueryClient();
  const hasToken = useAuth((s) => !!s.token);
  const uid = useAuth((s) => s.user?.id) ?? "";
  const fetching = useRef(new Set<string>());
  const lastPulse = useRef(0);

  /** A message in a conversation my list does not have yet (first message of a new DM): ask C1 for its summary (membership is decided there). */
  const fetchConversation = useCallback(
    async (id: string) => {
      if (fetching.current.has(id)) return;
      fetching.current.add(id);
      try {
        const conv = (await api.get<{ conversation: ConversationSummary }>(`/connect/conversations/${id}`)).data.conversation;
        qc.setQueryData<ConversationList>(connectKeys.list(uid), (prev) => {
          if (!prev || prev.conversations.some((c) => c.id === conv.id)) return prev;
          return withTotals(sortConversations(prev.conversations.concat(conv)));
        });
        qc.setQueryData<UnreadSummary>(connectKeys.unread(uid), (prev) => (prev ? unreadWithConversation(prev, conv.id, conv.unreadCount) : prev));
      } catch {
        void qc.invalidateQueries({ queryKey: connectKeys.list(uid) }); // fall back to the full list
      } finally {
        fetching.current.delete(id);
      }
    },
    [qc, uid],
  );

  useEffect(() => {
    if (!enabled || !hasToken || !uid) return;
    const rt = useRt.getState();
    rt.reset();

    const onMessage = (raw: unknown) => {
      const e = parseMessageEvent(raw);
      if (!e) return;
      const convId = e.conversation.id;
      const msg = messageFromEvent(e);

      // 1) the open / cached conversation: merge by server id (never append blindly)
      const tkey = connectKeys.thread(uid, convId);
      const thread = qc.getQueryData<ThreadState>(tkey);
      if (thread) {
        const r = applyRealtimeMessage(thread, msg, { myId: uid, sending: isSending(convId) });
        if (r.thread !== thread) qc.setQueryData(tkey, r.thread);
        if (r.gap) useRt.getState().requestCatchUp(convId); // an event was missed before this one: HTTP fetches everything after our cursor
      }

      // 2) the conversation list (preview, time, order, unread)…
      const listKey = connectKeys.list(uid);
      const list = qc.getQueryData<ConversationList>(listKey);
      if (list) {
        const r = listWithMessage(list, e, uid);
        if (r.list !== list) {
          qc.setQueryData(listKey, r.list);
          qc.setQueryData<UnreadSummary>(connectKeys.unread(uid), unreadFromList(r.list.conversations));
        }
        if (r.unknown) void fetchConversation(convId);
      } else {
        // …or just the navigation badge when the list was never opened on this page
        qc.setQueryData<UnreadSummary>(connectKeys.unread(uid), (prev) => (prev ? unreadWithConversation(prev, convId, e.unreadCount) : prev));
      }

      // 3) a subtle 3D pulse for somebody else's message, at most once per pulseMinGapMs (no notification storm)
      if (msg.senderId !== uid && Date.now() - lastPulse.current >= RT_CLIENT.pulseMinGapMs) {
        lastPulse.current = Date.now();
        useRt.getState().firePulse(convId, e.conversation.type, msg.senderId, msg.contentType === "appointment_reference" ? "appointment" : msg.contentType === "patient_reference" ? "patient" : "text");
      }
    };

    const onReadSelf = (raw: unknown) => {
      const e = parseReadSelf(raw);
      if (!e) return;
      const listKey = connectKeys.list(uid);
      const list = qc.getQueryData<ConversationList>(listKey);
      if (list) {
        const next = listWithReadSelf(list, e);
        if (next !== list) {
          qc.setQueryData(listKey, next);
          qc.setQueryData<UnreadSummary>(connectKeys.unread(uid), unreadFromList(next.conversations));
        }
      } else qc.setQueryData<UnreadSummary>(connectKeys.unread(uid), (prev) => (prev ? unreadWithConversation(prev, e.conversationId, e.unreadCount) : prev));
    };

    const onReadPeer = (raw: unknown) => {
      const e = parseReadPeer(raw);
      if (!e) return;
      qc.setQueryData<ConversationList>(connectKeys.list(uid), (prev) => (prev ? listWithReadPeer(prev, e) : prev));
    };

    const sock = new ConnectSocket({
      getToken: () => useAuth.getState().token,
      // any HTTP answer (even a refusal) proves the API is reachable; only a network-level failure does not
      probe: () =>
        api
          .get("/connect/unread-count")
          .then(() => true)
          .catch((e: { response?: unknown }) => !!e?.response),
      onStatus: (s, code) => useRt.getState().setStatus(s, code ?? null),
      onEvent: (name, payload) => {
        if (name === RT_EVENTS.messageNew) onMessage(payload);
        else if (name === RT_EVENTS.readSelf) onReadSelf(payload);
        else if (name === RT_EVENTS.readPeer) onReadPeer(payload);
        else if (name === RT_EVENTS.typing) {
          const e = parseTyping(payload);
          if (e) useRt.getState().applyTyping(e, uid, RT_CLIENT.typingTtlMs);
        }
      },
      onConnected: () => {
        // first connect too: between the page's first HTTP load and the socket being up an event could have been missed
        reconcile(qc, uid);
      },
      onForeground: () => reconcile(qc, uid),
    });
    current = sock;
    sock.start();
    const sweep = window.setInterval(() => useRt.getState().expireTyping(), 1000);

    return () => {
      window.clearInterval(sweep);
      sock.stop();
      if (current === sock) current = null;
      useRt.getState().reset();
    };
  }, [enabled, hasToken, uid, qc, fetchConversation]);

  // a denial ends the session politely: the HTTP layer is asked once, so the Messages screen shows the right locked state / sign-in
  const denied = useRt((s) => s.deniedCode);
  useEffect(() => {
    if (denied && uid) {
      void qc.invalidateQueries({ queryKey: connectKeys.list(uid) });
      void qc.invalidateQueries({ queryKey: connectKeys.unread(uid) });
    }
  }, [denied, uid, qc]);

  return null;
}
