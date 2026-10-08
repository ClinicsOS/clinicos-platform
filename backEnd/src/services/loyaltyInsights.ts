import { Types } from "mongoose";
import { LoyaltyAccount } from "../models/LoyaltyAccount";
import { LoyaltyCheckIn } from "../models/LoyaltyCheckIn";
import { LoyaltyRedemption } from "../models/LoyaltyRedemption";
import { LoyaltyReward } from "../models/LoyaltyReward";
import { LoyaltyTierHistory } from "../models/LoyaltyTierHistory";
import { LoyaltyTransaction } from "../models/LoyaltyTransaction";
import { Patient } from "../models/Patient";

/**
 * ClinicOS Loyalty — read-only INSIGHTS (Phase 8): the live activity stream and the analytics screen.
 *
 * This file only READS. It never writes a balance, a tier, a check-in or a redemption, and it never invents a number:
 *   • every event in the activity stream is one real stored record (a ledger row, a check-in, a redemption, a tier-history row, an account);
 *   • every analytics figure is counted / summed from stored records inside the requested window, by clinic-local (Asia/Amman) calendar day;
 *   • a percentage is only returned when it is a plain ratio of two stored counts (otherwise `null`).
 * Everything is clinic-scoped (`clinicId` comes from the signed-in user) and bounded: each query has a hard cap, and when a cap is
 * reached the response says so (`truncated`) instead of quietly under-counting.
 */

type Lean = Record<string, any>;
const oid = (v: string | Types.ObjectId) => new Types.ObjectId(String(v));

export const INSIGHTS = {
  activityDefault: 15,
  activityMax: 30,
  analyticsDays: [7, 30, 90] as const,
  /** hard cap per source collection when bucketing in memory */
  rowCap: 20_000,
  topRewards: 8,
  timeZone: "Asia/Amman",
} as const;

/* ============================================================
 * Live activity
 * ============================================================ */

export type ActivityKind = "new_member" | "points_earned" | "points_adjusted" | "points_reversed" | "checkin_confirmed" | "reward_redeemed" | "reward_reversed" | "member_promoted";

export interface ActivityEvent {
  /** stable per underlying record + kind → the client uses it to animate only genuinely new events */
  id: string;
  kind: ActivityKind;
  at: string;
  patient: { id: string; fullName: string; fileNumber: number } | null;
  /** signed points change when the event moved points (never invented) */
  points: number | null;
  /** reward name / tier name AS STORED at the time, when relevant */
  label: string | null;
  /** extra stable key: tier key for promotions */
  tierKey: string | null;
}

const iso = (d: unknown): string | null => {
  if (!d) return null;
  const t = new Date(d as any).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

export async function recentActivity(clinicId: string, limitIn: number) {
  const limit = Math.min(INSIGHTS.activityMax, Math.max(1, Math.floor(limitIn) || INSIGHTS.activityDefault));
  const cid = oid(clinicId);
  const fetchN = limit * 2; // some rows are filtered out below (e.g. redemption ledger rows, shown through their redemption instead)

  const [txs, accounts, checkIns, redeemed, reversed, promos] = await Promise.all([
    LoyaltyTransaction.find({ clinicId: cid, type: { $in: ["earn_visit", "earn_spending", "manual_credit", "manual_debit", "correction", "expiration", "reversal"] } })
      .select("type pointsDelta createdAt patientId metadata")
      .sort({ createdAt: -1, _id: -1 })
      .limit(fetchN)
      .lean(),
    LoyaltyAccount.find({ clinicId: cid }).select("patientId joinedAt").sort({ joinedAt: -1, _id: -1 }).limit(limit).lean(),
    // Pending requests expire quickly, so ordering by request time is, for practical purposes, ordering by resolution time; re-sorted by resolvedAt below.
    LoyaltyCheckIn.find({ clinicId: cid, status: "confirmed" }).select("patientId resolvedAt requestedAt").sort({ requestedAt: -1, _id: -1 }).limit(fetchN).lean(),
    LoyaltyRedemption.find({ clinicId: cid, status: { $in: ["confirmed", "reversing", "reversed"] }, confirmedAt: { $ne: null } })
      .select("patientId rewardNameSnapshot pointsCostSnapshot confirmedAt")
      .sort({ confirmedAt: -1, _id: -1 })
      .limit(limit)
      .lean(),
    LoyaltyRedemption.find({ clinicId: cid, status: "reversed", reversedAt: { $ne: null } })
      .select("patientId rewardNameSnapshot pointsCostSnapshot reversedAt")
      .sort({ reversedAt: -1, _id: -1 })
      .limit(limit)
      .lean(),
    LoyaltyTierHistory.find({ clinicId: cid, direction: "promotion" }).select("patientId toTierKey toTierNameSnapshot changedAt").sort({ changedAt: -1, _id: -1 }).limit(limit).lean(),
  ]);

  type Raw = Omit<ActivityEvent, "patient"> & { patientId: string | null };
  const raw: Raw[] = [];
  const push = (r: Raw) => r.at && raw.push(r);

  for (const t of txs as Lean[]) {
    const reversedType = t.metadata?.reversedType;
    if (t.type === "reversal" && reversedType === "reward_redemption") continue; // shown as "reward reversed" from the redemption itself
    const kind: ActivityKind = t.type === "earn_visit" || t.type === "earn_spending" ? "points_earned" : t.type === "reversal" ? "points_reversed" : "points_adjusted";
    push({ id: `tx:${t._id}`, kind, at: iso(t.createdAt) as string, patientId: String(t.patientId), points: t.pointsDelta, label: null, tierKey: null });
  }
  for (const a of accounts as Lean[]) push({ id: `member:${a._id}`, kind: "new_member", at: iso(a.joinedAt) as string, patientId: String(a.patientId), points: null, label: null, tierKey: null });
  for (const c of checkIns as Lean[]) push({ id: `checkin:${c._id}`, kind: "checkin_confirmed", at: (iso(c.resolvedAt) ?? iso(c.requestedAt)) as string, patientId: String(c.patientId), points: null, label: null, tierKey: null });
  for (const r of redeemed as Lean[]) push({ id: `redeemed:${r._id}`, kind: "reward_redeemed", at: iso(r.confirmedAt) as string, patientId: String(r.patientId), points: -r.pointsCostSnapshot, label: r.rewardNameSnapshot, tierKey: null });
  for (const r of reversed as Lean[]) push({ id: `reversed:${r._id}`, kind: "reward_reversed", at: iso(r.reversedAt) as string, patientId: String(r.patientId), points: r.pointsCostSnapshot, label: r.rewardNameSnapshot, tierKey: null });
  for (const h of promos as Lean[]) push({ id: `promo:${h._id}`, kind: "member_promoted", at: iso(h.changedAt) as string, patientId: String(h.patientId), points: null, label: h.toTierNameSnapshot, tierKey: h.toTierKey });

  raw.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));
  const top = raw.slice(0, limit);

  const ids = [...new Set(top.map((e) => e.patientId).filter(Boolean) as string[])];
  const patients = ids.length ? ((await Patient.find({ _id: { $in: ids }, clinicId }).select("fullName fileNumber").lean()) as Lean[]) : [];
  const pm = new Map(patients.map((p) => [String(p._id), p]));

  const events: ActivityEvent[] = top.map(({ patientId, ...e }) => {
    const p = patientId ? pm.get(patientId) : undefined;
    return { ...e, patient: p ? { id: String(p._id), fullName: p.fullName, fileNumber: p.fileNumber } : null };
  });
  return { events, serverTime: new Date().toISOString() };
}

/* ============================================================
 * Analytics
 * ============================================================ */

/** Clinic-local calendar day "YYYY-MM-DD" (Asia/Amman) of an instant. */
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: INSIGHTS.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
const dayKey = (d: unknown): string => dayFmt.format(new Date(d as any));

const displayRedemptionStatus = (s: string) => (s === "confirming" ? "pending" : s === "reversing" ? "confirmed" : s);

export async function loyaltyAnalytics(clinicId: string, daysIn: number) {
  const days = (INSIGHTS.analyticsDays as readonly number[]).includes(daysIn) ? daysIn : 30;
  const cid = oid(clinicId);
  const now = Date.now();

  // The window's calendar days, oldest → newest (clinic-local). 24 h steps are safe: the clinic time zone has no daylight-saving shifts that
  // would skip or repeat a calendar day inside a 90-day window, and the key lookup below ignores anything outside the set anyway.
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(now - i * 86_400_000));
  const idx = new Map(keys.map((k, i) => [k, i]));
  const from = new Date(now - (days + 1) * 86_400_000); // one spare day; rows outside the key set are dropped
  const zero = () => keys.map(() => 0);
  const cap = INSIGHTS.rowCap;

  const [txs, checkIns, accounts, redemptions] = await Promise.all([
    LoyaltyTransaction.find({ clinicId: cid, createdAt: { $gte: from } }).select("type pointsDelta createdAt metadata").sort({ createdAt: -1 }).limit(cap + 1).lean(),
    LoyaltyCheckIn.find({ clinicId: cid, requestedAt: { $gte: from } }).select("status via requestedAt").sort({ requestedAt: -1 }).limit(cap + 1).lean(),
    LoyaltyAccount.find({ clinicId: cid, joinedAt: { $gte: from } }).select("joinedAt").sort({ joinedAt: -1 }).limit(cap + 1).lean(),
    LoyaltyRedemption.find({ clinicId: cid, requestedAt: { $gte: from } }).select("rewardId rewardNameSnapshot pointsCostSnapshot status requestedAt").sort({ requestedAt: -1 }).limit(cap + 1).lean(),
  ]);
  const truncated = { transactions: txs.length > cap, checkIns: checkIns.length > cap, members: accounts.length > cap, redemptions: redemptions.length > cap };

  /* ---- points ---- */
  const issued = zero();
  const redeemedPts = zero();
  const returned = zero();
  const byType: Record<string, { count: number; points: number }> = {};
  let totalIssued = 0;
  let totalRedeemed = 0;
  let totalReturned = 0;
  for (const t of (txs as Lean[]).slice(0, cap)) {
    const i = idx.get(dayKey(t.createdAt));
    if (i === undefined) continue;
    const b = (byType[t.type] ??= { count: 0, points: 0 });
    b.count += 1;
    b.points += t.pointsDelta;
    if (t.type === "earn_visit" || t.type === "earn_spending" || t.type === "manual_credit") {
      issued[i] += t.pointsDelta;
      totalIssued += t.pointsDelta;
    } else if (t.type === "reward_redemption") {
      redeemedPts[i] += Math.abs(t.pointsDelta);
      totalRedeemed += Math.abs(t.pointsDelta);
    } else if (t.type === "reversal" && t.metadata?.reversedType === "reward_redemption" && t.pointsDelta > 0) {
      returned[i] += t.pointsDelta;
      totalReturned += t.pointsDelta;
    }
  }

  /* ---- check-ins ---- */
  const ckAll = zero();
  const ckConfirmed = zero();
  const ck = { total: 0, confirmed: 0, rejected: 0, expired: 0, cancelled: 0, pending: 0, byVia: { qr: 0, nfc: 0, link: 0 } as Record<string, number> };
  for (const c of (checkIns as Lean[]).slice(0, cap)) {
    const i = idx.get(dayKey(c.requestedAt));
    if (i === undefined) continue;
    ck.total += 1;
    ckAll[i] += 1;
    if (c.status in ck) (ck as any)[c.status] += 1;
    if (c.status === "confirmed") ckConfirmed[i] += 1;
    if (c.via in ck.byVia) ck.byVia[c.via] += 1;
  }
  const resolved = ck.confirmed + ck.rejected + ck.expired;
  const confirmedShare = resolved > 0 ? Math.round((ck.confirmed / resolved) * 1000) / 10 : null;

  /* ---- new members ---- */
  const newMembers = zero();
  let newMembersTotal = 0;
  for (const a of (accounts as Lean[]).slice(0, cap)) {
    const i = idx.get(dayKey(a.joinedAt));
    if (i === undefined) continue;
    newMembers[i] += 1;
    newMembersTotal += 1;
  }

  /* ---- rewards ---- */
  const per = new Map<string, { rewardId: string; name: string; requested: number; confirmed: number; reversed: number; rejected: number; pending: number; pointsRedeemed: number }>();
  const rd = { requested: 0, confirmed: 0, rejected: 0, reversed: 0, pending: 0 };
  for (const r of (redemptions as Lean[]).slice(0, cap)) {
    if (idx.get(dayKey(r.requestedAt)) === undefined) continue;
    const st = displayRedemptionStatus(r.status) as "pending" | "confirmed" | "rejected" | "reversed";
    const row = per.get(String(r.rewardId)) ?? { rewardId: String(r.rewardId), name: r.rewardNameSnapshot, requested: 0, confirmed: 0, reversed: 0, rejected: 0, pending: 0, pointsRedeemed: 0 };
    row.requested += 1;
    rd.requested += 1;
    if (st in rd) (rd as any)[st] += 1;
    if (st in row) (row as any)[st] += 1;
    if (st === "confirmed") row.pointsRedeemed += r.pointsCostSnapshot;
    per.set(row.rewardId, row);
  }
  const rewards = [...per.values()].sort((a, b) => b.confirmed - a.confirmed || b.requested - a.requested || a.name.localeCompare(b.name)).slice(0, INSIGHTS.topRewards);

  return {
    days,
    timeZone: INSIGHTS.timeZone,
    truncated,
    series: { dates: keys, issued, redeemed: redeemedPts, returned, checkIns: ckAll, checkInsConfirmed: ckConfirmed, newMembers },
    totals: {
      points: { issued: totalIssued, redeemed: totalRedeemed, returned: totalReturned, byType },
      checkIns: { ...ck, confirmedShareOfResolved: confirmedShare },
      newMembers: newMembersTotal,
      redemptions: rd,
    },
    rewards,
  };
}

/* ============================================================
 * One member's activity + rewards eligibility (member details screen)
 * ============================================================ */

const displayStatus = (s: string) => (s === "confirming" ? "pending" : s === "reversing" ? "confirmed" : s);

/**
 * Recent check-ins and redemptions of ONE member, plus which rewards the member can afford RIGHT NOW (from the stored balance).
 * Returns null when the account does not belong to the clinic (the caller answers 404 — a foreign id looks exactly like a missing one).
 */
export async function memberInsights(clinicId: string, accountId: string) {
  const cid = oid(clinicId);
  const aid = oid(accountId);
  const account = (await LoyaltyAccount.findOne({ _id: aid, clinicId: cid }).select("pointsBalance").lean()) as Lean | null;
  if (!account) return null;
  const nowMs = Date.now();
  const [checkIns, redemptions, rewards] = await Promise.all([
    LoyaltyCheckIn.find({ clinicId: cid, accountId: aid }).select("status via requestedAt resolvedAt").sort({ requestedAt: -1, _id: -1 }).limit(6).lean(),
    LoyaltyRedemption.find({ clinicId: cid, accountId: aid }).select("rewardNameSnapshot pointsCostSnapshot status requestedAt confirmedAt reversedAt").sort({ requestedAt: -1, _id: -1 }).limit(6).lean(),
    LoyaltyReward.find({ clinicId: cid, status: "active" }).select("name pointsRequired validFrom validUntil").sort({ pointsRequired: 1, _id: 1 }).limit(100).lean(),
  ]);
  const balance: number = account.pointsBalance ?? 0;
  // Same rule as the reward catalog: active AND inside its validity window right now.
  const open = (rewards as Lean[]).filter((r) => !(r.validFrom && nowMs < new Date(r.validFrom).getTime()) && !(r.validUntil && nowMs > new Date(r.validUntil).getTime()));
  const affordable = open.filter((r) => r.pointsRequired <= balance);
  const next = open.find((r) => r.pointsRequired > balance);
  return {
    balance,
    checkIns: (checkIns as Lean[]).map((c) => ({ id: String(c._id), status: c.status, via: c.via, requestedAt: iso(c.requestedAt), resolvedAt: iso(c.resolvedAt) })),
    redemptions: (redemptions as Lean[]).map((r) => ({
      id: String(r._id),
      status: displayStatus(r.status),
      rewardName: r.rewardNameSnapshot,
      points: r.pointsCostSnapshot,
      requestedAt: iso(r.requestedAt),
      confirmedAt: iso(r.confirmedAt),
      reversedAt: iso(r.reversedAt),
    })),
    rewards: {
      openCount: open.length,
      affordableCount: affordable.length,
      affordable: affordable.slice(-4).reverse().map((r) => ({ id: String(r._id), name: r.name, pointsRequired: r.pointsRequired })),
      next: next ? { id: String(next._id), name: next.name, pointsRequired: next.pointsRequired, remaining: next.pointsRequired - balance } : null,
    },
  };
}
