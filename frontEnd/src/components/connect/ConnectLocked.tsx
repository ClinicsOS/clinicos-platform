"use client";
// CLINICOS CONNECT (C2) — what a clinic without Messages sees. UX only: it contains NO chat data (it is shown without a single
// /api/connect call when the plan lacks the feature, and after a 402 from the server otherwise). The upgrade button uses the
// existing subscription screen; nothing here sells or bills anything itself.
import Link from "next/link";
import { IconArrowRight, IconLock, IconMessages, IconShieldLock, IconUsersGroup } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useAccess } from "@/lib/access";
import { useShellLayout } from "./ui";
import s from "./connect.module.css";

export function ConnectLocked({ reason }: { reason: "plan" | "suspended" }) {
  const { t } = useI18n();
  const access = useAccess();
  const [ref, layout] = useShellLayout<HTMLDivElement>();
  const owner = access.can("clinicSettings"); // only the owner manages the subscription screen
  const plan = reason === "plan";
  return (
    <div ref={ref} className={s.shell} data-layout={layout} data-testid="messages-locked" data-reason={reason}>
      <div className={s.locked}>
        <div className={s.lockCopy}>
          <div>
            <span className={s.pro}>PRO</span>
          </div>
          <h1>{plan ? t("msg.lockedTitle") : t("msg.title")}</h1>
          <p className={s.lead}>{plan ? t("msg.lockedSub") : t("msg.planInactive")}</p>
          {plan && (
            <ul className={s.feat}>
              <li><span className={s.fi}><IconUsersGroup size={20} stroke={1.8} /></span><div><b>{t("msg.lockedF1")}</b><span>{t("msg.lockedF1s")}</span></div></li>
              <li><span className={s.fi}><IconShieldLock size={20} stroke={1.8} /></span><div><b>{t("msg.lockedF2")}</b><span>{t("msg.lockedF2s")}</span></div></li>
              <li><span className={s.fi}><IconMessages size={20} stroke={1.8} /></span><div><b>{t("msg.lockedF3")}</b><span>{t("msg.lockedF3s")}</span></div></li>
            </ul>
          )}
          {owner ? (
            <Link href="/settings?tab=subscription" className={s.cta} data-testid="upgrade-cta">
              {plan ? t("sub.upgrade") : t("msg.planBtn")} <IconArrowRight size={17} className="rtl-flip" />
            </Link>
          ) : (
            <p className={s.lead}><IconLock size={14} style={{ verticalAlign: "-2px" }} /> {t("msg.lockedNote")}</p>
          )}
        </div>
        <div className={s.lockStage} aria-hidden="true">
          <div className={s.lockOrbs}>
            <div className={s.orb} />
          </div>
        </div>
      </div>
    </div>
  );
}
