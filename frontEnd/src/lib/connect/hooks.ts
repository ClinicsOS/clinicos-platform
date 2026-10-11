"use client";
// CLINICOS CONNECT (C2) — data layer: React Query for the lists, a small cache-backed store for each open conversation.
// Every request goes to the real C1 API (/api/connect/*) through the shared axios instance (Bearer token, 401 handling).
// Query keys carry the signed-in user's id, so a different account on the same browser never sees another account's cache.
import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { POLL } from "./config";
import { connectKeys } from "./keys";
import { RT_POLL } from "./realtime/config";
import { markSending } from "./realtime/inflight";
import { useRt } from "./realtime/store";
import { classifyError, isUncertain, type ConnectErrorKind } from "./errors";
import { checkDraft } from "./text";
import { CARDS_BATCH, chunk, mergeCards, parseCards, refMessageIds } from "./cards";
import {
  addPending,
  applyInitial,
  applyNewer,
  applyOlder,
  applySent,
  EMPTY_THREAD,
  findDeliveredTwin,
  latestFromOthers,
  patchPending,
  removePending,
  seqOf,
  mergeMessages,
} from "./messageStore";
import type {
  AppointmentPickerPage,
  ApptGroup,
  CardMap,
  CardView,
  ConversationList,
  ConversationSummary,
  MessageDto,
  MessagePage,
  PatientPickerPage,
  PendingMessage,
  RefInput,
  StaffPerson,
  ThreadState,
  UnreadSummary,
} from "./types";

export { connectKeys };

/** Errors after which asking again is pointless (the server said no): stop polling and show the matching state. */
const TERMINAL: ConnectErrorKind[] = ["plan", "suspended", "forbidden", "gone"];
const isTerminal = (k: ConnectErrorKind) => TERMINAL.includes(k);

const useUid = () => useAuth((s) => s.user?.id) ?? "";

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(!document.hidden);
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

const backoff = (base: number, failures: number) => Math.min(base * 2 ** Math.min(failures, 6), POLL.maxBackoffMs);
/**
 * C3: while the realtime socket is connected the polling loops only exist as slow safety nets (RT_POLL); the moment it is not connected
 * (blocked WebSockets, outage, reconnecting) the C2 intervals apply again — evaluated on every cycle, so the switch is automatic.
 */
const liveMs = (fast: number, slow: number) => (useRt.getState().status === "connected" ? slow : fast);
const retryOnce = (count: number, e: unknown) => count < 1 && !isTerminal(classifyError(e).kind) && classifyError(e).kind !== "validation";

/* ------------------------------------------------------------------ sidebar badge */
/** Total unread for the navigation badge. Polls slowly (and only while the tab is visible — React Query's default). */
export function useConnectUnread(enabled: boolean, intervalMs: number = POLL.badgeMs) {
  const uid = useUid();
  const token = useAuth((s) => s.token);
  const q = useQuery({
    queryKey: connectKeys.unread(uid),
    queryFn: async () => (await api.get<UnreadSummary>("/connect/unread-count")).data,
    enabled: enabled && !!token && !!uid,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.error && isTerminal(classifyError(query.state.error).kind) ? false : backoff(liveMs(intervalMs, Math.max(intervalMs, RT_POLL.badgeMs)), query.state.errorUpdateCount)),
    retry: retryOnce,
  });
  return { total: q.data?.total ?? 0, byConversation: q.data?.conversations ?? [], error: q.error ? classifyError(q.error).kind : null };
}

/* ------------------------------------------------------------------ conversation list */
export function useConversations(enabled: boolean) {
  const uid = useUid();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: connectKeys.list(uid),
    queryFn: async () => {
      const data = (await api.get<ConversationList>("/connect/conversations")).data;
      // the list already carries every unread count: keep the sidebar badge in step without a second request
      qc.setQueryData<UnreadSummary>(connectKeys.unread(uid), {
        total: data.totalUnread,
        conversations: data.conversations.filter((c) => c.unreadCount > 0).map((c) => ({ conversationId: c.id, unreadCount: c.unreadCount })),
      });
      return data;
    },
    enabled: enabled && !!uid,
    staleTime: 5_000,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => (query.state.error && isTerminal(classifyError(query.state.error).kind) ? false : backoff(liveMs(POLL.listMs, RT_POLL.listMs), query.state.errorUpdateCount)),
    retry: retryOnce,
  });
  return {
    conversations: q.data?.conversations ?? [],
    loaded: !!q.data,
    loading: q.isLoading,
    error: q.error ? classifyError(q.error) : null,
    refetch: q.refetch,
  };
}

function patchList(qc: QueryClient, uid: string, fn: (list: ConversationSummary[]) => ConversationSummary[]) {
  qc.setQueryData<ConversationList>(connectKeys.list(uid), (prev) => {
    if (!prev) return prev;
    const conversations = fn(prev.conversations);
    return { conversations, totalUnread: conversations.reduce((n, c) => n + c.unreadCount, 0) };
  });
}

/* ------------------------------------------------------------------ New Message (eligible colleagues) */
/**
 * Colleagues you may message: the clinic's staff list (GET /users — every role may read names/roles/status), narrowed to ACTIVE people other
 * than you. Only id / name / role are kept — nothing else from that response (it can contain e-mail for owners) ever reaches the UI.
 * This is a convenience list: C1 still validates the chosen person (same clinic, active) when the conversation is opened.
 */
export function useEligibleStaff(enabled: boolean) {
  const uid = useUid();
  const q = useQuery({
    queryKey: connectKeys.staff(uid),
    queryFn: async (): Promise<StaffPerson[]> => {
      const rows = (await api.get<{ _id: string; name: string; role: string; isActive?: boolean }[]>("/users")).data;
      return rows
        .filter((u) => u.isActive !== false && u._id !== uid)
        .map((u) => ({ id: u._id, name: u.name, role: u.role }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: enabled && !!uid,
    staleTime: 30_000,
    retry: 1,
  });
  return { staff: q.data ?? [], loading: q.isLoading, error: q.error ? classifyError(q.error) : null, refetch: q.refetch };
}

/** POST /connect/conversations/direct — find-or-create the private conversation with a colleague (C1 guarantees one per pair). */
export function useOpenDirect() {
  const uid = useUid();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (userId: string) =>
      (await api.post<{ conversation: ConversationSummary }>("/connect/conversations/direct", { userId })).data.conversation,
    onSuccess: (conv) => {
      patchList(qc, uid, (list) => (list.some((c) => c.id === conv.id) ? list.map((c) => (c.id === conv.id ? { ...c, ...conv } : c)) : [list[0], conv, ...list.slice(1)].filter(Boolean)));
      qc.invalidateQueries({ queryKey: connectKeys.list(uid) });
    },
  });
}

/* ------------------------------------------------------------------ mark read */
export function useMarkRead() {
  const uid = useUid();
  const qc = useQueryClient();
  const marked = useRef(new Map<string, string>()); // conversationId → last message id we marked read
  return useCallback(
    async (conversationId: string, upToMessageId: string) => {
      if (marked.current.get(conversationId) === upToMessageId) return;
      marked.current.set(conversationId, upToMessageId); // optimistic guard against double posts; undone on failure
      try {
        const r = await api.post<{ unreadCount: number }>(`/connect/conversations/${conversationId}/read`, { upToMessageId });
        const left = r.data.unreadCount;
        patchList(qc, uid, (list) => list.map((c) => (c.id === conversationId ? { ...c, unreadCount: left } : c)));
        qc.setQueryData<UnreadSummary>(connectKeys.unread(uid), (prev) => {
          if (!prev) return prev;
          const rows = prev.conversations.filter((x) => x.conversationId !== conversationId).concat(left > 0 ? [{ conversationId, unreadCount: left }] : []);
          return { total: rows.reduce((n, x) => n + x.unreadCount, 0), conversations: rows };
        });
        // C2 re-asked the server here; with a live socket the answer above is already authoritative (and read:self confirms it)
        if (useRt.getState().status !== "connected") qc.invalidateQueries({ queryKey: connectKeys.unread(uid) });
      } catch {
        marked.current.delete(conversationId); // try again on the next opportunity
      }
    },
    [qc, uid],
  );
}

/* ------------------------------------------------------------------ one conversation */
const newClientId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export interface UseThread {
  thread: ThreadState | undefined;
  loading: boolean;
  /** Set when the server will not serve this conversation (no longer accessible / plan / suspended), or the first load failed. */
  blocked: ConnectErrorKind | null;
  loadingOlder: boolean;
  loadOlder: () => Promise<number>;
  send: (rawText: string) => { ok: true } | { ok: false; reason: "empty" | "tooLong" };
  /** C4: share an appointment / patient as a card, with an optional note. `card` = what the sender just saw (shown until the server confirms). */
  sendReference: (ref: RefInput, rawNote: string, card: CardView) => { ok: true } | { ok: false; reason: "tooLong" };
  retry: (clientId: string) => void;
  discard: (clientId: string) => void;
  reload: () => void;
  /** Newest message written by someone else (for the "New messages" logic). */
  latestOther: MessageDto | undefined;
}

/**
 * The open conversation. `active` = this is the conversation being shown (and the tab is visible) — polling runs only then.
 * One polling loop per mounted hook; it is torn down when the conversation changes, the component unmounts or the tab hides.
 */
export function useThread(conversationId: string | null, myId: string): UseThread {
  const uid = useUid();
  const qc = useQueryClient();
  const visible = usePageVisible();
  const key = connectKeys.thread(uid, conversationId ?? "none");
  const [blocked, setBlocked] = useState<ConnectErrorKind | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const sendingCount = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const olderBusy = useRef(false);
  const pollBusy = useRef(false);
  // C3: wake-ups from the realtime layer — a reconnect / foreground return (reconcileTick) or a message that arrived with a gap before it (catchUp)
  const reconcileTick = useRt((s) => s.reconcileTick);
  const catchUpTick = useRt((s) => (conversationId ? s.catchUp[conversationId] ?? 0 : 0));
  const wake = useRef<() => void>(() => undefined);

  useEffect(() => setBlocked(null), [conversationId]);

  const set = useCallback((fn: (prev: ThreadState) => ThreadState) => qc.setQueryData<ThreadState>(key, (prev) => fn(prev ?? EMPTY_THREAD)), [qc, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const get = useCallback(() => qc.getQueryData<ThreadState>(key), [qc, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchPage = useCallback(
    async (params: Record<string, string | number>) =>
      (await api.get<MessagePage>(`/connect/conversations/${conversationId}/messages`, { params: { limit: POLL.pageSize, ...params } })).data,
    [conversationId],
  );

  const q = useQuery({
    queryKey: key,
    enabled: !!conversationId && !!uid,
    queryFn: async () => applyInitial(qc.getQueryData<ThreadState>(key), await fetchPage({})),
    staleTime: Infinity, // after the first load, freshness comes from the catch-up poll below
    gcTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: retryOnce,
  });

  useEffect(() => {
    if (q.error) {
      const k = classifyError(q.error).kind;
      setBlocked(isTerminal(k) ? k : "server");
    }
  }, [q.error]);

  /** Fetch what is newer than the newest message we hold. Returns how many messages came from other people. */
  const syncNewer = useCallback(async (): Promise<number> => {
    let fromOthers = 0;
    for (let page = 0; page < 5; page++) {
      const cur = get();
      if (!cur) return fromOthers;
      const data = await fetchPage(cur.newerCursor ? { after: cur.newerCursor } : {});
      if (!cur.newerCursor) {
        // the conversation was empty when we loaded it: take the newest page as the first page
        if (data.messages.length) set((p) => applyInitial(p, data));
        fromOthers += data.messages.filter((m) => m.senderId !== myId).length;
        return fromOthers;
      }
      fromOthers += data.messages.filter((m) => m.senderId !== myId && !cur.messages.some((x) => x.id === m.id)).length;
      set((p) => applyNewer(p, data));
      if (!data.pageInfo.hasMoreNewer) return fromOthers;
    }
    // more than 5 pages behind: start over from the newest page instead of walking the whole gap
    set((p) => applyInitial({ ...p, pending: p.pending }, { messages: [], pageInfo: { hasMoreOlder: false, hasMoreNewer: false, olderCursor: null, newerCursor: null } }));
    await qc.invalidateQueries({ queryKey: key });
    return fromOthers;
  }, [get, set, fetchPage, myId, qc, key]);

  const loaded = !!q.data;
  useEffect(() => {
    if (!conversationId || !loaded || !visible || blocked) return;
    let stopped = false;
    let timer: number | undefined;
    let failures = 0;
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, ms);
    };
    async function tick() {
      if (stopped || document.hidden) return;
      if (pollBusy.current || sendingCount.current > 0) return schedule(POLL.threadMs); // never overlap, never race our own send
      pollBusy.current = true;
      try {
        const others = await syncNewer();
        failures = 0;
        if (others > 0 && !stopped) qc.invalidateQueries({ queryKey: connectKeys.list(uid) });
      } catch (e) {
        const k = classifyError(e).kind;
        if (isTerminal(k)) {
          if (!stopped) setBlocked(k);
          return;
        }
        failures++;
      } finally {
        pollBusy.current = false;
      }
      if (!stopped) schedule(backoff(liveMs(POLL.threadMs, RT_POLL.threadMs), failures));
    }
    wake.current = () => schedule(0);
    const onOnline = () => schedule(0);
    window.addEventListener("online", onOnline);
    schedule(400); // quick catch-up when a conversation is opened (also covers re-opening a cached one)
    return () => {
      wake.current = () => undefined;
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [conversationId, loaded, visible, blocked, syncNewer, qc, uid]);

  const firstWake = useRef(true);
  useEffect(() => {
    if (firstWake.current) {
      firstWake.current = false; // the initial value is not an event
      return;
    }
    wake.current();
  }, [reconcileTick, catchUpTick]);

  const loadOlder = useCallback(async (): Promise<number> => {
    const cur = get();
    if (!cur || !cur.hasMoreOlder || !cur.olderCursor || olderBusy.current) return 0;
    olderBusy.current = true;
    setLoadingOlder(true);
    try {
      const data = await fetchPage({ before: cur.olderCursor });
      set((p) => applyOlder(p, data));
      return data.messages.length;
    } catch (e) {
      if (isTerminal(classifyError(e).kind)) setBlocked(classifyError(e).kind);
      return 0;
    } finally {
      olderBusy.current = false;
      setLoadingOlder(false);
    }
  }, [get, set, fetchPage]);

  const deliver = useCallback(
    async (p: PendingMessage) => {
      // Browser knows it is offline: nothing is sent and nothing is queued. The message stays visible as "not sent" with Retry/Remove,
      // and since the request never left this device a retry cannot create a duplicate (uncertain: false).
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        set((prev) => patchPending(prev, p.clientId, { status: "failed", uncertain: false, code: "OFFLINE" }));
        return;
      }
      sendingCount.current++;
      markSending(p.conversationId, 1);
      try {
        const r = await api.post<{ message: MessageDto }>(`/connect/conversations/${p.conversationId}/messages`, p.reference ? { ...(p.text ? { text: p.text } : {}), reference: p.reference } : { text: p.text });
        set((prev) => applySent(prev, p.clientId, r.data.message));
        // C4: the sender's own card is already on screen; keep it (no skeleton flash) under the confirmed id. Re-validated like every card.
        if (p.card) {
          const ckey = connectKeys.cards(uid, useAuth.getState().user?.role ?? "", p.conversationId);
          qc.setQueryData<CardMap>(ckey, (prev) => ({ ...(prev ?? {}), [r.data.message.id]: { ...p.card!, messageId: r.data.message.id } as CardView }));
        }
        qc.invalidateQueries({ queryKey: connectKeys.list(uid) });
      } catch (e) {
        const c = classifyError(e);
        set((prev) => patchPending(prev, p.clientId, { status: "failed", uncertain: isUncertain(e), code: c.code }));
        if (isTerminal(c.kind)) setBlocked(c.kind);
      } finally {
        sendingCount.current--;
        markSending(p.conversationId, -1);
      }
    },
    [set, qc, uid],
  );

  /** Sends are serialised so that two quick messages reach the server — and every colleague — in the order they were typed. */
  const enqueue = useCallback(
    (p: PendingMessage) => {
      chain.current = chain.current.then(() => deliver(p));
    },
    [deliver],
  );

  const send = useCallback<UseThread["send"]>(
    (rawText) => {
      if (!conversationId) return { ok: false, reason: "empty" };
      const check = checkDraft(rawText);
      if (!check.ok) return check;
      const p: PendingMessage = { clientId: newClientId(), conversationId, text: check.text, createdAt: new Date().toISOString(), status: "sending" };
      set((prev) => addPending(prev, p));
      enqueue(p);
      return { ok: true };
    },
    [conversationId, set, enqueue],
  );

  const sendReference = useCallback<UseThread["sendReference"]>(
    (ref, rawNote, card) => {
      if (!conversationId) return { ok: false, reason: "tooLong" };
      let note = "";
      if (rawNote.trim()) {
        const check = checkDraft(rawNote);
        if (check.ok) note = check.text;
        else if (check.reason === "tooLong") return { ok: false, reason: "tooLong" };
      }
      const p: PendingMessage = { clientId: newClientId(), conversationId, text: note, reference: ref, card, createdAt: new Date().toISOString(), status: "sending" };
      set((prev) => addPending(prev, p));
      enqueue(p);
      return { ok: true };
    },
    [conversationId, set, enqueue],
  );

  const retry = useCallback(
    (clientId: string) => {
      const p = get()?.pending.find((x) => x.clientId === clientId);
      if (!p || p.status !== "failed") return;
      set((prev) => patchPending(prev, clientId, { status: "sending", code: undefined }));
      const again = { ...p, status: "sending" as const };
      chain.current = chain.current.then(async () => {
        if (p.uncertain) {
          // The first attempt got no answer: it may have been stored. Look before sending a second copy.
          try {
            const cur = get();
            const data = await fetchPage(cur?.newerCursor ? { after: cur.newerCursor } : {});
            // The catch-up poll may already have brought the stored copy in, so look at what we hold as well as at what is newer.
            const twin = findDeliveredTwin(p, (cur?.messages ?? []).concat(data.messages), myId);
            if (twin) {
              set((prev) => removePending(applyNewer(prev, data), clientId));
              return;
            }
            set((prev) => applyNewer(prev, data));
          } catch (e) {
            const c = classifyError(e);
            set((prev) => patchPending(prev, clientId, { status: "failed", uncertain: true, code: c.code }));
            return;
          }
        }
        await deliver(again);
      });
    },
    [get, set, fetchPage, deliver, myId],
  );

  const discard = useCallback((clientId: string) => set((prev) => removePending(prev, clientId)), [set]);
  const reload = useCallback(() => {
    setBlocked(null);
    qc.invalidateQueries({ queryKey: key });
  }, [qc, key]);

  const thread = q.data;
  return {
    thread,
    loading: q.isLoading,
    blocked,
    loadingOlder,
    loadOlder,
    send,
    sendReference,
    retry,
    discard,
    reload,
    latestOther: thread ? latestFromOthers(thread, myId) : undefined,
  };
}

/* ------------------------------------------------------------------ C4: cards */
const useRole = () => useAuth((s) => s.user?.role) ?? "";

/**
 * The cards of the reference messages in a conversation, for THIS signed-in user, right now. One request per batch of up to 100 messages
 * (never one per card). Cached under a user- and role-scoped key; a cached card is shown immediately but is re-asked once per visit and
 * after every reconnect, so a permission that changed meanwhile is reflected (the server decides on every request).
 */
export function useCards(conversationId: string, messages: MessageDto[]) {
  const uid = useUid();
  const role = useRole();
  const qc = useQueryClient();
  const key = connectKeys.cards(uid, role, conversationId);
  const { data } = useQuery<CardMap>({
    queryKey: key,
    queryFn: async () => qc.getQueryData<CardMap>(key) ?? {},
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    enabled: !!uid && !!conversationId,
  });
  const ids = refMessageIds(messages);
  const idsKey = ids.join(",");
  const reconcileTick = useRt((s) => s.reconcileTick);
  const validated = useRef(new Set<string>());
  const inflight = useRef(new Set<string>());
  const [failed, setFailed] = useState<Record<string, true>>({});
  const [retryTick, setRetryTick] = useState(0);
  const byId = useRef(new Map<string, MessageDto>());
  messages.forEach((m) => byId.current.set(m.id, m));

  // a new visit to this conversation / a different user: nothing counts as validated yet
  useEffect(() => {
    validated.current = new Set();
    inflight.current = new Set();
    setFailed({});
  }, [conversationId, uid, role]);
  // reconnect / foreground return: ask again (permissions or records may have changed)
  const firstTick = useRef(true);
  useEffect(() => {
    if (firstTick.current) {
      firstTick.current = false;
      return;
    }
    validated.current = new Set();
  }, [reconcileTick]);

  useEffect(() => {
    if (!uid || !conversationId) return;
    const need = ids.filter((id) => !validated.current.has(id) && !inflight.current.has(id));
    if (!need.length) return;
    need.forEach((id) => inflight.current.add(id));
    let cancelled = false;
    (async () => {
      for (const part of chunk(need, CARDS_BATCH)) {
        try {
          const r = await api.post(`/connect/conversations/${conversationId}/cards`, { messageIds: part });
          const asked = part.map((id) => byId.current.get(id)).filter((m): m is MessageDto => !!m);
          qc.setQueryData<CardMap>(key, (prev) => mergeCards(prev ?? {}, asked, parseCards(r.data)));
          part.forEach((id) => validated.current.add(id));
          if (!cancelled) setFailed((f) => { const n = { ...f }; part.forEach((id) => delete n[id]); return n; });
        } catch (e) {
          if (!cancelled) setFailed((f) => { const n = { ...f }; part.forEach((id) => (n[id] = true)); return n; });
          // a refusal that ends the conversation is shown by the thread itself; here the card just offers "try again"
          void e;
        } finally {
          part.forEach((id) => inflight.current.delete(id));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, conversationId, uid, role, reconcileTick, retryTick]);

  const retry = useCallback(() => {
    setFailed({});
    setRetryTick((n) => n + 1);
  }, []);
  return { cards: data ?? {}, failed, retry };
}

/* ------------------------------------------------------------------ C4: pickers (Share → Patient / Appointment) */
const useDebounced = (value: string, ms = 250) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
};

/** 20 patients per page from the dedicated, permission-scoped endpoint (id, name, file number only). */
export function usePatientPicker(q: string, enabled: boolean) {
  const uid = useUid();
  const role = useRole();
  const dq = useDebounced(q.trim());
  const query = useInfiniteQuery({
    queryKey: connectKeys.pickPatients(uid, role, dq),
    queryFn: async ({ pageParam }) => (await api.get<PatientPickerPage>("/connect/pickers/patients", { params: { q: dq || undefined, page: pageParam } })).data,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: enabled && !!uid,
    staleTime: 15_000,
    gcTime: 60_000,
    retry: 1,
  });
  return { rows: (query.data?.pages ?? []).flatMap((p) => p.patients), pending: q.trim() !== dq || query.isLoading, error: !!query.error, hasMore: !!query.hasNextPage, loadingMore: query.isFetchingNextPage, loadMore: () => void query.fetchNextPage(), refetch: () => void query.refetch() };
}

export function useAppointmentPicker(group: ApptGroup, q: string, enabled: boolean) {
  const uid = useUid();
  const role = useRole();
  const dq = useDebounced(q.trim());
  const query = useInfiniteQuery({
    queryKey: connectKeys.pickAppts(uid, role, group, dq),
    queryFn: async ({ pageParam }) => (await api.get<AppointmentPickerPage>("/connect/pickers/appointments", { params: { group, q: dq || undefined, page: pageParam } })).data,
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: enabled && !!uid,
    staleTime: 15_000,
    gcTime: 60_000,
    retry: 1,
  });
  return { rows: (query.data?.pages ?? []).flatMap((p) => p.appointments), pending: q.trim() !== dq || query.isLoading, error: !!query.error, hasMore: !!query.hasNextPage, loadingMore: query.isFetchingNextPage, loadMore: () => void query.fetchNextPage(), refetch: () => void query.refetch() };
}

export { seqOf, mergeMessages };
