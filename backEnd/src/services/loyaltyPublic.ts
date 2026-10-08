import crypto from "crypto";
import jwt from "jsonwebtoken";
import { Clinic } from "../models/Clinic";
import { Patient } from "../models/Patient";
import { LoyaltyAccount } from "../models/LoyaltyAccount";
import { hasAddon } from "./addons";
import { getSettings } from "./loyaltyService";
import { normalizeJordanPhone } from "../utils/phone";
import { PUBLIC_LOYALTY } from "../config/loyalty";

/**
 * Public (patient-facing) Loyalty — security building blocks.
 *
 * A patient needs NO ClinicOS account. They type their phone number; if it belongs to an ACTIVE Loyalty member of
 * THAT clinic they get a short-lived, Loyalty-only session token.
 *
 *  TOKEN: a JWT signed with a DIFFERENT secret than clinic-user tokens (`LOYALTY_PUBLIC_SECRET`, or a derived
 *  one from JWT_SECRET when that is not set), with its own audience/issuer/type. A clinic-user JWT therefore never
 *  verifies here, and a public token never verifies in `protect` (wrong secret + no `userId`) — it can reach
 *  nothing but the three read-only public Loyalty endpoints. It carries only { clinicId, accountId }.
 *
 *  Every request re-checks, server-side: the clinic by slug is active, the Loyalty add-on is entitled
 *  (Phase 1 `hasAddon`), the program is switched on, and the account still exists and is active.
 */

const baseSecret = () => {
  if (process.env.LOYALTY_PUBLIC_SECRET) return process.env.LOYALTY_PUBLIC_SECRET;
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET (or LOYALTY_PUBLIC_SECRET) is required");
  return `${process.env.JWT_SECRET}:clinicos-loyalty-public:v1`;
};

export interface PublicSession {
  clinicId: string;
  accountId: string;
}

export function signPublicToken(s: PublicSession): string {
  return jwt.sign({ typ: PUBLIC_LOYALTY.tokenType, cid: s.clinicId, aid: s.accountId }, baseSecret(), {
    algorithm: "HS256",
    audience: PUBLIC_LOYALTY.tokenAudience,
    issuer: PUBLIC_LOYALTY.tokenIssuer,
    expiresIn: PUBLIC_LOYALTY.tokenTtlSeconds,
  });
}

export function verifyPublicToken(token: string): PublicSession | null {
  try {
    const p = jwt.verify(token, baseSecret(), { algorithms: ["HS256"], audience: PUBLIC_LOYALTY.tokenAudience, issuer: PUBLIC_LOYALTY.tokenIssuer }) as Record<string, unknown>;
    if (p.typ !== PUBLIC_LOYALTY.tokenType || typeof p.cid !== "string" || typeof p.aid !== "string") return null;
    // Phase 10: both ids must be well-formed ObjectIds — anything else is an invalid session (401), never a database cast error.
    if (!/^[a-f\d]{24}$/i.test(p.cid) || !/^[a-f\d]{24}$/i.test(p.aid)) return null;
    return { clinicId: p.cid, accountId: p.aid };
  } catch {
    return null;
  }
}

/** Short, non-reversible, non-sequential membership reference shown on the card (e.g. LY-3F9A-C21B). */
export function memberRef(accountId: string): string {
  const h = crypto.createHmac("sha256", baseSecret()).update(`ref:${accountId}`).digest("hex").toUpperCase();
  return `LY-${h.slice(0, 4)}-${h.slice(4, 8)}`;
}
/** Opaque row key for activity lists — never the database id. */
export const opaqueKey = (id: string) => crypto.createHmac("sha256", baseSecret()).update(`row:${id}`).digest("hex").slice(0, 12);

/* ---------- clinic + availability ---------- */

export const isValidSlug = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,79}$/.test(s);

const safeLogo = (u?: string | null) => (u && /^(https?:\/\/|data:image\/(png|jpe?g|webp|svg\+xml);base64,)/i.test(u) ? u : null);
const safeColor = (c?: string | null) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : null);

export interface PublicClinic {
  id: string;
  name: string;
  logoUrl: string | null;
  brandColor: string | null;
  available: boolean;
  programName: string | null;
  /** Clinic switched patient check-in on (Phase 5). Only meaningful when `available`. */
  checkInEnabled: boolean;
}

/** Active clinic by public slug + whether the public Loyalty experience may operate right now. */
export async function resolvePublicClinic(slug: string): Promise<PublicClinic | null> {
  const clinic = await Clinic.findOne({ slug, status: "active" }).select("name logoUrl brandColor status planExpiresAt addons").lean();
  if (!clinic) return null;
  const entitled = hasAddon(clinic as never, "loyalty");
  let programName: string | null = null;
  let programOn = false;
  let checkInEnabled = false;
  if (entitled) {
    const { settings } = await getSettings(String(clinic._id));
    programOn = !!settings.program?.enabled;
    programName = settings.branding?.displayName ?? null;
    checkInEnabled = !!settings.checkin?.enabled;
  }
  return {
    id: String(clinic._id),
    name: clinic.name,
    logoUrl: safeLogo(clinic.logoUrl),
    brandColor: safeColor(clinic.brandColor),
    available: entitled && programOn,
    programName,
    checkInEnabled: entitled && programOn && checkInEnabled,
  };
}

/* ---------- phone lookup (clinic-scoped, tolerant of stored formats) ---------- */

/** "07X…", "+9627X…", "962 7X…", with spaces/dashes → the 9 national digits "7XXXXXXXX", or null. */
export function nationalDigits(raw: string): string | null {
  const intl = normalizeJordanPhone(raw);
  return intl ? intl.slice(3) : null;
}

const phoneRegex = (national: string) => new RegExp("^\\D*(?:(?:\\+|00)?\\D*962\\D*)?0?\\D*" + national.split("").join("\\D*") + "\\D*$");

/**
 * What the public "enter your number" step resolves a phone number to — INSIDE ONE CLINIC ONLY (never a global lookup):
 *   member    exactly one ACTIVE Loyalty account belongs to a patient with this number          → open it
 *   enroll    exactly one non-archived patient has this number and NO Loyalty account at all   → activate Loyalty for them (Phase 9.1)
 *   none      everything else — not a patient here, archived, suspended account, or ambiguous (several patients share the number)
 * The caller answers every "none" identically and reveals nothing about which of those it was.
 */
export type PhoneResolution =
  | { kind: "member"; account: Record<string, any> }
  | { kind: "enroll"; patientId: string }
  | { kind: "none" };

export async function resolvePhone(clinicId: string, national: string): Promise<PhoneResolution> {
  const patients = await Patient.find({ clinicId, isArchived: false, phone: phoneRegex(national) }).select("_id").limit(5).lean();
  if (!patients.length) return { kind: "none" };
  const accounts = await LoyaltyAccount.find({ clinicId, patientId: { $in: patients.map((p) => p._id) } }).lean();
  const active = accounts.filter((a) => a.status === "active");
  if (active.length === 1) return { kind: "member", account: active[0] as Record<string, any> };
  if (active.length > 1) return { kind: "none" }; // ambiguous
  // No active account. Only a SINGLE patient with no account at all may be enrolled; a suspended account is never silently re-opened,
  // and several patients sharing one number can't be told apart, so nobody is enrolled by guesswork.
  if (patients.length === 1 && accounts.length === 0) return { kind: "enroll", patientId: String(patients[0]._id) };
  return { kind: "none" };
}

/** The ONE active Loyalty account of this clinic whose patient has this phone number — or null (kept for callers that must not enrol). */
export async function findMemberByPhone(clinicId: string, national: string) {
  const r = await resolvePhone(clinicId, national);
  return r.kind === "member" ? { account: r.account } : null;
}

/** First name only, trimmed — the public card never needs more. */
export const displayName = (full: string) => full.trim().split(/\s+/)[0]?.slice(0, 30) || "";

/* ---------- failed-lookup throttle (per clinic + phone) ---------- */

const fails = new Map<string, { count: number; reset: number }>();
const failKey = (clinicId: string, national: string) => `${clinicId}:${crypto.createHash("sha256").update(national).digest("hex").slice(0, 20)}`;

export function isThrottled(clinicId: string, national: string): boolean {
  const k = failKey(clinicId, national);
  const e = fails.get(k);
  if (!e) return false;
  if (e.reset < Date.now()) {
    fails.delete(k);
    return false;
  }
  return e.count >= PUBLIC_LOYALTY.failMaxPerPhone;
}
/** Returns the failure count inside the current window (so the caller can log the moment a number gets throttled). */
export function recordFailure(clinicId: string, national: string): number {
  const now = Date.now();
  if (fails.size > 5000) for (const [k, v] of fails) if (v.reset < now) fails.delete(k);
  const k = failKey(clinicId, national);
  const e = fails.get(k);
  if (!e || e.reset < now) {
    fails.set(k, { count: 1, reset: now + PUBLIC_LOYALTY.failWindowMs });
    return 1;
  }
  e.count++;
  return e.count;
}

/* ---------- self-enrolment ceiling (per clinic, rolling hour) ---------- */

const enrolls = new Map<string, number[]>();
/** True when this clinic's public page has already created the maximum number of accounts in the last hour. Does NOT record anything. */
export function selfEnrollCapped(clinicId: string): boolean {
  const cutoff = Date.now() - 3_600_000;
  const list = (enrolls.get(clinicId) ?? []).filter((t) => t > cutoff);
  enrolls.set(clinicId, list);
  return list.length >= PUBLIC_LOYALTY.selfEnrollMaxPerClinicPerHour;
}
/** Count one account that the public page really created. */
export function recordSelfEnroll(clinicId: string): void {
  const list = enrolls.get(clinicId) ?? [];
  list.push(Date.now());
  enrolls.set(clinicId, list);
}
export const __resetPublicThrottles = () => {
  fails.clear();
  enrolls.clear();
};

export const jitter = () => new Promise<void>((r) => setTimeout(r, 90 + Math.floor(Math.random() * 90)));
