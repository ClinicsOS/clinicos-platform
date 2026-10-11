import { Types } from "mongoose";
import { ConnectConversation } from "../../models/ConnectConversation";
import { ConnectMessage, type ContentType } from "../../models/ConnectMessage";
import { User } from "../../models/User";
import { PolicyError, isOid, type Role } from "../../auth/policy";
import { CONNECT } from "../../config/connect";
import { previewOf } from "./text";
import { readPositions, unreadOf } from "./readState";
import { peerReadCursors } from "./peerRead";

/**
 * CLINICOS CONNECT (C1) — conversations: who may open what, creation without duplicates, and the list.
 *
 * Trust rules (the only ones in this module — keep them that way):
 *   - `ctx.clinicId` / `ctx.userId` come from `protect` (the signed-in user's database record) — never from the request body / query.
 *   - Every query carries `clinicId`. A conversation of another clinic is indistinguishable from one that does not exist (404).
 *   - Direct conversations are visible only to their two participants; for anybody else — including the clinic owner — they do not
 *     exist (404, never 403, so even their existence is not confirmed).
 *   - The Clinic Team is open to every ACTIVE staff member of the clinic; "active + in this clinic" is exactly what `protect`
 *     already verified for this request, so deactivating a user cuts them off on their very next call.
 */
export interface ChatCtx {
  clinicId: string;
  userId: string;
  /** C4: the caller's role from `protect` (never from the client). Needed only to evaluate Patient / Appointment permissions for card references. */
  role?: Role;
}

export interface ConvLean {
  _id: Types.ObjectId;
  clinicId: Types.ObjectId;
  type: "direct" | "clinic_team";
  directKey?: string;
  participantIds: Types.ObjectId[];
  createdBy?: Types.ObjectId;
  lastSeq: number;
  lastMessageSeq: number;
  lastMessageId?: Types.ObjectId;
  lastMessageAt?: Date;
  lastMessageSenderId?: Types.ObjectId;
  createdAt: Date;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

export const notFound = () => new PolicyError(404, "NOT_FOUND", "Conversation not found");

/** 24-hex id → lowercase hex; anything else → 400 "Invalid ID format" (never a CastError / 500). */
export function parseOid(v: unknown): string {
  if (!isOid(v)) throw new PolicyError(400, "INVALID_ID", "Invalid ID format");
  return v.toLowerCase();
}

const isDup = (e: any) => e?.code === 11000;

/** The clinic's ONE Clinic Team conversation. Created on first use; concurrent callers all get the same document (unique partial index). */
export async function ensureTeamConversation(clinicId: string): Promise<ConvLean> {
  const found = await ConnectConversation.findOne({ clinicId, type: "clinic_team" }).lean<ConvLean>();
  if (found) return found;
  try {
    const made = await ConnectConversation.findOneAndUpdate(
      { clinicId, type: "clinic_team" },
      { $setOnInsert: { participantIds: [], lastSeq: 0, lastMessageSeq: 0 } },
      { upsert: true, new: true, lean: true },
    );
    if (made) return made as unknown as ConvLean;
  } catch (e) {
    if (!isDup(e)) throw e; // lost the race against another request creating it
  }
  const winner = await ConnectConversation.findOne({ clinicId, type: "clinic_team" }).lean<ConvLean>();
  if (!winner) throw new Error("clinic team conversation could not be ensured");
  return winner;
}

/** Deterministic identity of a pair: the two lowercase hex ids, sorted, joined by ":" — the same pair always gives the same key. */
export const directKeyOf = (a: string, b: string): string => [a.toLowerCase(), b.toLowerCase()].sort().join(":");

/** Open (find or create) the direct conversation between the caller and `otherUserId`. The recipient must be an ACTIVE member of the caller's clinic. */
export async function openDirectConversation(ctx: ChatCtx, otherUserId: string): Promise<{ conversation: ConvLean; created: boolean }> {
  const other = parseOid(otherUserId);
  if (other === ctx.userId.toLowerCase()) throw new PolicyError(400, "CANNOT_MESSAGE_SELF", "You cannot start a conversation with yourself");
  // wrong clinic, unknown id and deactivated colleague all answer the same, so ids of other clinics cannot be probed
  const peer = await User.findOne({ _id: other, clinicId: ctx.clinicId, isActive: true }).select("_id").lean();
  if (!peer) throw new PolicyError(404, "NOT_FOUND", "Recipient not found");

  const key = directKeyOf(ctx.userId, other);
  const existing = await ConnectConversation.findOne({ clinicId: ctx.clinicId, directKey: key }).lean<ConvLean>();
  if (existing) return { conversation: existing, created: false };
  try {
    const res = await ConnectConversation.findOneAndUpdate(
      { clinicId: ctx.clinicId, directKey: key },
      {
        $setOnInsert: {
          type: "direct",
          participantIds: key.split(":").map((id) => new Types.ObjectId(id)),
          createdBy: new Types.ObjectId(ctx.userId),
          lastSeq: 0,
          lastMessageSeq: 0,
        },
      },
      { upsert: true, new: true, lean: true, includeResultMetadata: true },
    );
    // updatedExisting === false → THIS request inserted it; true → a concurrent request got there first and we simply read theirs
    if (res.value) return { conversation: res.value as unknown as ConvLean, created: res.lastErrorObject?.updatedExisting === false };
  } catch (e) {
    if (!isDup(e)) throw e; // the other participant opened it at the same moment: use theirs
  }
  const winner = await ConnectConversation.findOne({ clinicId: ctx.clinicId, directKey: key }).lean<ConvLean>();
  if (!winner) throw new Error("direct conversation could not be ensured");
  return { conversation: winner, created: false };
}

/**
 * THE access check. Returns the conversation only if the caller may use it: same clinic AND (it is the Clinic Team OR the caller
 * is one of its two participants). Otherwise null — callers answer 404.
 */
export async function loadAccessibleConversation(ctx: ChatCtx, conversationId: string): Promise<ConvLean | null> {
  return ConnectConversation.findOne({
    _id: parseOid(conversationId),
    clinicId: ctx.clinicId,
    $or: [{ type: "clinic_team" }, { type: "direct", participantIds: ctx.userId }],
  }).lean<ConvLean>();
}

/** Every conversation the caller may see: the Clinic Team (ensured) + their own direct conversations that have a message or that they opened. */
export async function findMyConversations(ctx: ChatCtx): Promise<ConvLean[]> {
  const team = await ensureTeamConversation(ctx.clinicId);
  const directs = await ConnectConversation.find({
    clinicId: ctx.clinicId,
    type: "direct",
    participantIds: ctx.userId,
    // somebody else's still-empty conversation does not pop up in your list until they actually write something
    $or: [{ lastMessageSeq: { $gt: 0 } }, { createdBy: ctx.userId }],
  })
    .sort({ lastMessageAt: -1, _id: -1 })
    .limit(CONNECT.LIST_MAX)
    .lean<ConvLean[]>();
  return [team, ...directs];
}

const activityOf = (c: ConvLean) => (c.lastMessageAt ?? c.createdAt).getTime();

export async function peopleById(clinicId: string, ids: unknown[]): Promise<Map<string, Person>> {
  const map = new Map<string, Person>();
  const uniq = [...new Set(ids.map(String))];
  if (!uniq.length) return map;
  const users = await User.find({ _id: { $in: uniq }, clinicId }).select("name role isActive").lean();
  for (const u of users) map.set(String(u._id), { id: String(u._id), name: u.name, role: u.role, isActive: u.isActive !== false });
  return map;
}

export interface ConversationSummary {
  id: string;
  type: "direct" | "clinic_team";
  createdAt: Date;
  lastMessageAt: Date | null;
  lastMessage: { id: string; senderId: string; isMine: boolean; preview: string; contentType: ContentType; createdAt: Date } | null;
  unreadCount: number;
  /** direct: the two participants (name / role / isActive only — never e-mail or phone). team: omitted. */
  participants?: Person[];
  /** direct: the other participant, ready to show as the conversation title. */
  peer?: Person | null;
  /** team: number of ACTIVE staff in the clinic. */
  memberCount?: number;
  /** direct (C3): how far the OTHER participant has read, as an opaque cursor (null = nothing yet). Drives "Seen". */
  peerLastReadCursor?: string | null;
}

/** Builds list entries for already-authorised conversations (3 queries + 1 for the team count, whatever the number of conversations). */
export async function summarize(ctx: ChatCtx, convs: ConvLean[]): Promise<ConversationSummary[]> {
  const ids = convs.map((c) => c._id);
  const lastIds = convs.map((c) => c.lastMessageId).filter(Boolean) as Types.ObjectId[];
  const [reads, people, lastMsgs, memberCount, peerReads] = await Promise.all([
    readPositions(ctx, ids),
    peopleById(ctx.clinicId, convs.flatMap((c) => c.participantIds)),
    lastIds.length ? ConnectMessage.find({ _id: { $in: lastIds }, clinicId: ctx.clinicId }).select("senderId text contentType createdAt").lean() : Promise.resolve([]),
    convs.some((c) => c.type === "clinic_team") ? User.countDocuments({ clinicId: ctx.clinicId, isActive: true }) : Promise.resolve(0),
    peerReadCursors(ctx.clinicId, ctx.userId, convs.filter((c) => c.type === "direct")),
  ]);
  const lastById = new Map(lastMsgs.map((m) => [String(m._id), m]));

  return convs.map((c): ConversationSummary => {
    const last = c.lastMessageId ? lastById.get(String(c.lastMessageId)) : undefined;
    const s: ConversationSummary = {
      id: String(c._id),
      type: c.type,
      createdAt: c.createdAt,
      lastMessageAt: c.lastMessageAt ?? null,
      lastMessage: last
        ? { id: String(last._id), senderId: String(last.senderId), isMine: String(last.senderId) === ctx.userId, preview: previewOf(last.text ?? ""), contentType: (last.contentType ?? "text") as ContentType, createdAt: last.createdAt }
        : null,
      unreadCount: unreadOf(c.lastMessageSeq, reads.get(String(c._id))),
    };
    if (c.type === "direct") {
      s.participants = c.participantIds.map((p) => people.get(String(p))).filter(Boolean) as Person[];
      s.peer = people.get(String(c.participantIds.map(String).find((p) => p !== ctx.userId) ?? "")) ?? null;
      s.peerLastReadCursor = peerReads.get(String(c._id)) ?? null;
    } else {
      s.memberCount = memberCount;
    }
    return s;
  });
}

/** GET /conversations */
export async function listConversations(ctx: ChatCtx): Promise<{ conversations: ConversationSummary[]; totalUnread: number }> {
  const convs = (await findMyConversations(ctx)).sort((a, b) => activityOf(b) - activityOf(a));
  const conversations = await summarize(ctx, convs);
  return { conversations, totalUnread: conversations.reduce((n, c) => n + c.unreadCount, 0) };
}

/** GET /unread-count — the navigation badge. Two small queries; only conversations with something unread are listed. */
export async function unreadSummary(ctx: ChatCtx): Promise<{ total: number; conversations: { conversationId: string; unreadCount: number }[] }> {
  const convs = await findMyConversations(ctx);
  const reads = await readPositions(ctx, convs.map((c) => c._id));
  const rows = convs
    .map((c) => ({ conversationId: String(c._id), unreadCount: unreadOf(c.lastMessageSeq, reads.get(String(c._id))) }))
    .filter((r) => r.unreadCount > 0);
  return { total: rows.reduce((n, r) => n + r.unreadCount, 0), conversations: rows };
}
