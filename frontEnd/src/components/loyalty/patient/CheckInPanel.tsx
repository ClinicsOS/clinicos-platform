"use client";
import { useEffect, useRef, useState } from "react";
import { IconCircleCheck, IconHandStop, IconMapPinCheck, IconRefresh, IconUserCheck, IconWifiOff } from "@tabler/icons-react";
import { useLT } from "@/lib/loyalty";
import { usePatientVisual } from "./patientDesign";
import type { PatientData } from "./usePatientData";

/**
 * Check-in (Phase 9) — contextual: it exists only when the clinic turned check-in on, and lives on Home (the nav gets a small dot while a
 * request is pending).
 *
 *  • It is an EXPLICIT press. Opening the app / scanning / tapping NFC never checks anyone in.
 *  • It only sends a REQUEST. "Waiting for clinic confirmation." stays until RECEPTION confirms; the confirmed moment is shown only after the
 *    server reports it. The panel says plainly that check-in does NOT add points.
 *  • Everything shown (status, times) is the server's.
 */
type Problem = "rate" | "limit" | "busy" | "network" | null;

export default function CheckInPanel({ data, firstName, online }: { data: PatientData; firstName: string; online: boolean }) {
  const { t, lang } = useLT();
  const v = usePatientVisual();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const [fresh, setFresh] = useState(false);
  const prev = useRef<string | null>(null);
  const { checkIn } = data;
  const ci = checkIn.current;
  const status = ci?.status ?? null;

  // the confirmation animation plays only when THIS view saw the server flip from pending → confirmed
  useEffect(() => {
    if (prev.current === "pending" && status === "confirmed") {
      setFresh(true);
      const id = setTimeout(() => setFresh(false), 2600);
      prev.current = status;
      return () => clearTimeout(id);
    }
    prev.current = status;
    return undefined;
  }, [status]);

  if (!checkIn.loaded || !checkIn.enabled) return null;
  const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : "");
  const pending = status === "pending";
  const confirmed = status === "confirmed";
  const rejected = status === "rejected";
  const expired = status === "expired";

  const press = async () => {
    if (busy || !online) return;
    setBusy(true);
    setProblem(null);
    const r = await data.doCheckIn();
    setBusy(false);
    if (!r.ok && r.code !== "SESSION_EXPIRED" && r.code !== "CHECKIN_DISABLED") setProblem(r.code === "CHECKIN_LIMIT" ? "limit" : r.code === "CHECKIN_QUEUE_FULL" ? "busy" : r.code === "RATE_LIMITED" ? "rate" : "network");
  };
  const cancel = async () => {
    if (busy || !online) return;
    setBusy(true);
    const r = await data.cancelCheckInRequest();
    setBusy(false);
    if (!r.ok && r.code !== "SESSION_EXPIRED") setProblem("network");
  };

  return (
    <section className="ci" aria-label={t("Check in", "تسجيل الوصول")} data-testid="pw-checkin" data-status={status ?? "idle"} data-mode={v.mode}>
      {!pending && !confirmed && (
        <div className="ci-idle">
          <div className="ci-head">
            <span className="ci-ico" aria-hidden="true">
              <IconMapPinCheck size={22} />
            </span>
            <div>
              <h3>{t("Arrived at the clinic?", "وصلت إلى العيادة؟")}</h3>
              <p>{t("Let reception know you're here. Check-in does not add points.", "أخبر الاستقبال بوصولك. تسجيل الوصول لا يضيف نقاطًا.")}</p>
            </div>
          </div>
          {(rejected || expired) && (
            <p className="ci-note pw-pop" role="status">
              {rejected ? t("Please see reception so they can help you.", "يرجى مراجعة الاستقبال ليساعدوك.") : t("Your last request wasn't answered in time. You can check in again.", "لم يتم الرد على طلبك الأخير في الوقت المناسب. يمكنك تسجيل الوصول مجددًا.")}
            </p>
          )}
          <button type="button" className="pw-btn is-block is-shine" onClick={press} disabled={busy || !online} data-testid="pw-checkin-go">
            {busy ? <span className="pw-spin" aria-hidden="true" /> : <IconHandStop size={20} aria-hidden="true" />}
            {busy ? t("Sending…", "جارٍ الإرسال…") : rejected || expired ? t("Check in again", "سجّل وصولي مرة أخرى") : t("I'm here — check in", "وصلت — سجّل وصولي")}
          </button>
          {!online && (
            <p className="pw-error is-soft" role="status">
              <IconWifiOff size={14} aria-hidden="true" /> {t("You're offline — check-in needs a connection.", "أنت غير متصل — تسجيل الوصول يحتاج إلى اتصال.")}
            </p>
          )}
        </div>
      )}

      {pending && (
        <div className="ci-wait" role="status" aria-live="polite" data-testid="pw-checkin-pending">
          <div className="ci-radar" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>
              <IconUserCheck size={26} />
            </span>
          </div>
          <h3>{t("Waiting for clinic confirmation.", "بانتظار تأكيد العيادة.")}</h3>
          <p>{t(`Request sent at ${time(ci?.requestedAt)}. Please stay nearby — reception will confirm shortly.`, `أُرسل الطلب الساعة ${time(ci?.requestedAt)}. يرجى البقاء قريبًا — سيؤكد الاستقبال قريبًا.`)}</p>
          <p className="ci-zero">{t("No points are added by check-in.", "تسجيل الوصول لا يضيف نقاطًا.")}</p>
          <button type="button" className="pw-link" onClick={cancel} disabled={busy || !online}>
            {t("Cancel request", "إلغاء الطلب")}
          </button>
        </div>
      )}

      {confirmed && (
        <div className={`ci-done ${fresh ? "is-fresh" : ""}`} role="status" aria-live="polite" data-testid="pw-checkin-confirmed">
          <div className="ci-burst" aria-hidden="true">
            <i />
            <i />
            <span>
              <IconCircleCheck size={34} stroke={1.8} />
            </span>
          </div>
          <h3>{firstName ? t(`You're checked in, ${firstName}`, `تم تسجيل وصولك يا ${firstName}`) : t("You're checked in", "تم تسجيل وصولك")}</h3>
          <p>{t(`Confirmed by reception at ${time(ci?.resolvedAt)}. Please take a seat — you'll be called shortly.`, `أكّد الاستقبال وصولك الساعة ${time(ci?.resolvedAt)}. تفضّل بالجلوس وسيتم استدعاؤك قريبًا.`)}</p>
        </div>
      )}

      <div className="ci-msg" role="alert" aria-live="assertive">
        {problem && (
          <p className="pw-error pw-pop">
            {problem === "rate" && t("Please wait a moment and try again.", "يرجى الانتظار لحظة ثم المحاولة مجددًا.")}
            {problem === "limit" && t("Too many check-in requests today. Please tell reception you've arrived.", "طلبات كثيرة اليوم. يرجى إخبار الاستقبال بوصولك.")}
            {problem === "busy" && t("Check-in is very busy right now. Please tell reception you've arrived.", "نظام التسجيل مزدحم الآن. يرجى إخبار الاستقبال بوصولك.")}
            {problem === "network" && (
              <>
                {t("Something went wrong. ", "حدث خطأ ما. ")}
                <button type="button" className="pw-link" onClick={() => void data.refreshCheckIn()}>
                  <IconRefresh size={13} aria-hidden="true" /> {t("Retry", "إعادة المحاولة")}
                </button>
              </>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
