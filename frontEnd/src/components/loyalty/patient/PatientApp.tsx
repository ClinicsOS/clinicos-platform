"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { IconCircleDot, IconRefresh, IconSparkles, IconWifiOff } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { useLT } from "@/lib/loyalty";
import { fetchInfo, publicError, type IdentifyResult, type PublicBrand } from "@/lib/loyaltyPublic";
import EnrollmentMoment from "./EnrollmentMoment";
import InstallPrompt from "./InstallPrompt";
import LoyaltyCard from "./LoyaltyCard";
import PatientAtmosphere from "./PatientAtmosphere";
import PatientEntry from "./PatientEntry";
import PatientShell, { type ScreenId } from "./PatientShell";
import { PW_FEATURE_CSS } from "./patientFeatureStyles";
import { PW_BASE_CSS, PW_CARD_CSS } from "./patientStyles";
import { hexToRgb, INTRO_COOLDOWN_MS, PatientVisualProvider, PMOTION, usePatientVisual, usePatientVisualState, useOnline, useVisible, WELCOME_BACK_MS } from "./patientDesign";
import RewardSheet, { RedeemComplete } from "./RewardSheet";
import { ActivityScreen, CardScreen, HomeScreen, RewardsScreen, type ScreenCtx } from "./screens";
import { clearToken, introDue, loadToken, markIntro, saveToken } from "./session";
import { usePatientData } from "./usePatientData";

/** The cinematic tier moment is its own lazy chunk — only patients who really get promoted ever download it. */
const TierTransformation = dynamic(() => import("./TierTransformation"), { ssr: false });

/**
 * ClinicOS Loyalty — the PATIENT PWA (Phase 9). One public URL per clinic (`/c/<slug>/loyalty`) — the QR code, the NFC tag, the installed app
 * icon and a shared link all open this same experience.
 *
 *   boot → (unavailable | missing | busy | offline)  or  entry (cinematic + phone)  or  app (a valid Loyalty session already exists)
 *
 * Identification today is PHONE NUMBER ONLY (see session.ts for the honest security note and the seam where a stronger step can plug in).
 * The patient session is a short-lived Loyalty-only token — it is never a clinic staff token and the staff app never sees it.
 */
type Phase = "boot" | "unavailable" | "missing" | "busy" | "offline" | "entry" | "app";

export default function PatientApp({ slug }: { slug: string }) {
  const visual = usePatientVisualState();
  return (
    <PatientVisualProvider value={visual}>
      <Root slug={slug} />
    </PatientVisualProvider>
  );
}

function Root({ slug }: { slug: string }) {
  const { lang } = useLT();
  const { setLang } = useI18n();
  const visual = usePatientVisual();
  const online = useOnline();
  const visible = useVisible();
  const [phase, setPhase] = useState<Phase>("boot");
  const [brand, setBrand] = useState<PublicBrand | null>(null);
  const [session, setSession] = useState<{ token: string; resumed: boolean; enrolled: boolean } | null>(null);
  const [notice, setNotice] = useState<"expired" | null>(null);
  const [playIntro, setPlayIntro] = useState(true);
  const scrollRef = useRef(0);
  const [attempt, setAttempt] = useState(0);

  // First visit from an Arabic-language phone → Arabic (an explicit choice is never overridden).
  useEffect(() => {
    try {
      if (!localStorage.getItem("clinicos-lang") && navigator.language?.toLowerCase().startsWith("ar")) setLang("ar");
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A personal page: never indexed. Status-bar colour matches the app.
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = "robots";
    m.content = "noindex,nofollow";
    document.head.appendChild(m);
    let tc = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const created = !tc;
    const before = tc?.content;
    if (!tc) {
      tc = document.createElement("meta");
      tc.name = "theme-color";
      document.head.appendChild(tc);
    }
    tc.content = "#05060a";
    return () => {
      m.remove();
      if (created) tc?.remove();
      else if (tc && before !== undefined) tc.content = before;
    };
  }, []);
  useEffect(() => {
    document.title = brand?.name ? `${brand.programName || brand.name} · ${lang === "ar" ? "الولاء" : "Loyalty"}` : lang === "ar" ? "الولاء" : "Loyalty";
  }, [brand, lang]);

  // Service worker: installability + a graceful offline page. It NEVER caches API responses (see public/loyalty-sw.js).
  useEffect(() => {
    let allowed = process.env.NODE_ENV === "production";
    try {
      if (window.localStorage.getItem("lyp-sw") === "1") allowed = true;
    } catch {
      /* ignore */
    }
    if (!allowed || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/loyalty-sw.js", { scope: "/c/" }).catch(() => {
      /* the app works without it */
    });
  }, []);

  // boot: can this page work? is there still a valid session on this device?
  useEffect(() => {
    let alive = true;
    setPhase("boot");
    (async () => {
      try {
        const info = await fetchInfo(slug);
        if (!alive) return;
        setBrand(info.clinic);
        if (!info.available) return setPhase("unavailable");
        const saved = loadToken(slug);
        if (saved) {
          setSession({ token: saved.token, resumed: true, enrolled: false });
          return setPhase("app");
        }
        const due = introDue(slug, INTRO_COOLDOWN_MS);
        setPlayIntro(due);
        if (due) markIntro(slug);
        setPhase("entry");
      } catch (e) {
        if (!alive) return;
        const st = publicError(e).status;
        // no HTTP answer at all: the device is offline → "offline"; the device is online but the server can't be reached → "unavailable"
        setPhase(st === 404 ? "missing" : st === 429 ? "busy" : st === undefined && navigator.onLine === false ? "offline" : "unavailable");
      }
    })();
    return () => {
      alive = false;
    };
  }, [slug, attempt]);

  // the connection comes BACK while the "offline" screen is up → try again once by itself (never a retry loop)
  const wasOnline = useRef(true);
  useEffect(() => {
    if (online && !wasOnline.current && phase === "offline") setAttempt((n) => n + 1);
    wasOnline.current = online;
  }, [online, phase]);

  const onIdentified = useCallback(
    (r: IdentifyResult) => {
      saveToken(slug, r.token, r.expiresIn);
      markIntro(slug);
      setNotice(null);
      // `enrolled` lives in React state ONLY (never stored): the enrolment moment plays for the response that created the membership, and a
      // reload / second tab / later scan resumes as an ordinary member.
      setSession({ token: r.token, resumed: false, enrolled: r.newlyEnrolled === true });
      setPhase("app");
    },
    [slug]
  );
  const endSession = useCallback(
    (why: "expired" | null) => {
      clearToken(slug);
      setSession(null);
      setNotice(why);
      setPlayIntro(false);
      setPhase("entry");
    },
    [slug]
  );

  const accentRgb = useMemo(() => hexToRgb(brand?.brandColor), [brand?.brandColor]);

  return (
    <div className="pw-root" data-testid="pw-root" data-phase={phase} data-pw-mode={visual.mode} dir={lang === "ar" ? "rtl" : "ltr"} style={{ ["--accent" as string]: accentRgb } as CSSProperties}>
      <style dangerouslySetInnerHTML={{ __html: PW_BASE_CSS + PW_CARD_CSS + PW_FEATURE_CSS }} />
      <PatientAtmosphere accent={accentRgb} scrollRef={scrollRef} />
      <div className="pw-stage">
        <div className="pw-col">
          {phase === "boot" && <BootView brand={brand} />}
          {(phase === "unavailable" || phase === "missing" || phase === "busy" || phase === "offline") && <NoticeView kind={phase} brand={brand} onRetry={() => setAttempt((n) => n + 1)} />}
          {phase === "entry" && <PatientEntry slug={slug} brand={brand} playIntro={playIntro} notice={notice} onIdentified={onIdentified} onUnavailable={() => setPhase("unavailable")} onMissing={() => setPhase("missing")} />}
          {phase === "app" && session && <Session key={session.token} slug={slug} token={session.token} resumed={session.resumed} enrolled={session.enrolled} brand={brand} online={online} visible={visible} scrollRef={scrollRef} onExpired={() => endSession("expired")} onSignOut={() => endSession(null)} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- boot / notices ---------------------------------------------------------------- */

function BootView({ brand }: { brand: PublicBrand | null }) {
  const { t } = useLT();
  return (
    <div className="pw-load" role="status" aria-busy="true" aria-label={t("Loading", "جارٍ التحميل")} data-testid="pw-boot">
      <div className="pw-trace">
        <i style={{ top: 18, width: "42%" }} />
        <i style={{ top: 38, width: "26%" }} />
        <i style={{ bottom: 40, width: "52%" }} />
        <i style={{ bottom: 22, width: "30%" }} />
      </div>
      <span className="pw-sub" dir="auto" style={{ margin: 0 }}>
        {brand?.name ?? ""}
      </span>
    </div>
  );
}

function NoticeView({ kind, brand, onRetry }: { kind: "unavailable" | "missing" | "busy" | "offline"; brand: PublicBrand | null; onRetry: () => void }) {
  const { t } = useLT();
  const title =
    kind === "missing" ? t("This page isn't available", "هذه الصفحة غير متاحة") : kind === "busy" ? t("Just a moment", "لحظة من فضلك") : kind === "offline" ? t("You're offline", "أنت غير متصل") : t("Loyalty is currently unavailable", "برنامج الولاء غير متاح حاليًا");
  const body =
    kind === "missing"
      ? t("Please check the link or ask the clinic reception.", "يرجى التحقق من الرابط أو سؤال استقبال العيادة.")
      : kind === "busy"
      ? t("There were too many requests. Please try again in a moment.", "كانت هناك طلبات كثيرة. يرجى المحاولة بعد لحظات.")
      : kind === "offline"
      ? t("Connect to the internet to open your card.", "اتصل بالإنترنت لفتح بطاقتك.")
      : t("Please check back soon, or ask reception for assistance.", "يرجى المحاولة لاحقًا، أو سؤال الاستقبال للمساعدة.");
  const Icon = kind === "missing" ? IconCircleDot : kind === "offline" ? IconWifiOff : IconSparkles;
  return (
    <div className="pw-notice" role="status" data-testid="pw-notice" data-kind={kind}>
      <div className="pw-notice-card">
        <LoyaltyCard clinicName={brand?.name || "ClinicOS"} programName={brand?.programName} logoUrl={brand?.logoUrl} accent={brand?.brandColor} locked interactive={false} sweep="none" testId="pw-notice-card" />
      </div>
      <div className="pw-panel pw-empty">
        <span className="pw-ico">
          <Icon size={28} />
        </span>
        <h1 className="pw-notice-h">{title}</h1>
        <p>{body}</p>
        {kind !== "missing" && (
          <button type="button" className="pw-ghost" onClick={onRetry} data-testid="pw-retry">
            <IconRefresh size={16} aria-hidden="true" /> {t("Try again", "حاول مرة أخرى")}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ signed-in app ------------------------------------------------------------------ */

function Session({
  slug,
  token,
  resumed,
  enrolled,
  brand,
  online,
  visible,
  scrollRef,
  onExpired,
  onSignOut,
}: {
  slug: string;
  token: string;
  resumed: boolean;
  /** Phase 9.1: this very open created the membership → the one-time enrolment moment replaces the short welcome */
  enrolled: boolean;
  brand: PublicBrand | null;
  online: boolean;
  visible: boolean;
  scrollRef: React.MutableRefObject<number>;
  onExpired: () => void;
  onSignOut: () => void;
}) {
  const { t, date } = useLT();
  const v = usePatientVisual();
  const data = usePatientData({ slug, token, online, visible, onExpired });
  const [screen, setScreen] = useState<ScreenId>("home");
  const [navCount, setNavCount] = useState(0);
  const [rewardId, setRewardId] = useState<string | null>(null);
  const [modals, setModals] = useState(0);
  const [welcome, setWelcome] = useState<"idle" | "show" | "enroll" | "done">("idle");
  const me = data.me;

  // The tier / redemption ceremonies are gated BY the sheet counter, so they must not count themselves (they would unmount their own gate).
  const noop = useCallback(() => {}, []);
  const onOpenChange = useCallback((open: boolean) => setModals((n) => Math.max(0, n + (open ? 1 : -1))), []);

  // the short welcome moment: only once, only when the card is really loaded
  useEffect(() => {
    if (!me || welcome !== "idle") return undefined;
    if (enrolled) {
      setWelcome("enroll"); // EnrollmentMoment ends itself (and a tap skips it)
      return undefined;
    }
    setWelcome("show");
    const id = setTimeout(() => setWelcome("done"), v.mode === "static" ? 500 : resumed ? WELCOME_BACK_MS : WELCOME_BACK_MS + 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!me]);

  const go = useCallback((id: ScreenId) => {
    setScreen(id);
    setNavCount((n) => n + 1);
  }, []);

  const reward = useMemo(() => data.rewards?.rewards.find((r) => r.id === rewardId) ?? null, [data.rewards, rewardId]);
  // a reward that disappeared (clinic removed it) while its sheet was open just closes the sheet
  useEffect(() => {
    if (rewardId && data.rewards && !reward) setRewardId(null);
  }, [rewardId, data.rewards, reward]);

  if (!me) {
    if (data.loadError)
      return (
        <div className="pw-load" role="alert" data-testid="pw-load-error">
          <div className="pw-panel pw-empty">
            <span className="pw-ico">
              <IconRefresh size={28} />
            </span>
            <h1 className="pw-notice-h">{t("We couldn't open your card", "تعذر فتح بطاقتك")}</h1>
            <p>{online ? t("Please try again.", "يرجى المحاولة مرة أخرى.") : t("You're offline. Connect to the internet and try again.", "أنت غير متصل. اتصل بالإنترنت وحاول مرة أخرى.")}</p>
            <button type="button" className="pw-ghost" onClick={() => void data.reload()} data-testid="pw-load-retry">
              <IconRefresh size={16} aria-hidden="true" /> {t("Try again", "حاول مرة أخرى")}
            </button>
            <button type="button" className="pw-link" onClick={onSignOut}>
              {t("Use a different number", "استخدم رقمًا آخر")}
            </button>
          </div>
        </div>
      );
    return (
      <div className="pw-load" role="status" aria-busy="true" aria-label={t("Opening your card", "جارٍ فتح بطاقتك")} data-testid="pw-loading">
        <div className="pw-trace">
          <i style={{ top: 18, width: "42%" }} />
          <i style={{ top: 38, width: "26%" }} />
          <i style={{ bottom: 40, width: "52%" }} />
          <i style={{ bottom: 22, width: "30%" }} />
        </div>
        <span className="pw-sub" style={{ margin: 0 }}>
          {enrolled ? t("Creating your membership…", "جارٍ إنشاء عضويتك…") : t("Opening your card…", "جارٍ فتح بطاقتك…")}
        </span>
      </div>
    );
  }

  const ctx: ScreenCtx = { data, me, online, go, openReward: setRewardId, onSignOut, onOpenChange };
  const promo = welcome === "done" && modals === 0 ? data.promotion : null;
  const done = welcome === "done" && modals === 0 && !data.promotion ? data.doneRequest : null;
  const blocked = modals > 0 || !!promo || !!done || welcome !== "done";
  const receded = modals > 0 || !!promo || !!done;

  return (
    <>
      <PatientShell
        brand={me.clinic ?? brand}
        current={screen}
        onNavigate={go}
        receded={receded}
        online={online}
        updatedAt={data.updatedAt}
        homeDot={data.checkIn.current?.status === "pending"}
        scrollRef={scrollRef}
        renderScreen={(id) => (id === "home" ? <HomeScreen ctx={ctx} /> : id === "rewards" ? <RewardsScreen ctx={ctx} /> : id === "activity" ? <ActivityScreen ctx={ctx} /> : <CardScreen ctx={ctx} />)}
      >
        <RewardSheet reward={reward} balance={data.rewards?.balance ?? me.member.balance} online={online} onClose={() => setRewardId(null)} onAsk={data.askReward} onOpenChange={onOpenChange} />
        {promo && (
          <TierTransformation
            from={{ key: promo.fromTierKey, name: promo.fromName }}
            to={{ key: promo.toTierKey, name: promo.toName }}
            clinicName={me.clinic.name}
            programName={me.clinic.programName}
            logoUrl={me.clinic.logoUrl}
            accent={me.clinic.brandColor}
            firstName={me.member.displayName}
            since={date(me.member.memberSince)}
            refCode={me.member.ref}
            benefits={me.tier?.benefits.map((b) => b.title) ?? []}
            onDone={data.ackPromotion}
            onOpenChange={noop}
          />
        )}
        {done && <RedeemComplete request={done} balance={me.member.balance} onClose={data.ackRedemption} onOpenChange={noop} />}
        <InstallPrompt ready={navCount >= 2} blocked={blocked} onOpenChange={onOpenChange} />
        {welcome === "enroll" && <EnrollmentMoment me={me} onDone={() => setWelcome("done")} />}
        {welcome === "show" && (
          <div className="pw-welcome" role="status" data-testid="pw-welcome" onPointerDown={() => setWelcome("done")}>
            <div className="pw-welcome-in">
              <span className="pw-welcome-k">{resumed ? t("WELCOME BACK", "أهلًا بعودتك") : t("WELCOME", "أهلًا بك")}</span>
              <span className="pw-welcome-n" dir="auto">
                {me.member.displayName}
              </span>
            </div>
          </div>
        )}
      </PatientShell>
    </>
  );
}

export { PMOTION };
