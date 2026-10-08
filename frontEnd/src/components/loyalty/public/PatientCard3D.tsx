"use client";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { IconDiamond, IconLock } from "@tabler/icons-react";

/**
 * ClinicOS Loyalty — the patient's membership card (flagship visual).
 *
 * Technology: CSS 3D + a tiny spring-physics controller (requestAnimationFrame). NO Three.js — real perspective,
 * layered materials and lighting are all achievable with transforms/gradients, so the bundle stays light and the
 * motion stays GPU-friendly (only `transform`/`opacity` animate; the rAF loop runs ONLY while the card is moving).
 *
 * Layers (back → front): soft aura · edge thickness (3 plates) · obsidian base · brushed metal · diamond lattice ·
 * guilloche rings · iridescent foil (shifts with tilt) · glare band · specular hot-spot · grain · content with
 * parallax (translateZ) · hologram seal.
 *
 * Interaction: mouse hover tilts it; touch/drag tilts it (vertical swipes still scroll the page: touch-action pan-y);
 * on release it springs back with a slight overshoot. Without any pointer it breathes with a slow device-independent
 * sway — NO gyroscope / permission needed. `prefers-reduced-motion` → fully static, still beautiful.
 *
 * It shows ONLY real data handed in by the page (name, balance, since, reference). Locked state = no points at all.
 * No tier is ever drawn: the neutral state label is "MEMBER". Decorative → aria-hidden (facts are real text elsewhere).
 */

const hexToRgb = (hex?: string | null) => {
  const m = hex ? /^#([0-9a-f]{6})$/i.exec(hex) : null;
  if (!m) return "217,182,107"; // neutral champagne
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts up to the REAL balance (final value is always exactly the backend value). */
function useCountUp(target: number | null | undefined, delay = 650) {
  const [v, setV] = useState<number>(target ?? 0);
  const first = useRef(true);
  useEffect(() => {
    if (target === null || target === undefined) return;
    if (reducedMotion()) {
      setV(target);
      return;
    }
    const from = first.current ? 0 : v;
    first.current = false;
    let raf = 0;
    const t0 = performance.now() + delay;
    const tick = (t: number) => {
      const p = clamp((t - t0) / 1500, 0, 1);
      setV(Math.round(from + (target - from) * (1 - Math.pow(1 - p, 4))));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setV(target);
    };
    setV(from);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return v;
}

export interface PatientCardProps {
  clinicName: string;
  programName?: string | null;
  logoUrl?: string | null;
  /** Clinic brand color (hex) — tints the foil/glow. Future: surface/pattern/background style join here. */
  accent?: string | null;
  memberName?: string | null;
  balance?: number | null;
  since?: string | null;
  reference?: string | null;
  locked?: boolean;
  /** Phase 7 (minimal): the member's tier. Selects the card MATERIAL by the stable key and shows the clinic's tier name instead of "MEMBER". */
  tier?: { key: "tier1" | "tier2" | "tier3" | "tier4"; name: string } | null;
  labels: { points: string; member: string; since: string; locked: string; yourName: string };
}

export default function PatientCard3D(p: PatientCardProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const shown = useCountUp(p.locked ? null : p.balance);
  const rgb = hexToRgb(p.accent);

  // ---- spring controller (x,y ∈ [-1,1]) ----
  const s = useRef({ x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, raf: 0, down: false });
  const paint = () => {
    const el = tiltRef.current;
    if (!el) return;
    const { x, y } = s.current;
    el.style.setProperty("--rx", `${(-y * 13).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(x * 17).toFixed(2)}deg`);
    el.style.setProperty("--px", `${(-x * 9).toFixed(2)}px`);
    el.style.setProperty("--py", `${(-y * 7).toFixed(2)}px`);
    el.style.setProperty("--gx", `${(x * 30).toFixed(1)}%`);
    el.style.setProperty("--mx", `${((x * 0.5 + 0.5) * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${((y * 0.5 + 0.5) * 100).toFixed(1)}%`);
  };
  const tick = () => {
    const c = s.current;
    c.vx = (c.vx + (c.tx - c.x) * 0.1) * 0.8; // stiffness / damping → springy return with a hint of overshoot
    c.vy = (c.vy + (c.ty - c.y) * 0.1) * 0.8;
    c.x += c.vx;
    c.y += c.vy;
    paint();
    const settled = Math.abs(c.vx) < 0.0015 && Math.abs(c.vy) < 0.0015 && Math.abs(c.tx - c.x) < 0.0015 && Math.abs(c.ty - c.y) < 0.0015;
    if (settled && !c.down) {
      c.x = c.tx;
      c.y = c.ty;
      paint();
      c.raf = 0;
      stageRef.current?.setAttribute("data-active", "false");
      return;
    }
    c.raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    stageRef.current?.setAttribute("data-active", "true");
    if (!s.current.raf) s.current.raf = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(s.current.raf), []);
  useEffect(() => {
    // the static look (reduced motion / before any interaction) = a calm, slightly lit pose
    if (tiltRef.current) {
      tiltRef.current.style.setProperty("--mx", "30%");
      tiltRef.current.style.setProperty("--my", "18%");
    }
  }, []);

  const aim = (e: PointerEvent<HTMLDivElement>) => {
    if (reducedMotion()) return;
    const r = stageRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    s.current.tx = clamp(((e.clientX - r.left) / r.width - 0.5) * 2, -1, 1);
    s.current.ty = clamp(((e.clientY - r.top) / r.height - 0.5) * 2, -1, 1);
    wake();
  };
  const release = () => {
    s.current.down = false;
    s.current.tx = 0;
    s.current.ty = 0;
    if (!reducedMotion()) wake();
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    s.current.down = true;
    if (e.pointerType !== "mouse") {
      try {
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); // touch drag keeps tracking
      } catch {
        /* inactive pointer — tracking still works through the stage's own move events */
      }
    }
    aim(e);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" || s.current.down) aim(e);
  };

  const showLogo = !!p.logoUrl && !logoFailed;
  const title = (p.programName || p.clinicName).toUpperCase();
  const monogram = (p.clinicName.trim()[0] ?? "C").toUpperCase();

  return (
    <div
      ref={stageRef}
      className="pc-stage"
      aria-hidden="true"
      data-active="false"
      data-tier={p.tier && !p.locked ? p.tier.key : undefined}
      style={p.tier && !p.locked ? undefined : ({ ["--accent" as string]: rgb } as CSSProperties)}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={(e) => e.pointerType === "mouse" && release()}
    >
      <div className="pc-aura" />
      <div className="pc-sway">
        <div ref={tiltRef} className="pc-tilt">
          <div className={`pc-card ${p.locked ? "is-locked" : ""}`} dir="ltr">
            <i className="pc-plate pc-plate3" />
            <i className="pc-plate pc-plate2" />
            <i className="pc-plate pc-plate1" />
            <div className="pc-body">
              <div className="pc-base" />
              <div className="pc-brushed" />
              <svg className="pc-lattice" viewBox="0 0 120 80" preserveAspectRatio="none" fill="none" stroke="currentColor" strokeWidth=".35">
                {Array.from({ length: 13 }, (_, i) => (
                  <g key={i}>
                    <path d={`M${i * 10 - 40} 0 L${i * 10 + 40} 80`} />
                    <path d={`M${i * 10 + 40} 0 L${i * 10 - 40} 80`} />
                  </g>
                ))}
              </svg>
              <svg className="pc-guilloche" viewBox="0 0 200 200" fill="none" stroke="currentColor" strokeWidth=".6">
                {[96, 84, 72, 60, 48, 36].map((r) => (
                  <circle key={r} cx="100" cy="100" r={r} strokeDasharray={r === 72 ? "1.5 4" : undefined} />
                ))}
                <path d="M100 4A96 96 0 0 1 196 100" strokeWidth="1.8" />
              </svg>
              <div className="pc-foil" />
              <div className="pc-glare" />
              <div className="pc-spec" />
              <div className="pc-grain" />
              <div className="pc-rim" />
            </div>

            <div className="pc-content">
              <div className="pc-top">
                <span className="pc-logo">
                  {showLogo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.logoUrl as string} alt="" onError={() => setLogoFailed(true)} referrerPolicy="no-referrer" />
                  ) : (
                    <b>{monogram}</b>
                  )}
                </span>
                <span className="pc-brand">
                  <b>{title}</b>
                  <i dir="auto">{p.locked ? p.labels.locked : p.tier ? p.tier.name.toUpperCase() : p.labels.member}</i>
                </span>
              </div>

              <div className="pc-pts">
                <small>{p.labels.points}</small>
                <b className={p.locked ? "is-empty" : ""}>{p.locked ? "—" : shown.toLocaleString("en-US")}</b>
              </div>

              <div className="pc-bottom">
                <span className="pc-name">
                  <span dir="auto" className={p.memberName && !p.locked ? "" : "is-ghost"}>
                    {p.memberName && !p.locked ? p.memberName : p.labels.yourName}
                  </span>
                  {!p.locked && p.since && (
                    <em>
                      {p.labels.since} {p.since}
                    </em>
                  )}
                </span>
                {!p.locked && p.reference && <span className="pc-ref">{p.reference}</span>}
              </div>
            </div>

            <div className="pc-seal">{p.locked ? <IconLock size={17} stroke={1.6} /> : <IconDiamond size={18} stroke={1.5} />}</div>
          </div>
        </div>
      </div>
      <div className="pc-floor" />
    </div>
  );
}

export function PatientCardStyles() {
  // dangerouslySetInnerHTML: the CSS contains quotes; as a React text child it would be HTML-escaped during SSR and
  // mismatch on hydration (React error #425).
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
}

const CSS = `
.pc-stage{--accent:217,182,107;position:relative;width:100%;max-width:430px;margin:0 auto;perspective:1200px;container-type:inline-size;touch-action:pan-y;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;padding-bottom:6px}
.pc-aura{position:absolute;inset:6% 0 -4%;background:radial-gradient(60% 55% at 50% 50%,rgba(var(--accent),.28),transparent 70%);filter:blur(26px);opacity:.75;animation:pcAura 6s ease-in-out infinite;pointer-events:none}
.pc-sway{animation:pcSway 11s ease-in-out infinite;transform-style:preserve-3d}
.pc-stage[data-active="true"] .pc-sway{animation-play-state:paused}
.pc-tilt{--rx:0deg;--ry:0deg;--px:0px;--py:0px;--gx:0%;--mx:30%;--my:18%;transform:rotateX(var(--rx)) rotateY(var(--ry));transform-style:preserve-3d;will-change:transform}
.pc-card{position:relative;aspect-ratio:1.586/1;font-size:14px;font-size:4.2cqw;border-radius:1.55em;transform-style:preserve-3d;color:#f3e7c6;animation:pcDeal 1.25s cubic-bezier(.2,.9,.25,1.04) .08s both}
.pc-plate{position:absolute;inset:0;border-radius:1.55em;pointer-events:none}
.pc-plate1{background:#5d4a22;transform:translateZ(-3px)}
.pc-plate2{background:#463819;transform:translateZ(-6px)}
.pc-plate3{background:#2c230f;transform:translateZ(-9px);box-shadow:0 1.1em 2.6em rgba(0,0,0,.6),0 .2em .6em rgba(0,0,0,.5)}
.pc-body{position:absolute;inset:0;border-radius:1.55em;overflow:hidden;background:#0c0b09}
.pc-base{position:absolute;inset:0;background:radial-gradient(120% 95% at 14% 0%,rgba(var(--accent),.20) 0%,rgba(0,0,0,0) 46%),linear-gradient(135deg,#25211a 0%,#13110d 48%,#1c1710 100%)}
.pc-card.is-locked .pc-base{background:linear-gradient(135deg,#1d1f24 0%,#0e0f12 55%,#17181c 100%)}
.pc-brushed{position:absolute;inset:0;opacity:.7;background:repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,rgba(0,0,0,.12) 0 2px,transparent 2px 7px)}
.pc-lattice{position:absolute;inset:0;width:100%;height:100%;color:rgba(var(--accent),.22);transform:translate(var(--px),var(--py))}
.pc-guilloche{position:absolute;inset-inline-end:-20%;top:-38%;width:98%;aspect-ratio:1;color:rgba(var(--accent),.38);transform:translate(calc(var(--px) * 1.6),calc(var(--py) * 1.6))}
.pc-foil{position:absolute;inset:0;mix-blend-mode:screen;opacity:.5;background:conic-gradient(from calc(var(--ry) * 5 + 210deg) at 78% 18%,rgba(var(--accent),0) 0deg,rgba(var(--accent),.55) 40deg,rgba(120,190,255,.30) 95deg,rgba(255,150,225,.26) 150deg,rgba(var(--accent),.5) 205deg,rgba(var(--accent),0) 270deg)}
.pc-card.is-locked .pc-foil{opacity:.18}
.pc-glare{position:absolute;inset:-10%;pointer-events:none;mix-blend-mode:overlay;background:linear-gradient(112deg,transparent calc(30% + var(--gx)),rgba(255,255,255,.34) calc(46% + var(--gx)),transparent calc(60% + var(--gx)))}
.pc-spec{position:absolute;inset:0;pointer-events:none;mix-blend-mode:screen;background:radial-gradient(circle at var(--mx) var(--my),rgba(255,240,205,.55),rgba(255,240,205,.08) 34%,transparent 52%)}
.pc-grain{position:absolute;inset:0;opacity:.09;mix-blend-mode:overlay;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E")}
.pc-rim{position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 1.5px rgba(var(--accent),.55),inset 0 1px 0 rgba(255,255,255,.28),inset 0 -1px 0 rgba(0,0,0,.5);background:linear-gradient(115deg,rgba(255,255,255,.08),transparent 30%,transparent 62%,rgba(var(--accent),.22))}
.pc-content{position:absolute;inset:0;padding:1.45em 1.65em;display:flex;flex-direction:column;justify-content:space-between;transform:translateZ(38px) translate(var(--px),var(--py));transform-style:preserve-3d}
.pc-top{display:flex;align-items:center;gap:.8em;min-width:0;padding-inline-end:3.4em}
.pc-logo{flex:none;display:inline-flex;width:2.7em;height:2.7em;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;border:1px solid rgba(var(--accent),.7);background:rgba(0,0,0,.35);color:rgb(var(--accent));font-family:Georgia,serif;font-size:1.05em}
.pc-logo img{width:100%;height:100%;object-fit:cover}
.pc-brand{display:flex;flex-direction:column;line-height:1.15;min-width:0}
.pc-brand b{font-size:.84em;letter-spacing:.2em;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#f7e9c0}
.pc-brand i{font-style:normal;font-size:.5em;letter-spacing:.34em;opacity:.7;margin-top:.4em;font-weight:700}
.pc-pts{transform:translateZ(16px)}
.pc-pts small{display:block;font-size:.55em;letter-spacing:.34em;font-weight:700;opacity:.65;margin-bottom:.15em}
.pc-pts b{display:block;font-family:Georgia,"Times New Roman",serif;font-size:3.9em;line-height:1;font-weight:500;letter-spacing:.01em;font-variant-numeric:lining-nums tabular-nums;text-shadow:0 .05em .22em rgba(0,0,0,.45),0 0 .6em rgba(var(--accent),.25);white-space:nowrap}
.pc-pts b.is-empty{opacity:.3}
.pc-bottom{display:flex;align-items:flex-end;justify-content:space-between;gap:1em;min-width:0}
.pc-name{display:flex;flex-direction:column;min-width:0;max-width:66%}
.pc-name>span{font-size:.86em;letter-spacing:.14em;font-weight:700;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pc-name>span.is-ghost{opacity:.3}
.pc-name em{font-style:normal;font-size:.5em;letter-spacing:.2em;opacity:.65;margin-top:.5em;font-weight:600;white-space:nowrap}
.pc-ref{flex:none;font-size:.56em;letter-spacing:.2em;font-weight:700;opacity:.7;font-variant-numeric:tabular-nums}
.pc-seal{position:absolute;inset-inline-end:1.35em;top:1.2em;width:2.7em;height:2.7em;border-radius:50%;display:flex;align-items:center;justify-content:center;color:rgb(var(--accent));transform:translateZ(64px) translate(calc(var(--px) * 1.8),calc(var(--py) * 1.8));background:conic-gradient(from calc(var(--ry) * 8deg),rgba(var(--accent),.35),rgba(120,190,255,.3),rgba(255,150,225,.28),rgba(var(--accent),.4),rgba(var(--accent),.35));border:1px solid rgba(var(--accent),.6);box-shadow:0 0 1.2em rgba(var(--accent),.35)}
.pc-seal svg{width:1.15em;height:1.15em}
.pc-floor{width:74%;height:18px;margin:18px auto 0;border-radius:50%;background:radial-gradient(ellipse,rgba(0,0,0,.7),transparent 70%);filter:blur(8px);animation:pcFloor 11s ease-in-out infinite}
/* ---- tier materials (Phase 7) — chosen by the stable key, never by the display name ---- */
.pc-stage[data-tier="tier1"]{--accent:176,190,210}
.pc-stage[data-tier="tier1"] .pc-base{background:radial-gradient(120% 95% at 14% 0%,rgba(var(--accent),.14) 0%,rgba(0,0,0,0) 46%),linear-gradient(135deg,#2a2f37 0%,#171a20 55%,#1e2229 100%)}
.pc-stage[data-tier="tier1"] .pc-plate1{background:#3b414b}.pc-stage[data-tier="tier1"] .pc-plate2{background:#2c313a}.pc-stage[data-tier="tier1"] .pc-plate3{background:#1c2026}
.pc-stage[data-tier="tier1"] .pc-foil{opacity:.12}.pc-stage[data-tier="tier1"] .pc-glare{opacity:.5}
.pc-stage[data-tier="tier2"]{--accent:214,224,238}
.pc-stage[data-tier="tier2"] .pc-card{color:#162030}
.pc-stage[data-tier="tier2"] .pc-brand b{color:#162030}
.pc-stage[data-tier="tier2"] .pc-base{background:linear-gradient(135deg,#eef1f5 0%,#b4bdc9 36%,#e3e8ee 54%,#8d97a6 100%)}
.pc-stage[data-tier="tier2"] .pc-brushed{opacity:1;background:repeating-linear-gradient(90deg,rgba(255,255,255,.3) 0 1px,transparent 1px 3px),repeating-linear-gradient(90deg,rgba(0,0,0,.06) 0 2px,transparent 2px 7px)}
.pc-stage[data-tier="tier2"] .pc-lattice,.pc-stage[data-tier="tier2"] .pc-guilloche{color:rgba(40,52,70,.2)}
.pc-stage[data-tier="tier2"] .pc-logo{background:rgba(255,255,255,.4);color:#162030;border-color:rgba(22,32,48,.5)}
.pc-stage[data-tier="tier2"] .pc-seal{color:#162030;border-color:rgba(22,32,48,.4)}
.pc-stage[data-tier="tier2"] .pc-plate1{background:#7d8796}.pc-stage[data-tier="tier2"] .pc-plate2{background:#667080}.pc-stage[data-tier="tier2"] .pc-plate3{background:#4b5360}
.pc-stage[data-tier="tier3"]{--accent:255,226,140}
.pc-stage[data-tier="tier3"] .pc-card{color:#3a2706}
.pc-stage[data-tier="tier3"] .pc-brand b{color:#3a2706}
.pc-stage[data-tier="tier3"] .pc-base{background:linear-gradient(135deg,#f8e19a 0%,#cf9f33 38%,#f3d67f 56%,#a67a1d 100%)}
.pc-stage[data-tier="tier3"] .pc-brushed{opacity:.9;background:repeating-linear-gradient(115deg,rgba(255,255,255,.22) 0 1px,transparent 1px 4px)}
.pc-stage[data-tier="tier3"] .pc-lattice,.pc-stage[data-tier="tier3"] .pc-guilloche{color:rgba(90,60,10,.28)}
.pc-stage[data-tier="tier3"] .pc-logo{background:rgba(255,246,210,.45);color:#3a2706;border-color:rgba(58,39,6,.5)}
.pc-stage[data-tier="tier3"] .pc-seal{color:#3a2706;border-color:rgba(58,39,6,.45)}
.pc-stage[data-tier="tier3"] .pc-plate1{background:#a77b1d}.pc-stage[data-tier="tier3"] .pc-plate2{background:#85601a}.pc-stage[data-tier="tier3"] .pc-plate3{background:#5e4510}
.pc-stage[data-tier="tier4"]{--accent:236,200,155}
.pc-stage[data-tier="tier4"] .pc-base{background:radial-gradient(120% 100% at 10% 0%,#40306c 0%,#18122f 46%,#07060f 100%)}
.pc-stage[data-tier="tier4"] .pc-foil{opacity:.7}
.pc-stage[data-tier="tier4"] .pc-aura{background:radial-gradient(60% 55% at 50% 50%,rgba(150,110,230,.42),transparent 70%)}
.pc-stage[data-tier="tier4"] .pc-plate1{background:#3a2a55}.pc-stage[data-tier="tier4"] .pc-plate2{background:#2a1d3d}.pc-stage[data-tier="tier4"] .pc-plate3{background:#150f22}
@keyframes pcDeal{0%{opacity:0;transform:translateY(90px) rotateX(-62deg) rotateZ(-7deg) scale(.8)}55%{opacity:1;transform:translateY(-8px) rotateX(7deg) rotateZ(1deg) scale(1.025)}100%{opacity:1;transform:none}}
@keyframes pcSway{0%,100%{transform:rotateY(-4.5deg) rotateX(2deg)}50%{transform:rotateY(4.5deg) rotateX(-2deg)}}
@keyframes pcAura{0%,100%{opacity:.55;transform:scale(.97)}50%{opacity:.85;transform:scale(1.03)}}
@keyframes pcFloor{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(.88);opacity:.6}}
@media (prefers-reduced-motion: reduce){
  .pc-sway,.pc-aura,.pc-floor,.pc-card{animation:none!important}
  .pc-tilt{will-change:auto}
  .pc-sway{transform:rotateY(-3deg) rotateX(1.5deg)}
}
`;
