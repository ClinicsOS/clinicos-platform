import type { Server as HttpServer, IncomingMessage } from "http";
import { Server, type Socket } from "socket.io";
import { z } from "zod";
import { ConnectConversation } from "../../models/ConnectConversation";
import { ConnectReadState } from "../../models/ConnectReadState";
import { allowedOrigins } from "../../config/origins";
import { CONNECT_RT, RT_EVENTS, RT_VERSION } from "../../config/connectRealtime";
import { isOid } from "../../auth/policy";
import { verifyStaffToken } from "../../middleware/auth";
import { loadConnectAccess, loadConnectAccessMany, type ConnectDenial } from "./access";
import { loadAccessibleConversation, type ChatCtx } from "./conversations";
import { unreadOf } from "./readState";
import { previewOf } from "./text";
import { encodeCursor, decodeCursor } from "./cursor";
import type { MessageDto } from "./messages";

/**
 * CLINICOS CONNECT (C3) — realtime DELIVERY layer (Socket.IO on the same HTTP server as the API; single instance, no Redis).
 *
 * ┌─ RULES ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
 * │ 1. It is a delivery layer, NOT a second business-logic / authorisation system. Messages are created and read-state is moved   │
 * │    ONLY by the C1 HTTP services. Nothing here writes a message or a read position. A client cannot send a message by socket.   │
 * │ 2. PERSIST FIRST, EMIT AFTER. The controllers call publishMessageCreated / publishReadAdvanced only after the C1 service       │
 * │    has committed. A failed emit never fails the HTTP request; MongoDB + the HTTP APIs stay the source of truth (clients        │
 * │    reconcile over HTTP after every reconnect), so no event is ever required for correctness.                                  │
 * │ 3. Rooms are PER USER ("u:<userId>") and nothing else. There is deliberately NO clinic-wide room and NO conversation room, so   │
 * │    there is nothing a client could join to overhear a conversation. Recipients are computed on the SERVER, from the database,  │
 * │    for each event: a direct conversation → its two participants only (the clinic Owner is NOT one of them unless they are      │
 * │    a participant); the Clinic Team → the clinic's connected members. Nothing is broadcast and filtered on the client.         │
 * │ 4. Identity comes from the verified token + the database, never from the client: no userId / clinicId / role / senderId /      │
 * │    membership is ever read from a payload (payloads are strict schemas, so such fields are rejected).                          │
 * │ 5. Entitlement (Pro) is the SAME decision as the HTTP gate (services/connect/access.ts) and is re-evaluated at the handshake,  │
 * │    on a timer for every open socket, before every delivery and before every client event is honoured. A user who is            │
 * │    deactivated, whose token is revoked, or whose clinic loses Connect is disconnected and stops receiving events.             │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 * Message bodies are never logged.
 */

interface SubInfo {
  type: "direct" | "clinic_team";
  /** direct: the other participant (fixed for the life of the conversation). */
  peerId?: string;
}

interface SocketData {
  userId: string;
  clinicId: string;
  name: string;
  role: string;
  tokenVersion: number;
  /** C5: the JWT's own expiry (ms). An open socket must not outlive the token it authenticated with. */
  expiresAt?: number;
  checkedAt: number;
  subs: Map<string, SubInfo>;
  typingAt: Map<string, number>;
  bucketStart: number;
  bucketCount: number;
  abuse: number;
}

type Ack = (r: { ok: boolean; code?: string }) => void;

let io: Server | null = null;
let sweeper: ReturnType<typeof setInterval> | null = null;
const handshakes = new Map<string, { start: number; n: number }>();

const dataOf = (s: Socket): SocketData => s.data as SocketData;
const userRoom = (userId: string) => `u:${userId}`;

function denial(code: ConnectDenial | "RATE_LIMITED" | "TOO_MANY_CONNECTIONS" | "SERVER"): Error {
  const e = new Error(code) as Error & { data?: unknown };
  e.data = { code };
  return e;
}

function clientAddress(req: IncomingMessage): string {
  // behind Render's proxy the LAST x-forwarded-for entry is the address the proxy saw (same assumption as express "trust proxy": 1)
  const xff = req.headers["x-forwarded-for"];
  const last = (Array.isArray(xff) ? xff.join(",") : xff ?? "").split(",").map((x) => x.trim()).filter(Boolean).pop();
  return last || req.socket.remoteAddress || "unknown";
}

/* ------------------------------------------------------------------ local socket registry (this process only) */
function allSockets(): Socket[] {
  return io ? Array.from(io.of("/").sockets.values()) : [];
}
function socketsOfUsers(userIds: Set<string>): Socket[] {
  return allSockets().filter((s) => userIds.has(dataOf(s).userId));
}
function connectedUserIdsInClinic(clinicId: string): Set<string> {
  const ids = new Set<string>();
  for (const s of allSockets()) if (dataOf(s).clinicId === clinicId) ids.add(dataOf(s).userId);
  return ids;
}

function revoke(socket: Socket, code: ConnectDenial) {
  try {
    socket.emit(RT_EVENTS.revoked, { v: RT_VERSION, code });
  } finally {
    socket.disconnect(true);
  }
}

/**
 * Re-checks sockets against the database (2 queries however many sockets) and disconnects the ones that may no longer use Connect.
 * `maxAgeMs` = how old the last check may be before it is repeated (0 = always).
 */
async function revalidate(sockets: Socket[], maxAgeMs: number): Promise<void> {
  const now = Date.now();
  // C5: HTTP refuses an expired JWT; an already-open socket must be cut off at the same moment (it is not re-authenticated otherwise)
  for (const s of sockets) {
    const exp = dataOf(s).expiresAt;
    if (s.connected && exp !== undefined && exp <= now) revoke(s, "UNAUTHORIZED");
  }
  const due = sockets.filter((s) => s.connected && now - dataOf(s).checkedAt >= maxAgeMs);
  if (!due.length) return;
  const keys = new Map<string, { userId: string; tokenVersion: number }>();
  for (const s of due) keys.set(dataOf(s).userId + ":" + dataOf(s).tokenVersion, { userId: dataOf(s).userId, tokenVersion: dataOf(s).tokenVersion });
  const res = await loadConnectAccessMany(Array.from(keys.values()));
  for (const s of due) {
    const d = dataOf(s);
    const r = res.get(d.userId + ":" + d.tokenVersion);
    if (!r || !r.ok || r.identity.clinicId !== d.clinicId) revoke(s, r && !r.ok ? r.code : "UNAUTHORIZED");
    else {
      d.checkedAt = Date.now();
      d.name = r.identity.name;
      d.role = r.identity.role;
    }
  }
}

/* ------------------------------------------------------------------ per-socket abuse control */
function take(socket: Socket): boolean {
  const d = dataOf(socket);
  const now = Date.now();
  if (now - d.bucketStart >= CONNECT_RT.eventsWindowMs) {
    d.bucketStart = now;
    d.bucketCount = 0;
  }
  d.bucketCount++;
  if (d.bucketCount <= CONNECT_RT.eventsPerWindow) return true;
  d.abuse++;
  if (d.abuse >= CONNECT_RT.abuseDisconnectAfter * CONNECT_RT.eventsPerWindow) socket.disconnect(true); // sustained flooding
  return false;
}

/** Wraps a client → server handler: rate limit → strict payload → fresh access → handler. Always answers the ack, never throws. */
function handle<T>(socket: Socket, event: string, schema: z.ZodType<T>, fn: (d: SocketData, payload: T) => Promise<{ ok: boolean; code?: string }>) {
  socket.on(event, async (payload: unknown, ack?: unknown) => {
    const cb: Ack = typeof ack === "function" ? (ack as Ack) : () => undefined;
    try {
      if (!take(socket)) return cb({ ok: false, code: "RATE_LIMITED" });
      const parsed = schema.safeParse(payload);
      if (!parsed.success) return cb({ ok: false, code: "INVALID_PAYLOAD" });
      const d = dataOf(socket);
      if (d.expiresAt !== undefined && d.expiresAt <= Date.now()) await revalidate([socket], 0); // C5: expired token → revoked now
      else if (Date.now() - d.checkedAt >= CONNECT_RT.revalidateMs) await revalidate([socket], CONNECT_RT.revalidateMs);
      if (!socket.connected) return cb({ ok: false, code: "FORBIDDEN" });
      cb(await fn(d, parsed.data));
    } catch {
      cb({ ok: false, code: "ERROR" });
    }
  });
}

const convIdSchema = z.object({ conversationId: z.string().min(1).max(64) }).strict();
const typingSchema = z.object({ conversationId: z.string().min(1).max(64), typing: z.boolean() }).strict();

/* ------------------------------------------------------------------ attach */
export function attachConnectRealtime(server: HttpServer): { io: Server; close: () => Promise<void> } | null {
  if (!CONNECT_RT.enabled) {
    console.log("[connect-rt] realtime is switched off (CONNECT_REALTIME=off): Connect runs over HTTP only");
    return null;
  }
  const origins = allowedOrigins();
  io = new Server(server, {
    path: "/socket.io",
    // CORS for the polling transport; the websocket transport is checked by allowRequest below (browsers send Origin on both).
    cors: origins === false ? { origin: false } : { origin: origins, credentials: false },
    maxHttpBufferSize: CONNECT_RT.maxPayloadBytes,
    pingInterval: CONNECT_RT.pingIntervalMs,
    pingTimeout: CONNECT_RT.pingTimeoutMs,
    serveClient: false,
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      // a browser always sends Origin: it must be ours. Non-browser clients send none and still need a valid token to get in.
      if (origin && (origins === false || !origins.includes(origin))) return cb("origin not allowed", false);
      const ip = clientAddress(req);
      const now = Date.now();
      const h = handshakes.get(ip);
      if (!h || now - h.start >= 60_000) handshakes.set(ip, { start: now, n: 1 });
      else if (++h.n > CONNECT_RT.handshakesPerMin) return cb("too many connection attempts", false);
      cb(null, true);
    },
  });

  // authenticate EVERY connection before it can do anything (same token + same database facts as the HTTP gate)
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== "string" || token.length < 20 || token.length > 4096) return next(denial("UNAUTHORIZED"));
      let decoded;
      try {
        decoded = verifyStaffToken(token);
      } catch {
        return next(denial("UNAUTHORIZED"));
      }
      const tokenVersion = decoded.tokenVersion ?? 0;
      const access = await loadConnectAccess(decoded.userId, tokenVersion);
      if (!access.ok) return next(denial(access.code));
      let mine = 0;
      for (const s of allSockets()) if (dataOf(s).userId === access.identity.userId) mine++;
      if (mine >= CONNECT_RT.maxSocketsPerUser) return next(denial("TOO_MANY_CONNECTIONS"));
      socket.data = {
        userId: access.identity.userId,
        clinicId: access.identity.clinicId,
        name: access.identity.name,
        role: access.identity.role,
        tokenVersion,
        expiresAt: typeof decoded.exp === "number" ? decoded.exp * 1000 : undefined,
        checkedAt: Date.now(),
        subs: new Map(),
        typingAt: new Map(),
        bucketStart: Date.now(),
        bucketCount: 0,
        abuse: 0,
      } satisfies SocketData;
      next();
    } catch {
      next(denial("SERVER"));
    }
  });

  io.on("connection", (socket) => {
    const d = dataOf(socket);
    socket.join(userRoom(d.userId)); // the ONLY room a socket is ever in

    // explicit, server-verified subscription (used for typing). Membership is decided by C1's loadAccessibleConversation — never by the client.
    handle(socket, RT_EVENTS.subscribe, convIdSchema, async (sd, p) => {
      if (!isOid(p.conversationId)) return { ok: false, code: "INVALID_ID" };
      if (!sd.subs.has(p.conversationId.toLowerCase()) && sd.subs.size >= CONNECT_RT.maxSubscriptions) return { ok: false, code: "TOO_MANY_SUBSCRIPTIONS" };
      const conv = await loadAccessibleConversation({ clinicId: sd.clinicId, userId: sd.userId }, p.conversationId);
      if (!conv) return { ok: false, code: "NOT_FOUND" }; // other clinic, somebody else's DM and "does not exist" are indistinguishable
      sd.subs.set(String(conv._id), { type: conv.type, peerId: conv.type === "direct" ? conv.participantIds.map(String).find((x) => x !== sd.userId) : undefined });
      return { ok: true };
    });
    handle(socket, RT_EVENTS.unsubscribe, convIdSchema, async (sd, p) => {
      sd.subs.delete(p.conversationId.toLowerCase());
      sd.typingAt.delete(p.conversationId.toLowerCase());
      return { ok: true };
    });

    // typing is EPHEMERAL: relayed, never stored. Only to the other authorised people, only for a conversation this socket is subscribed to.
    handle(socket, RT_EVENTS.typingSend, typingSchema, async (sd, p) => {
      const id = p.conversationId.toLowerCase();
      const sub = sd.subs.get(id);
      if (!sub) return { ok: false, code: "NOT_SUBSCRIBED" };
      const now = Date.now();
      if (p.typing) {
        const last = sd.typingAt.get(id) ?? 0;
        if (now - last < CONNECT_RT.typingMinIntervalMs) return { ok: true }; // throttled: silently coalesced
        sd.typingAt.set(id, now);
      } else sd.typingAt.delete(id);
      const targets = new Set<string>();
      if (sub.type === "direct") {
        if (sub.peerId) targets.add(sub.peerId);
      } else connectedUserIdsInClinic(sd.clinicId).forEach((u) => u !== sd.userId && targets.add(u));
      const payload = { v: RT_VERSION, conversationId: id, userId: sd.userId, name: sd.name, role: sd.role, typing: p.typing };
      targets.forEach((u) => {
        // belt and braces for the Clinic Team case: only sockets of THIS clinic are ever addressed
        for (const s of socketsOfUsers(new Set([u]))) if (dataOf(s).clinicId === sd.clinicId) s.emit(RT_EVENTS.typing, payload);
      });
      return { ok: true };
    });
  });

  // periodic re-check: a user who is deactivated / revoked / loses Pro is cut off within revalidateMs even if nothing is happening
  sweeper = setInterval(() => {
    const now = Date.now();
    handshakes.forEach((h, ip) => now - h.start >= 60_000 && handshakes.delete(ip));
    revalidate(allSockets(), CONNECT_RT.revalidateMs).catch(() => undefined);
  }, Math.min(CONNECT_RT.revalidateMs, 30_000));
  sweeper.unref();

  console.log(`[connect-rt] realtime ready (Socket.IO, path /socket.io, ${origins === false ? "no browser origin allowed" : origins.length + " allowed origin(s)"})`);
  return {
    io,
    close: () =>
      new Promise<void>((resolve) => {
        if (sweeper) clearInterval(sweeper);
        sweeper = null;
        const s = io;
        io = null;
        if (!s) return resolve();
        s.close(() => resolve());
      }),
  };
}

/* ------------------------------------------------------------------ publishing (called by the controllers AFTER the C1 service committed) */

/** Who is connected, still entitled and addressable right now among `candidates` (revalidated against the database first). */
async function liveTargets(candidates: Set<string>, clinicId: string): Promise<Set<string>> {
  if (!candidates.size) return candidates;
  await revalidate(socketsOfUsers(candidates), 0);
  const live = new Set<string>();
  for (const s of socketsOfUsers(candidates)) if (s.connected && dataOf(s).clinicId === clinicId) live.add(dataOf(s).userId);
  return live;
}

/** A message has just been persisted by C1: tell the people who are allowed to see it. Best effort — HTTP stays the source of truth. */
export async function publishMessageCreated(ctx: ChatCtx, message: MessageDto): Promise<void> {
  if (!io) return;
  try {
    const conv = await ConnectConversation.findOne({ _id: message.conversationId, clinicId: ctx.clinicId }).select("type participantIds lastMessageSeq").lean();
    if (!conv) return;
    const candidates = new Set<string>();
    if (conv.type === "direct") {
      // ONLY the two participants — a direct conversation has no other audience, whatever the viewer's role
      conv.participantIds.map(String).forEach((id) => candidates.add(id));
    } else connectedUserIdsInClinic(ctx.clinicId).forEach((id) => candidates.add(id));
    // cheap exit when nobody who could receive it is connected to this process
    if (!socketsOfUsers(candidates).length) return;
    const targets = await liveTargets(candidates, ctx.clinicId);
    if (!targets.size) return;

    const seq = decodeCursor(message.cursor);
    const latest = Math.max(conv.lastMessageSeq ?? 0, seq);
    const reads = await ConnectReadState.find({ clinicId: ctx.clinicId, conversationId: conv._id, userId: { $in: Array.from(targets) } }).select("userId lastReadSeq").lean();
    const readBy = new Map(reads.map((r) => [String(r.userId), r.lastReadSeq ?? 0]));
    const base = {
      v: RT_VERSION,
      conversation: { id: String(conv._id), type: conv.type },
      message: {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        sender: message.sender ? { id: message.sender.id, name: message.sender.name, role: message.sender.role } : null,
        text: message.text,
        // C4: the KIND only. A reference card's data is never in the event (it can differ per recipient): clients ask the HTTP API for the
        // card with their own credentials, so a restricted colleague receives nothing about the patient / appointment — not even its id.
        contentType: message.contentType,
        createdAt: message.createdAt,
        cursor: message.cursor,
      },
      preview: previewOf(message.text),
      lastMessageAt: message.createdAt,
    };
    targets.forEach((userId) => {
      const unreadCount = userId === message.senderId ? 0 : unreadOf(latest, readBy.get(userId));
      io?.to(userRoom(userId)).emit(RT_EVENTS.messageNew, { ...base, unreadCount });
    });
  } catch (e) {
    console.error("[connect-rt] message publish failed:", e instanceof Error ? e.name : "error");
  }
}

/**
 * The caller's read position has just been persisted by C1. Tells (1) the caller's own devices their new unread count and
 * (2) for a DIRECT conversation only, the other participant how far they have read (→ "Seen"). Nobody else, ever.
 */
export async function publishReadAdvanced(ctx: ChatCtx, conversationId: string): Promise<void> {
  if (!io) return;
  try {
    const conv = await ConnectConversation.findOne({ _id: conversationId, clinicId: ctx.clinicId }).select("type participantIds lastMessageSeq").lean();
    if (!conv) return;
    const row = await ConnectReadState.findOne({ clinicId: ctx.clinicId, conversationId: conv._id, userId: ctx.userId }).select("lastReadSeq").lean();
    const lastRead = row?.lastReadSeq ?? 0;
    const cursor = lastRead > 0 ? encodeCursor(lastRead) : null;
    const candidates = new Set<string>([ctx.userId]);
    const peerId = conv.type === "direct" ? conv.participantIds.map(String).find((p) => p !== ctx.userId) : undefined;
    if (peerId) candidates.add(peerId);
    if (!socketsOfUsers(candidates).length) return;
    const targets = await liveTargets(candidates, ctx.clinicId);
    if (targets.has(ctx.userId)) {
      io?.to(userRoom(ctx.userId)).emit(RT_EVENTS.readSelf, {
        v: RT_VERSION,
        conversationId: String(conv._id),
        unreadCount: unreadOf(conv.lastMessageSeq, lastRead),
        lastReadCursor: cursor,
      });
    }
    if (peerId && targets.has(peerId)) {
      io?.to(userRoom(peerId)).emit(RT_EVENTS.readPeer, { v: RT_VERSION, conversationId: String(conv._id), lastReadCursor: cursor });
    }
  } catch (e) {
    console.error("[connect-rt] read publish failed:", e instanceof Error ? e.name : "error");
  }
}

/** Test / diagnostics hook: how many sockets this process holds (no identities). */
export const realtimeSocketCount = (): number => allSockets().length;
