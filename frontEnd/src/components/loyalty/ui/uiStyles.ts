/**
 * ClinicOS Loyalty — shared component styles (Phase 8). Everything is scoped under `.lyx-root` and uses only the tokens from shellStyles.ts.
 * Components: LoyaltySurface / LoyaltyPanel / LoyaltyMetric / StatusOrb / ProgressRail / LoyaltyEmptyState / LoyaltyLoader / LoyaltyErrorState /
 * SuccessBurst / ActivityItem / CinematicTransition / LoyaltyModal (see LoyaltyUI.tsx and ../Dialog.tsx).
 */
export const UI_CSS = `
.lyx-root[dir="rtl"]{--lyx-dir:-1;--lyx-origin:right}
.lyx-root{--lyx-origin:left}

/* ===================== surface ===================== */
.lyx-surface{position:relative;min-width:0;border-radius:22px;background:linear-gradient(160deg,rgba(32,36,50,.78),rgba(14,16,24,.84));border:1px solid var(--lyx-line);box-shadow:var(--lyx-sh1);backdrop-filter:blur(14px) saturate(115%);-webkit-backdrop-filter:blur(14px) saturate(115%)}
.lyx-surface::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(140deg,rgba(255,236,170,.15),transparent 34%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;padding:1px}
.lyx-surface[data-pad="true"]{padding:18px}
.lyx-surface[data-pad="lg"]{padding:clamp(18px,3vw,28px)}
.lyx-surface[data-tone="gold"]{border-color:var(--lyx-line2);box-shadow:var(--lyx-sh1),0 0 44px -24px var(--lyx-glow)}
.lyx-surface[data-tone="mint"]{border-color:rgba(111,214,176,.3);box-shadow:var(--lyx-sh1),0 0 40px -26px rgba(111,214,176,.5)}
.lyx-surface[data-tone="rose"]{border-color:rgba(230,138,156,.32);box-shadow:var(--lyx-sh1),0 0 40px -26px rgba(230,138,156,.5)}
.lyx-surface[data-tone="danger"]{border-color:rgba(240,138,138,.38)}
.lyx-surface[data-solid="true"]{background:linear-gradient(160deg,#1a1e29,#10131a);backdrop-filter:none;-webkit-backdrop-filter:none}
.lyx-surface.is-lift{transition:transform var(--lyx-fast) var(--lyx-ease),box-shadow var(--lyx-fast) var(--lyx-ease),border-color var(--lyx-fast)}
.lyx-surface.is-lift:hover{transform:translate3d(0,-3px,0);border-color:var(--lyx-line2);box-shadow:var(--lyx-sh2)}
.lyx-surface.is-rise{animation:lyxRise var(--lyx-normal) var(--lyx-ease) both;animation-delay:calc(var(--i,0) * 55ms)}
@keyframes lyxRise{from{opacity:0;transform:translate3d(0,14px,0) scale(.99)}to{opacity:1;transform:none}}
.lyx-stagger>*{animation:lyxRise var(--lyx-normal) var(--lyx-ease) both;animation-delay:calc(var(--i,0) * 45ms)}

.lyx-ph{display:flex;align-items:center;gap:10px;margin-bottom:14px;min-width:0}
.lyx-ph-ico{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:10px;flex:none;color:var(--lyx-gold);background:rgba(232,199,106,.1);border:1px solid var(--lyx-line)}
.lyx-ph-tx{min-width:0;flex:1}
.lyx-ph h3{font-size:14px;font-weight:700;color:var(--lyx-ivory);line-height:1.25}
.lyx-ph p{margin-top:2px;font-size:11px;color:var(--lyx-text2)}
.lyx-link{font-size:11px;font-weight:600;color:var(--lyx-gold);background:none;border:0;cursor:pointer;padding:6px 4px;min-height:32px;white-space:nowrap}
.lyx-link:hover{text-decoration:underline;text-underline-offset:3px}

/* ===================== metrics ===================== */
.lyx-metric{display:flex;flex-direction:column;gap:6px;padding:16px;overflow:hidden}
.lyx-metric-top{display:flex;align-items:center;gap:10px}
.lyx-metric-ico{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:12px;flex:none;color:var(--lyx-gold);background:rgba(232,199,106,.1);border:1px solid var(--lyx-line)}
.lyx-metric[data-tone="mint"] .lyx-metric-ico{color:var(--lyx-mint);background:rgba(111,214,176,.1);border-color:rgba(111,214,176,.28)}
.lyx-metric[data-tone="rose"] .lyx-metric-ico{color:var(--lyx-rose);background:rgba(230,138,156,.1);border-color:rgba(230,138,156,.28)}
.lyx-metric-label{font-size:11px;font-weight:600;color:var(--lyx-text2);letter-spacing:.02em}
.lyx-metric-val{font-size:30px;line-height:1.05;font-weight:500;color:var(--lyx-ivory)}
.lyx-metric-hint{font-size:10.5px;color:var(--lyx-text3);line-height:1.4}
.lyx-metric[data-variant="hero"]{padding:22px;background:linear-gradient(150deg,rgba(60,48,20,.55),rgba(16,15,18,.86) 62%);border-color:var(--lyx-line2)}
.lyx-metric[data-variant="hero"]::after{content:"";position:absolute;inset-inline-end:-30px;top:-40px;width:170px;height:170px;border-radius:50%;background:radial-gradient(circle,rgba(232,199,106,.28),transparent 66%);pointer-events:none}
.lyx-metric[data-variant="hero"] .lyx-metric-val{font-size:clamp(38px,5vw,52px);background:linear-gradient(180deg,#fff2c4,#e8c76a 60%,#c9a24a);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 2px 0 rgba(0,0,0,.35))}
.lyx-metric-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.lyx-ring{position:relative;width:64px;height:64px;flex:none}
.lyx-ring svg{width:100%;height:100%;transform:rotate(-90deg)}
[dir="rtl"] .lyx-ring svg{transform:rotate(-90deg) scaleY(-1)}
.lyx-ring circle{fill:none;stroke-width:5;stroke-linecap:round}
.lyx-ring .bg{stroke:rgba(255,244,214,.09)}
.lyx-ring .fg{stroke:url(#lyxRingGrad);transition:stroke-dashoffset var(--lyx-slow) var(--lyx-ease)}
.lyx-ring b{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--lyx-ivory)}
.lyx-spark{display:block;width:100%;height:34px;margin-top:4px;overflow:visible}
.lyx-spark path.line{fill:none;stroke:var(--lyx-gold);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:var(--len,400);stroke-dashoffset:var(--len,400);animation:lyxDraw var(--lyx-cine) var(--lyx-ease) .1s forwards}
.lyx-spark path.area{fill:url(#lyxSparkGrad);opacity:.5}
@keyframes lyxDraw{to{stroke-dashoffset:0}}

/* ===================== status orb (never colour-only: icon + word) ===================== */
.lyx-orb{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0 10px 0 7px;border-radius:99px;font-size:10.5px;font-weight:700;letter-spacing:.02em;white-space:nowrap;border:1px solid var(--c-line,var(--lyx-line));color:var(--c,var(--lyx-text2));background:var(--c-bg,rgba(255,244,214,.05))}
[dir="rtl"] .lyx-orb{padding:0 7px 0 10px}
.lyx-orb-dot{position:relative;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:var(--c-dot,rgba(255,244,214,.12))}
.lyx-orb[data-pulse="true"] .lyx-orb-dot::after{content:"";position:absolute;inset:-3px;border-radius:50%;border:1.5px solid var(--c);opacity:.7;animation:lyxPulse 1.8s ease-out infinite}
@keyframes lyxPulse{0%{transform:scale(.7);opacity:.8}100%{transform:scale(1.6);opacity:0}}
.lyx-orb[data-s="pending"]{--c:var(--lyx-gold);--c-line:rgba(232,199,106,.4);--c-bg:rgba(232,199,106,.1);--c-dot:rgba(232,199,106,.2)}
.lyx-orb[data-s="confirmed"],.lyx-orb[data-s="active"],.lyx-orb[data-s="ok"]{--c:var(--lyx-mint);--c-line:rgba(111,214,176,.38);--c-bg:rgba(111,214,176,.09);--c-dot:rgba(111,214,176,.2)}
.lyx-orb[data-s="rejected"],.lyx-orb[data-s="error"]{--c:var(--lyx-danger);--c-line:rgba(240,138,138,.4);--c-bg:rgba(240,138,138,.09);--c-dot:rgba(240,138,138,.2)}
.lyx-orb[data-s="reversed"]{--c:var(--lyx-rose);--c-line:rgba(230,138,156,.4);--c-bg:rgba(230,138,156,.09);--c-dot:rgba(230,138,156,.2)}
.lyx-orb[data-s="expired"],.lyx-orb[data-s="cancelled"],.lyx-orb[data-s="inactive"]{--c:var(--lyx-text2);--c-line:rgba(179,173,159,.3);--c-bg:rgba(179,173,159,.07);--c-dot:rgba(179,173,159,.16)}
.lyx-orb[data-s="info"]{--c:var(--lyx-info);--c-line:rgba(157,183,217,.38);--c-bg:rgba(157,183,217,.08);--c-dot:rgba(157,183,217,.18)}

/* ===================== progress rail ===================== */
.lyx-pr{position:relative;height:var(--h,8px);border-radius:99px;background:rgba(255,244,214,.07);box-shadow:inset 0 1px 2px rgba(0,0,0,.55);overflow:hidden}
.lyx-pr-fill{position:absolute;inset:0;border-radius:inherit;transform-origin:var(--lyx-origin);transform:scaleX(var(--p,0));background:linear-gradient(90deg,#8c6a22,#e8c76a 70%,#fff0bd);box-shadow:0 0 14px -2px var(--lyx-glow);transition:transform var(--lyx-slow) var(--lyx-ease)}
[dir="rtl"] .lyx-pr-fill{background:linear-gradient(270deg,#8c6a22,#e8c76a 70%,#fff0bd)}
.lyx-pr-fill::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.5) 50%,transparent 65%);transform:translateX(-120%);animation:lyxGlint 3.6s ease-in-out 1.2s infinite}
[dir="rtl"] .lyx-pr-fill::after{animation-name:lyxGlintRtl}
@keyframes lyxGlint{to{transform:translateX(120%)}}
@keyframes lyxGlintRtl{from{transform:translateX(120%)}to{transform:translateX(-120%)}}
.lyx-pr[data-tone="mint"] .lyx-pr-fill{background:linear-gradient(90deg,#2e8f6f,#6fd6b0)}
.lyx-pr[data-tone="rose"] .lyx-pr-fill{background:linear-gradient(90deg,#a85b6b,#e68a9c)}
.lyx-pr[data-tone="tier"] .lyx-pr-fill{background:linear-gradient(90deg,color-mix(in srgb,var(--tc) 50%,#000),var(--tc))}
.lyx-pr-ticks{position:absolute;inset:0;pointer-events:none}
.lyx-pr-ticks i{position:absolute;top:0;bottom:0;width:2px;background:rgba(7,8,12,.85);inset-inline-start:var(--at)}

/* ===================== activity / timeline ===================== */
.lyx-tl{position:relative;display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.lyx-tl::before{content:"";position:absolute;inset-inline-start:19px;top:14px;bottom:14px;width:1px;background:linear-gradient(180deg,transparent,var(--lyx-line2) 12%,var(--lyx-line2) 88%,transparent)}
.lyx-act{position:relative;display:flex;align-items:center;gap:12px;padding:9px 6px;border-radius:14px;min-width:0;transition:background var(--lyx-fast)}
.lyx-act:hover{background:rgba(255,244,214,.035)}
.lyx-act-g{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:13px;flex:none;color:var(--c,var(--lyx-gold));background:linear-gradient(145deg,rgba(255,244,214,.09),rgba(255,244,214,.02)),#10131a;border:1px solid var(--c-line,var(--lyx-line));box-shadow:0 8px 16px -10px rgba(0,0,0,.9)}
.lyx-act[data-k="points_earned"],.lyx-act[data-k="checkin_confirmed"],.lyx-act[data-k="new_member"]{--c:var(--lyx-mint);--c-line:rgba(111,214,176,.3)}
.lyx-act[data-k="points_reversed"],.lyx-act[data-k="reward_reversed"]{--c:var(--lyx-rose);--c-line:rgba(230,138,156,.32)}
.lyx-act[data-k="reward_redeemed"],.lyx-act[data-k="member_promoted"]{--c:var(--lyx-gold);--c-line:rgba(232,199,106,.4)}
.lyx-act[data-k="points_adjusted"]{--c:var(--lyx-info);--c-line:rgba(157,183,217,.32)}
.lyx-act-b{min-width:0;flex:1;line-height:1.35}
.lyx-act-b b{display:block;font-size:12px;font-weight:600;color:var(--lyx-ivory);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lyx-act-b span{display:block;font-size:10.5px;color:var(--lyx-text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lyx-act-p{flex:none;text-align:end;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
.lyx-act-p small{display:block;font-size:9.5px;font-weight:600;color:var(--lyx-text3)}
.lyx-act.is-new{animation:lyxNewEvt var(--lyx-slow) var(--lyx-ease) both}
.lyx-act.is-new::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;border:1px solid var(--lyx-line2);background:linear-gradient(90deg,rgba(232,199,106,.16),transparent 70%);animation:lyxFlash 2.4s ease-out forwards}
@keyframes lyxNewEvt{from{opacity:0;transform:translate3d(0,-12px,0) scale(.985)}to{opacity:1;transform:none}}
@keyframes lyxFlash{from{opacity:1}to{opacity:0}}

.lyx-ledger-end{flex:none;display:flex;flex-direction:column;align-items:flex-end;text-align:end}
.lyx-ledger-end small{font-size:9.5px;color:var(--lyx-text3)}
/* credit / debit / reversal — distinct by symbol + word, not only by colour */
.lyx-delta{display:inline-flex;align-items:center;gap:4px;font-weight:700;font-variant-numeric:tabular-nums}
.lyx-delta[data-k="credit"]{color:var(--lyx-mint)}
.lyx-delta[data-k="debit"]{color:var(--lyx-danger)}
.lyx-delta[data-k="reversal"]{color:var(--lyx-rose)}

/* ===================== empty / loading / error / success ===================== */
.lyx-empty{display:flex;flex-direction:column;align-items:center;text-align:center;padding:36px 18px}
.lyx-empty-stage{position:relative;width:118px;height:104px;margin-bottom:18px;perspective:700px}
.lyx-empty-tile{position:absolute;left:50%;top:50%;width:76px;height:76px;margin:-38px 0 0 -38px;border-radius:24px;border:1px solid var(--lyx-line);background:linear-gradient(145deg,rgba(255,244,214,.11),rgba(255,244,214,.02));box-shadow:0 18px 30px -16px rgba(0,0,0,.9),inset 0 1px 0 rgba(255,244,214,.14)}
.lyx-empty-tile.t1{transform:translate3d(-18px,6px,-30px) rotateX(58deg) rotateZ(-24deg);opacity:.5}
.lyx-empty-tile.t2{transform:translate3d(18px,10px,-14px) rotateX(58deg) rotateZ(18deg);opacity:.7}
.lyx-empty-tile.t3{display:flex;align-items:center;justify-content:center;color:var(--lyx-gold);border-color:var(--lyx-line2);background:linear-gradient(145deg,rgba(232,199,106,.22),rgba(232,199,106,.04));box-shadow:0 22px 34px -14px rgba(0,0,0,.95),0 0 36px -8px var(--lyx-glow),inset 0 1px 0 rgba(255,244,214,.3);transform:rotateX(14deg) rotateY(-16deg);animation:lyxFloatTile 6s ease-in-out infinite}
@keyframes lyxFloatTile{0%,100%{transform:translate3d(0,0,0) rotateX(14deg) rotateY(-16deg)}50%{transform:translate3d(0,-7px,0) rotateX(10deg) rotateY(-10deg)}}
.lyx-empty[data-kind="rewards"] .lyx-empty-tile.t3,.lyx-empty[data-kind="redemptions"] .lyx-empty-tile.t3{color:var(--lyx-rose);border-color:rgba(230,138,156,.4);box-shadow:0 22px 34px -14px rgba(0,0,0,.95),0 0 36px -8px rgba(230,138,156,.5),inset 0 1px 0 rgba(255,244,214,.3)}
.lyx-empty[data-kind="checkins"] .lyx-empty-tile.t3,.lyx-empty[data-kind="activity"] .lyx-empty-tile.t3{color:var(--lyx-mint);border-color:rgba(111,214,176,.4);box-shadow:0 22px 34px -14px rgba(0,0,0,.95),0 0 36px -8px rgba(111,214,176,.45),inset 0 1px 0 rgba(255,244,214,.3)}
.lyx-empty h3{font-size:15px;font-weight:700;color:var(--lyx-ivory)}
.lyx-empty p{margin-top:6px;max-width:360px;font-size:12px;line-height:1.6;color:var(--lyx-text2)}
.lyx-empty-act{margin-top:16px}
.lyx-empty[data-compact="true"]{padding:20px 12px}
.lyx-empty[data-compact="true"] .lyx-empty-stage{transform:scale(.78);margin-bottom:4px;height:88px}

.lyx-load{position:relative;overflow:hidden;border-radius:18px;background:linear-gradient(160deg,rgba(32,36,50,.6),rgba(14,16,24,.7));border:1px solid var(--lyx-line)}
.lyx-load::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(232,199,106,.1) 50%,transparent 70%);transform:translateX(-100%);animation:lyxShim 1.5s ease-in-out infinite}
[dir="rtl"] .lyx-load::after{animation-name:lyxShimRtl}
@keyframes lyxShim{to{transform:translateX(100%)}}
@keyframes lyxShimRtl{from{transform:translateX(100%)}to{transform:translateX(-100%)}}

.lyx-err{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:18px;border:1px solid rgba(240,138,138,.4);background:linear-gradient(135deg,rgba(240,138,138,.1),rgba(240,138,138,.03));color:#f4c4c4;font-size:12px}
.lyx-err-ico{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:12px;flex:none;color:var(--lyx-danger);background:rgba(240,138,138,.12);border:1px solid rgba(240,138,138,.35)}
.lyx-err-b{min-width:0;flex:1;line-height:1.5;word-break:break-word}
.lyx-err-b b{display:block;color:#ffdede;font-size:12.5px;margin-bottom:2px}
.lyx-err button{flex:none;min-height:32px;padding:0 12px;border-radius:10px;border:1px solid rgba(240,138,138,.4);background:rgba(240,138,138,.1);color:#ffdede;font-size:11px;font-weight:700;cursor:pointer}
.lyx-err button:hover{background:rgba(240,138,138,.18)}

.lyx-burst{position:relative;display:inline-flex;align-items:center;justify-content:center;width:64px;height:64px}
.lyx-burst-core{position:relative;z-index:2;display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;color:#10241c;background:radial-gradient(circle at 35% 30%,#b5f1d9,#6fd6b0 60%,#2e8f6f);box-shadow:0 12px 26px -10px rgba(111,214,176,.8),inset 0 1px 0 rgba(255,255,255,.6);animation:lyxPopIn var(--lyx-slow) var(--lyx-spring) both}
.lyx-burst[data-tone="gold"] .lyx-burst-core{color:#2a1d05;background:radial-gradient(circle at 35% 30%,#fff0bd,#e8c76a 60%,#a67a1d);box-shadow:0 12px 26px -10px rgba(232,199,106,.8),inset 0 1px 0 rgba(255,255,255,.6)}
.lyx-burst[data-tone="rose"] .lyx-burst-core{color:#2c0f17;background:radial-gradient(circle at 35% 30%,#ffd1da,#e68a9c 60%,#a85b6b);box-shadow:0 12px 26px -10px rgba(230,138,156,.8),inset 0 1px 0 rgba(255,255,255,.6)}
.lyx-burst i{position:absolute;inset:0;border-radius:50%;border:1.5px solid var(--lyx-mint);opacity:0;animation:lyxRingOut 1.1s var(--lyx-ease) forwards}
.lyx-burst[data-tone="gold"] i{border-color:var(--lyx-gold)}
.lyx-burst[data-tone="rose"] i{border-color:var(--lyx-rose)}
.lyx-burst i:nth-of-type(2){animation-delay:.18s}
@keyframes lyxRingOut{0%{opacity:.9;transform:scale(.8)}100%{opacity:0;transform:scale(2.3)}}
@keyframes lyxPopIn{from{opacity:0;transform:scale(.4) rotate(-18deg)}to{opacity:1;transform:none}}

/* ===================== cinematic moment (promotion / big confirmations) ===================== */
.lyx-moment{position:fixed;inset:0;z-index:85;display:flex;align-items:center;justify-content:center;padding:20px;background:radial-gradient(70% 60% at 50% 45%,rgba(30,24,10,.9),rgba(5,6,9,.94));animation:lyxFadeIn var(--lyx-normal) var(--lyx-ease) both;cursor:pointer}
.lyx-moment.is-out{animation:lyxFadeOut var(--lyx-normal) var(--lyx-ease-io) forwards;pointer-events:none}
.lyx-moment-in{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;max-width:420px;animation:lyxMomentIn var(--lyx-cine) var(--lyx-ease) both}
.lyx-moment-in h2{margin-top:22px;font-size:clamp(22px,5vw,30px);color:var(--lyx-ivory);font-weight:600}
.lyx-moment-in p{margin-top:8px;font-size:13px;color:var(--lyx-text2);line-height:1.6}
.lyx-moment-rays{position:absolute;left:50%;top:38%;width:160vmax;height:160vmax;margin:-80vmax 0 0 -80vmax;border-radius:50%;pointer-events:none;background:repeating-conic-gradient(from 0deg,rgba(232,199,106,.07) 0 4deg,transparent 4deg 14deg);-webkit-mask-image:radial-gradient(circle,#000 0,transparent 45%);mask-image:radial-gradient(circle,#000 0,transparent 45%);animation:lyxRays 14s linear infinite}
@keyframes lyxRays{to{transform:rotate(360deg)}}
@keyframes lyxFadeIn{from{opacity:0}to{opacity:1}}
@keyframes lyxFadeOut{to{opacity:0}}
@keyframes lyxMomentIn{from{opacity:0;transform:translate3d(0,24px,0) scale(.92)}to{opacity:1;transform:none}}
.lyx-moment-skip{margin-top:26px;font-size:10px;letter-spacing:.22em;color:var(--lyx-text3)}

/* ===================== modal ===================== */
.lyx-overlay{position:fixed;inset:0;z-index:80;display:flex;align-items:flex-end;justify-content:center;padding:0;background:rgba(3,4,7,.72);animation:lyxFadeIn var(--lyx-fast) linear both}
@media (min-width:640px){.lyx-overlay{align-items:center;padding:16px}}
@supports (backdrop-filter:blur(1px)){.lyx-overlay{backdrop-filter:blur(6px)}}
.lyx-dialog{position:relative;width:100%;max-height:92vh;overflow-y:auto;padding:20px;border-radius:26px 26px 0 0;background:linear-gradient(160deg,#1c202c,#0f1219);border:1px solid var(--lyx-line2);box-shadow:0 40px 90px -30px rgba(0,0,0,.95),0 0 60px -30px var(--lyx-glow);animation:lyxSheet var(--lyx-normal) var(--lyx-ease) both}
@media (min-width:640px){.lyx-dialog{max-width:28rem;border-radius:26px;animation-name:lyxDialog}.lyx-dialog[data-wide="true"]{max-width:36rem}}
.lyx-dialog::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(140deg,rgba(255,236,170,.14),transparent 30%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;padding:1px}
.lyx-dialog-h{display:flex;align-items:flex-start;gap:12px;margin-bottom:16px}
.lyx-dialog-h h2{min-width:0;flex:1;font-size:16px;font-weight:700;color:var(--lyx-ivory);word-break:break-word}
.lyx-dialog-x{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;flex:none;border-radius:12px;border:1px solid var(--lyx-line);background:rgba(255,244,214,.05);color:var(--lyx-text2);cursor:pointer}
.lyx-dialog-x:hover:not(:disabled){color:var(--lyx-ivory);border-color:var(--lyx-line2)}
.lyx-dialog-x:disabled{opacity:.4;cursor:not-allowed}
@keyframes lyxSheet{from{opacity:0;transform:translate3d(0,40px,0)}to{opacity:1;transform:none}}
@keyframes lyxDialog{from{opacity:0;transform:translate3d(0,16px,0) scale(.97) rotateX(6deg)}to{opacity:1;transform:none}}

/* ===================== toasts, misc ===================== */
.lyx-flash{display:flex;align-items:flex-start;gap:10px;margin-bottom:12px;padding:10px 14px;border-radius:14px;font-size:12px;border:1px solid;animation:lyxRise var(--lyx-normal) var(--lyx-ease) both}
.lyx-flash[data-t="ok"]{border-color:rgba(111,214,176,.4);background:rgba(111,214,176,.09);color:#b9f0dc}
.lyx-flash[data-t="err"]{border-color:rgba(240,138,138,.42);background:rgba(240,138,138,.09);color:#ffd2d2}
.lyx-seg-tabs{display:inline-flex;gap:3px;padding:3px;border-radius:14px;border:1px solid var(--lyx-line);background:rgba(255,244,214,.04);max-width:100%;overflow-x:auto}
.lyx-seg-tabs button{position:relative;min-height:36px;padding:0 14px;border-radius:11px;font-size:12px;font-weight:600;white-space:nowrap;color:var(--lyx-text2);background:none;border:0;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:color var(--lyx-fast),background var(--lyx-fast)}
.lyx-seg-tabs button:hover{color:var(--lyx-ivory)}
.lyx-seg-tabs button[aria-selected="true"],.lyx-seg-tabs button[aria-pressed="true"]{color:#2a1d05;background:linear-gradient(180deg,#f3dc92,#c9a24a);box-shadow:inset 0 1px 0 rgba(255,255,255,.5),0 8px 16px -10px rgba(201,162,74,.8)}
.lyx-seg-tabs .lyx-badge{box-shadow:none;background:#2a1d05;color:var(--lyx-gold)}
.lyx-seg-tabs button[aria-selected="true"] .lyx-badge{background:#2a1d05;color:var(--lyx-gold)}
.lyx-kbd{font-variant-numeric:tabular-nums}

/* legacy classes used by older Loyalty screens, re-skinned for the new identity */
.lyx-root .lyc-glass{background:linear-gradient(145deg,rgba(232,199,106,.16),rgba(232,199,106,.04));border-color:var(--lyx-line2)}
.lyx-root .lyc-shimmer{background:linear-gradient(100deg,rgba(255,244,214,.04) 30%,rgba(232,199,106,.14) 50%,rgba(255,244,214,.04) 70%);background-size:220% 100%}
.lyx-root[data-lyx-mode="static"] .lyx-moment-rays{display:none}
.lyx-root[data-lyx-mode="lite"] .lyx-moment-rays{animation:none}
.lyx-root[data-lyx-mode="lite"] .lyx-surface::before{display:none}
.lyx-root[data-lyx-mode="static"] .lyx-spark path.line{stroke-dashoffset:0}
.lyx-root[data-lyx-mode="static"] .lyx-act.is-new::after{display:none}
.lyx-root[data-lyx-mode="static"] .lyx-empty-tile.t3{transform:none}

/* ---------- switch ---------- */
.lyx-switch{position:relative;flex:none;width:52px;height:30px;border-radius:99px;border:1px solid var(--lyx-line);background:rgba(255,244,214,.07);cursor:pointer;transition:background var(--lyx-fast),border-color var(--lyx-fast),box-shadow var(--lyx-fast);box-shadow:inset 0 2px 4px rgba(0,0,0,.45)}
.lyx-switch[aria-checked="true"]{background:linear-gradient(180deg,#f3dc92,#c9a24a);border-color:rgba(255,236,170,.6);box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 0 22px -8px var(--lyx-glow)}
.lyx-switch:disabled{opacity:.55;cursor:not-allowed}
.lyx-switch-knob{position:absolute;top:3px;inset-inline-start:3px;display:flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:linear-gradient(180deg,#fffaf0,#d9cfb8);box-shadow:0 3px 8px rgba(0,0,0,.5);transition:inset-inline-start var(--lyx-fast) var(--lyx-ease)}
.lyx-switch[aria-checked="true"] .lyx-switch-knob{inset-inline-start:25px}
.lyx-switch .lyc-spinner{width:12px;height:12px;color:#2a1d05}
.lyx-switch:focus-visible{outline:2px solid var(--lyx-gold);outline-offset:3px}
`;
