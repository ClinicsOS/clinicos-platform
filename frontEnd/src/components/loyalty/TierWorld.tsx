"use client";
import { type CSSProperties } from "react";
import { IconAlertTriangle, IconStairsUp } from "@tabler/icons-react";
import { fmtMetricValue, fmtNum, useLT, useTierText, type TierAnalytics, type TierConfigDto, type TierKey, type TierUnit } from "@/lib/loyalty";
import { useLoyaltyUi } from "@/lib/loyaltyNav";
import TierCard3D, { TierBadge } from "./TierCard3D";
import { BenefitList } from "./TierParts";
import { LoyaltySurface, ProgressRail, StatusOrb } from "./ui/LoyaltyUI";
import { TIER_ACCENT } from "./shell/loyaltyDesign";

const unitLabel = (u: TierUnit | null, t: (en: string, ar: string) => string) => (u === "points" ? t("POINTS", "نقطة") : u === "visits" ? t("VISITS", "زيارة") : u === "jod" ? t("JOD", "دينار") : "");

/**
 * Tier world (Phase 8): the four tiers as four metallic objects on one path, plus a detail stage for the one you select.
 * Everything shown is the clinic's own configuration and the server's real counts — nothing is invented. Selecting a tier only changes what is shown;
 * it never changes data. The selected tier is remembered while you move around Loyalty.
 */
export default function TierWorld({ config, analytics, brand, canConfigure, onConfigure }: { config: TierConfigDto; analytics: TierAnalytics | undefined; brand: string; canConfigure: boolean; onConfigure: () => void }) {
  const { t } = useLT();
  const tx = useTierText();
  const sel = useLoyaltyUi((s) => s.tiersSel);
  const setSel = useLoyaltyUi((s) => s.setTiersSel);
  const unit = config.unit;
  const stat = (k: TierKey) => analytics?.tiers.find((x) => x.key === k);
  const needs = analytics ? analytics.needsAttention.awaitingRecalculation : 0;
  const cur = config.tiers.find((x) => x.key === sel) ?? config.tiers[0];
  const cs = stat(cur.key);
  const idx = config.tiers.findIndex((x) => x.key === cur.key);
  const next = config.tiers[idx + 1];

  return (
    <div className="space-y-3" data-testid="tier-world">
      <LoyaltySurface data-pad="true" index={0} rise>
        <div className="lyx-tw-head">
          <span className="text-xs" style={{ color: "var(--lyx-text2)" }}>
            {t("Progression is based on", "التقدّم مبني على")} <b style={{ color: "var(--lyx-ivory)" }} data-testid="tiers-metric">{tx.metricName(config.progressionMetric)}</b>
          </span>
          <StatusOrb status="active" pulse={false} label={t("Tiers on", "المستويات مفعّلة")} />
        </div>
        {canConfigure && needs > 0 && (
          <div className="lyx-rd-note" data-k="gold" style={{ alignItems: "center", flexWrap: "wrap" }} data-testid="tiers-needs-recalc">
            <IconAlertTriangle size={14} />
            <span style={{ flex: 1, minWidth: 0 }}>{t(`${fmtNum(needs)} member(s) haven't been evaluated under the current rules yet.`, `يوجد ${fmtNum(needs)} عضو لم يُقيَّموا بعد وفق القواعد الحالية.`)}</span>
            <button type="button" className="lyx-link" onClick={onConfigure}>
              {t("Open maintenance", "فتح الصيانة")}
            </button>
          </div>
        )}
      </LoyaltySurface>

      {/* the path: four materials, one journey */}
      <div className="lyx-tw-path" data-testid="tiers-grid" role="group" aria-label={t("Choose a tier", "اختر مستوى")}>
        {config.tiers.map((s, i) => {
          const st = stat(s.key);
          const on = s.key === cur.key;
          return (
            <div key={s.key} className="lyx-tw-cell" style={{ ["--i" as string]: i, ["--tc" as string]: TIER_ACCENT[s.key] } as CSSProperties}>
              <div className="lyx-tw-step" aria-hidden="true">
                <span>{i + 1}</span>
              </div>
              <button type="button" className={`lyx-tw-node ${on ? "is-sel" : ""}`} aria-pressed={on} onClick={() => setSel(s.key)} data-testid={`tier-pick-${s.key}`} aria-label={`${s.name} — ${s.key === "tier1" ? t("every member starts here", "يبدأ كل عضو من هنا") : `${t("from", "من")} ${tx.value(s.threshold ?? 0, unit)}`}`}>
                <TierCard3D
                  tierKey={s.key}
                  tierName={s.name}
                  brand={brand}
                  tierWord={t("TIER", "المستوى")}
                  centerLabel={`${s.key === "tier1" ? t("BASE TIER", "المستوى الأساسي") : t("STARTS AT", "يبدأ من")} · ${unitLabel(unit, t)}`}
                  centerValue={fmtMetricValue(s.threshold ?? 0, unit)}
                  holder={st ? `${fmtNum(st.count)} ${st.count === 1 ? t("member", "عضو") : t("members", "أعضاء")}` : null}
                  testId={`tier-card-${s.key}`}
                />
              </button>
              <div className="lyx-tw-meta">
                <TierBadge tierKey={s.key} name={s.name} />
                <span data-testid={`tier-threshold-${s.key}`}>{s.key === "tier1" ? t("Every member starts here", "يبدأ كل عضو من هنا") : `${t("From", "من")} ${tx.value(s.threshold ?? 0, unit)}`}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* detail stage for the selected tier */}
      <LoyaltySurface data-pad="lg" tone="gold" index={1} rise data-testid="tier-detail" aria-live="polite">
        <div className="lyx-tw-detail" style={{ ["--tc" as string]: TIER_ACCENT[cur.key] } as CSSProperties}>
          <div className="lyx-tw-d-main">
            <div className="flex flex-wrap items-center gap-2">
              <TierBadge tierKey={cur.key} name={cur.name} />
              <span className="lyx-eyebrow" style={{ margin: 0 }}>
                {t("Tier", "المستوى")} {idx + 1} / {config.tiers.length}
              </span>
            </div>
            <h3 className="lyx-tw-title lyx-display" dir="auto">
              {cur.name}
            </h3>
            {cur.description ? (
              <p className="lyx-tw-desc" dir="auto">
                {cur.description}
              </p>
            ) : (
              <p className="lyx-tw-desc" style={{ opacity: 0.7 }}>
                {cur.key === "tier1" ? t("Every enrolled member starts here.", "يبدأ كل عضو مسجَّل من هنا.") : t("No description added.", "لم تُضف وصفًا.")}
              </p>
            )}
            <div className="lyx-tw-facts">
              <div>
                <small>{cur.key === "tier1" ? t("Starts at", "يبدأ من") : t("Reached at", "يُبلغ عند")}</small>
                <b dir="ltr">{tx.value(cur.threshold ?? 0, unit)}</b>
              </div>
              <div>
                <small>{t("Members here", "الأعضاء هنا")}</small>
                <b dir="ltr" data-testid="tier-detail-count">{cs ? fmtNum(cs.count) : "—"}</b>
              </div>
              {analytics && cs && (
                <div>
                  <small>{t(`Promotions in · ${analytics.promotions.windowDays}d`, `ترقيات إليه · ${analytics.promotions.windowDays} يومًا`)}</small>
                  <b dir="ltr">{cur.key === "tier1" ? "—" : fmtNum(cs.promotionsInWindow)}</b>
                </div>
              )}
            </div>
            {cs && analytics && analytics.totalMembers > 0 && (
              <div style={{ marginTop: 14 }}>
                <div className="lyx-rd-afford-t">
                  <span>{t("Share of members", "حصته من الأعضاء")}</span>
                  <span dir="ltr">{cs.percent}%</span>
                </div>
                <ProgressRail value={cs.percent} max={100} tierColor={TIER_ACCENT[cur.key]} height={8} label={t("Share of members in this tier", "نسبة الأعضاء في هذا المستوى")} />
              </div>
            )}
            {next && (
              <p className="lyx-tw-next">
                <IconStairsUp size={14} /> {t(`Next: ${next.name} from ${tx.value(next.threshold ?? 0, unit)}`, `التالي: ${next.name} من ${tx.value(next.threshold ?? 0, unit)}`)}
              </p>
            )}
          </div>
          <div className="lyx-tw-d-ben">
            <div className="lyx-tw-bt">{t("Benefits", "المزايا")}</div>
            <BenefitList benefits={cur.benefits} empty={t("No benefits listed.", "لا توجد مزايا معروضة.")} />
          </div>
        </div>
      </LoyaltySurface>
    </div>
  );
}
