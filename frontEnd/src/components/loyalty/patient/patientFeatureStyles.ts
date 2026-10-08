/**
 * ClinicOS Loyalty — PATIENT app styles, part 3: features (Phase 9).
 *   pp-  points orb + odometer        tr-  tier progress rail          hm-  Home            rt-  reward ticket (3D object)
 *   rs-  sheets / reward focus        rw-  Rewards screen              ac-  activity timeline   ci-  check-in
 *   en-  cinematic entry + phone      tt-  tier transformation         cd-  My Card screen    in-  install
 * Everything is scoped under `.pw-root` by the parent; no images, no fonts. Static mode (reduced motion) turns every loop / travel off.
 */

const POINTS_TIER = `
/* ===================================================== POINTS (orb + odometer) ===================================================== */
.pp{display:flex;align-items:center;gap:16px;min-width:0}
.pp.is-stale .pp-num{opacity:.6}
.pp-orb{position:relative;flex:none;width:92px;height:92px;perspective:500px;transform-style:preserve-3d}
.pp-glass{position:absolute;inset:6px;border-radius:50%;background:radial-gradient(circle at 32% 26%,rgba(255,255,255,.55),rgba(255,255,255,.08) 38%,rgba(var(--accent),.22) 70%,rgba(0,0,0,.35));
  border:1px solid rgba(255,255,255,.28);box-shadow:0 18px 30px -14px rgba(0,0,0,.85),inset 0 -8px 16px rgba(var(--accent),.28),inset 0 2px 3px rgba(255,255,255,.55)}
.pp-coin{position:absolute;inset:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;transform:translateZ(14px);
  background:linear-gradient(135deg,#f9e9b2,rgb(var(--accent)) 50%,#9a6d1f);box-shadow:0 6px 12px -4px rgba(0,0,0,.6),inset 0 1px 1px rgba(255,255,255,.7),inset 0 -2px 3px rgba(80,50,0,.45)}
.pp-coin i{width:56%;height:56%;border-radius:50%;border:1.5px solid rgba(90,58,6,.55);box-shadow:inset 0 1px 1px rgba(255,255,255,.5),0 1px 0 rgba(255,255,255,.4)}
.pp-coin i::after{content:"";display:block;width:34%;height:34%;margin:33%;border-radius:50%;background:rgba(90,58,6,.5);box-shadow:inset 0 1px 1px rgba(0,0,0,.4)}
.pp-ring{position:absolute;inset:0;border-radius:50%;border:1px solid rgba(var(--accent),.5)}
.pp-ring.r1{transform:rotateX(68deg) translateZ(2px)}
.pp-ring.r2{inset:-4px;border-style:dashed;border-color:rgba(var(--accent),.32);transform:rotateX(68deg) rotateZ(40deg)}
.pw-root[data-pw-mode="full"] .pp-ring.r1{animation:ppSpin 14s linear infinite}
.pw-root[data-pw-mode="full"] .pp-ring.r2{animation:ppSpin 22s linear infinite reverse}
.pp-moons i{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:#fff3cf;box-shadow:0 0 8px rgba(var(--accent),.9);animation:ppOrbit 7s linear infinite}
.pp-moons i:nth-child(2){animation-duration:9s;animation-delay:-3s;width:4px;height:4px;margin:-2px}
.pp-moons i:nth-child(3){animation-duration:12s;animation-delay:-6s;background:var(--pw-rose)}
@keyframes ppSpin{to{transform:rotateX(68deg) rotateZ(360deg)}}
@keyframes ppOrbit{from{transform:rotate(0) translateX(50px) scaleY(.42) rotate(0)}to{transform:rotate(360deg) translateX(50px) scaleY(.42) rotate(-360deg)}}
.pp-burst{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none}
.pp-burst i{position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:#ffe9a8;box-shadow:0 0 8px rgba(var(--accent),.95);opacity:0;animation:ppBurst 1.15s var(--pw-out) both;transform:scale(var(--s))}
@keyframes ppBurst{0%{opacity:0;transform:rotate(var(--a)) translateX(10px) scale(.4)}15%{opacity:1}100%{opacity:0;transform:rotate(var(--a)) translateX(var(--r)) scale(var(--s))}}
.pp-main{min-width:0;flex:1}
.pp-label{font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;font-weight:700;color:rgb(var(--accent))}
.pp-num{position:relative;font-family:Georgia,"Times New Roman",serif;font-weight:500;line-height:1.05;margin:2px 0 0;font-size:46px;color:#fff3cf;text-shadow:0 1px 0 rgba(255,255,255,.35),0 -1px 0 rgba(0,0,0,.6),0 8px 22px rgba(var(--accent),.35)}
.pp[data-size="s"] .pp-num{font-size:38px}
.pp[data-size="xs"] .pp-num{font-size:30px}
.pp-odo{display:inline-flex;align-items:flex-start;height:1em;overflow:hidden;vertical-align:top}
.pp-col{display:inline-block;width:.62em;height:1em;overflow:hidden}
.pp-comma{display:inline-block;width:.3em;text-align:center;line-height:1}
.pp-stack{display:flex;flex-direction:column;transform:translateY(calc(var(--d) * -1em));transition:transform .9s cubic-bezier(.2,.8,.2,1) calc(var(--k) * 60ms)}
.pp-odo.is-instant .pp-stack{transition:none}
.pp-stack i{display:block;height:1em;line-height:1em;font-style:normal;text-align:center}
.pp-delta-slot{min-height:22px;margin-top:2px}
.pp-delta{display:inline-flex;align-items:baseline;gap:7px;animation:pwRise .5s var(--pw-out) both}
.pp-delta b{font-size:17px;font-weight:800}
.pp-delta em{font-size:11.5px;font-style:normal;letter-spacing:.06em;text-transform:uppercase;font-weight:700}
.pp-delta.is-up{color:var(--pw-mint)}
.pp-delta.is-down{color:var(--pw-rose)}
.pp-sub{font-size:12.5px;color:var(--pw-mute);margin-top:2px;overflow-wrap:anywhere}
.pw-root[data-pw-mode="static"] .pp-ring,.pw-root[data-pw-mode="static"] .pp-moons i{animation:none!important}
.pw-root[data-pw-mode="static"] .pp-coin{transform:none}
@media (max-width:359px){.pp{gap:12px}.pp-orb{width:76px;height:76px}.pp-coin{inset:16px}.pp-num{font-size:38px}.pp[data-size="s"] .pp-num{font-size:32px}.pp[data-size="xs"] .pp-num{font-size:26px}}

/* ===================================================== TIER PROGRESS ===================================================== */
.tr{--tr-a:#fff3cf;--tr-b:#e8c76a;--tr-c:#b98a38;display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 16px;align-items:center}
.tr[data-mat="tier1"]{--tr-a:#fffdf6;--tr-b:#eadfc6;--tr-c:#bfae86}
.tr[data-mat="tier2"]{--tr-a:#f4f8ff;--tr-b:#c3cbd8;--tr-c:#7e8aa0}
.tr[data-mat="tier3"]{--tr-a:#fde9a4;--tr-b:#dcae3c;--tr-c:#9c6f17}
.tr[data-mat="tier4"]{--tr-a:#f0cf86;--tr-b:#e68a9c;--tr-c:#9a5a68}
.tr-ring{position:relative;width:92px;height:92px;flex:none}
.tr-ring svg{width:100%;height:100%;display:block;filter:drop-shadow(0 8px 10px rgba(0,0,0,.55))}
.tr-groove{fill:none;stroke:rgba(255,255,255,.07);stroke-width:8}
.tr-arc{fill:none;stroke-width:8;stroke-linecap:round;transition:stroke-dashoffset 1.1s var(--pw-out);filter:drop-shadow(0 0 5px var(--tr-b))}
.tr-inner{fill:rgba(0,0,0,.34);stroke:rgba(255,255,255,.1);stroke-width:.8}
.tr-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
.tr-center b{font-family:Georgia,serif;font-weight:500;font-size:24px;color:#fff3cf}
.tr-center small{font-size:12px;margin-inline-start:1px;color:var(--pw-ink2)}
.tr-crown{width:34px;height:34px;color:var(--tr-b);filter:drop-shadow(0 0 6px var(--tr-b))}
.tr-crown svg{width:100%;height:100%}
.tr-info{min-width:0}
.tr-cur{font-family:Georgia,"Noto Naskh Arabic",serif;font-size:21px;line-height:1.15;color:#fff3cf;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere}
.tr-metric{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--pw-mute);margin:3px 0 6px;font-weight:650}
.tr-frac{font-size:13.5px;color:var(--pw-ink2);overflow-wrap:anywhere}
.tr-frac b{color:var(--pw-ink);font-weight:700}
.tr-next{font-size:13px;color:var(--pw-ink2);margin-top:3px;overflow-wrap:anywhere}
.tr-next b{color:rgb(var(--accent))}
.tr-top p{margin:6px 0 0;font-size:13.5px;color:var(--pw-ink2)}
.tr-rail{grid-column:1/-1;margin-top:12px}
.tr-track{position:relative;height:12px;border-radius:99px;background:linear-gradient(180deg,rgba(0,0,0,.55),rgba(255,255,255,.04));box-shadow:inset 0 2px 4px rgba(0,0,0,.7),0 1px 0 rgba(255,255,255,.08)}
.tr-fill{position:absolute;inset:2px;border-radius:99px;transform-origin:left center;background:linear-gradient(90deg,var(--tr-c),var(--tr-b) 60%,var(--tr-a));box-shadow:0 0 12px -2px var(--tr-b);transition:transform 1.1s var(--pw-out)}
[dir="rtl"] .tr-fill{transform-origin:right center}
.tr-gem{position:absolute;top:50%;inset-inline-start:calc(var(--p) * .96);width:18px;height:18px;margin:-9px 0 0 -2px;border-radius:50%;background:radial-gradient(circle at 32% 28%,#fff,var(--tr-a) 30%,var(--tr-b) 65%,var(--tr-c));box-shadow:0 0 14px var(--tr-b),0 3px 6px rgba(0,0,0,.6);transition:inset-inline-start 1.1s var(--pw-out)}
[dir="rtl"] .tr-gem{margin:-9px -2px 0 0}
.tr[data-pct="0"] .tr-gem{margin-inline-start:2px}
.tr-ends{display:flex;justify-content:space-between;gap:10px;margin-top:7px;font-size:11px;color:var(--pw-mute)}
.tr-ends span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:48%}
.pw-root[data-pw-mode="static"] .tr-arc,.pw-root[data-pw-mode="static"] .tr-fill,.pw-root[data-pw-mode="static"] .tr-gem{transition:none}
@media (max-width:359px){.tr{grid-template-columns:1fr;justify-items:center;text-align:center}.tr-ring{width:84px;height:84px}}
`;

const HOME_TICKET = `
/* ===================================================== HOME ===================================================== */
.hm{display:flex;flex-direction:column;gap:14px;padding-top:2px}
.hm-hello{margin-bottom:0}
.hm-sub{margin-bottom:2px}
.hm-hero{position:relative;padding:8px 0 2px}
.hm-open{display:flex;margin:6px auto 0;align-items:center;gap:6px}
.hm-points{padding:18px 16px}
.hm-note{margin:10px 2px 0;font-size:12px;line-height:1.55;color:var(--pw-mute);overflow-wrap:anywhere}
.hm-note svg{vertical-align:-2px;margin-inline-end:4px}
.hm-bl{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.hm-bl li{display:flex;gap:10px;align-items:flex-start}
.hm-bl li>i{flex:none;width:9px;height:9px;margin-top:6px;border-radius:50%;background:rgb(var(--accent));box-shadow:0 0 8px rgba(var(--accent),.8)}
.hm-bl b{display:block;font-size:14.5px;color:#fbf0d2;font-weight:650;overflow-wrap:anywhere}
.hm-bl span{display:block;font-size:13px;line-height:1.5;color:var(--pw-ink2);overflow-wrap:anywhere}
.hm-sec{display:flex;flex-direction:column;min-width:0}
.hm-tickets{display:flex;flex-direction:column;gap:12px}
.hm-soft{padding:14px 16px}
.hm-soft p{margin:0;font-size:13.5px;line-height:1.6;color:var(--pw-ink2)}
.pw-flip{display:inline-block}
[dir="rtl"] .pw-flip{transform:scaleX(-1)}
.pc-flight{display:block}
/* ===================================================== REWARD TICKET (3D object) ===================================================== */
.rt{display:block;margin:0}
.rt-scene{--rx:0deg;--ry:0deg;--ryn:0;--tilt:0;--lx:30%;--ly:18%;--bot:64px;--r:18px;position:relative;perspective:900px;touch-action:pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;
  --t1:#272b38;--t2:#161922;--t3:#0b0d13;--ink:#f6efe0;--sub:#b6ab92;--edge:linear-gradient(135deg,#f6e2a8,#b98a38);--cost:#f2d98f}
.rt-scene[data-focus="1"]{touch-action:none;--bot:70px}
.rt-scene[data-state="locked"]{--bot:78px;--t1:rgba(70,76,94,.72);--t2:rgba(38,42,56,.78);--t3:rgba(22,25,34,.85);--sub:#a9a08a;--edge:linear-gradient(135deg,rgba(255,255,255,.34),rgba(255,255,255,.1));--cost:#cfc6ad}
.rt-scene[data-state="pending"]{--t1:#3a3020;--t2:#231c10;--t3:#120e07;--edge:linear-gradient(135deg,#f6dca0,#c58a2c);--cost:#f6dca0}
.rt-scene[data-state="redeemed"]{--t1:#1d3a31;--t2:#10241e;--t3:#08140f;--edge:linear-gradient(135deg,#c8f5d9,#3fa874);--cost:#b8efd1}
.rt-body{position:relative;transform-style:preserve-3d;transform:rotateX(var(--rx)) rotateY(var(--ry));will-change:transform}
.rt-edge{position:absolute;inset:-1.5px;border-radius:calc(var(--r) + 1.5px);background:var(--edge);transform:translateZ(-2px);
  -webkit-mask:radial-gradient(circle 7.5px at 0 calc(100% - var(--bot) - 1.5px),#0000 97%,#000) left/51% 100% no-repeat,radial-gradient(circle 7.5px at 100% calc(100% - var(--bot) - 1.5px),#0000 97%,#000) right/51% 100% no-repeat;
  mask:radial-gradient(circle 7.5px at 0 calc(100% - var(--bot) - 1.5px),#0000 97%,#000) left/51% 100% no-repeat,radial-gradient(circle 7.5px at 100% calc(100% - var(--bot) - 1.5px),#0000 97%,#000) right/51% 100% no-repeat}
.rt-face{position:relative;border-radius:var(--r);overflow:hidden;isolation:isolate;min-height:150px;color:var(--ink);transform:translateZ(1px);
  background:linear-gradient(135deg,var(--t1),var(--t2) 55%,var(--t3));box-shadow:inset 0 1px 0 rgba(255,255,255,.18);
  -webkit-mask:radial-gradient(circle 9px at 0 calc(100% - var(--bot)),#0000 97%,#000) left/51% 100% no-repeat,radial-gradient(circle 9px at 100% calc(100% - var(--bot)),#0000 97%,#000) right/51% 100% no-repeat;
  mask:radial-gradient(circle 9px at 0 calc(100% - var(--bot)),#0000 97%,#000) left/51% 100% no-repeat,radial-gradient(circle 9px at 100% calc(100% - var(--bot)),#0000 97%,#000) right/51% 100% no-repeat}
.rt-scene[data-focus="1"] .rt-face{min-height:210px}
.rt-scene[data-state="locked"] .rt-face{backdrop-filter:blur(6px)}
.rt-layer{position:absolute;inset:0;pointer-events:none}
.rt-pat{opacity:.5;mix-blend-mode:soft-light}
.rt-scene[data-state="available"] .rt-pat{background:repeating-linear-gradient(45deg,rgba(232,199,106,.5) 0 .7px,transparent .7px 7px),repeating-linear-gradient(-45deg,rgba(232,199,106,.5) 0 .7px,transparent .7px 7px)}
.rt-scene[data-state="locked"] .rt-pat{background:repeating-linear-gradient(0deg,rgba(255,255,255,.4) 0 1px,transparent 1px 6px)}
.rt-scene[data-state="pending"] .rt-pat{background:repeating-radial-gradient(circle at 85% 20%,rgba(240,195,106,.5) 0 .8px,transparent .8px 6px)}
.rt-scene[data-state="redeemed"] .rt-pat{background:repeating-linear-gradient(135deg,rgba(111,214,176,.5) 0 .8px,transparent .8px 8px)}
.rt-noise{mix-blend-mode:overlay;opacity:.2;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .6 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
.rt-spec{mix-blend-mode:screen;background:radial-gradient(60% 70% at var(--lx) var(--ly),rgba(255,236,190,.22),rgba(255,236,190,.05) 45%,transparent 66%)}
.rt-sweep{overflow:hidden}
.rt-content{position:relative;z-index:1;display:flex;flex-direction:column;min-height:inherit;padding:14px 16px 0}
.rt-scene[data-focus="1"] .rt-content{min-height:210px}
.rt-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.rt-ico{flex:none;width:36px;height:36px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;color:var(--cost);background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.18)}
.rt-name{margin:10px 0 0;font-family:Georgia,"Times New Roman","Noto Naskh Arabic",serif;font-size:21px;line-height:1.2;color:#fff6dc;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow-wrap:anywhere;text-shadow:0 1px 0 rgba(0,0,0,.5)}
.rt-scene[data-focus="1"] .rt-name{font-size:25px;-webkit-line-clamp:3}
.rt-desc{margin:8px 0 0;font-size:13.5px;line-height:1.55;color:var(--sub);overflow-wrap:anywhere}
.rt-perf{margin:auto -16px 0;height:0;border-top:1.5px dashed rgba(255,255,255,.2)}
.rt-foot{flex:none;height:var(--bot);margin:0 -16px;padding:0 16px;display:flex;flex-direction:column;justify-content:center;gap:9px}
.rt-bot{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0}
.rt-cost{display:inline-flex;align-items:baseline;gap:5px;flex:none;color:var(--cost)}
.rt-cost i{width:12px;height:12px;border-radius:50%;align-self:center;background:radial-gradient(circle at 32% 28%,#fff6d0,rgb(var(--accent)) 55%,#9a6d1f);box-shadow:0 0 6px rgba(var(--accent),.7)}
.rt-cost b{font-size:24px;font-weight:700;font-family:Georgia,serif}
.rt-cost small{font-size:11px;letter-spacing:.1em;text-transform:uppercase;opacity:.85}
.rt-sub{min-width:0;font-size:12px;line-height:1.35;color:var(--sub);text-align:end;overflow-wrap:anywhere}
.rt-meter{height:7px;border-radius:9px;overflow:hidden;background:rgba(0,0,0,.5);box-shadow:inset 0 1px 3px rgba(0,0,0,.7)}
.rt-meter i{display:block;height:100%;width:100%;transform-origin:left center;border-radius:9px;background:linear-gradient(90deg,#8a7a55,#cfc6ad);transition:transform .9s var(--pw-out)}
[dir="rtl"] .rt-meter i{transform-origin:right center}
.rt-stamp{position:absolute;inset-inline-end:14px;top:42%;width:54px;height:54px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#b8efd1;border:2px solid rgba(111,214,176,.7);transform:rotate(-14deg);box-shadow:inset 0 0 0 3px rgba(111,214,176,.15)}
.rt-scene[data-state="pending"] .rt-face{animation:rtPulse 2.6s ease-in-out infinite}
@keyframes rtPulse{0%,100%{box-shadow:inset 0 0 0 1px rgba(240,195,106,.18),0 0 0 rgba(240,195,106,0)}50%{box-shadow:inset 0 0 0 1px rgba(240,195,106,.45),0 0 22px rgba(240,195,106,.18)}}
.rt-shadow{position:absolute;left:8%;right:8%;bottom:-8px;height:16px;background:radial-gradient(50% 50% at 50% 50%,rgba(0,0,0,.6),transparent 72%);filter:blur(8px);pointer-events:none;transform:translateX(calc(var(--ryn) * -.8px));opacity:calc(.85 - var(--tilt) * .2)}
.rt-hit{position:absolute;inset:0;z-index:3;background:transparent;border:0;border-radius:var(--r);cursor:pointer;padding:0;-webkit-tap-highlight-color:transparent}
.rt-hit:focus-visible{outline:2px solid var(--pw-gold);outline-offset:3px}
.rt-scene[data-dir="rtl"] .rt-face{direction:rtl}
.rt[data-state="available"]:hover .rt-body,.rt[data-state="available"] .rt-hit:active ~ .rt-body{filter:brightness(1.06)}
.pw-root[data-pw-mode="static"] .rt-body{transform:none!important}
.pw-root[data-pw-mode="static"] .rt-scene[data-state="pending"] .rt-face{animation:none}
@media (prefers-reduced-motion: reduce){.rt-scene[data-state="pending"] .rt-face{animation:none}}
`;

const SHEETS_REWARDS = `
/* ===================================================== SHEETS / REWARD FOCUS ===================================================== */
.rs-root{position:absolute;inset:0;z-index:20;display:flex;align-items:flex-end;justify-content:center}
.rs-back{position:absolute;inset:0;background:radial-gradient(80% 60% at 50% 40%,rgba(10,12,18,.55),rgba(3,4,7,.86));backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);animation:pwFade var(--pw-nav) ease both}
.rs-panel{position:relative;width:100%;max-height:calc(100% - 18px);overflow-y:auto;overscroll-behavior:contain;border-radius:28px 28px 0 0;padding:22px 18px calc(18px + var(--sab));
  background:linear-gradient(180deg,#171a24,#0c0e15);border:1px solid rgba(255,255,255,.12);border-bottom:0;box-shadow:0 -30px 80px -20px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.12);
  animation:rsUp var(--pw-feature) var(--pw-spring) both;scrollbar-width:none;outline:none}
.rs-panel::-webkit-scrollbar{display:none}
@keyframes rsUp{from{transform:translateY(60px) scale(.97);opacity:0}to{transform:none;opacity:1}}
@media (min-width:700px){.rs-root{align-items:center}.rs-panel{max-width:400px;border-radius:26px;border-bottom:1px solid rgba(255,255,255,.12);max-height:calc(100% - 36px)}}
.rs-close{position:absolute;z-index:5;top:10px;inset-inline-end:10px;width:44px;height:44px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#f3e3b5;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);cursor:pointer;transition:transform var(--pw-micro) var(--pw-spring)}
.rs-close:active{transform:scale(.9)}
.rs-obj{padding:30px 0 16px}
.rs-obj .rt{margin:0 auto;max-width:360px}
.rs-facts{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:2px 0 14px}
.rs-facts.is-two{margin-top:10px}
.rs-facts>div{padding:10px 12px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);min-width:0}
.rs-facts dt{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--pw-mute);font-weight:650;overflow-wrap:anywhere}
.rs-facts dd{margin:4px 0 0;font-size:17px;font-weight:700;color:#fff3cf;overflow-wrap:anywhere}
.rs-facts .is-neg dd{color:var(--pw-mute)}
.rs-note{display:flex;gap:8px;align-items:flex-start;margin:0 2px 14px;font-size:12.5px;line-height:1.55;color:var(--pw-ink2)}
.rs-note svg{flex:none;margin-top:2px;color:rgb(var(--accent))}
.rs-sub{margin:10px 2px 0;text-align:center;font-size:13px;color:var(--pw-ink2)}
.rs-state{display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:18px}
.rs-state.is-wait{background:rgba(240,195,106,.1);border:1px solid rgba(240,195,106,.34)}
.rs-state b{display:block;font-size:15px;color:#fbe9bd;margin-bottom:3px}
.rs-state p{margin:0;font-size:13px;line-height:1.55;color:var(--pw-ink2)}
.rs-state-ico{flex:none;width:42px;height:42px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;color:#2a1d06;background:linear-gradient(135deg,#f6e2a8,#e0b04a);box-shadow:0 8px 18px -8px rgba(240,195,106,.7)}
.rs-title{margin:6px 40px 12px 2px;font-family:Georgia,"Noto Naskh Arabic",serif;font-weight:500;font-size:24px;line-height:1.2;color:#fbf0d2;overflow-wrap:anywhere}
.rs-done{text-align:center}
.rs-done .rs-title{margin:0 0 4px;text-align:center}
.rs-reward{margin:0 0 6px;font-size:16px;color:var(--pw-ink2);overflow-wrap:anywhere}
.rs-seal{position:relative;width:96px;height:96px;margin:14px auto 12px;display:flex;align-items:center;justify-content:center}
.rs-seal span{position:relative;z-index:1;width:78px;height:78px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#0d3320;background:linear-gradient(135deg,#c8f5d9,#6fd6a0 60%,#3fa874);box-shadow:0 14px 30px -10px rgba(80,200,140,.7),inset 0 1px 0 rgba(255,255,255,.6);animation:pcPop .6s var(--pw-spring) both}
.rs-seal>i{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(120,220,160,.7);opacity:0;animation:pcBurst 1.5s ease-out .2s both}
.rs-seal>i:nth-child(2){animation-delay:.5s}
.rs-seal em{position:absolute;left:50%;top:50%}
.rs-seal u{position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:#c8f5d9;box-shadow:0 0 8px rgba(111,214,176,.9);opacity:0;animation:ppBurst 1.2s var(--pw-out) calc(.3s + var(--d) * .08s) both;--r:62px;--s:1}
@keyframes pcPop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
@keyframes pcBurst{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.6);opacity:0}}
.pw-root[data-pw-mode="static"] .rs-panel{animation:pwFade var(--pw-nav) ease both}
.pw-root[data-pw-mode="static"] .rs-seal>i,.pw-root[data-pw-mode="static"] .rs-seal span{animation:none;opacity:1}
.pw-root[data-pw-mode="static"] .rs-seal>i{display:none}
/* ===================================================== REWARDS SCREEN ===================================================== */
.rw-list,.rw-others{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:14px}
.rw-list li{min-width:0;animation:pwRise var(--pw-feature) var(--pw-out) calc(var(--i,0) * 50ms) both}
.rw-h{margin-top:22px}
.rw-when{margin:8px 4px 0;font-size:12px;color:var(--pw-mute)}
.rw-other{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px}
.rw-other>div{display:flex;flex-direction:column;min-width:0}
.rw-other b{font-size:14.5px;color:#fbf0d2;overflow-wrap:anywhere}
.rw-other span.pw-num{font-size:12.5px;color:var(--pw-mute)}
.rw-note{margin-top:18px}
.rw-skel{display:flex;flex-direction:column;gap:14px}
.av .ac-skel{display:flex;flex-direction:column;gap:12px}
.ac-skel{display:flex;flex-direction:column;gap:12px}
`;

const ACTIVITY_CHECKIN = `
/* ===================================================== ACTIVITY TIMELINE ===================================================== */
.ac{display:flex;flex-direction:column;gap:6px}
.ac-day{margin:14px 2px 8px;font-size:10.5px;letter-spacing:.2em;text-transform:uppercase;color:rgb(var(--accent));font-weight:700}
.ac-list{list-style:none;margin:0;padding:0;position:relative;display:flex;flex-direction:column;gap:10px}
.ac-list::before{content:"";position:absolute;top:8px;bottom:8px;inset-inline-start:19px;width:2px;border-radius:2px;background:linear-gradient(180deg,rgba(var(--accent),.55),rgba(var(--accent),.08));box-shadow:0 0 10px rgba(var(--accent),.3)}
.ac-row{position:relative;display:flex;gap:12px;align-items:stretch;animation:pwRise var(--pw-feature) var(--pw-out) calc(var(--i,0) * 45ms) both}
.ac-node{position:relative;z-index:1;flex:none;width:40px;height:40px;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;color:rgb(var(--accent));
  background:linear-gradient(145deg,#232735,#10131b);border:1px solid rgba(var(--accent),.45);box-shadow:0 10px 18px -8px rgba(0,0,0,.9),0 0 0 4px #090b11,inset 0 1px 0 rgba(255,255,255,.2)}
.ac-row[data-kind="redemption"] .ac-node{color:var(--pw-rose);border-color:rgba(230,138,156,.5)}
.ac-row[data-kind="tier_promotion"] .ac-node{color:#fff3cf;background:linear-gradient(145deg,#6b4c12,#2a1d06);box-shadow:0 0 16px rgba(var(--accent),.5),0 0 0 4px #090b11,inset 0 1px 0 rgba(255,255,255,.3)}
.ac-row[data-kind="reversal"] .ac-node,.ac-row[data-kind="adjustment_debit"] .ac-node{color:#d9c3c3;border-color:rgba(255,255,255,.22)}
.ac-card{flex:1;min-width:0;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;border-radius:16px;background:linear-gradient(150deg,rgba(255,255,255,.07),rgba(255,255,255,.02));border:1px solid var(--pw-line2);box-shadow:0 14px 26px -18px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.07)}
.ac-main{min-width:0}
.ac-title{font-size:14px;font-weight:650;color:#fbf0d2;overflow-wrap:anywhere}
.ac-meta{margin-top:2px;font-size:12px;color:var(--pw-mute)}
.ac-meta b{color:var(--pw-ink2);font-weight:650}
.ac-pts{flex:none;display:flex;flex-direction:column;align-items:flex-end;line-height:1.1}
.ac-pts b{font-size:17px;font-weight:800}
.ac-pts em{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;font-style:normal;font-weight:700;margin-top:2px}
.ac-pts.is-up{color:var(--pw-mint)}
.ac-pts.is-down{color:var(--pw-rose)}
.ac-more{display:flex;flex-direction:column;align-items:center;gap:6px;margin:14px 0 4px}
.is-home .ac-row{animation-delay:calc(var(--i,0) * 60ms)}
.ac-row.is-compact .ac-card{padding:9px 12px}
.pw-root[data-pw-mode="static"] .ac-row{animation:pwFade .3s ease both}
/* ===================================================== CHECK-IN ===================================================== */
.ci{position:relative;padding:16px;border-radius:22px;background:linear-gradient(150deg,rgba(var(--accent),.13),rgba(255,255,255,.02));border:1px solid rgba(var(--accent),.32);box-shadow:0 22px 44px -26px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.1);overflow:hidden}
.ci[data-status="pending"]{border-color:rgba(240,195,106,.55)}
.ci[data-status="confirmed"]{border-color:rgba(111,214,176,.5);background:linear-gradient(150deg,rgba(111,214,176,.13),rgba(255,255,255,.02))}
.ci-head{display:flex;gap:13px;align-items:flex-start;margin-bottom:14px}
.ci-ico{flex:none;width:46px;height:46px;border-radius:15px;display:inline-flex;align-items:center;justify-content:center;color:rgb(var(--accent));background:rgba(var(--accent),.13);border:1px solid rgba(var(--accent),.4);box-shadow:inset 0 1px 0 rgba(255,255,255,.15)}
.ci h3{margin:0 0 3px;font-size:16.5px;font-weight:650;color:#fbf0d2;overflow-wrap:anywhere}
.ci p{margin:0;font-size:13.5px;line-height:1.6;color:var(--pw-ink2);overflow-wrap:anywhere}
.ci-note{margin:0 0 12px!important;padding:10px 12px;border-radius:12px;color:#f1dcab!important;background:rgba(241,220,171,.08);border:1px solid rgba(241,220,171,.22)}
.ci-wait,.ci-done{display:flex;flex-direction:column;align-items:center;text-align:center;padding:4px 2px}
.ci-zero{margin-top:6px!important;font-size:12.5px!important;color:var(--pw-mute)!important}
.ci-radar{position:relative;width:96px;height:96px;margin:2px 0 12px;display:flex;align-items:center;justify-content:center}
.ci-radar span{position:relative;z-index:1;width:56px;height:56px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#2a1d06;background:linear-gradient(135deg,#f6e2a8,rgb(var(--accent)) 55%,#b98a38);box-shadow:0 10px 26px -8px rgba(var(--accent),.7),inset 0 1px 0 rgba(255,255,255,.55)}
.ci-radar i{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(var(--accent),.55);opacity:0;animation:ciRing 2.6s cubic-bezier(.2,.6,.3,1) infinite}
.ci-radar i:nth-child(2){animation-delay:.85s}
.ci-radar i:nth-child(3){animation-delay:1.7s}
.ci-burst{position:relative;width:84px;height:84px;margin:0 0 10px;display:flex;align-items:center;justify-content:center}
.ci-burst span{position:relative;z-index:1;width:64px;height:64px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#0d3320;background:linear-gradient(135deg,#c8f5d9,#6fd6a0 60%,#3fa874);box-shadow:0 12px 28px -8px rgba(80,200,140,.7),inset 0 1px 0 rgba(255,255,255,.6)}
.ci-done.is-fresh .ci-burst span{animation:pcPop .55s var(--pw-spring) both}
.ci-burst i{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(120,220,160,.7);opacity:0}
.ci-done.is-fresh .ci-burst i{animation:pcBurst 1.4s ease-out .15s both}
.ci-done.is-fresh .ci-burst i:nth-child(2){animation-delay:.4s}
.ci-msg{min-height:0}
@keyframes ciRing{0%{transform:scale(.55);opacity:.7}100%{transform:scale(1.25);opacity:0}}
.pw-root[data-pw-mode="static"] .ci-radar i{animation:none;opacity:.35;transform:scale(1.05)}
.pw-root[data-pw-mode="static"] .ci-radar i:nth-child(n+2){display:none}
`;

const ENTRY_TIER = `
/* ===================================================== CINEMATIC ENTRY ===================================================== */
.en{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;z-index:2}
.en::before{content:"";position:absolute;inset:0;z-index:6;background:#000;pointer-events:none;opacity:0;transition:opacity .9s ease}
.en[data-stage="0"]::before{opacity:1}
.en[data-intro="short"]::before{transition-duration:.35s}
.en .pw-top{position:relative;opacity:0;transition:opacity .6s ease .1s}
.en:not([data-stage="0"]) .pw-top{opacity:1}
.en-scroll{position:relative;flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior-y:contain;scrollbar-width:none;display:flex;flex-direction:column;justify-content:center;padding:4px calc(18px + var(--sar)) calc(22px + var(--sab)) calc(18px + var(--sal))}
.en-scroll::-webkit-scrollbar{display:none}
.en-light{position:absolute;left:50%;top:34%;width:0;height:0;pointer-events:none;z-index:5}
.en-light i{position:absolute;border-radius:50%;left:0;top:0;transform:translate(-50%,-50%)}
.en-light i:first-child{width:6px;height:6px;background:#fff;box-shadow:0 0 18px 6px rgba(255,244,214,.9),0 0 60px 20px rgba(var(--accent),.5);animation:enDot 1.2s ease-out both}
.en-light i:last-child{width:10px;height:10px;opacity:0;background:radial-gradient(circle,rgba(255,244,214,.55),rgba(var(--accent),.18) 45%,transparent 70%)}
.en[data-stage="1"] .en-light i:last-child{animation:enBloom 1.1s ease-out both}
.en:not([data-stage="0"]):not([data-stage="1"]) .en-light{display:none}
@keyframes enDot{0%{transform:translate(-50%,-50%) scale(0);opacity:0}30%{opacity:1}100%{transform:translate(-50%,-50%) scale(1);opacity:1}}
@keyframes enBloom{0%{width:10px;height:10px;opacity:0}30%{opacity:1}100%{width:520px;height:520px;opacity:0}}
.en-id{position:absolute;left:0;right:0;top:34%;transform:translateY(-50%);z-index:4;display:flex;flex-direction:column;align-items:center;gap:12px;pointer-events:none;opacity:0;padding:0 24px}
.en[data-stage="1"] .en-id{animation:enId 1.1s var(--pw-out) both}
@keyframes enId{0%{opacity:0;transform:translateY(-50%) scale(.82);filter:blur(8px)}35%{opacity:1;filter:none}100%{opacity:1;transform:translateY(-50%) scale(1)}}
.en-logo{width:68px;height:68px;border-radius:50%;object-fit:cover;border:1px solid rgba(var(--accent),.7);background:rgba(0,0,0,.4);box-shadow:0 0 40px rgba(var(--accent),.45)}
.en-mono{display:inline-flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-size:30px;color:rgb(var(--accent))}
.en-clinic{font-family:Georgia,"Noto Naskh Arabic",serif;font-size:23px;color:#fbf0d2;text-align:center;overflow-wrap:anywhere;letter-spacing:.02em}
.en-cardwrap{perspective:900px;flex:none;margin:6px 0 4px;transition:transform .4s var(--pw-out),margin .4s var(--pw-out)}
.en-card{transform-origin:50% 60%;opacity:0;transform:translateZ(-260px) rotateY(-62deg) rotateX(16deg) scale(.82);transition:transform 0s,opacity .3s}
.en[data-stage="2"] .en-card{opacity:1;transform:rotateY(-24deg) rotateX(6deg);transition:transform .85s var(--pw-out),opacity .6s ease}
.en[data-stage="3"] .en-card,.en[data-stage="4"] .en-card{opacity:1;transform:none;transition:transform .8s var(--pw-spring),opacity .4s ease}
.en[data-skip="1"] .en-card,.en[data-intro="short"] .en-card{transition-duration:.35s!important}
.en[data-stage="3"] .en-id{animation:none;opacity:0}
.en[data-typing="1"] .en-cardwrap{transform:scale(.72);margin:-26px 0 -22px}
.en[data-compact="1"] .en-cardwrap{display:none}
.en-welcome{opacity:0;transform:translateY(14px);transition:opacity .6s ease,transform .6s var(--pw-out);text-align:center;margin-top:6px}
.en-welcome .pw-title{text-align:center;font-size:30px}
.en-welcome .pw-sub{text-align:center;margin:0 auto 12px;max-width:30ch}
.en-form{opacity:0;transform:translateY(16px);visibility:hidden;transition:opacity .6s ease .1s,transform .6s var(--pw-out) .1s,visibility 0s linear .7s;width:100%;max-width:420px;margin:0 auto}
.en[data-stage="3"] .en-welcome,.en[data-stage="4"] .en-welcome{opacity:1;transform:none}
.en[data-stage="3"] .en-form,.en[data-stage="4"] .en-form{opacity:1;transform:none;visibility:visible;transition:opacity .6s ease .1s,transform .6s var(--pw-out) .1s,visibility 0s}
.en[data-typing="1"] .en-welcome .pw-sub{display:none}
.en-label{display:block;margin:0 2px 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--pw-ink2);font-weight:650}
.en-input{display:flex;align-items:center;gap:9px;min-height:58px;padding:0 14px;border-radius:18px;color:rgb(var(--accent));background:linear-gradient(150deg,rgba(255,255,255,.09),rgba(255,255,255,.03));border:1px solid var(--pw-line2);box-shadow:inset 0 2px 6px rgba(0,0,0,.45),0 1px 0 rgba(255,255,255,.06);transition:border-color var(--pw-micro),box-shadow var(--pw-nav)}
.en-input:focus-within{border-color:rgba(var(--accent),.85);box-shadow:inset 0 2px 6px rgba(0,0,0,.45),0 0 0 4px rgba(var(--accent),.18),0 0 28px -6px rgba(var(--accent),.5)}
.en-input.is-bad{border-color:rgba(255,150,150,.7)}
.en-input.is-ok{border-color:rgba(111,214,176,.55)}
.en-cc{flex:none;font-size:15px;color:var(--pw-ink2);font-weight:650;letter-spacing:.04em}
.en-input input{flex:1;min-width:0;height:54px;background:transparent;border:0;outline:0;color:#fff6dc;font-size:19px;letter-spacing:.06em;font-weight:600}
.en-input input::placeholder{color:rgba(196,185,159,.45);letter-spacing:.04em}
.en-tick{flex:none;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#0d3320;background:var(--pw-mint)}
.en-preview{margin:7px 4px 0;font-size:12.5px;color:var(--pw-mute);letter-spacing:.06em;text-align:start}
.en-msg{min-height:6px}
.en-form .pw-btn{margin-top:12px}
.en-fine{display:flex;gap:6px;align-items:flex-start;justify-content:center;margin:14px 6px 0;font-size:12px;line-height:1.55;color:var(--pw-mute);text-align:center}
.en-fine svg{flex:none;margin-top:3px}
.pw-root[data-pw-mode="static"] .en::before{transition:none}
.pw-root[data-pw-mode="static"] .en-light,.pw-root[data-pw-mode="static"] .en-id{display:none}
.pw-root[data-pw-mode="static"] .en-card{transform:none!important;transition:opacity .3s!important}
.pw-root[data-pw-mode="static"] .en-welcome,.pw-root[data-pw-mode="static"] .en-form{transition:opacity .3s!important;transform:none}
.pw-root[data-pw-mode="static"] .en-cardwrap{transition:none}
@media (max-height:640px){.en-welcome .pw-title{font-size:25px}.en-welcome .pw-sub{margin-bottom:8px}}
/* ===================================================== welcome moment / notices ===================================================== */
.pw-welcome{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:radial-gradient(70% 50% at 50% 45%,rgba(var(--accent),.18),rgba(4,5,8,.94));animation:pwWelcome .85s ease both;cursor:pointer}
.pw-welcome-in{display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:0 24px;animation:pwRise .6s var(--pw-out) both}
.pw-welcome-k{font-size:11px;letter-spacing:.34em;text-transform:uppercase;color:rgb(var(--accent));font-weight:700}
.pw-welcome-n{font-family:Georgia,"Noto Naskh Arabic",serif;font-size:34px;color:#fff3cf;overflow-wrap:anywhere;text-shadow:0 8px 30px rgba(var(--accent),.4)}
@keyframes pwWelcome{0%{opacity:0}18%{opacity:1}80%{opacity:1}100%{opacity:0;pointer-events:none}}
.pw-root[data-pw-mode="static"] .pw-welcome{animation:pwWelcomeS .5s ease both}
@keyframes pwWelcomeS{0%,70%{opacity:1}100%{opacity:0}}
/* ===================================================== enrolment moment (Phase 9.1) — one time, ~1.8 s ===================================================== */
.pw-enr{position:absolute;inset:0;z-index:31;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:calc(24px + var(--sat)) 22px calc(24px + var(--sab));background:radial-gradient(75% 55% at 50% 42%,rgba(var(--accent),.2),rgba(4,5,8,0)),#05060a;cursor:pointer;animation:pwEnrOut var(--enr-ms,1.8s) linear both;overflow:hidden}
.pw-enr-scan{position:absolute;left:50%;top:42%;width:0;height:0;pointer-events:none}
.pw-enr-ring{position:absolute;left:-130px;top:-130px;width:260px;height:260px;border-radius:50%;border:1.5px solid rgba(var(--accent),.85);box-shadow:0 0 40px rgba(var(--accent),.45),inset 0 0 40px rgba(var(--accent),.2);opacity:0;transform:scale(.4);animation:pwEnrRing 1.1s var(--pw-out) both}
.pw-enr-ring.r2{animation-delay:.12s;border-color:rgba(var(--accent),.45)}
.pw-enr-beam{position:absolute;left:-150px;top:-1px;width:300px;height:2px;background:linear-gradient(90deg,transparent,rgba(var(--accent),.95),transparent);box-shadow:0 0 18px rgba(var(--accent),.8);opacity:0;animation:pwEnrBeam .9s ease-in-out .05s both}
.pw-enr-card{position:relative;width:min(300px,76vw);perspective:900px;opacity:0;transform:translateZ(-160px) rotateY(-62deg) scale(.7);transition:opacity .5s ease,transform .8s var(--pw-spring)}
.pw-enr[data-stage="1"] .pw-enr-card,.pw-enr[data-stage="2"] .pw-enr-card{opacity:1;transform:none}
.pw-enr[data-stage="2"] .pw-enr-card{transform:translateY(-4px) scale(.96);transition:transform .6s var(--pw-out)}
.pw-enr-text{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;opacity:0;transform:translateY(14px);transition:opacity .5s ease,transform .6s var(--pw-out)}
.pw-enr[data-stage="2"] .pw-enr-text{opacity:1;transform:none}
.pw-enr-k{display:inline-flex;align-items:center;gap:6px;font-size:11px;letter-spacing:.3em;font-weight:700;color:rgb(var(--accent))}
.pw-enr-h{margin:0;font-family:Georgia,"Noto Naskh Arabic",serif;font-weight:500;font-size:25px;line-height:1.25;color:#fff3cf;overflow-wrap:anywhere;text-shadow:0 8px 30px rgba(var(--accent),.4);max-width:320px}
.pw-enr-facts{display:flex;gap:26px;margin-top:4px}
.pw-enr-fact{display:flex;flex-direction:column;align-items:center;gap:2px}
.pw-enr-fact b{font-size:24px;font-weight:600;color:#fff;max-width:150px;overflow-wrap:anywhere}
.pw-enr-fact small{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--pw-mute)}
@keyframes pwEnrRing{0%{opacity:0;transform:scale(.4)}25%{opacity:1}100%{opacity:0;transform:scale(1.5)}}
@keyframes pwEnrBeam{0%{opacity:0;transform:translateY(-120px)}20%{opacity:1}80%{opacity:1}100%{opacity:0;transform:translateY(120px)}}
@keyframes pwEnrOut{0%{opacity:0}8%{opacity:1}86%{opacity:1}100%{opacity:0;pointer-events:none}}
.pw-root[data-pw-mode="lite"] .pw-enr-scan{display:none}
.pw-root[data-pw-mode="lite"] .pw-enr-card{transform:translateY(16px);transition:opacity .4s ease,transform .5s var(--pw-out)}
.pw-root[data-pw-mode="lite"] .pw-enr[data-stage="1"] .pw-enr-card,.pw-root[data-pw-mode="lite"] .pw-enr[data-stage="2"] .pw-enr-card{transform:none}
.pw-root[data-pw-mode="static"] .pw-enr{animation:pwEnrOutS var(--enr-ms,1.4s) linear both}
.pw-root[data-pw-mode="static"] .pw-enr-scan{display:none}
.pw-root[data-pw-mode="static"] .pw-enr-card,.pw-root[data-pw-mode="static"] .pw-enr-text{opacity:1;transform:none;transition:none}
@keyframes pwEnrOutS{0%,88%{opacity:1}100%{opacity:0}}
@media (max-height:640px){.pw-enr{gap:12px}.pw-enr-card{width:min(240px,64vw)}.pw-enr-h{font-size:21px}}
.pw-notice{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;justify-content:center;gap:16px;padding:calc(18px + var(--sat)) calc(18px + var(--sar)) calc(24px + var(--sab)) calc(18px + var(--sal))}
.pw-notice-card{opacity:.7;filter:saturate(.7)}
.pw-notice-h{margin:8px 0 0;font-size:18px;font-weight:650;color:#fbf0d2;overflow-wrap:anywhere}
.pw-load .pw-panel{max-width:360px}

/* ===================================================== TIER TRANSFORMATION ===================================================== */
.tt-root{position:absolute;inset:0;z-index:25;display:flex;align-items:center;justify-content:center}
.tt-back{position:absolute;inset:0;background:radial-gradient(80% 60% at 50% 38%,rgba(var(--accent),.12),rgba(3,4,7,.95));animation:pwFade .5s ease both}
.tt-panel{position:relative;width:100%;max-height:100%;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none;padding:calc(24px + var(--sat)) 20px calc(20px + var(--sab));display:flex;flex-direction:column;align-items:center;outline:none}
.tt-panel::-webkit-scrollbar{display:none}
.tt-stage{position:relative;width:100%;max-width:400px;margin:6px auto 14px;perspective:1000px}
.tt-glow{position:absolute;left:50%;top:50%;width:140%;aspect-ratio:1;transform:translate(-50%,-50%) scale(.3);opacity:0;border-radius:50%;background:radial-gradient(circle,rgba(255,244,214,.55),rgba(var(--accent),.2) 40%,transparent 68%);pointer-events:none}
.tt-root[data-stage="1"] .tt-glow{animation:ttGlow 1.3s ease-out both}
.tt-root[data-stage="2"] .tt-glow{animation:ttFlash 1.1s ease-out both}
@keyframes ttGlow{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}60%{opacity:.8}100%{opacity:.5;transform:translate(-50%,-50%) scale(.9)}}
@keyframes ttFlash{0%{opacity:.8;transform:translate(-50%,-50%) scale(.9)}35%{opacity:1;transform:translate(-50%,-50%) scale(1.2)}100%{opacity:.18;transform:translate(-50%,-50%) scale(1.1)}}
.tt-stack{position:relative}
.tt-a{animation:ttRise .7s var(--pw-out) both}
.tt-b{position:absolute;inset:0;clip-path:circle(0% at 50% 50%);opacity:1}
.tt-root[data-stage="2"] .tt-b,.tt-root[data-stage="3"] .tt-b{animation:ttReveal .75s cubic-bezier(.5,0,.2,1) both}
.tt-root[data-stage="3"] .tt-b{clip-path:circle(150% at 50% 50%);animation:none}
.tt-root[data-stage="3"] .tt-a{visibility:hidden}
@keyframes ttRise{from{transform:translateY(28px) scale(.9) rotateX(14deg);opacity:0}to{transform:none;opacity:1}}
@keyframes ttReveal{from{clip-path:circle(0% at 50% 50%)}to{clip-path:circle(150% at 50% 50%)}}
.tt-root[data-stage="1"] .tt-a{animation:ttRise .7s var(--pw-out) both,ttCharge 1s ease-in-out .4s both}
@keyframes ttCharge{0%,100%{filter:none}50%{filter:brightness(1.35) saturate(1.2)}}
.tt-ring{position:absolute;left:50%;top:50%;width:70%;aspect-ratio:1;border-radius:50%;border:2px solid rgba(255,244,214,.8);opacity:0;transform:translate(-50%,-50%) scale(.4);pointer-events:none}
.tt-root[data-stage="1"] .tt-ring{animation:ttRing 1s ease-out both}
.tt-root[data-stage="2"] .tt-ring{animation:ttRing 1.1s ease-out both}
@keyframes ttRing{0%{opacity:.9;transform:translate(-50%,-50%) scale(.4)}100%{opacity:0;transform:translate(-50%,-50%) scale(1.6)}}
.tt-parts{position:absolute;left:50%;top:50%;width:0;height:0;pointer-events:none}
.tt-parts i{position:absolute;left:-3px;top:-3px;width:6px;height:6px;border-radius:50%;background:#ffe9a8;box-shadow:0 0 10px rgba(var(--accent),.95);opacity:0;animation:ppBurst 1.4s var(--pw-out) both;transform:scale(var(--s))}
.tt-text{text-align:center;max-width:380px;opacity:0;transform:translateY(14px);transition:opacity .6s ease,transform .6s var(--pw-out)}
.tt-root[data-stage="3"] .tt-text{opacity:1;transform:none}
.tt-kicker{margin:0;font-size:11px;letter-spacing:.34em;color:rgb(var(--accent));font-weight:700}
.tt-title{margin:8px 0 4px;font-family:Georgia,"Noto Naskh Arabic",serif;font-weight:500;font-size:30px;line-height:1.15;color:#fff3cf;overflow-wrap:anywhere}
.tt-from{margin:0;font-size:13.5px;color:var(--pw-mute)}
.tt-benefits{list-style:none;margin:14px 0 0;padding:0;display:flex;flex-direction:column;gap:7px}
.tt-benefits li{padding:9px 14px;border-radius:13px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);font-size:14px;color:#f3e7c7;animation:pwRise .5s var(--pw-out) calc(var(--i) * 90ms + .1s) both;overflow-wrap:anywhere}
.tt-note{margin:14px 0 0;font-size:12.5px;color:var(--pw-mute)}
.tt-go{max-width:380px;margin-top:18px}
.tt-root[data-mode="static"] .tt-a,.tt-root[data-mode="static"] .tt-glow,.tt-root[data-mode="static"] .tt-ring{animation:none!important}
.tt-root[data-mode="static"] .tt-glow,.tt-root[data-mode="static"] .tt-ring{display:none}
.tt-root[data-mode="static"] .tt-a{visibility:hidden}
.tt-root[data-mode="static"] .tt-b{clip-path:none;animation:none!important}
.tt-root[data-mode="lite"] .tt-b{transition:none}
@media (min-width:700px){.tt-panel{max-width:460px}}
`;

const CARD_INSTALL = `
/* ===================================================== MY CARD screen ===================================================== */
.cd{display:flex;flex-direction:column;gap:16px;padding-top:6px}
.cd-stage{position:relative;display:flex;flex-direction:column;align-items:center;gap:12px;padding:10px 0 4px}
.cd-stage .pc-flight{width:100%;max-width:440px}
.cd-hint{margin:0;font-size:12.5px;color:var(--pw-mute);text-align:center}
.cd-focusbtn{align-self:center}
.cd-facts{display:grid;grid-template-columns:1fr 1fr;gap:0;margin:0}
.cd-facts>div{padding:10px 8px;min-width:0}
.cd-facts dt{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--pw-mute);font-weight:650}
.cd-facts dd{margin:4px 0 0;font-size:15px;color:#fbf0d2;font-weight:650;overflow-wrap:anywhere}
.cd-ref{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.1em}
.cd-settings{padding:16px}
.cd-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 0;border-top:1px solid rgba(255,255,255,.08)}
.cd-row:first-of-type{border-top:0}
.cd-row>div{min-width:0}
.cd-row b{display:block;font-size:14.5px;color:#fbf0d2;font-weight:650}
.cd-row span{display:block;font-size:12.5px;line-height:1.5;color:var(--pw-mute);margin-top:2px;overflow-wrap:anywhere}
.cd-switch{position:relative;flex:none;width:56px;height:44px;border:0;background:transparent;cursor:pointer;padding:0}
.cd-switch::before{content:"";position:absolute;left:0;right:0;top:50%;height:28px;margin-top:-14px;border-radius:99px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);box-shadow:inset 0 2px 4px rgba(0,0,0,.5);transition:background var(--pw-nav)}
.cd-switch i{position:absolute;top:50%;inset-inline-start:5px;width:22px;height:22px;margin-top:-11px;border-radius:50%;background:linear-gradient(145deg,#fff3cf,#c9a24e);box-shadow:0 3px 6px rgba(0,0,0,.5);transition:inset-inline-start var(--pw-nav) var(--pw-spring)}
.cd-switch[aria-checked="true"]::before{background:rgba(var(--accent),.55);border-color:rgba(var(--accent),.8)}
.cd-switch[aria-checked="true"] i{inset-inline-start:29px}
.cd-switch:disabled{opacity:.6;cursor:not-allowed}
.cd-sec{margin-top:6px}
.cd-focus{position:absolute;inset:0;z-index:22;display:flex;align-items:center;justify-content:center}
.cd-focus-in{position:relative;width:min(94%,560px);padding:56px 0 20px;display:flex;flex-direction:column;align-items:center;gap:14px;outline:none;animation:pwPop .45s var(--pw-spring) both}
.cd-focus-in .pc-flight{width:100%}
.cd-focus-in .rs-close{top:0}
.pw-root[data-pw-mode="static"] .cd-focus-in{animation:pwFade .3s ease both}
/* ===================================================== INSTALL ===================================================== */
.in-banner{position:absolute;z-index:8;left:calc(14px + var(--sal));right:calc(14px + var(--sar));bottom:calc(var(--nav-h) + var(--sab) + 18px);max-width:440px;margin:0 auto;display:flex;align-items:center;gap:10px;padding:10px 10px 10px 14px;border-radius:20px;
  background:linear-gradient(150deg,rgba(34,38,52,.94),rgba(16,18,26,.96));border:1px solid rgba(var(--accent),.38);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 24px 44px -18px rgba(0,0,0,.95),inset 0 1px 0 rgba(255,255,255,.1)}
.in-ico{flex:none;width:38px;height:38px;border-radius:12px;display:inline-flex;align-items:center;justify-content:center;color:rgb(var(--accent));background:rgba(var(--accent),.14);border:1px solid rgba(var(--accent),.38)}
.in-txt{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.in-txt b{font-size:13.5px;color:#fbf0d2;font-weight:650}
.in-txt span{font-size:12px;color:var(--pw-mute)}
.in-add{flex:none;min-height:44px}
.in-x{flex:none;width:44px;height:44px;border-radius:50%;border:0;background:transparent;color:var(--pw-mute);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.in-steps{list-style:none;margin:6px 0 16px;padding:0;display:flex;flex-direction:column;gap:10px}
.in-steps li{display:flex;align-items:center;gap:12px;padding:12px;border-radius:14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);font-size:14px;line-height:1.5;color:var(--pw-ink)}
@media (max-width:359px){.in-banner{padding-inline-start:10px}.in-txt span{display:none}}
`;

export const PW_FEATURE_CSS = POINTS_TIER + HOME_TICKET + SHEETS_REWARDS + ACTIVITY_CHECKIN + ENTRY_TIER + CARD_INSTALL;
