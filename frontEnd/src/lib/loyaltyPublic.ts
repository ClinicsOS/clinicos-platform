import axios, { type AxiosError } from "axios";
import { api } from "@/lib/api";

/**
 * Public patient Loyalty — API client.
 * A SEPARATE axios instance: it must never carry a clinic user's token (no interceptors, no cookies). The only
 * credential is the short-lived, Loyalty-only session token returned by identify.
 */
export const publicApi = axios.create({ baseURL: api.defaults.baseURL, timeout: 15000, withCredentials: false });

export type PublicKind = "visit" | "spending" | "adjustment_credit" | "adjustment_debit" | "reversal" | "redemption" | "tier_promotion" | "other";
export interface PublicBrand {
  name: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  programName?: string | null;
}
export interface PublicInfo {
  available: boolean;
  clinic: PublicBrand;
}
/** Phase 7: the patient-safe tier block (clinic-defined name / description / benefits + server-calculated progress). null while tiers are off. */
export interface PublicTier {
  key: "tier1" | "tier2" | "tier3" | "tier4";
  name: string;
  rank: number;
  description: string | null;
  benefits: { title: string; description: string | null }[];
  metric: "lifetime_points" | "completed_visits" | "lifetime_spending";
  unit: "points" | "visits" | "jod";
  metricValue: number;
  nextTierName: string | null;
  nextTierThreshold: number | null;
  remaining: number;
  progressPercent: number;
  isTopTier: boolean;
}
/** Phase 9: a REAL, recent promotion the member is still at. `key` is opaque — the app remembers it per device so the celebration runs once. */
export interface PublicPromotion {
  key: string;
  fromTierKey: PublicTier["key"] | null;
  toTierKey: PublicTier["key"];
  fromName: string | null;
  toName: string;
  at: string;
}
export interface PublicMe {
  clinic: PublicBrand;
  member: { displayName: string; status: string; balance: number; memberSince: string; ref: string };
  tier: PublicTier | null;
  latestEarning: { kind: PublicKind; points: number; at: string } | null;
  promotion?: PublicPromotion | null;
  expiresIn: number;
}
export interface PublicActivityRow {
  key: string;
  kind: PublicKind;
  points: number;
  /** null for rows that are not ledger movements (tier promotions) */
  balanceAfter: number | null;
  at: string;
  /** the clinic's display name of the tier reached (tier_promotion rows only) */
  tierName?: string | null;
}
export interface PublicActivity {
  activity: PublicActivityRow[];
  total: number;
  page: number;
  pages: number;
}

/** Patient check-in (Phase 5). Only status + timestamps are ever returned — no ids, no staff text. */
export type PublicCheckInStatus = "pending" | "confirmed" | "rejected" | "cancelled" | "expired";
export interface PublicCheckIn {
  status: PublicCheckInStatus;
  requestedAt: string;
  expiresAt: string;
  resolvedAt: string | null;
}
export interface PublicCheckInState {
  enabled: boolean;
  checkIn: PublicCheckIn | null;
}
export type PublicVia = "qr" | "nfc" | "link";

const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const base = (slug: string) => `/public/loyalty/${encodeURIComponent(slug)}`;

export const fetchInfo = async (slug: string) => (await publicApi.get<PublicInfo>(base(slug))).data;
/**
 * Phase 9.1: `newlyEnrolled` is true ONLY on the response that created the membership (self-enrolment). Every later open of the same
 * number answers false, so the one-time enrolment moment can never replay and the app never has to guess.
 */
export interface IdentifyResult {
  token: string;
  expiresIn: number;
  newlyEnrolled: boolean;
}
export const identify = async (slug: string, phone: string): Promise<IdentifyResult> => {
  const d = (await publicApi.post<Partial<IdentifyResult>>(`${base(slug)}/identify`, { phone })).data;
  return { token: String(d.token), expiresIn: Number(d.expiresIn), newlyEnrolled: d.newlyEnrolled === true };
};
export const fetchMe = async (slug: string, token: string) => (await publicApi.get<PublicMe>(`${base(slug)}/me`, auth(token))).data;
export const fetchActivity = async (slug: string, token: string, page: number) => (await publicApi.get<PublicActivity>(`${base(slug)}/activity`, { ...auth(token), params: { page, limit: 10 } })).data;

export const fetchCheckIn = async (slug: string, token: string) => (await publicApi.get<PublicCheckInState>(`${base(slug)}/checkin`, auth(token))).data;
export const requestCheckIn = async (slug: string, token: string, via: PublicVia) =>
  (await publicApi.post<{ state: "created" | "already_pending" | "already_confirmed"; checkIn: PublicCheckIn }>(`${base(slug)}/checkin`, { via }, auth(token))).data;
export const cancelCheckIn = async (slug: string, token: string) => (await publicApi.post<PublicCheckInState>(`${base(slug)}/checkin/cancel`, {}, auth(token))).data;

/** How the patient reached the page, from the link the clinic printed on the QR code / programmed on the NFC tag (?src=qr|nfc). */
export function readVia(): PublicVia {
  try {
    const v = new URLSearchParams(window.location.search).get("src");
    return v === "qr" || v === "nfc" ? v : "link";
  } catch {
    return "link";
  }
}

export function publicError(e: unknown): { status?: number; code?: string; message?: string } {
  const ax = e as AxiosError<{ code?: string; message?: string }>;
  return { status: ax.response?.status, code: ax.response?.data?.code, message: ax.response?.data?.message };
}

/* session token: kept for this browser tab only (sessionStorage) and always short-lived server-side */
const KEY = (slug: string) => `lyl-session:${slug}`;
export const loadSession = (slug: string): string | null => {
  try {
    const raw = sessionStorage.getItem(KEY(slug));
    if (!raw) return null;
    const { token, exp } = JSON.parse(raw) as { token: string; exp: number };
    if (!token || exp < Date.now()) {
      sessionStorage.removeItem(KEY(slug));
      return null;
    }
    return token;
  } catch {
    return null;
  }
};
export const saveSession = (slug: string, token: string, expiresInSec: number) => {
  try {
    sessionStorage.setItem(KEY(slug), JSON.stringify({ token, exp: Date.now() + expiresInSec * 1000 }));
  } catch {
    /* private mode — the session just lives in memory */
  }
};
export const clearSession = (slug: string) => {
  try {
    sessionStorage.removeItem(KEY(slug));
  } catch {
    /* ignore */
  }
};

/* ============================================================
 * Rewards (Phase 6) — TEMPORARY, minimal patient side used to request a reward through the current phone-based session.
 * Only what the patient needs: reward name / description / cost, whether they can ask for it, and the status of their own
 * latest requests. No ids of clinics / accounts / patients, no staff text, no rejection reasons.
 * ============================================================ */
export type PublicRequestStatus = "pending" | "confirmed" | "rejected" | "reversed";
export interface PublicReward {
  id: string;
  name: string;
  description: string;
  pointsRequired: number;
  validUntil: string | null;
  canRedeem: boolean;
  missingPoints: number;
  pending: boolean;
}
export interface PublicRewardRequest {
  key: string;
  rewardName: string;
  points: number;
  status: PublicRequestStatus;
  requestedAt: string;
  resolvedAt: string | null;
}
export interface PublicRewardsState {
  balance: number;
  rewards: PublicReward[];
  requests: PublicRewardRequest[];
}
export const fetchRewards = async (slug: string, token: string) => (await publicApi.get<PublicRewardsState>(`${base(slug)}/rewards`, auth(token))).data;
/** Empty body on purpose: the server decides the cost, the clinic and the member. A request never moves points. */
export const requestReward = async (slug: string, token: string, rewardId: string) =>
  (await publicApi.post<{ state: "created" | "already_pending"; request: PublicRewardRequest; balance: number }>(`${base(slug)}/rewards/${encodeURIComponent(rewardId)}/redeem`, {}, auth(token))).data;
