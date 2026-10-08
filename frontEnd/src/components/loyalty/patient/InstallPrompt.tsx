"use client";
import { useEffect, useRef, useState } from "react";
import { IconDownload, IconShare2, IconSquarePlus, IconX } from "@tabler/icons-react";
import { useLT } from "@/lib/loyalty";
import { useDialog } from "./useDialog";

/**
 * "Add to home screen" (Phase 9) — subtle, and only AFTER the patient has really used the app (the caller passes `ready` once they have
 * opened a second screen, flipped the card, or spent a while on it). Never on the first paint, never over a modal, never twice in two weeks
 * after a dismissal, never when the app is already installed.
 *
 *  Chrome / Android / desktop  → the browser's own install prompt (`beforeinstallprompt`) behind our button.
 *  iOS Safari                  → there is no prompt API: a short, honest instruction sheet (Share → Add to Home Screen).
 */
const KEY = "lyp-install";
const QUIET_MS = 14 * 24 * 60 * 60 * 1000;

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export const isStandalone = () => {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
};
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const quiet = () => {
  try {
    const at = Number(window.localStorage.getItem(KEY) || 0);
    return at > 0 && Date.now() - at < QUIET_MS;
  } catch {
    return false;
  }
};
const remember = () => {
  try {
    window.localStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
};

/**
 * The browser fires `beforeinstallprompt` ONCE per page load, so the event is captured at module level and shared: the Home banner and the Card
 * screen's button (mounted later) both see it, however late they mount.
 */
let deferred: BIPEvent | null = null;
let installed = false;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    deferred = e as BIPEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

/** Hook shared by the subtle banner (Home) and the explicit button (Card screen). */
export function useInstall() {
  const [evt, setEvt] = useState<BIPEvent | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setStandalone(isStandalone() || installed);
    setIos(isIos());
    const sync = () => {
      setEvt(deferred);
      if (installed) setStandalone(true);
    };
    sync();
    subs.add(sync);
    return () => {
      subs.delete(sync);
    };
  }, []);
  const canInstall = !standalone && !!evt;
  const canIosHelp = !standalone && ios && !evt;
  const install = async () => {
    if (!evt) return;
    try {
      await evt.prompt();
      await evt.userChoice;
    } catch {
      /* the browser refused — nothing to do */
    }
    deferred = null;
    emit();
  };
  return { canInstall, canIosHelp, install, standalone };
}

export function IosInstallSheet({ onClose, onOpenChange }: { onClose: () => void; onOpenChange: (o: boolean) => void }) {
  const { t } = useLT();
  const ref = useDialog(true, onClose, { onOpenChange, initialFocus: "[data-autofocus]" });
  return (
    <div className="rs-root" data-testid="pw-ios-install">
      <div className="rs-back" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className="rs-panel" role="dialog" aria-modal="true" aria-label={t("Add to Home Screen", "إضافة إلى الشاشة الرئيسية")} tabIndex={-1}>
        <button type="button" className="rs-close" onClick={onClose} aria-label={t("Close", "إغلاق")} data-autofocus>
          <IconX size={20} />
        </button>
        <h2 className="rs-title">{t("Add your card to the Home Screen", "أضف بطاقتك إلى الشاشة الرئيسية")}</h2>
        <ol className="in-steps">
          <li>
            <span className="in-ico">
              <IconShare2 size={20} />
            </span>
            {t("In Safari, tap the Share button.", "في Safari، اضغط زر المشاركة.")}
          </li>
          <li>
            <span className="in-ico">
              <IconSquarePlus size={20} />
            </span>
            {t("Choose “Add to Home Screen”.", "اختر «إضافة إلى الشاشة الرئيسية».")}
          </li>
          <li>
            <span className="in-ico">
              <IconDownload size={20} />
            </span>
            {t("Tap Add. Your card opens like an app.", "اضغط إضافة. تُفتح بطاقتك كتطبيق.")}
          </li>
        </ol>
        <button type="button" className="pw-btn is-block" onClick={onClose}>
          {t("Got it", "فهمت")}
        </button>
      </div>
    </div>
  );
}

/** The subtle banner: appears at most once per visit, only when `ready` and nothing else is open. */
export default function InstallPrompt({ ready, blocked, onOpenChange }: { ready: boolean; blocked: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useLT();
  const { canInstall, canIosHelp, install } = useInstall();
  const [show, setShow] = useState(false);
  const [help, setHelp] = useState(false);
  const shown = useRef(false);

  useEffect(() => {
    if (!ready || blocked || shown.current || quiet() || !(canInstall || canIosHelp)) return;
    const id = setTimeout(() => {
      shown.current = true;
      setShow(true);
    }, 1200);
    return () => clearTimeout(id);
  }, [ready, blocked, canInstall, canIosHelp]);

  if (help) return <IosInstallSheet onClose={() => (setHelp(false), setShow(false))} onOpenChange={onOpenChange} />;
  if (!show || blocked || !(canInstall || canIosHelp)) return null;
  const close = () => {
    remember();
    setShow(false);
  };
  return (
    <div className="in-banner pw-rise" role="region" aria-label={t("Install", "التثبيت")} data-testid="pw-install">
      <span className="in-ico" aria-hidden="true">
        <IconDownload size={18} />
      </span>
      <div className="in-txt">
        <b>{t("Keep your card one tap away", "اجعل بطاقتك على بعد لمسة")}</b>
        <span>{t("Add it to your home screen.", "أضفها إلى شاشتك الرئيسية.")}</span>
      </div>
      <button
        type="button"
        className="pw-ghost in-add"
        onClick={() => {
          if (canInstall) void install().then(close);
          else setHelp(true);
        }}
        data-testid="pw-install-add"
      >
        {t("Add", "إضافة")}
      </button>
      <button type="button" className="in-x" onClick={close} aria-label={t("Not now", "ليس الآن")} data-testid="pw-install-dismiss">
        <IconX size={16} />
      </button>
    </div>
  );
}
