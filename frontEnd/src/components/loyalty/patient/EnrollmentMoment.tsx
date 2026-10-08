"use client";
import { useEffect, useRef, useState } from "react";
import { IconCircleCheck } from "@tabler/icons-react";
import { useLT } from "@/lib/loyalty";
import type { PublicMe } from "@/lib/loyaltyPublic";
import LoyaltyCard from "./LoyaltyCard";
import { usePatientVisual } from "./patientDesign";

/**
 * The one-time ENROLMENT moment (Phase 9.1) — played only on the response that really created the membership (`newlyEnrolled`), never
 * for a returning member (they get the short welcome-back instead) and never again after a reload (the flag lives in React state only).
 *
 *   0 ms      a scan ring opens in the dark and a thin beam sweeps through it
 *   350 ms    the ring closes in and the member's 3D Loyalty Card materialises out of depth (its tier material, first name, reference)
 *   900 ms    "Welcome to <clinic> Loyalty" · the authoritative balance (read from the server — it is 0) · the starting tier
 *   1800 ms   the moment dissolves into Home
 *
 * Everything shown is the server's own `/me` data — nothing is invented and nothing is awarded here (no welcome bonus). It is ~1.8 s,
 * skippable with a tap. Lite mode: a plain fade-and-rise, no ring, no beam. Static (reduced motion): the final composition, no travel.
 */
export const ENROLL_MS = { full: 1800, lite: 1300, static: 1400 } as const;

export default function EnrollmentMoment({ me, onDone }: { me: PublicMe; onDone: () => void }) {
  const { t, date } = useLT();
  const v = usePatientVisual();
  const mode = v.mode;
  const [stage, setStage] = useState(mode === "static" ? 2 : 0);
  const doneRef = useRef(false);
  const finish = useRef(onDone);
  finish.current = onDone;

  useEffect(() => {
    const end = () => {
      if (doneRef.current) return;
      doneRef.current = true;
      finish.current();
    };
    if (mode === "static") {
      const id = setTimeout(end, ENROLL_MS.static);
      return () => clearTimeout(id);
    }
    const lite = mode === "lite";
    const ids = [setTimeout(() => setStage(1), lite ? 80 : 350), setTimeout(() => setStage(2), lite ? 500 : 900), setTimeout(end, lite ? ENROLL_MS.lite : ENROLL_MS.full)];
    return () => ids.forEach(clearTimeout);
  }, [mode]);

  const clinic = me.clinic.name;
  const tier = me.tier?.name ?? null;
  const skip = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  };

  return (
    <div
      className="pw-enr"
      role="status"
      aria-live="polite"
      data-testid="pw-enroll"
      data-stage={stage}
      data-mode={mode}
      onPointerDown={skip}
      style={{ ["--enr-ms" as string]: `${mode === "static" ? ENROLL_MS.static : mode === "lite" ? ENROLL_MS.lite : ENROLL_MS.full}ms` }}
    >
      <span className="pw-sr">
        {t(`Welcome to ${clinic} Loyalty. You have ${me.member.balance} points.`, `أهلًا بك في ولاء ${clinic}. رصيدك ${me.member.balance} نقطة.`)}
        {tier ? " " + t(`Your tier: ${tier}.`, `مستواك: ${tier}.`) : ""}
      </span>
      <div className="pw-enr-scan" aria-hidden="true">
        <i className="pw-enr-ring" />
        <i className="pw-enr-ring r2" />
        <i className="pw-enr-beam" />
      </div>
      <div className="pw-enr-card" aria-hidden="true">
        <LoyaltyCard
          clinicName={clinic}
          programName={me.clinic.programName}
          logoUrl={me.clinic.logoUrl}
          accent={me.clinic.brandColor}
          firstName={me.member.displayName}
          since={date(me.member.memberSince)}
          refCode={me.member.ref}
          tierKey={me.tier?.key ?? null}
          tierName={tier}
          tierRank={me.tier?.rank ?? null}
          benefits={me.tier?.benefits.map((b) => b.title) ?? []}
          interactive={false}
          sweep={mode === "full" && stage >= 1 ? "once" : "none"}
          testId="pw-enroll-card"
        />
      </div>
      <div className="pw-enr-text" aria-hidden="true">
        <span className="pw-enr-k">
          <IconCircleCheck size={14} aria-hidden="true" /> {t("MEMBERSHIP READY", "العضوية جاهزة")}
        </span>
        <h2 className="pw-enr-h" dir="auto" data-testid="pw-enroll-title">
          {t(`Welcome to ${clinic} Loyalty`, `أهلًا بك في ولاء ${clinic}`)}
        </h2>
        <div className="pw-enr-facts">
          <span className="pw-enr-fact">
            <b className="pw-num" data-testid="pw-enroll-balance">
              {me.member.balance}
            </b>
            <small>{t("Points", "نقاط")}</small>
          </span>
          {tier && (
            <span className="pw-enr-fact">
              <b dir="auto" data-testid="pw-enroll-tier">
                {tier}
              </b>
              <small>{t("Starting tier", "مستوى البداية")}</small>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
