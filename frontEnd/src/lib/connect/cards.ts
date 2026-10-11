// CLINICOS CONNECT (C4) — pure helpers for structured (card) messages. No React, no network: unit-tested directly under node:test.
// A card message carries NO record data; the card is asked from the server for the signed-in viewer (POST /connect/conversations/:id/cards).
import type { CardMap, CardView, ContentType, MessageDto, RefContentType } from "./types";

export const CARDS_BATCH = 100; // the server's limit per request

export const isRefContent = (c: ContentType | undefined): c is RefContentType => c === "appointment_reference" || c === "patient_reference";

/** Ids of the messages in a thread that need a card. */
export function refMessageIds(messages: MessageDto[]): string[] {
  const out: string[] = [];
  for (const m of messages) if (isRefContent(m.contentType)) out.push(m.id);
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Defensive parse of the server's answer: anything that is not a well-formed card is dropped (the message then shows "unavailable"). */
export function parseCards(raw: unknown): CardView[] {
  const list = (raw as { cards?: unknown } | null)?.cards;
  if (!Array.isArray(list)) return [];
  const out: CardView[] = [];
  for (const c of list as Record<string, unknown>[]) {
    if (!c || typeof c.messageId !== "string" || !isRefContent(c.contentType as ContentType)) continue;
    const ct = c.contentType as RefContentType;
    if (c.state === "restricted" || c.state === "unavailable") out.push({ messageId: c.messageId, contentType: ct, state: c.state });
    else if (c.state === "ok" && ct === "patient_reference" && c.patient && typeof (c.patient as { fullName?: unknown }).fullName === "string") out.push(c as unknown as CardView);
    else if (c.state === "ok" && ct === "appointment_reference" && c.appointment && typeof (c.appointment as { startAt?: unknown }).startAt === "string") out.push(c as unknown as CardView);
  }
  return out;
}

/**
 * Merge an answer into the cache. Ids that were asked for and not answered (or answered malformed) become "unavailable" — the server only
 * omits a message that is not a card of this conversation, so asking again would never help.
 */
export function mergeCards(prev: CardMap, asked: MessageDto[], answer: CardView[]): CardMap {
  const next: CardMap = { ...prev };
  for (const c of answer) next[c.messageId] = c;
  for (const m of asked) if (isRefContent(m.contentType) && !next[m.id]) next[m.id] = { messageId: m.id, contentType: m.contentType, state: "unavailable" };
  return next;
}

/** The ClinicOS pages a card opens. Those pages authorise on their own; the card grants nothing. */
export const appointmentHref = (a: { id: string; day: string }): string => `/appointments?appt=${encodeURIComponent(a.id)}&date=${encodeURIComponent(a.day)}`;
export const PATIENT_FILE_HREF = "/patients/profile";

/** Label key for a conversation-list preview of a card message that has no note. */
export const previewLabelKey = (c: ContentType | undefined): string | null =>
  c === "appointment_reference" ? "share.prevAppt" : c === "patient_reference" ? "share.prevPatient" : null;
