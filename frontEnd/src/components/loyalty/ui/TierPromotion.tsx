"use client";
import { useEffect, useState } from "react";
import { fmtNum, hasSeenCelebration, markCelebrated, useLT, type TierHistoryRow } from "@/lib/loyalty";
import TierCard3D from "../TierCard3D";
import { CinematicTransition } from "./LoyaltyUI";

const DAY = 86_400_000;

/**
 * The reusable PROMOTION moment (Phase 8). It plays only for a REAL promotion row the server wrote (direction "promotion", ≤ 48 h old) that this browser has
 * not celebrated yet. The id is marked as seen the instant it is picked, so a reload, another screen or another tab never replays it, and storage being blocked
 * falls back to memory (no celebration rather than a repeated one). Demotions, initial placements and old promotions never trigger it.
 */
export function useUnseenPromotion(rows: TierHistoryRow[] | undefined | null): { row: TierHistoryRow | null; dismiss: () => void } {
  const [row, setRow] = useState<TierHistoryRow | null>(null);
  const key = rows?.map((r) => r.id).join(",") ?? "";
  useEffect(() => {
    if (!rows || row) return;
    const found = rows.find((h) => h.direction === "promotion" && Date.now() - new Date(h.changedAt).getTime() < 2 * DAY && !hasSeenCelebration(h.id));
    if (found) {
      markCelebrated(found.id);
      setRow(found);
    }
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { row, dismiss: () => setRow(null) };
}

export default function TierPromotionMoment({ row, brand, metricText, onDone }: { row: TierHistoryRow | null; brand: string; metricText?: string; onDone: () => void }) {
  const { t } = useLT();
  return (
    <CinematicTransition open={!!row} onDone={onDone} ms={3000}>
      {row && (
        <div data-testid="tier-promotion-moment">
          <div className="lyx-promo-card">
            <TierCard3D
              tierKey={row.toTierKey}
              tierName={row.toTierNameNow || row.toTierName}
              brand={brand}
              tierWord={t("TIER", "المستوى")}
              centerLabel={t("REACHED", "تم بلوغه")}
              centerValue={`${fmtNum(row.metricValue)}`}
              holder={row.patient?.fullName ?? null}
              celebrate
              testId="tier-promotion-card"
            />
          </div>
          <h2 dir="auto">{t(`Promoted to ${row.toTierNameNow || row.toTierName}`, `تمت الترقية إلى ${row.toTierNameNow || row.toTierName}`)}</h2>
          <p dir="auto">
            {row.patient?.fullName ? `${row.patient.fullName} · ` : ""}
            {row.fromTierName ? `${row.fromTierName} → ${row.toTierName}` : row.toTierName}
            {metricText ? ` · ${metricText}` : ""}
          </p>
          <div className="lyx-moment-skip">{t("TAP TO CONTINUE", "اضغط للمتابعة")}</div>
        </div>
      )}
    </CinematicTransition>
  );
}
