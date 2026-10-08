"use client";
import { createElement, useEffect, useId, useRef, useState, type CSSProperties, type ElementType, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconArrowBackUp,
  IconBan,
  IconCheck,
  IconClock,
  IconCoins,
  IconGift,
  IconHandStop,
  IconHourglassEmpty,
  IconInbox,
  IconStairsUp,
  IconUserPlus,
  IconX,
} from "@tabler/icons-react";
import { fmtNum, prefersReducedMotion, useAgo, useLT, type ActivityEvent, type ActivityKind } from "@/lib/loyalty";
import { useVisual } from "../shell/loyaltyDesign";

/* =====================================================================================================================
 * ClinicOS Loyalty — reusable component set (Phase 8).
 *   LoyaltySurface · LoyaltyPanel · LoyaltyMetric · StatusOrb · ProgressRail · LoyaltyEmptyState · LoyaltyLoader · LoyaltyErrorState
 *   SuccessBurst · ActivityItem · CinematicTransition · SegTabs · CountUp
 * (LoyaltyCard3D / TierCard3D live next to this folder; RewardObject, TierWorld, RedemptionFlow are in their own files.)
 * Styles: ./uiStyles.ts (UI_CSS, injected once by LoyaltyShell). No component carries its own colours — only tokens.
 * ===================================================================================================================== */

/** Renders into the Loyalty root (not <body>) so tokens apply, and outside any filtered / transformed ancestor so `position:fixed` is viewport-relative. */
export function LyxPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  const host = document.querySelector<HTMLElement>(".lyx-root") ?? document.body;
  return createPortal(children, host);
}

/* ---------- surface / panel ---------- */

type Tone = "gold" | "mint" | "rose" | "danger";
export function LoyaltySurface({
  as = "div",
  tone,
  pad,
  lift,
  rise,
  index,
  solid,
  className = "",
  style,
  children,
  ...rest
}: {
  as?: ElementType;
  tone?: Tone;
  pad?: boolean | "lg";
  lift?: boolean;
  rise?: boolean;
  index?: number;
  solid?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "style" | "className">) {
  return createElement(
    as,
    {
      "data-tone": tone,
      "data-pad": pad ? String(pad) : undefined,
      "data-solid": solid ? "true" : undefined,
      ...rest,
      className: `lyx-surface ${lift ? "is-lift" : ""} ${rise ? "is-rise" : ""} ${className}`,
      style: index !== undefined ? { ...style, ["--i" as string]: index } : style,
    },
    children
  );
}

export function LoyaltyPanel({
  title,
  subtitle,
  icon,
  action,
  tone,
  pad = true,
  className = "",
  index,
  testId,
  children,
}: {
  title?: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
  tone?: Tone;
  pad?: boolean | "lg";
  className?: string;
  index?: number;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <LoyaltySurface as="section" tone={tone} pad={pad} rise index={index} className={className} data-testid={testId}>
      {(title || action) && (
        <div className="lyx-ph">
          {icon && <span className="lyx-ph-ico">{icon}</span>}
          <div className="lyx-ph-tx">
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </LoyaltySurface>
  );
}

/* ---------- count-up (real numbers only; instant under reduced motion / when unchanged) ---------- */

export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    if (prefersReducedMotion() || from === value) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{fmtNum(shown)}</>;
}

/* ---------- metric: stat · hero · ring · spark ---------- */

export function LoyaltyMetric({
  label,
  value,
  hint,
  icon,
  tone,
  variant = "stat",
  ring,
  spark,
  index,
  testId,
}: {
  label: string;
  /** a real number (animated) or a ready node */
  value: number | ReactNode;
  hint?: string;
  icon?: ReactNode;
  tone?: "gold" | "mint" | "rose";
  variant?: "stat" | "hero" | "ring" | "spark";
  /** variant "ring": value / max, both real numbers (the ring is hidden when max is 0) */
  ring?: { value: number; max: number };
  /** variant "spark": a real per-day series */
  spark?: number[];
  index?: number;
  testId?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const shown = typeof value === "number" ? <CountUp value={value} /> : value;
  const pct = ring && ring.max > 0 ? Math.max(0, Math.min(1, ring.value / ring.max)) : 0;
  const C = 2 * Math.PI * 21;
  return (
    <LoyaltySurface rise index={index} lift className="lyx-metric" data-variant={variant} data-tone={tone} data-testid={testId}>
      <div className="lyx-metric-top">
        {icon && <span className="lyx-metric-ico">{icon}</span>}
        <span className="lyx-metric-label">{label}</span>
      </div>
      <div className="lyx-metric-row">
        <div className="min-w-0">
          <div className="lyx-metric-val lyx-num">{shown}</div>
          {hint && <div className="lyx-metric-hint mt-1">{hint}</div>}
        </div>
        {variant === "ring" && ring && ring.max > 0 && (
          <div className="lyx-ring" aria-hidden="true">
            <svg viewBox="0 0 50 50">
              <defs>
                <linearGradient id={`rg${gid}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#fff0bd" />
                  <stop offset="1" stopColor="#c9a24a" />
                </linearGradient>
              </defs>
              <circle className="bg" cx="25" cy="25" r="21" />
              <circle className="fg" cx="25" cy="25" r="21" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} style={{ stroke: `url(#rg${gid})` }} />
            </svg>
            <b>{Math.round(pct * 100)}%</b>
          </div>
        )}
      </div>
      {(variant === "spark" || variant === "hero") && spark && spark.length > 1 && <Spark data={spark} gid={gid} />}
    </LoyaltySurface>
  );
}

function Spark({ data, gid }: { data: number[]; gid: string }) {
  const W = 120;
  const H = 34;
  const max = Math.max(1, ...data);
  const pts = data.map((v, i) => [(i / (data.length - 1)) * W, H - 3 - (v / max) * (H - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;
  return (
    <svg className="lyx-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`sg${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e8c76a" stopOpacity=".5" />
          <stop offset="1" stopColor="#e8c76a" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="area" d={area} style={{ fill: `url(#sg${gid})` }} />
      <path className="line" d={line} style={{ ["--len" as string]: 400 } as CSSProperties} pathLength={400} />
    </svg>
  );
}

/* ---------- status: icon + word (never colour alone) ---------- */

export type OrbStatus = "pending" | "confirmed" | "active" | "ok" | "rejected" | "error" | "reversed" | "expired" | "cancelled" | "inactive" | "info";
const ORB_ICON: Record<OrbStatus, ReactNode> = {
  pending: <IconClock size={10} stroke={2.4} />,
  confirmed: <IconCheck size={10} stroke={2.6} />,
  active: <IconCheck size={10} stroke={2.6} />,
  ok: <IconCheck size={10} stroke={2.6} />,
  rejected: <IconX size={10} stroke={2.6} />,
  error: <IconAlertTriangle size={10} stroke={2.4} />,
  reversed: <IconArrowBackUp size={10} stroke={2.4} />,
  expired: <IconHourglassEmpty size={10} stroke={2.2} />,
  cancelled: <IconBan size={10} stroke={2.2} />,
  inactive: <IconBan size={10} stroke={2.2} />,
  info: <IconClock size={10} stroke={2.2} />,
};
export function StatusOrb({ status, label, pulse }: { status: OrbStatus; label: string; pulse?: boolean }) {
  return (
    <span className="lyx-orb" data-s={status} data-pulse={pulse ?? status === "pending" ? "true" : undefined}>
      <span className="lyx-orb-dot" aria-hidden="true">
        {ORB_ICON[status]}
      </span>
      {label}
    </span>
  );
}

/* ---------- progress rail ---------- */

export function ProgressRail({
  value,
  max,
  tone,
  tierColor,
  height = 8,
  ticks,
  label,
  testId,
}: {
  value: number;
  max: number;
  tone?: "mint" | "rose";
  /** CSS colour for a tier-coloured fill */
  tierColor?: string;
  height?: number;
  /** positions 0..1 of milestones */
  ticks?: number[];
  label: string;
  testId?: string;
}) {
  const p = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const style = { ["--p" as string]: p, ["--h" as string]: `${height}px`, ...(tierColor ? { ["--tc" as string]: tierColor } : {}) } as CSSProperties;
  return (
    <div className="lyx-pr" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={Math.max(0, max)} aria-valuenow={Math.max(0, Math.min(max, value))} data-tone={tierColor ? "tier" : tone} style={style} data-testid={testId}>
      <div className="lyx-pr-fill" />
      {ticks && (
        <div className="lyx-pr-ticks" aria-hidden="true">
          {ticks.map((x) => (
            <i key={x} style={{ ["--at" as string]: `${x * 100}%` } as CSSProperties} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- empty / loading / error / success ---------- */

export type EmptyKind = "members" | "checkins" | "rewards" | "redemptions" | "transactions" | "tiers" | "analytics" | "activity" | "generic";
export function LoyaltyEmptyState({ kind = "generic", icon, title, text, action, compact }: { kind?: EmptyKind; icon?: ReactNode; title: string; text?: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className="lyx-empty" data-kind={kind} data-compact={compact ? "true" : undefined} data-testid="lyx-empty">
      <div className="lyx-empty-stage" aria-hidden="true">
        <div className="lyx-empty-tile t1" />
        <div className="lyx-empty-tile t2" />
        <div className="lyx-empty-tile t3">{icon ?? <IconInbox size={30} stroke={1.5} />}</div>
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action && <div className="lyx-empty-act">{action}</div>}
    </div>
  );
}

export function LoyaltyLoader({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden="true" className={`lyx-load ${className}`} style={style} />;
}

export function LoyaltyErrorState({ message, onRetry, title }: { message: string; onRetry?: () => void; title?: string }) {
  const { t } = useLT();
  return (
    <div role="alert" className="lyx-err" data-testid="lyx-error">
      <span className="lyx-err-ico">
        <IconAlertTriangle size={17} />
      </span>
      <div className="lyx-err-b">
        {title && <b>{title}</b>}
        {message}
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          {t("Retry", "إعادة المحاولة")}
        </button>
      )}
    </div>
  );
}

/** Shown ONLY after the server has confirmed an action. */
export function SuccessBurst({ tone = "mint", icon }: { tone?: "mint" | "gold" | "rose"; icon?: ReactNode }) {
  return (
    <span className="lyx-burst" data-tone={tone} aria-hidden="true">
      <i />
      <i />
      <span className="lyx-burst-core">{icon ?? <IconCheck size={30} stroke={2.6} />}</span>
    </span>
  );
}

/* ---------- segmented tabs ---------- */

export function SegTabs<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; badge?: number; testId?: string }[]; label: string }) {
  return (
    <div className="lyx-seg-tabs" role="tablist" aria-label={label}>
      {items.map((x) => (
        <button
          key={x.id}
          type="button"
          role="tab"
          aria-selected={value === x.id}
          data-testid={x.testId}
          onClick={() => onChange(x.id)}
          onKeyDown={(e) => {
            const i = items.findIndex((y) => y.id === value);
            const dir = document.documentElement.dir === "rtl" ? -1 : 1;
            let n = -1;
            if (e.key === "ArrowRight") n = (i + dir + items.length) % items.length;
            else if (e.key === "ArrowLeft") n = (i - dir + items.length) % items.length;
            if (n >= 0) {
              e.preventDefault();
              onChange(items[n].id);
              (e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus();
            }
          }}
          tabIndex={value === x.id ? 0 : -1}
        >
          {x.label}
          {!!x.badge && x.badge > 0 && <span className="lyx-badge">{x.badge > 99 ? "99+" : x.badge}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- activity ---------- */

const KIND_ICON: Record<ActivityKind, ReactNode> = {
  new_member: <IconUserPlus size={17} stroke={1.7} />,
  points_earned: <IconCoins size={17} stroke={1.7} />,
  points_adjusted: <IconAdjustmentsHorizontal size={17} stroke={1.7} />,
  points_reversed: <IconArrowBackUp size={17} stroke={1.7} />,
  checkin_confirmed: <IconHandStop size={17} stroke={1.7} />,
  reward_redeemed: <IconGift size={17} stroke={1.7} />,
  reward_reversed: <IconArrowBackUp size={17} stroke={1.7} />,
  member_promoted: <IconStairsUp size={17} stroke={1.7} />,
};

export function useActivityText() {
  const { t } = useLT();
  return (e: ActivityEvent): { title: string; sub: string } => {
    const name = e.patient?.fullName ?? t("A member", "عضو");
    const l = e.label ?? "";
    switch (e.kind) {
      case "new_member":
        return { title: name, sub: t("Joined the program", "انضمّ إلى البرنامج") };
      case "points_earned":
        return { title: name, sub: t("Earned points", "كسب نقاطًا") };
      case "points_adjusted":
        return { title: name, sub: t("Points adjusted by staff", "تعديل نقاط من الموظفين") };
      case "points_reversed":
        return { title: name, sub: t("Points reversed", "عكس حركة نقاط") };
      case "checkin_confirmed":
        return { title: name, sub: t("Check-in confirmed", "تأكيد تسجيل وصول") };
      case "reward_redeemed":
        return { title: name, sub: l ? t(`Redeemed ${l}`, `استبدل ${l}`) : t("Redeemed a reward", "استبدل مكافأة") };
      case "reward_reversed":
        return { title: name, sub: l ? t(`Redemption reversed · ${l}`, `عكس استبدال · ${l}`) : t("Redemption reversed", "عكس استبدال") };
      case "member_promoted":
        return { title: name, sub: l ? t(`Reached ${l}`, `وصل إلى ${l}`) : t("Moved up a tier", "ترقّى إلى مستوى أعلى") };
    }
  };
}

export function ActivityItem({ event, now, fresh, onOpen }: { event: ActivityEvent; now: number; fresh?: boolean; onOpen?: (e: ActivityEvent) => void }) {
  const { t } = useLT();
  const ago = useAgo();
  const text = useActivityText()(event);
  const pts = event.points;
  const reversal = event.kind === "points_reversed" || event.kind === "reward_reversed";
  const kind = reversal ? "reversal" : pts !== null && pts < 0 ? "debit" : "credit";
  const body = (
    <>
      <span className="lyx-act-g" aria-hidden="true">
        {KIND_ICON[event.kind]}
      </span>
      <span className="lyx-act-b">
        <b>{text.title}</b>
        <span>
          {text.sub} · {ago(event.at, now)}
        </span>
      </span>
      {pts !== null && pts !== 0 && (
        <span className="lyx-act-p">
          <span className="lyx-delta" data-k={kind} dir="ltr">
            {reversal && <IconArrowBackUp size={12} stroke={2.4} />}
            {pts > 0 ? "+" : "−"}
            {fmtNum(Math.abs(pts))}
          </span>
          <small>{reversal ? t("returned", "أُعيدت") : pts > 0 ? t("credit", "إضافة") : t("debit", "خصم")}</small>
        </span>
      )}
    </>
  );
  return (
    <li className={`lyx-act ${fresh ? "is-new" : ""}`} data-k={event.kind} data-testid="lyx-activity-item" data-event-id={event.id}>
      {onOpen ? (
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-start" onClick={() => onOpen(event)}>
          {body}
        </button>
      ) : (
        body
      )}
    </li>
  );
}

/* ---------- cinematic moment ---------- */

/**
 * A full-screen moment for rare, meaningful events (a real promotion, a big confirmation). Click / Esc / Enter dismiss it. Under reduced motion it is a
 * plain fade with no rays or movement. Only mount it in response to a real, server-confirmed event.
 */
export function CinematicTransition({ open, onDone, children, ms = 2600 }: { open: boolean; onDone: () => void; children: ReactNode; ms?: number }) {
  const { mode } = useVisual();
  const [out, setOut] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!open) {
      setOut(false);
      return;
    }
    const total = mode === "static" ? 1400 : ms;
    let closed = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const close = () => {
      if (closed) return;
      closed = true;
      setOut(true);
      timers.push(setTimeout(() => done.current(), mode === "static" ? 0 : 300));
    };
    closeRef.current = close;
    timers.push(setTimeout(close, total));
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") close();
    };
    window.addEventListener("keydown", key);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("keydown", key);
    };
  }, [open, mode, ms]);
  if (!open) return null;
  return (
    <LyxPortal>
      <div className={`lyx-moment ${out ? "is-out" : ""}`} role="status" aria-live="polite" onClick={() => closeRef.current()} data-testid="lyx-moment">
        <div className="lyx-moment-rays" aria-hidden="true" />
        <div className="lyx-moment-in">{children}</div>
      </div>
    </LyxPortal>
  );
}

/* ---------- switch ---------- */

/** Premium on/off switch (role="switch"). `busy` shows a spinner while a save is in flight; the parent decides the state, never the switch itself. */
export function LyxSwitch({ checked, onChange, label, disabled, busy, testId }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean; busy?: boolean; testId?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange} className="lyx-switch" data-testid={testId}>
      <span className="lyx-switch-knob">{busy && <span className="lyc-spinner" aria-hidden="true" />}</span>
    </button>
  );
}
