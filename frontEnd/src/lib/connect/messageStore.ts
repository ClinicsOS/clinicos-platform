// CLINICOS CONNECT (C2) — pure message-list logic (no React, no network): merging pages, de-duplicating, pending messages.
// Kept dependency-free so it is unit-tested directly under node:test.
import type { MessageDto, MessagePage, PendingMessage, ThreadState } from "./types";

export const EMPTY_THREAD: ThreadState = { messages: [], hasMoreOlder: false, olderCursor: null, newerCursor: null, pending: [] };

/** The sequence number inside an opaque cursor ("v1:<seq>" as base64url). 0 when it cannot be read. */
export function seqOf(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const m = /^v1:(\d{1,12})$/.exec(atob(padded));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

/** Union by message id, ordered by sequence (oldest → newest). A message already present is kept as is. */
export function mergeMessages(existing: MessageDto[], incoming: MessageDto[]): MessageDto[] {
  if (!incoming.length) return existing;
  const byId = new Map<string, MessageDto>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) if (!byId.has(m.id)) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => seqOf(a.cursor) - seqOf(b.cursor));
}

/** First load: the newest page replaces nothing that was typed locally (pending is kept). */
export function applyInitial(prev: ThreadState | undefined, page: MessagePage): ThreadState {
  return {
    messages: mergeMessages([], page.messages),
    hasMoreOlder: page.pageInfo.hasMoreOlder,
    olderCursor: page.pageInfo.olderCursor,
    newerCursor: page.pageInfo.newerCursor,
    pending: prev?.pending ?? [],
  };
}

/** An older page (scroll up). Updates only the "older" side. */
export function applyOlder(prev: ThreadState, page: MessagePage): ThreadState {
  return {
    ...prev,
    messages: mergeMessages(prev.messages, page.messages),
    hasMoreOlder: page.pageInfo.hasMoreOlder,
    olderCursor: page.pageInfo.olderCursor ?? prev.olderCursor,
  };
}

/** Messages that arrived since `newerCursor` (polling / catch-up). Never moves the cursor backwards. */
export function applyNewer(prev: ThreadState, page: MessagePage): ThreadState {
  if (!page.messages.length) return prev;
  const messages = mergeMessages(prev.messages, page.messages);
  const next = page.pageInfo.newerCursor;
  return { ...prev, messages, newerCursor: next && seqOf(next) >= seqOf(prev.newerCursor) ? next : prev.newerCursor };
}

/**
 * A confirmed message from POST (our own send): merge it, drop its pending twin.
 * The "newer" cursor only moves when the message is the NEXT one in sequence. If somebody else wrote in between (their message is not
 * on screen yet), moving it to our own seq would make the catch-up skip theirs for ever — so it stays, and the next catch-up fetches
 * both (the merge is by id, so ours is not duplicated).
 */
export function applySent(prev: ThreadState, clientId: string, message: MessageDto): ThreadState {
  const messages = mergeMessages(prev.messages, [message]);
  const have = seqOf(prev.newerCursor);
  const seq = seqOf(message.cursor);
  const newer = seq === have + 1 || (have === 0 && prev.messages.length === 0 && seq === 1) ? message.cursor : prev.newerCursor;
  return { ...prev, messages, newerCursor: newer, pending: prev.pending.filter((p) => p.clientId !== clientId) };
}

/**
 * A message pushed by the realtime layer (C3). Returns the new thread and whether a CATCH-UP over HTTP is needed.
 *   - already on screen (same server id)             → nothing changes (the HTTP answer / an earlier event won)
 *   - my own message while one of my sends is in flight → ignored: the HTTP response is canonical and carries the same id
 *   - the next message in sequence                    → appended, cursor advances
 *   - older than what we hold                         → merged by id (cursor untouched)
 *   - a gap (an event was missed)                     → NOT inserted (it would hide the gap); the caller asks HTTP for everything after our cursor
 * A message of mine that arrives from my other tab also resolves a failed-but-maybe-stored pending twin of this tab.
 */
export function applyRealtimeMessage(
  prev: ThreadState,
  message: MessageDto,
  opts: { myId: string; sending: boolean },
): { thread: ThreadState; gap: boolean } {
  if (prev.messages.some((m) => m.id === message.id)) return { thread: prev, gap: false };
  const mine = message.senderId === opts.myId;
  if (mine && opts.sending) return { thread: prev, gap: false };
  const have = seqOf(prev.newerCursor);
  const seq = seqOf(message.cursor);
  let pending = prev.pending;
  if (mine) {
    const twin = pending.find((p) => p.status === "failed" && p.uncertain && findDeliveredTwin(p, [message], opts.myId));
    if (twin) pending = pending.filter((p) => p.clientId !== twin.clientId);
  }
  if (seq === 0) return { thread: prev, gap: true };
  if (seq <= have) return { thread: { ...prev, messages: mergeMessages(prev.messages, [message]), pending }, gap: false };
  const contiguous = seq === have + 1 || (have === 0 && prev.messages.length === 0 && seq === 1);
  if (!contiguous) return { thread: prev, gap: true };
  return { thread: { ...prev, messages: mergeMessages(prev.messages, [message]), newerCursor: message.cursor, pending }, gap: false };
}

export const addPending = (prev: ThreadState, p: PendingMessage): ThreadState => ({ ...prev, pending: [...prev.pending, p] });

export const patchPending = (prev: ThreadState, clientId: string, patch: Partial<PendingMessage>): ThreadState => ({
  ...prev,
  pending: prev.pending.map((p) => (p.clientId === clientId ? { ...p, ...patch } : p)),
});

export const removePending = (prev: ThreadState, clientId: string): ThreadState => ({
  ...prev,
  pending: prev.pending.filter((p) => p.clientId !== clientId),
});

/**
 * A "failed" send whose request got no answer MAY have reached the server. Before sending it again, look at what arrived since:
 * a message of mine with identical text, created no earlier than shortly before the attempt, IS that attempt — do not duplicate it.
 */
export function findDeliveredTwin(p: PendingMessage, arrived: MessageDto[], myId: string): MessageDto | undefined {
  const since = new Date(p.createdAt).getTime() - 60_000;
  // C4: the same kind of message too — a card with the same (or empty) note is not the same as a text message
  const kind = p.reference ? (p.reference.type === "patient" ? "patient_reference" : "appointment_reference") : "text";
  return arrived.find((m) => m.senderId === myId && m.text === p.text && (m.contentType ?? "text") === kind && new Date(m.createdAt).getTime() >= since);
}

/** The newest server-confirmed message (what "read up to" refers to). */
export const latestMessage = (t: ThreadState): MessageDto | undefined => t.messages[t.messages.length - 1];

/** Newest message that someone else wrote (drives "New messages"). */
export const latestFromOthers = (t: ThreadState, myId: string): MessageDto | undefined => {
  for (let i = t.messages.length - 1; i >= 0; i--) if (t.messages[i].senderId !== myId) return t.messages[i];
  return undefined;
};
