"use client";
import { useEffect, useState } from "react";
import { useLT, useTierText } from "@/lib/loyalty";
import type { PublicTier } from "@/lib/loyaltyPublic";
import { TierSymbol } from "./LoyaltyCard";
import { MATERIAL_INFO, materialOf, usePatientVisual } from "./patientDesign";

/**
 * Tier progress (Phase 9) — dimensional, and clearly SEPARATE from the available points: this is about the tier's own progression metric
 * (lifetime points / completed visits / lifetime spending, as the clinic configured it), which redeeming a reward never lowers.
 *
 *  • a material ring (the tier's own metal) with the server's percentage
 *  • a recessed depth rail with a glowing gem at the progress point
 *  • the server's real numbers: "2,350 / 3,000", "650 points to VIP", "78%"
 *  • top tier → "Highest tier"; there is no invented next level.
 */
export default function TierRail({ tier }: { tier: PublicTier }) {
  const { t } = useLT();
  const tx = useTierText();
  const v = usePatientVisual();
  const mat = materialOf(tier.key);
  const info = MATERIAL_INFO[mat];
  const pct = tier.isTopTier ? 100 : Math.max(0, Math.min(100, tier.progressPercent));
  const [p, setP] = useState(v.mode === "static" ? pct : 0);
  useEffect(() => {
    if (v.mode === "static") return setP(pct);
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setP(pct)));
    return () => cancelAnimationFrame(id);
  }, [pct, v.mode]);
  const R = 42;
  const C = 2 * Math.PI * R;

  return (
    <div className="tr" data-testid="pw-tier-progress" data-mat={mat} data-top={tier.isTopTier ? "1" : "0"} data-pct={pct}>
      <div className="tr-ring" role="img" aria-label={tier.isTopTier ? t("Highest tier reached", "وصلت إلى أعلى مستوى") : t(`${tier.progressPercent} percent of the way to ${tier.nextTierName}`, `${tier.progressPercent} بالمئة من الطريق إلى ${tier.nextTierName}`)}>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <linearGradient id={`trg-${mat}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--tr-a)" />
              <stop offset=".5" stopColor="var(--tr-b)" />
              <stop offset="1" stopColor="var(--tr-c)" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={R} className="tr-groove" />
          <circle cx="50" cy="50" r={R} className="tr-arc" stroke={`url(#trg-${mat})`} strokeDasharray={C} strokeDashoffset={C * (1 - p / 100)} transform="rotate(-90 50 50)" />
          <circle cx="50" cy="50" r={R - 7} className="tr-inner" />
        </svg>
        <div className="tr-center">
          {tier.isTopTier ? (
            <span className="tr-crown">
              <TierSymbol kind={info.symbol} />
            </span>
          ) : (
            <b className="pw-num" dir="ltr">
              {tier.progressPercent}
              <small>%</small>
            </b>
          )}
        </div>
      </div>

      <div className="tr-info">
        <div className="tr-cur" dir="auto" data-testid="pw-tier-name">
          {tier.name}
        </div>
        <div className="tr-metric">{tx.metricName(tier.metric)}</div>
        {tier.isTopTier ? (
          <div className="tr-top" data-testid="pw-tier-top">
            <span className="pw-chip is-ok">{t("Highest tier", "أعلى مستوى")}</span>
            <p>
              <b dir="ltr" className="pw-num">
                {tx.value(tier.metricValue, tier.unit)}
              </b>
            </p>
          </div>
        ) : (
          <>
            <div className="tr-frac pw-num" dir="ltr" data-testid="pw-tier-frac">
              <b>{tx.value(tier.metricValue, tier.unit)}</b>
              <span> / {tier.nextTierThreshold !== null ? tx.value(tier.nextTierThreshold, tier.unit) : ""}</span>
            </div>
            <div className="tr-next" data-testid="pw-tier-next">
              <b dir="ltr" className="pw-num">
                {tx.value(tier.remaining, tier.unit)}
              </b>{" "}
              {t("to", "حتى")} <span dir="auto">{tier.nextTierName}</span>
            </div>
          </>
        )}
      </div>

      <div className="tr-rail" aria-hidden="true">
        <div className="tr-track">
          <i className="tr-fill" style={{ transform: `scaleX(${p / 100})` }} />
          <i className="tr-gem" style={{ ["--p" as string]: `${p}%` } as React.CSSProperties} />
        </div>
        <div className="tr-ends">
          <span dir="auto">{tier.name}</span>
          <span dir="auto">{tier.isTopTier ? "★" : tier.nextTierName}</span>
        </div>
      </div>
    </div>
  );
}
