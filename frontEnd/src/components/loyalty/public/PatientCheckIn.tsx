"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconCircleCheck, IconHandStop, IconMapPinCheck, IconRefresh, IconUserCheck } from "@tabler/icons-react";
import { useLT } from "@/lib/loyalty";
import { cancelCheckIn, fetchCheckIn, publicError, readVia, requestCheckIn, type PublicCheckIn } from "@/lib/loyaltyPublic";

/**
 * "I'm here" — the patient's check-in panel (Phase 5), shown under the Loyalty card.
 *
 *  • It is an EXPLICIT tap. Opening / scanning the page never checks anyone in.
 *  • It only creates a PENDING request. Reception confirms it at the desk; until then nothing counts as arrived.
 *  • It never awards points (visit points still come from a completed appointment).
 *  • Everything shown comes from the server (status + timestamps only). While a request is pending the panel polls
 *    gently (every ~6 s, only while the tab is visible) and stops as soon as it is answered.
 *
 * Renders nothing when the clinic has not turned check-in on.
 */

type Problem = "rate" | "limit" | "busy" | "network" | null;
const POLL_MS = 6000;

export default function PatientCheckIn({ slug, token, firstName, onExpired }: { slug: string; token: string; firstName: string; onExpired: () => void }) {
  const { t, lang } = useLT();
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [ci, setCi] = useState<PublicCheckIn | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const alive = useRef(true);

  const time = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : "");

  const apply = useCallback((s: { enabled: boolean; checkIn: PublicCheckIn | null }) => {
    setEnabled(s.enabled);
    setCi(s.checkIn);
  }, []);

  const refresh = useCallback(async () => {
    try {
      apply(await fetchCheckIn(slug, token));
      setProblem((p) => (p === "network" ? null : p));
    } catch (e) {
      const er = publicError(e);
      if (er.status === 401) onExpired();
      else if (er.status === 429) setProblem("rate");
      else if (er.status !== 503) setProblem("network");
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, [slug, token, apply, onExpired]);

  useEffect(() => {
    alive.current = true;
    refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  // Poll ONLY while a request is pending (and the tab is visible); refresh at once when the tab comes back.
  const pending = ci?.status === "pending";
  useEffect(() => {
    if (!pending) return;
    const tick = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [pending, refresh]);

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await requestCheckIn(slug, token, readVia());
      setCi(r.checkIn);
    } catch (e) {
      const er = publicError(e);
      if (er.status === 401) onExpired();
      else if (er.code === "CHECKIN_LIMIT") setProblem("limit");
      else if (er.code === "CHECKIN_QUEUE_FULL") setProblem("busy");
      else if (er.code === "CHECKIN_DISABLED") setEnabled(false);
      else if (er.status === 429) setProblem("rate");
      else setProblem("network");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      apply(await cancelCheckIn(slug, token));
    } catch (e) {
      if (publicError(e).status === 401) onExpired();
      else setProblem("network");
    } finally {
      setBusy(false);
    }
  };

  if (!loaded || !enabled) return null;

  const status = ci?.status ?? null;
  const confirmed = status === "confirmed";
  const rejected = status === "rejected";
  const expired = status === "expired";

  return (
    <section className="pc-wrap pl-rise" style={{ animationDelay: "0.55s" }} aria-label={t("Check in", "تسجيل الوصول")}>
      <style dangerouslySetInnerHTML={{ __html: PC_CSS }} />

      <div className={`pc-card pl-glass ${confirmed ? "is-done" : pending ? "is-wait" : ""}`} data-status={status ?? "idle"} data-testid="pc-card">
        {/* ===== idle / rejected / expired → the button ===== */}
        {!pending && !confirmed && (
          <>
            <div className="pc-head">
              <span className="pc-ico" aria-hidden="true">
                <IconMapPinCheck size={22} />
              </span>
              <div className="pc-txt">
                <h2>{t("Arrived at the clinic?", "وصلت إلى العيادة؟")}</h2>
                <p>{t("Let reception know you're here. They'll confirm it in a moment.", "أخبر الاستقبال بوصولك، وسيؤكدون ذلك خلال لحظات.")}</p>
              </div>
            </div>

            {(rejected || expired) && (
              <p className="pc-note pl-pop" role="status">
                {rejected ? t("Please see reception so they can help you.", "يرجى مراجعة الاستقبال ليساعدوك.") : t("Your last request wasn't answered in time. You can check in again.", "لم يتم الرد على طلبك الأخير في الوقت المناسب. يمكنك تسجيل الوصول مجددًا.")}
              </p>
            )}

            <button type="button" className="pl-btn pc-go" onClick={send} disabled={busy} data-testid="pc-checkin">
              {busy ? <span className="pl-spin" aria-hidden="true" /> : <IconHandStop size={20} aria-hidden="true" />}
              {busy ? t("Sending…", "جارٍ الإرسال…") : rejected || expired ? t("Check in again", "سجّل وصولي مرة أخرى") : t("I'm here — check in", "وصلت — سجّل وصولي")}
            </button>
          </>
        )}

        {/* ===== pending → waiting for reception ===== */}
        {pending && (
          <div className="pc-wait" role="status" aria-live="polite">
            <div className="pc-radar" aria-hidden="true">
              <i />
              <i />
              <i />
              <span>
                <IconUserCheck size={26} />
              </span>
            </div>
            <h2>{t("Waiting for reception", "بانتظار تأكيد الاستقبال")}</h2>
            <p>{t(`Request sent at ${time(ci?.requestedAt)}. Please stay nearby — reception will confirm shortly.`, `أُرسل الطلب الساعة ${time(ci?.requestedAt)}. يرجى البقاء قريبًا — سيؤكد الاستقبال قريبًا.`)}</p>
            <button type="button" className="pl-link pc-cancel" onClick={cancel} disabled={busy}>
              {t("Cancel request", "إلغاء الطلب")}
            </button>
          </div>
        )}

        {/* ===== confirmed ===== */}
        {confirmed && (
          <div className="pc-done" role="status" aria-live="polite">
            <div className="pc-burst" aria-hidden="true">
              <i />
              <i />
              <span>
                <IconCircleCheck size={34} stroke={1.8} />
              </span>
            </div>
            <h2>{firstName ? t(`You're checked in, ${firstName}`, `تم تسجيل وصولك يا ${firstName}`) : t("You're checked in", "تم تسجيل وصولك")}</h2>
            <p>{t(`Confirmed by reception at ${time(ci?.resolvedAt)}. Please take a seat — you'll be called shortly.`, `أكّد الاستقبال وصولك الساعة ${time(ci?.resolvedAt)}. تفضّل بالجلوس وسيتم استدعاؤك قريبًا.`)}</p>
          </div>
        )}

        <div className="pc-msg" role="alert" aria-live="assertive">
          {problem && (
            <p className="pl-error pl-pop">
              {problem === "rate" && t("Please wait a moment and try again.", "يرجى الانتظار لحظة ثم المحاولة مجددًا.")}
              {problem === "limit" && t("Too many check-in requests today. Please tell reception you've arrived.", "طلبات كثيرة اليوم. يرجى إخبار الاستقبال بوصولك.")}
              {problem === "busy" && t("Check-in is very busy right now. Please tell reception you've arrived.", "نظام التسجيل مزدحم الآن. يرجى إخبار الاستقبال بوصولك.")}
              {problem === "network" && (
                <>
                  {t("Something went wrong. ", "حدث خطأ ما. ")}
                  <button type="button" className="pc-retry" onClick={refresh}>
                    <IconRefresh size={13} aria-hidden="true" /> {t("Retry", "إعادة المحاولة")}
                  </button>
                </>
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const PC_CSS = `
.pc-wrap{margin:18px 0 6px}
.pc-card{padding:18px;position:relative;overflow:hidden}
.pc-card.is-wait{border-color:rgba(var(--accent),.5)}
.pc-card.is-done{border-color:rgba(120,220,160,.55);background:linear-gradient(145deg,rgba(120,220,160,.14),rgba(255,255,255,.03))}
.pc-head{display:flex;gap:14px;align-items:flex-start}
.pc-ico{flex:none;width:46px;height:46px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;color:rgb(var(--accent));background:rgba(var(--accent),.13);border:1px solid rgba(var(--accent),.38)}
.pc-txt{min-width:0}
.pc-txt h2,.pc-wait h2,.pc-done h2{margin:0 0 4px;font-size:16.5px;font-weight:650;color:#fbf0d2;overflow-wrap:anywhere}
.pc-txt p,.pc-wait p,.pc-done p{margin:0;font-size:13.5px;line-height:1.6;color:#a9a08a}
.pc-note{margin:14px 0 0;padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.55;color:#f1dcab;background:rgba(241,220,171,.08);border:1px solid rgba(241,220,171,.22)}
.pc-go{margin-top:16px;position:relative;overflow:hidden}
.pc-go::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.35) 50%,transparent 60%);transform:translateX(-120%);animation:pcSheen 4.2s ease-in-out 1.2s infinite;pointer-events:none}
.pc-wait,.pc-done{display:flex;flex-direction:column;align-items:center;text-align:center;padding:6px 4px 2px}
.pc-radar{position:relative;width:96px;height:96px;margin:2px 0 14px;display:flex;align-items:center;justify-content:center}
.pc-radar span{position:relative;z-index:1;width:56px;height:56px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#2a1d06;background:linear-gradient(135deg,#f6e2a8,rgb(var(--accent)) 55%,#b98a38);box-shadow:0 10px 26px -8px rgba(var(--accent),.7),inset 0 1px 0 rgba(255,255,255,.55)}
.pc-radar i{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(var(--accent),.55);opacity:0;animation:pcRing 2.6s cubic-bezier(.2,.6,.3,1) infinite}
.pc-radar i:nth-child(2){animation-delay:.85s}
.pc-radar i:nth-child(3){animation-delay:1.7s}
.pc-cancel{margin-top:10px}
.pc-burst{position:relative;width:84px;height:84px;margin:0 0 12px;display:flex;align-items:center;justify-content:center}
.pc-burst span{position:relative;z-index:1;width:64px;height:64px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#0d3320;background:linear-gradient(135deg,#c8f5d9,#6fd6a0 60%,#3fa874);box-shadow:0 12px 28px -8px rgba(80,200,140,.7),inset 0 1px 0 rgba(255,255,255,.6);animation:pcPop .55s cubic-bezier(.3,1.5,.5,1) both}
.pc-burst i{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(120,220,160,.7);opacity:0;animation:pcBurst 1.4s ease-out .15s both}
.pc-burst i:nth-child(2){animation-delay:.4s}
.pc-msg{min-height:0}
.pc-retry{display:inline-flex;align-items:center;gap:4px;min-height:32px;padding:0 6px;background:none;border:0;color:#f3e3b5;text-decoration:underline;text-underline-offset:3px;cursor:pointer;font-size:13px}
@keyframes pcRing{0%{transform:scale(.55);opacity:.7}100%{transform:scale(1.25);opacity:0}}
@keyframes pcBurst{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.5);opacity:0}}
@keyframes pcPop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
@keyframes pcSheen{0%,55%{transform:translateX(-120%)}100%{transform:translateX(120%)}}
@media (prefers-reduced-motion: reduce){
  .pc-go::after,.pc-radar i,.pc-burst i,.pc-burst span{animation:none!important}
  .pc-radar i{opacity:.35;transform:scale(1.05)}
  .pc-radar i:nth-child(n+2),.pc-burst i{display:none}
}
`;
