import { CONNECT } from "../../config/connect";
import { PolicyError } from "../../auth/policy";

/**
 * CLINICOS CONNECT (C1) — message text rules. Pure functions (no database), unit-testable on their own.
 *
 * What is NORMALISED (always safe, never touches letters):
 *   - CRLF / CR / U+2028 / U+2029            → "\n"
 *   - C0 controls except TAB and LF, DEL, C1 controls (incl. NUL)   → removed
 *   - U+202D / U+202E (bidi OVERRIDE marks)   → removed: they can visually reverse text to disguise it and have no chat use
 *   - leading / trailing whitespace           → trimmed
 * What is deliberately NOT touched:
 *   - Arabic letters, tashkeel, tatweel, Persian/Urdu letters, digits of any script, emoji, ZWJ / ZWNJ (needed for shaping and emoji),
 *     RLM / LRM / ALM and the bidi embeddings / isolates (needed for mixed Arabic–English text). No NFC/NFKC: it can rewrite
 *     Arabic presentation forms, and a chat must keep what the person typed.
 *   - HTML / markup: the text is stored VERBATIM as inert plain text. Escaping on the way IN would corrupt "a < b" and double-escape
 *     on the way out; the rule is "never interpret it": the API answers application/json with nosniff and the UI renders text nodes.
 *
 * What is REJECTED (400): not a string, an unpaired surrogate, nothing visible left (empty / spaces / only invisible characters),
 * more than CONNECT.MESSAGE_MAX_CHARS Unicode code points.
 */
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BIDI_OVERRIDE_RE = /[\u202D\u202E]/g;
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Whitespace + characters that render as nothing: a message made only of these is empty. */
const NOTHING_VISIBLE_RE = /^[\p{White_Space}\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]*$/u;

/** Number of Unicode code points, stopping early once `cap` is exceeded (so a huge string is never fully walked). */
export function codePointLength(s: string, cap = Infinity): number {
  let n = 0;
  for (const _ of s) {
    void _;
    if (++n > cap) break;
  }
  return n;
}

/** The safe normalisation only (no validation). */
export function normalizeMessageText(s: string): string {
  return s.replace(/\r\n?|\u2028|\u2029/g, "\n").replace(CONTROL_RE, "").replace(BIDI_OVERRIDE_RE, "").trim();
}

/** Validates + normalises a message body. Throws PolicyError(400, code) — the message never echoes the text. */
export function validateMessageText(input: unknown): string {
  if (typeof input !== "string") throw new PolicyError(400, "INVALID_TEXT", "Message text must be a string");
  // cheap guard before any per-character work: MESSAGE_MAX_CHARS code points can never need more than 2× UTF-16 units
  if (input.length > CONNECT.MESSAGE_MAX_CHARS * 2) throw tooLong();
  if (LONE_SURROGATE_RE.test(input)) throw new PolicyError(400, "INVALID_TEXT", "Message contains invalid characters");
  const text = normalizeMessageText(input);
  if (NOTHING_VISIBLE_RE.test(text)) throw new PolicyError(400, "EMPTY_MESSAGE", "Message cannot be empty");
  if (codePointLength(text, CONNECT.MESSAGE_MAX_CHARS) > CONNECT.MESSAGE_MAX_CHARS) throw tooLong();
  return text;
}

const tooLong = () => new PolicyError(400, "MESSAGE_TOO_LONG", `Message is too long (maximum ${CONNECT.MESSAGE_MAX_CHARS} characters)`);

/** One-line preview for the conversation list: whitespace collapsed, cut at PREVIEW_CHARS code points (never in the middle of a character). */
export function previewOf(text: string, max: number = CONNECT.PREVIEW_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const cps = Array.from(flat);
  return cps.length <= max ? flat : cps.slice(0, max).join("").trimEnd() + "…";
}
