"use client";
import { useEffect, useRef, useState } from "react";
import { IconHistory } from "@tabler/icons-react";
import { apiError, useLoyaltyActivity, useLT } from "@/lib/loyalty";
import { ActivityItem, LoyaltyEmptyState, LoyaltyErrorState, LoyaltyLoader, LoyaltyPanel } from "../ui/LoyaltyUI";

/**
 * Live activity stream (Phase 8): a timeline of the clinic's REAL recent Loyalty events (new members, points, confirmed check-ins, redemptions,
 * reversals, promotions) from GET /api/loyalty/activity, refreshed every 20 s while the tab is visible. Events that arrive after the first load slide
 * in with a short highlight; the first load and every revisit render still. Under reduced motion the highlight is a plain, still list.
 */
export default function ActivityStream({ limit = 12, onViewAll }: { limit?: number; onViewAll?: () => void }) {
  const { t } = useLT();
  const q = useLoyaltyActivity(true, limit);
  const [now, setNow] = useState(() => Date.now());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!q.data) return;
    const ids = q.data.events.map((e) => e.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    ids.forEach((id) => seen.current!.add(id));
    if (!added.length) return;
    setFresh(new Set(added));
    const tm = setTimeout(() => setFresh(new Set()), 3200);
    return () => clearTimeout(tm);
  }, [q.data]);

  const events = q.data?.events ?? [];
  return (
    <LoyaltyPanel
      title={t("Live activity", "النشاط المباشر")}
      subtitle={t("What is happening in your program right now.", "ما يحدث في برنامجك الآن.")}
      icon={<IconHistory size={16} />}
      testId="lyx-activity"
      index={4}
      action={
        <span className="flex items-center gap-3">
          <span className="lyx-live">{t("LIVE", "مباشر")}</span>
          {onViewAll && events.length > 0 && (
            <button type="button" className="lyx-link" onClick={onViewAll}>
              {t("Ledger", "السجلّ")}
            </button>
          )}
        </span>
      }
    >
      {q.isError ? (
        <LoyaltyErrorState message={apiError(q.error, t("Couldn't load the activity", "تعذّر تحميل النشاط")).message} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <LoyaltyLoader key={i} className="h-12" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <LoyaltyEmptyState kind="activity" compact title={t("No activity yet.", "لا يوجد نشاط بعد.")} text={t("Events appear here the moment they really happen — a new member, a confirmed check-in, a redemption.", "تظهر الأحداث هنا لحظة حدوثها فعلًا — عضو جديد، تسجيل وصول مؤكَّد، استبدال.")} />
      ) : (
        <ul className="lyx-tl" aria-live="polite">
          {events.map((e) => (
            <ActivityItem key={e.id} event={e} now={now} fresh={fresh.has(e.id)} />
          ))}
        </ul>
      )}
    </LoyaltyPanel>
  );
}
