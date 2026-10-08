"use client";
import type { CSSProperties } from "react";
import { useI18n } from "@/lib/i18n";
import type { PublicBrand } from "@/lib/loyaltyPublic";

/** Clinic identity + language switch — shared by the entry screen and the signed-in shell. */
export default function PatientTopBar({ brand, hidden }: { brand: PublicBrand | null; hidden?: boolean }) {
  const { lang, setLang } = useI18n();
  const name = brand?.name ?? "";
  return (
    <header className="pw-top" style={{ visibility: hidden ? "hidden" : undefined } as CSSProperties}>
      <div className="pw-brand">
        {brand?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} />
        ) : (
          <span className="pw-mono" aria-hidden="true">
            {(name.trim()[0] ?? "C").toUpperCase()}
          </span>
        )}
        <span className="pw-brand-txt">
          <span className="pw-brand-name" dir="auto">
            {name || " "}
          </span>
          <span className="pw-brand-sub">{brand?.programName || "Loyalty"}</span>
        </span>
      </div>
      <div className="pw-lang" role="group" aria-label="Language">
        <button type="button" aria-pressed={lang === "en"} onClick={() => setLang("en")} data-testid="pw-lang-en">
          EN
        </button>
        <button type="button" aria-pressed={lang === "ar"} onClick={() => setLang("ar")} data-testid="pw-lang-ar">
          عربي
        </button>
      </div>
    </header>
  );
}
