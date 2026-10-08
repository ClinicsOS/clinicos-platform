"use client";
import { memo, type CSSProperties } from "react";
import { IconCheck, IconClockHour4, IconGift, IconLock } from "@tabler/icons-react";
import { fmtNum, useLT } from "@/lib/loyalty";
import type { PublicReward } from "@/lib/loyaltyPublic";
import { usePatientVisual } from "./patientDesign";
import { useTilt } from "./tilt";

/**
 * A reward as a physical OBJECT (Phase 9) — a foil-edged ticket with perforated notches that tilts under the finger and catches the same
 * virtual light as the Loyalty card. Four honest states, each with its own shape language (never colour alone):
 *   available  warm foil edge, "AVAILABLE" chip with a check
 *   locked     frosted glass, padlock, "NOT ENOUGH POINTS" + a recessed progress channel with the real points still missing
 *   pending    amber pulse, hourglass, "PENDING" — the request is with reception; NOTHING has been deducted
 *   redeemed   mint seal stamp, "REDEEMED" — only ever shown for a request the SERVER says reception confirmed
 *
 * Every number is the server's. The ticket never computes eligibility: `canRedeem`, `missingPoints` and `pending` come from /rewards.
 */
export type TicketState = "available" | "locked" | "pending" | "redeemed";

export const ticketStateOf = (r: Pick<PublicReward, "canRedeem" | "pending">): TicketState => (r.pending ? "pending" : r.canRedeem ? "available" : "locked");

export interface TicketData {
  name: string;
  description?: string | null;
  pointsRequired: number;
  validUntil?: string | null;
  missingPoints?: number;
}

function Ticket({
  data,
  state,
  balance,
  onOpen,
  focus,
  testId,
  index = 0,
  label,
}: {
  data: TicketData;
  state: TicketState;
  balance: number;
  onOpen?: () => void;
  /** large, 2-axis, in the reward sheet */
  focus?: boolean;
  testId?: string;
  index?: number;
  label?: string;
}) {
  const { t, lang, date } = useLT();
  const v = usePatientVisual();
  const { ref, handlers } = useTilt<HTMLDivElement>({ enabled: v.mode !== "static", axes: focus ? "xy" : "x", max: focus ? 22 : 12 });
  const pct = data.pointsRequired > 0 ? Math.max(0, Math.min(100, Math.floor((balance / data.pointsRequired) * 100))) : 0;
  const chip =
    state === "available" ? (
      <span className="pw-chip is-ok">
        <IconCheck size={13} stroke={2.4} aria-hidden="true" /> {t("AVAILABLE", "متاحة")}
      </span>
    ) : state === "pending" ? (
      <span className="pw-chip is-wait">
        <IconClockHour4 size={13} stroke={2} aria-hidden="true" /> {t("PENDING", "قيد الانتظار")}
      </span>
    ) : state === "redeemed" ? (
      <span className="pw-chip is-ok">
        <IconCheck size={13} stroke={2.4} aria-hidden="true" /> {t("REDEEMED", "تم الصرف")}
      </span>
    ) : (
      <span className="pw-chip is-lock">
        <IconLock size={13} stroke={2} aria-hidden="true" /> {t("NOT ENOUGH POINTS", "النقاط غير كافية")}
      </span>
    );
  const sub =
    state === "locked"
      ? t(`${fmtNum(data.missingPoints ?? Math.max(0, data.pointsRequired - balance))} more points needed`, `تحتاج ${fmtNum(data.missingPoints ?? Math.max(0, data.pointsRequired - balance))} نقطة إضافية`)
      : state === "pending"
      ? t("Waiting for clinic confirmation", "بانتظار تأكيد العيادة")
      : state === "redeemed"
      ? t("Confirmed by the clinic", "أكّدتها العيادة")
      : data.validUntil
      ? t(`Valid until ${date(data.validUntil)}`, `صالحة حتى ${date(data.validUntil)}`)
      : t("You have enough points", "لديك نقاط كافية");

  const body = (
    <div ref={ref} className="rt-scene" data-state={state} data-mode={v.mode} data-focus={focus ? "1" : "0"} data-dir={lang === "ar" ? "rtl" : "ltr"} style={{ ["--i" as string]: index } as CSSProperties} {...(handlers as object)}>
      <div className="rt-body">
        <div className="rt-edge" aria-hidden="true" />
        <div className="rt-face">
          <div className="rt-layer rt-pat" />
          <div className="rt-layer rt-noise" />
          <div className="rt-layer rt-spec" />
          <div className="rt-content">
            <div className="rt-top">
              {chip}
              <span className="rt-ico" aria-hidden="true">
                {state === "locked" ? <IconLock size={18} stroke={1.6} /> : state === "redeemed" ? <IconCheck size={20} stroke={2} /> : state === "pending" ? <IconClockHour4 size={18} stroke={1.6} /> : <IconGift size={19} stroke={1.6} />}
              </span>
            </div>
            <div className="rt-name" dir="auto">
              {data.name}
            </div>
            {focus && data.description ? (
              <p className="rt-desc" dir="auto">
                {data.description}
              </p>
            ) : null}
            <div className="rt-perf" aria-hidden="true" />
            <div className="rt-foot">
              <div className="rt-bot">
                <div className="rt-cost pw-num" dir="ltr">
                  <i aria-hidden="true" />
                  <b>{fmtNum(data.pointsRequired)}</b>
                  <small>{lang === "ar" ? "نقطة" : "pts"}</small>
                </div>
                <div className="rt-sub">{sub}</div>
              </div>
              {state === "locked" && (
                <div className="rt-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("Progress towards this reward", "التقدم نحو هذه الجائزة")}>
                  <i style={{ transform: `scaleX(${pct / 100})` }} />
                </div>
              )}
            </div>
            {state === "redeemed" && (
              <span className="rt-stamp" aria-hidden="true">
                <IconCheck size={26} stroke={2.4} />
              </span>
            )}
          </div>
          <div className="rt-layer rt-sweep" />
        </div>
      </div>
      <div className="rt-shadow" aria-hidden="true" />
      {onOpen && (
        <button type="button" className="rt-hit" onClick={onOpen} data-testid={testId ? `${testId}-open` : undefined} aria-label={`${label ?? data.name}. ${fmtNum(data.pointsRequired)} ${t("points", "نقطة")}. ${state === "available" ? t("Available", "متاحة") : state === "pending" ? t("Pending", "قيد الانتظار") : state === "redeemed" ? t("Redeemed", "تم الصرف") : t("Not enough points", "النقاط غير كافية")}.`} />
      )}
    </div>
  );
  return (
    <div className="rt" data-testid={testId ?? "pw-ticket"} data-state={state} data-can={state === "available" ? "1" : "0"} style={{ ["--i" as string]: index } as CSSProperties}>
      {body}
    </div>
  );
}

export default memo(Ticket);
