"use client";
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import Link from "next/link";
import { IconCrown, IconGift, IconHandStop, IconSettings, IconTicket, IconUserPlus, IconUsers, IconCoins } from "@tabler/icons-react";
import { fmtNum, useCheckInSummary, useLoyaltyOverview, useLT, usePendingRedemptionCount, useRewardsSummary, useTierAnalytics, useTiersConfig } from "@/lib/loyalty";
import { SECTION_PATH, type LoyaltySection } from "@/lib/loyaltyNav";
import LoyaltyCard3D from "../LoyaltyCard3D";
import { StatusOrb } from "../ui/LoyaltyUI";
import { useVisual } from "../shell/loyaltyDesign";

interface Sat {
  key: string;
  icon: ReactNode;
  value: string;
  label: string;
  section: LoyaltySection;
  tone?: "mint" | "rose";
}

/**
 * Overview hero — the "loyalty ecosystem" (Phase 8): the program's card at the centre, real counts orbiting it in 3D.
 *
 * Every orbiting value is a real number from the clinic's own data (members, waiting check-ins, active rewards, points issued, members in the top
 * tier — only when tiers are set up — and waiting redemptions). Nothing is invented; a value that isn't loaded yet simply isn't shown.
 * Full visual mode: the chips orbit (pure CSS 3D, counter-rotated so they always face the viewer) and the whole stage follows the pointer a little.
 * Lite / reduced-motion / small screens: no orbit and no parallax — the same facts as a tidy grid of links under the card.
 */
export default function OverviewHero({ clinicName, canEnroll, canConfigure, onGo }: { clinicName: string; canEnroll: boolean; canConfigure: boolean; onGo: (s: LoyaltySection, enroll?: boolean) => void }) {
  const { t } = useLT();
  const { mode } = useVisual();
  const ov = useLoyaltyOverview();
  const checkIns = useCheckInSummary(true).data?.pending;
  const redeemPending = usePendingRedemptionCount(true).data?.pending;
  const rewards = useRewardsSummary(true).data;
  const cfg = useTiersConfig();
  const usable = !!cfg.data?.config.usable;
  const tierAn = useTierAnalytics(usable).data;
  const stageRef = useRef<HTMLDivElement>(null);

  const d = ov.data;
  const programName = d?.program.displayName ?? null;
  const on = d?.program.enabled;

  const sats: Sat[] = [];
  if (d) sats.push({ key: "members", icon: <IconUsers size={16} />, value: fmtNum(d.members), label: t("Members", "الأعضاء"), section: "members" });
  if (checkIns !== undefined) sats.push({ key: "checkins", icon: <IconHandStop size={16} />, value: fmtNum(checkIns), label: t("Pending check-ins", "تسجيلات بالانتظار"), section: "checkin", tone: "mint" });
  if (rewards) sats.push({ key: "rewards", icon: <IconGift size={16} />, value: fmtNum(rewards.activeRewards), label: t("Active rewards", "مكافآت فعّالة"), section: "rewards", tone: "rose" });
  if (d) sats.push({ key: "issued", icon: <IconCoins size={16} />, value: fmtNum(d.pointsIssued.total), label: t("Points issued", "نقاط صادرة"), section: "transactions" });
  if (usable && tierAn && tierAn.totalMembers > 0) sats.push({ key: "top", icon: <IconCrown size={16} />, value: fmtNum(tierAn.topTier.count), label: tierAn.topTier.name, section: "tiers" });
  if (redeemPending !== undefined) sats.push({ key: "redeem", icon: <IconTicket size={16} />, value: fmtNum(redeemPending), label: t("Pending redemptions", "استبدالات بالانتظار"), section: "redemptions", tone: "rose" });

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (mode !== "full" || e.pointerType !== "mouse") return;
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) - 0.5;
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) - 0.5;
    el.style.setProperty("--pry", (px * 10).toFixed(2));
    el.style.setProperty("--prx", (-py * 7).toFixed(2));
  };
  const leave = () => {
    stageRef.current?.style.setProperty("--pry", "0");
    stageRef.current?.style.setProperty("--prx", "0");
  };

  const labels = { points: t("POINTS IN CIRCULATION", "النقاط المتداولة"), preview: t("PREVIEW", "معاينة"), memberPlaceholder: t("MEMBER NAME", "اسم العضو"), since: t("SINCE", "منذ") };
  const n = sats.length;

  return (
    <section className="lyx-hero" data-testid="lyx-hero" aria-label={t("Loyalty overview", "نظرة عامة على الولاء")}>
      <div className="lyx-hero-copy">
        <div className="lyx-eyebrow">ClinicOS Loyalty</div>
        <h2 className="lyx-display">{programName || t("Loyalty", "برنامج الولاء")}</h2>
        <p>{t("Enroll your patients and run your clinic's Loyalty program from one place.", "سجّل مرضاك وأدِر برنامج الولاء الخاص بعيادتك من مكان واحد.")}</p>
        <div className="lyx-hero-status">
          <StatusOrb status="active" pulse={false} label={t("Add-on active", "الإضافة مفعّلة")} />
          {d && <StatusOrb status={on ? "ok" : "pending"} pulse={false} label={on ? t("Program on", "البرنامج مفعّل") : t("Program off", "البرنامج متوقف")} />}
        </div>
        <div className="lyx-hero-cta">
          {canEnroll && on && (
            <button type="button" className="btn-teal" onClick={() => onGo("members", true)} data-testid="hero-enroll">
              <IconUserPlus size={16} /> {t("Enroll a patient", "تسجيل مريض")}
            </button>
          )}
          {canConfigure && d && !on && (
            <button type="button" className="btn-teal" onClick={() => onGo("settings")}>
              <IconSettings size={16} /> {t("Open settings", "فتح الإعدادات")}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={() => onGo("members")}>
            <IconUsers size={16} /> {t("View members", "عرض الأعضاء")}
          </button>
        </div>
      </div>

      <div className="lyx-stage" ref={stageRef} onPointerMove={move} onPointerLeave={leave} data-testid="lyx-hero-stage">
        <div className="lyx-stage-in">
          <div className="lyx-floor" aria-hidden="true" />
          <div className="lyx-hero-card">
            <LoyaltyCard3D clinicName={clinicName} programName={programName} memberName={null} balance={null} figure={d ? d.pointsOutstanding : null} caption={d ? `${fmtNum(d.members)} ${t("MEMBERS", "أعضاء")}` : null} badge="CLINICOS" labels={labels} />
          </div>

          {/* orbit (full mode) — decorative duplicate of the grid below / the metrics row */}
          {n > 0 && (
            <div className="lyx-ring3d" aria-hidden="true">
              <div className="lyx-spin">
                {sats.map((s, i) => (
                  <div key={s.key} className="lyx-sat" style={{ ["--a" as string]: `${(360 / n) * i}deg` } as CSSProperties}>
                    <div className="lyx-sat-in">
                      <div className="lyx-sat-chip" data-tone={s.tone}>
                        <i>{s.icon}</i>
                        <span>
                          <b>{s.value}</b>
                          <em>{s.label}</em>
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* grid (lite / reduced motion) — real links */}
          <div className="lyx-sat-grid" data-testid="lyx-hero-chips">
            {sats.map((s) => (
              <Link key={s.key} href={SECTION_PATH[s.section]} className="lyx-sat-chip" data-tone={s.tone}>
                <i>{s.icon}</i>
                <span>
                  <b>{s.value}</b>
                  <em>{s.label}</em>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
