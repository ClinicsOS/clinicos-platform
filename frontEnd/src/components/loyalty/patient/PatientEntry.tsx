"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { IconCheck, IconLock, IconPhone } from "@tabler/icons-react";
import { useLT } from "@/lib/loyalty";
import { publicError, type IdentifyResult, type PublicBrand } from "@/lib/loyaltyPublic";
import LoyaltyCard from "./LoyaltyCard";
import { usePatientVisual } from "./patientDesign";
import PatientTopBar from "./PatientTopBar";
import { formatNational, isPlausibleJordanMobile, nationalFromInput, phoneIdentifier, toLocalPhone } from "./session";

/**
 * The patient's first screen (Phase 9) — a ~2.2 s cinematic, skippable with a tap:
 *
 *   0 ms     black; a single point of light
 *   450 ms   the light opens into the clinic's identity (logo / monogram, name)
 *   950 ms   the 3D Loyalty Card emerges from depth, one light sweep crosses it
 *   1600 ms  it rotates toward the patient; "Welcome" and the phone field arrive
 *   2200 ms  settled and interactive
 *
 * `playIntro=false` (the patient saw it recently on this device) plays a short ~0.6 s version instead, so QR / NFC / installed-app opens
 * are never slowed down by a long animation. Static mode (reduced motion): no travel, no light — a calm fade straight to the form.
 *
 * Identification is PHONE NUMBER ONLY (no code is sent to the patient). The server normalises the number; this screen only checks the
 * shape (Jordan mobile), then asks the server. Every failure message is generic and never reveals whether a number exists.
 *
 * Phase 9.1: the same submit also enrols a patient who is in this clinic's records but has no Loyalty membership yet — the server answers
 * `newlyEnrolled` and the app plays the one-time enrolment moment. This screen never asks for a name or anything else, and a TECHNICAL
 * failure (offline, server error, throttling) is never worded as "number not found": that message is reserved for the server's generic 404.
 */
type Problem = "invalid" | "notfound" | "rate" | "offline" | "network" | "expired" | null;

export default function PatientEntry({
  slug,
  brand,
  playIntro,
  notice,
  onIdentified,
  onUnavailable,
  onMissing,
}: {
  slug: string;
  brand: PublicBrand | null;
  playIntro: boolean;
  notice: "expired" | null;
  onIdentified: (r: IdentifyResult) => void;
  onUnavailable: () => void;
  /** the clinic link itself is wrong (the clinic does not exist) */
  onMissing: () => void;
}) {
  const { t } = useLT();
  const v = usePatientVisual();
  const staticMode = v.mode === "static";
  const [stage, setStage] = useState(staticMode ? 3 : 0);
  const [skipped, setSkipped] = useState(false);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(notice === "expired" ? "expired" : null);
  const [typing, setTyping] = useState(false);
  const [compact, setCompact] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(typingTimer.current), []);

  const national = nationalFromInput(raw);
  const plausible = isPlausibleJordanMobile(national);

  useEffect(() => {
    if (staticMode) {
      setStage(3);
      return undefined;
    }
    const plan = playIntro ? [450, 950, 1600] : [0, 80, 420];
    const ids = plan.map((ms, i) => setTimeout(() => setStage((s) => Math.max(s, i + 1)), ms));
    return () => ids.forEach(clearTimeout);
  }, [playIntro, staticMode]);

  // a tap anywhere skips the cinematic
  const skip = useCallback(() => {
    if (stage >= 3) return;
    setSkipped(true);
    setStage(3);
  }, [stage]);

  // soft keyboard: on a very short viewport the card gives way to the form
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;
    const f = () => setCompact(vv.height < 470);
    f();
    vv.addEventListener("resize", f);
    return () => vv.removeEventListener("resize", f);
  }, []);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (busyRef.current) return;
    if (!plausible) {
      setProblem("invalid");
      inputRef.current?.focus();
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const r = await phoneIdentifier.start(slug, toLocalPhone(national));
      onIdentified(r); // the app takes over; this component unmounts
    } catch (e) {
      const er = publicError(e);
      if (er.status === 400) setProblem("invalid");
      else if (er.status === 404 && er.code === "NOT_FOUND") onMissing(); // the clinic link is wrong — not a phone problem
      else if (er.status === 404) setProblem("notfound"); // the server's one generic answer for "no membership available for this number"
      else if (er.status === 429) setProblem("rate");
      else if (er.status === 503) onUnavailable(); // Loyalty add-on / program is off
      else if (er.status === undefined && typeof navigator !== "undefined" && navigator.onLine === false) setProblem("offline");
      else setProblem("network"); // no answer from the server, or a server error: "try again", never "not found"
      busyRef.current = false;
      setBusy(false);
    }
  };

  const msgId = "pw-phone-msg";
  const clinic = brand?.name ?? "";
  const ready = stage >= 3;
  return (
    <div className="en" data-testid="pw-entry" data-stage={stage} data-mode={v.mode} data-skip={skipped ? "1" : "0"} data-typing={typing ? "1" : "0"} data-compact={compact && typing ? "1" : "0"} data-intro={playIntro ? "full" : "short"} onPointerDown={skip}>
      <PatientTopBar brand={brand} hidden={stage < 1} />
      <div className="en-scroll">
        <div className="en-light" aria-hidden="true">
          <i />
          <i />
        </div>

        <div className="en-id" aria-hidden={stage < 1}>
          {brand?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="en-logo" src={brand.logoUrl} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} />
          ) : (
            <span className="en-logo en-mono">{(clinic.trim()[0] ?? "C").toUpperCase()}</span>
          )}
          <span className="en-clinic" dir="auto">
            {clinic}
          </span>
        </div>

        <div className="en-cardwrap">
          <div className="en-card">
            <LoyaltyCard clinicName={clinic || "ClinicOS"} programName={brand?.programName} logoUrl={brand?.logoUrl} accent={brand?.brandColor} locked sweep={stage >= 2 ? "once" : "none"} interactive={ready} flipButton={ready} testId="pw-entry-card" />
          </div>
        </div>

        <div className="en-welcome">
          <h1 className="pw-title">{t("Welcome", "أهلًا بك")}</h1>
          <p className="pw-sub">{t("Enter your mobile number to open your Loyalty card.", "أدخل رقم هاتفك المحمول لفتح بطاقة الولاء الخاصة بك.")}</p>
        </div>

        <form className="en-form" onSubmit={submit} noValidate aria-hidden={!ready}>
          <label htmlFor="pw-phone" className="en-label">
            {t("Mobile number", "رقم الهاتف المحمول")}
          </label>
          <div className={`en-input ${problem === "invalid" || problem === "notfound" ? "is-bad" : plausible ? "is-ok" : ""}`}>
            <IconPhone size={18} aria-hidden="true" />
            <span className="en-cc" dir="ltr" aria-hidden="true">
              +962
            </span>
            <input
              id="pw-phone"
              ref={inputRef}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder="07X XXX XXXX"
              value={raw}
              maxLength={20}
              tabIndex={ready ? 0 : -1}
              onChange={(e) => {
                setRaw(e.target.value);
                if (problem === "invalid" || problem === "expired" || problem === "notfound") setProblem(null);
              }}
              onFocus={() => {
                clearTimeout(typingTimer.current);
                setTyping(true);
                setTimeout(() => inputRef.current?.scrollIntoView({ block: "center", behavior: staticMode ? "auto" : "smooth" }), 280);
              }}
              onBlur={() => {
                // Leaving the field must NOT move the layout under the finger: a tap on "Open my card" blurs the field first, and if the card
                // grew back at that instant the button would slide away before the tap finished. The layout settles a moment later.
                clearTimeout(typingTimer.current);
                typingTimer.current = setTimeout(() => {
                  if (document.activeElement !== inputRef.current) setTyping(false);
                }, 400);
              }}
              aria-invalid={problem === "invalid" || problem === "notfound"}
              aria-describedby={msgId}
              data-testid="pw-phone"
            />
            {plausible && (
              <span className="en-tick" aria-hidden="true">
                <IconCheck size={16} stroke={2.6} />
              </span>
            )}
          </div>
          {national.length > 0 && (
            <div className="en-preview pw-num" dir="ltr" aria-hidden="true">
              +962 {formatNational(national)}
            </div>
          )}
          <div id={msgId} role="alert" aria-live="assertive" className="en-msg">
            {problem && (
              <p className={`pw-error pw-pop ${problem === "notfound" || problem === "expired" ? "is-soft" : ""}`} data-testid="pw-phone-error">
                {problem === "invalid" && t("Please enter a valid Jordan mobile number (for example 07X XXX XXXX).", "يرجى إدخال رقم موبايل أردني صحيح (مثال: 07X XXX XXXX).")}
                {problem === "notfound" && t("We couldn't find this phone number in the clinic records. Please contact reception.", "لم نجد رقم الهاتف ضمن سجلات العيادة. يرجى مراجعة الاستقبال.")}
                {problem === "rate" && t("Too many attempts. Please wait a few minutes or ask reception.", "محاولات كثيرة. يرجى الانتظار بضع دقائق أو سؤال الاستقبال.")}
                {problem === "offline" && t("You're offline. Connect to the internet and try again.", "أنت غير متصل. اتصل بالإنترنت وحاول مرة أخرى.")}
                {problem === "network" && t("We couldn't reach the clinic just now. Please try again in a moment.", "تعذر الوصول إلى العيادة الآن. يرجى المحاولة بعد لحظات.")}
                {problem === "expired" && t("Your session ended for your security. Please enter your number again.", "انتهت جلستك لحمايتك. يرجى إدخال رقمك مرة أخرى.")}
              </p>
            )}
          </div>
          <button type="submit" className="pw-btn is-block is-shine" disabled={busy || !ready} data-testid="pw-phone-submit" tabIndex={ready ? 0 : -1}>
            {busy && <span className="pw-spin" aria-hidden="true" />}
            {busy ? t("Opening your card…", "جارٍ فتح بطاقتك…") : t("Open my card", "افتح بطاقتي")}
          </button>
          <p className="en-fine">
            <IconLock size={12} aria-hidden="true" /> {t("We only use your number to find your Loyalty card. It is never shown or shared.", "نستخدم رقمك فقط للعثور على بطاقتك. لا يُعرض ولا يُشارك أبدًا.")}
          </p>
        </form>
      </div>
    </div>
  );
}
