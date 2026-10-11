import { Types } from "mongoose";
import { ConnectConversation } from "../../models/ConnectConversation";
import { ConnectMessage, type ContentType } from "../../models/ConnectMessage";
import { User } from "../../models/User";
import { PolicyError } from "../../auth/policy";
import { CONNECT } from "../../config/connect";
import { validateMessageText } from "./text";
import { CONTENT_OF, assertCanShare, viewerOf, type RefType } from "./references";
import { advanceRead } from "./readState";
import { encodeCursor, decodeCursor } from "./cursor";
import { peopleById, loadAccessibleConversation, notFound, type ChatCtx, type ConvLean, type Person } from "./conversations";

/**
 * CLINICOS CONNECT (C1) — sending and paging messages.
 *
 * Ordering is by `seq` (the per-conversation counter), not by timestamp: it is unique, so the order is total and identical on every
 * read, even for messages written in the same millisecond. A cursor is simply an opaque wrapper around a seq.
 */
export interface MessageDto {
  id: string;
  conversationId: string;
  senderId: string;
  /** Joined from the user table at read time (name / role only). null only if the row no longer resolves. */
  sender: Person | null;
  /** The sender's text. For a reference message: the OPTIONAL note typed with the card ("" if none). */
  text: string;
  /** C4: "text" (every message written before C4) | "appointment_reference" | "patient_reference". The card itself is NOT here — see references.ts. */
  contentType: ContentType;
  createdAt: Date;
  /** Opaque position of this message, usable as `before` / `after`. */
  cursor: string;
}

/** What a client may ask to send: text, or a reference to an Appointment / Patient (optionally with a note). */
export interface SendInput {
  text?: unknown;
  reference?: { type: RefType; id: unknown };
}

/* ---------- cursors: base64url("v1:<seq>") — implemented in ./cursor.ts (shared with peerRead / realtime), re-exported here so existing imports keep working ---------- */
export { encodeCursor, decodeCursor };

const toDto = (m: any, people: Map<string, Person>): MessageDto => ({
  id: String(m._id),
  conversationId: String(m.conversationId),
  senderId: String(m.senderId),
  sender: people.get(String(m.senderId)) ?? null,
  text: m.text ?? "",
  contentType: (m.contentType ?? "text") as ContentType,
  createdAt: m.createdAt,
  cursor: encodeCursor(m.seq),
});

/**
 * POST /conversations/:id/messages — the sender is ALWAYS the authenticated user.
 * Text message (as before) or, in C4, a reference card (+ optional note). A reference is verified BEFORE a seq is taken: the sender must be
 * able to see that Appointment / Patient in their own clinic under the normal ClinicOS rules (see references.ts).
 */
export async function sendMessage(ctx: ChatCtx, conversationId: string, input: SendInput | unknown): Promise<MessageDto> {
  // backward compatible: a bare string is a text message
  const inp: SendInput = typeof input === "string" ? { text: input } : (input as SendInput);
  const ref = inp.reference;
  let text = "";
  if (inp.text !== undefined || !ref) {
    try {
      text = validateMessageText(inp.text);
    } catch (e) {
      // a card with a blank note is just a card; any other problem with the text (too long, bad characters, not a string) is still a 400
      if (!(ref && e instanceof PolicyError && e.code === "EMPTY_MESSAGE")) throw e;
    }
  }
  const conv = await loadAccessibleConversation(ctx, conversationId);
  if (!conv) throw notFound();

  if (conv.type === "direct") {
    // history of a conversation with a former colleague stays readable, but nobody can write into it while they are deactivated
    const otherId = conv.participantIds.map(String).find((p) => p !== ctx.userId);
    const stillHere = otherId ? await User.exists({ _id: otherId, clinicId: ctx.clinicId, isActive: true }) : null;
    if (!stillHere) throw new PolicyError(409, "PARTICIPANT_INACTIVE", "This person is no longer active in the clinic");
  }

  let referenceId: Types.ObjectId | undefined;
  if (ref) referenceId = await assertCanShare(viewerOf(ctx), ref.type, ref.id);

  // 1) take the next seq (atomic) 2) store the message 3) move the conversation's "last message" pointer FORWARD only 4) mark sender as read
  const bumped = await ConnectConversation.findOneAndUpdate(
    { _id: conv._id, clinicId: ctx.clinicId },
    { $inc: { lastSeq: 1 } },
    { new: true, projection: { lastSeq: 1 }, timestamps: false, lean: true },
  );
  if (!bumped) throw notFound();
  const seq = (bumped as { lastSeq: number }).lastSeq;

  const msg = await ConnectMessage.create({
    clinicId: ctx.clinicId,
    conversationId: conv._id,
    senderId: ctx.userId,
    seq,
    text,
    ...(ref && referenceId ? { contentType: CONTENT_OF[ref.type], referenceId } : {}),
  });

  await ConnectConversation.updateOne(
    { _id: conv._id, clinicId: ctx.clinicId, lastMessageSeq: { $lt: seq } },
    { $set: { lastMessageSeq: seq, lastMessageId: msg._id, lastMessageAt: msg.createdAt, lastMessageSenderId: msg.senderId } },
    { timestamps: false },
  );
  await advanceRead(ctx, conv._id, seq);

  const people = await peopleById(ctx.clinicId, [ctx.userId]);
  return toDto({ ...msg.toObject(), seq }, people);
}

export interface MessagePage {
  /** Oldest → newest, always. */
  messages: MessageDto[];
  pageInfo: {
    hasMoreOlder: boolean;
    hasMoreNewer: boolean;
    /** Pass as `before` to load the page before this one (null when there is nothing older). */
    olderCursor: string | null;
    /** Pass as `after` to fetch what arrived since (null for an empty page). */
    newerCursor: string | null;
  };
}

/**
 * GET /conversations/:id/messages
 *   (no cursor)  the newest `limit` messages
 *   before=<c>   the `limit` messages immediately older than c      (scroll up / "load older")
 *   after=<c>    the messages newer than c, oldest first, up to limit (catch-up / polling until realtime exists)
 */
export async function listMessages(
  ctx: ChatCtx,
  conv: ConvLean,
  opts: { limit: number; before?: number; after?: number },
): Promise<MessagePage> {
  const limit = Math.min(Math.max(1, opts.limit), CONNECT.PAGE_MAX);
  const base = { conversationId: conv._id, clinicId: ctx.clinicId };
  let rows: any[];
  let more: boolean;
  const forward = opts.after !== undefined;
  let heldBack = false;
  if (forward) {
    rows = await ConnectMessage.find({ ...base, seq: { $gt: opts.after } }).sort({ seq: 1 }).limit(limit + 1).lean();
    // C5 — gap guard. A seq is taken BEFORE the message is inserted, so for a few milliseconds message N+1 can be visible while N (taken
    // first, still being written) is not. Handing N+1 out would move the caller's cursor PAST N and a cursor-based catch-up (polling,
    // reconnect reconciliation) would never see N. So a message that follows a gap is held back until it has settled; a gap older than that
    // is a seq whose insert failed for good and is skipped. Realtime events still announce the message immediately.
    const settledBefore = Date.now() - CONNECT.GAP_SETTLE_MS;
    let expect = opts.after! + 1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].seq !== expect && new Date(rows[i].createdAt).getTime() > settledBefore) {
        rows = rows.slice(0, i);
        heldBack = true;
        break;
      }
      expect = rows[i].seq + 1;
    }
    more = rows.length > limit;
    rows = rows.slice(0, limit);
  } else {
    rows = await ConnectMessage.find(opts.before !== undefined ? { ...base, seq: { $lt: opts.before } } : base)
      .sort({ seq: -1 })
      .limit(limit + 1)
      .lean();
    more = rows.length > limit;
    rows = rows.slice(0, limit).reverse();
  }
  const people = await peopleById(ctx.clinicId, rows.map((r) => r.senderId));
  const messages = rows.map((r) => toDto(r, people));
  return {
    messages,
    pageInfo: {
      hasMoreOlder: forward ? true : more, // after=<c>: the cursor itself is an existing message, so older ones exist
      hasMoreNewer: forward ? more && !heldBack : opts.before !== undefined, // held back → the NEXT catch-up delivers it (no tight client loop)
      olderCursor: rows.length ? encodeCursor(rows[0].seq) : null,
      newerCursor: rows.length ? encodeCursor(rows[rows.length - 1].seq) : null,
    },
  };
}
