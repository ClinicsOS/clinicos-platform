"use client";
import { memo } from "react";
import { IconAward, IconCalendarCheck, IconGift, IconMinus, IconPlus, IconReceipt, IconRefresh, IconSparkles, IconArrowBackUp, IconTimeline } from "@tabler/icons-react";
import { fmtNum, useLT } from "@/lib/loyalty";
import type { PublicActivityRow, PublicKind } from "@/lib/loyaltyPublic";
import type { PatientData } from "./usePatientData";
import { usePatientVisual } from "./patientDesign";

/**
 * Loyalty activity (Phase 9) as a dimensional timeline: a glowing spine with raised nodes, grouped by day.
 * Only LOYALTY-safe events are ever here (visit / spending points, clinic adjustments, reversals, redeemed rewards, tier promotions) — the
 * server sends nothing clinical, no staff notes and no amounts of money. Points are always shown with a sign AND a word, never colour alone.
 */
const ICON: Record<PublicKind, typeof IconPlus> = {
  visit: IconCalendarCheck,
  spending: IconReceipt,
  adjustment_credit: IconPlus,
  adjustment_debit: IconMinus,
  reversal: IconArrowBackUp,
  redemption: IconGift,
  tier_promotion: IconAward,
  other: IconSparkles,
};

export function useActivityText() {
  const { t } = useLT();
  return (row: PublicActivityRow): string => {
    switch (row.kind) {
      case "visit":
        return t("Points for your visit", "نقاط زيارتك");
      case "spending":
        return t("Points for your payment", "نقاط دفعتك");
      case "adjustment_credit":
        return t("Points added by the clinic", "نقاط أضافتها العيادة");
      case "adjustment_debit":
        return t("Points adjusted by the clinic", "تعديل من العيادة على النقاط");
      case "reversal":
        return t("Points reversed", "إلغاء نقاط");
      case "redemption":
        return t("Reward redeemed", "صرف جائزة");
      case "tier_promotion":
        return row.tierName ? t(`Reached ${row.tierName}`, `وصلت إلى ${row.tierName}`) : t("Reached a new tier", "وصلت إلى مستوى جديد");
      default:
        return t("Loyalty activity", "نشاط الولاء");
    }
  };
}

function useDayLabel() {
  const { t, lang } = useLT();
  const locale = lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB";
  return (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    const y = new Date();
    y.setDate(today.getDate() - 1);
    const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (same(d, today)) return t("Today", "اليوم");
    if (same(d, y)) return t("Yesterday", "أمس");
    return d.toLocaleDateString(locale, { day: "numeric", month: "long", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  };
}

export const RowItem = memo(function RowItem({ row, index, compact }: { row: PublicActivityRow; index: number; compact?: boolean }) {
  const { t, lang } = useLT();
  const text = useActivityText();
  const Icon = ICON[row.kind] ?? IconSparkles;
  const hasPoints = row.kind !== "tier_promotion";
  const up = row.points > 0;
  const time = new Date(row.at).toLocaleTimeString(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <li className={`ac-row ${compact ? "is-compact" : ""}`} data-kind={row.kind} data-testid="pw-activity-row" style={{ ["--i" as string]: Math.min(index, 8) } as React.CSSProperties}>
      <span className="ac-node" aria-hidden="true">
        <Icon size={17} stroke={1.8} />
      </span>
      <div className="ac-card">
        <div className="ac-main">
          <div className="ac-title" dir="auto">
            {text(row)}
          </div>
          <div className="ac-meta">
            {time}
            {row.balanceAfter !== null && (
              <>
                {" · "}
                {t("Balance", "الرصيد")} <b className="pw-num" dir="ltr">{fmtNum(row.balanceAfter)}</b>
              </>
            )}
          </div>
        </div>
        {hasPoints && (
          <div className={`ac-pts ${up ? "is-up" : "is-down"}`} dir="ltr" data-testid="pw-activity-points">
            <b className="pw-num">
              {up ? "+" : "−"}
              {fmtNum(Math.abs(row.points))}
            </b>
            <em>{row.kind === "redemption" ? t("spent", "مصروفة") : up ? t("earned", "مكتسبة") : t("removed", "مخصومة")}</em>
          </div>
        )}
        {!hasPoints && (
          <span className="pw-chip is-ok" data-testid="pw-activity-promo">
            {t("New tier", "مستوى جديد")}
          </span>
        )}
      </div>
    </li>
  );
});

/** The full timeline (Activity screen). */
export default function ActivityTimeline({ activity, online, onMore, onRetry }: { activity: PatientData["activity"]; online: boolean; onMore: () => void; onRetry: () => void }) {
  const { t } = useLT();
  const v = usePatientVisual();
  const day = useDayLabel();

  if (!activity.loaded && activity.loading) {
    return (
      <div className="ac-skel" aria-busy="true" aria-label={t("Loading your activity", "جارٍ تحميل نشاطك")}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="pw-skel" style={{ height: 70, animationDelay: `${i * 0.12}s` }} />
        ))}
      </div>
    );
  }
  if (activity.error && activity.rows.length === 0) {
    return (
      <div className="pw-empty" role="alert" data-testid="pw-activity-error">
        <span className="pw-ico">
          <IconRefresh size={28} />
        </span>
        <h3>{t("We couldn't load your activity", "تعذر تحميل نشاطك")}</h3>
        <p>{t("Check your connection and try again.", "تحقق من اتصالك وحاول مرة أخرى.")}</p>
        <button type="button" className="pw-ghost" onClick={onRetry} disabled={!online}>
          <IconRefresh size={16} aria-hidden="true" /> {t("Try again", "حاول مرة أخرى")}
        </button>
      </div>
    );
  }
  if (activity.loaded && activity.rows.length === 0) {
    return (
      <div className="pw-empty" data-testid="pw-activity-empty">
        <span className="pw-ico">
          <IconTimeline size={30} />
        </span>
        <h3>{t("No activity yet", "لا يوجد نشاط بعد")}</h3>
        <p>{t("Points you earn and rewards you use will appear here.", "ستظهر هنا النقاط التي تكسبها والجوائز التي تستخدمها.")}</p>
      </div>
    );
  }

  const groups: { label: string; rows: PublicActivityRow[] }[] = [];
  for (const r of activity.rows) {
    const label = day(r.at);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.rows.push(r);
    else groups.push({ label, rows: [r] });
  }
  let n = 0;
  return (
    <div className="ac" data-testid="pw-activity" data-mode={v.mode}>
      {groups.map((g) => (
        <section key={g.label + g.rows[0].key} className="ac-group" aria-label={g.label}>
          <h3 className="ac-day">{g.label}</h3>
          <ol className="ac-list">
            {g.rows.map((r) => (
              <RowItem key={r.key} row={r} index={n++} />
            ))}
          </ol>
        </section>
      ))}
      {activity.page < activity.pages && (
        <div className="ac-more">
          <button type="button" className="pw-ghost" onClick={onMore} disabled={activity.loading || !online} data-testid="pw-activity-more">
            {activity.loading ? <span className="pw-spin" aria-hidden="true" /> : null}
            {t("Show earlier activity", "عرض النشاط الأقدم")}
          </button>
          {activity.error && <p className="pw-error is-soft">{t("Couldn't load more. Try again.", "تعذر تحميل المزيد. حاول مرة أخرى.")}</p>}
        </div>
      )}
    </div>
  );
}
