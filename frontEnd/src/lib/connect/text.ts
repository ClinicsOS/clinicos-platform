// CLINICOS CONNECT (C2) — client-side mirror of the C1 message rules (backEnd/src/services/connect/text.ts), for instant feedback
// only. The SERVER is the authority and re-validates everything; this never decides what is stored.
export const MESSAGE_MAX_CHARS = 4000;

const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BIDI_OVERRIDE_RE = /[\u202D\u202E]/g;
// built with new RegExp so the file type-checks without an ES2015 compile target (the browser/Node support the "u" flag natively)
const NOTHING_VISIBLE_RE = new RegExp("^[\\p{White_Space}\\u00AD\\u034F\\u061C\\u115F\\u1160\\u17B4\\u17B5\\u180B-\\u180F\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\u3164\\uFE00-\\uFE0F\\uFEFF\\uFFA0]*$", "u");

export function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) {
    void _;
    n++;
  }
  return n;
}

export const normalizeDraft = (s: string): string => s.replace(/\r\n?|\u2028|\u2029/g, "\n").replace(CONTROL_RE, "").replace(BIDI_OVERRIDE_RE, "").trim();

export type DraftCheck = { ok: true; text: string } | { ok: false; reason: "empty" | "tooLong" };

export function checkDraft(raw: string): DraftCheck {
  if (raw.length > MESSAGE_MAX_CHARS * 2) return { ok: false, reason: "tooLong" };
  const text = normalizeDraft(raw);
  if (NOTHING_VISIBLE_RE.test(text)) return { ok: false, reason: "empty" };
  if (codePointLength(text) > MESSAGE_MAX_CHARS) return { ok: false, reason: "tooLong" };
  return { ok: true, text };
}
