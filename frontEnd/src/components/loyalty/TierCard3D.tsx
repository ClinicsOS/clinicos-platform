"use client";
import { useRef, type PointerEvent } from "react";
import { IconCircleDot, IconCrown, IconDiamond, IconStar } from "@tabler/icons-react";
import { prefersReducedMotion, type TierKey } from "@/lib/loyalty";

/**
 * ClinicOS Loyalty — TIER CARDS (Phase 7).
 *
 * One card, four distinct materials, chosen by the STABLE tier key (never by the clinic's display name):
 *   tier1  restrained graphite — matte, hairline engraving, almost no shine
 *   tier2  brushed platinum / silver — cool metal, soft iridescence
 *   tier3  polished gold — warm foil, engraved guilloche rings, stronger light sweep
 *   tier4  deep prestige — obsidian with an indigo core, champagne rim, diamond lattice and a holographic foil
 *
 * Pure CSS 3D (perspective + preserve-3d + translateZ parallax). No WebGL, no images, no layout-affecting animation: only
 * transform / opacity move. Tilt is mouse-only; `prefers-reduced-motion` turns ALL motion off and the card stays a still,
 * fully lit object. The card is decorative (aria-hidden) — every fact on it is also available as real text next to it.
 *
 * The card never calculates anything: it draws strings and a percentage the server already decided.
 */

export interface TierCardProgress {
  /** 0…100, from the server */
  percent: number;
  /** e.g. "Silver" — where the member is now */
  left: string;
  /** e.g. "Gold · 1,240 left" — the next tier; or the "Highest tier" label at the top */
  right: string;
  top: boolean;
}

export interface TierCardProps {
  tierKey: TierKey;
  /** the clinic's display name for this tier (plain text; shown upper-case) */
  tierName: string;
  /** program / clinic name */
  brand: string;
  /** small caption above the big figure, e.g. "AVAILABLE POINTS" */
  centerLabel: string;
  /** the big figure; null → "—" */
  centerValue: string | null;
  /** member name, or any short caption for the foot of the card */
  holder?: string | null;
  progress?: TierCardProgress | null;
  /** word shown above the tier name ("TIER" / "المستوى") */
  tierWord: string;
  /** a real promotion just happened → one-time unlock animation */
  celebrate?: boolean;
  tilt?: boolean;
  testId?: string;
}

const ICON = { tier1: IconCircleDot, tier2: IconStar, tier3: IconCrown, tier4: IconDiamond } as const;

export default function TierCard3D({ tierKey, tierName, brand, centerLabel, centerValue, holder, progress, tierWord, celebrate = false, tilt = true, testId }: TierCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const Icon = ICON[tierKey];

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!tilt || e.pointerType !== "mouse" || prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    el.style.setProperty("--rx", `${((0.5 - py) * 13).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((px - 0.5) * 17).toFixed(2)}deg`);
    el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--mx", "28%");
    el.style.setProperty("--my", "18%");
  };

  return (
    <div className="lyt-stage" aria-hidden="true" data-testid={testId} data-tier={tierKey} data-celebrate={celebrate ? "true" : "false"} onPointerMove={move} onPointerLeave={leave}>
      <div className="lyt-float">
        <div ref={ref} className="lyt-tilt">
          <div className="lyt-card" dir="ltr">
            <div className="lyt-edge" />
            <div className="lyt-clip">
              <div className="lyt-face" />
              <div className="lyt-pattern" />
              <svg className="lyt-rings" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth=".7">
                <circle cx="100" cy="100" r="96" />
                <circle cx="100" cy="100" r="82" />
                <circle cx="100" cy="100" r="68" strokeDasharray="1.5 4" />
                <circle cx="100" cy="100" r="54" />
                <circle cx="100" cy="100" r="40" />
                <path d="M100 4A96 96 0 0 1 196 100" strokeWidth="1.8" />
              </svg>
              <div className="lyt-foil" />
              <div className="lyt-grain" />
              <div className="lyt-sheen" />
              <div className="lyt-sweep" />
            </div>
            <div className="lyt-content">
              <div className="lyt-top">
                <span className="lyt-emblem">
                  <Icon size={16} stroke={1.6} />
                </span>
                <span className="lyt-brand">
                  <b>{brand.toUpperCase()}</b>
                  <i>CLINICOS LOYALTY</i>
                </span>
                <span className="lyt-tier">
                  <small>{tierWord}</small>
                  <b dir="auto">{tierName.toUpperCase()}</b>
                </span>
              </div>
              <div className="lyt-fig">
                <small>{centerLabel}</small>
                <b className={centerValue === null ? "is-empty" : ""}>{centerValue ?? "—"}</b>
              </div>
              <div className="lyt-foot">
                {holder ? (
                  <span className="lyt-holder" dir="auto">
                    {holder}
                  </span>
                ) : (
                  <span />
                )}
                {progress && (
                  <span className="lyt-prog" data-top={progress.top ? "true" : "false"}>
                    <span className="lyt-prog-row">
                      <em dir="auto">{progress.left}</em>
                      <em dir="auto">{progress.right}</em>
                    </span>
                    <span className="lyt-bar">
                      <span className="lyt-fill" style={{ transform: `scaleX(${Math.max(0, Math.min(100, progress.percent)) / 100})` }} />
                    </span>
                  </span>
                )}
              </div>
            </div>
            {celebrate && (
              <div className="lyt-spark" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <i key={i} style={{ ["--i" as string]: i } as React.CSSProperties} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="lyt-shadow" />
    </div>
  );
}

/** Small material swatch used as a badge in lists (same palette as the card, no motion). */
export function TierBadge({ tierKey, name, size = "md" }: { tierKey: TierKey; name: string; size?: "sm" | "md" }) {
  const Icon = ICON[tierKey];
  return (
    <span className={`lyt-badge ${size === "sm" ? "is-sm" : ""}`} data-tier={tierKey} data-testid={`tier-badge-${tierKey}`}>
      <Icon size={size === "sm" ? 11 : 13} stroke={1.8} aria-hidden="true" />
      <span className="truncate" dir="auto">
        {name}
      </span>
    </span>
  );
}

export function TierStyles() {
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}

const CSS = `
.lyt-stage{position:relative;width:100%;max-width:380px;margin:0 auto;perspective:1100px;container-type:inline-size}
.lyt-float{animation:lytFloat 7s ease-in-out infinite}
.lyt-tilt{--rx:0deg;--ry:0deg;--mx:28%;--my:18%;transform:rotateX(var(--rx)) rotateY(var(--ry));transform-style:preserve-3d;transition:transform .28s ease-out;will-change:transform}
.lyt-card{position:relative;aspect-ratio:1.58/1;font-size:14px;font-size:4.1cqw;border-radius:1.7em;transform-style:preserve-3d;color:var(--ink)}
.lyt-edge{position:absolute;inset:0;border-radius:1.7em;background:var(--edge);transform:translateZ(-7px);box-shadow:0 .9em 2.4em rgba(0,0,0,.55)}
.lyt-clip{position:absolute;inset:0;border-radius:1.7em;overflow:hidden;box-shadow:inset 0 0 0 1.5px var(--rim),inset 0 1px 0 rgba(255,255,255,.28),0 0 2em var(--glow)}
.lyt-clip::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.12),transparent 32%,transparent 62%,rgba(255,255,255,.1))}
.lyt-face{position:absolute;inset:0;background:var(--face)}
.lyt-pattern{position:absolute;inset:0;background:var(--pattern);opacity:var(--pattern-o,.5)}
.lyt-rings{position:absolute;inset-inline-end:-18%;top:-34%;width:92%;aspect-ratio:1;color:var(--ring);opacity:var(--ring-o,0)}
.lyt-foil{position:absolute;inset:0;mix-blend-mode:screen;opacity:var(--foil-o,0);background:conic-gradient(from calc(var(--ry) * 5 + 210deg) at 78% 18%,rgba(255,255,255,0) 0deg,rgba(var(--hue1),.6) 50deg,rgba(var(--hue2),.4) 110deg,rgba(var(--hue3),.36) 170deg,rgba(var(--hue1),.55) 230deg,rgba(255,255,255,0) 290deg)}
.lyt-grain{position:absolute;inset:0;opacity:.08;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E")}
.lyt-sheen{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at var(--mx,28%) var(--my,18%),rgba(255,255,255,var(--sheen,.4)),rgba(255,255,255,0) 46%);mix-blend-mode:screen;opacity:.7}
.lyt-sweep{position:absolute;inset:-20%;pointer-events:none;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,var(--sweep,.4)) 50%,transparent 60%);mix-blend-mode:screen;transform:translateX(-130%);animation:lytSweep var(--sweep-t,9s) ease-in-out 1.4s infinite}
.lyt-content{position:absolute;inset:0;padding:1.3em 1.6em 1.25em;display:flex;flex-direction:column;justify-content:space-between;transform:translateZ(30px);transform-style:preserve-3d}
.lyt-top{display:flex;align-items:flex-start;gap:.75em;min-width:0}
.lyt-emblem{display:inline-flex;flex:none;width:2.3em;height:2.3em;align-items:center;justify-content:center;border-radius:50%;border:1px solid var(--ink-soft);color:var(--ink);transform:translateZ(10px)}
.lyt-emblem svg{width:1.15em;height:1.15em}
.lyt-brand{display:flex;flex-direction:column;line-height:1.15;min-width:0;flex:1}
.lyt-brand b{font-size:.74em;letter-spacing:.18em;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lyt-brand i{font-style:normal;font-size:.42em;letter-spacing:.28em;opacity:.7;margin-top:.4em;font-weight:700}
.lyt-tier{display:flex;flex-direction:column;align-items:flex-end;min-width:0;max-width:52%;text-align:end;line-height:1.1}
.lyt-tier small{font-size:.42em;letter-spacing:.3em;font-weight:700;opacity:.7}
.lyt-tier b{font-family:Georgia,"Times New Roman",serif;font-size:1.28em;letter-spacing:.14em;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;text-shadow:var(--tshadow)}
.lyt-fig{transform:translateZ(12px)}
.lyt-fig small{display:block;font-size:.5em;letter-spacing:.3em;font-weight:700;opacity:.72;margin-bottom:.1em}
.lyt-fig b{display:block;font-family:Georgia,"Times New Roman",serif;font-size:2.9em;line-height:1;font-weight:500;letter-spacing:.01em;text-shadow:var(--tshadow);font-feature-settings:"lnum" 1,"tnum" 1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lyt-fig b.is-empty{opacity:.35}
.lyt-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:1em;min-width:0}
.lyt-holder{font-size:.7em;letter-spacing:.12em;font-weight:700;text-transform:uppercase;min-width:0;max-width:44%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lyt-prog{flex:1;min-width:0;display:flex;flex-direction:column;gap:.35em}
.lyt-prog-row{display:flex;justify-content:space-between;gap:.8em;min-width:0}
.lyt-prog-row em{font-style:normal;font-size:.52em;letter-spacing:.1em;font-weight:700;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.lyt-prog-row em:last-child{text-align:end}
.lyt-bar{display:block;height:.42em;border-radius:99px;background:var(--bar-bg);overflow:hidden;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
.lyt-fill{display:block;height:100%;width:100%;border-radius:99px;background:var(--bar);transform-origin:left center;transition:transform .9s cubic-bezier(.2,.8,.3,1)}
.lyt-prog[data-top="true"] .lyt-fill{background:var(--bar-top);box-shadow:0 0 .8em var(--glow)}
.lyt-shadow{width:72%;height:16px;margin:16px auto 0;border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,.6),transparent 70%);filter:blur(7px);animation:lytShadow 7s ease-in-out infinite}

/* ---- materials (selected by the stable key) ---- */
.lyt-stage[data-tier="tier1"]{--ink:#dde4ee;--ink-soft:rgba(221,228,238,.5);--tshadow:0 .04em .2em rgba(0,0,0,.4);--edge:#272c34;--rim:rgba(190,202,218,.34);--glow:rgba(150,165,185,.12);--sheen:.14;--sweep:.0;--sweep-t:14s;--ring:#a8b4c6;--ring-o:.0;--foil-o:0;--pattern-o:.55;--bar-bg:rgba(255,255,255,.12);--bar:linear-gradient(90deg,#8e9bb0,#cdd6e4);--bar-top:linear-gradient(90deg,#8e9bb0,#e6ecf5);
  --face:radial-gradient(130% 100% at 12% 0%,#323943 0%,#1c2027 55%,#12151a 100%);--pattern:repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0 1px,transparent 1px 5px);--hue1:150,165,185;--hue2:150,165,185;--hue3:150,165,185}
.lyt-stage[data-tier="tier2"]{--ink:#18202e;--ink-soft:rgba(24,32,46,.55);--tshadow:0 1px 0 rgba(255,255,255,.55);--edge:#76808f;--rim:rgba(255,255,255,.85);--glow:rgba(190,205,225,.28);--sheen:.55;--sweep:.55;--sweep-t:9s;--ring:#5d6877;--ring-o:.13;--foil-o:.32;--pattern-o:1;--bar-bg:rgba(24,32,46,.18);--bar:linear-gradient(90deg,#4a5568,#7f8da3);--bar-top:linear-gradient(90deg,#4a5568,#a9b6c9);
  --face:linear-gradient(135deg,#eef1f5 0%,#b4bdc9 36%,#e3e8ee 54%,#8d97a6 100%);--pattern:repeating-linear-gradient(90deg,rgba(255,255,255,.28) 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,rgba(0,0,0,.06) 0 2px,transparent 2px 7px);--hue1:150,190,235;--hue2:200,170,240;--hue3:160,225,215}
.lyt-stage[data-tier="tier3"]{--ink:#3b2806;--ink-soft:rgba(59,40,6,.55);--tshadow:0 1px 0 rgba(255,238,180,.6);--edge:#7b5a15;--rim:rgba(255,243,200,.85);--glow:rgba(240,200,100,.3);--sheen:.62;--sweep:.62;--sweep-t:7s;--ring:#7a5512;--ring-o:.3;--foil-o:.3;--pattern-o:.9;--bar-bg:rgba(59,40,6,.2);--bar:linear-gradient(90deg,#7a5512,#c18f20);--bar-top:linear-gradient(90deg,#7a5512,#f3d16a);
  --face:linear-gradient(135deg,#f8e19a 0%,#cf9f33 38%,#f3d67f 56%,#a67a1d 100%);--pattern:repeating-linear-gradient(115deg,rgba(255,255,255,.22) 0 1px,transparent 1px 4px);--hue1:255,220,120;--hue2:255,170,90;--hue3:255,240,170}
.lyt-stage[data-tier="tier4"]{--ink:#f6e8d0;--ink-soft:rgba(246,232,208,.6);--tshadow:0 .05em .25em rgba(0,0,0,.55),0 0 .7em rgba(232,196,150,.3);--edge:#2a1d3d;--rim:rgba(236,200,155,.78);--glow:rgba(150,110,230,.34);--sheen:.4;--sweep:.5;--sweep-t:6s;--ring:#e8c496;--ring-o:.3;--foil-o:.55;--pattern-o:1;--bar-bg:rgba(255,255,255,.14);--bar:linear-gradient(90deg,#b98a5e,#f1d3a6);--bar-top:linear-gradient(90deg,#d6a56f,#fff0cf,#c9a0ff);
  --face:radial-gradient(120% 100% at 10% 0%,#40306c 0%,#18122f 46%,#07060f 100%);--pattern:repeating-linear-gradient(45deg,rgba(232,196,150,.08) 0 1px,transparent 1px 9px),repeating-linear-gradient(-45deg,rgba(232,196,150,.08) 0 1px,transparent 1px 9px);--hue1:232,196,150;--hue2:120,170,255;--hue3:255,140,220}
.lyt-stage[data-tier="tier4"] .lyt-card::before{content:"";position:absolute;inset:-6%;border-radius:2em;background:radial-gradient(60% 60% at 50% 50%,rgba(150,110,230,.32),transparent 70%);filter:blur(18px);transform:translateZ(-12px);pointer-events:none;animation:lytAura 6s ease-in-out infinite}

/* ---- list badge ---- */
.lyt-badge{display:inline-flex;align-items:center;gap:.35rem;max-width:100%;min-width:0;padding:.18rem .6rem .18rem .45rem;border-radius:99px;font-size:11px;font-weight:600;line-height:1.4;border:1px solid var(--b-rim)}
.lyt-badge.is-sm{font-size:10px;padding:.1rem .5rem .1rem .35rem}
.lyt-badge[data-tier="tier1"]{--b-rim:rgba(190,202,218,.35);background:linear-gradient(135deg,#323943,#1c2027);color:#dde4ee}
.lyt-badge[data-tier="tier2"]{--b-rim:rgba(255,255,255,.7);background:linear-gradient(135deg,#eef1f5,#a5afbd);color:#18202e}
.lyt-badge[data-tier="tier3"]{--b-rim:rgba(255,243,200,.7);background:linear-gradient(135deg,#f8e19a,#c99a2e);color:#3b2806}
.lyt-badge[data-tier="tier4"]{--b-rim:rgba(236,200,155,.7);background:linear-gradient(135deg,#40306c,#0b0818);color:#f6e8d0}

/* ---- promotion unlock: once, only when the server says a real promotion just happened ---- */
.lyt-stage[data-celebrate="true"] .lyt-card{animation:lytUnlock 1.3s cubic-bezier(.2,.9,.25,1.04) both}
.lyt-spark{position:absolute;inset:0;pointer-events:none;transform:translateZ(60px)}
.lyt-spark i{position:absolute;left:50%;top:50%;width:.5em;height:.5em;border-radius:50%;background:var(--rim);box-shadow:0 0 .8em var(--glow);opacity:0;animation:lytSpark 1.4s ease-out both;animation-delay:calc(var(--i) * 70ms + 250ms);--a:calc(var(--i) * 60deg)}
@keyframes lytUnlock{0%{transform:scale(.9) rotateY(-70deg);filter:brightness(.6)}55%{transform:scale(1.04) rotateY(8deg);filter:brightness(1.35)}100%{transform:none;filter:none}}
@keyframes lytSpark{0%{opacity:0;transform:rotate(var(--a)) translateX(0) scale(.4)}25%{opacity:1}100%{opacity:0;transform:rotate(var(--a)) translateX(11em) scale(1)}}
@keyframes lytFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes lytShadow{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(.9);opacity:.65}}
@keyframes lytSweep{0%,62%{transform:translateX(-130%)}85%,100%{transform:translateX(130%)}}
@keyframes lytAura{0%,100%{opacity:.6}50%{opacity:1}}
@media (prefers-reduced-motion: reduce){
  .lyt-stage *,.lyt-stage .lyt-card,.lyt-stage .lyt-card::before{animation:none!important}
  .lyt-tilt,.lyt-fill{transition:none!important}
  .lyt-spark{display:none}
  .lyt-sweep{display:none}
}
`;
