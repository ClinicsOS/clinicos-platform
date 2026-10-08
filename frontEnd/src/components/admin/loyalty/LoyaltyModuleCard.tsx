"use client";
import { useRef, type PointerEvent } from "react";
import {
  IconDiamond,
  IconLock,
  IconLockOpen,
  IconNfc,
  IconPlayerPause,
} from "@tabler/icons-react";

/**
 * ClinicOS Loyalty — module card (visual identity, Phase 1).
 *
 * A premium, layered 3D card built ONLY from CSS transforms (no Three.js, no new dependency):
 *   perspective + preserve-3d, a thickness edge, translateZ parallax layers, a pointer-driven
 *   light sheen, a slow idle float and an occasional light sweep.
 *
 * It is purely PRESENTATIONAL. It never decides or fakes entitlement: the parent passes the
 * state that the SERVER reported, and `fx` is set by the parent only AFTER a successful server
 * response. Later phases (patient card, tiers…) can reuse the same material language.
 *
 * Accessibility / performance:
 *   - decorative: aria-hidden (the real status is text elsewhere on the page)
 *   - animates only transform / opacity (GPU friendly); pointer tilt writes CSS variables
 *     directly (no React re-render per mouse move)
 *   - respects prefers-reduced-motion (CSS) and disables tilt for touch / reduced motion
 */

export type LoyaltyVisualState = "inactive" | "active" | "suspended" | "cancelled" | "hold";
export type LoyaltyFx = "unlock" | "reactivate" | "suspend" | "cancel" | null;

const STATE_LABEL: Record<LoyaltyVisualState, string> = {
  inactive: "LOCKED",
  active: "ACTIVE",
  suspended: "SUSPENDED",
  cancelled: "CANCELLED",
  hold: "ON HOLD",
};

// Deterministic spark positions (no Math.random → no hydration/render churn).
const SPARKS = [8, 17, 26, 35, 44, 52, 60, 68, 76, 84, 92, 21, 57, 79];

export default function LoyaltyModuleCard({
  state,
  fx,
  clinicName,
}: {
  state: LoyaltyVisualState;
  fx: LoyaltyFx;
  clinicName: string;
}) {
  const tiltRef = useRef<HTMLDivElement>(null);

  const reduced = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    // Hover tilt is a mouse-only flourish; touch and reduced-motion users get a calm static card.
    if (e.pointerType !== "mouse" || reduced()) return;
    const el = tiltRef.current;
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
  const onLeave = () => {
    const el = tiltRef.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--mx", "30%");
    el.style.setProperty("--my", "20%");
  };

  return (
    <div className="lyl-stage" aria-hidden="true" onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className="lyl-float">
        <div ref={tiltRef} className="lyl-tilt">
          <div className={`lyl-spin ${fx ? `lyl-fx-${fx}` : ""}`}>
            <div className={`lyl-card is-${state}`}>
              {/* thickness of the card edge */}
              <div className="lyl-edge" />

              {/* flat, clipped material stack */}
              <div className="lyl-clip">
                <div className="lyl-face lyl-face-locked" />
                <div className="lyl-face lyl-face-hold" />
                <div className="lyl-face lyl-face-gold" />
                <div className="lyl-grain" />
                <svg className="lyl-orbit" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth=".7">
                  <circle cx="100" cy="100" r="96" />
                  <circle cx="100" cy="100" r="80" />
                  <circle cx="100" cy="100" r="64" strokeDasharray="1.5 4" />
                  <circle cx="100" cy="100" r="48" />
                  <path d="M100 4A96 96 0 0 1 196 100" strokeWidth="1.8" />
                </svg>
                <div className="lyl-sheen" />
                <div className="lyl-sweep" />
              </div>

              {/* content floats above the material (parallax on tilt) */}
              <div className="lyl-content">
                <div className="lyl-top">
                  <span className="lyl-mark">
                    <IconDiamond size={16} stroke={1.6} />
                  </span>
                  <span className="lyl-brand">
                    <b>CLINICOS</b>
                    <i>PAID ADD-ON</i>
                  </span>
                </div>
                <div className="lyl-title">Loyalty</div>
                <div className="lyl-bottom">
                  <span className="lyl-clinic">{clinicName}</span>
                  <span className="lyl-state">
                    <IconNfc size={14} stroke={1.6} />
                    {STATE_LABEL[state]}
                  </span>
                </div>
              </div>

              {/* lock / pause glyphs — crossfade by state, animated by fx */}
              <div className="lyl-lockwrap">
                <span className="lyl-ic lyl-ic-lock">
                  <IconLock size={34} stroke={1.5} />
                </span>
                <span className="lyl-ic lyl-ic-open">
                  <IconLockOpen size={34} stroke={1.5} />
                </span>
                <span className="lyl-ic lyl-ic-pause">
                  <IconPlayerPause size={34} stroke={1.5} />
                </span>
              </div>

              <div className="lyl-sparks">
                {SPARKS.map((left, i) => (
                  <span key={i} style={{ left: `${left}%`, animationDelay: `${0.75 + (i % 5) * 0.09}s` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="lyl-shadow" />
    </div>
  );
}

/**
 * Styles for the whole Loyalty admin experience (card + section + modals).
 * Rendered once by the section. Scoped by the `lyl-` prefix so nothing can leak into the
 * rest of the app, and kept out of globals.css so this phase doesn't touch shared styling.
 */
export function LoyaltyStyles() {
  return <style>{CSS}</style>;
}

const CSS = `
.lyl-stage{position:relative;width:100%;max-width:400px;margin:0 auto;perspective:1100px;container-type:inline-size}
.lyl-float{animation:lylFloat 7s ease-in-out infinite}
.lyl-tilt{--rx:0deg;--ry:0deg;--mx:30%;--my:20%;transform:rotateX(var(--rx)) rotateY(var(--ry));transform-style:preserve-3d;transition:transform .28s ease-out;will-change:transform}
.lyl-spin{transform-style:preserve-3d}
.lyl-card{position:relative;aspect-ratio:1.58/1;font-size:14px;font-size:4.1cqw;border-radius:1.7em;transform-style:preserve-3d;color:#f1e3bf}
.lyl-edge{position:absolute;inset:0;border-radius:1.7em;background:#6b5420;transform:translateZ(-7px);box-shadow:0 .8em 2.2em rgba(0,0,0,.55)}
.lyl-clip{position:absolute;inset:0;border-radius:1.7em;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(236,208,138,.28),inset 0 1px 0 rgba(255,255,255,.14)}
.lyl-face{position:absolute;inset:0;transition:opacity .9s ease}
.lyl-face-locked{background:radial-gradient(130% 100% at 15% 0%,#2c2823 0%,#15130f 50%,#090807 100%);opacity:1}
.lyl-face-hold{background:linear-gradient(135deg,#4c3a1a 0%,#2a2010 55%,#14100a 100%);opacity:0}
.lyl-face-gold{background:linear-gradient(118deg,#fbeec7 0%,#dcb768 20%,#f6e2a8 36%,#b98a38 56%,#f1d58f 74%,#c89a47 90%,#ecd08a 100%);opacity:0}
.lyl-card.is-active .lyl-face-gold{opacity:1}
.lyl-card.is-suspended .lyl-face-hold,.lyl-card.is-hold .lyl-face-hold{opacity:1}
.lyl-card.is-active{color:#3a280a}
.lyl-card.is-cancelled .lyl-clip{filter:saturate(.35) brightness(.85)}
.lyl-grain{position:absolute;inset:0;opacity:.08;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E")}
.lyl-orbit{position:absolute;right:-18%;top:-34%;width:92%;aspect-ratio:1;opacity:.35;color:currentColor}
.lyl-sheen{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at var(--mx,30%) var(--my,20%),rgba(255,255,255,.55),rgba(255,255,255,0) 46%);mix-blend-mode:soft-light}
.lyl-card:not(.is-active) .lyl-sheen{background:radial-gradient(circle at var(--mx,30%) var(--my,20%),rgba(255,226,160,.4),rgba(255,226,160,0) 44%);mix-blend-mode:screen;opacity:.6}
.lyl-sweep{position:absolute;inset:-20%;pointer-events:none;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.8) 50%,transparent 60%);mix-blend-mode:overlay;transform:translateX(-130%)}
.lyl-card.is-active .lyl-sweep{animation:lylSweepIdle 8s ease-in-out 1.5s infinite}
.lyl-content{position:absolute;inset:0;padding:1.5em 1.7em;display:flex;flex-direction:column;justify-content:space-between;transform:translateZ(34px);transform-style:preserve-3d}
.lyl-top{display:flex;align-items:center;gap:.8em}
.lyl-mark{display:inline-flex;width:2.4em;height:2.4em;align-items:center;justify-content:center;border-radius:50%;border:1px solid currentColor;opacity:.85;transform:translateZ(10px)}
.lyl-mark svg{width:1.2em;height:1.2em}
.lyl-brand{display:flex;flex-direction:column;line-height:1.15}
.lyl-brand b{font-size:.92em;letter-spacing:.3em;font-weight:700}
.lyl-brand i{font-style:normal;font-size:.5em;letter-spacing:.28em;opacity:.7;margin-top:.35em;font-weight:600}
.lyl-title{font-family:Georgia,"Times New Roman",serif;font-size:3.5em;line-height:1;font-weight:500;letter-spacing:.02em;transform:translateZ(14px);text-shadow:0 .04em .2em rgba(0,0,0,.25)}
.lyl-bottom{display:flex;align-items:flex-end;justify-content:space-between;gap:1em;min-width:0}
.lyl-clinic{font-size:.8em;letter-spacing:.14em;font-weight:700;text-transform:uppercase;min-width:0;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.9}
.lyl-state{display:inline-flex;align-items:center;gap:.5em;font-size:.6em;letter-spacing:.24em;font-weight:800;white-space:nowrap;flex:none}
.lyl-state svg{width:1.5em;height:1.5em}
.lyl-lockwrap{position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-end;padding-right:2.6em;pointer-events:none;transform:translateZ(60px)}
.lyl-ic{position:absolute;display:flex;align-items:center;justify-content:center;width:3.4em;height:3.4em;border-radius:50%;background:rgba(10,8,5,.55);border:1px solid rgba(236,208,138,.45);color:#ecd08a;backdrop-filter:blur(4px);opacity:0;transform:scale(.8);transition:opacity .5s ease,transform .5s ease}
.lyl-ic svg{width:1.6em;height:1.6em}
.lyl-card.is-inactive .lyl-ic-lock,.lyl-card.is-cancelled .lyl-ic-lock{opacity:1;transform:scale(1)}
.lyl-card.is-suspended .lyl-ic-pause,.lyl-card.is-hold .lyl-ic-pause{opacity:1;transform:scale(1)}
.lyl-sparks{position:absolute;inset:0;pointer-events:none;transform:translateZ(70px)}
.lyl-sparks span{position:absolute;bottom:18%;width:.32em;height:.32em;border-radius:50%;background:#fff3c8;box-shadow:0 0 .8em .15em rgba(255,214,120,.85);opacity:0}
.lyl-shadow{width:72%;height:16px;margin:16px auto 0;border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,.65),transparent 70%);filter:blur(7px);animation:lylShadow 7s ease-in-out infinite}

/* ---- state-change choreography (only ever set AFTER the server confirms) ---- */
.lyl-fx-unlock{animation:lylSpin 1.7s cubic-bezier(.5,.05,.2,1) both}
.lyl-fx-unlock .lyl-face-gold{transition:opacity 1s ease .55s}
.lyl-fx-unlock .lyl-sweep{animation:lylSweep 1.15s ease .6s both}
.lyl-fx-unlock .lyl-ic-lock{opacity:1;transform:scale(1);animation:lylLockOut .8s ease .1s forwards}
.lyl-fx-unlock .lyl-ic-open{animation:lylOpenPop 1.5s ease .35s both}
.lyl-fx-unlock .lyl-sparks span{animation:lylSpark 1.7s ease-out both}
.lyl-fx-reactivate{animation:lylPulse 1.1s ease both}
.lyl-fx-reactivate .lyl-sweep{animation:lylSweep 1s ease .1s both}
.lyl-fx-reactivate .lyl-sparks span{animation:lylSpark 1.5s ease-out both}
.lyl-fx-suspend{animation:lylDip .9s ease both}
.lyl-fx-cancel{animation:lylDip .9s ease both}
.lyl-fx-cancel .lyl-ic-lock{animation:lylLockIn .7s cubic-bezier(.3,1.5,.5,1) .2s both}

@keyframes lylFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes lylShadow{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(.9);opacity:.65}}
@keyframes lylSweepIdle{0%,62%{transform:translateX(-130%)}85%,100%{transform:translateX(130%)}}
@keyframes lylSweep{from{transform:translateX(-130%)}to{transform:translateX(130%)}}
@keyframes lylSpin{0%{transform:rotateY(0) scale(1)}45%{transform:rotateY(200deg) scale(1.07)}100%{transform:rotateY(360deg) scale(1)}}
@keyframes lylPulse{0%{transform:scale(.97)}40%{transform:scale(1.04)}100%{transform:scale(1)}}
@keyframes lylDip{0%{transform:scale(1)}35%{transform:scale(.95)}100%{transform:scale(1)}}
@keyframes lylLockOut{0%{opacity:1;transform:scale(1) rotate(0)}100%{opacity:0;transform:scale(1.5) rotate(-18deg)}}
@keyframes lylOpenPop{0%{opacity:0;transform:scale(.6)}30%{opacity:1;transform:scale(1.12)}70%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(1.25)}}
@keyframes lylLockIn{0%{opacity:0;transform:scale(1.6)}100%{opacity:1;transform:scale(1)}}
@keyframes lylSpark{0%{opacity:0;transform:translateY(0) scale(.6)}15%{opacity:1}100%{opacity:0;transform:translateY(-4.5em) scale(1.1)}}

/* ---- section / modal choreography ---- */
.lyl-rise{animation:lylRise .7s cubic-bezier(.2,.7,.3,1) both}
.lyl-rise-2{animation:lylRise .7s cubic-bezier(.2,.7,.3,1) .12s both}
.lyl-rise-3{animation:lylRise .7s cubic-bezier(.2,.7,.3,1) .24s both}
.lyl-pop{animation:lylPop .5s cubic-bezier(.3,1.5,.5,1) both}
.lyl-overlay{animation:lylFade .2s ease both}
.lyl-modal{animation:lylModal .32s cubic-bezier(.2,.8,.3,1) both}
.lyl-toast{animation:lylToast .35s cubic-bezier(.2,.8,.3,1) both}
.lyl-shimmer{background:linear-gradient(100deg,rgba(255,255,255,.04) 30%,rgba(236,208,138,.14) 50%,rgba(255,255,255,.04) 70%);background-size:220% 100%;animation:lylShimmer 1.4s linear infinite}
.lyl-spinner{width:1em;height:1em;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:lylRot .7s linear infinite;display:inline-block}
.lyl-livedot{position:relative}
.lyl-livedot::after{content:"";position:absolute;inset:0;border-radius:50%;background:inherit;animation:lylPing 1.8s ease-out infinite}
@keyframes lylRise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes lylPop{from{opacity:0;transform:scale(.8)}to{opacity:1;transform:none}}
@keyframes lylFade{from{opacity:0}to{opacity:1}}
@keyframes lylModal{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}
@keyframes lylToast{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
@keyframes lylShimmer{from{background-position:120% 0}to{background-position:-120% 0}}
@keyframes lylRot{to{transform:rotate(360deg)}}
@keyframes lylPing{0%{transform:scale(1);opacity:.7}100%{transform:scale(2.6);opacity:0}}

@media (prefers-reduced-motion: reduce){
  .lyl-stage *,.lyl-rise,.lyl-rise-2,.lyl-rise-3,.lyl-pop,.lyl-overlay,.lyl-modal,.lyl-toast,.lyl-shimmer,.lyl-livedot::after,.lyl-shadow,.lyl-float{animation:none!important}
  .lyl-tilt,.lyl-face,.lyl-ic{transition:none!important}
  .lyl-sparks{display:none}
}
`;
