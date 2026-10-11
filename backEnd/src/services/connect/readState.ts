import { ConnectReadState } from "../../models/ConnectReadState";
import { ConnectMessage } from "../../models/ConnectMessage";
import { PolicyError, isOid } from "../../auth/policy";
import type { ChatCtx, ConvLean } from "./conversations";

/**
 * CLINICOS CONNECT (C1) — read / unread.
 *
 * Design (see models/ConnectReadState.ts): each conversation hands out a growing `seq` to its messages; each user has ONE row per
 * conversation holding the highest seq they have read; unread = lastMessageSeq − lastReadSeq. Sending a message marks the
 * sender's own position at that message, so your own messages are never unread for you. Everyone else's position is untouched,
 * so a Clinic Team message is unread for each other member independently — at the cost of two writes per message, however big the team.
 *
 * Known, accepted edge: sending also marks earlier messages (someone else's, sent moments before yours) as read for you, exactly
 * like replying in any chat app.
 */
export const unreadOf = (lastMessageSeq: number | undefined, lastReadSeq: number | undefined): number =>
  Math.max(0, (lastMessageSeq ?? 0) - (lastReadSeq ?? 0));

/** conversationId (string) → this user's lastReadSeq, for the given conversations, in ONE query. */
export async function readPositions(ctx: ChatCtx, conversationIds: unknown[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!conversationIds.length) return map;
  const rows = await ConnectReadState.find({ clinicId: ctx.clinicId, userId: ctx.userId, conversationId: { $in: conversationIds } })
    .select("conversationId lastReadSeq")
    .lean();
  for (const r of rows) map.set(String(r.conversationId), r.lastReadSeq ?? 0);
  return map;
}

/** Moves the user's read position FORWARD to at least `seq` (never back). Safe under concurrency: $max + one retry on the upsert race. */
export async function advanceRead(ctx: ChatCtx, conversationId: unknown, seq: number): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    try {
      const row = await ConnectReadState.findOneAndUpdate(
        { clinicId: ctx.clinicId, userId: ctx.userId, conversationId },
        { $max: { lastReadSeq: seq }, $set: { lastReadAt: new Date() } },
        { upsert: true, new: true, setDefaultsOnInsert: false, lean: true },
      );
      return row?.lastReadSeq ?? seq;
    } catch (err: any) {
      if (err?.code === 11000 && attempt === 0) continue; // two first-ever writers raced on the unique (userId, conversationId) key
      throw err;
    }
  }
}

/**
 * POST .../read — mark a conversation read up to `upToMessageId` (a message of THIS conversation), or up to the latest message.
 * Returns the new unread count for the caller.
 */
export async function markConversationRead(ctx: ChatCtx, conv: ConvLean, upToMessageId?: string): Promise<{ unreadCount: number }> {
  let target = conv.lastMessageSeq ?? 0;
  if (upToMessageId !== undefined) {
    if (!isOid(upToMessageId)) throw new PolicyError(400, "INVALID_ID", "Invalid ID format");
    const msg = await ConnectMessage.findOne({ _id: upToMessageId, conversationId: conv._id, clinicId: ctx.clinicId }).select("seq").lean();
    if (!msg) throw new PolicyError(404, "NOT_FOUND", "Message not found"); // not in this conversation (or not in this clinic): same answer
    target = msg.seq;
  }
  if (target <= 0) return { unreadCount: 0 }; // nothing to read yet
  const lastRead = await advanceRead(ctx, conv._id, target);
  return { unreadCount: unreadOf(conv.lastMessageSeq, lastRead) };
}
