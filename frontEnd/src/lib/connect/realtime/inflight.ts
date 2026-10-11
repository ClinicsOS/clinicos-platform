// CLINICOS CONNECT (C3) — which conversations have one of MY sends in flight right now.
// The realtime echo of my own message is ignored while the HTTP answer is on its way (the HTTP response is canonical and carries the
// same server id), so a message can never appear twice — and an echo that arrives from my OTHER tab/device is merged by id.
const counts = new Map<string, number>();

export function markSending(conversationId: string, delta: 1 | -1) {
  const n = (counts.get(conversationId) ?? 0) + delta;
  if (n <= 0) counts.delete(conversationId);
  else counts.set(conversationId, n);
}

export const isSending = (conversationId: string): boolean => (counts.get(conversationId) ?? 0) > 0;
