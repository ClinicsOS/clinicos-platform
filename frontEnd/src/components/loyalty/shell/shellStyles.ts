/**
 * ClinicOS Loyalty — design tokens + shell styles (Phase 8). One scoped stylesheet (`lyx-` prefix, everything under `.lyx-root`), rendered once by
 * LoyaltyShell. Nothing here touches the rest of ClinicOS or globals.css.
 *
 * TOKENS: every colour / duration / easing / depth used by the Loyalty product is a variable defined in the first block. Components use the
 * variables (or the re-skinned ClinicOS tokens --card / --ink / --mute / --edge / --soft, which the shell redefines for its own subtree so the
 * older Loyalty screens adopt the new identity automatically) — there are no per-component hex palettes.
 *
 * MOTION: micro 120 · fast 200 · normal 320 · slow 560 · cinematic 1400 ms; two easings + one spring. prefers-reduced-motion (and the shell's
 * "static" mode) switches every animation and transition off; the "lite" mode removes blur-heavy layers and continuous loops.
 */
export const TOKENS_CSS = `
.lyx-root{
  /* surfaces */
  --lyx-bg:#07080c; --lyx-bg2:#0b0d13; --lyx-surface:#12151d; --lyx-surface2:#181c27; --lyx-glass:rgba(20,23,32,.68); --lyx-glass2:rgba(28,32,44,.72);
  /* ink */
  --lyx-ivory:#f5eedf; --lyx-text:#f3ecdd; --lyx-text2:#b3ad9f; --lyx-text3:#8a8578;
  /* accents */
  --lyx-gold:#e8c76a; --lyx-gold2:#c9a24a; --lyx-gold3:#8c6a22; --lyx-rose:#e68a9c; --lyx-mint:#6fd6b0; --lyx-danger:#f08a8a; --lyx-info:#9db7d9;
  --lyx-line:rgba(236,208,138,.16); --lyx-line2:rgba(236,208,138,.34); --lyx-glow:rgba(232,199,106,.34);
  /* tier materials (accent edge colours; the full materials live on the tier cards) */
  --lyx-t1:#8e9bb0; --lyx-t2:#cdd6e4; --lyx-t3:#e0b341; --lyx-t4:#9a78e6;
  /* motion */
  --lyx-micro:120ms; --lyx-fast:200ms; --lyx-normal:320ms; --lyx-slow:560ms; --lyx-cine:1400ms;
  --lyx-ease:cubic-bezier(.2,.8,.2,1); --lyx-ease-io:cubic-bezier(.65,0,.35,1); --lyx-spring:cubic-bezier(.3,1.35,.5,1);
  /* depth */
  --lyx-z1:6px; --lyx-z2:14px; --lyx-z3:28px;
  --lyx-sh1:0 1px 0 rgba(255,244,214,.06) inset,0 14px 30px -20px rgba(0,0,0,.9);
  --lyx-sh2:0 1px 0 rgba(255,244,214,.08) inset,0 26px 52px -26px rgba(0,0,0,.95),0 2px 0 rgba(0,0,0,.35);
  --lyx-dir:1;
  /* re-skin the ClinicOS tokens for everything inside Loyalty */
  --base:var(--lyx-bg); --hero:var(--lyx-bg2); --card:var(--lyx-surface); --card2:var(--lyx-surface2); --edge:var(--lyx-line); --ink:var(--lyx-text); --mute:var(--lyx-text2); --soft:rgba(236,208,138,.06);
  position:relative; min-height:100vh; color:var(--lyx-text); background:var(--lyx-bg); isolation:isolate;
}
[dir="rtl"] .lyx-root{--lyx-dir:-1}
`;

export const SHELL_CSS = `
/* ===================== base + legacy re-skin ===================== */
.lyx-root *{scrollbar-width:thin;scrollbar-color:rgba(236,208,138,.28) transparent}
.lyx-root ::selection{background:rgba(232,199,106,.3);color:#fff}
.lyx-root :focus-visible{outline:2px solid rgba(232,199,106,.95);outline-offset:2px}
.lyx-root .lyx-display{font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;letter-spacing:.01em}
[dir="rtl"] .lyx-root .lyx-display{font-family:inherit;font-weight:600;letter-spacing:0}
.lyx-root .lyx-num{font-family:Georgia,"Times New Roman",serif;font-feature-settings:"lnum" 1,"tnum" 1;font-variant-numeric:lining-nums tabular-nums}
.lyx-root .lyx-eyebrow{font-size:10px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:var(--lyx-gold)}
[dir="rtl"] .lyx-root .lyx-eyebrow{letter-spacing:.06em}
.lyx-root .text-sky{color:var(--lyx-gold)}
.lyx-root .border-sky,.lyx-root .hover\\:border-sky:hover,.lyx-root .focus\\:border-sky:focus{border-color:var(--lyx-line2)}
.lyx-root .focus-visible\\:ring-sky{--tw-ring-color:rgba(232,199,106,.9)}
.lyx-root .bg-sky\\/15{background-color:rgba(232,199,106,.12)}
.lyx-root .bg-sky\\/10{background-color:rgba(232,199,106,.09)}
.lyx-root .bg-teal{background-color:var(--lyx-mint);box-shadow:0 0 14px -2px rgba(111,214,176,.55)}
.lyx-root .bg-base{background:var(--lyx-bg)}
.lyx-root .btn-teal{position:relative;overflow:hidden;border-radius:12px;color:#2a1d05;font-weight:700;text-shadow:0 1px 0 rgba(255,255,255,.35);background:linear-gradient(180deg,#f3dc92 0%,#d8b45a 55%,#b78d36 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(90,60,10,.35),0 10px 20px -10px rgba(201,162,74,.65),0 1px 0 #6b4f16;transition:transform var(--lyx-micro) var(--lyx-ease),box-shadow var(--lyx-fast) var(--lyx-ease),filter var(--lyx-fast)}
.lyx-root .btn-teal::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.5) 50%,transparent 65%);transform:translateX(-130%);transition:transform var(--lyx-slow) var(--lyx-ease);pointer-events:none}
.lyx-root .btn-teal:hover:not(:disabled){filter:brightness(1.04)}
.lyx-root .btn-teal:hover:not(:disabled)::after{transform:translateX(130%)}
.lyx-root .btn-teal:active:not(:disabled){transform:translateY(1px) scale(.985);box-shadow:inset 0 1px 0 rgba(255,255,255,.4),0 4px 10px -6px rgba(201,162,74,.7),0 0 0 #6b4f16}
.lyx-root .btn-teal:disabled{filter:saturate(.5) brightness(.85)}
.lyx-root .btn-ghost{border-radius:12px;background:linear-gradient(180deg,rgba(255,244,214,.07),rgba(255,244,214,.02));border:1px solid var(--lyx-line);color:var(--lyx-ivory);transition:transform var(--lyx-micro) var(--lyx-ease),border-color var(--lyx-fast),background var(--lyx-fast),box-shadow var(--lyx-fast)}
.lyx-root .btn-ghost:hover:not(:disabled){border-color:var(--lyx-line2);background:linear-gradient(180deg,rgba(255,244,214,.11),rgba(255,244,214,.04));box-shadow:0 8px 18px -12px rgba(232,199,106,.45)}
.lyx-root .btn-ghost:active:not(:disabled){transform:translateY(1px) scale(.985)}
.lyx-root .btn-ghost:disabled{opacity:.5;cursor:not-allowed}
.lyx-root .inp{opacity:1;border-radius:12px;background:rgba(6,7,11,.62);border:1px solid var(--lyx-line);color:var(--lyx-ivory);box-shadow:inset 0 1px 2px rgba(0,0,0,.5);transition:border-color var(--lyx-fast),box-shadow var(--lyx-fast),background var(--lyx-fast)}
.lyx-root .inp:hover:not(:disabled){border-color:var(--lyx-line2)}
.lyx-root .inp:focus{border-color:var(--lyx-gold2);box-shadow:inset 0 1px 2px rgba(0,0,0,.5),0 0 0 3px rgba(232,199,106,.16);outline:none}
.lyx-root .inp:disabled{opacity:.55}
.lyx-root select.inp{color-scheme:dark}
.lyx-root .lbl{color:var(--lyx-text2);letter-spacing:.04em}
.lyx-root input[type="date"]{color-scheme:dark}
.lyx-root .pill{border:1px solid var(--lyx-line)}

/* ===================== frame ===================== */
.lyx-frame{position:relative;z-index:1;min-height:100vh;display:flex;gap:20px;max-width:1600px;margin:0 auto;padding:0}
.lyx-main{flex:1;min-width:0;display:flex;flex-direction:column}
.lyx-content{flex:1;min-width:0;padding:6px 16px 40px}
.lyx-page{animation:lyxPage var(--lyx-normal) var(--lyx-ease) both;transform-origin:50% 0}
@keyframes lyxPage{from{opacity:0;transform:translate3d(0,10px,0) scale(.994)}to{opacity:1;transform:none}}

/* ---- rail (laptop / desktop) ---- */
.lyx-rail{display:none}
@media (min-width:1024px){
  .lyx-frame{padding:18px 20px 18px 18px}
  .lyx-content{padding:4px 4px 48px}
  .lyx-rail{display:flex;flex-direction:column;position:sticky;top:18px;align-self:flex-start;width:248px;flex:none;height:calc(100vh - 36px);max-height:880px;border-radius:26px;padding:18px 14px 14px;background:linear-gradient(170deg,rgba(30,34,46,.82),rgba(12,14,20,.9));border:1px solid var(--lyx-line);box-shadow:var(--lyx-sh2);backdrop-filter:blur(16px) saturate(120%)}
  .lyx-rail::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(140deg,rgba(236,208,138,.16),transparent 35%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;padding:1px}
}
.lyx-brand{display:flex;align-items:center;gap:12px;padding:4px 6px 18px;color:var(--lyx-ivory);text-decoration:none}
.lyx-brand-mark{position:relative;display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:14px;color:#2a1d05;background:linear-gradient(145deg,#f6e19b,#c9a24a 60%,#9c7628);box-shadow:inset 0 1px 0 rgba(255,255,255,.6),0 10px 22px -10px rgba(201,162,74,.8),0 0 0 1px rgba(255,236,170,.25);transform:translateZ(0)}
.lyx-brand-text{display:flex;flex-direction:column;line-height:1.1;min-width:0}
.lyx-brand-text small{font-size:9px;letter-spacing:.3em;font-weight:700;color:var(--lyx-text2)}
.lyx-brand-text b{font-size:17px;font-weight:700;letter-spacing:.06em;color:var(--lyx-ivory)}
.lyx-brand-text b span{color:var(--lyx-gold)}
.lyx-nav{position:relative;display:flex;flex-direction:column;gap:3px;perspective:900px;perspective-origin:18% 50%}
.lyx-ind{position:absolute;inset-inline:0;top:0;height:var(--ind-h,44px);transform:translate3d(0,var(--ind-y,0px),0);border-radius:14px;pointer-events:none;background:linear-gradient(135deg,rgba(236,208,138,.2),rgba(236,208,138,.05) 70%);border:1px solid var(--lyx-line2);box-shadow:0 12px 24px -14px rgba(232,199,106,.55),inset 0 1px 0 rgba(255,244,214,.18);transition:transform var(--lyx-normal) var(--lyx-spring),height var(--lyx-normal) var(--lyx-ease);opacity:var(--ind-o,0)}
.lyx-ind::before{content:"";position:absolute;inset-inline-start:-1px;top:20%;bottom:20%;width:3px;border-radius:3px;background:linear-gradient(180deg,#fff0bd,var(--lyx-gold2));box-shadow:0 0 12px var(--lyx-glow)}
.lyx-nav-item{position:relative;z-index:1;display:flex;align-items:center;gap:12px;min-height:44px;padding:0 12px;border-radius:14px;color:var(--lyx-text2);font-size:13px;font-weight:600;text-decoration:none;cursor:pointer;background:none;border:0;text-align:start;width:100%;transition:transform var(--lyx-normal) var(--lyx-spring),color var(--lyx-fast),background var(--lyx-fast)}
.lyx-nav-item:hover{color:var(--lyx-ivory);background:rgba(255,244,214,.04);transform:translate3d(calc(var(--lyx-dir) * 2px),0,0)}
.lyx-nav-item .lyx-ico{display:inline-flex;transition:transform var(--lyx-fast) var(--lyx-spring)}
.lyx-nav-item:hover .lyx-ico{transform:scale(1.12) rotate(-4deg)}
.lyx-nav-item[aria-current="page"]{color:var(--lyx-ivory);background:none;transform:translate3d(calc(var(--lyx-dir) * 6px),0,18px)}
.lyx-nav-item[aria-current="page"] .lyx-ico{color:var(--lyx-gold)}
.lyx-badge{margin-inline-start:auto;display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:99px;font-size:10px;font-weight:800;color:#2a1d05;background:linear-gradient(180deg,#f3dc92,#c9a24a);box-shadow:0 4px 10px -4px rgba(201,162,74,.8),inset 0 1px 0 rgba(255,255,255,.5)}
.lyx-rail-foot{margin-top:auto;display:flex;flex-direction:column;gap:10px;padding-top:14px}
.lyx-back{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;border-radius:14px;border:1px solid var(--lyx-line);background:linear-gradient(180deg,rgba(255,244,214,.06),rgba(255,244,214,.015));color:var(--lyx-ivory);font-size:13px;font-weight:600;cursor:pointer;width:100%;transition:transform var(--lyx-micro) var(--lyx-ease),border-color var(--lyx-fast),box-shadow var(--lyx-fast)}
.lyx-back:hover{border-color:var(--lyx-line2);box-shadow:0 10px 20px -14px rgba(232,199,106,.6)}
.lyx-back:hover .lyx-back-ico{transform:translateX(calc(var(--lyx-dir) * -3px))}
.lyx-back:active{transform:scale(.985)}
.lyx-back-ico{display:inline-flex;transition:transform var(--lyx-fast) var(--lyx-ease)}
[dir="rtl"] .lyx-back-ico svg{transform:scaleX(-1)}
.lyx-user{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:14px;background:rgba(255,244,214,.03);border:1px solid var(--lyx-line);min-width:0}
.lyx-user-av{width:30px;height:30px;border-radius:50%;flex:none;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#2a1d05;background:linear-gradient(145deg,#f6e19b,#c9a24a)}
.lyx-user-tx{min-width:0;line-height:1.25}
.lyx-user-tx b{display:block;font-size:11px;color:var(--lyx-ivory);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lyx-user-tx span{display:block;font-size:10px;color:var(--lyx-text3);text-transform:capitalize}
/* short laptop windows: the rail (brand + 8 sections + user + "Back to ClinicOS") must always fit INSIDE its own frame */
@media (min-width:1024px) and (max-height:780px){
  .lyx-rail{padding:14px 12px 12px}
  .lyx-brand{padding-bottom:10px}
  .lyx-nav-item{min-height:38px}
  .lyx-rail-foot{gap:8px;padding-top:10px}
  .lyx-user{padding:6px 10px}
  .lyx-back{min-height:40px}
}
@media (min-width:1024px) and (max-height:640px){
  .lyx-nav{gap:1px}
  .lyx-nav-item{min-height:34px}
  .lyx-brand{padding-bottom:8px}
  .lyx-user{padding:5px 10px}
  .lyx-back{min-height:38px}
}
@media (min-width:1024px) and (max-height:600px){
  .lyx-nav{flex:1 1 auto;min-height:0;overflow-y:auto;scrollbar-width:none}
  .lyx-nav::-webkit-scrollbar{display:none}
  .lyx-user{display:none}
}
.lyx-rail-foot{flex:none}

/* ---- top bar ---- */
.lyx-top{position:sticky;top:0;z-index:30;padding:10px 16px 0;background:linear-gradient(180deg,rgba(7,8,12,.92),rgba(7,8,12,.7) 80%,transparent)}
@supports (backdrop-filter:blur(1px)){.lyx-top{backdrop-filter:blur(10px)}}
@media (min-width:1024px){.lyx-top{position:relative;top:auto;padding:4px 4px 14px;background:none;backdrop-filter:none}}
.lyx-top-row{display:flex;align-items:center;gap:10px;min-height:44px}
.lyx-top-mark{display:inline-flex;flex:none}
@media (min-width:1024px){.lyx-top-mark{display:none}}
.lyx-top-mark .lyx-brand-mark{width:34px;height:34px;border-radius:11px}
.lyx-title{display:block;min-width:0;flex:1}
.lyx-title h1{font-size:18px;line-height:1.2;font-weight:600;color:var(--lyx-ivory);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lyx-title p{display:none;margin-top:2px;font-size:12px;color:var(--lyx-text2)}
@media (min-width:640px){.lyx-title p{display:block}}
@media (min-width:1024px){.lyx-title h1{font-size:26px;white-space:normal}}
.lyx-pend{display:none;align-items:center;gap:8px}
@media (min-width:1024px){.lyx-pend{display:flex}}
.lyx-skip{position:absolute;inset-inline-start:12px;top:-60px;z-index:120;padding:10px 14px;border-radius:12px;background:var(--lyx-gold);color:#2a1d05;font-weight:700;font-size:12px;text-decoration:none}
.lyx-skip:focus{top:10px}
.lyx-root .lyx-main-el:focus,.lyx-root .lyx-main-el:focus-visible{outline:none}
.lyx-top-back{display:inline-flex}
@media (min-width:1024px){.lyx-top-back{display:none}}
.lyx-tools{display:flex;align-items:center;gap:8px;margin-inline-start:auto}
.lyx-chip{display:inline-flex;align-items:center;gap:7px;min-height:32px;padding:0 12px;border-radius:99px;font-size:11px;font-weight:600;color:var(--lyx-ivory);background:rgba(255,244,214,.05);border:1px solid var(--lyx-line);text-decoration:none;cursor:pointer;white-space:nowrap;transition:border-color var(--lyx-fast),background var(--lyx-fast),transform var(--lyx-micro)}
.lyx-chip:hover{border-color:var(--lyx-line2);background:rgba(255,244,214,.09)}
.lyx-chip:active{transform:scale(.98)}
.lyx-chip b{font-variant-numeric:tabular-nums;color:var(--lyx-gold)}
.lyx-chip .lyx-dot{width:7px;height:7px;border-radius:50%;background:var(--lyx-gold);box-shadow:0 0 8px var(--lyx-glow)}
.lyx-seg{display:inline-flex;border-radius:12px;overflow:hidden;border:1px solid var(--lyx-line);background:rgba(255,244,214,.04)}
.lyx-seg button{min-width:38px;min-height:34px;padding:0 10px;font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--lyx-text2);background:none;border:0;cursor:pointer;transition:color var(--lyx-fast),background var(--lyx-fast)}
.lyx-seg button[aria-pressed="true"]{color:#2a1d05;background:linear-gradient(180deg,#f3dc92,#c9a24a)}
.lyx-seg button:not([aria-pressed="true"]):hover{color:var(--lyx-ivory)}
.lyx-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:12px;color:var(--lyx-ivory);background:rgba(255,244,214,.05);border:1px solid var(--lyx-line);cursor:pointer;transition:border-color var(--lyx-fast),background var(--lyx-fast),transform var(--lyx-micro)}
.lyx-iconbtn:hover{border-color:var(--lyx-line2);background:rgba(255,244,214,.09)}
.lyx-iconbtn:active{transform:scale(.96)}
.lyx-iconbtn[aria-pressed="true"]{color:var(--lyx-gold);border-color:var(--lyx-line2)}
[dir="rtl"] .lyx-iconbtn .rtl-flip-ico{transform:scaleX(-1)}

/* ---- chips nav (mobile / tablet) ---- */
.lyx-chips{position:relative;display:flex;gap:6px;margin:8px -16px 0;padding:2px 16px 10px;overflow-x:auto;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}
.lyx-chips::-webkit-scrollbar{display:none}
@media (min-width:1024px){.lyx-chips{display:none}}
.lyx-chip-nav{position:relative;flex:none;scroll-snap-align:center;display:inline-flex;align-items:center;gap:7px;min-height:40px;padding:0 14px;border-radius:99px;font-size:12px;font-weight:600;color:var(--lyx-text2);background:rgba(255,244,214,.04);border:1px solid var(--lyx-line);text-decoration:none;cursor:pointer;white-space:nowrap;transition:color var(--lyx-fast),background var(--lyx-fast),border-color var(--lyx-fast),transform var(--lyx-fast) var(--lyx-spring)}
.lyx-chip-nav[aria-current="page"]{color:#2a1d05;border-color:rgba(255,236,170,.5);background:linear-gradient(180deg,#f3dc92,#c9a24a);box-shadow:0 10px 18px -10px rgba(201,162,74,.8),inset 0 1px 0 rgba(255,255,255,.5);transform:translateY(-1px)}
.lyx-chip-nav .lyx-badge{box-shadow:none;background:#2a1d05;color:var(--lyx-gold);margin-inline-start:2px}

/* ===================== entry choreography ===================== */
.lyx-root[data-phase="splash"] .lyx-rail,.lyx-root[data-phase="splash"] .lyx-main{opacity:0}
.lyx-root[data-phase="ready"][data-entered="true"] .lyx-rail{animation:lyxRailIn var(--lyx-slow) var(--lyx-ease) both}
.lyx-root[data-phase="ready"][data-entered="true"] .lyx-main{animation:lyxMainIn var(--lyx-slow) var(--lyx-ease) 90ms both}
@keyframes lyxRailIn{from{opacity:0;transform:translate3d(calc(var(--lyx-dir) * -28px),0,0) rotateY(calc(var(--lyx-dir) * 10deg))}to{opacity:1;transform:none}}
@keyframes lyxMainIn{from{opacity:0;transform:translate3d(0,16px,0) scale(.99)}to{opacity:1;transform:none}}
.lyx-root.is-exiting .lyx-frame{animation:lyxExit var(--lyx-normal) var(--lyx-ease-io) forwards}
@keyframes lyxExit{to{opacity:0;transform:scale(.985) translate3d(0,6px,0);filter:blur(2px)}}
.lyx-veil{position:fixed;inset:0;z-index:95;pointer-events:none;opacity:0;background:radial-gradient(70% 55% at 50% 42%,#14110a 0%,#07080c 75%)}
.lyx-root.is-exiting .lyx-veil{pointer-events:auto;animation:lyxVeil var(--lyx-normal) var(--lyx-ease-io) 60ms forwards}
@keyframes lyxVeil{to{opacity:1}}

/* ===================== splash ===================== */
.lyx-splash{position:fixed;inset:0;z-index:90;display:flex;align-items:center;justify-content:center;flex-direction:column;overflow:hidden;color:var(--lyx-ivory);background:radial-gradient(80% 60% at 50% 38%,#17130a 0%,#0a0a0e 55%,#07080c 100%);perspective:1300px;cursor:pointer}
.lyx-splash.is-out{animation:lyxSplashOut 360ms var(--lyx-ease-io) forwards;pointer-events:none}
@keyframes lyxSplashOut{to{opacity:0;transform:scale(1.08);filter:blur(6px)}}
.lyx-splash-glow{position:absolute;left:50%;top:40%;width:120vmax;height:120vmax;margin:-60vmax 0 0 -60vmax;border-radius:50%;background:radial-gradient(circle,rgba(232,199,106,.16),rgba(232,199,106,.05) 22%,transparent 44%);transform:scale(.2);opacity:0;animation:lyxGlow 1500ms var(--lyx-ease) forwards}
@keyframes lyxGlow{0%{transform:scale(.2);opacity:0}30%{opacity:1}100%{transform:scale(1);opacity:.85}}
.lyx-splash-stage{position:relative;width:min(70vw,330px);aspect-ratio:1.58/1;transform-style:preserve-3d;transform:rotateX(8deg) rotateY(-14deg)}
.lyx-sp-card{position:absolute;inset:0;border-radius:24px;opacity:0;transform-style:preserve-3d;box-shadow:inset 0 0 0 1.5px var(--rim),0 24px 50px -20px rgba(0,0,0,.9),0 0 40px -10px var(--glow);background:var(--face);animation:lyxSpCard 900ms var(--lyx-ease) forwards;animation-delay:calc(var(--i) * 130ms + 120ms)}
.lyx-sp-card[data-m="1"]{--i:0;--rim:rgba(190,202,218,.4);--glow:rgba(150,165,185,.3);--face:radial-gradient(130% 100% at 12% 0%,#3a424d 0%,#1c2027 60%,#12151a 100%);--tx:-46px;--ty:-34px;--rz:-9deg}
.lyx-sp-card[data-m="2"]{--i:1;--rim:rgba(255,255,255,.8);--glow:rgba(190,205,225,.4);--face:linear-gradient(135deg,#eef1f5 0%,#b4bdc9 38%,#e3e8ee 56%,#8d97a6 100%);--tx:-23px;--ty:-17px;--rz:-4.5deg}
.lyx-sp-card[data-m="3"]{--i:2;--rim:rgba(255,243,200,.9);--glow:rgba(240,200,100,.6);--face:linear-gradient(135deg,#f8e19a 0%,#cf9f33 38%,#f3d67f 56%,#a67a1d 100%);--tx:0px;--ty:0px;--rz:0deg}
@keyframes lyxSpCard{0%{opacity:0;transform:translate3d(0,40px,-900px) rotateY(-40deg) rotateZ(0)}55%{opacity:1}100%{opacity:1;transform:translate3d(var(--tx),var(--ty),calc(var(--i) * 26px)) rotateZ(var(--rz))}}
.lyx-sp-face{position:absolute;inset:0;border-radius:inherit;overflow:hidden;color:#3b2806;display:flex;flex-direction:column;justify-content:space-between;padding:6% 7%}
.lyx-sp-face .lyx-sp-top{display:flex;align-items:center;gap:8px;font-size:11px;font-weight:800;letter-spacing:.22em}
.lyx-sp-face .lyx-sp-mark{width:30px;height:30px;border-radius:50%;border:1px solid rgba(59,40,6,.55);display:flex;align-items:center;justify-content:center}
.lyx-sp-face .lyx-sp-foot{font-size:9px;letter-spacing:.28em;font-weight:800;opacity:.7}
.lyx-sp-sweep{position:absolute;inset:-20%;background:linear-gradient(105deg,transparent 42%,rgba(255,244,205,.85) 50%,transparent 58%);mix-blend-mode:screen;transform:translateX(-140%);animation:lyxSpSweep 760ms var(--lyx-ease-io) 620ms forwards;pointer-events:none}
@keyframes lyxSpSweep{to{transform:translateX(140%)}}
.lyx-splash-word{position:relative;margin-top:44px;text-align:center}
.lyx-splash-word small{display:block;font-size:12px;letter-spacing:.52em;font-weight:700;color:var(--lyx-text2);padding-inline-start:.52em;opacity:0;animation:lyxSpWord 520ms var(--lyx-ease) 520ms forwards}
.lyx-splash-word b{display:block;margin-top:8px;font-size:clamp(30px,8vw,44px);letter-spacing:.34em;padding-inline-start:.34em;font-weight:600;background:linear-gradient(180deg,#fff2c4,#e8c76a 55%,#b78d36);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 2px 0 rgba(0,0,0,.4)) drop-shadow(0 0 18px rgba(232,199,106,.35));opacity:0;animation:lyxSpWord 560ms var(--lyx-ease) 640ms forwards}
.lyx-splash-word em{display:block;margin-top:14px;font-style:normal;font-size:11px;letter-spacing:.3em;color:var(--lyx-text2);opacity:0;animation:lyxSpWord 520ms var(--lyx-ease) 860ms forwards}
[dir="rtl"] .lyx-splash-word small,[dir="rtl"] .lyx-splash-word b,[dir="rtl"] .lyx-splash-word em{letter-spacing:.08em;padding-inline-start:0}
@keyframes lyxSpWord{from{opacity:0;transform:translate3d(0,14px,0)}to{opacity:1;transform:none}}
.lyx-splash-skip{position:absolute;bottom:22px;font-size:10px;letter-spacing:.2em;color:var(--lyx-text3);opacity:0;animation:lyxSpWord 400ms ease 900ms forwards}

/* ===================== atmosphere (background depth) ===================== */
.lyx-atmo{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;background:linear-gradient(180deg,#07080c 0%,#0a0b11 55%,#08090d 100%)}
.lyx-atmo::before{content:"";position:absolute;inset:0;background:radial-gradient(60% 50% at 88% -8%,rgba(232,199,106,.17),transparent 62%),radial-gradient(48% 44% at 2% 108%,rgba(230,138,156,.09),transparent 62%),radial-gradient(40% 38% at 52% 122%,rgba(111,214,176,.06),transparent 62%)}
.lyx-atmo-grid{position:absolute;left:-30%;right:-30%;bottom:-12%;height:58%;transform:perspective(700px) rotateX(64deg);transform-origin:50% 100%;background-image:linear-gradient(rgba(236,208,138,.075) 1px,transparent 1px),linear-gradient(90deg,rgba(236,208,138,.075) 1px,transparent 1px);background-size:58px 58px;-webkit-mask-image:linear-gradient(to top,#000 0%,transparent 88%);mask-image:linear-gradient(to top,#000 0%,transparent 88%);opacity:.6}
.lyx-atmo-orb{position:absolute;border-radius:50%;will-change:transform;opacity:.7}
.lyx-atmo-orb.a{width:46vmax;height:46vmax;right:-14vmax;top:-18vmax;background:radial-gradient(circle,rgba(232,199,106,.12),transparent 62%);animation:lyxDrift 34s ease-in-out infinite alternate}
.lyx-atmo-orb.b{width:38vmax;height:38vmax;left:-14vmax;bottom:-16vmax;background:radial-gradient(circle,rgba(230,138,156,.08),transparent 62%);animation:lyxDrift 41s ease-in-out -9s infinite alternate-reverse}
@keyframes lyxDrift{from{transform:translate3d(0,0,0)}to{transform:translate3d(-4vmax,3vmax,0)}}
.lyx-atmo canvas{position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity var(--lyx-slow) var(--lyx-ease)}
.lyx-atmo.is-live canvas{opacity:1}

/* ===================== modes ===================== */
.lyx-root[data-lyx-mode="lite"] .lyx-atmo-orb,.lyx-root[data-lyx-mode="lite"] .lyx-atmo-grid{animation:none}
.lyx-root[data-lyx-mode="lite"] .lyx-rail,.lyx-root[data-lyx-mode="lite"] .lyx-top{backdrop-filter:none;-webkit-backdrop-filter:none}
.lyx-root[data-lyx-mode="lite"] .lyx-surface{backdrop-filter:none;-webkit-backdrop-filter:none}
.lyx-root[data-lyx-mode="static"] *,.lyx-root[data-lyx-mode="static"] *::before,.lyx-root[data-lyx-mode="static"] *::after{animation:none!important}
.lyx-root[data-lyx-mode="static"] *{transition:none!important}
.lyx-root[data-lyx-mode="static"] .lyx-nav-item[aria-current="page"],.lyx-root[data-lyx-mode="static"] .lyx-nav-item:hover{transform:none}
.lyx-root[data-lyx-mode="static"] .lyx-page{animation:lyxFade 160ms linear both!important}
.lyx-root[data-lyx-mode="static"] .lyx-splash{animation:none!important}
.lyx-root[data-lyx-mode="static"] .lyx-splash-stage{transform:none}
.lyx-root[data-lyx-mode="static"] .lyx-sp-card,.lyx-root[data-lyx-mode="static"] .lyx-splash-word small,.lyx-root[data-lyx-mode="static"] .lyx-splash-word b,.lyx-root[data-lyx-mode="static"] .lyx-splash-word em,.lyx-root[data-lyx-mode="static"] .lyx-splash-skip{opacity:1;animation:none!important}
.lyx-root[data-lyx-mode="static"] .lyx-sp-card[data-m="1"],.lyx-root[data-lyx-mode="static"] .lyx-sp-card[data-m="2"]{display:none}
.lyx-root[data-lyx-mode="static"] .lyx-sp-card[data-m="3"]{transform:none}
.lyx-root[data-lyx-mode="static"] .lyx-sp-sweep,.lyx-root[data-lyx-mode="static"] .lyx-splash-glow{display:none}
.lyx-root[data-lyx-mode="static"] .lyx-splash.is-out{animation:lyxFade 160ms linear reverse forwards!important}
.lyx-root[data-lyx-mode="static"].is-exiting .lyx-frame{opacity:0;transition:opacity 160ms linear!important;animation:none!important}
.lyx-root[data-lyx-mode="static"].is-exiting .lyx-veil{opacity:1;transition:opacity 160ms linear!important;animation:none!important}
@keyframes lyxFade{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){
  .lyx-root *,.lyx-root *::before,.lyx-root *::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}
}
`;
