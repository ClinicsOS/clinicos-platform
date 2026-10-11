// CLINICOS CONNECT (C3) — realtime client settings. The socket only DELIVERS; HTTP (C1) stays the source of truth.
export const RT_EVENTS = {
  messageNew: "connect:message:new",
  readSelf: "connect:read:self",
  readPeer: "connect:read:peer",
  typing: "connect:typing",
  revoked: "connect:access:revoked",
  subscribe: "connect:conversation:subscribe",
  unsubscribe: "connect:conversation:unsubscribe",
} as const;

/**
 * While the socket is CONNECTED the C2 polling loops become slow safety nets (they repair a missed event); while it is not connected
 * the original C2 intervals (lib/connect/config.ts POLL) apply again, so Connect keeps working on networks that block WebSockets.
 */
export const RT_POLL = {
  threadMs: 45_000,
  listMs: 60_000,
  badgeMs: 90_000,
} as const;

export const RT_CLIENT = {
  /** Typing: tell the server at most this often while the box is non-empty. */
  typingSendMs: 2_500,
  /** Typing indicator disappears this long after the last signal (the server never stores it). */
  typingTtlMs: 6_000,
  /** Coming back to a tab that was hidden for at least this long triggers one HTTP reconciliation. */
  hiddenReconcileMs: 10_000,
  /** The status chip appears only after the connection has been down this long (no flicker on a blip). */
  chipDelayMs: 1_800,
  /** Lowest gap between two 3D pulses caused by incoming messages (no notification storm). */
  pulseMinGapMs: 900,
} as const;

/** The API origin the socket connects to: the same host as NEXT_PUBLIC_API_URL (…/api), without the path. */
export function socketUrl(): string {
  const api = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
  try {
    return new URL(api).origin;
  } catch {
    return "http://localhost:5000";
  }
}

/** Default: polling handshake, upgraded to WebSocket. NEXT_PUBLIC_CONNECT_TRANSPORTS=websocket forces WebSocket only (needed behind a multi-instance load balancer without sticky sessions). */
export function socketTransports(): ("polling" | "websocket")[] {
  return process.env.NEXT_PUBLIC_CONNECT_TRANSPORTS === "websocket" ? ["websocket"] : ["polling", "websocket"];
}
