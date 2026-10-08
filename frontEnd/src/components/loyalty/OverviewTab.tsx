"use client";
import Link from "next/link";
import { IconCoins, IconGift, IconHandStop, IconSparkles, IconStairsUp, IconTicket, IconTrendingUp, IconTrophy, IconUsers, IconUserPlus } from "@tabler/icons-react";
import { apiError, fmtNum, useCheckInSummary, useLoyaltyAnalytics, useLoyaltyMembers, useLoyaltyOverview, useLT, usePendingRedemptionCount, useRewardsSummary, useTierAnalytics, useTiersConfig } from "@/lib/loyalty";
import { SECTION_PATH, type LoyaltySection } from "@/lib/loyaltyNav";
import { TierBadge } from "./TierCard3D";
import { TierHistoryList } from "./TierParts";
import { Avatar } from "./parts";
import OverviewHero from "./overview/OverviewHero";
import ActivityStream from "./overview/ActivityStream";
import { LoyaltyEmptyState, LoyaltyErrorState, LoyaltyLoader, LoyaltyMetric, LoyaltyPanel, StatusOrb } from "./ui/LoyaltyUI";
import { useLoyaltyBrand } from "@/lib/loyalty";

export type LoyaltyTab = LoyaltySection;

/** Overview (Phase 8): hero ecosystem → varied metrics → live activity + program / members → tiers. Every number is a real stored value. */
export default function OverviewTab({ onGo, canConfigure, canEnroll }: { onGo: (tab: LoyaltyTab, enroll?: boolean) => void; canConfigure: boolean; canEnroll: boolean }) {
  const { t, date } = useLT();
  const { clinicName } = useLoyaltyBrand();
  const ov = useLoyaltyOverview();
  const an = useLoyaltyAnalytics(30);
  const recentMembers = useLoyaltyMembers(1, "", 5);
  const waiting = useCheckInSummary(true).data?.pending ?? 0;
  const redeemWaiting = usePendingRedemptionCount(true).data?.pending ?? 0;
  const rewards = useRewardsSummary(true).data;

  if (ov.isError) return <LoyaltyErrorState message={apiError(ov.error, t("Couldn't load the overview", "تعذّر تحميل النظرة العامة")).message} onRetry={() => ov.refetch()} />;
  if (ov.isLoading || !ov.data) {
    return (
      <div className="space-y-3" aria-busy="true" data-testid="overview-loading">
        <LoyaltyLoader className="h-[420px] !rounded-[30px]" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <LoyaltyLoader key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }
  const d = ov.data;
  const a = an.data;
  const share = a?.totals.checkIns.confirmedShareOfResolved ?? null;

  return (
    <div className="space-y-3" data-testid="lyx-overview">
      <OverviewHero clinicName={clinicName} canEnroll={canEnroll} canConfigure={canConfigure} onGo={onGo} />

      <div className="lyx-grid-metrics">
        <div className="lyx-span2">
          <LoyaltyMetric variant="hero" index={0} label={t("Points in circulation", "النقاط المتداولة")} value={d.pointsOutstanding} hint={t(`${fmtNum(d.pointsIssued.total)} points issued in total`, `${fmtNum(d.pointsIssued.total)} نقطة صادرة إجمالًا`)} icon={<IconCoins size={17} />} spark={a?.series.issued} testId="metric-circulation" />
        </div>
        <LoyaltyMetric variant="spark" index={1} label={t("Members", "الأعضاء")} value={d.members} hint={a ? t(`+${fmtNum(a.totals.newMembers)} in the last ${a.days} days`, `+${fmtNum(a.totals.newMembers)} في آخر ${a.days} يومًا`) : undefined} icon={<IconUsers size={17} />} spark={a?.series.newMembers} testId="metric-members" />
        <LoyaltyMetric
          variant="ring"
          index={2}
          tone="mint"
          label={t("Check-in confirmation", "تأكيد تسجيل الوصول")}
          value={share === null ? "—" : `${Math.round(share)}%`}
          hint={a ? (share === null ? t("No resolved check-ins yet", "لا توجد تسجيلات محسومة بعد") : t(`${fmtNum(a.totals.checkIns.confirmed)} confirmed · ${a.days} days`, `${fmtNum(a.totals.checkIns.confirmed)} مؤكَّد · ${a.days} يومًا`)) : undefined}
          icon={<IconHandStop size={17} />}
          ring={share === null ? undefined : { value: share, max: 100 }}
          testId="metric-checkin-rate"
        />

        <div className="lyx-span2">
          <LoyaltyPanel pad={false} tone={waiting + redeemWaiting > 0 ? "gold" : undefined} index={3} testId="lyx-attention">
            <div className="lyx-attn">
              <div className="lyx-ph" style={{ marginBottom: 2 }}>
                <span className="lyx-ph-ico">
                  <IconSparkles size={16} />
                </span>
                <div className="lyx-ph-tx">
                  <h3>{t("Needs attention", "بحاجة لانتباهك")}</h3>
                  <p>{waiting + redeemWaiting > 0 ? t("Patients are waiting for the desk.", "هناك مرضى بانتظار الاستقبال.") : t("Nothing is waiting — you're all caught up.", "لا شيء بالانتظار — كل شيء منجز.")}</p>
                </div>
              </div>
              <Link href={SECTION_PATH.checkin} className="lyx-attn-row" data-testid="attn-checkins">
                <b className="lyx-num">{fmtNum(waiting)}</b>
                <span>{t("Check-ins waiting for confirmation", "تسجيلات وصول بانتظار التأكيد")}</span>
                <StatusOrb status={waiting > 0 ? "pending" : "ok"} label={waiting > 0 ? t("Pending", "بالانتظار") : t("Clear", "منجز")} />
              </Link>
              <Link href={SECTION_PATH.redemptions} className="lyx-attn-row" data-testid="attn-redemptions">
                <b className="lyx-num">{fmtNum(redeemWaiting)}</b>
                <span>{t("Reward redemptions waiting", "استبدالات مكافآت بالانتظار")}</span>
                <StatusOrb status={redeemWaiting > 0 ? "pending" : "ok"} label={redeemWaiting > 0 ? t("Pending", "بالانتظار") : t("Clear", "منجز")} />
              </Link>
            </div>
          </LoyaltyPanel>
        </div>
        <LoyaltyMetric index={4} tone="rose" label={t("Points redeemed", "نقاط مستبدَلة")} value={a ? a.totals.points.redeemed : "—"} hint={a ? t(`Last ${a.days} days · ${fmtNum(a.totals.points.returned)} returned`, `آخر ${a.days} يومًا · ${fmtNum(a.totals.points.returned)} مُعادة`) : undefined} icon={<IconTicket size={17} />} testId="metric-redeemed" />
        <LoyaltyMetric index={5} label={t("Active rewards", "مكافآت فعّالة")} value={rewards ? rewards.activeRewards : "—"} hint={rewards ? t(`${fmtNum(rewards.confirmed)} redemptions confirmed`, `${fmtNum(rewards.confirmed)} استبدال مؤكَّد`) : undefined} icon={<IconGift size={17} />} testId="metric-rewards" />
      </div>

      <div className="lyx-layout-2">
        <ActivityStream limit={12} onViewAll={() => onGo("transactions")} />

        <div className="space-y-3">
          <LoyaltyPanel title={t("Program", "البرنامج")} icon={<IconTrendingUp size={16} />} index={5}>
            <div className="mb-3 flex flex-wrap gap-2">
              <StatusOrb status={d.program.enabled ? "ok" : "pending"} pulse={false} label={d.program.enabled ? t("Program on", "البرنامج مفعّل") : t("Program off", "البرنامج متوقف")} />
              {(["visits", "spending"] as const).map((m) => (
                <StatusOrb key={m} status={d.earning[m] ? "ok" : "inactive"} pulse={false} label={`${m === "visits" ? t("Visits", "الزيارات") : t("Spending", "الإنفاق")} · ${d.earning[m] ? t("on", "مفعّل") : t("off", "متوقف")}`} />
              ))}
            </div>
            <p className="text-xs leading-relaxed text-mute">
              {d.program.enabled
                ? d.earningConfigured
                  ? t("Your Loyalty program is live and points are awarded automatically under the rules you configured.", "برنامج الولاء يعمل وتُمنح النقاط تلقائيًا وفق القواعد التي ضبطتها.")
                  : t("Your program is live, but earning rules haven't been configured yet — nothing is awarded automatically.", "البرنامج يعمل لكن لم تُضبط قواعد الكسب بعد — لا تُمنح نقاط تلقائيًا.")
                : canConfigure
                ? t("Switch the program on in Settings to start enrolling members.", "فعّل البرنامج من الإعدادات لتبدأ بتسجيل الأعضاء.")
                : t("The clinic owner or doctor needs to switch the program on.", "على مالك العيادة أو الطبيب تفعيل البرنامج.")}
            </p>
            {canConfigure && (
              <button type="button" className={`mt-3 text-xs ${!d.program.enabled ? "btn-teal !px-3 !py-1.5" : "lyx-link !p-0"}`} onClick={() => onGo("settings")}>
                {!d.program.enabled ? t("Open settings", "فتح الإعدادات") : d.earningConfigured ? t("Edit rules", "تعديل القواعد") : t("Configure earning rules", "ضبط قواعد الكسب")}
              </button>
            )}
          </LoyaltyPanel>

          <LoyaltyPanel
            title={t("Latest members", "أحدث الأعضاء")}
            icon={<IconUsers size={16} />}
            index={6}
            action={
              d.members > 0 ? (
                <button type="button" className="lyx-link" onClick={() => onGo("members")}>
                  {t("View all", "عرض الكل")}
                </button>
              ) : undefined
            }
          >
            {recentMembers.isLoading ? (
              <LoyaltyLoader className="h-28" />
            ) : (recentMembers.data?.members.length ?? 0) === 0 ? (
              <LoyaltyEmptyState
                kind="members"
                compact
                icon={<IconUsers size={28} stroke={1.5} />}
                title={t("No Loyalty members yet.", "لا يوجد أعضاء في برنامج الولاء بعد.")}
                text={t("Your Loyalty program is ready for member enrollment. Enrolled patients start with 0 points.", "برنامج الولاء جاهز لتسجيل الأعضاء. يبدأ كل مريض مسجَّل برصيد 0 نقطة.")}
                action={
                  d.program.enabled && canEnroll ? (
                    <button type="button" className="btn-teal text-xs" onClick={() => onGo("members", true)}>
                      <IconUserPlus size={15} /> {t("Enroll first member", "تسجيل أول عضو")}
                    </button>
                  ) : undefined
                }
              />
            ) : (
              <div>
                {recentMembers.data!.members.map((m) => (
                  <div key={m.id} className="lyx-member-row">
                    <Avatar name={m.patient?.fullName ?? "?"} />
                    <div className="nm">
                      <b>{m.patient?.fullName ?? "—"}</b>
                      <span>{date(m.joinedAt)}</span>
                    </div>
                    {m.tier && (
                      <span className="hidden sm:inline-flex">
                        <TierBadge tierKey={m.tier.key} name={m.tier.name} size="sm" />
                      </span>
                    )}
                    <div className="pt">{fmtNum(m.pointsBalance)}</div>
                  </div>
                ))}
              </div>
            )}
          </LoyaltyPanel>
        </div>
      </div>

      <TiersGlance onGo={onGo} canConfigure={canConfigure} />
    </div>
  );
}

/** Tier widgets for the overview — real counts from GET /tiers/analytics only; nothing is drawn when tiers are off. */
function TiersGlance({ onGo, canConfigure }: { onGo: (tab: LoyaltyTab) => void; canConfigure: boolean }) {
  const { t } = useLT();
  const cfg = useTiersConfig();
  const usable = !!cfg.data?.config.usable;
  const an = useTierAnalytics(usable);

  if (cfg.isError) return <LoyaltyErrorState message={apiError(cfg.error, t("Couldn't load tiers", "تعذّر تحميل المستويات")).message} onRetry={() => cfg.refetch()} />;
  if (cfg.isLoading || !cfg.data) return <LoyaltyLoader className="h-28" />;

  if (!usable) {
    return (
      <LoyaltyPanel title={t("Tiers", "المستويات")} icon={<IconStairsUp size={16} />} index={7}>
        <div data-testid="overview-tiers-off">
          <p className="text-xs leading-relaxed text-mute">
            {canConfigure ? t("Reward loyal patients with four progression tiers. Set them up when you're ready — points keep working exactly as they do now.", "كافئ المرضى المخلصين بأربعة مستويات تقدّم. أعدّها عندما تكون جاهزًا — تبقى النقاط تعمل كما هي الآن.") : t("Tiers aren't set up for this clinic yet.", "المستويات غير مفعّلة لهذه العيادة بعد.")}
          </p>
          {canConfigure && (
            <button type="button" className="btn-teal mt-3 !px-3 !py-1.5 text-xs" onClick={() => onGo("tiers")}>
              {t("Set up tiers", "إعداد المستويات")}
            </button>
          )}
        </div>
      </LoyaltyPanel>
    );
  }

  const a = an.data;
  return (
    <LoyaltyPanel
      title={t("Tiers", "المستويات")}
      icon={<IconTrophy size={16} />}
      index={7}
      action={
        <button type="button" className="lyx-link" onClick={() => onGo("tiers")}>
          {t("View all", "عرض الكل")}
        </button>
      }
    >
      <div data-testid="overview-tiers">
        {an.isError ? (
          <LoyaltyErrorState message={apiError(an.error, t("Couldn't load tier analytics", "تعذّر تحميل تحليلات المستويات")).message} onRetry={() => an.refetch()} />
        ) : !a ? (
          <LoyaltyLoader className="h-20" />
        ) : a.totalMembers === 0 ? (
          <p className="text-xs text-mute">{t("Tier numbers appear here as soon as patients are enrolled in Loyalty.", "تظهر أرقام المستويات هنا فور تسجيل المرضى في الولاء.")}</p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <ul className="grid grid-cols-2 gap-2">
                {a.tiers.map((x) => (
                  <li key={x.key} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-edge bg-soft px-2.5 py-2.5">
                    <TierBadge tierKey={x.key} name={x.name} size="sm" />
                    <span className="lyx-num text-base font-semibold tabular-nums text-ink" data-testid={`overview-tier-count-${x.key}`}>
                      {fmtNum(x.count)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-mute">
                {t(`${fmtNum(a.promotions.count)} promotion(s) in the last ${a.promotions.windowDays} days`, `${fmtNum(a.promotions.count)} ترقية في آخر ${a.promotions.windowDays} يومًا`)}
                {a.nearNext && a.nearNext.total > 0 ? ` · ${t(`${fmtNum(a.nearNext.total)} close to the next tier`, `${fmtNum(a.nearNext.total)} قريبون من المستوى التالي`)}` : ""}
              </p>
            </div>
            <div>
              {a.recentPromotions.length === 0 ? <p className="text-xs text-mute">{t("No promotions yet. They appear here when a member really moves up a tier.", "لا توجد ترقيات بعد. تظهر هنا عندما ينتقل عضو فعليًا إلى مستوى أعلى.")}</p> : <TierHistoryList rows={a.recentPromotions.slice(0, 3)} showPatient />}
            </div>
          </div>
        )}
      </div>
    </LoyaltyPanel>
  );
}
