/**
 * CLINICOS CONNECT (C3) — realtime delivery layer: limits and switches. One place, so the server, the tests and the docs read the same numbers.
 * Realtime is a DELIVERY layer only (see services/connect/realtime.ts): every number here is about protecting the socket, none of it is business logic.
 */
const posInt = (v: string | undefined, d: number) => (Number(v) > 0 && Number.isInteger(Number(v)) ? Number(v) : d);

export const CONNECT_RT = {
  /** Kill switch: CONNECT_REALTIME=off keeps Connect fully working over plain HTTP (the C2 polling fallback). */
  enabled: (process.env.CONNECT_REALTIME ?? "on").trim().toLowerCase() !== "off",
  /** A connected socket is re-checked against the database (user active, token not revoked, role, clinic entitlement) at least this often. */
  revalidateMs: posInt(process.env.CONNECT_RT_REVALIDATE_MS, 30_000),
  /** Simultaneous sockets per user (browser tabs / devices). */
  maxSocketsPerUser: posInt(process.env.CONNECT_RT_MAX_SOCKETS_PER_USER, 8),
  /** Handshake attempts per client address per minute. */
  handshakesPerMin: posInt(process.env.CONNECT_RT_HANDSHAKES_PER_MIN, 120),
  /** Hard ceiling for ONE incoming message (bytes). Client events are tiny (an id and a flag). */
  maxPayloadBytes: 8 * 1024,
  /** Incoming events per socket per window (token bucket). Exceeding it drops the event; sustained abuse disconnects. */
  eventsPerWindow: posInt(process.env.CONNECT_RT_EVENTS_PER_WINDOW, 60),
  eventsWindowMs: 10_000,
  abuseDisconnectAfter: 5,
  /** Conversations one socket may be subscribed to (typing relay) at the same time. */
  maxSubscriptions: 20,
  /** `typing:true` for the same conversation is relayed at most this often per socket (the client also throttles). */
  typingMinIntervalMs: 1_500,
  /** engine.io keep-alive (Render recommends ping/pong so both sides notice a dead connection). */
  pingIntervalMs: 25_000,
  pingTimeoutMs: 20_000,
} as const;

/** Protocol version carried by every server → client event. Bump when a payload changes incompatibly. */
export const RT_VERSION = 1 as const;

export const RT_EVENTS = {
  messageNew: "connect:message:new",
  readSelf: "connect:read:self",
  readPeer: "connect:read:peer",
  typing: "connect:typing",
  revoked: "connect:access:revoked",
  // client → server
  subscribe: "connect:conversation:subscribe",
  unsubscribe: "connect:conversation:unsubscribe",
  typingSend: "connect:typing",
} as const;
