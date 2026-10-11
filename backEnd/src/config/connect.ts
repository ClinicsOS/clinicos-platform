/**
 * CLINICOS CONNECT (C1) — limits and constants for the internal staff chat. One place, so the validator, the pagination
 * code, the rate limiters and the tests all read the same numbers.
 */
const posInt = (v: string | undefined, d: number) => (Number(v) > 0 && Number.isInteger(Number(v)) ? Number(v) : d);

export const CONNECT = {
  /** Longest message, counted in Unicode CODE POINTS (an emoji or an Arabic letter is 1, however many UTF-16 units it takes). */
  MESSAGE_MAX_CHARS: 4000,
  /** Messages per page (GET .../messages?limit=). */
  PAGE_DEFAULT: 30,
  PAGE_MAX: 100,
  /** Conversation-list preview length, in code points. */
  PREVIEW_CHARS: 120,
  /** A staff member never has more than (colleagues + 1) conversations; this is only a hard ceiling for the list query. */
  LIST_MAX: 200,
  /** C5: a message that follows a seq gap is withheld from cursor catch-up (`after=`) until it is this old (a gap that old is a failed insert and is skipped). */
  GAP_SETTLE_MS: 3000,
} as const;

/** Per-USER ceilings (express-rate-limit, keyed on the verified user id — same pattern as the Loyalty staff routes). */
export const CONNECT_LIMITS = {
  windowMs: 60 * 1000,
  sendMax: posInt(process.env.CONNECT_SEND_MAX, 60), // text messages / minute / user
  openMax: posInt(process.env.CONNECT_OPEN_MAX, 30), // "open a direct conversation" / minute / user
  readMax: posInt(process.env.CONNECT_READ_MAX, 120), // "mark as read" / minute / user
} as const;
