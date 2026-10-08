import { identify, publicError, type IdentifyResult } from "@/lib/loyaltyPublic";

/**
 * Patient session — kept in ONE small module on purpose (Phase 9).
 *
 *  TODAY the patient identifies with a PHONE NUMBER ONLY. This is an intentional, temporary product decision, NOT strong identity
 *  verification: anyone who knows a member's phone number (and the clinic's QR/NFC link) can open that member's Loyalty card.
 *  What limits the damage: the card shows only Loyalty information (first name, points, tier, rewards, loyalty activity) — never clinical
 *  data — and the server rate-limits identification (per IP and per phone), answers every failure identically, scopes everything to the
 *  clinic in the URL, and issues a short-lived (30 min) Loyalty-only token that can reach nothing else.
 *
 *  LATER a stronger step (OTP, WhatsApp, passkey …) plugs in HERE as another `PatientIdentifier`: the screens only know "I have a
 *  token for this clinic" and never how it was obtained, so the app does not need rewriting.
 *
 *  The token is a Loyalty-only session token (NOT a clinic staff JWT — those never reach this app). It is stored on this device so an
 *  installed app can reopen straight into the card within the token's own short life, and it is dropped on "Close my card", on any
 *  401, and when it expires.
 */

export interface PatientIdentifier<I = unknown> {
  /** which method this is — shown nowhere as "verified", only used to pick the form */
  method: "phone";
  start: (slug: string, input: I) => Promise<IdentifyResult>;
}

/**
 * Phone-only identification (current approved behaviour). The server normalises the number (Jordan 07X / +9627X / 9627X).
 * Phase 9.1: for a patient who exists in this clinic's records but has no Loyalty membership yet, the SAME call creates the membership
 * (0 points, no history imported) and answers `newlyEnrolled: true`. There is no separate "register" call and no extra form.
 */
export const phoneIdentifier: PatientIdentifier<string> = { method: "phone", start: (slug, phone) => identify(slug, phone) };

/* ---------- Jordan phone entry helpers (display + client-side shape check ONLY — the server owns the real normalisation) ---------- */

/** Any pasted / typed form → the up-to-9 national digits "7XXXXXXXX". */
export function nationalFromInput(raw: string): string {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00962")) d = d.slice(5);
  else if (d.startsWith("962")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d.slice(0, 9);
}
/** "791234567" → "79 123 4567" */
export const formatNational = (n: string) => [n.slice(0, 2), n.slice(2, 5), n.slice(5, 9)].filter(Boolean).join(" ");
export const isPlausibleJordanMobile = (n: string) => /^7\d{8}$/.test(n);
/** What we send: the familiar local form; the server accepts it and normalises it. */
export const toLocalPhone = (n: string) => `0${n}`;

/* ---------- storage (localStorage with an in-memory fallback — private mode / blocked storage must never break the app) ---------- */

const KEY = (slug: string) => `lyp-session:${slug}`;
const memory = new Map<string, string>();

export function loadToken(slug: string): { token: string; exp: number } | null {
  try {
    const raw = window.localStorage.getItem(KEY(slug)) ?? memory.get(KEY(slug)) ?? null;
    if (!raw) return null;
    const v = JSON.parse(raw) as { token?: string; exp?: number };
    if (!v.token || typeof v.exp !== "number" || v.exp < Date.now()) {
      clearToken(slug);
      return null;
    }
    return { token: v.token, exp: v.exp };
  } catch {
    const raw = memory.get(KEY(slug));
    if (!raw) return null;
    try {
      const v = JSON.parse(raw) as { token: string; exp: number };
      return v.exp > Date.now() ? v : null;
    } catch {
      return null;
    }
  }
}
export function saveToken(slug: string, token: string, expiresInSec: number) {
  const raw = JSON.stringify({ token, exp: Date.now() + expiresInSec * 1000 });
  memory.set(KEY(slug), raw);
  try {
    window.localStorage.setItem(KEY(slug), raw);
  } catch {
    /* blocked — the memory copy keeps this page view working */
  }
}
export function clearToken(slug: string) {
  memory.delete(KEY(slug));
  try {
    window.localStorage.removeItem(KEY(slug));
    // the old (Phase 4–7) page kept its token in sessionStorage — drop that too
    window.sessionStorage.removeItem(`lyl-session:${slug}`);
  } catch {
    /* ignore */
  }
}

/* ---------- the cinematic entry is not replayed on every open ---------- */

const INTRO_KEY = (slug: string) => `lyp-intro:${slug}`;
const introMemory = new Map<string, number>();
/** true when the full entry should play: the patient hasn't seen it on this device for `cooldownMs` */
export function introDue(slug: string, cooldownMs: number): boolean {
  let at = introMemory.get(INTRO_KEY(slug)) ?? 0;
  try {
    at = Math.max(at, Number(window.localStorage.getItem(INTRO_KEY(slug)) || 0));
  } catch {
    /* storage blocked — memory only */
  }
  return !at || Date.now() - at > cooldownMs;
}
export function markIntro(slug: string) {
  introMemory.set(INTRO_KEY(slug), Date.now());
  try {
    window.localStorage.setItem(INTRO_KEY(slug), String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** Is this error "your session is over"? */
export const isSessionError = (e: unknown) => publicError(e).status === 401;

