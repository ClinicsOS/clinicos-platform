// CLINICOS CONNECT (C3) — pure cache logic for realtime events (no React, no network, no socket): kept dependency-free so it is unit-tested
// directly under node:test. Every function returns the SAME object when nothing changed, so React Query does not re-render for no-ops.
import { seqOf } from "../messageStore";
import type {
  ConversationList,
  ConversationSummary,
  MessageDto,
  RtMessageEvent,
  RtReadPeerEvent,
  RtReadSelfEvent,
  RtTypingEvent,
  UnreadSummary,
} from "../types";
import { RT_VERSION } from "../types";

const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Defensive shape checks: the socket is untrusted input to the UI too. Anything unexpected is dropped (HTTP reconciliation repairs the screen). */
export function parseMessageEvent(raw: unknown): RtMessageEvent | null {
  const e = raw as Partial<RtMessageEvent> | null;
  if (!e || e.v !== RT_VERSION || !e.conversation || !e.message) return null;
  const m = e.message;
  if (!isStr(e.conversation.id) || !isStr(m.id) || !isStr(m.conversationId) || m.conversationId !== e.conversation.id) return null;
  if (m.contentType !== undefined && m.contentType !== "text" && m.contentType !== "appointment_reference" && m.contentType !== "patient_reference") return null;
  if (!isStr(m.senderId) || typeof m.text !== "string" || !isStr(m.createdAt) || !isStr(m.cursor) || seqOf(m.cursor) < 1) return null;
  if (e.conversation.type !== "direct" && e.conversation.type !== "clinic_team") return null;
  if (typeof e.unreadCount !== "number" || e.unreadCount < 0 || typeof e.preview !== "string") return null;
  return e as RtMessageEvent;
}
export function parseReadSelf(raw: unknown): RtReadSelfEvent | null {
  const e = raw as Partial<RtReadSelfEvent> | null;
  return e && e.v === RT_VERSION && isStr(e.conversationId) && typeof e.unreadCount === "number" && e.unreadCount >= 0 ? (e as RtReadSelfEvent) : null;
}
export function parseReadPeer(raw: unknown): RtReadPeerEvent | null {
  const e = raw as Partial<RtReadPeerEvent> | null;
  return e && e.v === RT_VERSION && isStr(e.conversationId) ? (e as RtReadPeerEvent) : null;
}
export function parseTyping(raw: unknown): RtTypingEvent | null {
  const e = raw as Partial<RtTypingEvent> | null;
  return e && e.v === RT_VERSION && isStr(e.conversationId) && isStr(e.userId) && typeof e.name === "string" && typeof e.typing === "boolean" ? (e as RtTypingEvent) : null;
}

/** The event's message as the same DTO the HTTP API returns (sender gets isActive: the server only delivers to/for active people). */
export function messageFromEvent(e: RtMessageEvent): MessageDto {
  const m = e.message;
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    sender: m.sender ? { id: m.sender.id, name: m.sender.name, role: m.sender.role, isActive: true } : null,
    text: m.text,
    contentType: m.contentType ?? "text",
    createdAt: m.createdAt,
    cursor: m.cursor,
  };
}

const activity = (c: ConversationSummary) => new Date(c.lastMessageAt ?? c.createdAt).getTime();

/** Clinic Team pinned first, then newest activity — the order the list screen shows. */
export function sortConversations(list: ConversationSummary[]): ConversationSummary[] {
  return list.slice().sort((a, b) => {
    if (a.type !== b.type) return a.type === "clinic_team" ? -1 : 1;
    return activity(b) - activity(a);
  });
}

export const unreadFromList = (list: ConversationSummary[]): UnreadSummary => ({
  total: list.reduce((n, c) => n + c.unreadCount, 0),
  conversations: list.filter((c) => c.unreadCount > 0).map((c) => ({ conversationId: c.id, unreadCount: c.unreadCount })),
});

export const withTotals = (conversations: ConversationSummary[]): ConversationList => ({ conversations, totalUnread: conversations.reduce((n, c) => n + c.unreadCount, 0) });

const laterCursor = (a: string | null | undefined, b: string | null | undefined): string | null => (seqOf(b) > seqOf(a) ? b ?? null : a ?? null);

/**
 * A message arrived: update that conversation's preview / time / unread, keep the order, and (direct) note that the PEER has read up to
 * their own message (they only write after reading, and C1 moves a sender's read position to their message).
 * `unknown` = the conversation is not in the list yet (someone just wrote to me for the first time): the caller fetches its summary over HTTP.
 */
export function listWithMessage(list: ConversationList, e: RtMessageEvent, myId: string): { list: ConversationList; unknown: boolean } {
  const cur = list.conversations.find((c) => c.id === e.conversation.id);
  if (!cur) return { list, unknown: true };
  // already reflected (an HTTP refetch got there first) or older than what the list shows: never move the list backwards
  if (cur.lastMessage?.id === e.message.id) return { list, unknown: false };
  if (cur.lastMessageAt && new Date(e.message.createdAt).getTime() < new Date(cur.lastMessageAt).getTime()) return { list, unknown: false };
  const mine = e.message.senderId === myId;
  const next: ConversationSummary = {
    ...cur,
    lastMessage: { id: e.message.id, senderId: e.message.senderId, isMine: mine, preview: e.preview, contentType: e.message.contentType ?? "text", createdAt: e.message.createdAt },
    lastMessageAt: e.lastMessageAt,
    unreadCount: e.unreadCount,
  };
  if (cur.type === "direct" && !mine) next.peerLastReadCursor = laterCursor(cur.peerLastReadCursor, e.message.cursor);
  return { list: withTotals(sortConversations(list.conversations.map((c) => (c === cur ? next : c)))), unknown: false };
}

/** connect:read:self — my unread count for one conversation changed (read in another tab / here). */
export function listWithReadSelf(list: ConversationList, e: RtReadSelfEvent): ConversationList {
  const cur = list.conversations.find((c) => c.id === e.conversationId);
  if (!cur || cur.unreadCount === e.unreadCount) return list;
  return withTotals(list.conversations.map((c) => (c === cur ? { ...cur, unreadCount: e.unreadCount } : c)));
}

/** connect:read:peer — the other participant read further: "Seen" moves forward (never back). */
export function listWithReadPeer(list: ConversationList, e: RtReadPeerEvent): ConversationList {
  const cur = list.conversations.find((c) => c.id === e.conversationId);
  if (!cur || cur.type !== "direct") return list;
  const next = laterCursor(cur.peerLastReadCursor, e.lastReadCursor);
  if (next === (cur.peerLastReadCursor ?? null)) return list;
  return { ...list, conversations: list.conversations.map((c) => (c === cur ? { ...cur, peerLastReadCursor: next } : c)) };
}

/** The navigation badge's data when the full list is not loaded: set one conversation's count and re-total. */
export function unreadWithConversation(prev: UnreadSummary, conversationId: string, count: number): UnreadSummary {
  const had = prev.conversations.find((x) => x.conversationId === conversationId)?.unreadCount ?? 0;
  if (had === count) return prev;
  const rows = prev.conversations.filter((x) => x.conversationId !== conversationId).concat(count > 0 ? [{ conversationId, unreadCount: count }] : []);
  return { total: rows.reduce((n, x) => n + x.unreadCount, 0), conversations: rows };
}

/* ------------------------------------------------------------------ typing (ephemeral, in memory only) */
export type TypingMap = Record<string, Record<string, { name: string; until: number }>>;

export function typingWith(map: TypingMap, e: RtTypingEvent, now: number, ttlMs: number, myId: string): TypingMap {
  if (e.userId === myId) return map;
  const inConv = map[e.conversationId] ?? {};
  if (!e.typing) {
    if (!inConv[e.userId]) return map;
    const rest: Record<string, { name: string; until: number }> = {};
    Object.keys(inConv).forEach((k) => {
      if (k !== e.userId) rest[k] = inConv[k];
    });
    const next = { ...map };
    if (Object.keys(rest).length) next[e.conversationId] = rest;
    else delete next[e.conversationId];
    return next;
  }
  return { ...map, [e.conversationId]: { ...inConv, [e.userId]: { name: e.name, until: now + ttlMs } } };
}

/** Drops signals older than their expiry. Returns the same map when nothing expired. */
export function typingExpire(map: TypingMap, now: number): TypingMap {
  let changed = false;
  const next: TypingMap = {};
  for (const cid of Object.keys(map)) {
    const kept: Record<string, { name: string; until: number }> = {};
    for (const uid of Object.keys(map[cid])) {
      if (map[cid][uid].until > now) kept[uid] = map[cid][uid];
      else changed = true;
    }
    if (Object.keys(kept).length) next[cid] = kept;
  }
  return changed ? next : map;
}
