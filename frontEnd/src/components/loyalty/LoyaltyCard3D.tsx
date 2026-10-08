"use client";
import { useRef, type PointerEvent } from "react";
import { IconDiamond, IconNfc } from "@tabler/icons-react";
import { fmtNum, prefersReducedMotion } from "@/lib/loyalty";
import { TierStyles } from "./TierCard3D";

/**
 * ClinicOS Loyalty card — design-system preview (Phase 2).
 *
 * NOT the patient card: no NFC / QR behaviour, no tier (tier cards live in TierCard3D.tsx), no fake numbers. With a real member it shows that
 * member's REAL name and balance; without one it is an obvious placeholder (points shown as "—").
 *
 * Pure CSS 3D (perspective, preserve-3d, thickness edge, translateZ parallax, pointer-driven sheen, slow float,
 * occasional light sweep). Animates only transform/opacity; tilt is mouse-only; prefers-reduced-motion turns all
 * motion off. Decorative → aria-hidden (the same facts are available as text next to it).
 */
export default function LoyaltyCard3D({
  clinicName,
  programName,
  memberName,
  balance,
  since,
  labels,
  tilt = true,
  figure,
  caption,
  badge,
}: {
  clinicName: string;
  programName?: string | null;
  memberName?: string | null;
  /** Real balance, or null/undefined for the placeholder state. */
  balance?: number | null;
  since?: string | null;
  labels: { points: string; preview: string; memberPlaceholder: string; since: string };
  tilt?: boolean;
  /** Phase 8 — a real program-level figure (e.g. points in circulation) for the member-less hero card; the caption / badge replace the placeholder texts. */
  figure?: number | null;
  caption?: string | null;
  badge?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isMember = balance !== null && balance !== undefined && !!memberName;
  const hasFigure = !isMember && figure !== undefined && figure !== null;
  const filled = isMember || hasFigure;

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!tilt || e.pointerType !== "mouse" || prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    el.style.setProperty("--rx", `${((0.5 - py) * 14).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${((px - 0.5) * 18).toFixed(2)}deg`);
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
    <div className="lyc-stage" aria-hidden="true" onPointerMove={move} onPointerLeave={leave}>
      <div className="lyc-float">
        <div ref={ref} className="lyc-tilt">
          <div className={`lyc-card ${filled ? "is-member" : "is-preview"}`} dir="ltr">
            <div className="lyc-edge" />
            <div className="lyc-clip">
              <div className="lyc-face" />
              <div className="lyc-grain" />
              <svg className="lyc-orbit" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth=".7">
                <circle cx="100" cy="100" r="96" />
                <circle cx="100" cy="100" r="80" />
                <circle cx="100" cy="100" r="64" strokeDasharray="1.5 4" />
                <circle cx="100" cy="100" r="48" />
                <path d="M100 4A96 96 0 0 1 196 100" strokeWidth="1.8" />
              </svg>
              <div className="lyc-sheen" />
              <div className="lyc-sweep" />
            </div>
            <div className="lyc-content">
              <div className="lyc-top">
                <span className="lyc-mark">
                  <IconDiamond size={16} stroke={1.6} />
                </span>
                <span className="lyc-brand">
                  <b>{(programName || clinicName).toUpperCase()}</b>
                  <i>CLINICOS LOYALTY</i>
                </span>
                {badge ? <span className="lyc-chip">{badge}</span> : !filled && <span className="lyc-chip">{labels.preview}</span>}
              </div>
              <div className="lyc-pts">
                <small>{labels.points}</small>
                <b className={filled ? "" : "is-empty"}>{isMember ? fmtNum(balance as number) : hasFigure ? fmtNum(figure as number) : "—"}</b>
              </div>
              <div className="lyc-bottom">
                <span className={`lyc-name ${filled ? "" : "is-ghost"}`}>{isMember ? memberName : caption ?? labels.memberPlaceholder}</span>
                <span className="lyc-since">
                  {isMember && since ? (
                    <>
                      {labels.since} {since}
                    </>
                  ) : (
                    <IconNfc size={16} stroke={1.5} />
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="lyc-shadow" />
    </div>
  );
}

/**
 * Scoped styles for the whole clinic Loyalty area (`lyc-` prefix; nothing leaks into the rest of the app and
 * globals.css stays untouched). Rendered once by the Loyalty page.
 */
export function LoyaltyStyles() {
  return (
    <>
      <style>{CSS}</style>
      <TierStyles />
    </>
  );
}

const CSS = `
.lyc-stage{position:relative;width:100%;max-width:380px;margin:0 auto;perspective:1100px;container-type:inline-size}
.lyc-float{animation:lycFloat 7s ease-in-out infinite}
.lyc-tilt{--rx:0deg;--ry:0deg;--mx:28%;--my:18%;transform:rotateX(var(--rx)) rotateY(var(--ry));transform-style:preserve-3d;transition:transform .28s ease-out;will-change:transform}
.lyc-card{position:relative;aspect-ratio:1.58/1;font-size:14px;font-size:4.1cqw;border-radius:1.7em;transform-style:preserve-3d;color:#f1e3bf}
.lyc-edge{position:absolute;inset:0;border-radius:1.7em;background:#5e4a1c;transform:translateZ(-7px);box-shadow:0 .9em 2.4em rgba(0,0,0,.55)}
.lyc-clip{position:absolute;inset:0;border-radius:1.7em;overflow:hidden;box-shadow:inset 0 0 0 1.5px rgba(236,208,138,.5),inset 0 1px 0 rgba(255,255,255,.2),0 0 0 1px rgba(236,208,138,.14),0 0 2.2em rgba(236,208,138,.1)}
.lyc-clip::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(115deg,rgba(255,255,255,.07),transparent 32%,transparent 62%,rgba(236,208,138,.2))}
.lyc-face{position:absolute;inset:0;background:radial-gradient(130% 100% at 12% 0%,#4a443a 0%,#25221b 50%,#12100c 100%)}
.lyc-card.is-preview .lyc-face{background:radial-gradient(130% 100% at 12% 0%,#3d4452 0%,#20242c 52%,#0f1116 100%)}
.lyc-grain{position:absolute;inset:0;opacity:.08;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E")}
.lyc-orbit{position:absolute;inset-inline-end:-18%;top:-34%;width:92%;aspect-ratio:1;opacity:.28;color:#ecd08a}
.lyc-sheen{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at var(--mx,28%) var(--my,18%),rgba(255,226,160,.42),rgba(255,226,160,0) 46%);mix-blend-mode:screen;opacity:.65}
.lyc-sweep{position:absolute;inset:-20%;pointer-events:none;background:linear-gradient(105deg,transparent 40%,rgba(255,236,190,.55) 50%,transparent 60%);mix-blend-mode:screen;transform:translateX(-130%);animation:lycSweep 9s ease-in-out 1.4s infinite}
.lyc-content{position:absolute;inset:0;padding:1.5em 1.7em;display:flex;flex-direction:column;justify-content:space-between;transform:translateZ(34px);transform-style:preserve-3d}
.lyc-top{display:flex;align-items:center;gap:.8em;min-width:0}
.lyc-mark{display:inline-flex;flex:none;width:2.4em;height:2.4em;align-items:center;justify-content:center;border-radius:50%;border:1px solid rgba(236,208,138,.7);color:#ecd08a;transform:translateZ(10px)}
.lyc-mark svg{width:1.2em;height:1.2em}
.lyc-brand{display:flex;flex-direction:column;line-height:1.15;min-width:0;flex:1}
.lyc-brand b{font-size:.86em;letter-spacing:.2em;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#f6e6bd}
.lyc-brand i{font-style:normal;font-size:.48em;letter-spacing:.28em;opacity:.65;margin-top:.35em;font-weight:600}
.lyc-chip{flex:none;font-size:.5em;letter-spacing:.2em;font-weight:800;padding:.5em 1em;border-radius:99px;border:1px solid rgba(236,208,138,.45);color:#ecd08a;background:rgba(236,208,138,.08)}
.lyc-pts{transform:translateZ(14px)}
.lyc-pts small{display:block;font-size:.55em;letter-spacing:.32em;font-weight:700;opacity:.65;margin-bottom:.1em}
.lyc-pts b{display:block;font-family:Georgia,"Times New Roman",serif;font-size:3.6em;line-height:1;font-weight:500;letter-spacing:.01em;text-shadow:0 .04em .2em rgba(0,0,0,.35);font-feature-settings:"lnum" 1,"tnum" 1}
.lyc-pts b.is-empty{opacity:.35}
.lyc-bottom{display:flex;align-items:flex-end;justify-content:space-between;gap:1em;min-width:0}
.lyc-name{font-size:.82em;letter-spacing:.14em;font-weight:700;text-transform:uppercase;min-width:0;max-width:68%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lyc-name.is-ghost{opacity:.35}
.lyc-since{flex:none;font-size:.55em;letter-spacing:.18em;font-weight:700;opacity:.7;display:inline-flex;align-items:center;gap:.4em}
.lyc-shadow{width:72%;height:16px;margin:16px auto 0;border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,.6),transparent 70%);filter:blur(7px);animation:lycShadow 7s ease-in-out infinite}

/* ---- page choreography ---- */
.lyc-rise{animation:lycRise .65s cubic-bezier(.2,.7,.3,1) both}
.lyc-tabin{animation:lycTab .45s cubic-bezier(.2,.8,.3,1) both}
.lyc-row{animation:lycRow .5s cubic-bezier(.2,.8,.3,1) both;animation-delay:calc(var(--i,0)*45ms)}
.lyc-pop{animation:lycPop .45s cubic-bezier(.3,1.5,.5,1) both}
.lyc-fade{animation:lycFade .25s ease both}
.lyc-sheet{animation:lycSlide .38s cubic-bezier(.2,.8,.3,1) both}
[dir="rtl"] .lyc-sheet{animation-name:lycSlideRtl}
.lyc-toast{animation:lycToast .35s cubic-bezier(.2,.8,.3,1) both}
.lyc-shimmer{background:linear-gradient(100deg,rgba(255,255,255,.04) 30%,rgba(236,208,138,.14) 50%,rgba(255,255,255,.04) 70%);background-size:220% 100%;animation:lycShimmer 1.4s linear infinite}
.lyc-spinner{width:1em;height:1em;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:lycRot .7s linear infinite;display:inline-block}
.lyc-glass{background:linear-gradient(145deg,rgba(236,208,138,.14),rgba(236,208,138,.03));border:1px solid rgba(236,208,138,.28);box-shadow:0 .9rem 2rem -1rem rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.12);backdrop-filter:blur(6px)}
.lyc-tile{transform-style:preserve-3d;transition:transform .35s cubic-bezier(.2,.8,.3,1),box-shadow .35s}
.lyc-tile:hover{transform:translateY(-3px) rotateX(3deg)}
.lyc-emptyfloat{animation:lycFloat 6s ease-in-out infinite}
.lyc-burst{animation:lycBurst .7s cubic-bezier(.2,1.4,.4,1) both}
.lyc-ring{position:absolute;inset:-2px;border-radius:50%;border:1.5px solid rgba(236,208,138,.7);animation:lycRingOut 1.5s ease-out infinite}
.lyc-ring2{animation-delay:.5s}
@keyframes lycBurst{from{opacity:0;transform:scale(.4) rotate(-20deg)}to{opacity:1;transform:none}}
@keyframes lycRingOut{0%{transform:scale(1);opacity:.8}100%{transform:scale(2.3);opacity:0}}
@keyframes lycFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes lycShadow{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(.9);opacity:.65}}
@keyframes lycSweep{0%,62%{transform:translateX(-130%)}85%,100%{transform:translateX(130%)}}
@keyframes lycRise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes lycTab{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes lycRow{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes lycPop{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:none}}
@keyframes lycFade{from{opacity:0}to{opacity:1}}
@keyframes lycSlide{from{opacity:.6;transform:translateX(40px)}to{opacity:1;transform:none}}
@keyframes lycSlideRtl{from{opacity:.6;transform:translateX(-40px)}to{opacity:1;transform:none}}
@keyframes lycToast{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
@keyframes lycShimmer{from{background-position:120% 0}to{background-position:-120% 0}}
@keyframes lycRot{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){
  .lyc-ring,.lyc-burst,.lyc-stage *,.lyc-rise,.lyc-tabin,.lyc-row,.lyc-pop,.lyc-fade,.lyc-sheet,.lyc-toast,.lyc-shimmer,.lyc-emptyfloat,.lyc-shadow{animation:none!important}
  .lyc-tilt,.lyc-tile{transition:none!important}
}
`;
