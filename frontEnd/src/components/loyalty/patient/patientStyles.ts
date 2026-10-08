/**
 * ClinicOS Loyalty — PATIENT app styles, part 1: tokens, shell, navigation, transitions, safe areas, shared primitives (Phase 9).
 * Everything is scoped under `.pw-root`. No images, no fonts: every surface is gradients, SVG data-URIs (procedural noise) and CSS 3D.
 *
 *  Light system: ONE virtual light, upper-left, used by the card, the reward tickets and the atmosphere (--pw-lx/--pw-ly = its rest position).
 *  Mobile first: 320px+ without horizontal scroll, safe-area insets on every edge, 44px+ touch targets, spatial centred column on tablet/desktop.
 *  Motion vocabulary: --pw-micro 150ms · --pw-nav 280ms · --pw-feature 560ms · --pw-cine 1800ms.
 */
export const PW_BASE_CSS = `
.pw-root{
  --pw-bg0:#05060a;--pw-bg1:#0a0c12;--pw-bg2:#10131b;--pw-ink:#f6efe0;--pw-ink2:#c4b99f;--pw-mute:#9a907a;
  --pw-gold:#e8c76a;--pw-gold2:#b98a38;--pw-rose:#e68a9c;--pw-mint:#6fd6b0;--pw-silver:#cdd6e4;--pw-amber:#f0c36a;
  --pw-line:rgba(232,199,106,.22);--pw-line2:rgba(255,255,255,.1);
  --pw-micro:150ms;--pw-nav:280ms;--pw-feature:560ms;--pw-cine:1800ms;
  --pw-out:cubic-bezier(.2,.8,.2,1);--pw-spring:cubic-bezier(.3,1.35,.5,1);
  --pw-lx:30%;--pw-ly:18%;
  --accent:232,199,106;
  --sat:env(safe-area-inset-top,0px);--sab:env(safe-area-inset-bottom,0px);--sal:env(safe-area-inset-left,0px);--sar:env(safe-area-inset-right,0px);
  --nav-h:68px;
  position:fixed;inset:0;z-index:5;overflow:hidden;color:var(--pw-ink);background:var(--pw-bg0);
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Arabic","Noto Naskh Arabic",Tahoma,sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;-webkit-tap-highlight-color:transparent;
  overscroll-behavior:none;
}
.pw-root *{box-sizing:border-box}
:where(.pw-root) button{font:inherit;color:inherit;-webkit-tap-highlight-color:transparent}
.pw-root :focus-visible{outline:2px solid var(--pw-gold);outline-offset:3px;border-radius:10px}
.pw-root .pw-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.pw-serif{font-family:Georgia,"Times New Roman","Noto Naskh Arabic",serif}
.pw-num{font-variant-numeric:lining-nums tabular-nums;font-feature-settings:"lnum" 1,"tnum" 1}

/* ===== atmosphere (behind everything; never competes with content) ===== */
.pw-atmo{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0}
.pw-atmo-base{position:absolute;inset:0;background:
  radial-gradient(70% 46% at 78% -6%,rgba(var(--accent),.26),transparent 62%),
  radial-gradient(60% 40% at -8% 104%,rgba(96,128,196,.17),transparent 62%),
  radial-gradient(50% 30% at 50% 58%,rgba(var(--accent),.06),transparent 70%),
  linear-gradient(180deg,#07080d,#0a0c13 55%,#05060a)}
.pw-atmo-aurora{position:absolute;inset:-30%;background:conic-gradient(from 200deg at 50% 50%,rgba(var(--accent),0),rgba(var(--accent),.13),rgba(120,150,230,.08),rgba(var(--accent),0) 70%);filter:blur(60px);animation:pwAurora 46s linear infinite}
.pw-atmo canvas{position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 1.2s ease}
.pw-atmo .is-live canvas{opacity:1}
.pw-root[data-pw-mode="lite"] .pw-atmo-aurora,.pw-root[data-pw-mode="static"] .pw-atmo-aurora{animation:none;filter:blur(40px);opacity:.7}
.pw-grain{position:absolute;inset:0;opacity:.06;mix-blend-mode:overlay;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .7 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}

/* ===== the column: a phone-width spatial stage; centred (never stretched) on tablet / desktop ===== */
.pw-stage{position:absolute;inset:0;z-index:1;display:flex;justify-content:center}
.pw-col{position:relative;width:100%;max-width:480px;height:100%;display:flex;flex-direction:column;min-width:0}
@media (min-width:700px){
  .pw-col{max-width:440px;margin:max(18px,3vh) 0;height:auto;border-radius:34px;border:1px solid rgba(255,255,255,.1);
    background:linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.01));box-shadow:0 50px 120px -40px rgba(0,0,0,.9),0 0 0 1px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.08);overflow:hidden}
  .pw-root{--nav-h:72px}
  .pw-side{display:block}
}
.pw-side{display:none}

/* ===== top bar ===== */
.pw-top{flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:calc(56px + var(--sat));padding:calc(8px + var(--sat)) calc(16px + var(--sar)) 6px calc(16px + var(--sal));z-index:4}
.pw-brand{display:flex;align-items:center;gap:10px;min-width:0}
.pw-brand img,.pw-mono{flex:none;width:34px;height:34px;border-radius:50%;object-fit:cover;border:1px solid rgba(var(--accent),.6);background:rgba(0,0,0,.4)}
.pw-mono{display:inline-flex;align-items:center;justify-content:center;font-family:Georgia,serif;color:rgb(var(--accent));font-size:15px}
.pw-brand-txt{display:flex;flex-direction:column;min-width:0;line-height:1.15}
.pw-brand-name{font-size:13.5px;font-weight:650;letter-spacing:.03em;color:#f1e6c9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pw-brand-sub{font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--pw-mute);white-space:nowrap}
.pw-lang{flex:none;display:inline-flex;border:1px solid var(--pw-line2);border-radius:999px;overflow:hidden;background:rgba(255,255,255,.04)}
.pw-lang button{min-height:44px;min-width:46px;padding:0 12px;font-size:12px;font-weight:650;color:#b9ad8f;background:transparent;border:0;cursor:pointer;transition:background var(--pw-micro),color var(--pw-micro),transform var(--pw-micro)}
.pw-lang button:active{transform:scale(.94)}
.pw-lang button[aria-pressed="true"]{background:rgba(var(--accent),.92);color:#2a1d06}

/* ===== screens (depth transitions between Home / Rewards / Activity / Card) ===== */
.pw-screens{position:relative;flex:1;min-height:0;z-index:2;perspective:1200px}
.pw-screen{position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;overscroll-behavior-y:contain;scrollbar-width:none;
  padding:6px calc(16px + var(--sar)) calc(var(--nav-h) + var(--sab) + 28px) calc(16px + var(--sal))}
.pw-screen::-webkit-scrollbar{display:none}
.pw-screen.is-in{animation:pwIn var(--pw-nav) var(--pw-out) both}
.pw-screen.is-in[data-dir="back"]{animation-name:pwInBack}
.pw-screen.is-out{pointer-events:none;animation:pwOut var(--pw-nav) var(--pw-out) both}
.pw-screen.is-out[data-dir="back"]{animation-name:pwOutBack}
@keyframes pwIn{from{opacity:0;transform:translate3d(0,14px,-60px) scale(.985)}to{opacity:1;transform:none}}
@keyframes pwInBack{from{opacity:0;transform:translate3d(0,14px,-60px) scale(.985)}to{opacity:1;transform:none}}
@keyframes pwOut{from{opacity:1;transform:none}to{opacity:0;transform:translate3d(0,0,-90px) scale(.97)}}
@keyframes pwOutBack{from{opacity:1;transform:none}to{opacity:0;transform:translate3d(0,0,-90px) scale(.97)}}
.pw-root[data-pw-mode="static"] .pw-screen.is-in{animation:pwFade var(--pw-nav) ease both}
.pw-root[data-pw-mode="static"] .pw-screen.is-out{animation:pwFadeOut var(--pw-nav) ease both}
@keyframes pwFade{from{opacity:0}to{opacity:1}}
@keyframes pwFadeOut{from{opacity:1}to{opacity:0}}
/* the content recedes while a reward / card focus sheet is open */
.pw-screens.is-receded{transform:scale(.95) translateZ(-40px);filter:blur(5px) saturate(.8);opacity:.55;transition:transform var(--pw-nav) var(--pw-out),filter var(--pw-nav),opacity var(--pw-nav);pointer-events:none}
.pw-screens{transition:transform var(--pw-nav) var(--pw-out),filter var(--pw-nav),opacity var(--pw-nav)}

/* ===== bottom navigation ===== */
.pw-nav{position:absolute;left:0;right:0;bottom:0;z-index:6;display:flex;justify-content:center;padding:0 calc(14px + var(--sar)) calc(10px + var(--sab)) calc(14px + var(--sal));pointer-events:none}
.pw-nav-in{pointer-events:auto;position:relative;display:grid;grid-template-columns:repeat(4,1fr);width:100%;max-width:440px;height:var(--nav-h);padding:6px;border-radius:26px;
  background:linear-gradient(180deg,rgba(30,33,44,.82),rgba(14,16,23,.9));backdrop-filter:blur(18px) saturate(1.3);-webkit-backdrop-filter:blur(18px) saturate(1.3);
  border:1px solid rgba(255,255,255,.12);box-shadow:0 20px 40px -18px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,255,255,.12)}
.pw-nav-pill{position:absolute;top:6px;bottom:6px;width:calc((100% - 12px) / 4);inset-inline-start:6px;border-radius:20px;
  background:linear-gradient(145deg,rgba(var(--accent),.30),rgba(var(--accent),.08));border:1px solid rgba(var(--accent),.5);box-shadow:0 8px 20px -10px rgba(var(--accent),.7),inset 0 1px 0 rgba(255,255,255,.2);
  transform:translateX(calc(var(--i,0) * 100%));transition:transform var(--pw-feature) var(--pw-spring)}
[dir="rtl"] .pw-nav-pill{transform:translateX(calc(var(--i,0) * -100%))}
.pw-nav-btn{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:44px;background:none;border:0;cursor:pointer;color:var(--pw-mute);font-size:10.5px;font-weight:650;letter-spacing:.04em;transition:color var(--pw-micro),transform var(--pw-micro) var(--pw-spring)}
.pw-nav-btn svg{transition:transform var(--pw-feature) var(--pw-spring)}
.pw-nav-btn:active{transform:scale(.9)}
.pw-nav-btn[aria-current="page"]{color:#fff3cf}
.pw-nav-btn[aria-current="page"] svg{transform:translateY(-1px) scale(1.12)}
.pw-nav-dot{position:absolute;top:5px;inset-inline-end:calc(50% - 20px);width:9px;height:9px;border-radius:50%;background:var(--pw-amber);box-shadow:0 0 0 2px rgba(10,12,18,.95),0 0 10px rgba(240,195,106,.9)}

/* ===== shared primitives ===== */
.pw-panel{position:relative;border-radius:22px;padding:16px;background:linear-gradient(150deg,rgba(255,255,255,.075),rgba(255,255,255,.02));border:1px solid var(--pw-line2);
  box-shadow:0 22px 44px -26px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.09)}
.pw-panel.is-solid{background:linear-gradient(150deg,#161923,#0e1118)}
.pw-h{display:flex;align-items:center;gap:8px;margin:0 2px 10px;font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:rgb(var(--accent));font-weight:700}
.pw-h span.pw-h-end{margin-inline-start:auto;font-size:12px;letter-spacing:0;text-transform:none;font-weight:500;color:var(--pw-mute)}
.pw-title{font-family:Georgia,"Times New Roman","Noto Naskh Arabic",serif;font-weight:500;font-size:28px;line-height:1.15;margin:4px 2px 4px;color:#fbf0d2;overflow-wrap:anywhere}
.pw-sub{font-size:14px;line-height:1.6;color:#a9a08a;margin:0 2px 14px;overflow-wrap:anywhere}
.pw-btn{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:52px;padding:0 22px;border:0;border-radius:16px;font-size:15.5px;font-weight:700;letter-spacing:.03em;color:#2a1d06;cursor:pointer;
  background:linear-gradient(120deg,#f6e2a8,rgb(var(--accent)) 46%,#b98a38);box-shadow:0 14px 28px -12px rgba(var(--accent),.7),inset 0 1px 0 rgba(255,255,255,.55),inset 0 -2px 0 rgba(0,0,0,.18);
  transition:transform var(--pw-micro) var(--pw-spring),box-shadow var(--pw-micro),filter var(--pw-micro)}
.pw-btn:active:not(:disabled){transform:translateY(1px) scale(.975);box-shadow:0 6px 14px -8px rgba(var(--accent),.7),inset 0 1px 0 rgba(255,255,255,.4),inset 0 -1px 0 rgba(0,0,0,.2)}
.pw-btn:disabled{filter:saturate(.45) brightness(.8);cursor:not-allowed}
.pw-btn.is-block{display:flex;width:100%}
.pw-btn::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 38%,rgba(255,255,255,.4) 50%,transparent 62%);transform:translateX(-130%);pointer-events:none}
.pw-root[data-pw-mode="full"] .pw-btn.is-shine::after{animation:pwSheen 4.6s ease-in-out 1.4s infinite}
.pw-ghost{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border-radius:14px;font-size:14px;font-weight:650;color:#f3e3b5;background:rgba(255,255,255,.06);border:1px solid rgba(var(--accent),.38);cursor:pointer;transition:transform var(--pw-micro) var(--pw-spring),background var(--pw-micro)}
.pw-ghost:active{transform:scale(.96)}
.pw-link{min-height:44px;padding:0 14px;background:none;border:0;color:#b9ad8f;font-size:13px;text-decoration:underline;text-underline-offset:3px;cursor:pointer}
.pw-spin{width:17px;height:17px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;animation:pwRot .7s linear infinite;display:inline-block}
.pw-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:99px;font-size:11px;font-weight:700;letter-spacing:.04em;white-space:nowrap}
.pw-chip.is-wait{color:#f6dca0;background:rgba(240,195,106,.12);border:1px solid rgba(240,195,106,.32)}
.pw-chip.is-ok{color:#c8f5d9;background:rgba(111,214,176,.12);border:1px solid rgba(111,214,176,.32)}
.pw-chip.is-off{color:#d9c3c3;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14)}
.pw-chip.is-lock{color:#e6d9bd;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16)}
.pw-error{margin:10px 2px 0;font-size:13px;line-height:1.55;color:#ffb9b9}
.pw-error.is-soft{color:#f1dcab}
.pw-skel{background:linear-gradient(100deg,rgba(255,255,255,.04) 30%,rgba(255,255,255,.1) 50%,rgba(255,255,255,.04) 70%);background-size:220% 100%;animation:pwShimmer 1.4s linear infinite;border-radius:18px}
.pw-rise{animation:pwRise var(--pw-feature) var(--pw-out) both}
.pw-pop{animation:pwPop .42s var(--pw-spring) both}
.pw-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px;padding:26px 18px}
.pw-empty h3{margin:8px 0 0;font-size:16.5px;font-weight:650;color:#fbf0d2}
.pw-empty p{margin:0;font-size:13.5px;line-height:1.65;color:#a9a08a;max-width:30ch}
.pw-empty .pw-ico{width:64px;height:64px;border-radius:20px;display:inline-flex;align-items:center;justify-content:center;color:rgb(var(--accent));background:linear-gradient(145deg,rgba(var(--accent),.18),rgba(var(--accent),.04));border:1px solid rgba(var(--accent),.38);box-shadow:0 14px 28px -14px rgba(var(--accent),.6),inset 0 1px 0 rgba(255,255,255,.2);transform:perspective(300px) rotateX(14deg) rotateY(-12deg)}

/* ===== offline / connection ===== */
.pw-offline{position:relative;z-index:5;margin:0 calc(14px + var(--sar)) 4px calc(14px + var(--sal));display:flex;align-items:flex-start;gap:10px;padding:10px 14px;border-radius:16px;font-size:12.5px;line-height:1.5;color:#f6dca0;background:rgba(240,195,106,.1);border:1px solid rgba(240,195,106,.3);animation:pwRise var(--pw-nav) var(--pw-out) both}
.pw-offline svg{flex:none;margin-top:2px}

/* ===== loading: the card outline traces itself, content arrives behind it (never a bare spinner) ===== */
.pw-load{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;height:100%;padding:24px}
.pw-trace{position:relative;width:min(78vw,320px);aspect-ratio:1.586/1;border-radius:20px;border:1px solid rgba(255,255,255,.08);overflow:hidden;background:linear-gradient(145deg,rgba(255,255,255,.05),rgba(255,255,255,.01))}
.pw-trace::before{content:"";position:absolute;inset:-50%;background:conic-gradient(from 0deg,transparent 0 70%,rgba(var(--accent),.9) 85%,transparent 100%);animation:pwRot 2.4s linear infinite;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);padding:1.5px}
.pw-trace::after{content:"";position:absolute;inset:1.5px;border-radius:19px;background:linear-gradient(145deg,#0f1219,#080a0f)}
.pw-trace i{position:absolute;z-index:1;left:14px;right:14px;height:9px;border-radius:6px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.12),rgba(255,255,255,.05));background-size:200% 100%;animation:pwShimmer 1.4s linear infinite}
.pw-root[data-pw-mode="static"] .pw-trace::before{animation:none;opacity:.5}

/* ===== keyframes ===== */
@keyframes pwAurora{to{transform:rotate(360deg)}}
@keyframes pwRise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes pwPop{from{opacity:0;transform:scale(.9)}to{opacity:1;transform:none}}
@keyframes pwRot{to{transform:rotate(360deg)}}
@keyframes pwSheen{0%,55%{transform:translateX(-130%)}100%{transform:translateX(130%)}}
@keyframes pwShimmer{from{background-position:120% 0}to{background-position:-120% 0}}

/* ===== reduced motion: no parallax / loops / camera moves — calm fades only ===== */
@media (prefers-reduced-motion: reduce){
  .pw-atmo-aurora,.pw-btn::after,.pw-skel,.pw-spin,.pw-trace::before{animation:none!important}
  .pw-rise,.pw-pop,.pw-offline{animation:pwFade .3s ease both!important}
  .pw-nav-pill{transition:none}
  .pw-screens,.pw-screens.is-receded{transition:opacity .2s}
  .pw-screens.is-receded{transform:none;filter:none}
}
`;

/**
 * Part 2: the signature Loyalty Card — physical construction (slab thickness, front/back faces, edge), tier materials (procedural: gradients,
 * SVG-noise data-URIs, no bitmaps), embossed type, specular + brushed anisotropy, Fresnel-like rim, iridescence, holographic patch, light sweep.
 * Sized with container-query units (cqw) so it is identical at 320px and 430px. Critical text is never distorted: it only moves with the card.
 */
export const PW_CARD_CSS = `
.pc-scene{--lx:var(--pw-lx);--ly:var(--pw-ly);--rx:0deg;--ry:0deg;--ryn:0;--tilt:0;--flip:0deg;
  position:relative;width:100%;max-width:440px;margin:0 auto;aspect-ratio:1.586/1;container-type:inline-size;perspective:1150px;perspective-origin:50% 40%;
  touch-action:pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;--r:20px}
@supports (width:1cqw){.pc-scene{--r:5.2cqw}}
.pc-scene[data-touch="none"]{touch-action:none}
.pc-body{position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(var(--rx)) rotateY(calc(var(--ry) + var(--flip)));will-change:transform}
.pc-body.is-flipping{transition:transform .72s cubic-bezier(.3,1.22,.4,1)}
.pc-scene[data-mode="static"] .pc-body.is-flipping{transition:none}
.pc-slab{position:absolute;inset:0;border-radius:var(--r);background:var(--edge);transform:translateZ(var(--z));box-shadow:inset 0 0 0 .5px rgba(255,255,255,.18)}
.pc-face{position:absolute;inset:0;border-radius:var(--r);overflow:hidden;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform:translateZ(.6px);
  background:linear-gradient(135deg,var(--m1) 0%,var(--m2) 46%,var(--m3) 100%);isolation:isolate;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.28),inset 0 1.5px 0 rgba(255,255,255,.55),inset 0 -2px 0 rgba(0,0,0,.28)}
/* The 8 edge slabs sit at z = -0.9 … -7.2px behind the front. The BACK face must lie behind the LAST slab (-7.8px), otherwise — seen from the
   other side — the slabs are nearer to the eye than the face and hide it (the card looked blank when flipped). */
.pc-back{transform:rotateY(180deg) translateZ(7.8px)}
.pc-shadow{position:absolute;left:7%;right:7%;bottom:-9%;height:16%;pointer-events:none;background:radial-gradient(50% 50% at 50% 50%,rgba(0,0,0,.7),transparent 72%);filter:blur(9px);
  transform:translateX(calc(var(--ryn) * -.9px)) scale(calc(1 - var(--tilt) * .12),calc(1 + var(--tilt) * .18));opacity:calc(.85 - var(--tilt) * .15)}
.pc-layer{position:absolute;inset:0;pointer-events:none;border-radius:var(--r)}

/* --- materials: base bands + ink --- */
.pc-scene[data-mat="tier1"]{--m1:#fdfaf2;--m2:#eee6d4;--m3:#d6cab0;--ink:#5c4c33;--ink-hi:rgba(255,255,255,.85);--ink-lo:rgba(70,52,24,.32);--edge:#cdbfa2;--spec:255,255,255;--foil:#9a8456;--sub:rgba(92,76,51,.72)}
.pc-scene[data-mat="tier2"]{--m1:#f6f9fd;--m2:#c3cbd8;--m3:#8e99ab;--ink:#262f42;--ink-hi:rgba(255,255,255,.8);--ink-lo:rgba(24,32,52,.38);--edge:#7f8a9d;--spec:240,246,255;--foil:#5b6679;--sub:rgba(38,47,66,.72)}
.pc-scene[data-mat="tier3"]{--m1:#fde9a4;--m2:#dcae3c;--m3:#9c6f17;--ink:#4a3208;--ink-hi:rgba(255,246,206,.8);--ink-lo:rgba(74,50,8,.4);--edge:#a07418;--spec:255,240,190;--foil:#7a5410;--sub:rgba(74,50,8,.75)}
.pc-scene[data-mat="tier4"]{--m1:#221f29;--m2:#0e0d13;--m3:#040406;--ink:#f0cf86;--ink-hi:rgba(255,236,190,.35);--ink-lo:rgba(0,0,0,.7);--edge:#2b2420;--spec:255,230,200;--foil:#e9c87d;--sub:rgba(240,207,134,.7)}
.pc-scene[data-mat="none"]{--m1:#2c313e;--m2:#171a23;--m3:#0a0c11;--ink:rgb(var(--accent));--ink-hi:rgba(255,255,255,.25);--ink-lo:rgba(0,0,0,.6);--edge:#242833;--spec:255,235,190;--foil:rgb(var(--accent));--sub:rgba(232,220,190,.7)}
.pc-scene[data-mat="tier2"] .pc-face{background:linear-gradient(118deg,var(--m3) 0%,var(--m1) 20%,var(--m2) 38%,var(--m1) 56%,var(--m2) 74%,var(--m3) 100%)}
.pc-scene[data-mat="tier3"] .pc-face{background:linear-gradient(118deg,var(--m3) 0%,var(--m1) 24%,var(--m2) 42%,var(--m1) 60%,var(--m3) 100%)}
.pc-scene[data-mat="tier4"] .pc-face{background:radial-gradient(120% 90% at 18% 0%,#2d2833,var(--m2) 55%,var(--m3) 100%)}

/* --- patterns (second visual channel next to colour) --- */
.pc-pat{mix-blend-mode:soft-light;opacity:.9}
.pc-scene[data-pat="guilloche"] .pc-pat{background:repeating-radial-gradient(circle at 80% 28%,rgba(110,90,50,.30) 0 .8px,transparent .8px 4.5px),repeating-radial-gradient(circle at 14% 96%,rgba(110,90,50,.22) 0 .8px,transparent .8px 5.5px)}
.pc-scene[data-pat="brushed"] .pc-pat{background:repeating-linear-gradient(90deg,rgba(255,255,255,0) 0 1px,rgba(255,255,255,.34) 1px 2px,rgba(20,30,50,.12) 2px 3px);mix-blend-mode:overlay}
.pc-scene[data-pat="lattice"] .pc-pat{background:repeating-linear-gradient(45deg,rgba(100,60,0,.34) 0 .8px,transparent .8px 6.5px),repeating-linear-gradient(-45deg,rgba(100,60,0,.34) 0 .8px,transparent .8px 6.5px)}
.pc-scene[data-pat="facets"] .pc-pat{mix-blend-mode:screen;opacity:.8;background:
  conic-gradient(from 20deg at 72% 38%,rgba(255,255,255,.07),transparent 18%,rgba(240,207,134,.16) 34%,transparent 50%,rgba(230,138,156,.16) 68%,transparent 84%,rgba(255,255,255,.07)),
  repeating-linear-gradient(90deg,rgba(240,207,134,.09) 0 1px,transparent 1px 13px),repeating-linear-gradient(0deg,rgba(240,207,134,.06) 0 1px,transparent 1px 13px)}
.pc-scene[data-pat="plain"] .pc-pat{background:repeating-linear-gradient(135deg,rgba(255,255,255,.05) 0 1px,transparent 1px 9px)}
.pc-noise{mix-blend-mode:overlay;opacity:.24;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.pc-scene[data-mat="tier4"] .pc-noise{opacity:.16}

/* --- light: ONE source, upper-left, moves opposite to tilt --- */
.pc-spec{mix-blend-mode:soft-light;background:radial-gradient(62% 58% at var(--lx) var(--ly),rgba(var(--spec),.7),rgba(var(--spec),.16) 40%,transparent 64%)}
.pc-scene[data-mat="tier4"] .pc-spec{mix-blend-mode:screen;background:radial-gradient(55% 50% at var(--lx) var(--ly),rgba(var(--spec),.26),rgba(var(--spec),.05) 45%,transparent 66%)}
.pc-aniso{mix-blend-mode:overlay;opacity:.8;background:linear-gradient(106deg,transparent calc(var(--lx) - 26%),rgba(255,255,255,.55) var(--lx),transparent calc(var(--lx) + 26%))}
.pc-scene[data-mat="tier1"] .pc-aniso{opacity:.35}
.pc-scene[data-mat="tier4"] .pc-aniso{mix-blend-mode:screen;opacity:.22}
.pc-iri{mix-blend-mode:soft-light;opacity:.0;background:conic-gradient(from calc(var(--ryn) * 5deg) at 50% 50%,rgba(255,170,200,.5),rgba(170,210,255,.5),rgba(190,255,220,.45),rgba(255,230,170,.5),rgba(255,170,200,.5))}
.pc-scene[data-mat="tier1"] .pc-iri{opacity:.55}
.pc-scene[data-mat="tier4"] .pc-iri{opacity:.22;mix-blend-mode:screen}
.pc-fres{mix-blend-mode:screen;opacity:calc(.22 + var(--tilt) * .5);background:radial-gradient(125% 125% at 50% 50%,transparent 60%,rgba(255,255,255,.34) 100%)}
.pc-sweep{overflow:hidden}
.pc-sweep::before{content:"";position:absolute;top:-30%;bottom:-30%;width:46%;left:0;transform:translateX(-140%) skewX(-18deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.62),transparent);mix-blend-mode:soft-light;opacity:0}
.pc-scene[data-sweep="once"] .pc-sweep::before{animation:pcSweep 1.5s var(--pw-out) .5s 1 both}
.pc-scene[data-sweep="loop"] .pc-sweep::before{animation:pcSweep 6.5s ease-in-out 1.2s infinite both}
@keyframes pcSweep{0%{transform:translateX(-140%) skewX(-18deg);opacity:0}8%{opacity:1}55%{transform:translateX(320%) skewX(-18deg);opacity:1}56%,100%{transform:translateX(320%) skewX(-18deg);opacity:0}}
.pc-scene[data-mode="full"] .pc-float{animation:pcFloat 7s ease-in-out infinite}
@keyframes pcFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}

/* --- content (embossed / debossed type) --- */
.pc-content{position:absolute;inset:0;padding:5.6cqw 6cqw;display:flex;flex-direction:column;justify-content:space-between;color:var(--ink);pointer-events:none}
.pc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:3cqw;min-width:0}
.pc-id{display:flex;align-items:center;gap:2.6cqw;min-width:0}
.pc-logo{flex:none;width:9.4cqw;height:9.4cqw;border-radius:50%;object-fit:cover;border:1px solid var(--ink-lo);background:rgba(255,255,255,.18);box-shadow:inset 0 1px 2px var(--ink-lo),0 1px 0 var(--ink-hi)}
.pc-mono{flex:none;width:9.4cqw;height:9.4cqw;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-size:4.8cqw;color:var(--ink);border:1px solid var(--ink-lo);box-shadow:inset 0 1px 2px var(--ink-lo),0 1px 0 var(--ink-hi)}
.pc-names{display:flex;flex-direction:column;min-width:0;line-height:1.18}
.pc-clinic{font-size:4.2cqw;font-weight:700;letter-spacing:.035em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 0 var(--ink-hi),0 -1px 0 var(--ink-lo)}
.pc-prog{font-size:2.5cqw;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:var(--sub);white-space:nowrap}
.pc-sym{flex:none;width:11cqw;height:11cqw;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:var(--ink);border:1px solid var(--ink-lo);box-shadow:inset 0 1px 3px var(--ink-lo),0 1px 0 var(--ink-hi),0 0 0 1px rgba(255,255,255,.06)}
.pc-sym svg{width:62%;height:62%;filter:drop-shadow(0 1px 0 var(--ink-hi))}
.pc-mid{display:flex;flex-direction:column;gap:1.8cqw;min-width:0}
.pc-tier{font-family:Georgia,"Times New Roman","Noto Naskh Arabic",serif;font-size:8.6cqw;line-height:1.08;font-weight:500;letter-spacing:.02em;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere;text-shadow:0 1.5px 0 var(--ink-hi),0 -1px 0 var(--ink-lo)}
.pc-tier.is-long{font-size:6.2cqw}
.pc-scene[data-mat="tier3"] .pc-tier,.pc-scene[data-mat="tier4"] .pc-tier{background:linear-gradient(180deg,var(--tf1,#fff3c9),var(--tf2,#e0b04a));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;text-shadow:none;filter:drop-shadow(0 1px 0 rgba(0,0,0,.35))}
.pc-scene[data-mat="tier3"]{--tf1:#6a4708;--tf2:#3a2504}
.pc-scene[data-mat="tier4"]{--tf1:#fff0c4;--tf2:#d99aa5}
.pc-pips{display:flex;gap:1.5cqw;align-items:center}
.pc-pips i{width:2.1cqw;height:2.1cqw;border-radius:50%;border:1px solid var(--ink-lo);box-shadow:0 1px 0 var(--ink-hi)}
.pc-pips i.on{background:var(--ink);border-color:transparent;box-shadow:0 1px 0 var(--ink-hi),0 0 5px rgba(var(--spec),.6)}
.pc-bot{display:flex;align-items:flex-end;justify-content:space-between;gap:3cqw;min-width:0}
.pc-who{display:flex;flex-direction:column;gap:.8cqw;min-width:0}
.pc-name{font-size:4.5cqw;font-weight:650;letter-spacing:.12em;text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 0 var(--ink-hi),0 -1px 0 var(--ink-lo)}
.pc-since{font-size:2.7cqw;letter-spacing:.18em;text-transform:uppercase;color:var(--sub);white-space:nowrap}
.pc-holo{flex:none;width:12cqw;height:12cqw;border-radius:2cqw;position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.4);box-shadow:0 1px 3px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.2)}
.pc-holo::before{content:"";position:absolute;inset:0;background:conic-gradient(from calc(var(--ryn) * 9deg),#ff9ec9,#9ec8ff,#a8ffd8,#ffe9a0,#ff9ec9);filter:saturate(.85) brightness(1.05);opacity:.85}
.pc-holo::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(255,255,255,.55) 0 1px,transparent 1px 3px),radial-gradient(circle at 30% 25%,rgba(255,255,255,.7),transparent 55%);mix-blend-mode:overlay}
.pc-holo svg{position:absolute;inset:22%;width:56%;height:56%;z-index:1;color:rgba(255,255,255,.95);filter:drop-shadow(0 0 2px rgba(0,0,0,.5))}
.pc-scene[data-mat="tier4"] .pc-holo{border-color:rgba(240,207,134,.6)}

/* --- back face --- */
.pc-b-top{display:flex;justify-content:space-between;align-items:flex-start;gap:3cqw}
.pc-b-word{font-size:2.8cqw;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:var(--sub)}
.pc-b-clinic{font-size:4cqw;font-weight:700;letter-spacing:.03em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-shadow:0 1px 0 var(--ink-hi),0 -1px 0 var(--ink-lo)}
.pc-benefits{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:1.6cqw;min-width:0}
.pc-benefits li{display:flex;align-items:center;gap:2cqw;font-size:3.5cqw;font-weight:600;min-width:0;text-shadow:0 1px 0 var(--ink-hi),0 -1px 0 var(--ink-lo)}
.pc-benefits li i{flex:none;width:1.8cqw;height:1.8cqw;border-radius:50%;background:var(--ink)}
.pc-benefits li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pc-b-empty{font-size:3.4cqw;color:var(--sub);line-height:1.5}
.pc-ref{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:4cqw;font-weight:700;letter-spacing:.16em;text-shadow:0 1px 0 var(--ink-hi),0 -1px 0 var(--ink-lo)}
.pc-mark{display:grid;grid-template-columns:repeat(7,1fr);gap:.55cqw;width:14cqw;height:14cqw;padding:1.2cqw;border-radius:1.6cqw;border:1px solid var(--ink-lo);box-shadow:inset 0 1px 3px var(--ink-lo),0 1px 0 var(--ink-hi)}
.pc-mark i{border-radius:50%;background:transparent}
.pc-mark i.on{background:var(--ink);opacity:.85}
.pc-flipbtn{position:absolute;z-index:3;inset-inline-end:-2px;bottom:-20px;width:44px;height:44px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.2);background:rgba(8,10,15,.62);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);color:#f6ead0;cursor:pointer;transition:transform var(--pw-micro) var(--pw-spring)}
.pc-flipbtn:active{transform:scale(.9)}
.pc-scene[data-dir="rtl"] .pc-content,.pc-scene[data-dir="rtl"] .pc-face{direction:rtl}

/* --- locked (identification not done yet): the card is shown, but empty of personal data --- */
.pc-scene[data-locked="1"] .pc-name,.pc-scene[data-locked="1"] .pc-since{opacity:.55}

/* --- reduced motion / static --- */
.pw-root[data-pw-mode="static"] .pc-sweep::before{animation:none!important;opacity:0}
.pw-root[data-pw-mode="static"] .pc-float{animation:none!important}
.pw-root[data-pw-mode="static"] .pc-face.pc-back{transform:translateZ(.6px);opacity:0;transition:opacity .25s}
.pw-root[data-pw-mode="static"] .pc-scene[data-flipped="1"] .pc-front{opacity:0;transition:opacity .25s}
.pw-root[data-pw-mode="static"] .pc-scene[data-flipped="1"] .pc-back{opacity:1}
.pw-root[data-pw-mode="static"] .pc-body{transform:none!important}
.pw-root[data-pw-mode="static"] .pc-slab{display:none}
`;
