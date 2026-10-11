import { ConnectReadState } from "../../models/ConnectReadState";
import { encodeCursor } from "./cursor";

/**
 * CLINICOS CONNECT (C3) — "Seen" for DIRECT messages, from the SAME per-user read state C1 already persists (no second receipt store).
 *
 * The other participant's `lastReadSeq` is what makes "Seen" true: my message with seq S is seen when the peer's lastReadSeq >= S.
 * Only ever called for conversations the caller is a participant of (the callers pass already-authorised conversations), and only the
 * peer's POSITION is returned — as an opaque cursor, like every other cursor — never when/how often they read.
 * Not offered for the Clinic Team (per-member receipts would not scale and are not part of C3).
 */
export async function peerReadCursors(
  clinicId: string,
  myId: string,
  directs: { _id: unknown; participantIds: unknown[] }[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!directs.length) return out;
  const peerOf = new Map<string, string>(); // conversationId → peer user id
  for (const c of directs) {
    const peer = c.participantIds.map(String).find((p) => p !== myId);
    if (peer) peerOf.set(String(c._id), peer);
  }
  const rows = await ConnectReadState.find({
    clinicId,
    conversationId: { $in: directs.map((c) => c._id) },
    userId: { $in: Array.from(new Set(peerOf.values())) },
  })
    .select("conversationId userId lastReadSeq")
    .lean();
  const seqBy = new Map<string, number>();
  for (const r of rows) {
    const cid = String(r.conversationId);
    if (peerOf.get(cid) === String(r.userId)) seqBy.set(cid, r.lastReadSeq ?? 0);
  }
  peerOf.forEach((_peer, cid) => {
    const seq = seqBy.get(cid) ?? 0;
    out.set(cid, seq > 0 ? encodeCursor(seq) : null);
  });
  return out;
}
