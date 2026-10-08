"use client";
import { IconArrowBackUp, IconChartBar, IconCoins, IconGift, IconHandStop, IconInfoCircle, IconUserPlus } from "@tabler/icons-react";
import { apiError, fmtNum, useLoyaltyAnalytics, useLT, useRewards, type AnalyticsDays } from "@/lib/loyalty";
import { useLoyaltyUi } from "@/lib/loyaltyNav";
import { useTxLabel } from "./parts";
import { DayChart, Donut, HBars, StackBar } from "./ui/LoyaltyCharts";
import { LoyaltyEmptyState, LoyaltyErrorState, LoyaltyLoader, LoyaltyMetric, LoyaltyPanel, SegTabs } from "./ui/LoyaltyUI";

const C = { gold: "#e8c76a", rose: "#e68a9c", mint: "#6fd6b0", info: "#9db7d9", danger: "#f08a8a", mute: "#8a8578" };

/**
 * Analytics (Phase 8). Every number is counted or summed by the server from the clinic's own stored records inside the chosen window (by clinic-local day);
 * the browser only draws them. Nothing is estimated, smoothed or filled in. When the server had to cap a very large window it says so, and we say so too.
 */
export default function AnalyticsTab() {
  const { t } = useLT();
  const days = useLoyaltyUi((s) => s.analyticsDays);
  const setDays = useLoyaltyUi((s) => s.setAnalyticsDays);
  const q = useLoyaltyAnalytics(days);
  const txLabel = useTxLabel();
  const rewards = useRewards();
  const a = q.data;

  const seg = (
    <SegTabs
      label={t("Time window", "الفترة الزمنية")}
      value={String(days) as "7" | "30" | "90"}
      onChange={(v) => setDays(Number(v) as AnalyticsDays)}
      items={[
        { id: "7", label: t("7 days", "7 أيام"), testId: "an-days-7" },
        { id: "30", label: t("30 days", "30 يومًا"), testId: "an-days-30" },
        { id: "90", label: t("90 days", "90 يومًا"), testId: "an-days-90" },
      ]}
    />
  );

  if (q.isError && !a) return <LoyaltyErrorState message={apiError(q.error, t("Couldn't load analytics", "تعذّر تحميل التحليلات")).message} onRetry={() => q.refetch()} />;
  if (!a) {
    return (
      <div className="space-y-3" aria-busy="true">
        {seg}
        <div className="lyx-grid-metrics">
          {[0, 1, 2, 3].map((i) => (
            <LoyaltyLoader key={i} className="h-28" />
          ))}
        </div>
        <LoyaltyLoader className="h-72" />
      </div>
    );
  }

  const tot = a.totals;
  const empty = tot.points.issued === 0 && tot.points.redeemed === 0 && tot.checkIns.total === 0 && tot.newMembers === 0 && tot.redemptions.requested === 0;
  const trunc = Object.entries(a.truncated).filter(([, v]) => v).map(([k]) => k);
  const truncName: Record<string, string> = { transactions: t("transactions", "الحركات"), checkIns: t("check-ins", "تسجيلات الوصول"), members: t("members", "الأعضاء"), redemptions: t("redemptions", "الاستبدالات") };
  const ci = tot.checkIns;
  const share = ci.confirmedShareOfResolved;
  const rewardsRows = [...a.rewards].filter((r) => r.requested > 0 || r.pointsRedeemed > 0).sort((x, y) => y.pointsRedeemed - x.pointsRedeemed || y.confirmed - x.confirmed);
  const typeRows = Object.entries(tot.points.byType).filter(([, v]) => v.points !== 0).map(([k, v]) => ({ key: k, label: `${txLabel(k as never)} · ${fmtNum(v.count)}×`, value: Math.abs(v.points) })).sort((x, y) => y.value - x.value);
  const viaName: Record<string, string> = { qr: "QR", nfc: "NFC", link: t("Link", "رابط") };

  return (
    <div className="space-y-3" data-testid="an-root">
      <div className="lyx-an-bar">
        {seg}
        <span className="text-[11px]" style={{ color: "var(--lyx-text3)" }}>
          {t("Clinic days (Amman time)", "أيام العيادة (بتوقيت عمّان)")}
        </span>
      </div>

      {trunc.length > 0 && (
        <div className="lyx-an-note" role="note" data-testid="an-truncated">
          <IconInfoCircle size={14} style={{ flex: "none", marginTop: 2 }} />
          <span>{t(`This window is very large, so the figures for ${trunc.map((k) => truncName[k]).join(", ")} cover the most recent records only. Choose a shorter window for exact totals.`, `هذه الفترة كبيرة جدًا، لذا تغطي أرقام ${trunc.map((k) => truncName[k]).join("، ")} أحدث السجلات فقط. اختر فترة أقصر لأرقام دقيقة.`)}</span>
        </div>
      )}

      <div className="lyx-grid-metrics" data-testid="an-metrics">
        <LoyaltyMetric index={0} label={t("Points issued", "نقاط صادرة")} value={tot.points.issued} icon={<IconCoins size={17} />} variant="spark" spark={a.series.issued} testId="an-issued" />
        <LoyaltyMetric index={1} tone="rose" label={t("Points redeemed", "نقاط مصروفة")} value={tot.points.redeemed} icon={<IconGift size={17} />} hint={tot.points.returned > 0 ? t(`${fmtNum(tot.points.returned)} returned by reversals`, `${fmtNum(tot.points.returned)} أُعيدت بالعكس`) : undefined} variant="spark" spark={a.series.redeemed} testId="an-redeemed" />
        <LoyaltyMetric index={2} tone="mint" label={t("Check-ins confirmed", "تسجيلات وصول مؤكَّدة")} value={ci.confirmed} icon={<IconHandStop size={17} />} variant={share !== null ? "ring" : "stat"} ring={share !== null ? { value: share, max: 100 } : undefined} hint={share !== null ? t("of resolved requests", "من الطلبات المحسومة") : undefined} testId="an-checkins" />
        <LoyaltyMetric index={3} label={t("New members", "أعضاء جدد")} value={tot.newMembers} icon={<IconUserPlus size={17} />} variant="spark" spark={a.series.newMembers} testId="an-members" />
      </div>

      {empty ? (
        <LoyaltyPanel title={t("Nothing to chart yet", "لا يوجد ما يُرسم بعد")} icon={<IconChartBar size={16} />} index={4}>
          <LoyaltyEmptyState kind="analytics" icon={<IconChartBar size={30} stroke={1.5} />} title={t("No activity in this window.", "لا يوجد نشاط في هذه الفترة.")} text={t("Charts fill in from real points, check-ins, members and redemptions — try a longer window, or come back once your program has activity.", "تمتلئ الرسوم من النقاط وتسجيلات الوصول والأعضاء والاستبدالات الفعلية — جرّب فترة أطول أو عُد عندما يصبح لبرنامجك نشاط.")} />
        </LoyaltyPanel>
      ) : (
        <>
          <LoyaltyPanel title={t("Points flow", "حركة النقاط")} subtitle={t("Issued above the line, redeemed below it, per day.", "الصادر فوق الخط والمصروف تحته، لكل يوم.")} icon={<IconCoins size={16} />} index={4}>
            <DayChart
              testId="an-points-chart"
              ariaLabel={t("Points issued and redeemed per day", "النقاط الصادرة والمصروفة لكل يوم")}
              dates={a.series.dates}
              series={[
                { key: "issued", label: t("Issued", "صادرة"), values: a.series.issued, color: C.gold, dir: "up" },
                { key: "returned", label: t("Returned", "مُعادة"), values: a.series.returned, color: C.mint, dir: "up" },
                { key: "redeemed", label: t("Redeemed", "مصروفة"), values: a.series.redeemed, color: C.rose, dir: "down" },
              ]}
            />
          </LoyaltyPanel>

          <div className="lyx-an-grid two">
            <LoyaltyPanel title={t("Check-ins", "تسجيلات الوصول")} subtitle={t("Requests per day and how many were confirmed.", "الطلبات لكل يوم وكم منها تأكّد.")} icon={<IconHandStop size={16} />} index={5}>
              <DayChart
                testId="an-checkin-chart"
                ariaLabel={t("Check-in requests per day", "طلبات تسجيل الوصول لكل يوم")}
                height={150}
                dates={a.series.dates}
                series={[
                  { key: "all", label: t("Requested", "مطلوبة"), values: a.series.checkIns, color: C.info },
                  { key: "ok", label: t("Confirmed", "مؤكَّدة"), values: a.series.checkInsConfirmed, color: C.mint },
                ]}
              />
              <div style={{ marginTop: 18 }}>
                <Donut
                  testId="an-checkin-donut"
                  centre={share === null ? "—" : `${Math.round(share)}%`}
                  sub={t("confirmed of resolved", "مؤكَّدة من المحسومة")}
                  parts={[
                    { key: "c", label: t("Confirmed", "مؤكَّدة"), value: ci.confirmed, color: C.mint },
                    { key: "r", label: t("Rejected", "مرفوضة"), value: ci.rejected, color: C.danger },
                    { key: "e", label: t("Expired", "منتهية"), value: ci.expired, color: C.mute },
                    { key: "x", label: t("Cancelled", "ملغاة"), value: ci.cancelled, color: C.info },
                    { key: "p", label: t("Waiting", "بالانتظار"), value: ci.pending, color: C.gold },
                  ]}
                />
                {Object.keys(ci.byVia).length > 0 && (
                  <p className="mt-3 text-[11px]" style={{ color: "var(--lyx-text2)" }}>
                    {t("Arrived via", "طريقة الوصول")}: {Object.entries(ci.byVia).map(([k, v]) => `${viaName[k] ?? k} ${fmtNum(v)}`).join(" · ")}
                  </p>
                )}
              </div>
            </LoyaltyPanel>

            <div className="space-y-3">
              <LoyaltyPanel title={t("Redemption requests", "طلبات الاستبدال")} subtitle={t("What happened to the requests made in this window.", "ما حدث للطلبات المقدَّمة في هذه الفترة.")} icon={<IconArrowBackUp size={16} />} index={6}>
                <StackBar
                  testId="an-redemption-stack"
                  parts={[
                    { key: "c", label: t("Redeemed", "تم الصرف"), value: tot.redemptions.confirmed, color: C.gold },
                    { key: "v", label: t("Reversed", "معكوسة"), value: tot.redemptions.reversed, color: C.rose },
                    { key: "r", label: t("Rejected", "مرفوضة"), value: tot.redemptions.rejected, color: C.danger },
                    { key: "p", label: t("Pending", "قيد الانتظار"), value: tot.redemptions.pending, color: C.info },
                  ]}
                />
                <p className="mt-3 text-[11px]" style={{ color: "var(--lyx-text3)" }}>
                  {t(`${fmtNum(tot.redemptions.requested)} requested in total`, `${fmtNum(tot.redemptions.requested)} طلبًا إجمالًا`)}
                </p>
              </LoyaltyPanel>

              <LoyaltyPanel title={t("Rewards by points redeemed", "الجوائز حسب النقاط المصروفة")} icon={<IconGift size={16} />} index={7}>
                {rewardsRows.length === 0 ? (
                  <LoyaltyEmptyState kind="analytics" compact icon={<IconGift size={26} stroke={1.5} />} title={t("No reward activity in this window.", "لا نشاط للجوائز في هذه الفترة.")} />
                ) : (
                  <HBars testId="an-rewards" color={C.gold} rows={rewardsRows.slice(0, 6).map((r) => ({ key: r.rewardId, label: r.name, value: r.pointsRedeemed, sub: t(`${r.confirmed} redeemed · ${r.requested} requested`, `${r.confirmed} مصروفة · ${r.requested} مطلوبة`) }))} unit={t("pts", "نقطة")} />
                )}
                {rewards.data && rewardsRows.length > 6 && <p className="mt-2 text-[10.5px]" style={{ color: "var(--lyx-text3)" }}>{t(`Top 6 of ${rewardsRows.length}`, `أعلى 6 من ${rewardsRows.length}`)}</p>}
              </LoyaltyPanel>
            </div>
          </div>

          {typeRows.length > 0 && (
            <LoyaltyPanel title={t("Where points come from and go", "من أين تأتي النقاط وأين تذهب")} subtitle={t("Absolute points per kind of ledger entry.", "النقاط المطلقة لكل نوع من حركات السجل.")} icon={<IconCoins size={16} />} index={8}>
              <HBars testId="an-types" rows={typeRows} color={C.info} unit={t("pts", "نقطة")} />
            </LoyaltyPanel>
          )}
        </>
      )}
    </div>
  );
}
