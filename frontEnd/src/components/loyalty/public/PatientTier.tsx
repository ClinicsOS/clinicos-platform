"use client";
import { useEffect, useState } from "react";
import { IconCircleCheck, IconTrophy } from "@tabler/icons-react";
import { useLT, useTierText } from "@/lib/loyalty";
import type { PublicTier } from "@/lib/loyaltyPublic";

/**
 * Patient side of Phase 7 — deliberately MINIMAL (the final patient app comes later): the member's tier name (the clinic's own
 * display name), the same material as the card, real progress toward the next tier, and the benefits the clinic lists.
 * Everything is calculated by the server; nothing here decides a tier.
 *
 * Promotion moment: shown only when this browser last saw a LOWER tier of the same member and the server now reports a higher
 * one (compared by the stable rank, never by name). The first ever visit just records the tier — nothing animates on every
 * load. Storage can be blocked: then we simply don't celebrate.
 */
const KEY = (slug: string, ref: string) => `lyl-tier:${slug}:${ref}`;

function usePromotion(slug: string, memberRef: string, rank: number): boolean {
  const [promoted, setPromoted] = useState(false);
  useEffect(() => {
    try {
      const k = KEY(slug, memberRef);
      const prev = Number(window.localStorage.getItem(k));
      window.localStorage.setItem(k, String(rank));
      if (Number.isInteger(prev) && prev >= 1 && rank > prev) setPromoted(true);
    } catch {
      /* private mode / blocked storage — no celebration, no error */
    }
  }, [slug, memberRef, rank]);
  return promoted;
}

export default function PatientTier({ tier, slug, memberRef }: { tier: PublicTier; slug: string; memberRef: string }) {
  const { t } = useLT();
  const tx = useTierText();
  const promoted = usePromotion(slug, memberRef, tier.rank);

  return (
    <section className="pl-glass pl-tier pl-rise" data-tier={tier.key} style={{ animationDelay: "0.8s" }} aria-label={t("Your tier", "مستواك")} data-testid="pl-tier">
      {promoted && (
        <div className="pl-promo" role="status" data-testid="pl-tier-promoted">
          <IconTrophy size={18} aria-hidden="true" />
          <span dir="auto">{t(`You've reached ${tier.name}`, `وصلت إلى مستوى ${tier.name}`)}</span>
        </div>
      )}
      <div className="pl-tier-head">
        <span className="pl-tier-chip" data-tier={tier.key} data-testid="pl-tier-name" dir="auto">
          {tier.name}
        </span>
        <small>
          {tx.metricName(tier.metric)}: <b dir="ltr">{tx.value(tier.metricValue, tier.unit)}</b>
        </small>
      </div>
      {tier.description && (
        <p className="pl-tier-desc" dir="auto">
          {tier.description}
        </p>
      )}
      <div className="pl-tier-barwrap" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={tier.progressPercent} aria-label={tier.isTopTier ? t("Highest tier", "أعلى مستوى") : t("Progress to the next tier", "التقدم نحو المستوى التالي")}>
        <span className="pl-tier-bar" style={{ transform: `scaleX(${Math.max(0, Math.min(100, tier.progressPercent)) / 100})` }} />
      </div>
      <p className="pl-tier-next" data-testid="pl-tier-next">
        {tier.isTopTier ? (
          t("You've reached our highest tier.", "وصلت إلى أعلى مستوى لدينا.")
        ) : (
          <>
            <b dir="ltr">{tier.progressPercent}%</b> {t("of the way to", "من الطريق إلى")} <span dir="auto">{tier.nextTierName}</span> · <b dir="ltr">{tx.value(tier.remaining, tier.unit)}</b> {t("to go", "متبقٍ")}
          </>
        )}
      </p>
      {tier.benefits.length > 0 && (
        <>
          <h3 className="pl-tier-h">{t("Your benefits", "مزاياك")}</h3>
          <ul className="pl-tier-list" data-testid="pl-tier-benefits">
            {tier.benefits.map((b, i) => (
              <li key={`${i}-${b.title}`}>
                <IconCircleCheck size={16} aria-hidden="true" />
                <span>
                  <b dir="auto">{b.title}</b>
                  {b.description && <small dir="auto">{b.description}</small>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export const PATIENT_TIER_CSS = `
.pl-tier{margin:18px 0 6px;padding:16px 18px;--tc:217,182,107}
.pl-tier[data-tier="tier1"]{--tc:176,190,210}.pl-tier[data-tier="tier2"]{--tc:214,224,238}.pl-tier[data-tier="tier3"]{--tc:243,209,106}.pl-tier[data-tier="tier4"]{--tc:200,160,255}
.pl-tier{border-color:rgba(var(--tc),.4)}
.pl-tier-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.pl-tier-chip{display:inline-block;max-width:100%;padding:5px 14px;border-radius:999px;font-size:13px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border:1px solid rgba(255,255,255,.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pl-tier-chip[data-tier="tier1"]{background:linear-gradient(135deg,#323943,#1c2027);color:#dde4ee}
.pl-tier-chip[data-tier="tier2"]{background:linear-gradient(135deg,#eef1f5,#a5afbd);color:#18202e}
.pl-tier-chip[data-tier="tier3"]{background:linear-gradient(135deg,#f8e19a,#c99a2e);color:#3b2806}
.pl-tier-chip[data-tier="tier4"]{background:linear-gradient(135deg,#40306c,#0b0818);color:#f6e8d0;border-color:rgba(236,200,155,.7)}
.pl-tier-head small{font-size:12px;color:#a9a08a}
.pl-tier-head small b{color:#fbf0d2;font-variant-numeric:tabular-nums}
.pl-tier-desc{margin:10px 0 0;font-size:13.5px;line-height:1.6;color:#cbbf9f;overflow-wrap:anywhere}
.pl-tier-barwrap{margin-top:14px;height:8px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden}
.pl-tier-bar{display:block;height:100%;width:100%;border-radius:99px;background:linear-gradient(90deg,rgba(var(--tc),.6),rgb(var(--tc)));transform-origin:left center;transition:transform 1s cubic-bezier(.2,.8,.3,1)}
[dir="rtl"] .pl-tier-bar{transform-origin:right center}
.pl-tier-next{margin:8px 0 0;font-size:13px;line-height:1.55;color:#cbbf9f;overflow-wrap:anywhere}
.pl-tier-next b{color:#fbf0d2;font-variant-numeric:tabular-nums}
.pl-tier-h{margin:16px 0 8px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#cbbf9f;font-weight:700}
.pl-tier-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:9px}
.pl-tier-list li{display:flex;gap:10px;align-items:flex-start;color:rgb(var(--tc))}
.pl-tier-list li svg{flex:none;margin-top:2px}
.pl-tier-list li span{display:flex;flex-direction:column;min-width:0;color:#f6ecd0}
.pl-tier-list li b{font-size:14px;font-weight:600;overflow-wrap:anywhere}
.pl-tier-list li small{font-size:12.5px;color:#a9a08a;margin-top:2px;overflow-wrap:anywhere}
.pl-promo{display:flex;align-items:center;gap:10px;margin:0 0 14px;padding:11px 14px;border-radius:14px;border:1px solid rgba(var(--tc),.6);background:linear-gradient(110deg,rgba(var(--tc),.25),rgba(var(--tc),.06));color:#fff3cc;font-size:14px;font-weight:700;animation:plPromo 1s cubic-bezier(.2,1.3,.4,1) both;overflow-wrap:anywhere}
@keyframes plPromo{0%{opacity:0;transform:scale(.8) translateY(8px)}60%{opacity:1;transform:scale(1.04)}100%{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.pl-tier-bar{transition:none}.pl-promo{animation:none!important}}
`;
