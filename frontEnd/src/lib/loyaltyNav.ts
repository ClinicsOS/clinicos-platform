"use client";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { create } from "zustand";
import type { AnalyticsDays, RedemptionHistoryFilter, TierKey } from "@/lib/loyalty";

/**
 * ClinicOS Loyalty — navigation + shared UI state (Phase 8).
 *
 * The Loyalty product has one real route per section (browser back / forward / refresh / deep links all work):
 *   /loyalty  /loyalty/members  /loyalty/check-ins  /loyalty/rewards  /loyalty/redemptions
 *   /loyalty/transactions  /loyalty/tiers  /loyalty/analytics  /loyalty/settings
 * The pre-Phase-8 addresses (`/loyalty?tab=members`, `?tab=rewards&view=pending` …) are redirected by the overview page.
 *
 * The shell layout stays mounted while the user moves between sections, so filters / search text / pages / ranges kept in
 * the small store below survive the move. The store holds only UI preferences — never Loyalty data (that stays on the server).
 */

export const SECTIONS = ["overview", "members", "checkin", "rewards", "redemptions", "transactions", "tiers", "analytics", "settings"] as const;
export type LoyaltySection = (typeof SECTIONS)[number];

export const SECTION_PATH: Record<LoyaltySection, string> = {
  overview: "/loyalty",
  members: "/loyalty/members",
  checkin: "/loyalty/check-ins",
  rewards: "/loyalty/rewards",
  redemptions: "/loyalty/redemptions",
  transactions: "/loyalty/transactions",
  tiers: "/loyalty/tiers",
  analytics: "/loyalty/analytics",
  settings: "/loyalty/settings",
};

export function sectionOfPath(pathname: string | null | undefined): LoyaltySection {
  const seg = (pathname ?? "").replace(/\/+$/, "").split("/")[2] ?? "";
  switch (seg) {
    case "members":
      return "members";
    case "check-ins":
      return "checkin";
    case "rewards":
      return "rewards";
    case "redemptions":
      return "redemptions";
    case "transactions":
      return "transactions";
    case "tiers":
      return "tiers";
    case "analytics":
      return "analytics";
    case "settings":
      return "settings";
    default:
      return "overview";
  }
}

/** Old `/loyalty?tab=…&view=…` → new route (null = not a legacy address). */
export function legacyTarget(tab: string | null, view: string | null): { path: string; redemptionsView?: "pending" | "history" } | null {
  switch (tab) {
    case "members":
      return { path: SECTION_PATH.members };
    case "checkin":
      return { path: SECTION_PATH.checkin };
    case "rewards":
      return view === "pending" || view === "history" ? { path: SECTION_PATH.redemptions, redemptionsView: view } : { path: SECTION_PATH.rewards };
    case "tiers":
      return { path: SECTION_PATH.tiers };
    case "transactions":
      return { path: SECTION_PATH.transactions };
    case "settings":
      return { path: SECTION_PATH.settings };
    default:
      return null;
  }
}

export type VisualPref = "auto" | "lite";
export const VISUAL_KEY = "lyx-visual";
/** Where the shell remembers "I'm inside Loyalty" for this browser tab, so a refresh doesn't replay the entry splash. */
export const SHELL_FLAG = "lyl-shell-open";

const DEFAULT_REDEMPTION_FILTER: RedemptionHistoryFilter = { status: "", rewardId: "", q: "", from: "", to: "", page: 1 };

interface LoyaltyUi {
  /** "Enroll a patient" requested from another section (consumed once by the members screen). */
  enrollRequest: boolean;
  requestEnroll: () => void;
  clearEnroll: () => void;

  members: { search: string; tier: string; page: number };
  setMembers: (p: Partial<LoyaltyUi["members"]>) => void;

  transactions: { page: number; type: string };
  setTransactions: (p: Partial<LoyaltyUi["transactions"]>) => void;

  redemptionsView: "pending" | "history";
  setRedemptionsView: (v: "pending" | "history") => void;
  redemptionFilter: RedemptionHistoryFilter;
  setRedemptionFilter: (p: Partial<RedemptionHistoryFilter>) => void;

  checkInPage: number;
  setCheckInPage: (p: number) => void;

  rewardsFilter: "all" | "active" | "inactive";
  setRewardsFilter: (f: "all" | "active" | "inactive") => void;

  analyticsDays: AnalyticsDays;
  setAnalyticsDays: (d: AnalyticsDays) => void;

  /** Tiers screen: the sub-view (null → decided from the setup state on first open) and the tier selected on the path. */
  tiersView: "overview" | "configure" | "history" | null;
  setTiersView: (v: "overview" | "configure" | "history") => void;
  tiersSel: TierKey;
  setTiersSel: (k: TierKey) => void;

  /** Visual effects preference: "auto" adapts to the device; "lite" always uses the lightweight look. Remembered in this browser. */
  visual: VisualPref;
  setVisual: (v: VisualPref) => void;

  /** Forget filters / search / pages (the visual preference is kept). Called when the user leaves Loyalty. */
  reset: () => void;
}

const initial = {
  enrollRequest: false,
  members: { search: "", tier: "", page: 1 },
  transactions: { page: 1, type: "" },
  redemptionsView: "pending" as const,
  redemptionFilter: DEFAULT_REDEMPTION_FILTER,
  checkInPage: 1,
  rewardsFilter: "all" as const,
  analyticsDays: 30 as AnalyticsDays,
  tiersView: null as "overview" | "configure" | "history" | null,
  tiersSel: "tier1" as TierKey,
};

export const useLoyaltyUi = create<LoyaltyUi>()((set) => ({
  ...initial,
  requestEnroll: () => set({ enrollRequest: true }),
  clearEnroll: () => set({ enrollRequest: false }),
  setMembers: (p) => set((s) => ({ members: { ...s.members, ...p } })),
  setTransactions: (p) => set((s) => ({ transactions: { ...s.transactions, ...p } })),
  setRedemptionsView: (v) => set({ redemptionsView: v }),
  setRedemptionFilter: (p) => set((s) => ({ redemptionFilter: { ...s.redemptionFilter, ...p } })),
  setCheckInPage: (p) => set({ checkInPage: p }),
  setRewardsFilter: (f) => set({ rewardsFilter: f }),
  setAnalyticsDays: (d) => set({ analyticsDays: d }),
  setTiersView: (v) => set({ tiersView: v }),
  setTiersSel: (k) => set({ tiersSel: k }),
  visual: "auto",
  setVisual: (v) => {
    try {
      window.localStorage.setItem(VISUAL_KEY, v);
    } catch {
      /* storage blocked — the choice still applies for this session */
    }
    set({ visual: v });
  },
  reset: () => set({ ...initial, redemptionFilter: { ...DEFAULT_REDEMPTION_FILTER } }),
}));

/** Go to a Loyalty section (a real navigation — history, back / forward and deep links all work). */
export function useLoyaltyGo() {
  const router = useRouter();
  const requestEnroll = useLoyaltyUi((s) => s.requestEnroll);
  return useCallback(
    (section: LoyaltySection, enroll = false) => {
      if (enroll) requestEnroll();
      router.push(SECTION_PATH[section]);
    },
    [router, requestEnroll]
  );
}
