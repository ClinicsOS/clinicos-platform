import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/errorHandler";
import { PolicyError } from "../auth/policy";
import { CONNECT } from "../config/connect";
import {
  ensureTeamConversation,
  openDirectConversation,
  loadAccessibleConversation,
  listConversations,
  unreadSummary,
  summarize,
  notFound,
  type ChatCtx,
} from "../services/connect/conversations";
import { sendMessage, listMessages, decodeCursor } from "../services/connect/messages";
import { resolveCards, viewerOf } from "../services/connect/references";
import { pickAppointments, pickPatients } from "../services/connect/pickers";
import { markConversationRead } from "../services/connect/readState";
import { publishMessageCreated, publishReadAdvanced } from "../services/connect/realtime";

/**
 * CLINICOS CONNECT (C1) — HTTP layer. Thin on purpose: parse, call the service, answer.
 * The caller's identity and clinic are taken ONLY from `protect` (req.userId / req.clinicId). Bodies are strict zod objects, so a
 * `senderId`, `clinicId`, `participantIds`, `seq`, `createdAt`… in a request is a 400, never silently honoured (mass assignment).
 * Nothing here logs request bodies or message text.
 */
const ctxOf = (req: Request): ChatCtx => ({ clinicId: req.clinicId as string, userId: req.userId as string, role: req.role });

const openDirectSchema = z.object({ userId: z.string().min(1).max(64) }).strict();
// C4: a text message ({ text }, unchanged) OR a reference card ({ reference:{type,id}, text? }). strict(): a clinicId / senderId / contentType /
// referenceId / seq / patient data in the body is a 400, never honoured — the kind is derived on the server from `reference.type`.
const referenceSchema = z.object({ type: z.enum(["appointment", "patient"]), id: z.string().min(1).max(64) }).strict();
const sendSchema = z.object({ text: z.string().optional(), reference: referenceSchema.optional() }).strict();
const cardsSchema = z.object({ messageIds: z.array(z.string().max(64)).max(100) }).strict();
const readSchema = z.object({ upToMessageId: z.string().min(1).max(64).optional() }).strict();

/** GET /api/connect/conversations — everything the caller may see, newest activity first, with unread counts. Ensures the Clinic Team exists. */
export const getConversations = asyncHandler(async (req: Request, res: Response) => {
  return res.json(await listConversations(ctxOf(req)));
});

/** GET /api/connect/team — the Clinic Team conversation (created on first use; concurrent callers get the same one). */
export const getTeam = asyncHandler(async (req: Request, res: Response) => {
  const ctx = ctxOf(req);
  const [conversation] = await summarize(ctx, [await ensureTeamConversation(ctx.clinicId)]);
  return res.json({ conversation });
});

/** GET /api/connect/unread-count — total unread for the navigation badge. */
export const getUnreadCount = asyncHandler(async (req: Request, res: Response) => {
  return res.json(await unreadSummary(ctxOf(req)));
});

/** POST /api/connect/conversations/direct { userId } — open (find or create) the private conversation with a colleague. */
export const openDirect = asyncHandler(async (req: Request, res: Response) => {
  const ctx = ctxOf(req);
  const { userId } = openDirectSchema.parse(req.body);
  const { conversation, created } = await openDirectConversation(ctx, userId);
  const [summary] = await summarize(ctx, [conversation]);
  return res.status(created ? 201 : 200).json({ conversation: summary });
});

/** GET /api/connect/conversations/:id */
export const getConversation = asyncHandler(async (req: Request, res: Response) => {
  const ctx = ctxOf(req);
  const conv = await loadAccessibleConversation(ctx, req.params.id);
  if (!conv) throw notFound();
  const [conversation] = await summarize(ctx, [conv]);
  return res.json({ conversation });
});

/** A query value must be a single string (Express parses ?a[b]=1 into objects — never let that reach a query). */
const qStr = (v: unknown, name: string): string | undefined => {
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new PolicyError(400, "INVALID_QUERY", `Invalid ${name}`);
  return v;
};

/** GET /api/connect/conversations/:id/messages?limit=&before=&after= */
export const getMessages = asyncHandler(async (req: Request, res: Response) => {
  const ctx = ctxOf(req);
  const limitRaw = qStr(req.query.limit, "limit");
  const beforeRaw = qStr(req.query.before, "before");
  const afterRaw = qStr(req.query.after, "after");
  if (beforeRaw !== undefined && afterRaw !== undefined) throw new PolicyError(400, "INVALID_QUERY", "Use either before or after, not both");
  let limit: number = CONNECT.PAGE_DEFAULT;
  if (limitRaw !== undefined) {
    if (!/^\d{1,6}$/.test(limitRaw) || Number(limitRaw) < 1) throw new PolicyError(400, "INVALID_QUERY", "Invalid limit");
    limit = Math.min(Number(limitRaw), CONNECT.PAGE_MAX);
  }
  const before = beforeRaw !== undefined ? decodeCursor(beforeRaw) : undefined;
  const after = afterRaw !== undefined ? decodeCursor(afterRaw) : undefined;

  const conv = await loadAccessibleConversation(ctx, req.params.id);
  if (!conv) throw notFound();
  return res.json(await listMessages(ctx, conv, { limit, before, after }));
});

/** POST /api/connect/conversations/:id/messages { text } */
export const postMessage = asyncHandler(async (req: Request, res: Response) => {
  const { text, reference } = sendSchema.parse(req.body);
  const ctx = ctxOf(req);
  const message = await sendMessage(ctx, req.params.id, { text, reference });
  res.status(201).json({ message });
  // C3: PERSIST FIRST, EMIT AFTER. The message is committed and the sender already has their answer; delivery to connected recipients is
  // best effort (publishMessageCreated never throws) — a missed event is repaired by the clients' HTTP reconciliation.
  void publishMessageCreated(ctx, message);
  return;
});

/** POST /api/connect/conversations/:id/read { upToMessageId? } — mark read up to a message (default: the latest). */
export const postRead = asyncHandler(async (req: Request, res: Response) => {
  const ctx = ctxOf(req);
  const { upToMessageId } = readSchema.parse(req.body ?? {});
  const conv = await loadAccessibleConversation(ctx, req.params.id);
  if (!conv) throw notFound();
  const result = await markConversationRead(ctx, conv, upToMessageId);
  res.json({ conversationId: String(conv._id), ...result });
  void publishReadAdvanced(ctx, String(conv._id)); // C3: after the read position is persisted — own devices + (direct) the other participant
});

/** POST /api/connect/conversations/:id/cards { messageIds } — the Patient / Appointment cards of those messages, resolved for THIS caller with their CURRENT permissions (C4). */
export const postCards = asyncHandler(async (req: Request, res: Response) => {
  const { messageIds } = cardsSchema.parse(req.body);
  return res.json({ cards: await resolveCards(ctxOf(req), req.params.id, messageIds) });
});

/** GET /api/connect/pickers/patients?q=&page= — the "Share → Patient" list (C4). */
export const getPatientPicker = asyncHandler(async (req: Request, res: Response) => {
  return res.json(await pickPatients(viewerOf(ctxOf(req)), req.query.q, req.query.page));
});

/** GET /api/connect/pickers/appointments?group=today|upcoming|recent&q=&page= — the "Share → Appointment" list (C4). */
export const getAppointmentPicker = asyncHandler(async (req: Request, res: Response) => {
  return res.json(await pickAppointments(viewerOf(ctxOf(req)), req.query.group, req.query.q, req.query.page));
});
