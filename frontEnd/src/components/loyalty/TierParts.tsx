"use client";
import { useEffect, useState } from "react";
import { IconArrowDownRight, IconArrowUpRight, IconCircleCheck, IconInfoCircle, IconSparkles, IconTrophy } from "@tabler/icons-react";
import {
  fmtNum,
  hasSeenCelebration,
  markCelebrated,
  useLT,
  useTierText,
  type LoyaltyMember,
  type MemberDetailResponse,
  type MemberTierFull,
  type TierBenefit,
  type TierBrief,
  type TierHistoryRow,
  type TierKey,
} from "@/lib/loyalty";
import TierCard3D, { TierBadge } from "./TierCard3D";
import { TIER_ACCENT } from "./shell/loyaltyDesign";

/** Plain-text list of the benefits a tier lists (informational only — nothing here changes points, prices or rewards). */
export function BenefitList({ benefits, empty }: { benefits: TierBenefit[]; empty?: string }) {
  if (!benefits.length) return empty ? <p className="text-[11px] text-mute">{empty}</p> : null;
  return (
    <ul className="space-y-1.5" data-testid="tier-benefits">
      {benefits.map((b, i) => (
        <li key={`${i}-${b.title}`} className="flex items-start gap-2 text-xs">
          <IconCircleCheck size={14} className="mt-0.5 shrink-0 text-amber-300" aria-hidden="true" />
          <span className="min-w-0 break-words">
            <span className="text-ink" dir="auto">
              {b.title}
            </span>
            {b.description && (
              <span className="block text-[11px] text-mute" dir="auto">
                {b.description}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Thin progress bar for lists (the server decided the percentage). Tinted with the tier's material when a tier key is given. */
export function MiniProgress({ percent, top, tierKey }: { percent: number; top: boolean; tierKey?: TierKey }) {
  const { t } = useLT();
  const p = Math.max(0, Math.min(100, percent)) / 100;
  return (
    <div
      className="lyx-pr"
      data-tone={tierKey ? "tier" : undefined}
      style={{ ["--p" as string]: p, ["--h" as string]: "6px", ...(tierKey ? { ["--tc" as string]: TIER_ACCENT[tierKey] } : {}) } as React.CSSProperties}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={top ? t("Highest tier", "أعلى مستوى") : t("Progress to next tier", "التقدم نحو المستوى التالي")}
    >
      <div className="lyx-pr-fill" />
    </div>
  );
}

export function useTierSource() {
  const { t } = useLT();
  const map: Record<string, string> = {
    points_earned: t("Points earned", "نقاط مكتسبة"),
    appointment_completed: t("Visit completed", "زيارة مكتملة"),
    payment_recorded: t("Payment recorded", "دفعة مسجّلة"),
    settings_recalculation: t("Tier rules changed", "تغيير قواعد المستويات"),
    manual_reconciliation: t("Reconciliation", "تدقيق وتسوية"),
    migration: t("Backfill", "ملء الأرصدة السابقة"),
    member_enrolled: t("Enrolled", "تسجيل العضو"),
  };
  return (s: string) => map[s] ?? s;
}

/** Real tier changes only (the server writes a row ONLY when a tier actually changed). Names are the ones used at that time. */
export function TierHistoryList({ rows, showPatient = false }: { rows: TierHistoryRow[]; showPatient?: boolean }) {
  const { t, date } = useLT();
  const source = useTierSource();
  return (
    <ul className="divide-y divide-edge" data-testid="tier-history">
      {rows.map((h, i) => {
        const up = h.direction === "promotion";
        const down = h.direction === "demotion";
        return (
          <li key={h.id} className="lyc-row flex items-start gap-3 py-2.5" style={{ ["--i" as string]: i } as React.CSSProperties}>
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${up ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : down ? "border-rose-400/30 bg-rose-400/10 text-rose-300" : "border-[color:var(--lyx-line)] bg-soft text-[color:var(--lyx-gold)]"}`}>
              {up ? <IconArrowUpRight size={14} /> : down ? <IconArrowDownRight size={14} /> : <IconSparkles size={13} />}
            </span>
            <div className="min-w-0 flex-1">
              {showPatient && h.patient && <div className="truncate text-xs font-medium text-ink">{h.patient.fullName}</div>}
              <div className="break-words text-xs text-ink" dir="auto">
                {h.fromTierName ? (
                  <>
                    {h.fromTierName} <span className="text-mute">→</span> {h.toTierName}
                  </>
                ) : (
                  <>
                    {t("Started at", "بدأ في")} {h.toTierName}
                  </>
                )}
              </div>
              <div className="truncate text-[10px] text-mute">
                {date(h.changedAt, true)} · {source(h.source)}
              </div>
            </div>
            <div className="shrink-0 text-end text-[10px] text-mute" dir="ltr">
              {t("at", "عند")} {fmtNum(h.metricValue)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const DAY = 86_400_000;

/**
 * The tier section of the member sheet. Everything comes from GET /members/:id — the card, the percentage, the remaining
 * amount, the benefits, the history. "Available points" (what the member can spend) and "Lifetime earned" (what drives
 * progression by points) are shown as two clearly labelled, separate numbers.
 */
export function MemberTierPanel({ detail, member, brand }: { detail: MemberDetailResponse; member: LoyaltyMember; brand: string }) {
  const { t } = useLT();
  const tx = useTierText();
  const tier = detail.tier as MemberTierFull;
  const history = detail.tierHistory;
  const latest = history[0];

  // A real promotion this browser hasn't celebrated yet (≤ 48 h old). Marked as seen immediately → never replays on reload.
  const [celebratingId, setCelebratingId] = useState<string | null>(null);
  useEffect(() => {
    if (latest && latest.direction === "promotion" && Date.now() - new Date(latest.changedAt).getTime() < 2 * DAY && !hasSeenCelebration(latest.id)) {
      setCelebratingId(latest.id);
      markCelebrated(latest.id);
    }
  }, [latest?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const top = tier.isTopTier;
  const next = tier.nextTierName;
  const progress = {
    percent: tier.progressPercent,
    top,
    left: tier.currentTierName,
    right: top ? t("HIGHEST TIER", "أعلى مستوى") : `${next} · ${tx.value(tier.remaining, tier.unit)} ${t("left", "متبقٍ")}`,
  };

  return (
    <div data-testid="member-tier-panel">
      {celebratingId && (
        <div role="status" className="lyc-pop mb-3 flex items-center gap-2 rounded-xl border border-amber-300/40 bg-gradient-to-r from-amber-300/15 to-transparent px-3 py-2.5 text-xs text-amber-200" data-testid="tier-promoted-banner">
          <IconTrophy size={16} className="shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words" dir="auto">
            {t(`Promoted to ${tier.currentTierName}`, `تمت الترقية إلى ${tier.currentTierName}`)}
          </span>
        </div>
      )}

      <div className="lyx-stagebox">
        <TierCard3D
          tierKey={tier.currentTierKey}
          tierName={tier.currentTierName}
          brand={brand}
          tierWord={t("TIER", "المستوى")}
          centerLabel={t("AVAILABLE POINTS", "النقاط المتاحة")}
          centerValue={fmtNum(detail.points.available)}
          holder={member.patient?.fullName ?? null}
          progress={progress}
          celebrate={!!celebratingId}
          testId="member-tier-card"
        />
      </div>

      {/* what the member can spend vs what drives the tier — never mixed up */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="lyx-surface lyx-pts min-w-0 !p-3" data-solid="true" data-tone="gold" data-testid="points-available">
          <div className="truncate text-[10px] text-mute">{t("Available points", "النقاط المتاحة")}</div>
          <div className="lyx-num mt-0.5 text-xl font-semibold tabular-nums text-ink">{fmtNum(detail.points.available)}</div>
          <div className="mt-1 text-[10px] leading-snug text-mute">{t("Can be redeemed — goes down when used.", "قابلة للاستبدال — تنقص عند الاستخدام.")}</div>
        </div>
        <div className="lyx-surface lyx-pts min-w-0 !p-3" data-solid="true" data-tier-accent={tier.currentTierKey} data-testid="points-lifetime">
          <div className="truncate text-[10px] text-mute">{t("Lifetime earned", "إجمالي المكتسب")}</div>
          <div className="lyx-num mt-0.5 text-xl font-semibold tabular-nums text-ink">{fmtNum(detail.points.lifetimeEarned)}</div>
          <div className="mt-1 text-[10px] leading-snug text-mute">{t("Never goes down when points are redeemed.", "لا تنقص عند استبدال النقاط.")}</div>
        </div>
      </div>

      <div className="lyx-surface mt-3 !p-3.5" data-solid="true">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <TierBadge tierKey={tier.currentTierKey} name={tier.currentTierName} />
          <span className="text-[10px] text-mute" data-testid="tier-metric">
            {tx.metricName(tier.metric)}: <span className="tabular-nums text-ink">{tx.value(tier.metricValue, tier.unit)}</span>
          </span>
        </div>
        <MiniProgress percent={tier.progressPercent} top={top} tierKey={tier.currentTierKey} />
        <p className="mt-2 text-xs leading-relaxed text-mute" data-testid="tier-next">
          {top ? (
            <span className="text-amber-300">{t("Highest tier reached.", "وصل إلى أعلى مستوى.")}</span>
          ) : (
            <>
              <span className="tabular-nums text-ink">{tier.progressPercent}%</span> {t("of the way to", "من الطريق إلى")} <span className="text-ink" dir="auto">{next}</span> ·{" "}
              <span className="tabular-nums text-ink">{tx.value(tier.remaining, tier.unit)}</span> {t("remaining", "متبقٍ")}
            </>
          )}
        </p>
        {tier.description && (
          <p className="mt-2 break-words text-[11px] leading-relaxed text-mute" dir="auto">
            {tier.description}
          </p>
        )}
        {tier.pending && (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-300">
            <IconInfoCircle size={13} className="mt-0.5 shrink-0" />
            {t("This tier is calculated from the current rules and will be saved at the next recalculation.", "هذا المستوى محسوب من القواعد الحالية وسيُحفظ عند إعادة الحساب التالية.")}
          </p>
        )}
      </div>

      <div className="lyx-surface mt-3 !p-3.5" data-solid="true">
        <h4 className="mb-2 text-xs font-medium text-ink">{t("Benefits of this tier", "مزايا هذا المستوى")}</h4>
        <BenefitList benefits={tier.benefits} empty={t("This tier doesn't list any benefits.", "لا يعرض هذا المستوى أي مزايا.")} />
        <p className="mt-2 text-[10px] leading-snug text-mute">{t("Benefits are information for your team and patients. They don't change points automatically.", "المزايا معلومات لفريقك ومرضاك. لا تغيّر النقاط تلقائيًا.")}</p>
      </div>

      <h4 className="mb-1 mt-4 text-xs font-medium text-ink">{t("Tier history", "سجل المستويات")}</h4>
      {history.length === 0 ? <p className="lyx-surface !p-3 text-[11px] text-mute" data-solid="true">{t("No tier changes yet. A row is added only when the member's tier really changes.", "لا توجد تغييرات في المستوى بعد. تُضاف سجلات فقط عند تغيّر مستوى العضو فعليًا.")}</p> : <div className="lyx-surface px-3" data-solid="true"><TierHistoryList rows={history} /></div>}
    </div>
  );
}

/** Tier cell for a members list row: badge + the metric + a thin server-calculated progress line. */
export function MemberTierCell({ tier }: { tier: TierBrief }) {
  const tx = useTierText();
  const { t } = useLT();
  return (
    <div className="min-w-0" data-testid="member-tier-cell">
      <div className="flex items-center gap-2">
        <TierBadge tierKey={tier.key} name={tier.name} size="sm" />
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="w-16 shrink-0 sm:w-24">
          <MiniProgress percent={tier.progressPercent} top={tier.isTopTier} tierKey={tier.key} />
        </div>
        <span className="truncate text-[10px] tabular-nums text-mute">{tier.isTopTier ? t("Highest tier", "أعلى مستوى") : `${tier.progressPercent}%`}</span>
      </div>
      <div className="truncate text-[10px] text-mute">{tx.value(tier.metricValue, tier.unit)}</div>
    </div>
  );
}

export type { TierKey };
