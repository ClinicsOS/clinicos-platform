"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { hasSeenCelebration, markCelebrated } from "@/lib/loyalty";
import {
  cancelCheckIn,
  fetchActivity,
  fetchCheckIn,
  fetchMe,
  fetchRewards,
  publicError,
  readVia,
  requestCheckIn,
  requestReward,
  type PublicActivityRow,
  type PublicCheckIn,
  type PublicMe,
  type PublicPromotion,
  type PublicRewardRequest,
  type PublicRewardsState,
} from "@/lib/loyaltyPublic";

/**
 * The patient app's data layer (Phase 9) — ONE place that talks to the public Loyalty API for a signed-in patient.
 *
 *  • Everything comes from the server. Balance, tier, progress, rewards, eligibility, requests, check-in state are never computed or
 *    invented here, and nothing is cached on disk: the data lives in memory for this page view only (the service worker never sees it).
 *  • Polling is gentle and only while the page is visible AND online: the card re-reads every 30 s, rewards every 8 s only while a request
 *    is pending, check-in every 6 s only while pending. A 429 pauses polling for a minute.
 *  • A change is announced only when the SERVER's number really changed between two reads (balance moved, a new promotion exists, a request
 *    was confirmed) — that is what drives the points-change, tier-transformation and redemption-complete moments.
 */

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; code: string; status?: number };

export interface BalanceEvent {
  id: number;
  from: number;
  to: number;
}
export interface PatientData {
  me: PublicMe | null;
  rewards: PublicRewardsState | null;
  rewardsError: boolean;
  activity: { rows: PublicActivityRow[]; page: number; pages: number; total: number; loading: boolean; loaded: boolean; error: boolean };
  checkIn: { loaded: boolean; enabled: boolean; current: PublicCheckIn | null };
  /** last time `me` was successfully read (offline banner says "as of …") */
  updatedAt: number | null;
  /** the first load failed for a non-session reason */
  loadError: boolean;
  /** server balance moved since the previous read */
  balanceEvent: BalanceEvent | null;
  /** a REAL promotion the patient has not seen yet on this device */
  promotion: PublicPromotion | null;
  /** a REAL confirmed redemption (last hour) not celebrated yet */
  doneRequest: PublicRewardRequest | null;
  reload: () => Promise<void>;
  refreshRewards: () => Promise<void>;
  refreshCheckIn: () => Promise<void>;
  loadMoreActivity: () => Promise<void>;
  askReward: (rewardId: string) => Promise<ActionResult<{ state: "created" | "already_pending"; request: PublicRewardRequest; balance: number }>>;
  doCheckIn: () => Promise<ActionResult<{ state: "created" | "already_pending" | "already_confirmed" }>>;
  cancelCheckInRequest: () => Promise<ActionResult>;
  clearBalanceEvent: () => void;
  /** the UI has shown the promotion / completed-redemption moment — never show it again on this device */
  ackPromotion: () => void;
  ackRedemption: () => void;
}

const ME_POLL = 30_000;
const REWARD_POLL = 8_000;
const CHECKIN_POLL = 6_000;
const PAUSE_ON_429 = 60_000;
export const promotionSeenId = (slug: string, key: string) => `tier:${slug}:${key}`;
export const redeemSeenId = (slug: string, key: string) => `redeem:${slug}:${key}`;

export function usePatientData(opts: { slug: string; token: string; online: boolean; visible: boolean; onExpired: () => void; initialMe?: PublicMe | null }): PatientData {
  const { slug, token, online, visible, onExpired } = opts;
  const [me, setMe] = useState<PublicMe | null>(opts.initialMe ?? null);
  const [rewards, setRewards] = useState<PublicRewardsState | null>(null);
  const [rewardsError, setRewardsError] = useState(false);
  const [activity, setActivity] = useState<PatientData["activity"]>({ rows: [], page: 0, pages: 0, total: 0, loading: false, loaded: false, error: false });
  const [checkIn, setCheckIn] = useState<PatientData["checkIn"]>({ loaded: false, enabled: false, current: null });
  const [updatedAt, setUpdatedAt] = useState<number | null>(opts.initialMe ? Date.now() : null);
  const [loadError, setLoadError] = useState(false);
  const [balanceEvent, setBalanceEvent] = useState<BalanceEvent | null>(null);
  const [promotion, setPromotion] = useState<PublicPromotion | null>(null);
  const [doneRequest, setDoneRequest] = useState<PublicRewardRequest | null>(null);

  const alive = useRef(true);
  const pausedUntil = useRef(0);
  const lastBalance = useRef<number | null>(opts.initialMe?.member.balance ?? null);
  const eventSeq = useRef(0);
  const expiredRef = useRef(onExpired);
  expiredRef.current = onExpired;
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const sigRef = useRef("");

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** returns true when the error was handled (session over / throttled) */
  const handle = useCallback((e: unknown): boolean => {
    const st = publicError(e).status;
    if (st === 401) {
      expiredRef.current();
      return true;
    }
    if (st === 429) {
      pausedUntil.current = Date.now() + PAUSE_ON_429;
      return true;
    }
    return false;
  }, []);

  const applyMe = useCallback(
    (m: PublicMe) => {
      setMe(m);
      setUpdatedAt(Date.now());
      setLoadError(false);
      const prev = lastBalance.current;
      lastBalance.current = m.member.balance;
      if (prev !== null && prev !== m.member.balance) setBalanceEvent({ id: ++eventSeq.current, from: prev, to: m.member.balance });
      const p = m.promotion ?? null;
      if (p && !hasSeenCelebration(promotionSeenId(slug, p.key))) setPromotion((cur) => (cur?.key === p.key ? cur : p));
      return prev !== null && prev !== m.member.balance;
    },
    [slug]
  );

  const loadActivityFirst = useCallback(async () => {
    setActivity((a) => ({ ...a, loading: true, error: false }));
    try {
      const a = await fetchActivity(slug, token, 1);
      if (!alive.current) return;
      setActivity({ rows: a.activity, page: a.page, pages: a.pages, total: a.total, loading: false, loaded: true, error: false });
    } catch (e) {
      if (!alive.current) return;
      if (!handle(e)) setActivity((x) => ({ ...x, loading: false, loaded: true, error: true }));
      else setActivity((x) => ({ ...x, loading: false }));
    }
  }, [slug, token, handle]);

  const refreshMe = useCallback(async () => {
    try {
      const m = await fetchMe(slug, token);
      if (!alive.current) return;
      const moved = applyMe(m);
      // the ledger moved → the timeline must show it
      if (moved || m.promotion) void loadActivityFirst();
    } catch (e) {
      if (!alive.current) return;
      if (!handle(e) && !me) setLoadError(true);
    }
  }, [slug, token, applyMe, handle, loadActivityFirst, me]);

  const refreshRewards = useCallback(async () => {
    try {
      const s = await fetchRewards(slug, token);
      if (!alive.current) return;
      setRewards(s);
      setRewardsError(false);
      // a request was answered → the card's balance may have changed as well
      const sig = `${s.balance}|${s.requests.map((r) => r.key + r.status).join(",")}`;
      if (sigRef.current && sigRef.current !== sig) void refreshMe();
      sigRef.current = sig;
      const done = s.requests.find((r) => r.status === "confirmed" && r.resolvedAt && Date.now() - new Date(r.resolvedAt).getTime() < 3_600_000 && !hasSeenCelebration(redeemSeenId(slug, r.key)));
      setDoneRequest((cur) => (cur ? cur : done ?? null));
    } catch (e) {
      if (!alive.current) return;
      if (!handle(e)) setRewardsError(true);
    }
  }, [slug, token, handle, refreshMe]);

  const refreshCheckIn = useCallback(async () => {
    try {
      const s = await fetchCheckIn(slug, token);
      if (!alive.current) return;
      setCheckIn({ loaded: true, enabled: s.enabled, current: s.checkIn });
    } catch (e) {
      if (!alive.current) return;
      if (!handle(e)) setCheckIn((c) => ({ ...c, loaded: true }));
    }
  }, [slug, token, handle]);

  /* first load: everything in parallel; the card (me) decides whether the app can open */
  const reload = useCallback(async () => {
    setLoadError(false);
    try {
      const m = await fetchMe(slug, token);
      if (!alive.current) return;
      applyMe(m);
    } catch (e) {
      if (!alive.current) return;
      if (!handle(e)) setLoadError(true);
      return;
    }
    await Promise.allSettled([refreshRewards(), refreshCheckIn(), loadActivityFirst()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, token]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, token]);

  /* polling — visible + online only */
  const active = visible && online;
  useEffect(() => {
    if (!active) return;
    // coming back (tab shown / network back): read the card + rewards + check-in once, right away
    const wake = () => {
      if (Date.now() < pausedUntil.current) return;
      void refreshMe();
      void refreshRewards();
      void refreshCheckIn();
    };
    const first = setTimeout(wake, 400);
    const id = setInterval(() => {
      if (Date.now() >= pausedUntil.current) void refreshMe();
    }, ME_POLL);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const waitingReward = !!rewards?.requests.some((r) => r.status === "pending");
  useEffect(() => {
    if (!active || !waitingReward) return;
    const id = setInterval(() => {
      if (Date.now() >= pausedUntil.current) void refreshRewards();
    }, REWARD_POLL);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, waitingReward]);

  const waitingCheckIn = checkIn.current?.status === "pending";
  useEffect(() => {
    if (!active || !waitingCheckIn) return;
    const id = setInterval(() => {
      if (Date.now() >= pausedUntil.current) void refreshCheckIn();
    }, CHECKIN_POLL);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, waitingCheckIn]);

  /* ---------- actions (server decides; the UI only ever shows what the server answered) ---------- */

  const askReward: PatientData["askReward"] = useCallback(
    async (rewardId) => {
      try {
        const r = await requestReward(slug, token, rewardId);
        if (alive.current) await refreshRewards();
        return { ok: true, data: r };
      } catch (e) {
        const er = publicError(e);
        if (er.status === 401) {
          expiredRef.current();
          return { ok: false, code: "SESSION_EXPIRED", status: 401 };
        }
        if (er.code === "INSUFFICIENT_BALANCE" || er.code === "REWARD_UNAVAILABLE" || er.code === "REWARD_NOT_FOUND") void refreshRewards();
        return { ok: false, code: er.code ?? (er.status === 429 ? "RATE_LIMITED" : "NETWORK"), status: er.status };
      }
    },
    [slug, token, refreshRewards]
  );

  const doCheckIn: PatientData["doCheckIn"] = useCallback(async () => {
    try {
      const r = await requestCheckIn(slug, token, readVia());
      if (alive.current) setCheckIn({ loaded: true, enabled: true, current: r.checkIn });
      return { ok: true, data: { state: r.state } };
    } catch (e) {
      const er = publicError(e);
      if (er.status === 401) {
        expiredRef.current();
        return { ok: false, code: "SESSION_EXPIRED", status: 401 };
      }
      if (er.code === "CHECKIN_DISABLED") setCheckIn((c) => ({ ...c, enabled: false }));
      return { ok: false, code: er.code ?? (er.status === 429 ? "RATE_LIMITED" : "NETWORK"), status: er.status };
    }
  }, [slug, token]);

  const cancelCheckInRequest: PatientData["cancelCheckInRequest"] = useCallback(async () => {
    try {
      const s = await cancelCheckIn(slug, token);
      if (alive.current) setCheckIn({ loaded: true, enabled: s.enabled, current: s.checkIn });
      return { ok: true, data: undefined };
    } catch (e) {
      const er = publicError(e);
      if (er.status === 401) {
        expiredRef.current();
        return { ok: false, code: "SESSION_EXPIRED", status: 401 };
      }
      return { ok: false, code: er.code ?? "NETWORK", status: er.status };
    }
  }, [slug, token]);

  const loadMoreActivity = useCallback(async () => {
    const a = activityRef.current;
    if (a.loading || a.page >= a.pages) return;
    setActivity((x) => ({ ...x, loading: true }));
    try {
      const r = await fetchActivity(slug, token, a.page + 1);
      if (!alive.current) return;
      setActivity((x) => ({ rows: [...x.rows, ...r.activity.filter((n) => !x.rows.some((o) => o.key === n.key))], page: r.page, pages: r.pages, total: r.total, loading: false, loaded: true, error: false }));
    } catch (e) {
      if (!alive.current) return;
      if (!handle(e)) setActivity((x) => ({ ...x, loading: false, error: true }));
      else setActivity((x) => ({ ...x, loading: false }));
    }
  }, [slug, token, handle]);

  const clearBalanceEvent = useCallback(() => setBalanceEvent(null), []);

  const ackPromotion = useCallback(() => {
    setPromotion((p) => {
      if (p) markCelebrated(promotionSeenId(slug, p.key));
      return null;
    });
  }, [slug]);
  const ackRedemption = useCallback(() => {
    setDoneRequest((r) => {
      if (r) markCelebrated(redeemSeenId(slug, r.key));
      return null;
    });
  }, [slug]);

  return { me, rewards, rewardsError, activity, checkIn, updatedAt, loadError, balanceEvent, promotion, doneRequest, reload, refreshRewards, refreshCheckIn, loadMoreActivity, askReward, doCheckIn, cancelCheckInRequest, clearBalanceEvent, ackPromotion, ackRedemption };
}
