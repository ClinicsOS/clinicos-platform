/**
 * ClinicOS Loyalty — section-specific styles (Phase 8). Same rules as uiStyles.ts: scoped under `.lyx-root`, tokens only.
 * Sections: HERO (overview ecosystem) · more are appended below as each screen is built.
 */
export const HERO_CSS = `
/* ===================== overview hero ===================== */
.lyx-hero{position:relative;display:grid;gap:8px;padding:clamp(20px,3vw,34px);overflow:hidden;border-radius:30px;border:1px solid var(--lyx-line2);background:radial-gradient(90% 120% at 82% 20%,rgba(120,92,30,.32),transparent 60%),linear-gradient(150deg,rgba(30,30,38,.86),rgba(11,12,18,.92));box-shadow:var(--lyx-sh2)}
.lyx-hero::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(140deg,rgba(255,236,170,.2),transparent 30%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;padding:1px}
@media (min-width:1024px){.lyx-hero{grid-template-columns:minmax(0,1fr) minmax(0,480px);align-items:center;gap:16px;min-height:380px}}
.lyx-hero-copy{position:relative;z-index:2;min-width:0}
.lyx-hero-copy h2{margin-top:12px;font-size:clamp(28px,4.4vw,44px);line-height:1.1;font-weight:600;color:var(--lyx-ivory);word-break:break-word}
.lyx-hero-copy p{margin-top:12px;max-width:430px;font-size:13px;line-height:1.7;color:var(--lyx-text2)}
.lyx-hero-status{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.lyx-hero-cta{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.lyx-hero-cta .btn-teal,.lyx-hero-cta .btn-ghost{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;padding:0 18px;font-size:13px}

.lyx-stage{position:relative;height:clamp(300px,40vw,390px);perspective:1250px;perspective-origin:50% 38%;min-width:0}
.lyx-stage-in{position:absolute;inset:0;transform-style:preserve-3d;transform:rotateX(calc(var(--prx,0) * 1deg)) rotateY(calc(var(--pry,0) * 1deg));transition:transform .6s var(--lyx-ease)}
.lyx-hero-card{position:absolute;left:50%;top:48%;width:min(300px,66%);transform:translate(-50%,-50%)}
.lyx-floor{position:absolute;left:50%;top:84%;width:78%;aspect-ratio:2.4/1;transform:translate(-50%,-50%) rotateX(72deg);border-radius:50%;background:radial-gradient(ellipse,rgba(232,199,106,.28),rgba(232,199,106,.06) 55%,transparent 72%);box-shadow:0 0 0 1px rgba(232,199,106,.16),0 0 0 14px rgba(232,199,106,.04),0 0 0 34px rgba(232,199,106,.025)}

.lyx-ring3d{position:absolute;left:50%;top:48%;width:0;height:0;transform-style:preserve-3d;transform:rotateX(-22deg)}
.lyx-spin{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d;animation:lyxSpin 52s linear infinite}
.lyx-sat{position:absolute;left:0;top:0;width:0;height:0;transform-style:preserve-3d;transform:rotateY(var(--a)) translateZ(var(--r,190px))}
.lyx-sat-in{position:absolute;left:0;top:0;width:172px;height:52px;margin:-26px 0 0 -86px;animation:lyxCounter 52s linear infinite}
@keyframes lyxSpin{to{transform:rotateY(360deg)}}
@keyframes lyxCounter{from{transform:rotateY(calc(var(--a) * -1)) rotateX(22deg)}to{transform:rotateY(calc(var(--a) * -1 - 360deg)) rotateX(22deg)}}

.lyx-sat-chip{display:flex;align-items:center;gap:9px;width:100%;height:100%;padding:0 12px 0 8px;border-radius:16px;color:var(--lyx-ivory);text-decoration:none;background:linear-gradient(145deg,rgba(255,244,214,.16),rgba(255,244,214,.04)),rgba(18,20,28,.86);border:1px solid var(--lyx-line2);box-shadow:0 14px 26px -12px rgba(0,0,0,.95),0 0 22px -10px var(--lyx-glow),inset 0 1px 0 rgba(255,244,214,.2)}
[dir="rtl"] .lyx-sat-chip{padding:0 8px 0 12px}
.lyx-sat-chip i{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;flex:none;color:var(--lyx-gold);background:rgba(232,199,106,.12);border:1px solid var(--lyx-line)}
.lyx-sat-chip[data-tone="mint"] i{color:var(--lyx-mint);background:rgba(111,214,176,.1);border-color:rgba(111,214,176,.3)}
.lyx-sat-chip[data-tone="rose"] i{color:var(--lyx-rose);background:rgba(230,138,156,.1);border-color:rgba(230,138,156,.3)}
.lyx-sat-chip span{display:flex;flex-direction:column;min-width:0;line-height:1.15}
.lyx-sat-chip b{font-size:16px;font-weight:600;font-variant-numeric:lining-nums tabular-nums;font-family:Georgia,"Times New Roman",serif}
.lyx-sat-chip em{font-style:normal;font-size:9px;font-weight:600;letter-spacing:.03em;color:var(--lyx-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* lite / static / small: no orbit — the same real facts as a tidy grid under the card */
.lyx-sat-grid{display:none}
.lyx-root[data-lyx-mode="lite"] .lyx-ring3d,.lyx-root[data-lyx-mode="static"] .lyx-ring3d{display:none}
.lyx-root[data-lyx-mode="lite"] .lyx-sat-grid,.lyx-root[data-lyx-mode="static"] .lyx-sat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(138px,1fr));gap:8px;position:relative;z-index:2}
.lyx-root[data-lyx-mode="lite"] .lyx-sat-grid .lyx-sat-chip,.lyx-root[data-lyx-mode="static"] .lyx-sat-grid .lyx-sat-chip{height:54px}
.lyx-sat-grid .lyx-sat-chip em{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lyx-root[data-lyx-mode="lite"] .lyx-stage,.lyx-root[data-lyx-mode="static"] .lyx-stage{height:auto;padding:6px 0 18px}
.lyx-root[data-lyx-mode="lite"] .lyx-hero-card,.lyx-root[data-lyx-mode="static"] .lyx-hero-card{position:relative;left:auto;top:auto;transform:none;margin:0 auto 18px;width:min(300px,86%)}
.lyx-root[data-lyx-mode="lite"] .lyx-stage-in,.lyx-root[data-lyx-mode="static"] .lyx-stage-in{position:relative;inset:auto;transform:none}
.lyx-root[data-lyx-mode="lite"] .lyx-floor,.lyx-root[data-lyx-mode="static"] .lyx-floor{display:none}
.lyx-root[data-lyx-mode="static"] .lyx-spin,.lyx-root[data-lyx-mode="static"] .lyx-sat-in{animation:none}

/* ===================== metrics grid ===================== */
.lyx-grid-metrics{display:grid;gap:12px;grid-template-columns:repeat(2,minmax(0,1fr))}
@media (min-width:1024px){.lyx-grid-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}}
.lyx-span2{grid-column:span 2}
.lyx-attn{display:flex;flex-direction:column;gap:10px;padding:16px}
.lyx-attn-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:14px;background:rgba(255,244,214,.04);border:1px solid var(--lyx-line);color:inherit;text-decoration:none;transition:border-color var(--lyx-fast),background var(--lyx-fast),transform var(--lyx-fast) var(--lyx-ease)}
.lyx-attn-row:hover{border-color:var(--lyx-line2);background:rgba(255,244,214,.07);transform:translate3d(calc(var(--lyx-dir) * 3px),0,0)}
.lyx-attn-row b{font-size:22px;font-weight:600;color:var(--lyx-ivory);font-family:Georgia,serif;min-width:30px}
.lyx-attn-row>span{flex:1;min-width:0;font-size:12px;color:var(--lyx-text2)}
.lyx-layout-2{display:grid;gap:12px}
@media (min-width:1024px){.lyx-layout-2{grid-template-columns:minmax(0,7fr) minmax(0,5fr)}}
.lyx-live{display:inline-flex;align-items:center;gap:6px;font-size:10px;font-weight:700;letter-spacing:.12em;color:var(--lyx-mint)}
.lyx-live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--lyx-mint);box-shadow:0 0 0 0 rgba(111,214,176,.6);animation:lyxLive 2s ease-out infinite}
@keyframes lyxLive{0%{box-shadow:0 0 0 0 rgba(111,214,176,.55)}100%{box-shadow:0 0 0 9px rgba(111,214,176,0)}}
.lyx-member-row{display:flex;align-items:center;gap:12px;padding:9px 4px;border-radius:12px;min-width:0}
.lyx-member-row+.lyx-member-row{border-top:1px solid rgba(236,208,138,.08)}
.lyx-member-row .nm{min-width:0;flex:1;line-height:1.3}
.lyx-member-row .nm b{display:block;font-size:12.5px;font-weight:600;color:var(--lyx-ivory);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lyx-member-row .nm span{display:block;font-size:10.5px;color:var(--lyx-text3)}
.lyx-member-row .pt{font-size:15px;font-weight:600;font-family:Georgia,serif;font-variant-numeric:lining-nums tabular-nums;color:var(--lyx-ivory)}
`;

export const MEMBERS_CSS = `
/* ===================== members ===================== */
.lyx-mrow{position:relative;display:flex;align-items:center;gap:12px;width:100%;padding:11px 14px 11px 18px;border-radius:18px;text-align:start;color:inherit;cursor:pointer;background:linear-gradient(145deg,rgba(255,244,214,.05),rgba(255,244,214,.012));border:1px solid var(--lyx-line);overflow:hidden;transition:transform var(--lyx-fast) var(--lyx-ease),border-color var(--lyx-fast),background var(--lyx-fast),box-shadow var(--lyx-fast)}
[dir="rtl"] .lyx-mrow{padding:11px 18px 11px 14px}
.lyx-mrow::before{content:"";position:absolute;inset-block:0;inset-inline-start:0;width:5px;background:var(--edge-m,rgba(236,208,138,.2))}
.lyx-mrow[data-tier="tier1"]{--edge-m:linear-gradient(180deg,#5d6676,#2c323c)}
.lyx-mrow[data-tier="tier2"]{--edge-m:linear-gradient(180deg,#f4f7fb,#9aa5b5 55%,#dfe5ee)}
.lyx-mrow[data-tier="tier3"]{--edge-m:linear-gradient(180deg,#f8e19a,#c99a2e 55%,#f3d67f)}
.lyx-mrow[data-tier="tier4"]{--edge-m:linear-gradient(180deg,#c9a0ff,#40306c 55%,#e8c496)}
.lyx-mrow:hover{transform:translate3d(calc(var(--lyx-dir) * 3px),0,0);border-color:var(--lyx-line2);background:linear-gradient(145deg,rgba(255,244,214,.09),rgba(255,244,214,.025));box-shadow:0 14px 28px -20px rgba(0,0,0,.9)}
.lyx-mrow:active{transform:scale(.995)}
.lyx-sheet-bg{position:fixed;inset:0;z-index:70;display:flex;justify-content:flex-end;background:rgba(3,4,7,.68);animation:lyxFadeIn var(--lyx-fast) linear both}
@supports (backdrop-filter:blur(1px)){.lyx-sheet-bg{backdrop-filter:blur(5px)}}
.lyx-sheet{display:flex;flex-direction:column;width:100%;max-width:30rem;height:100%;overflow:hidden;background:linear-gradient(170deg,#161a24,#0b0d13);border-inline-start:1px solid var(--lyx-line2);box-shadow:-30px 0 80px -30px rgba(0,0,0,.95);animation:lyxSlide var(--lyx-normal) var(--lyx-ease) both}
[dir="rtl"] .lyx-sheet{animation-name:lyxSlideRtl}
@keyframes lyxSlide{from{transform:translate3d(40px,0,0);opacity:0}to{transform:none;opacity:1}}
@keyframes lyxSlideRtl{from{transform:translate3d(-40px,0,0);opacity:0}to{transform:none;opacity:1}}
.lyx-sheet-h{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--lyx-line)}
.lyx-sheet-body{min-height:0;flex:1;overflow-y:auto;padding:16px 18px 28px}
.lyx-pts[data-tier-accent="tier1"]{border-color:rgba(190,202,218,.35)}
.lyx-pts[data-tier-accent="tier2"]{border-color:rgba(255,255,255,.5)}
.lyx-pts[data-tier-accent="tier3"]{border-color:rgba(255,243,200,.5)}
.lyx-pts[data-tier-accent="tier4"]{border-color:rgba(201,160,255,.5)}
.lyx-stagebox{border-radius:22px;padding:18px;background:radial-gradient(100% 120% at 50% 0%,rgba(120,92,30,.28),rgba(8,9,13,.6) 70%);border:1px solid var(--lyx-line)}
`;

export const CHECKIN_CSS = `
/* ===================== check-ins ===================== */
.lyx-ck-list{perspective:1000px}
.lyx-ck{position:relative;padding:16px;border-radius:22px;border:1px solid rgba(232,199,106,.34);background:linear-gradient(150deg,rgba(90,70,26,.34),rgba(16,17,23,.88));box-shadow:0 22px 40px -28px rgba(0,0,0,.95),0 0 40px -26px var(--lyx-glow);animation:lyxArrive 720ms var(--lyx-spring) both;animation-delay:calc(var(--i,0) * 90ms);transition:border-color var(--lyx-normal),background var(--lyx-normal),opacity var(--lyx-normal)}
@keyframes lyxArrive{0%{opacity:0;transform:translate3d(0,26px,-150px) rotateX(-22deg)}55%{opacity:1}100%{opacity:1;transform:none}}
.lyx-ck-av{position:relative;display:inline-flex;flex:none}
.lyx-ck-av i{position:absolute;inset:-4px;border-radius:50%;border:1.5px solid var(--lyx-gold);opacity:0;animation:lyxPulse 2.2s ease-out infinite}
.lyx-ck[data-out="confirmed"]{border-color:rgba(111,214,176,.55);background:linear-gradient(150deg,rgba(40,100,78,.34),rgba(16,17,23,.88));box-shadow:0 22px 40px -28px rgba(0,0,0,.95),0 0 46px -18px rgba(111,214,176,.55)}
.lyx-ck[data-out="rejected"]{border-color:rgba(240,138,138,.3);background:linear-gradient(150deg,rgba(80,40,40,.22),rgba(16,17,23,.88));opacity:.78}
.lyx-ck-done{display:flex;align-items:center;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid var(--lyx-line);animation:lyxRise var(--lyx-normal) var(--lyx-ease) both}
.lyx-mini-burst{display:inline-flex;width:40px;height:40px}
.lyx-mini-burst .lyx-burst{transform:scale(.62);transform-origin:center;margin:-12px}
`;

export const REWARD_CSS = `
/* ===================== reward object ===================== */
.lyx-rwo-wrap{filter:drop-shadow(0 22px 22px rgba(0,0,0,.55));animation:lyxRise var(--lyx-normal) var(--lyx-ease) both;animation-delay:calc(var(--i,0) * 60ms);perspective:1000px}
.lyx-rwo{--rx:0deg;--ry:0deg;--mx:30%;--my:10%;position:relative;padding:18px 18px 16px;border-radius:26px;color:var(--lyx-ivory);overflow:hidden;background:radial-gradient(120% 90% at 8% 0%,rgba(150,115,38,.42),transparent 55%),linear-gradient(155deg,#241f14 0%,#15161d 52%,#0d0e13 100%);border:1px solid var(--lyx-line2);transform:rotateX(var(--rx)) rotateY(var(--ry));transition:transform .28s ease-out,border-color var(--lyx-fast);-webkit-mask:radial-gradient(circle 12px at 0 var(--notch,118px),transparent 97%,#000) left/51% 100% no-repeat,radial-gradient(circle 12px at 100% var(--notch,118px),transparent 97%,#000) right/51% 100% no-repeat;mask:radial-gradient(circle 12px at 0 var(--notch,118px),transparent 97%,#000) left/51% 100% no-repeat,radial-gradient(circle 12px at 100% var(--notch,118px),transparent 97%,#000) right/51% 100% no-repeat}
.lyx-rwo::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 1px rgba(255,236,170,.14),inset 0 1px 0 rgba(255,244,214,.18)}
.lyx-rwo:hover{border-color:rgba(255,236,170,.6)}
.lyx-rwo[data-status="inactive"]{background:linear-gradient(155deg,#1b1c22,#101116);border-color:var(--lyx-line);color:var(--lyx-text2)}
.lyx-rwo[data-status="inactive"] .lyx-rwo-med{filter:grayscale(1) brightness(.7)}
.lyx-rwo[data-status="inactive"] .lyx-rwo-pts b{background:none;color:var(--lyx-text2);-webkit-text-fill-color:currentColor;filter:none}
.lyx-rwo-sheen{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at var(--mx) var(--my),rgba(255,226,160,.2),transparent 48%);mix-blend-mode:screen}
.lyx-rwo-top{position:relative;display:flex;align-items:flex-start;gap:12px;min-height:76px}
.lyx-rwo-med{flex:none;display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:conic-gradient(from 210deg,#fff0bd,#c9a24a,#8c6a22,#f3d67f,#fff0bd);box-shadow:0 10px 20px -8px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.7),inset 0 -2px 3px rgba(80,55,10,.5)}
.lyx-rwo-med span{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:50%;color:#4a3208;background:radial-gradient(circle at 35% 28%,#fbe9a8,#d6ae52 70%);box-shadow:inset 0 2px 4px rgba(255,255,255,.55),inset 0 -2px 4px rgba(90,60,10,.45);text-shadow:0 1px 0 rgba(255,255,255,.5)}
.lyx-rwo-name{font-size:17px;font-weight:600;line-height:1.25;color:var(--lyx-ivory);word-break:break-word}
.lyx-rwo-desc{margin-top:4px;font-size:11.5px;line-height:1.55;color:var(--lyx-text2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.is-ghost{opacity:.4}
.lyx-rwo-perf{position:relative;height:0;margin:14px -18px 12px;border-top:1.5px dashed rgba(236,208,138,.3)}
.lyx-rwo-bottom{position:relative;display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px}
.lyx-rwo-pts{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.lyx-rwo-pts b{font-size:36px;line-height:1;font-weight:500;background:linear-gradient(180deg,#fff2c4,#e8c76a 60%,#b78d36);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 2px 0 rgba(0,0,0,.35))}
.lyx-rwo-pts span{font-size:11px;color:var(--lyx-text2)}
.lyx-rwo-chips{display:flex;flex-wrap:wrap;gap:6px;font-size:10px}
.lyx-chipx{display:inline-flex;align-items:center;gap:5px;min-height:24px;padding:0 9px;border-radius:99px;font-size:10.5px;font-weight:600;color:var(--lyx-text2);background:rgba(255,244,214,.05);border:1px solid var(--lyx-line)}
.lyx-rwo-actions{position:relative;display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;margin-top:14px}
.lyx-rwo[data-preview="true"]{--notch:104px}
.lyx-root[data-lyx-mode="static"] .lyx-rwo,.lyx-root[data-lyx-mode="lite"] .lyx-rwo{transform:none}
.lyx-rw-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(min(100%,320px),1fr))}
`;


export const REDEEM_CSS = `
/* ===================== redemptions ===================== */
.lyx-rd-list{display:flex;flex-direction:column;gap:14px;perspective:1000px;margin:0;padding:0;list-style:none}
.lyx-rd{position:relative;padding:16px;border-radius:22px;border:1px solid rgba(230,138,156,.3);background:linear-gradient(150deg,rgba(88,48,58,.3),rgba(16,17,23,.9));box-shadow:0 22px 40px -28px rgba(0,0,0,.95),0 0 40px -28px rgba(230,138,156,.6);animation:lyxArrive .6s var(--lyx-ease) both;animation-delay:calc(var(--i,0) * 70ms)}
.lyx-rd[data-afford="no"]{border-color:rgba(240,138,138,.4)}
.lyx-rd-head{display:flex;flex-wrap:wrap;align-items:flex-start;gap:12px}
.lyx-rd-who{min-width:0;flex:1 1 11rem}
.lyx-rd-who b{display:block;font-size:14px;font-weight:600;color:var(--lyx-ivory);word-break:break-word}
.lyx-rd-who span{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:2px;font-size:11px;color:var(--lyx-text2)}
.lyx-rd-wait{display:inline-flex;align-items:center;gap:5px;min-height:26px;padding:0 10px;border-radius:99px;font-size:10.5px;font-weight:700;color:var(--lyx-gold);background:rgba(232,199,106,.1);border:1px solid rgba(232,199,106,.35)}
.lyx-rd-ticket{position:relative;display:grid;gap:12px;align-items:center;margin-top:14px;padding:14px;border-radius:18px;background:linear-gradient(155deg,rgba(255,244,214,.06),rgba(255,244,214,.015));border:1px solid var(--lyx-line);grid-template-columns:auto minmax(0,1fr)}
.lyx-rd-ticket-fig{grid-column:1 / -1;display:grid;gap:10px;grid-template-columns:repeat(2,minmax(0,1fr));padding-top:12px;border-top:1.5px dashed rgba(236,208,138,.28)}
@media (min-width:640px){.lyx-rd-ticket{grid-template-columns:auto minmax(0,1fr) auto auto}.lyx-rd-ticket-fig{display:contents;border:0;padding:0}}
.lyx-rd-med{display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:50%;color:#4a3208;background:conic-gradient(from 210deg,#fff0bd,#c9a24a,#8c6a22,#f3d67f,#fff0bd);box-shadow:0 8px 16px -8px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.55)}
.lyx-rd-cell small{display:block;font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--lyx-text3)}
.lyx-rd-cell b{display:block;margin-top:2px;font-size:15px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--lyx-ivory);word-break:break-word}
.lyx-rd-cell b.gold{color:var(--lyx-gold)}
.lyx-rd-cell b.bad{color:var(--lyx-danger)}
.lyx-rd-afford{margin-top:12px}
.lyx-rd-afford-t{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:10.5px;color:var(--lyx-text2)}
.lyx-rd-note{display:flex;gap:7px;align-items:flex-start;margin-top:10px;font-size:11px;line-height:1.5;color:var(--lyx-text2)}
.lyx-rd-note svg{flex:none;margin-top:2px}
.lyx-rd-note[data-k="bad"]{color:var(--lyx-danger)}
.lyx-rd-note[data-k="gold"]{color:var(--lyx-gold)}
.lyx-rd-act{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;margin-top:14px}
.lyx-rd-reject{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;width:100%;animation:lyxRise var(--lyx-fast) var(--lyx-ease) both}
.lyx-rd-reject .inp{flex:1 1 12rem;min-width:0;min-height:40px}
.lyx-btn-danger{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;border-radius:12px;font-size:12px;font-weight:700;cursor:pointer;color:var(--lyx-danger);background:rgba(240,138,138,.12);border:1px solid rgba(240,138,138,.45)}
.lyx-btn-danger:hover:not(:disabled){background:rgba(240,138,138,.2)}
.lyx-btn-danger:disabled{opacity:.5;cursor:not-allowed}
.lyx-btn-rose{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 14px;border-radius:12px;font-size:12px;font-weight:700;cursor:pointer;color:var(--lyx-rose);background:rgba(230,138,156,.12);border:1px solid rgba(230,138,156,.45)}
.lyx-btn-rose:hover:not(:disabled){background:rgba(230,138,156,.2)}
.lyx-btn-rose:disabled{opacity:.5;cursor:not-allowed}

/* balance → cost → after */
.lyx-bm{margin-bottom:14px;padding:16px;border-radius:20px;border:1px solid var(--lyx-line2);background:linear-gradient(155deg,rgba(150,115,38,.2),rgba(14,16,24,.7))}
.lyx-bm-row{display:grid;align-items:center;gap:6px;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto minmax(0,1fr)}
.lyx-bm-c{min-width:0;text-align:center}
.lyx-bm-c small{display:block;font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--lyx-text3)}
.lyx-bm-c b{display:block;margin-top:3px;font-size:clamp(19px,5vw,26px);font-weight:500;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--lyx-ivory);word-break:break-word}
.lyx-bm-c[data-k="cost"] b{color:var(--lyx-danger)}
.lyx-bm-c[data-k="after"] b{color:var(--lyx-mint)}
.lyx-bm-c[data-k="after"][data-bad="true"] b{color:var(--lyx-danger)}
.lyx-bm-arr{display:inline-flex;color:var(--lyx-gold);opacity:.8;transform:scaleX(var(--lyx-dir,1))}
.lyx-bm-bar{position:relative;display:flex;height:10px;margin-top:16px;border-radius:99px;overflow:hidden;background:rgba(255,244,214,.07);box-shadow:inset 0 1px 2px rgba(0,0,0,.5)}
.lyx-bm-keep{height:100%;background:linear-gradient(90deg,#4fb08f,#8be0c0);transition:width var(--lyx-slow) var(--lyx-ease)}
.lyx-bm-cost{height:100%;background:repeating-linear-gradient(135deg,#e0b341 0 6px,#b78d36 6px 12px);transition:width var(--lyx-slow) var(--lyx-ease)}
.lyx-bm-bar[data-bad="true"] .lyx-bm-cost{background:repeating-linear-gradient(135deg,#f08a8a 0 6px,#c05a5a 6px 12px)}
.lyx-bm-legend{display:flex;justify-content:space-between;gap:8px;margin-top:6px;font-size:10px;color:var(--lyx-text3)}

/* points moving */
.lyx-pm{display:grid;align-items:center;gap:8px;grid-template-columns:minmax(0,1fr) minmax(36px,1.2fr) minmax(0,1fr);margin:6px 0 4px}
.lyx-pm-node{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0;padding:14px 8px;border-radius:20px;text-align:center;border:1px solid var(--lyx-line);background:linear-gradient(155deg,rgba(255,244,214,.07),rgba(255,244,214,.015))}
.lyx-pm-k{font-size:9.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--lyx-text3)}
.lyx-pm-bal b{font-size:clamp(24px,7vw,34px);font-weight:500;line-height:1;font-variant-numeric:tabular-nums;color:var(--lyx-ivory)}
.lyx-pm[data-dir="out"] .lyx-pm-bal b{color:var(--lyx-mint)}
.lyx-pm[data-dir="back"] .lyx-pm-bal b{color:var(--lyx-rose)}
.lyx-pm-node small{font-size:10.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--lyx-text2)}
.lyx-pm-node small[data-k="debit"]{color:var(--lyx-danger)}
.lyx-pm-node small[data-k="reversal"]{color:var(--lyx-rose)}
.lyx-pm-med{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;color:#4a3208;background:conic-gradient(from 210deg,#fff0bd,#c9a24a,#8c6a22,#f3d67f,#fff0bd);box-shadow:0 8px 16px -8px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.55)}
.lyx-pm-name{font-size:12px;font-weight:600;color:var(--lyx-gold);word-break:break-word;line-height:1.3}
.lyx-pm-lane{position:relative;height:44px}
.lyx-pm-line{position:absolute;inset-inline:0;top:50%;height:0;border-top:1.5px dashed rgba(236,208,138,.32)}
.lyx-pm-coin{position:absolute;top:50%;inset-inline-start:0;width:15px;height:15px;margin-top:-7px;border-radius:50%;opacity:0;background:conic-gradient(from 200deg,#fff0bd,#c9a24a,#8c6a22,#f3d67f,#fff0bd);box-shadow:0 3px 8px -2px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,255,255,.6)}
.lyx-pm[data-dir="out"] .lyx-pm-coin{animation:lyxCoinOut 1.05s var(--d) cubic-bezier(.55,0,.25,1) both,lyxCoinArc 1.05s var(--d) ease-in-out both}
.lyx-pm[data-dir="back"] .lyx-pm-coin{animation:lyxCoinBack 1.05s var(--d) cubic-bezier(.55,0,.25,1) both,lyxCoinArc 1.05s var(--d) ease-in-out both}
@keyframes lyxCoinOut{0%{opacity:0;inset-inline-start:0;scale:.5}14%{opacity:1;scale:1}86%{opacity:1}100%{opacity:0;inset-inline-start:calc(100% - 15px);scale:.6}}
@keyframes lyxCoinBack{0%{opacity:0;inset-inline-start:calc(100% - 15px);scale:.5}14%{opacity:1;scale:1}86%{opacity:1}100%{opacity:0;inset-inline-start:0;scale:.6}}
@keyframes lyxCoinArc{0%{translate:0 0}50%{translate:0 var(--arc,-8px)}100%{translate:0 0}}
.lyx-pm[data-still="true"] .lyx-pm-coin{display:none}
.lyx-root[data-lyx-mode="lite"] .lyx-pm-coin{animation-duration:.7s}
.lyx-done{text-align:center}
.lyx-done h3{margin:10px 0 2px;font-size:18px;font-weight:600;color:var(--lyx-ivory)}
.lyx-done>p{font-size:12px;color:var(--lyx-text2);word-break:break-word}
.lyx-done-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;max-width:22rem;margin:14px auto 0;text-align:start}
.lyx-done-grid>div{padding:12px;border-radius:16px;border:1px solid var(--lyx-line);background:rgba(255,244,214,.04)}
.lyx-done-grid small{display:block;font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--lyx-text3)}
.lyx-done-grid b{display:block;margin-top:2px;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}

/* redemption history */
.lyx-rh-filters{display:grid;gap:10px;margin-bottom:12px;grid-template-columns:repeat(2,minmax(0,1fr))}
.lyx-rh-filters .wide{grid-column:1 / -1}
@media (min-width:1024px){.lyx-rh-filters{grid-template-columns:minmax(0,1.5fr) repeat(4,minmax(0,1fr))}.lyx-rh-filters .wide{grid-column:auto}}
.lyx-rh{align-items:flex-start;flex-wrap:wrap}
.lyx-rh .lyx-act-b b,.lyx-rh .lyx-act-b span{white-space:normal;overflow:visible;text-overflow:clip}
.lyx-rh-end{display:flex;flex-direction:column;align-items:flex-end;gap:8px;flex:none;max-width:100%}
.lyx-rh[data-status="reversed"]{--c:var(--lyx-rose);--c-line:rgba(230,138,156,.32)}
.lyx-rh[data-status="confirmed"]{--c:var(--lyx-gold);--c-line:rgba(232,199,106,.4)}
.lyx-rh[data-status="rejected"]{--c:var(--lyx-danger);--c-line:rgba(240,138,138,.32)}
.lyx-rh[data-status="pending"]{--c:var(--lyx-info);--c-line:rgba(157,183,217,.32)}
.lyx-rh .lyx-act-g{margin-top:2px}
`;


export const TIER_CSS = `
/* ===================== tier world ===================== */
.lyx-tw-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}
.lyx-tw-path{display:grid;gap:18px 14px;grid-template-columns:repeat(2,minmax(0,1fr));padding-top:4px}
@media (min-width:1100px){.lyx-tw-path{grid-template-columns:repeat(4,minmax(0,1fr))}}
@media (max-width:520px){.lyx-tw-path{grid-template-columns:minmax(0,1fr)}}
.lyx-tw-cell{position:relative;min-width:0;display:flex;flex-direction:column;gap:10px;animation:lyxRise var(--lyx-normal) var(--lyx-ease) both;animation-delay:calc(var(--i,0) * 70ms)}
.lyx-tw-step{position:relative;display:flex;align-items:center;height:26px}
.lyx-tw-step span{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;font-size:11px;font-weight:800;color:#15110a;background:var(--tc);box-shadow:0 0 0 4px rgba(255,244,214,.06),0 6px 14px -6px var(--tc)}
@media (min-width:1100px){.lyx-tw-step::after{content:"";position:absolute;inset-inline-start:26px;inset-inline-end:-14px;top:50%;height:2px;margin-top:-1px;background:linear-gradient(90deg,var(--tc),rgba(255,244,214,.1))}[dir="rtl"] .lyx-tw-step::after{background:linear-gradient(270deg,var(--tc),rgba(255,244,214,.1))}.lyx-tw-cell:last-child .lyx-tw-step::after{display:none}}
.lyx-tw-node{display:block;width:100%;padding:12px 10px 4px;border-radius:26px;cursor:pointer;text-align:start;color:inherit;background:linear-gradient(160deg,rgba(32,36,50,.5),rgba(14,16,24,.5));border:1px solid var(--lyx-line);transition:transform var(--lyx-normal) var(--lyx-ease),border-color var(--lyx-fast),box-shadow var(--lyx-normal)}
.lyx-tw-node:hover{border-color:var(--lyx-line2)}
.lyx-tw-node.is-sel{transform:translate3d(0,-6px,0);border-color:var(--tc);box-shadow:0 26px 40px -26px rgba(0,0,0,.95),0 0 0 1px var(--tc),0 0 46px -18px var(--tc)}
.lyx-tw-node .lyt-stage{pointer-events:auto}
.lyx-tw-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:11px;color:var(--lyx-text2)}
.lyx-tw-detail{display:grid;gap:22px}
@media (min-width:900px){.lyx-tw-detail{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)}}
.lyx-tw-title{margin-top:12px;font-size:clamp(24px,4vw,34px);font-weight:500;line-height:1.1;color:var(--lyx-ivory);font-family:var(--lyx-serif,Georgia,serif);word-break:break-word}
.lyx-tw-desc{margin-top:8px;max-width:46ch;font-size:13px;line-height:1.65;color:var(--lyx-text2);word-break:break-word}
.lyx-tw-facts{display:grid;gap:10px;margin-top:16px;grid-template-columns:repeat(auto-fit,minmax(120px,1fr))}
.lyx-tw-facts>div{padding:12px;border-radius:16px;border:1px solid var(--lyx-line);background:rgba(255,244,214,.04)}
.lyx-tw-facts small{display:block;font-size:9.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--lyx-text3)}
.lyx-tw-facts b{display:block;margin-top:3px;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--lyx-ivory);word-break:break-word}
.lyx-tw-next{display:flex;align-items:center;gap:7px;margin-top:14px;font-size:12px;color:var(--tc)}
.lyx-tw-d-ben{padding:16px;border-radius:20px;border:1px solid var(--lyx-line);background:rgba(255,244,214,.035);align-self:start}
.lyx-tw-bt{margin-bottom:10px;font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--tc)}
.lyx-promo-card{width:min(78vw,340px);margin:0 auto}
.lyx-tw-dist{display:flex;flex-direction:column;gap:14px;margin:0;padding:0;list-style:none}
.lyx-tw-dist li>div{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:11px;color:var(--lyx-text2)}
.lyx-tw-dist li b{color:var(--lyx-ivory);font-variant-numeric:tabular-nums}
.lyx-root[data-lyx-mode="static"] .lyx-tw-node,.lyx-root[data-lyx-mode="lite"] .lyx-tw-node{transition:none}
`;


export const ANALYTICS_CSS = `
/* ===================== analytics / charts ===================== */
.lyx-an-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px}
.lyx-an-note{display:flex;gap:8px;align-items:flex-start;padding:10px 12px;border-radius:14px;font-size:11px;line-height:1.5;color:var(--lyx-gold);background:rgba(232,199,106,.08);border:1px solid rgba(232,199,106,.3)}
.lyx-an-grid{display:grid;gap:12px;grid-template-columns:minmax(0,1fr)}
@media (min-width:1024px){.lyx-an-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}.lyx-an-grid.wide{grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)}}
.lyx-ch{min-width:0}
.lyx-ch-read{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;min-height:28px;margin-bottom:10px;font-size:11.5px;color:var(--lyx-text2)}
.lyx-ch-read b{font-size:12px;color:var(--lyx-ivory)}
.lyx-ch-read span{display:inline-flex;align-items:center;gap:6px}
.lyx-ch-read em{font-style:normal;font-weight:700;color:var(--lyx-ivory);font-variant-numeric:tabular-nums}
.lyx-ch-read i,.lyx-ch-legend i{display:inline-block;width:9px;height:9px;border-radius:3px}
.lyx-ch-plot{position:relative;display:flex;align-items:stretch;gap:3px;padding:0 0 0 0;border-radius:14px}
.lyx-ch-plot[data-dense="true"]{gap:1px}
.lyx-ch-max,.lyx-ch-min{position:absolute;inset-inline-start:2px;z-index:2;font-size:9.5px;font-weight:700;color:var(--lyx-text3);pointer-events:none}
.lyx-ch-max{top:-2px}
.lyx-ch-min{bottom:-2px}
.lyx-ch-base{position:absolute;inset-inline:0;top:var(--base);height:0;border-top:1px dashed rgba(236,208,138,.25);pointer-events:none}
.lyx-ch-col{position:relative;flex:1 1 0;min-width:0;display:flex;flex-direction:column;padding:0 1px;border:0;border-radius:6px;background:none;cursor:pointer;min-height:44px}
.lyx-ch-col:hover,.lyx-ch-col[data-sel="true"]{background:rgba(255,244,214,.07)}
.lyx-ch-col:focus-visible{outline:2px solid var(--lyx-gold);outline-offset:1px}
.lyx-ch-up{display:flex;align-items:flex-end;justify-content:center;height:var(--base);position:relative}
.lyx-ch-down{display:flex;align-items:flex-start;justify-content:center;flex:1;position:relative}
.lyx-ch-up i,.lyx-ch-down i{display:block;min-height:0;border-radius:3px 3px 0 0;max-width:22px;margin:0 auto;position:absolute;inset-inline:0;opacity:.92;transition:height var(--lyx-slow) var(--lyx-ease)}
.lyx-ch-up i{bottom:0}
.lyx-ch-down i{top:0;border-radius:0 0 3px 3px}
.lyx-ch-col[data-sel="true"] i{opacity:1;filter:brightness(1.15)}
.lyx-ch-axis{display:flex;justify-content:space-between;margin-top:6px;font-size:10px;color:var(--lyx-text3)}
.lyx-ch-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:10.5px;color:var(--lyx-text2)}
.lyx-ch-legend span{display:inline-flex;align-items:center;gap:6px}
.lyx-donut{display:grid;gap:16px;align-items:center;grid-template-columns:auto minmax(0,1fr)}
@media (max-width:420px){.lyx-donut{grid-template-columns:minmax(0,1fr);justify-items:center}}
.lyx-donut-ring{position:relative;width:132px;height:132px}
.lyx-donut-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
.lyx-donut-ring circle{fill:none;stroke-width:11}
.lyx-donut-ring .bg{stroke:rgba(255,244,214,.07)}
.lyx-donut-ring .seg{stroke-linecap:butt;transition:stroke-dasharray var(--lyx-slow) var(--lyx-ease)}
.lyx-donut-c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.lyx-donut-c b{font-size:24px;font-weight:500;color:var(--lyx-ivory);font-family:Georgia,serif}
.lyx-donut-c small{font-size:9.5px;color:var(--lyx-text3);max-width:80px;line-height:1.3}
.lyx-donut-l{display:flex;flex-direction:column;gap:7px;margin:0;padding:0;list-style:none;min-width:0;width:100%}
.lyx-donut-l--row{flex-direction:row;flex-wrap:wrap;gap:8px 18px;margin-top:12px}
.lyx-donut-l--row li{width:auto}
.lyx-donut-l li{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--lyx-text2);min-width:0}
.lyx-donut-l li i{width:9px;height:9px;border-radius:3px;flex:none}
.lyx-donut-l li span{flex:1;min-width:0}
.lyx-donut-l li b{color:var(--lyx-ivory);font-variant-numeric:tabular-nums}
.lyx-hb{display:flex;flex-direction:column;gap:12px;margin:0;padding:0;list-style:none}
.lyx-hb li>div{display:flex;justify-content:space-between;gap:10px;margin-bottom:5px;font-size:11.5px;color:var(--lyx-text2)}
.lyx-hb li>div span{min-width:0;word-break:break-word}
.lyx-hb li>div b{color:var(--lyx-ivory);font-variant-numeric:tabular-nums;flex:none}
.lyx-hb-track{display:block;height:8px;border-radius:99px;background:rgba(255,244,214,.07);overflow:hidden}
.lyx-hb-track i{display:block;height:100%;border-radius:inherit;transition:width var(--lyx-slow) var(--lyx-ease)}
.lyx-hb small{display:block;margin-top:4px;font-size:10px;color:var(--lyx-text3)}
.lyx-sb{display:flex;gap:2px;height:16px;border-radius:99px;overflow:hidden}
.lyx-sb i{display:block;min-width:4px}
`;


export const SETTINGS_CSS = `
/* ===================== settings ===================== */
.lyx-st-sec{display:flex;flex-direction:column;gap:14px}
.lyx-st-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.lyx-st-row h4{font-size:13px;font-weight:600;color:var(--lyx-ivory)}
.lyx-st-row p{margin-top:3px;font-size:11.5px;line-height:1.6;color:var(--lyx-text2)}
.lyx-st-split{display:grid;gap:18px;grid-template-columns:minmax(0,1fr)}
@media (min-width:1024px){.lyx-st-split{grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);align-items:start}}
.lyx-st-prev{padding:16px;border-radius:22px;border:1px solid var(--lyx-line);background:radial-gradient(90% 70% at 50% 0%,rgba(150,115,38,.2),transparent 70%),rgba(255,244,214,.03)}
.lyx-st-prev small{display:block;margin-bottom:10px;font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--lyx-text3);text-align:center}
.lyx-mode{padding:16px;border-radius:20px;border:1px solid var(--lyx-line);background:rgba(255,244,214,.03);transition:border-color var(--lyx-fast),background var(--lyx-fast),box-shadow var(--lyx-normal)}
.lyx-mode[data-on="true"]{border-color:var(--lyx-line2);background:linear-gradient(155deg,rgba(150,115,38,.2),rgba(255,244,214,.02));box-shadow:0 0 40px -26px var(--lyx-glow)}
.lyx-mode .inp{text-align:center;font-size:17px;font-weight:600;min-height:46px}
.lyx-rule{padding:16px;border-radius:20px;border:1px solid var(--lyx-line2);background:linear-gradient(150deg,rgba(150,115,38,.22),rgba(14,16,24,.6))}
.lyx-rule-k{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:var(--lyx-gold)}
.lyx-rule li{list-style:none;font-size:14px;font-weight:600;line-height:1.6;color:var(--lyx-ivory);animation:lyxRise var(--lyx-normal) var(--lyx-ease) both}
.lyx-st-celebrate{position:absolute;inset:0;z-index:10;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:inherit;background:rgba(6,7,10,.9);backdrop-filter:blur(4px);cursor:pointer;animation:lyxFadeIn var(--lyx-fast) linear both;text-align:center;padding:16px}
.lyx-st-celebrate b{margin-top:12px;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--lyx-gold)}
[dir="rtl"] .lyx-st-celebrate b{letter-spacing:.04em}
.lyx-st-celebrate p{margin-top:6px;font-size:12px;color:var(--lyx-text2)}
.lyx-ck-prev{display:flex;flex-direction:column;align-items:center;gap:10px;padding:18px;border-radius:22px;border:1px solid var(--lyx-line);background:rgba(255,244,214,.03)}
.lyx-ck-prev span.btn{display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:0 22px;border-radius:99px;font-weight:700;font-size:14px;color:#2a1d05;background:linear-gradient(180deg,#f3dc92,#c9a24a);box-shadow:0 12px 24px -12px rgba(201,162,74,.8),inset 0 1px 0 rgba(255,255,255,.5)}
.lyx-ck-prev[data-off="true"]{opacity:.5;filter:grayscale(.7)}
.lyx-link-row{display:flex;flex-wrap:wrap;gap:8px}
.lyx-link-row .inp{flex:1 1 14rem;min-width:0;font-size:12px}
`;

export const FEATURE_CSS = HERO_CSS + MEMBERS_CSS + CHECKIN_CSS + REWARD_CSS + REDEEM_CSS + TIER_CSS + ANALYTICS_CSS + SETTINGS_CSS;
