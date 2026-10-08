"use client";
import { useRef, useState, type CSSProperties } from "react";
import { IconArrowRight, IconChevronRight, IconDownload, IconGift, IconLogout, IconMaximize, IconRefresh, IconShieldLock, IconSparkles, IconTimeline, IconX } from "@tabler/icons-react";
import { fmtNum, useLT } from "@/lib/loyalty";
import type { PublicMe, PublicReward } from "@/lib/loyaltyPublic";
import ActivityTimeline, { RowItem } from "./ActivityTimeline";
import CheckInPanel from "./CheckInPanel";
import { useInstall, IosInstallSheet } from "./InstallPrompt";
import LoyaltyCard from "./LoyaltyCard";
import { setPatientVisualPref, usePatientVisual } from "./patientDesign";
import PointsOrb from "./PointsOrb";
import RewardTicket, { ticketStateOf } from "./RewardTicket";
import type { ScreenId } from "./PatientShell";
import TierRail from "./TierRail";
import PatientPortal from "./PatientPortal";
import { useDialog } from "./useDialog";
import type { PatientData } from "./usePatientData";

/**
 * The four patient screens (Phase 9): Home · Rewards · Activity · My Card.
 * They only render what `usePatientData` holds — real server values — and have loading / empty / error states of their own.
 */
export interface ScreenCtx {
  data: PatientData;
  me: PublicMe;
  online: boolean;
  go: (id: ScreenId) => void;
  openReward: (id: string) => void;
  onSignOut: () => void;
  onOpenChange: (open: boolean) => void;
}

const useCardProps = (me: PublicMe, date: (d: string) => string) => ({
  clinicName: me.clinic.name,
  programName: me.clinic.programName,
  logoUrl: me.clinic.logoUrl,
  accent: me.clinic.brandColor,
  firstName: me.member.displayName,
  since: date(me.member.memberSince),
  refCode: me.member.ref,
  tierKey: me.tier?.key ?? null,
  tierName: me.tier?.name ?? null,
  tierRank: me.tier?.rank ?? null,
  benefits: me.tier?.benefits.map((b) => b.title) ?? [],
});

function SectionHead({ icon, title, action, onAction }: { icon: React.ReactNode; title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="pw-h">
      {icon}
      <span>{title}</span>
      {action && onAction && (
        <button type="button" className="pw-link pw-h-end" onClick={onAction}>
          {action} <IconChevronRight size={13} aria-hidden="true" className="pw-flip" />
        </button>
      )}
    </div>
  );
}

/* =============================================================== HOME =============================================================== */

export function HomeScreen({ ctx }: { ctx: ScreenCtx }) {
  const { data, me, online, go, openReward } = ctx;
  const { t, date } = useLT();
  const card = useCardProps(me, (d) => date(d));
  const rewards = data.rewards?.rewards ?? [];
  // the rewards worth a glance first: pending, then ones the patient can request, then the nearest locked
  const preview = [...rewards].sort((a, b) => rank(a) - rank(b) || a.missingPoints - b.missingPoints).slice(0, 2);
  const hello = me.member.displayName ? t(`Hello, ${me.member.displayName}`, `أهلًا ${me.member.displayName}`) : t("Hello", "أهلًا بك");
  const benefits = me.tier?.benefits ?? [];

  return (
    <div className="hm" data-testid="pw-home">
      <h1 className="pw-title hm-hello" dir="auto" data-testid="pw-hello">
        {hello}
      </h1>
      <p className="pw-sub hm-sub">{t("Your Loyalty card", "بطاقة الولاء الخاصة بك")}</p>

      <div className="hm-hero">
        <LoyaltyCard {...card} flightTarget axes="x" onTap={() => go("card")} testId="pw-card" sweep="once" />
        <button type="button" className="pw-link hm-open" onClick={() => go("card")} data-testid="pw-open-card">
          {t("Open my card", "افتح بطاقتي")} <IconArrowRight size={14} aria-hidden="true" className="pw-flip" />
        </button>
      </div>

      <section className="pw-panel hm-points" aria-label={t("Available points", "النقاط المتاحة")}>
        <PointsOrb balance={me.member.balance} event={data.balanceEvent} onEventDone={data.clearBalanceEvent} stale={!online} />
      </section>

      {me.tier && (
        <section className="pw-panel hm-tier" aria-label={t("Tier progress", "تقدم المستوى")}>
          <div className="pw-h">
            <IconSparkles size={14} aria-hidden="true" />
            <span>{t("TIER PROGRESS", "تقدم المستوى")}</span>
          </div>
          <TierRail tier={me.tier} />
          <p className="hm-note">{t("Tier progress is separate from your available points — using a reward never lowers your tier.", "تقدم المستوى منفصل عن نقاطك المتاحة — استخدام جائزة لا يخفض مستواك.")}</p>
        </section>
      )}

      {benefits.length > 0 && me.tier && (
        <section className="pw-panel hm-benefits" aria-label={t("Your benefits", "مزاياك")} data-testid="pw-benefits">
          <div className="pw-h">
            <IconShieldLock size={14} aria-hidden="true" />
            <span>{t("YOUR BENEFITS", "مزاياك")}</span>
            <span className="pw-h-end" dir="auto">
              {me.tier.name}
            </span>
          </div>
          <ul className="hm-bl">
            {benefits.map((b, i) => (
              <li key={i}>
                <i aria-hidden="true" />
                <div>
                  <b dir="auto">{b.title}</b>
                  {b.description && <span dir="auto">{b.description}</span>}
                </div>
              </li>
            ))}
          </ul>
          <p className="hm-note">{t("Benefits are described by your clinic. Ask reception how to use them.", "المزايا تصفها عيادتك. اسأل الاستقبال عن كيفية الاستفادة منها.")}</p>
        </section>
      )}

      <CheckInPanel data={data} firstName={me.member.displayName} online={online} />

      <section className="hm-sec" aria-label={t("Rewards", "الجوائز")}>
        <SectionHead icon={<IconGift size={14} aria-hidden="true" />} title={t("REWARDS", "الجوائز")} action={rewards.length > 0 ? t("See all", "عرض الكل") : undefined} onAction={() => go("rewards")} />
        {!data.rewards && !data.rewardsError && <div className="pw-skel" style={{ height: 132 }} aria-busy="true" />}
        {data.rewardsError && !data.rewards && (
          <div className="pw-panel hm-soft" role="alert">
            <p>{t("We couldn't load rewards.", "تعذر تحميل الجوائز.")}</p>
            <button type="button" className="pw-link" onClick={() => void data.refreshRewards()}>
              <IconRefresh size={13} aria-hidden="true" /> {t("Try again", "حاول مرة أخرى")}
            </button>
          </div>
        )}
        {data.rewards && rewards.length === 0 && (
          <div className="pw-panel pw-empty" data-testid="pw-rewards-empty-home">
            <span className="pw-ico">
              <IconGift size={28} />
            </span>
            <h3>{t("No rewards yet", "لا توجد جوائز بعد")}</h3>
            <p>{t("Your clinic hasn't added rewards yet. Keep collecting points.", "لم تضف عيادتك جوائز بعد. واصل جمع النقاط.")}</p>
          </div>
        )}
        {preview.length > 0 && (
          <div className="hm-tickets">
            {preview.map((r, i) => (
              <RewardTicket key={r.id} data={r} state={ticketStateOf(r)} balance={me.member.balance} index={i} onOpen={() => openReward(r.id)} testId="pw-ticket" />
            ))}
          </div>
        )}
      </section>

      <section className="hm-sec" aria-label={t("Recent activity", "النشاط الأخير")}>
        <SectionHead icon={<IconTimeline size={14} aria-hidden="true" />} title={t("RECENT ACTIVITY", "النشاط الأخير")} action={data.activity.rows.length > 0 ? t("See all", "عرض الكل") : undefined} onAction={() => go("activity")} />
        {!data.activity.loaded && data.activity.loading && <div className="pw-skel" style={{ height: 76 }} aria-busy="true" />}
        {data.activity.loaded && data.activity.rows.length === 0 && (
          <div className="pw-panel hm-soft" data-testid="pw-activity-empty-home">
            <p>{t("No activity yet. Points you earn will appear here.", "لا يوجد نشاط بعد. ستظهر هنا النقاط التي تكسبها.")}</p>
          </div>
        )}
        {data.activity.rows.length > 0 && (
          <ol className="ac-list is-home">
            {data.activity.rows.slice(0, 3).map((r, i) => (
              <RowItem key={r.key} row={r} index={i} compact />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

const rank = (r: PublicReward) => (r.pending ? 0 : r.canRedeem ? 1 : 2);

/* ============================================================== REWARDS ============================================================== */

export function RewardsScreen({ ctx }: { ctx: ScreenCtx }) {
  const { data, me, openReward } = ctx;
  const { t, date } = useLT();
  const rs = data.rewards;
  const balance = rs?.balance ?? me.member.balance;
  const rewards = [...(rs?.rewards ?? [])].sort((a, b) => rank(a) - rank(b) || a.pointsRequired - b.pointsRequired);
  const redeemed = (rs?.requests ?? []).filter((r) => r.status === "confirmed").slice(0, 6);
  const rewardNames = new Set(rewards.map((r) => r.name));
  const others = (rs?.requests ?? []).filter((r) => r.status === "rejected" || r.status === "reversed" || (r.status === "pending" && !rewardNames.has(r.rewardName)));
  const statusText = (s: string) => (s === "pending" ? t("Waiting for reception", "بانتظار الاستقبال") : s === "rejected" ? t("Not approved", "لم تتم الموافقة") : t("Cancelled by clinic", "ألغتها العيادة"));

  return (
    <div className="rw" data-testid="pw-rewards">
      <h1 className="pw-title">{t("Rewards", "الجوائز")}</h1>
      <p className="pw-sub">
        {t("You have", "لديك")}{" "}
        <b className="pw-num" dir="ltr" data-testid="pw-rewards-balance">
          {fmtNum(balance)}
        </b>{" "}
        {t("points available.", "نقطة متاحة.")}
      </p>

      {!rs && !data.rewardsError && (
        <div className="rw-skel" aria-busy="true" aria-label={t("Loading rewards", "جارٍ تحميل الجوائز")}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="pw-skel" style={{ height: 150, animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
      )}
      {data.rewardsError && !rs && (
        <div className="pw-empty" role="alert" data-testid="pw-rewards-error">
          <span className="pw-ico">
            <IconRefresh size={28} />
          </span>
          <h3>{t("We couldn't load rewards", "تعذر تحميل الجوائز")}</h3>
          <p>{t("Check your connection and try again.", "تحقق من اتصالك وحاول مرة أخرى.")}</p>
          <button type="button" className="pw-ghost" onClick={() => void data.refreshRewards()}>
            <IconRefresh size={16} aria-hidden="true" /> {t("Try again", "حاول مرة أخرى")}
          </button>
        </div>
      )}
      {rs && rewards.length === 0 && redeemed.length === 0 && others.length === 0 && (
        <div className="pw-empty" data-testid="pw-rewards-empty">
          <span className="pw-ico">
            <IconGift size={30} />
          </span>
          <h3>{t("No rewards yet", "لا توجد جوائز بعد")}</h3>
          <p>{t("Your clinic hasn't added rewards yet. Keep collecting points and check back soon.", "لم تضف عيادتك جوائز بعد. واصل جمع النقاط وعد قريبًا.")}</p>
        </div>
      )}

      {rewards.length > 0 && (
        <ul className="rw-list" aria-label={t("Rewards", "الجوائز")}>
          {rewards.map((r, i) => (
            <li key={r.id}>
              <RewardTicket data={r} state={ticketStateOf(r)} balance={balance} index={i} onOpen={() => openReward(r.id)} testId="pw-ticket" />
            </li>
          ))}
        </ul>
      )}

      {redeemed.length > 0 && (
        <>
          <div className="pw-h rw-h">
            <span>{t("REDEEMED", "تم صرفها")}</span>
          </div>
          <ul className="rw-list is-redeemed" data-testid="pw-redeemed-list">
            {redeemed.map((r, i) => (
              <li key={r.key}>
                <RewardTicket data={{ name: r.rewardName, pointsRequired: r.points }} state="redeemed" balance={balance} index={i} testId="pw-ticket-redeemed" />
                <div className="rw-when">{r.resolvedAt ? t(`Redeemed on ${date(r.resolvedAt)}`, `صُرفت في ${date(r.resolvedAt)}`) : ""}</div>
              </li>
            ))}
          </ul>
        </>
      )}

      {others.length > 0 && (
        <>
          <div className="pw-h rw-h">
            <span>{t("OTHER REQUESTS", "طلبات أخرى")}</span>
          </div>
          <ul className="rw-others">
            {others.map((r) => (
              <li key={r.key} className="pw-panel rw-other">
                <div>
                  <b dir="auto">{r.rewardName}</b>
                  <span className="pw-num" dir="ltr">
                    {fmtNum(r.points)} {t("pts", "نقطة")}
                  </span>
                </div>
                <span className={`pw-chip ${r.status === "pending" ? "is-wait" : "is-off"}`}>{statusText(r.status)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="hm-note rw-note">{t("Requesting a reward never deducts points. Points are used only after reception confirms.", "طلب الجائزة لا يخصم نقاطًا. تُستخدم النقاط فقط بعد تأكيد الاستقبال.")}</p>
    </div>
  );
}

/* ============================================================= ACTIVITY ============================================================= */

export function ActivityScreen({ ctx }: { ctx: ScreenCtx }) {
  const { data, online } = ctx;
  const { t } = useLT();
  return (
    <div className="av" data-testid="pw-activity-screen">
      <h1 className="pw-title">{t("Activity", "النشاط")}</h1>
      <p className="pw-sub">{t("Your Loyalty points and rewards, newest first.", "نقاط الولاء والجوائز، الأحدث أولًا.")}</p>
      <ActivityTimeline activity={data.activity} online={online} onMore={() => void data.loadMoreActivity()} onRetry={() => void data.reload()} />
    </div>
  );
}

/* =============================================================== CARD =============================================================== */

export function CardScreen({ ctx }: { ctx: ScreenCtx }) {
  const { me, onSignOut, onOpenChange } = ctx;
  const { t, date } = useLT();
  const v = usePatientVisual();
  const card = useCardProps(me, (d) => date(d));
  const [flipped, setFlipped] = useState(false);
  const [focus, setFocus] = useState(false);
  const [help, setHelp] = useState(false);
  const inst = useInstall();
  const openBtn = useRef<HTMLButtonElement>(null);

  return (
    <div className="cd" data-testid="pw-card-screen">
      <h1 className="pw-sr">{t("My Card", "بطاقتي")}</h1>
      <div className="cd-stage">
        <LoyaltyCard {...card} flipped={flipped} onFlip={setFlipped} flipButton axes="xy" flightTarget flyIn testId="pw-card-big" sweep="once" />
        <p className="cd-hint">{v.mode === "static" ? t("Tap the button to flip your card.", "اضغط الزر لقلب بطاقتك.") : t("Drag to turn your card · tap to flip it", "اسحب لتدوير بطاقتك · اضغط لقلبها")}</p>
        <button ref={openBtn} type="button" className="pw-ghost cd-focusbtn" onClick={() => setFocus(true)} data-testid="pw-card-focus-open">
          <IconMaximize size={17} aria-hidden="true" /> {t("Focus mode", "وضع التركيز")}
        </button>
      </div>

      <dl className="pw-panel cd-facts">
        <div>
          <dt>{t("Member", "العضو")}</dt>
          <dd dir="auto">{me.member.displayName || "—"}</dd>
        </div>
        <div>
          <dt>{t("Tier", "المستوى")}</dt>
          <dd dir="auto">{me.tier?.name ?? t("Member", "عضو")}</dd>
        </div>
        <div>
          <dt>{t("Member since", "عضو منذ")}</dt>
          <dd>{date(me.member.memberSince)}</dd>
        </div>
        <div>
          <dt>{t("Reference", "المرجع")}</dt>
          <dd className="cd-ref" dir="ltr">
            {me.member.ref}
          </dd>
        </div>
      </dl>

      <section className="pw-panel cd-settings" aria-label={t("Settings", "الإعدادات")}>
        <div className="pw-h">
          <span>{t("THIS DEVICE", "هذا الجهاز")}</span>
        </div>
        <div className="cd-row">
          <div>
            <b>{t("Lighter effects", "مؤثرات أخف")}</b>
            <span>{v.reduced ? t("Your device asks for reduced motion — it is already on.", "جهازك يطلب حركة أقل — وهي مفعّلة بالفعل.") : t("Fewer animations and no 3D background — saves battery.", "حركة أقل وبدون خلفية ثلاثية الأبعاد — يوفر البطارية.")}</span>
          </div>
          <button type="button" role="switch" aria-checked={v.mode !== "full"} disabled={v.reduced} className="cd-switch" onClick={() => setPatientVisualPref(v.mode === "full" ? "lite" : "auto")} data-testid="pw-lite-switch" aria-label={t("Lighter effects", "مؤثرات أخف")}>
            <i />
          </button>
        </div>
        {(inst.canInstall || inst.canIosHelp) && (
          <div className="cd-row">
            <div>
              <b>{t("Add to home screen", "إضافة إلى الشاشة الرئيسية")}</b>
              <span>{t("Open your card like an app.", "افتح بطاقتك كتطبيق.")}</span>
            </div>
            <button type="button" className="pw-ghost" onClick={() => (inst.canInstall ? void inst.install() : setHelp(true))} data-testid="pw-install-btn">
              <IconDownload size={16} aria-hidden="true" /> {t("Add", "إضافة")}
            </button>
          </div>
        )}
        <div className="cd-row">
          <div>
            <b>{t("Close my card", "إغلاق بطاقتي")}</b>
            <span>{t("Recommended on a shared or borrowed device.", "يُنصح بذلك على جهاز مشترك أو مستعار.")}</span>
          </div>
          <button type="button" className="pw-ghost" onClick={onSignOut} data-testid="pw-signout">
            <IconLogout size={16} aria-hidden="true" /> {t("Close", "إغلاق")}
          </button>
        </div>
        <p className="hm-note cd-sec">
          <IconShieldLock size={13} aria-hidden="true" /> {t("Your card opens with your phone number only. Your card shows Loyalty information — never medical details.", "تُفتح بطاقتك برقم هاتفك فقط. تعرض بطاقتك معلومات الولاء فقط — وليس أي تفاصيل طبية.")}
        </p>
      </section>

      {focus && (
        <PatientPortal>
          <FocusMode card={card} flipped={flipped} setFlipped={setFlipped} onClose={() => setFocus(false)} onOpenChange={onOpenChange} />
        </PatientPortal>
      )}
      {help && (
        <PatientPortal>
          <IosInstallSheet onClose={() => setHelp(false)} onOpenChange={onOpenChange} />
        </PatientPortal>
      )}
    </div>
  );
}

/** In-page focus mode: the card alone, larger, over a dimmed and receded page. Esc or the close button returns. */
function FocusMode({ card, flipped, setFlipped, onClose, onOpenChange }: { card: ReturnType<typeof useCardProps>; flipped: boolean; setFlipped: (f: boolean) => void; onClose: () => void; onOpenChange: (o: boolean) => void }) {
  const { t } = useLT();
  const ref = useDialog(true, onClose, { onOpenChange, initialFocus: "[data-autofocus]" });
  return (
    <div className="cd-focus" data-testid="pw-card-focus">
      <div className="rs-back" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="cd-focus-in" role="dialog" aria-modal="true" aria-label={t("Your card, focus mode", "بطاقتك، وضع التركيز")} tabIndex={-1}>
        <button type="button" className="rs-close" onClick={onClose} aria-label={t("Close focus mode", "إغلاق وضع التركيز")} data-autofocus data-testid="pw-card-focus-close">
          <IconX size={20} />
        </button>
        <LoyaltyCard {...card} flipped={flipped} onFlip={setFlipped} flipButton axes="xy" testId="pw-card-focus-card" sweep="once" style={{ ["--lift" as string]: "1" } as CSSProperties} />
        <p className="cd-hint">{t("Drag to turn · tap to flip", "اسحب للتدوير · اضغط للقلب")}</p>
      </div>
    </div>
  );
}

