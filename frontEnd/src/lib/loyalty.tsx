"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/store/auth";
import type { Clinic, Subscription } from "@/lib/types";

/**
 * ClinicOS Loyalty — clinic-side data layer (Phase 2).
 * Everything shown comes from the server; nothing is optimistic. Entitlement is read from GET /subscription
 * (`addons.loyalty.enabled`) — that only decides what to SHOW; the server enforces it on every Loyalty request.
 */

/* ---------- types (mirror backEnd/src/controllers/loyaltyController.ts DTOs) ---------- */

export type LoyaltyTransactionType =
  | "earn_visit"
  | "earn_spending"
  | "manual_credit"
  | "manual_debit"
  | "reward_redemption"
  | "expiration"
  | "reversal"
  | "correction";

export interface LoyaltySettings {
  program: { enabled: boolean };
  branding: { displayName: string | null };
  /** Patient check-in (Phase 5): off until the clinic turns it on. */
  checkin: { enabled: boolean };
  earning: {
    visits: { enabled: boolean; pointsPerVisit: number | null };
    spending: { enabled: boolean; spendAmount: number | null; pointsPerSpendAmount: number | null; activatedAt: string | null };
  };
  redemption: { enabled: boolean; minimumPoints: number | null };
  tiers: { enabled: boolean; progressionMetric: TierMetric | null };
  expiration: { enabled: boolean; months: number | null };
  antiAbuse: { minHoursBetweenVisitEarnings: number | null; maxPointsPerDay: number | null };
  updatedAt: string | null;
}
export interface SettingsResponse {
  settings: LoyaltySettings;
  persisted: boolean;
  editable: string[];
  canConfigure: boolean;
  limits?: { pointsPerVisit: { min: number; max: number }; pointsPerSpendAmount: { min: number; max: number }; spendAmount: { min: number; max: number } };
  earningChanged?: boolean;
  message?: string;
}
export interface LoyaltyOverview {
  members: number;
  transactions: number;
  pointsOutstanding: number;
  pointsIssued: { total: number; visits: number; spending: number; manual: number };
  recent: LoyaltyTx[];
  program: { enabled: boolean; displayName: string | null };
  earningConfigured: boolean;
  earning: { visits: boolean; spending: boolean };
}

export interface SettingsPatchBody {
  program?: { enabled: boolean };
  branding?: { displayName: string | null };
  checkin?: { enabled: boolean };
  earning?: {
    visits?: { enabled?: boolean; pointsPerVisit?: number | null };
    spending?: { enabled?: boolean; spendAmount?: number | null; pointsPerSpendAmount?: number | null };
  };
}
export interface LoyaltyMember {
  id: string;
  patientId: string;
  status: "active" | "suspended";
  pointsBalance: number;
  lifetimePointsEarned: number;
  lifetimePointsRedeemed: number;
  joinedAt: string;
  lastActivityAt: string | null;
  patient: { id: string; fullName: string; phone: string; fileNumber: number; isArchived: boolean } | null;
  /** Phase 7: null while tiers are off / not fully configured. */
  tier: TierBrief | null;
}
export interface LoyaltyTx {
  id: string;
  accountId: string;
  patientId: string;
  patient: { id: string; fullName: string; fileNumber: number } | null;
  type: LoyaltyTransactionType;
  pointsDelta: number;
  balanceBefore: number;
  balanceAfter: number;
  sourceType: string;
  sourceId: string | null;
  reason: string | null;
  metadata: Record<string, string | number | boolean | null> | null;
  reversesTransactionId: string | null;
  createdBy: { id: string; name: string | null } | null;
  createdAt: string;
}
export interface Paged {
  total: number;
  page: number;
  limit: number;
  pages: number;
}
export interface MembersResponse extends Paged {
  members: LoyaltyMember[];
  tiersEnabled: boolean;
}
export interface TransactionsResponse extends Paged {
  transactions: LoyaltyTx[];
}
/* ---------- check-in (Phase 5) ---------- */

export type CheckInStatus = "pending" | "confirmed" | "rejected" | "cancelled" | "expired";
export interface LinkableAppointment {
  id: string;
  startAt: string;
  status: string;
  visitType: string | null;
  doctorName: string | null;
}
export interface CheckInRow {
  id: string;
  accountId: string;
  status: CheckInStatus;
  via: "qr" | "nfc" | "link";
  requestedAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  resolvedBy: { id: string; name: string | null } | null;
  appointmentId: string | null;
  patient: { id: string; fullName: string; phone: string; fileNumber: number } | null;
  balance: number | null;
  /** Pending rows only: the patient's appointments close to now that reception may link. */
  appointments: LinkableAppointment[];
}
export interface CheckInPendingResponse {
  scope: "pending";
  enabled: boolean;
  checkIns: CheckInRow[];
  total: number;
}
export interface CheckInRecentResponse {
  scope: "recent";
  enabled: boolean;
  checkIns: CheckInRow[];
  total: number;
  page: number;
  pages: number;
  limit: number;
}
export interface CheckInSummary {
  pending: number;
  enabled: boolean;
}

export interface PatientLite {
  _id: string;
  fullName: string;
  phone: string;
  fileNumber: number;
}

/* ---------- language helpers ---------- */

/** Tiny bilingual helper: t("English", "العربية"). Keeps each string next to where it is used. */
export function useLT() {
  const { lang } = useI18n();
  const t = (en: string, ar: string) => (lang === "ar" ? ar : en);
  const locale = lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB";
  const date = (d: string | Date | null | undefined, withTime = false) =>
    d
      ? new Date(d).toLocaleString(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" })
      : "—";
  return { t, lang, date, isRtl: lang === "ar" };
}
export const fmtNum = (n: number) => n.toLocaleString("en-US");

export const apiError = (e: unknown, fallback: string): { message: string; code?: string; status?: number } => {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { message?: string; code?: string } | undefined;
    return { message: d?.message || fallback, code: d?.code, status: e.response?.status };
  }
  return { message: fallback };
};

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/* ---------- entitlement (what to SHOW — the server is the real gate) ---------- */

export function useLoyaltyEntitlement() {
  const token = useAuth((s) => s.token);
  const q = useQuery({
    queryKey: ["subscription"],
    queryFn: async () => (await api.get<Subscription>("/subscription")).data,
    enabled: !!token,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  return { enabled: !!q.data?.addons?.loyalty?.enabled, isLoading: q.isLoading, status: q.data?.addons?.loyalty?.status };
}

/* ---------- queries ---------- */

const get = async <T,>(url: string, params?: Record<string, unknown>) => (await api.get<T>(`/loyalty${url}`, { params })).data;

export const useLoyaltyOverview = (enabled = true) =>
  useQuery({ queryKey: ["loyalty", "overview"], queryFn: () => get<LoyaltyOverview>("/overview"), enabled, staleTime: 10_000, retry: false });

export const useLoyaltySettings = () =>
  useQuery({ queryKey: ["loyalty", "settings"], queryFn: () => get<SettingsResponse>("/settings"), staleTime: 10_000, retry: false });

export const useLoyaltyMembers = (page: number, search: string, limit = 10, tier = "") =>
  useQuery({
    queryKey: ["loyalty", "members", { page, search, limit, tier }],
    queryFn: () => get<MembersResponse>("/members", { page, limit, ...(search ? { search } : {}), ...(tier ? { tier } : {}) }),
    placeholderData: (prev) => prev,
    staleTime: 5_000,
    retry: false,
  });

export const useMemberTransactions = (id: string | null, page: number) =>
  useQuery({
    queryKey: ["loyalty", "member-tx", id, page],
    queryFn: () => get<TransactionsResponse>(`/members/${id}/transactions`, { page, limit: 8 }),
    enabled: !!id,
    staleTime: 5_000,
    retry: false,
  });

export const useLoyaltyTransactions = (page: number, type = "") =>
  useQuery({
    queryKey: ["loyalty", "transactions", page, type],
    queryFn: () => get<TransactionsResponse>("/transactions", { page, limit: 15, ...(type ? { type } : {}) }),
    placeholderData: (prev) => prev,
    staleTime: 5_000,
    retry: false,
  });

/* Check-in queue: polled while the tab is visible (React Query pauses background tabs by default). */
export const useCheckInSummary = (enabled = true) =>
  useQuery({
    queryKey: ["loyalty", "checkins", "summary"],
    queryFn: () => get<CheckInSummary>("/checkins/summary"),
    enabled,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
  });

export const useCheckInsPending = (enabled = true) =>
  useQuery({
    queryKey: ["loyalty", "checkins", "pending"],
    queryFn: () => get<CheckInPendingResponse>("/checkins", { scope: "pending" }),
    enabled,
    staleTime: 3_000,
    refetchInterval: 8_000,
    retry: false,
  });

export const useCheckInsRecent = (page: number) =>
  useQuery({
    queryKey: ["loyalty", "checkins", "recent", page],
    queryFn: () => get<CheckInRecentResponse>("/checkins", { scope: "recent", page, limit: 10 }),
    staleTime: 5_000,
    retry: false,
  });

/* ---------- mutations (cache is updated only from the server's response) ---------- */

export function useSaveLoyaltySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SettingsPatchBody) => (await api.patch<SettingsResponse>("/loyalty/settings", body)).data,
    onSuccess: (data) => {
      qc.setQueryData(["loyalty", "settings"], data);
      qc.invalidateQueries({ queryKey: ["loyalty", "overview"] });
    },
  });
}

export function useEnrollMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patientId: string) => (await api.post<{ member: LoyaltyMember; message: string }>("/loyalty/members", { patientId })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loyalty", "members"] });
      qc.invalidateQueries({ queryKey: ["loyalty", "overview"] });
      qc.invalidateQueries({ queryKey: ["loyalty", "activity"] });
      qc.invalidateQueries({ queryKey: ["loyalty", "analytics"] });
    },
  });
}

/** Reception answers a check-in request. Never awards points and never changes the appointment (server rule). */
export function useResolveCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; action: "confirm" | "reject"; appointmentId?: string | null }) =>
      (await api.post<{ checkIn: CheckInRow; message: string }>(`/loyalty/checkins/${v.id}/${v.action}`, v.action === "confirm" ? { appointmentId: v.appointmentId ?? null } : {})).data,
    // Success AND "already handled / expired" (409) both mean the queue changed → refetch from the server.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["loyalty", "checkins"] });
      qc.invalidateQueries({ queryKey: ["loyalty", "activity"] });
      qc.invalidateQueries({ queryKey: ["loyalty", "analytics"] });
    },
  });
}

export const searchPatients = async (search: string) =>
  (await api.get<{ patients: PatientLite[] }>("/patients", { params: { search } })).data.patients;

/** Manual credit / debit (owner, doctor). The cache is refreshed only from the server's response. */
export function useAdjustPoints() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { memberId: string; direction: "credit" | "debit"; points: number; reason: string }) =>
      (await api.post<{ member: LoyaltyMember; transaction: LoyaltyTx; message: string }>(`/loyalty/members/${v.memberId}/adjust`, { direction: v.direction, points: v.points, reason: v.reason })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loyalty"] });
    },
  });
}

/** Plural-aware "points" in English / Arabic (digits stay Western). */
export function pointsWord(n: number, lang: string): string {
  if (lang === "ar") return n === 1 ? "نقطة واحدة" : n === 2 ? "نقطتان" : n >= 3 && n <= 10 ? `${fmtNum(n)} نقاط` : `${fmtNum(n)} نقطة`;
  return `${fmtNum(n)} ${n === 1 ? "point" : "points"}`;
}

/* ============================================================
 * Rewards + redemptions (Phase 6)
 * Mirrors backEnd/src/services/loyaltyRewards.ts. Everything shown comes from the server; nothing is optimistic, and the
 * client never sends an amount, a balance, an account or a clinic id — only the reward's own fields and a reason.
 * ============================================================ */

export interface RewardCounts {
  pending: number;
  confirmed: number;
  rejected: number;
  reversed: number;
  total: number;
}
export interface Reward {
  id: string;
  name: string;
  description: string;
  pointsRequired: number;
  status: "active" | "inactive";
  validFrom: string | null;
  validUntil: string | null;
  window: "open" | "scheduled" | "expired";
  createdAt: string;
  updatedAt: string;
  counts?: RewardCounts;
}
export interface RewardsResponse {
  rewards: Reward[];
  canManage: boolean;
}
export type RedemptionStatus = "pending" | "confirmed" | "rejected" | "reversed";
export interface RedemptionRow {
  id: string;
  status: RedemptionStatus;
  /** A confirm / reversal is running right now. */
  busy: boolean;
  rewardId: string;
  /** Name + cost copied when the member asked — never changes. */
  rewardNameSnapshot: string;
  pointsCostSnapshot: number;
  currentReward: { name: string; pointsRequired: number; status: string } | null;
  requestedAt: string;
  confirmedAt: string | null;
  rejectedAt: string | null;
  reversedAt: string | null;
  confirmedBy: { id: string; name: string | null } | null;
  rejectedBy: { id: string; name: string | null } | null;
  reversedBy: { id: string; name: string | null } | null;
  rejectionReason: string | null;
  reversalReason: string | null;
  transactionId: string | null;
  reversalTransactionId: string | null;
  accountId: string;
  patient: { id: string; fullName: string; phone: string; fileNumber: number } | null;
  balance: number | null;
  balanceAfter: number | null;
  canAfford: boolean | null;
}
export interface RedemptionPendingResponse {
  scope: "pending";
  redemptions: RedemptionRow[];
  total: number;
}
export interface RedemptionHistoryResponse {
  scope: "history";
  redemptions: RedemptionRow[];
  total: number;
  page: number;
  pages: number;
  limit: number;
}
export interface RewardsSummary {
  activeRewards: number;
  pending: number;
  confirmed: number;
  pointsRedeemed: number;
  recent: RedemptionRow[];
}
export interface RedemptionHistoryFilter {
  status: "" | RedemptionStatus;
  rewardId: string;
  q: string;
  from: string;
  to: string;
  page: number;
}
/** What the server confirms after a confirm / reversal — the values shown in the success animation. */
export interface RedemptionOutcome {
  redemption: RedemptionRow;
  points: number;
  balanceBefore: number;
  balanceAfter: number;
  message: string;
}
export interface RewardFormBody {
  name: string;
  description: string;
  pointsRequired: number;
  validFrom: string | null;
  validUntil: string | null;
}

export const useRewards = (enabled = true) =>
  useQuery({ queryKey: ["loyalty", "rewards", "list"], queryFn: () => get<RewardsResponse>("/rewards"), enabled, staleTime: 5_000, retry: false });

/** Header numbers, tab badge and sidebar dot — polled lightly while visible. */
export const useRewardsSummary = (enabled = true) =>
  useQuery({ queryKey: ["loyalty", "rewards", "summary"], queryFn: () => get<RewardsSummary>("/rewards/summary"), enabled, staleTime: 5_000, refetchInterval: 15_000, retry: false });

export const useRedemptionsPending = (enabled = true) =>
  useQuery({
    queryKey: ["loyalty", "redemptions", "pending"],
    queryFn: () => get<RedemptionPendingResponse>("/redemptions", { scope: "pending" }),
    enabled,
    staleTime: 3_000,
    refetchInterval: 8_000,
    retry: false,
  });

export const useRedemptionHistory = (f: RedemptionHistoryFilter) =>
  useQuery({
    queryKey: ["loyalty", "redemptions", "history", f],
    queryFn: () =>
      get<RedemptionHistoryResponse>("/redemptions", {
        scope: "history",
        page: f.page,
        limit: 10,
        ...(f.status ? { status: f.status } : {}),
        ...(f.rewardId ? { rewardId: f.rewardId } : {}),
        ...(f.q ? { q: f.q } : {}),
        ...(f.from ? { from: f.from } : {}),
        ...(f.to ? { to: f.to } : {}),
      }),
    staleTime: 5_000,
    retry: false,
    placeholderData: (prev) => prev,
  });

const refreshRewards = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ["loyalty", "rewards"] });
  qc.invalidateQueries({ queryKey: ["loyalty", "redemptions"] });
  qc.invalidateQueries({ queryKey: ["loyalty", "activity"] });
  qc.invalidateQueries({ queryKey: ["loyalty", "analytics"] });
};

/** Create (no id) or edit (id) a reward. owner / doctor only — the server enforces it. */
export function useSaveReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id?: string; body: RewardFormBody }) =>
      v.id ? (await api.patch<{ reward: Reward; message: string }>(`/loyalty/rewards/${v.id}`, v.body)).data : (await api.post<{ reward: Reward; message: string }>("/loyalty/rewards", v.body)).data,
    onSuccess: () => refreshRewards(qc),
  });
}
export function useRewardStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; status: "active" | "inactive" }) => (await api.post<{ reward: Reward; message: string }>(`/loyalty/rewards/${v.id}/${v.status === "active" ? "activate" : "deactivate"}`, {})).data,
    onSuccess: () => refreshRewards(qc),
  });
}
export function useDeleteReward() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.delete<{ message: string }>(`/loyalty/rewards/${id}`)).data,
    onSuccess: () => refreshRewards(qc),
  });
}
/** Body is intentionally EMPTY: the amount deducted is the server-side snapshot. */
export function useConfirmRedemption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await api.post<RedemptionOutcome>(`/loyalty/redemptions/${id}/confirm`, {})).data,
    // success AND 409s (already handled / not enough points) both mean the data changed → refetch from the server
    onSettled: () => {
      refreshRewards(qc);
      qc.invalidateQueries({ queryKey: ["loyalty"] });
    },
  });
}
export function useRejectRedemption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; reason: string }) => (await api.post<{ redemption: RedemptionRow; message: string }>(`/loyalty/redemptions/${v.id}/reject`, v.reason.trim() ? { reason: v.reason.trim() } : {})).data,
    onSettled: () => refreshRewards(qc),
  });
}
export function useReverseRedemption() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id: string; reason: string }) => (await api.post<RedemptionOutcome>(`/loyalty/redemptions/${v.id}/reverse`, { reason: v.reason.trim() })).data,
    onSettled: () => {
      refreshRewards(qc);
      qc.invalidateQueries({ queryKey: ["loyalty"] });
    },
  });
}

/** Clinic-local (Amman) calendar day of an ISO instant → "YYYY-MM-DD", for date inputs. */
export const ammanDay = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Amman" }) : "");

/* ============================================================
 * Tiers & progression (Phase 7)
 * Mirrors backEnd/src/controllers/loyaltyTiersController.ts + services/loyaltyTiers.ts. Tiers are identified by their four STABLE
 * keys (tier1…tier4); the clinic-editable display name is only ever a label. Every number shown (progress %, remaining, counts)
 * is calculated by the server — the client never decides a member's tier. The only client-side calculation is the
 * clearly-labelled "try a value" helper in the settings editor, which uses the same published formula on a typed number.
 * ============================================================ */

export const TIER_KEYS = ["tier1", "tier2", "tier3", "tier4"] as const;
export type TierKey = (typeof TIER_KEYS)[number];
export const TIER_METRICS = ["lifetime_points", "completed_visits", "lifetime_spending"] as const;
export type TierMetric = (typeof TIER_METRICS)[number];
export type TierUnit = "points" | "visits" | "jod";
export const tierRankOf = (k: TierKey) => TIER_KEYS.indexOf(k) + 1;
export const isTierKey = (v: unknown): v is TierKey => typeof v === "string" && (TIER_KEYS as readonly string[]).includes(v);

export interface TierBenefit {
  title: string;
  description: string | null;
}
export interface TierSlotDto {
  key: TierKey;
  rank: number;
  name: string;
  defaultName: string;
  /** display units (points / visits / JOD); null = not set yet */
  threshold: number | null;
  description: string | null;
  benefits: TierBenefit[];
}
export interface TierConfigDto {
  enabled: boolean;
  /** enabled AND metric chosen AND thresholds complete & ordered */
  usable: boolean;
  progressionMetric: TierMetric | null;
  unit: TierUnit | null;
  rulesVersion: number;
  tiers: TierSlotDto[];
}
export interface TierLimits {
  nameMin: number;
  nameMax: number;
  descriptionMax: number;
  benefitsMax: number;
  benefitTitleMin: number;
  benefitTitleMax: number;
  benefitDescriptionMax: number;
  maxThreshold: Record<TierMetric, number>;
  metrics: { key: TierMetric; unit: TierUnit }[];
}
export interface RecalcResult {
  processed: number;
  promoted: number;
  demoted: number;
  initial: number;
  unchanged: number;
  countersCorrected: number;
  errors: number;
  distribution: Record<TierKey, number>;
  done: boolean;
  nextCursor: string | null;
  remaining: number;
  dryRun: boolean;
}
export interface TiersConfigResponse {
  config: TierConfigDto;
  limits: TierLimits;
  canConfigure: boolean;
  rulesChanged?: boolean;
  recalculation?: RecalcResult | null;
  message?: string;
}
export interface TierConfigBody {
  enabled: boolean;
  progressionMetric: TierMetric | null;
  tiers: Record<TierKey, { name: string; threshold: number | null; description: string | null; benefits: { title: string; description: string | null }[] }>;
}
export interface TierPreviewImpact {
  evaluated: number;
  promoted: number;
  demoted: number;
  same: number;
  unreconciled: number;
  distribution: Record<TierKey, number>;
  exact: boolean;
  truncated: boolean;
}

/** Compact tier block on every member row. */
export interface TierBrief {
  key: TierKey;
  name: string;
  rank: number;
  metric: TierMetric;
  unit: TierUnit;
  metricValue: number;
  nextTierName: string | null;
  nextTierThreshold: number | null;
  remaining: number;
  /** 0…99 until the next tier is reached; 100 at the top tier */
  progressPercent: number;
  isTopTier: boolean;
  /** the stored tier isn't saved yet — the shown one is computed and a recalculation will persist it */
  pending: boolean;
}
export interface MemberTierFull {
  metric: TierMetric;
  unit: TierUnit;
  metricValue: number;
  currentTierKey: TierKey;
  currentTierName: string;
  currentTierRank: number;
  currentTierThreshold: number;
  highestTierKey: TierKey;
  highestTierName: string;
  nextTierKey: TierKey | null;
  nextTierName: string | null;
  nextTierThreshold: number | null;
  remaining: number;
  progressPercent: number;
  isTopTier: boolean;
  pending: boolean;
  reconciled: boolean;
  description: string | null;
  benefits: TierBenefit[];
  changedAt: string | null;
}
export interface TierHistoryRow {
  id: string;
  accountId: string;
  patient?: { id: string; fullName: string; fileNumber: number };
  fromTierKey: TierKey | null;
  toTierKey: TierKey;
  /** names AS THEY WERE at that moment */
  fromTierName: string | null;
  toTierName: string;
  toTierNameNow: string;
  direction: "promotion" | "demotion" | "initial";
  source: string;
  metric: TierMetric;
  metricValue: number;
  changedAt: string;
}
export interface TierHistoryResponse extends Omit<Paged, "limit"> {
  history: TierHistoryRow[];
}
export interface TierAnalytics {
  enabled: boolean;
  metric: TierMetric | null;
  totalMembers: number;
  tiers: { key: TierKey; name: string; count: number; percent: number; promotionsInWindow: number }[];
  unassigned: number;
  topTier: { key: TierKey; name: string; count: number };
  promotions: { windowDays: number; count: number };
  nearNext: { total: number; percent: number; byTier: { key: TierKey; count: number }[] } | null;
  recentPromotions: TierHistoryRow[];
  needsAttention: { unreconciled: number; awaitingRecalculation: number };
}
export interface MemberDetailResponse {
  member: LoyaltyMember;
  tier: MemberTierFull | null;
  tierHistory: TierHistoryRow[];
  points: { available: number; lifetimeEarned: number };
}

export const useTiersConfig = () =>
  useQuery({ queryKey: ["loyalty", "tiers", "config"], queryFn: () => get<TiersConfigResponse>("/tiers/config"), staleTime: 10_000, retry: false });

export const useTierAnalytics = (enabled = true) =>
  useQuery({ queryKey: ["loyalty", "tiers", "analytics"], queryFn: () => get<TierAnalytics>("/tiers/analytics"), enabled, staleTime: 10_000, retry: false });

export const useTierHistory = (page: number, enabled = true) =>
  useQuery({
    queryKey: ["loyalty", "tiers", "history", page],
    queryFn: () => get<TierHistoryResponse>("/tiers/history", { page, limit: 10 }),
    enabled,
    staleTime: 5_000,
    retry: false,
    placeholderData: (prev) => prev,
  });

export const useMemberDetail = (id: string | null) =>
  useQuery({ queryKey: ["loyalty", "member", id], queryFn: () => get<MemberDetailResponse>(`/members/${id}`), enabled: !!id, staleTime: 3_000, retry: false });

/** Save the whole tier configuration (owner / doctor). Any data a rule change affects is refetched from the server afterwards. */
export function useSaveTiersConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: TierConfigBody) => (await api.put<TiersConfigResponse>("/loyalty/tiers/config", body)).data,
    onSuccess: (data) => {
      qc.setQueryData(["loyalty", "tiers", "config"], data);
      qc.invalidateQueries({ queryKey: ["loyalty", "settings"] });
      qc.invalidateQueries({ queryKey: ["loyalty", "members"] });
      qc.invalidateQueries({ queryKey: ["loyalty", "member"] });
      qc.invalidateQueries({ queryKey: ["loyalty", "tiers", "analytics"] });
      qc.invalidateQueries({ queryKey: ["loyalty", "tiers", "history"] });
    },
  });
}

/** Exact effect of a proposed configuration on existing members — nothing is written. */
export function usePreviewTiers() {
  return useMutation({
    mutationFn: async (body: TierConfigBody) => (await api.post<{ impact: TierPreviewImpact; currentlyEnabled: boolean }>("/loyalty/tiers/preview", body)).data,
  });
}

/** One bounded batch of the re-evaluation / reconciliation; call again with `cursor` while `done` is false. */
export function useRecalculateTiers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { mode: "tiers" | "full"; dryRun: boolean; cursor?: string | null }) =>
      (await api.post<{ result: RecalcResult }>("/loyalty/tiers/recalculate", { mode: v.mode, dryRun: v.dryRun, ...(v.cursor ? { cursor: v.cursor } : {}) })).data,
    onSettled: (_d, _e, v) => {
      if (v?.dryRun) return;
      qc.invalidateQueries({ queryKey: ["loyalty", "members"] });
      qc.invalidateQueries({ queryKey: ["loyalty", "member"] });
      qc.invalidateQueries({ queryKey: ["loyalty", "tiers"] });
    },
  });
}

/* ---------- display helpers ---------- */

export const fmtMetricValue = (n: number, unit: TierUnit | null) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: unit === "jod" ? 3 : 0 });

/** "1,250 points" · "12 visits" · "350.5 JOD" — digits stay Western in both languages, like the rest of Loyalty. */
export function useTierText() {
  const { t } = useLT();
  const metricName = (m: TierMetric | null) => (m === "lifetime_points" ? t("Lifetime points", "إجمالي النقاط المكتسبة") : m === "completed_visits" ? t("Completed visits", "الزيارات المكتملة") : m === "lifetime_spending" ? t("Lifetime spending", "إجمالي الإنفاق") : t("Not set", "غير محدد"));
  const unitName = (u: TierUnit | null, n: number) =>
    u === "points" ? t(n === 1 ? "point" : "points", "نقطة") : u === "visits" ? t(n === 1 ? "visit" : "visits", n === 1 ? "زيارة" : "زيارات") : u === "jod" ? t("JOD", "دينار") : "";
  const value = (n: number, u: TierUnit | null) => `${fmtMetricValue(n, u)} ${unitName(u, n)}`.trim();
  return { metricName, unitName, value };
}

/** Which promotions this browser has already celebrated — memory fallback when storage is blocked, so nothing replays. */
const seenMemory = new Set<string>();
export function hasSeenCelebration(id: string): boolean {
  if (seenMemory.has(id)) return true;
  try {
    return window.localStorage.getItem(`lyl-celebrated:${id}`) === "1";
  } catch {
    return false;
  }
}
export function markCelebrated(id: string) {
  seenMemory.add(id);
  try {
    window.localStorage.setItem(`lyl-celebrated:${id}`, "1");
  } catch {
    /* storage blocked — the in-memory set still prevents a replay in this session */
  }
}


/* ============================================================
 * Insights (Phase 8) — mirrors backEnd/src/services/loyaltyInsights.ts. Read-only. Everything is a real stored record or a plain
 * count / sum of stored records; the screens never estimate, extrapolate or fill gaps with sample data.
 * ============================================================ */

export type ActivityKind = "new_member" | "points_earned" | "points_adjusted" | "points_reversed" | "checkin_confirmed" | "reward_redeemed" | "reward_reversed" | "member_promoted";
export interface ActivityEvent {
  /** stable per underlying record + kind (used to animate only genuinely new events) */
  id: string;
  kind: ActivityKind;
  at: string;
  patient: { id: string; fullName: string; fileNumber: number } | null;
  /** signed points change when the event moved points */
  points: number | null;
  /** reward / tier name as stored at the time */
  label: string | null;
  tierKey: string | null;
}
export interface ActivityResponse {
  events: ActivityEvent[];
  serverTime: string;
}
export type AnalyticsDays = 7 | 30 | 90;
export interface LoyaltyAnalytics {
  days: AnalyticsDays;
  timeZone: string;
  truncated: { transactions: boolean; checkIns: boolean; members: boolean; redemptions: boolean };
  series: { dates: string[]; issued: number[]; redeemed: number[]; returned: number[]; checkIns: number[]; checkInsConfirmed: number[]; newMembers: number[] };
  totals: {
    points: { issued: number; redeemed: number; returned: number; byType: Record<string, { count: number; points: number }> };
    checkIns: { total: number; confirmed: number; rejected: number; expired: number; cancelled: number; pending: number; byVia: Record<string, number>; confirmedShareOfResolved: number | null };
    newMembers: number;
    redemptions: { requested: number; confirmed: number; rejected: number; reversed: number; pending: number };
  };
  rewards: { rewardId: string; name: string; requested: number; confirmed: number; reversed: number; rejected: number; pending: number; pointsRedeemed: number }[];
}
export interface MemberInsights {
  balance: number;
  checkIns: { id: string; status: CheckInStatus; via: "qr" | "nfc" | "link"; requestedAt: string | null; resolvedAt: string | null }[];
  redemptions: { id: string; status: RedemptionStatus; rewardName: string; points: number; requestedAt: string | null; confirmedAt: string | null; reversedAt: string | null }[];
  rewards: {
    openCount: number;
    affordableCount: number;
    affordable: { id: string; name: string; pointsRequired: number }[];
    next: { id: string; name: string; pointsRequired: number; remaining: number } | null;
  };
}

/** The live activity stream — refreshed lightly while the tab is visible (React Query pauses hidden tabs). */
export const useLoyaltyActivity = (enabled = true, limit = 12) =>
  useQuery({
    queryKey: ["loyalty", "activity", limit],
    queryFn: () => get<ActivityResponse>("/activity", { limit }),
    enabled,
    staleTime: 10_000,
    refetchInterval: 20_000,
    retry: false,
  });

export const useLoyaltyAnalytics = (days: AnalyticsDays) =>
  useQuery({
    queryKey: ["loyalty", "analytics", days],
    queryFn: () => get<LoyaltyAnalytics>("/analytics", { days }),
    staleTime: 30_000,
    retry: false,
    placeholderData: (prev) => prev,
  });

export const useMemberInsights = (id: string | null) =>
  useQuery({ queryKey: ["loyalty", "member-insights", id], queryFn: () => get<MemberInsights>(`/members/${id}/insights`), enabled: !!id, staleTime: 5_000, retry: false });

/** Pending redemption count — the same cached query the ClinicOS sidebar dot uses (one request, shared). */
export const usePendingRedemptionCount = (enabled = true) =>
  useQuery({
    queryKey: ["loyalty", "rewards", "pending-count"],
    queryFn: () => get<{ pending: number }>("/rewards/pending-count"),
    enabled,
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: false,
  });

/** Compact "2 min ago" text. Falls back to the date for anything older than a week. */
export function useAgo() {
  const { t, date } = useLT();
  return (iso: string | null | undefined, now = Date.now()) => {
    if (!iso) return "—";
    const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
    if (m < 1) return t("just now", "الآن");
    if (m < 60) return t(`${m} min ago`, `قبل ${m} دقيقة`);
    const h = Math.floor(m / 60);
    if (h < 24) return t(`${h} h ago`, `قبل ${h} ساعة`);
    const d = Math.floor(h / 24);
    if (d < 8) return t(`${d} d ago`, `قبل ${d} يوم`);
    return date(iso);
  };
}


/* ---------- shared page helpers (Phase 8) ---------- */

/** What the signed-in role may do inside Loyalty (the server enforces the same rules on every request). */
export function useLoyaltyRoles() {
  const role = useAuth((s) => s.user?.role);
  return {
    canConfigure: role === "owner" || role === "doctor",
    canEnroll: role === "owner" || role === "doctor" || role === "receptionist",
    canAdjust: role === "owner" || role === "doctor", // manual balance changes: never reception by default
  };
}

/** The clinic's name and the program's display name (same cached queries the shell uses). */
export function useLoyaltyBrand() {
  const clinic = useQuery({ queryKey: ["clinic"], queryFn: async () => (await api.get<Clinic>("/clinic")).data, staleTime: 30_000 });
  const overview = useLoyaltyOverview(true);
  const clinicName = clinic.data?.name ?? "ClinicOS";
  const programName = overview.data?.program.displayName ?? null;
  return { clinicName, programName, brand: programName || clinicName };
}
