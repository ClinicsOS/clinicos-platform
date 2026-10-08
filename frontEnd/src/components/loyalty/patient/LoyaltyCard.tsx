"use client";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { IconRotate360 } from "@tabler/icons-react";
import { useLT } from "@/lib/loyalty";
import { hexToRgb, MATERIAL_INFO, materialOf, usePatientVisual, type MaterialKey } from "./patientDesign";
import { useTilt } from "./tilt";

/**
 * THE signature object of the patient app: a physical Loyalty Card floating inside the phone (Phase 9).
 *
 *  Construction  8 stacked slabs = real thickness and an edge that shows when the card turns · front + back faces (flip) · procedural
 *                material layers (base bands, pattern, SVG-noise micro-surface, specular, brushed anisotropy, iridescence, Fresnel rim,
 *                holographic patch, light sweep) · embossed / debossed / foil type · soft shadow plane.
 *  Content       REAL only — clinic name/logo, the patient's FIRST name, the clinic's own tier name, member-since, a non-reversible reference.
 *                No phone, no id, no clinical data, and no fake bank-card marks (this is ClinicOS Loyalty).
 *  Materials     tier1 pearl/ivory · tier2 platinum · tier3 gold · tier4 obsidian — each also has its own PATTERN, SYMBOL and rank pips, so a
 *                tier is never told apart by colour alone.
 *  Touch         see tilt.ts — horizontal drag tilts, vertical scroll is never taken, spring return, tap / button flips.
 */

/* ---------- symbols (inline SVG, 24×24) ---------- */
export function TierSymbol({ kind }: { kind: "ring" | "diamond" | "crown" | "seal" | "gem" }) {
  const p = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;
  if (kind === "ring")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.2" />
      </svg>
    );
  if (kind === "diamond")
    return (
      <svg {...p}>
        <path d="M6 4h12l3.5 5L12 21 2.5 9z" />
        <path d="M2.5 9h19M9 4l-2 5 5 12 5-12-2-5" />
      </svg>
    );
  if (kind === "crown")
    return (
      <svg {...p}>
        <path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />
        <path d="M5 19h14" />
      </svg>
    );
  if (kind === "seal")
    return (
      <svg {...p}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6.5l1.6 3.4 3.7.5-2.7 2.6.7 3.7-3.3-1.8-3.3 1.8.7-3.7-2.7-2.6 3.7-.5z" />
      </svg>
    );
  return (
    <svg {...p}>
      <path d="M12 3l7 6-7 12L5 9z" />
      <path d="M5 9h14" />
    </svg>
  );
}

/* ---------- shared-element continuity: the same card "travels" between Home and My Card ---------- */
const flight: { rect: DOMRect | null; at: number } = { rect: null, at: 0 };
/** Call right before changing screen: remembers where the card is now so the next screen's card can fly in from there. */
export function captureCardFlight() {
  try {
    const el = document.querySelector<HTMLElement>("[data-card-flight]");
    flight.rect = el ? el.getBoundingClientRect() : null;
    flight.at = Date.now();
  } catch {
    flight.rect = null;
  }
}

export interface LoyaltyCardProps {
  clinicName: string;
  programName?: string | null;
  logoUrl?: string | null;
  /** clinic brand colour (#rrggbb) — tints the neutral material and the atmosphere only */
  accent?: string | null;
  firstName?: string;
  /** already formatted, e.g. "Mar 2025" */
  since?: string;
  refCode?: string;
  tierKey?: string | null;
  tierName?: string | null;
  tierRank?: number | null;
  benefits?: string[];
  /** not identified yet: shows the card without any personal data */
  locked?: boolean;
  /** "x": horizontal tilt, page scroll stays free (Home). "xy": full 2-axis tilt (focused My Card stage). */
  axes?: "x" | "xy";
  /** tilt on touch / hover. false → a still object (it can still be tapped) */
  interactive?: boolean;
  flipped?: boolean;
  onFlip?: (flipped: boolean) => void;
  /** show the 44px flip button */
  flipButton?: boolean;
  /** tap handler; when absent a tap flips (if flippable) */
  onTap?: () => void;
  /** idle light sweep: none | once (entrance) | loop (full mode, calm) */
  sweep?: "none" | "once" | "loop";
  /** takes part in the Home ↔ My Card flight */
  flightTarget?: boolean;
  flyIn?: boolean;
  testId?: string;
  className?: string;
  style?: CSSProperties;
}

const bitsOf = (ref: string) => {
  // 7×7 member mark: deterministic, symmetric, derived from the (non-reversible) reference — decoration, not a scannable code
  let h = 2166136261;
  for (let i = 0; i < ref.length; i++) h = Math.imul(h ^ ref.charCodeAt(i), 16777619);
  const cells: boolean[] = [];
  for (let r = 0; r < 7; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < 4; c++) {
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      row.push(((h >>> 7) & 3) !== 0);
    }
    cells.push(...row, ...row.slice(0, 3).reverse());
  }
  return cells;
};

function LoyaltyCardInner(props: LoyaltyCardProps) {
  const { t, lang } = useLT();
  const visual = usePatientVisual();
  const mat: MaterialKey = props.locked ? "none" : materialOf(props.tierKey);
  const info = MATERIAL_INFO[mat];
  const [flippedState, setFlippedState] = useState(false);
  const flipped = props.flipped ?? flippedState;
  const [flipping, setFlipping] = useState(false);
  const flipTimer = useRef<ReturnType<typeof setTimeout>>();
  const wrapRef = useRef<HTMLDivElement>(null);

  const tiltOn = (props.interactive ?? true) && visual.mode !== "static";
  const setFlip = useCallback(
    (f: boolean) => {
      setFlipping(true);
      clearTimeout(flipTimer.current);
      flipTimer.current = setTimeout(() => setFlipping(false), 800);
      if (props.flipped === undefined) setFlippedState(f);
      props.onFlip?.(f);
    },
    [props]
  );
  useEffect(() => () => clearTimeout(flipTimer.current), []);

  const onTap = useCallback(() => {
    if (props.onTap) props.onTap();
    else if (props.flipButton || props.onFlip) setFlip(!flipped);
  }, [props, flipped, setFlip]);

  const { ref, handlers } = useTilt<HTMLDivElement>({ enabled: tiltOn, axes: props.axes ?? "x", max: props.axes === "xy" ? 28 : 24, onTap });

  // Home ↔ My Card flight: fly in from where the previous screen's card was (Web Animations; skipped in static mode)
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!props.flyIn || !el || visual.mode === "static" || !flight.rect || Date.now() - flight.at > 1500 || !el.animate) return;
    const to = el.getBoundingClientRect();
    const from = flight.rect;
    flight.rect = null;
    if (!to.width || !from.width) return;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const s = from.width / to.width;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2 && Math.abs(s - 1) < 0.01) return;
    el.animate([{ transformOrigin: "top left", transform: `translate(${dx}px,${dy}px) scale(${s})` }, { transformOrigin: "top left", transform: "none" }], { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bits = useMemo(() => bitsOf(props.refCode || props.clinicName), [props.refCode, props.clinicName]);
  const accent = hexToRgb(props.accent);
  const tierName = props.locked ? t("MEMBERSHIP", "العضوية") : props.tierName || t("Member", "عضو");
  const long = tierName.length > 13;
  const sweep = visual.mode === "static" ? "none" : props.sweep ?? (visual.mode === "full" ? "loop" : "once");
  const name = props.locked ? t("YOUR NAME", "اسمك") : props.firstName || "";
  const aria = props.locked
    ? t(`${props.clinicName} Loyalty card`, `بطاقة ولاء ${props.clinicName}`)
    : t(`${props.clinicName} Loyalty card. ${props.tierName ? `Tier ${props.tierName}.` : ""} ${props.firstName ? `Member ${props.firstName}.` : ""}`, `بطاقة ولاء ${props.clinicName}. ${props.tierName ? `المستوى ${props.tierName}.` : ""} ${props.firstName ? `العضو ${props.firstName}.` : ""}`);
  const benefits = (props.benefits ?? []).slice(0, 3);

  return (
    <div ref={wrapRef} className={`pc-flight ${props.className ?? ""}`} style={props.style} data-card-flight={props.flightTarget ? "" : undefined}>
      <div
        ref={ref}
        className="pc-scene"
        role="group"
        aria-label={aria}
        data-testid={props.testId ?? "pw-card"}
        data-mat={mat}
        data-tier={props.locked ? "none" : props.tierKey ?? "none"}
        data-pat={info.pattern}
        data-mode={visual.mode}
        data-sweep={sweep}
        data-flipped={flipped ? "1" : "0"}
        data-locked={props.locked ? "1" : "0"}
        data-dir={lang === "ar" ? "rtl" : "ltr"}
        data-touch={props.axes === "xy" ? "none" : "pan-y"}
        style={{ ["--accent" as string]: accent } as CSSProperties}
        {...(handlers as object)}
      >
        <div className={`pc-float`} style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d" }}>
          <div className={`pc-body ${flipping ? "is-flipping" : ""}`} style={{ ["--flip" as string]: flipped ? "180deg" : "0deg" } as CSSProperties}>
            {Array.from({ length: 8 }, (_, i) => (
              <i key={i} className="pc-slab" style={{ ["--z" as string]: `${-(i + 1) * 0.9}px` } as CSSProperties} />
            ))}

            {/* ============ FRONT ============ */}
            <div className="pc-face pc-front" aria-hidden={flipped}>
              <div className="pc-layer pc-pat" />
              <div className="pc-layer pc-noise" />
              <div className="pc-layer pc-spec" />
              <div className="pc-layer pc-aniso" />
              <div className="pc-layer pc-iri" />
              <div className="pc-layer pc-fres" />
              <div className="pc-content">
                <div className="pc-top">
                  <div className="pc-id">
                    {props.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="pc-logo" src={props.logoUrl} alt="" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = "none")} />
                    ) : (
                      <span className="pc-mono">{(props.clinicName.trim()[0] ?? "C").toUpperCase()}</span>
                    )}
                    <span className="pc-names">
                      <span className="pc-clinic" dir="auto">
                        {props.clinicName}
                      </span>
                      <span className="pc-prog">{props.programName || "ClinicOS Loyalty"}</span>
                    </span>
                  </div>
                  <span className="pc-sym">
                    <TierSymbol kind={info.symbol} />
                  </span>
                </div>
                <div className="pc-mid">
                  <span className={`pc-tier ${long ? "is-long" : ""}`} dir="auto" data-testid="pw-card-tier">
                    {tierName}
                  </span>
                  {info.rank > 0 && (
                    <span className="pc-pips" aria-hidden="true">
                      {[1, 2, 3, 4].map((i) => (
                        <i key={i} className={i <= info.rank ? "on" : ""} />
                      ))}
                    </span>
                  )}
                </div>
                <div className="pc-bot">
                  <div className="pc-who">
                    <span className="pc-name" dir="auto" data-testid="pw-card-name">
                      {name}
                    </span>
                    <span className="pc-since">{props.locked ? t("MEMBER CARD", "بطاقة عضوية") : props.since ? `${t("MEMBER SINCE", "عضو منذ")} ${props.since}` : ""}</span>
                  </div>
                  <span className="pc-holo" aria-hidden="true">
                    <TierSymbol kind={info.symbol} />
                  </span>
                </div>
              </div>
              <div className="pc-layer pc-sweep" />
            </div>

            {/* ============ BACK ============ */}
            <div className="pc-face pc-back" aria-hidden={!flipped}>
              <div className="pc-layer pc-pat" />
              <div className="pc-layer pc-noise" />
              <div className="pc-layer pc-spec" />
              <div className="pc-layer pc-aniso" />
              <div className="pc-layer pc-fres" />
              <div className="pc-content">
                <div className="pc-b-top">
                  <div className="pc-names">
                    <span className="pc-b-word">ClinicOS Loyalty</span>
                    <span className="pc-b-clinic" dir="auto">
                      {props.clinicName}
                    </span>
                  </div>
                  <span className="pc-sym">
                    <TierSymbol kind={info.symbol} />
                  </span>
                </div>
                {benefits.length > 0 ? (
                  <ul className="pc-benefits" data-testid="pw-card-back-benefits">
                    {benefits.map((b, i) => (
                      <li key={i}>
                        <i />
                        <span dir="auto">{b}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="pc-b-empty">{props.locked ? t("Enter your number to open your card.", "أدخل رقمك لفتح بطاقتك.") : t("Your tier benefits appear here when your clinic lists them.", "ستظهر مزايا مستواك هنا عندما تضيفها العيادة.")}</p>
                )}
                <div className="pc-bot">
                  <div className="pc-who">
                    <span className="pc-since">{t("MEMBER REFERENCE", "مرجع العضوية")}</span>
                    <span className="pc-ref" dir="ltr" data-testid="pw-card-ref">
                      {props.locked ? "LY-····-····" : props.refCode || ""}
                    </span>
                  </div>
                  <span className="pc-mark" aria-hidden="true">
                    {bits.map((on, i) => (
                      <i key={i} className={on ? "on" : ""} />
                    ))}
                  </span>
                </div>
              </div>
              <div className="pc-layer pc-sweep" />
            </div>
          </div>
        </div>
        <div className="pc-shadow" aria-hidden="true" />
        {props.flipButton && (
          <button
            type="button"
            className="pc-flipbtn"
            onClick={(e) => {
              e.stopPropagation();
              setFlip(!flipped);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-pressed={flipped}
            aria-label={flipped ? t("Show the front of the card", "عرض واجهة البطاقة") : t("Flip the card", "اقلب البطاقة")}
            data-testid="pw-card-flip"
          >
            <IconRotate360 size={20} stroke={1.7} />
          </button>
        )}
      </div>
    </div>
  );
}

const LoyaltyCard = memo(LoyaltyCardInner);
export default LoyaltyCard;
