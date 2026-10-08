"use client";
import { useEffect, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { IconGift, IconHome2, IconId, IconTimeline, IconWifiOff } from "@tabler/icons-react";
import { useLT } from "@/lib/loyalty";
import type { PublicBrand } from "@/lib/loyaltyPublic";
import { captureCardFlight } from "./LoyaltyCard";
import { PMOTION } from "./patientDesign";
import PatientTopBar from "./PatientTopBar";

/**
 * PatientLoyaltyShell (Phase 9) — the patient app's OWN frame. It shares nothing with the clinic dashboard shell (no sidebar, no admin chrome).
 *
 *  top bar            clinic identity + language
 *  screen stack       Home · Rewards · Activity · My Card, with a depth transition (the outgoing screen steps back, the next comes forward)
 *  bottom navigation  a floating glass dock with a sliding material pill; 4 destinations; ≥44 px targets; safe-area aware; RTL aware
 *  offline banner     says plainly that the data may be old and that requests are paused
 *
 * On tablet / desktop the app is a centred, phone-proportioned stage (never a stretched mobile layout). Content behind a sheet recedes.
 */
export type ScreenId = "home" | "rewards" | "activity" | "card";
export const SCREEN_ORDER: ScreenId[] = ["home", "rewards", "activity", "card"];

const NAV: { id: ScreenId; en: string; ar: string; Icon: typeof IconHome2 }[] = [
  { id: "home", en: "Home", ar: "الرئيسية", Icon: IconHome2 },
  { id: "rewards", en: "Rewards", ar: "الجوائز", Icon: IconGift },
  { id: "activity", en: "Activity", ar: "النشاط", Icon: IconTimeline },
  { id: "card", en: "My Card", ar: "بطاقتي", Icon: IconId },
];

export default function PatientShell({
  brand,
  current,
  onNavigate,
  renderScreen,
  receded,
  online,
  updatedAt,
  homeDot,
  scrollRef,
  children,
}: {
  brand: PublicBrand | null;
  current: ScreenId;
  onNavigate: (id: ScreenId) => void;
  renderScreen: (id: ScreenId) => ReactNode;
  receded: boolean;
  online: boolean;
  updatedAt: number | null;
  /** contextual: a check-in request is waiting for reception */
  homeDot: boolean;
  scrollRef: MutableRefObject<number>;
  /** overlays (sheets, transformation, install) */
  children?: ReactNode;
}) {
  const { t, lang } = useLT();
  const [shown, setShown] = useState<ScreenId>(current);
  const [leaving, setLeaving] = useState<{ id: ScreenId; dir: "fwd" | "back" } | null>(null);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (current === shown) return;
    const d = SCREEN_ORDER.indexOf(current) >= SCREEN_ORDER.indexOf(shown) ? "fwd" : "back";
    setDir(d);
    setLeaving({ id: shown, dir: d });
    setShown(current);
    scrollRef.current = 0;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLeaving(null), PMOTION.nav + 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = (id: ScreenId) => {
    if (id === current) return;
    if ((current === "home" && id === "card") || (current === "card" && id === "home")) captureCardFlight();
    onNavigate(id);
  };
  const idx = SCREEN_ORDER.indexOf(current);
  const asOf = updatedAt ? new Date(updatedAt).toLocaleTimeString(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <>
      <PatientTopBar brand={brand} />
      {!online && (
        <div className="pw-offline" role="status" data-testid="pw-offline">
          <IconWifiOff size={17} aria-hidden="true" />
          <span>{asOf ? t(`You're offline. This is your card as of ${asOf}; requests are paused until you reconnect.`, `أنت غير متصل. هذه بطاقتك حتى ${asOf}؛ الطلبات متوقفة حتى تعود للاتصال.`) : t("You're offline. Requests are paused until you reconnect.", "أنت غير متصل. الطلبات متوقفة حتى تعود للاتصال.")}</span>
        </div>
      )}
      <main className={`pw-screens ${receded ? "is-receded" : ""}`} aria-hidden={receded ? true : undefined} data-testid="pw-screens" data-screen={current}>
        {leaving && (
          <div className="pw-screen is-out" data-dir={leaving.dir} aria-hidden="true" key={`out-${leaving.id}`}>
            {renderScreen(leaving.id)}
          </div>
        )}
        <div
          className={`pw-screen ${leaving ? "is-in" : ""}`}
          data-dir={dir}
          data-screen={shown}
          data-testid={`pw-screen-${shown}`}
          key={`in-${shown}`}
          onScroll={(e) => {
            scrollRef.current = e.currentTarget.scrollTop;
          }}
        >
          {renderScreen(shown)}
        </div>
      </main>

      <nav className="pw-nav" aria-label={t("Main", "التنقل الرئيسي")} aria-hidden={receded ? true : undefined}>
        <div className="pw-nav-in" style={{ ["--i" as string]: idx } as React.CSSProperties}>
          <span className="pw-nav-pill" aria-hidden="true" />
          {NAV.map(({ id, en, ar, Icon }) => (
            <button key={id} type="button" className="pw-nav-btn" aria-current={current === id ? "page" : undefined} onClick={() => go(id)} data-testid={`pw-nav-${id}`} tabIndex={receded ? -1 : 0}>
              <Icon size={22} stroke={1.7} aria-hidden="true" />
              <span>{lang === "ar" ? ar : en}</span>
              {id === "home" && homeDot && <i className="pw-nav-dot" role="img" data-testid="pw-nav-dot" aria-label={t("Check-in waiting", "تسجيل الوصول بالانتظار")} />}
            </button>
          ))}
        </div>
      </nav>
      {children}
    </>
  );
}
