// CLINICOS CONNECT (C2) — refresh policy. Plain HTTP polling, deliberately conservative (no WebSockets / SSE yet).
// Documented in docs/connect-c2.md. All timers stop while the tab is hidden and catch up once on return.
export const POLL = {
  /** Open conversation: ask only for what is newer than the last message we have (cheap `after` query). */
  threadMs: 5_000,
  /** Conversation list + the sidebar badge. */
  listMs: 20_000,
  /** Sidebar badge while the Messages page is NOT open. */
  badgeMs: 30_000,
  /** After consecutive failures the interval doubles up to this ceiling, and resets on the first success. */
  maxBackoffMs: 60_000,
  /** Messages per page (C1 default is 30, max 100). */
  pageSize: 30,
} as const;

/** "Near the bottom" for auto-scroll / mark-read, in pixels. */
export const NEAR_BOTTOM_PX = 120;
