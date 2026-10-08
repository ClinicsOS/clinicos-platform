"use client";
import { useEffect, useRef, useState } from "react";
import { IconAlertTriangle, IconCheck, IconClockHour4, IconGift, IconWifiOff, IconX } from "@tabler/icons-react";
import { fmtNum, useLT } from "@/lib/loyalty";
import type { PublicReward, PublicRewardRequest } from "@/lib/loyaltyPublic";
import { usePatientVisual } from "./patientDesign";
import RewardTicket, { ticketStateOf } from "./RewardTicket";
import { useDialog } from "./useDialog";
import type { ActionResult } from "./usePatientData";

/**
 * The reward focus sheet (Phase 9). The chosen reward floats forward as a 3D object while the screen behind recedes.
 *
 *  Honest numbers, all from the server: the reward's cost, the patient's CURRENT balance, and "balance after confirmation" (balance − cost,
 *  labelled as what happens only IF reception confirms).
 *  REQUEST ≠ REDEMPTION. Pressing the button sends a request and nothing else: no points are deducted, the reward is NOT "redeemed". After the
 *  server accepts, the ticket switches to its PENDING lock state ("Waiting for clinic confirmation."). Only reception can confirm, and only
 *  then (RedeemComplete below) does the app say "redeemed".
 *  The success state is never shown before the server's answer: while the request is in flight the button shows progress and nothing else.
 */
type Phase = "idle" | "sending" | "error";

export default function RewardSheet({
  reward,
  balance,
  online,
  onClose,
  onAsk,
  onOpenChange,
}: {
  reward: PublicReward | null;
  balance: number;
  online: boolean;
  onClose: () => void;
  onAsk: (rewardId: string) => Promise<ActionResult<{ state: "created" | "already_pending" }>>;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, date } = useLT();
  const v = usePatientVisual();
  const open = !!reward;
  const ref = useDialog(open, onClose, { onOpenChange, initialFocus: "[data-autofocus]" });
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [justSent, setJustSent] = useState(false);
  const id = reward?.id;
  const busy = useRef(false);

  useEffect(() => {
    setPhase("idle");
    setErr(null);
    setJustSent(false);
    busy.current = false;
  }, [id]);

  if (!reward) return null;
  const state = ticketStateOf(reward);
  const after = balance - reward.pointsRequired;

  const send = async () => {
    if (busy.current || !online || !reward.canRedeem || reward.pending) return;
    busy.current = true;
    setPhase("sending");
    setErr(null);
    const r = await onAsk(reward.id);
    busy.current = false;
    if (r.ok) {
      setJustSent(true);
      setPhase("idle");
    } else {
      if (r.code === "SESSION_EXPIRED") return; // the app already moved to the entry screen
      setErr(r.code);
      setPhase("error");
    }
  };

  const errText = (c: string) =>
    c === "INSUFFICIENT_BALANCE"
      ? t("You don't have enough points for this reward yet.", "لا تملك نقاطًا كافية لهذه الجائزة بعد.")
      : c === "REWARD_UNAVAILABLE" || c === "REWARD_NOT_FOUND"
      ? t("This reward isn't available right now.", "هذه الجائزة غير متاحة حاليًا.")
      : c === "REDEMPTION_LIMIT"
      ? t("Too many requests. Please ask reception.", "طلبات كثيرة. يرجى سؤال الاستقبال.")
      : c === "REDEMPTION_QUEUE_FULL"
      ? t("Rewards are very busy right now. Please ask reception.", "الجوائز مزدحمة الآن. يرجى سؤال الاستقبال.")
      : c === "RATE_LIMITED"
      ? t("Please wait a moment and try again.", "يرجى الانتظار لحظة ثم المحاولة مجددًا.")
      : t("Something went wrong. Nothing was sent — please try again.", "حدث خطأ ما. لم يُرسل شيء — يرجى المحاولة مرة أخرى.");

  const pending = reward.pending;
  return (
    <div className="rs-root" data-testid="pw-reward-sheet" data-mode={v.mode}>
      <div className="rs-back" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="rs-panel" role="dialog" aria-modal="true" aria-label={reward.name} tabIndex={-1}>
        <button type="button" className="rs-close" onClick={onClose} aria-label={t("Close", "إغلاق")} data-testid="pw-reward-close" data-autofocus>
          <IconX size={20} />
        </button>
        <div className="rs-obj">
          <RewardTicket data={reward} state={state} balance={balance} focus testId="pw-sheet-ticket" />
        </div>

        <dl className="rs-facts">
          <div>
            <dt>{t("Cost", "التكلفة")}</dt>
            <dd className="pw-num" dir="ltr" data-testid="pw-sheet-cost">
              {fmtNum(reward.pointsRequired)}
            </dd>
          </div>
          <div>
            <dt>{t("Your balance", "رصيدك")}</dt>
            <dd className="pw-num" dir="ltr" data-testid="pw-sheet-balance">
              {fmtNum(balance)}
            </dd>
          </div>
          <div className={after < 0 ? "is-neg" : ""}>
            <dt>{t("Balance after confirmation", "الرصيد بعد التأكيد")}</dt>
            <dd className="pw-num" dir="ltr" data-testid="pw-sheet-after">
              {after < 0 ? "—" : fmtNum(after)}
            </dd>
          </div>
          <div>
            <dt>{t("Valid until", "صالحة حتى")}</dt>
            <dd>{reward.validUntil ? date(reward.validUntil) : t("No end date", "بدون تاريخ انتهاء")}</dd>
          </div>
        </dl>

        {pending ? (
          <div className="rs-state is-wait" role="status" aria-live="polite" data-testid="pw-sheet-pending">
            <span className="rs-state-ico">
              <IconClockHour4 size={22} />
            </span>
            <div>
              <b>{justSent ? t("Request sent", "تم إرسال الطلب") : t("Request pending", "الطلب قيد الانتظار")}</b>
              <p>{t("Waiting for clinic confirmation. No points are deducted until reception confirms.", "بانتظار تأكيد العيادة. لا تُخصم أي نقاط حتى يؤكد الاستقبال.")}</p>
            </div>
          </div>
        ) : (
          <>
            <p className="rs-note">
              <IconGift size={15} aria-hidden="true" /> {t("Requesting a reward does not use your points. Reception confirms it first.", "طلب الجائزة لا يستهلك نقاطك. يؤكده الاستقبال أولًا.")}
            </p>
            {!online && (
              <p className="pw-error is-soft" role="status">
                <IconWifiOff size={14} aria-hidden="true" /> {t("You're offline — requesting needs a connection.", "أنت غير متصل — الطلب يحتاج إلى اتصال.")}
              </p>
            )}
            {phase === "error" && err && (
              <p className="pw-error" role="alert" data-testid="pw-sheet-error">
                <IconAlertTriangle size={14} aria-hidden="true" /> {errText(err)}
              </p>
            )}
            <button type="button" className="pw-btn is-block is-shine" disabled={!reward.canRedeem || phase === "sending" || !online} onClick={send} data-testid="pw-sheet-request">
              {phase === "sending" ? <span className="pw-spin" aria-hidden="true" /> : <IconGift size={20} aria-hidden="true" />}
              {phase === "sending" ? t("Sending request…", "جارٍ إرسال الطلب…") : reward.canRedeem ? t("Request this reward", "اطلب هذه الجائزة") : t("Not enough points yet", "النقاط غير كافية بعد")}
            </button>
            {!reward.canRedeem && (
              <p className="rs-sub" data-testid="pw-sheet-missing">
                {t(`${fmtNum(reward.missingPoints)} more points to go.`, `تحتاج ${fmtNum(reward.missingPoints)} نقطة إضافية.`)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Shown ONLY for a request the server reports as confirmed by reception (and not yet celebrated on this device): the reward was really
 * redeemed and the points really deducted. All numbers come from the server's own request + balance.
 */
export function RedeemComplete({ request, balance, onClose, onOpenChange }: { request: PublicRewardRequest | null; balance: number; onClose: () => void; onOpenChange: (open: boolean) => void }) {
  const { t } = useLT();
  const v = usePatientVisual();
  const ref = useDialog(!!request, onClose, { onOpenChange, initialFocus: "[data-autofocus]" });
  if (!request) return null;
  return (
    <div className="rs-root" data-testid="pw-redeem-complete" data-mode={v.mode}>
      <div className="rs-back" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="rs-panel rs-done" role="dialog" aria-modal="true" aria-label={t("Reward redeemed", "تم صرف الجائزة")} tabIndex={-1}>
        <div className="rs-seal" aria-hidden="true">
          <i />
          <i />
          <span>
            <IconCheck size={40} stroke={2.2} />
          </span>
          {v.mode !== "static" && (
            <em>
              {Array.from({ length: v.mode === "full" ? 12 : 6 }, (_, i) => (
                <u key={i} style={{ ["--a" as string]: `${(360 / (v.mode === "full" ? 12 : 6)) * i}deg`, ["--d" as string]: `${i % 3}` } as React.CSSProperties} />
              ))}
            </em>
          )}
        </div>
        <h2 className="rs-title" dir="auto">
          {t("Reward redeemed", "تم صرف الجائزة")}
        </h2>
        <p className="rs-reward" dir="auto">
          {request.rewardName}
        </p>
        <dl className="rs-facts is-two">
          <div>
            <dt>{t("Points used", "النقاط المستخدمة")}</dt>
            <dd className="pw-num" dir="ltr" data-testid="pw-done-points">
              −{fmtNum(request.points)}
            </dd>
          </div>
          <div>
            <dt>{t("Your balance now", "رصيدك الآن")}</dt>
            <dd className="pw-num" dir="ltr" data-testid="pw-done-balance">
              {fmtNum(balance)}
            </dd>
          </div>
        </dl>
        <p className="rs-note">{t("Confirmed by the clinic.", "أكّدتها العيادة.")}</p>
        <button type="button" className="pw-btn is-block" onClick={onClose} data-autofocus data-testid="pw-done-close">
          {t("Done", "تم")}
        </button>
      </div>
    </div>
  );
}
