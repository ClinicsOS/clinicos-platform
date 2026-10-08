"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconChartAreaLine,
  IconDiamond,
  IconGift,
  IconHandStop,
  IconHistory,
  IconLayoutDashboard,
  IconSettings,
  IconSparkles,
  IconStairsUp,
  IconTicket,
  IconUsers,
} from "@tabler/icons-react";
import { api } from "@/lib/api";
import { useAuth } from "@/store/auth";
import { useI18n } from "@/lib/i18n";
import { useCheckInSummary, useLoyaltyOverview, useLT, usePendingRedemptionCount } from "@/lib/loyalty";
import type { Clinic } from "@/lib/types";
import { SECTION_PATH, SECTIONS, SHELL_FLAG, sectionOfPath, useLoyaltyUi, type LoyaltySection } from "@/lib/loyaltyNav";
import { LoyaltyStyles } from "../LoyaltyCard3D";
import { UI_CSS } from "../ui/uiStyles";
import { FEATURE_CSS } from "../ui/featureStyles";
import { EXIT_MS, VisualProvider, useVisualState } from "./loyaltyDesign";
import { SHELL_CSS, TOKENS_CSS } from "./shellStyles";
import LoyaltyAtmosphere from "./LoyaltyAtmosphere";
import CinematicSplash from "./CinematicSplash";

const ICONS: Record<LoyaltySection, typeof IconDiamond> = {
  overview: IconLayoutDashboard,
  members: IconUsers,
  checkin: IconHandStop,
  rewards: IconGift,
  redemptions: IconTicket,
  transactions: IconHistory,
  tiers: IconStairsUp,
  analytics: IconChartAreaLine,
  settings: IconSettings,
};

function useSectionText() {
  const { t } = useLT();
  const label: Record<LoyaltySection, string> = {
    overview: t("Overview", "نظرة عامة"),
    members: t("Members", "الأعضاء"),
    checkin: t("Check-ins", "تسجيلات الوصول"),
    rewards: t("Rewards", "المكافآت"),
    redemptions: t("Redemptions", "الاستبدالات"),
    transactions: t("Transactions", "الحركات"),
    tiers: t("Tiers", "المستويات"),
    analytics: t("Analytics", "التحليلات"),
    settings: t("Settings", "الإعدادات"),
  };
  const sub: Record<LoyaltySection, string> = {
    overview: t("Your members, rewards and growth at a glance.", "أعضاؤك ومكافآتك ونموّك في نظرة واحدة."),
    members: t("Everyone enrolled in your program.", "كل من انضمّ إلى برنامجك."),
    checkin: t("Patients waiting to be confirmed at the desk.", "مرضى بانتظار التأكيد عند الاستقبال."),
    rewards: t("The rewards your members can redeem.", "المكافآت التي يستطيع الأعضاء استبدالها."),
    redemptions: t("Confirm, reject or reverse reward redemptions.", "أكّد أو ارفض أو اعكس استبدالات المكافآت."),
    transactions: t("The complete points ledger.", "سجلّ النقاط الكامل."),
    tiers: t("The journey your members take.", "رحلة التقدّم التي يعيشها أعضاؤك."),
    analytics: t("How your program is performing.", "كيف يؤدّي برنامجك."),
    settings: t("Program, earning rules and check-in.", "البرنامج وقواعد الكسب وتسجيل الوصول."),
  };
  return { label, sub };
}

function bootState() {
  if (typeof window === "undefined") return { phase: "ready" as const, played: false };
  let seen = false;
  try {
    seen = window.sessionStorage.getItem(SHELL_FLAG) === "1";
  } catch {
    /* storage blocked → treat as an entry */
  }
  return seen ? { phase: "ready" as const, played: false } : { phase: "splash" as const, played: true };
}

/**
 * ClinicOS Loyalty product shell (Phase 8) — its own sidebar, top bar, atmosphere and entry / exit choreography.
 * Lives in app/(dashboard)/loyalty/layout.tsx, so it stays mounted while the user moves between sections (only the page area transitions).
 * Rendered only while the Loyalty add-on is active; the dashboard layout then drops the ClinicOS chrome (see (dashboard)/layout.tsx).
 */
export default function LoyaltyShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const section = sectionOfPath(pathname);
  const { t, lang, isRtl } = useLT();
  const { setLang } = useI18n();
  const user = useAuth((s) => s.user);
  const visual = useVisualState();
  const pref = useLoyaltyUi((s) => s.visual);
  const setVisual = useLoyaltyUi((s) => s.setVisual);
  const { label, sub } = useSectionText();

  const boot = useRef(bootState());
  const [phase, setPhase] = useState<"splash" | "ready">(boot.current.phase);
  const [splashMounted, setSplashMounted] = useState(boot.current.phase === "splash");
  const [exiting, setExiting] = useState(false);

  // From now on a refresh / re-render inside Loyalty doesn't replay the entry moment; leaving Loyalty clears it (dashboard layout / exit below).
  useEffect(() => {
    try {
      window.sessionStorage.setItem(SHELL_FLAG, "1");
    } catch {
      /* ignore */
    }
    return () => {
      useLoyaltyUi.getState().reset();
    };
  }, []);

  const clinic = useQuery({ queryKey: ["clinic"], queryFn: async () => (await api.get<Clinic>("/clinic")).data, staleTime: 30_000 });
  const overview = useLoyaltyOverview(true);
  const waiting = useCheckInSummary(true).data?.pending ?? 0;
  const redeemWaiting = usePendingRedemptionCount(true).data?.pending ?? 0;
  const programName = overview.data?.program.displayName ?? clinic.data?.name ?? "";

  const exit = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    window.setTimeout(
      () => {
        try {
          window.sessionStorage.removeItem(SHELL_FLAG);
        } catch {
          /* ignore */
        }
        router.push("/dashboard");
      },
      visual.mode === "static" ? 180 : EXIT_MS
    );
  }, [exiting, router, visual.mode]);

  /* ----- sliding indicator under the active rail item ----- */
  const navRef = useRef<HTMLElement>(null);
  const placeInd = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const el = nav.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el) {
      nav.style.setProperty("--ind-o", "0");
      return;
    }
    nav.style.setProperty("--ind-y", `${el.offsetTop}px`);
    nav.style.setProperty("--ind-h", `${el.offsetHeight}px`);
    nav.style.setProperty("--ind-o", "1");
  }, []);
  useLayoutEffect(() => {
    placeInd();
  }, [placeInd, section, lang, phase, waiting, redeemWaiting]);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(placeInd);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [placeInd]);

  /* ----- keep the active chip in view on small screens; focus the page area after a navigation ----- */
  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chipsRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest", behavior: visual.reduced ? "auto" : "smooth" });
  }, [section, visual.reduced]);
  const mainRef = useRef<HTMLElement>(null);
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  const initials = (user?.name || "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const badgeOf = (s: LoyaltySection) => (s === "checkin" ? waiting : s === "redemptions" ? redeemWaiting : 0);
  const badgeAria = (n: number) => t(`${n} waiting`, `${n} بالانتظار`);
  const badgeText = (n: number) => (n > 99 ? "99+" : String(n));
  const lite = pref === "lite";

  return (
    <VisualProvider value={visual}>
      <div
        className={`lyx-root ${exiting ? "is-exiting" : ""}`}
        data-lyx-mode={visual.mode}
        data-phase={phase}
        data-entered={boot.current.played ? "true" : "false"}
        data-testid="lyx-root"
        dir={isRtl ? "rtl" : "ltr"}
      >
        <style>{TOKENS_CSS + SHELL_CSS + UI_CSS + FEATURE_CSS}</style>
        <LoyaltyStyles />
        <LoyaltyAtmosphere />

        <a className="lyx-skip" href="#lyx-main">
          {t("Skip to content", "تخطَّ إلى المحتوى")}
        </a>

        <div className="lyx-frame">
          <aside className="lyx-rail" aria-label={t("Loyalty navigation", "تنقّل الولاء")}>
            <div className="lyx-brand">
              <span className="lyx-brand-mark">
                <IconDiamond size={22} stroke={1.7} />
              </span>
              <span className="lyx-brand-text">
                <small>CLINICOS</small>
                <b>
                  LOYAL<span>TY</span>
                </b>
              </span>
            </div>

            <nav className="lyx-nav" ref={navRef} aria-label={t("Loyalty sections", "أقسام الولاء")}>
              <span className="lyx-ind" aria-hidden="true" />
              {SECTIONS.map((s) => {
                const Ico = ICONS[s];
                const n = badgeOf(s);
                return (
                  <Link key={s} href={SECTION_PATH[s]} className="lyx-nav-item" aria-current={section === s ? "page" : undefined} data-testid={`lyx-nav-${s}`}>
                    <span className="lyx-ico">
                      <Ico size={18} stroke={1.6} />
                    </span>
                    {label[s]}
                    {n > 0 && (
                      <span className="lyx-badge" aria-label={badgeAria(n)} data-testid={s === "checkin" ? "ck-tab-badge" : "rw-tab-badge"}>
                        {badgeText(n)}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="lyx-rail-foot">
              <div className="lyx-user">
                <span className="lyx-user-av">{initials}</span>
                <span className="lyx-user-tx">
                  <b>{user?.name}</b>
                  <span>{user?.role}</span>
                </span>
              </div>
              <button type="button" className="lyx-back" onClick={exit} data-testid="lyx-back">
                <span className="lyx-back-ico">
                  <IconArrowLeft size={17} />
                </span>
                {t("Back to ClinicOS", "العودة إلى ClinicOS")}
              </button>
            </div>
          </aside>

          <div className="lyx-main">
            <header className="lyx-top">
              <div className="lyx-top-row">
                <span className="lyx-top-mark" aria-hidden="true">
                  <span className="lyx-brand-mark">
                    <IconDiamond size={18} stroke={1.7} />
                  </span>
                </span>
                <div className="lyx-title">
                  <h1 className="lyx-display" data-testid="lyx-title">
                    {section === "overview" ? programName || label.overview : label[section]}
                  </h1>
                  <p>{sub[section]}</p>
                </div>
                <div className="lyx-tools">
                  <div className="lyx-pend">
                    {waiting > 0 && (
                      <Link href={SECTION_PATH.checkin} className="lyx-chip" data-testid="lyx-pending-checkins">
                        <span className="lyx-dot" />
                        <b>{waiting}</b> {t("check-ins waiting", "تسجيل وصول بالانتظار")}
                      </Link>
                    )}
                    {redeemWaiting > 0 && (
                      <Link href={SECTION_PATH.redemptions} className="lyx-chip" data-testid="lyx-pending-redemptions">
                        <span className="lyx-dot" />
                        <b>{redeemWaiting}</b> {t("redemptions waiting", "استبدال بالانتظار")}
                      </Link>
                    )}
                  </div>
                  <div className="lyx-seg" role="group" aria-label={t("Language", "اللغة")}>
                    {(["en", "ar"] as const).map((l) => (
                      <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>
                        {l.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="lyx-iconbtn"
                    aria-pressed={lite}
                    onClick={() => setVisual(lite ? "auto" : "lite")}
                    title={t("Lightweight visuals", "مؤثرات بصرية خفيفة")}
                    aria-label={t("Lightweight visuals", "مؤثرات بصرية خفيفة")}
                    data-testid="lyx-lite-toggle"
                  >
                    <IconSparkles size={17} />
                  </button>
                  <button type="button" className="lyx-iconbtn lyx-top-back" onClick={exit} aria-label={t("Back to ClinicOS", "العودة إلى ClinicOS")} data-testid="lyx-back-m">
                    <IconArrowLeft size={17} className="rtl-flip-ico" />
                  </button>
                </div>
              </div>

              <div className="lyx-chips" ref={chipsRef} role="navigation" aria-label={t("Loyalty sections", "أقسام الولاء")}>
                {SECTIONS.map((s) => {
                  const Ico = ICONS[s];
                  const n = badgeOf(s);
                  return (
                    <Link key={s} href={SECTION_PATH[s]} className="lyx-chip-nav" aria-current={section === s ? "page" : undefined} data-testid={`lyx-chip-${s}`}>
                      <Ico size={16} stroke={1.7} />
                      {label[s]}
                      {n > 0 && (
                        <span className="lyx-badge" aria-label={badgeAria(n)} data-testid={s === "checkin" ? "ck-tab-badge-m" : "rw-tab-badge-m"}>
                          {badgeText(n)}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </header>

            <main id="lyx-main" ref={mainRef} tabIndex={-1} className="lyx-content lyx-main-el" data-section={section}>
              <div key={pathname} className="lyx-page">
                {children}
              </div>
            </main>
          </div>
        </div>

        <div className="lyx-veil" aria-hidden="true" />
        {splashMounted && <CinematicSplash reduced={visual.reduced} lang={lang === "ar" ? "ar" : "en"} onReveal={() => setPhase("ready")} onDone={() => setSplashMounted(false)} />}
      </div>
    </VisualProvider>
  );
}
