"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { useLT } from "@/lib/loyalty";
import LoyaltyCard from "./LoyaltyCard";
import { PMOTION, usePatientVisual } from "./patientDesign";
import { useDialog } from "./useDialog";

/**
 * Tier transformation (Phase 9) — REUSABLE: give it the tier the patient came from and the tier they reached and it plays the moment.
 *
 *   0 ms     the previous card (its own material) floats up to the centre
 *   500 ms   light gathers into a ring around it
 *   1000 ms  a circle of light opens from the middle and the new material replaces the old one underneath it (clip-path reveal)
 *   1700 ms  a soft flash + a handful of particles; "You reached <the clinic's own tier name>" and the tier's benefits arrive
 *
 * It is mounted ONLY by the app and ONLY for a REAL promotion the server reports that this device has not celebrated yet — never as a preview
 * and never because the patient opened the app. Skippable at any moment. Reduced motion / static mode: no travel, just the new card and the text.
 * Lite mode: the reveal is a simple cross-fade and there are no particles.
 */
export interface TransformTier {
  key: string | null;
  name: string | null;
}

export default function TierTransformation({
  from,
  to,
  clinicName,
  programName,
  logoUrl,
  accent,
  firstName,
  since,
  refCode,
  benefits,
  onDone,
  onOpenChange,
}: {
  from: TransformTier;
  to: { key: string; name: string };
  clinicName: string;
  programName?: string | null;
  logoUrl?: string | null;
  accent?: string | null;
  firstName: string;
  since: string;
  refCode: string;
  benefits: string[];
  onDone: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLT();
  const v = usePatientVisual();
  const ref = useDialog(true, onDone, { onOpenChange, initialFocus: "[data-autofocus]" });
  const [stage, setStage] = useState(v.mode === "static" ? 3 : 0);

  useEffect(() => {
    if (v.mode === "static") return undefined;
    const ids = [setTimeout(() => setStage(1), 500), setTimeout(() => setStage(2), 1000), setTimeout(() => setStage(3), 1700)];
    return () => ids.forEach(clearTimeout);
  }, [v.mode]);

  const n = v.mode === "full" ? 16 : 0;
  const common = { clinicName, programName, logoUrl, accent, firstName, since, refCode, benefits, interactive: false, sweep: "none" as const };
  return (
    <div className="tt-root" data-testid="pw-tier-transform" data-stage={stage} data-mode={v.mode} data-to={to.key}>
      <div className="tt-back" aria-hidden="true" />
      <div ref={ref} className="tt-panel" role="dialog" aria-modal="true" aria-label={t(`You reached ${to.name}`, `وصلت إلى ${to.name}`)} tabIndex={-1}>
        <div className="tt-stage">
          <div className="tt-glow" aria-hidden="true" />
          <div className="tt-stack">
            <div className="tt-a">
              <LoyaltyCard {...common} tierKey={from.key} tierName={from.name} testId="pw-tt-from" />
            </div>
            <div className="tt-b">
              <LoyaltyCard {...common} tierKey={to.key} tierName={to.name} interactive={stage >= 3} sweep={stage >= 2 ? "once" : "none"} testId="pw-tt-to" />
            </div>
            <span className="tt-ring" aria-hidden="true" />
            {n > 0 && stage >= 2 && (
              <span className="tt-parts" aria-hidden="true">
                {Array.from({ length: n }, (_, i) => (
                  <i key={i} style={{ ["--a" as string]: `${(360 / n) * i + (i % 2 ? 7 : -5)}deg`, ["--r" as string]: `${90 + (i % 4) * 26}px`, ["--s" as string]: `${0.6 + (i % 3) * 0.3}` } as CSSProperties} />
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="tt-text" aria-live="polite">
          <p className="tt-kicker">{from.name ? t("YOU MOVED UP", "ارتقيت") : t("WELCOME", "أهلًا بك")}</p>
          <h2 className="tt-title" dir="auto" data-testid="pw-tt-title">
            {t(`You reached ${to.name}`, `وصلت إلى ${to.name}`)}
          </h2>
          {from.name && (
            <p className="tt-from" dir="auto">
              {t(`From ${from.name}`, `من ${from.name}`)}
            </p>
          )}
          {benefits.length > 0 && (
            <ul className="tt-benefits">
              {benefits.slice(0, 4).map((b, i) => (
                <li key={i} dir="auto" style={{ ["--i" as string]: i } as CSSProperties}>
                  {b}
                </li>
              ))}
            </ul>
          )}
          <p className="tt-note">{t("Your available points are unchanged by this.", "رصيد نقاطك المتاح لا يتغيّر بسبب ذلك.")}</p>
        </div>
        <button type="button" className="pw-btn is-block tt-go" onClick={onDone} data-autofocus data-testid="pw-tt-continue" style={{ ["--d" as string]: `${PMOTION.cinematic}ms` } as CSSProperties}>
          {stage < 3 ? t("Skip", "تخطي") : t("Continue", "متابعة")}
        </button>
      </div>
    </div>
  );
}
