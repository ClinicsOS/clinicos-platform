"use client";
import { IconClockHour4, IconCoins, IconHistory, IconTicket } from "@tabler/icons-react";
import { useLT, usePendingRedemptionCount, useRewardsSummary } from "@/lib/loyalty";
import { useLoyaltyUi } from "@/lib/loyaltyNav";
import RedemptionQueue from "./RedemptionQueue";
import RedemptionHistory from "./RedemptionHistory";
import { LoyaltyMetric, SegTabs } from "./ui/LoyaltyUI";

/**
 * Redemptions (Phase 8): its own section. "Pending" is the queue staff answer (confirm → points move; reject → nothing moves); "History" is the
 * filterable record, where owner / doctor can reverse a confirmed redemption. The chosen view and the history filters live in the Loyalty UI store, so
 * they survive moving to another section and coming back.
 */
export default function RedemptionsTab({ canReverse }: { canReverse: boolean }) {
  const { t } = useLT();
  const view = useLoyaltyUi((s) => s.redemptionsView);
  const setView = useLoyaltyUi((s) => s.setRedemptionsView);
  const summary = useRewardsSummary();
  const pendingCount = usePendingRedemptionCount(true).data?.pending ?? 0;
  const s = summary.data;
  return (
    <div className="space-y-3">
      <div className="lyx-grid-metrics" data-testid="rd-stats">
        <LoyaltyMetric index={0} tone="rose" label={t("Pending", "قيد الانتظار")} value={s ? s.pending : "—"} icon={<IconClockHour4 size={17} />} hint={s && s.pending > 0 ? t("Waiting for your answer", "بانتظار ردّك") : undefined} />
        <LoyaltyMetric index={1} tone="mint" label={t("Redeemed", "تم صرفها")} value={s ? s.confirmed : "—"} icon={<IconTicket size={17} />} />
        <LoyaltyMetric index={2} label={t("Points redeemed", "النقاط المصروفة")} value={s ? s.pointsRedeemed : "—"} icon={<IconCoins size={17} />} />
        <LoyaltyMetric index={3} label={t("Active rewards", "جوائز فعّالة")} value={s ? s.activeRewards : "—"} icon={<IconHistory size={17} />} />
      </div>
      <SegTabs
        label={t("Redemptions view", "عرض الاستبدالات")}
        value={view}
        onChange={setView}
        items={[
          { id: "pending", label: t("Pending", "قيد الانتظار"), badge: pendingCount, testId: "rw-view-pending" },
          { id: "history", label: t("History", "السجل"), testId: "rw-view-history" },
        ]}
      />
      {view === "pending" ? <RedemptionQueue /> : <RedemptionHistory canReverse={canReverse} />}
    </div>
  );
}
