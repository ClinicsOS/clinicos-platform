"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, adminErrMsg } from "@/lib/adminApi";
import type { AddonSubscription, AddonStatus, AdminAddonsResponse } from "@/lib/types";
import LoyaltyModuleCard, {
  LoyaltyStyles,
  type LoyaltyFx,
  type LoyaltyVisualState,
} from "./LoyaltyModuleCard";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconEdit,
  IconLockOpen,
  IconPlayerPause,
  IconPlayerPlay,
  IconSparkles,
  IconBan,
  IconX,
} from "@tabler/icons-react";

/**
 * PAID ADD-ONS → ClinicOS Loyalty (Platform Admin only; lives inside /admin/clinics/[id]).
 *
 * Source of truth is ALWAYS the server:
 *   - what is shown comes from GET /api/admin/clinics/:id/addons (or the server's response to an action)
 *   - nothing is changed optimistically; a failed request leaves the previous state on screen
 *   - the unlock / state animations are triggered by the status the SERVER reports changing,
 *     so they can only ever play after a successful backend response
 *
 * This component only manages ENTITLEMENT (has the clinic paid / may it use the module).
 * Loyalty program rules (points, tiers, rewards…) are a later phase and are not here.
 */

const ADDON = "loyalty" as const;
const DAY = 86_400_000;

/* ---------- helpers ---------- */

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";

const fmtJod = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })} JOD`;

/** yyyy-mm-dd for <input type="date"> (local calendar day). */
const toInputDate = (d: Date | string | null | undefined) => {
  if (!d) return "";
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${x.getFullYear()}-${m}-${day}`;
};
const addDaysInput = (from: string, days: number) => {
  const d = from ? new Date(`${from}T12:00:00`) : new Date();
  return toInputDate(new Date(d.getTime() + days * DAY));
};

/** Dates go to the API as ISO strings; period END is made inclusive of its whole day. */
const startIso = (d: string) => new Date(`${d}T00:00:00`).toISOString();
const endIso = (d: string) => new Date(`${d}T23:59:59`).toISOString();

/** Strict money parse: "120", "10.5", "0.250" → number; anything else → NaN. */
const parseMoney = (s: string): number => (/^\d+(\.\d{1,3})?$/.test(s.trim()) ? Number(s.trim()) : NaN);

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Count-up for values that change (price / fee). Instant when reduced motion is on. */
function AnimatedJod({ value }: { value: number | null }) {
  const [shown, setShown] = useState<number | null>(value);
  const prev = useRef<number | null>(value);
  useEffect(() => {
    const from = prev.current ?? 0;
    prev.current = value;
    if (value === null || prefersReducedMotion() || from === value) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 650);
      setShown(from + (value - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  if (shown === null) return <>—</>;
  const settled = shown === value;
  return <>{(settled ? shown : Math.round(shown * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 3 })} JOD</>;
}

/* ---------- derived presentation state ---------- */

function visualState(a: AddonSubscription): LoyaltyVisualState {
  if (a.status === "active" && !a.entitled) return "hold"; // paid & active, but blocked right now
  return a.status;
}

const REASON_TEXT: Record<string, (a: AddonSubscription) => string> = {
  account_suspended: () =>
    "This clinic's ClinicOS account is suspended, so Loyalty is on hold. It resumes automatically when the account is reactivated.",
  account_expired: () =>
    "This clinic's ClinicOS plan has expired, so Loyalty is on hold. It resumes automatically when the plan is renewed.",
  period_ended: (a) =>
    `The Loyalty billing period ended on ${fmtDate(a.currentPeriodEnd)}. Use “Edit Subscription” to set the new period end — or Suspend / Cancel it.`,
};

/* ============================================================
 * Section
 * ============================================================ */

type ModalKind = "activate" | "edit" | "suspend" | "reactivate" | "cancel" | null;

export default function LoyaltyAddonSection({
  clinicId,
  clinicName,
}: {
  clinicId: string;
  clinicName: string;
}) {
  const qc = useQueryClient();
  const queryKey = ["admin", "clinic", clinicId, "addons"];

  const { data, isLoading, isError, refetch, isFetching } = useQuery<AdminAddonsResponse>({
    queryKey,
    queryFn: async () => (await adminApi.get(`/admin/clinics/${clinicId}/addons`)).data,
  });

  const [modal, setModal] = useState<ModalKind>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const showToast = (type: "success" | "error", text: string) => {
    setToast({ type, text });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const addon = data?.addons[ADDON];

  /**
   * Animation trigger. We never animate from a click: we animate when the status the SERVER
   * reports actually CHANGES (first load is ignored). Since the UI never writes status locally,
   * this can only happen after the backend confirmed the change.
   */
  const [fx, setFx] = useState<LoyaltyFx>(null);
  const prevStatus = useRef<AddonStatus | undefined>(undefined);
  const fxArmed = useRef(false); // set ONLY by a successful action response (see onSuccess)
  const fxTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    const cur = addon?.status;
    const prev = prevStatus.current;
    if (cur) prevStatus.current = cur;
    if (!cur || !prev || cur === prev) return;
    // A cached-then-refreshed page open, or a change made by another admin, must not play a
    // celebration: only a status change that THIS admin just made, confirmed by the server, does.
    if (!fxArmed.current) return;
    fxArmed.current = false;
    let next: LoyaltyFx = null;
    if (cur === "active") next = prev === "suspended" ? "reactivate" : "unlock";
    else if (cur === "suspended") next = "suspend";
    else if (cur === "cancelled") next = "cancel";
    if (!next) return;
    setFx(next);
    clearTimeout(fxTimer.current);
    fxTimer.current = setTimeout(() => setFx(null), next === "unlock" ? 2300 : 1600);
  }, [addon?.status]);
  useEffect(() => () => clearTimeout(fxTimer.current), []);

  /** Run an admin action. The cache is updated ONLY with the server's response. */
  const action = useMutation({
    mutationFn: async (v: { method: "post" | "patch"; path: string; body: Record<string, unknown> }) =>
      (await adminApi.request({ method: v.method, url: `/admin/clinics/${clinicId}/addons/${ADDON}${v.path}`, data: v.body }))
        .data as { addon: AddonSubscription; message: string },
    onSuccess: (res) => {
      if (res.addon.status !== prevStatus.current) fxArmed.current = true;
      qc.setQueryData<AdminAddonsResponse>(queryKey, (old) =>
        old ? { ...old, addons: { ...old.addons, [ADDON]: res.addon } } : old
      );
      setModal(null);
      showToast("success", res.message);
      // keep the rest of the clinic page (and the add-on view) honest
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["admin", "clinic", clinicId] });
    },
    onError: (e) => {
      // On a conflict someone else changed it — reload the truth so the buttons match reality.
      refetch();
      void e;
    },
  });

  const openModal = (k: ModalKind) => {
    action.reset();
    setModal(k);
  };

  /* ---------- loading / error ---------- */
  if (isLoading) {
    return (
      <section className="lyl-rise mb-5 overflow-hidden rounded-xl border border-amber-200/10 bg-[#0d0a07]/80 p-4 sm:p-5" aria-busy="true">
        <LoyaltyStyles />
        <div className="mb-3 h-3 w-32 rounded lyl-shimmer" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_1fr]">
          <div className="aspect-[1.58/1] w-full max-w-[360px] rounded-3xl lyl-shimmer" />
          <div className="space-y-3">
            <div className="h-5 w-40 rounded lyl-shimmer" />
            <div className="h-24 rounded lyl-shimmer" />
            <div className="h-9 w-48 rounded lyl-shimmer" />
          </div>
        </div>
      </section>
    );
  }

  if (isError || !data || !addon) {
    return (
      <section className="mb-5 rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-[12px] text-red-200">
        <LoyaltyStyles />
        Couldn’t load paid add-ons for this clinic.{" "}
        <button onClick={() => refetch()} className="underline underline-offset-2 hover:text-white">
          Try again
        </button>
      </section>
    );
  }

  const def = data.defaults[ADDON];
  const state = visualState(addon);
  const canActivate = addon.status === "inactive" || addon.status === "cancelled";
  const reasonMsg = addon.reason && REASON_TEXT[addon.reason] ? REASON_TEXT[addon.reason](addon) : null;
  const total = addon.status === "active" && addon.monthlyPrice !== null ? data.clinicPlan.monthlyPrice + addon.monthlyPrice : null;

  return (
    <section
      aria-labelledby="paid-addons-title"
      className="lyl-rise mb-5 overflow-hidden rounded-xl border border-amber-200/15 bg-gradient-to-br from-[#17110a] via-[#0d0a07] to-[#090706] shadow-[0_20px_60px_-30px_rgba(236,208,138,0.25)]"
    >
      <LoyaltyStyles />

      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200/10 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <IconSparkles size={15} className="shrink-0 text-amber-300" />
          <h2 id="paid-addons-title" className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-100/90">
            Paid Add-ons
          </h2>
        </div>
        <span className="text-[10px] text-amber-100/40">Platform admin only · separate from the ClinicOS plan</span>
      </div>

      {/* inline notification (live region) */}
      <div aria-live="polite" role="status" className="px-4 sm:px-5">
        {toast && (
          <div
            className={`lyl-toast mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] ${
              toast.type === "success"
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100"
                : "border-red-400/40 bg-red-500/10 text-red-100"
            }`}
          >
            {toast.type === "success" ? <IconCircleCheck size={15} className="mt-0.5 shrink-0" /> : <IconAlertTriangle size={15} className="mt-0.5 shrink-0" />}
            <span className="min-w-0 break-words">{toast.text}</span>
          </div>
        )}
      </div>

      <div className="grid gap-6 p-4 sm:p-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:items-center">
        {/* LEFT — the module card */}
        <div className="lyl-rise-2 min-w-0">
          <LoyaltyModuleCard state={state} fx={fx} clinicName={clinicName} />
        </div>

        {/* RIGHT — status, details, actions */}
        <div className="lyl-rise-3 min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h3 className="font-serif text-xl font-medium text-amber-50 sm:text-2xl">{def.name}</h3>
            <StatusPill key={`${addon.status}-${addon.entitled}`} addon={addon} />
          </div>
          <p className="mb-4 max-w-xl text-[12px] leading-relaxed text-amber-100/55">
            {addon.status === "inactive" || !addon.hasRecord
              ? `Not subscribed. Activating adds ${def.name} to this clinic as a paid add-on on top of its ${data.clinicPlan.plan} plan — the plan itself does not change.`
              : addon.status === "cancelled"
              ? "Subscription cancelled. The record is kept, so it can be re-activated at any time."
              : addon.status === "suspended"
              ? "Temporarily switched off. The subscription record is kept and can be reactivated instantly."
              : "Subscribed. The clinic can use this module while the account and billing period are in good standing."}
          </p>

          {reasonMsg && (
            <div className="lyl-pop mb-4 flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-[12px] text-amber-100">
              <IconAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
              <span className="min-w-0 break-words">{reasonMsg}</span>
            </div>
          )}

          {addon.hasRecord ? (
            <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-amber-200/10 bg-amber-200/10 text-[12px]">
              <Cell label="Setup fee (one-time)">
                <AnimatedJod value={addon.setupFee} />
              </Cell>
              <Cell label="Monthly price">
                <AnimatedJod value={addon.monthlyPrice} />
              </Cell>
              <Cell label="Activated">{fmtDate(addon.activatedAt)}</Cell>
              <Cell label="Current period">
                <span className="block">{fmtDate(addon.currentPeriodStart)}</span>
                <span className="block text-amber-100/50">→ {fmtDate(addon.currentPeriodEnd)}</span>
              </Cell>
              <Cell label="Next renewal / expiry" wide>
                <span className="block">{fmtDate(addon.currentPeriodEnd)}</span>
                <DaysLeft addon={addon} />
              </Cell>
              {addon.status === "suspended" && (
                <Cell label="Suspended on" wide>
                  {fmtDate(addon.suspendedAt)}
                </Cell>
              )}
              {addon.status === "cancelled" && (
                <Cell label="Cancelled on" wide>
                  {fmtDate(addon.cancelledAt)}
                </Cell>
              )}
            </dl>
          ) : (
            <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-amber-200/10 bg-amber-200/10 text-[12px]">
              <Cell label="List price">{fmtJod(def.defaultMonthlyPrice)} / month</Cell>
              <Cell label="Setup fee">
                {def.setupFeeGuidance ? `typically ${def.setupFeeGuidance.min}–${def.setupFeeGuidance.max} JOD` : "agreed per clinic"}
              </Cell>
            </dl>
          )}

          {total !== null && addon.monthlyPrice !== null && (
            <p className="mb-4 rounded-md bg-amber-200/5 px-3 py-2 text-[11px] text-amber-100/60">
              Monthly total for this clinic:{" "}
              <span className="text-amber-100">
                {fmtJod(data.clinicPlan.monthlyPrice)} ({data.clinicPlan.plan}) + {fmtJod(addon.monthlyPrice)} (Loyalty) ={" "}
                <b className="text-amber-200">{fmtJod(total)}</b>
              </span>
            </p>
          )}

          {/* actions */}
          <div className="flex flex-wrap gap-2">
            {canActivate && (
              <Btn primary onClick={() => openModal("activate")} icon={<IconLockOpen size={14} />}>
                Activate Loyalty
              </Btn>
            )}
            {addon.status === "suspended" && (
              <Btn primary onClick={() => openModal("reactivate")} icon={<IconPlayerPlay size={14} />}>
                Reactivate
              </Btn>
            )}
            {(addon.status === "active" || addon.status === "suspended") && (
              <Btn onClick={() => openModal("edit")} icon={<IconEdit size={14} />}>
                Edit Subscription
              </Btn>
            )}
            {addon.status === "active" && (
              <Btn onClick={() => openModal("suspend")} icon={<IconPlayerPause size={14} />}>
                Suspend
              </Btn>
            )}
            {(addon.status === "active" || addon.status === "suspended") && (
              <Btn danger onClick={() => openModal("cancel")} icon={<IconBan size={14} />}>
                Cancel
              </Btn>
            )}
            {isFetching && <span className="ml-1 self-center text-[10px] text-amber-100/40">Syncing…</span>}
          </div>
        </div>
      </div>

      {/* modals */}
      {modal === "activate" && (
        <ActivateModal
          mode={addon.status === "cancelled" ? "resubscribe" : "new"}
          addon={addon}
          defaultMonthly={def.defaultMonthlyPrice}
          defaultPeriodDays={def.defaultPeriodDays}
          guidance={def.setupFeeGuidance}
          busy={action.isPending}
          error={action.isError ? adminErrMsg(action.error, "Activation failed") : null}
          onClose={() => setModal(null)}
          onSubmit={(body) => action.mutate({ method: "post", path: "/activate", body })}
        />
      )}
      {modal === "edit" && (
        <EditModal
          addon={addon}
          busy={action.isPending}
          error={action.isError ? adminErrMsg(action.error, "Update failed") : null}
          onClose={() => setModal(null)}
          onSubmit={(body) => action.mutate({ method: "patch", path: "", body })}
        />
      )}
      {modal === "reactivate" && (
        <ReactivateModal
          addon={addon}
          defaultPeriodDays={def.defaultPeriodDays}
          busy={action.isPending}
          error={action.isError ? adminErrMsg(action.error, "Reactivation failed") : null}
          onClose={() => setModal(null)}
          onSubmit={(body) => action.mutate({ method: "post", path: "/reactivate", body })}
        />
      )}
      {(modal === "suspend" || modal === "cancel") && (
        <ConfirmModal
          kind={modal}
          busy={action.isPending}
          error={action.isError ? adminErrMsg(action.error, modal === "suspend" ? "Suspend failed" : "Cancel failed") : null}
          onClose={() => setModal(null)}
          onSubmit={(body) => action.mutate({ method: "post", path: modal === "suspend" ? "/suspend" : "/cancel", body })}
        />
      )}
    </section>
  );
}

/* ============================================================
 * Small presentational pieces
 * ============================================================ */

function StatusPill({ addon }: { addon: AddonSubscription }) {
  const hold = addon.status === "active" && !addon.entitled;
  const s = hold
    ? { label: "Active · on hold", cls: "bg-amber-400/15 text-amber-200 ring-amber-400/40", dot: "bg-amber-300", live: false }
    : {
        inactive: { label: "Not Active", cls: "bg-slate-400/10 text-slate-300 ring-slate-400/30", dot: "bg-slate-400", live: false },
        active: { label: "Active", cls: "bg-emerald-400/15 text-emerald-200 ring-emerald-400/40", dot: "bg-emerald-400", live: true },
        suspended: { label: "Suspended", cls: "bg-amber-400/15 text-amber-200 ring-amber-400/40", dot: "bg-amber-300", live: false },
        cancelled: { label: "Cancelled", cls: "bg-red-500/15 text-red-200 ring-red-400/40", dot: "bg-red-400", live: false },
      }[addon.status];
  return (
    <span className={`lyl-pop inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ring-1 ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.live ? "lyl-livedot" : ""}`} />
      {s.label}
    </span>
  );
}

function Cell({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 bg-[#0d0a07] p-3 ${wide ? "col-span-2" : ""}`}>
      <dt className="mb-1 text-[9px] uppercase tracking-[0.2em] text-amber-100/40">{label}</dt>
      <dd className="break-words text-[13px] font-medium text-amber-50">{children}</dd>
    </div>
  );
}

function DaysLeft({ addon }: { addon: AddonSubscription }) {
  const d = addon.daysUntilPeriodEnd;
  if (d === null) return null;
  const cls = d < 0 ? "text-red-300" : d <= 7 ? "text-amber-300" : "text-emerald-300/80";
  const text = d < 0 ? `ended ${Math.abs(d)} day${Math.abs(d) === 1 ? "" : "s"} ago` : d === 0 ? "ends today" : `${d} day${d === 1 ? "" : "s"} left`;
  return <span className={`block text-[11px] ${cls}`}>{text}</span>;
}

function Btn({
  children,
  onClick,
  icon,
  primary,
  danger,
}: {
  children: ReactNode;
  onClick: () => void;
  icon?: ReactNode;
  primary?: boolean;
  danger?: boolean;
}) {
  const cls = primary
    ? "bg-gradient-to-br from-amber-200 via-amber-400 to-amber-500 text-[#2a1d06] shadow-[0_8px_24px_-10px_rgba(236,180,60,0.7)] hover:brightness-110"
    : danger
    ? "border border-red-400/40 bg-red-500/10 text-red-200 hover:bg-red-500/20"
    : "border border-amber-200/20 bg-amber-200/5 text-amber-50 hover:bg-amber-200/10";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-md px-3.5 py-2 text-[12px] font-semibold transition active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70 ${cls}`}
    >
      {icon}
      {children}
    </button>
  );
}

/* ============================================================
 * Modal shell + form pieces
 * ============================================================ */

function Modal({
  title,
  subtitle,
  onClose,
  busy,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Latest props via refs so the effects below run once — a parent re-render (e.g. a background
  // refetch) must never re-focus a field while the admin is typing.
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    boxRef.current?.querySelector<HTMLElement>("input,textarea,button[data-autofocus]")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Rendered in a portal on <body>: the section above has an entrance transform and overflow-hidden,
  // either of which would trap or clip a `position: fixed` modal rendered inside it.
  if (typeof document === "undefined") return null;
  return createPortal(
    // z-modal: above the ChatWidget (z-nabd) and the page header.
    <div
      className="lyl-overlay fixed inset-0 z-modal flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="lyl-modal max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-amber-200/20 bg-gradient-to-b from-[#1b140a] to-[#0d0a07] p-5 shadow-2xl sm:max-w-md sm:rounded-2xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-serif text-lg text-amber-50">{title}</h3>
            {subtitle && <p className="mt-0.5 text-[11px] text-amber-100/50">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-amber-100/60 hover:bg-amber-200/10 hover:text-white disabled:opacity-40"
          >
            <IconX size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

const inputCls =
  "w-full min-h-[40px] rounded-md border border-amber-200/20 bg-black/40 px-3 py-2 text-[13px] text-amber-50 placeholder:text-amber-100/25 focus:border-amber-300/70 focus:outline-none focus:ring-1 focus:ring-amber-300/40 disabled:opacity-50";

function FormField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-amber-100/50">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] text-red-300" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-[10px] text-amber-100/35">{hint}</span>
      ) : null}
    </label>
  );
}

function ServerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="lyl-pop mb-3 flex items-start gap-2 rounded-md border border-red-400/40 bg-red-500/10 p-2.5 text-[12px] text-red-100">
      <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

function Actions({
  onClose,
  busy,
  confirmLabel,
  busyLabel,
  danger,
  disabled,
  onConfirm,
}: {
  onClose: () => void;
  busy: boolean;
  confirmLabel: string;
  busyLabel: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={onClose}
        disabled={busy}
        className="min-h-[40px] rounded-md border border-amber-200/20 bg-black/30 px-4 py-2 text-[12px] text-amber-50 hover:bg-amber-200/10 disabled:opacity-50"
      >
        Close
      </button>
      <button
        type="button"
        data-autofocus
        onClick={onConfirm}
        disabled={busy || disabled}
        className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-md px-4 py-2 text-[12px] font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
          danger
            ? "bg-red-600 text-white hover:bg-red-500"
            : "bg-gradient-to-br from-amber-200 via-amber-400 to-amber-500 text-[#2a1d06] hover:brightness-110"
        }`}
      >
        {busy && <span className="lyl-spinner" aria-hidden="true" />}
        {busy ? busyLabel : confirmLabel}
      </button>
    </div>
  );
}

/* ============================================================
 * Modals
 * ============================================================ */

function ActivateModal({
  mode,
  addon,
  defaultMonthly,
  defaultPeriodDays,
  guidance,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  mode: "new" | "resubscribe";
  addon: AddonSubscription;
  defaultMonthly: number;
  defaultPeriodDays: number;
  guidance: { min: number; max: number } | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const today = toInputDate(new Date());
  const [setupFee, setSetupFee] = useState(addon.setupFee !== null ? String(addon.setupFee) : "");
  const [monthly, setMonthly] = useState(String(addon.monthlyPrice ?? defaultMonthly));
  const [activated, setActivated] = useState(today);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(addDaysInput(today, defaultPeriodDays));
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const fee = parseMoney(setupFee);
  const mon = parseMoney(monthly);
  const errs = {
    setupFee: Number.isNaN(fee) ? "Enter the agreed setup fee (0 or more, e.g. 120)" : null,
    monthly: Number.isNaN(mon) ? "Enter the monthly price (0 or more, e.g. 10)" : null,
    dates:
      !start || !end || !activated
        ? "All dates are required"
        : new Date(`${end}T23:59:59`) <= new Date(`${start}T00:00:00`)
        ? "Period end must be after period start"
        : new Date(`${end}T23:59:59`) <= new Date()
        ? "Period end must be in the future"
        : null,
  };
  const valid = !errs.setupFee && !errs.monthly && !errs.dates;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    onSubmit({
      setupFee: fee,
      monthlyPrice: mon,
      activatedAt: startIso(activated),
      currentPeriodStart: startIso(start),
      currentPeriodEnd: endIso(end),
      reason: reason.trim() || undefined,
    });
  };

  return (
    <Modal
      title={mode === "resubscribe" ? "Re-activate Loyalty" : "Activate ClinicOS Loyalty"}
      subtitle={mode === "resubscribe" ? "Previous pricing is pre-filled — change it if the new agreement differs." : "Agree the price with the clinic first, then enter it here."}
      onClose={onClose}
      busy={busy}
    >
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="Setup fee (JOD)"
          error={touched ? errs.setupFee : null}
          hint={guidance ? `One-time · typically ${guidance.min}–${guidance.max}` : "One-time"}
        >
          <input className={inputCls} inputMode="decimal" placeholder="e.g. 120" value={setupFee} onChange={(e) => setSetupFee(e.target.value)} disabled={busy} />
        </FormField>
        <FormField label="Monthly price (JOD)" error={touched ? errs.monthly : null} hint={`List price ${defaultMonthly}`}>
          <input className={inputCls} inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} disabled={busy} />
        </FormField>
      </div>
      <FormField label="Activation date">
        <input type="date" className={inputCls} value={activated} onChange={(e) => setActivated(e.target.value)} disabled={busy} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Period start">
          <input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} />
        </FormField>
        <FormField label="Period end" error={touched ? errs.dates : null}>
          <input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} disabled={busy} />
        </FormField>
      </div>
      <FormField label="Reason / note (audit log, optional)">
        <textarea className={inputCls} rows={2} maxLength={300} placeholder="e.g. Pilot customer — paid via CliQ" value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
      </FormField>
      <ServerError message={error} />
      <Actions onClose={onClose} busy={busy} confirmLabel="Activate Loyalty" busyLabel="Activating…" onConfirm={submit} />
    </Modal>
  );
}

function EditModal({
  addon,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  addon: AddonSubscription;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [setupFee, setSetupFee] = useState(String(addon.setupFee ?? 0));
  const [monthly, setMonthly] = useState(String(addon.monthlyPrice ?? 0));
  const [activated, setActivated] = useState(toInputDate(addon.activatedAt));
  const [start, setStart] = useState(toInputDate(addon.currentPeriodStart));
  const [end, setEnd] = useState(toInputDate(addon.currentPeriodEnd));
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);

  const fee = parseMoney(setupFee);
  const mon = parseMoney(monthly);
  const errs = {
    setupFee: Number.isNaN(fee) ? "Enter 0 or more" : null,
    monthly: Number.isNaN(mon) ? "Enter 0 or more" : null,
    dates:
      start && end && new Date(`${end}T23:59:59`) <= new Date(`${start}T00:00:00`)
        ? "Period end must be after period start"
        : addon.status === "active" && end && new Date(`${end}T23:59:59`) <= new Date()
        ? "An active subscription's period end must be in the future"
        : null,
  };
  const valid = !errs.setupFee && !errs.monthly && !errs.dates;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    // Send only what actually changed; the server also ignores no-ops.
    const body: Record<string, unknown> = {};
    if (fee !== addon.setupFee) body.setupFee = fee;
    if (mon !== addon.monthlyPrice) body.monthlyPrice = mon;
    if (activated && activated !== toInputDate(addon.activatedAt)) body.activatedAt = startIso(activated);
    if (start && start !== toInputDate(addon.currentPeriodStart)) body.currentPeriodStart = startIso(start);
    if (end && end !== toInputDate(addon.currentPeriodEnd)) body.currentPeriodEnd = endIso(end);
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    if (reason.trim()) body.reason = reason.trim();
    onSubmit(body);
  };

  return (
    <Modal title="Edit Subscription" subtitle="Changes pricing and dates only — status is changed with Suspend / Reactivate / Cancel." onClose={onClose} busy={busy}>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Setup fee (JOD)" error={touched ? errs.setupFee : null}>
          <input className={inputCls} inputMode="decimal" value={setupFee} onChange={(e) => setSetupFee(e.target.value)} disabled={busy} />
        </FormField>
        <FormField label="Monthly price (JOD)" error={touched ? errs.monthly : null}>
          <input className={inputCls} inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} disabled={busy} />
        </FormField>
      </div>
      <FormField label="Activation date">
        <input type="date" className={inputCls} value={activated} onChange={(e) => setActivated(e.target.value)} disabled={busy} />
      </FormField>
      <div className="grid grid-cols-2 gap-3">
        <FormField label="Period start">
          <input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} />
        </FormField>
        <FormField label="Period end" error={touched ? errs.dates : null}>
          <input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} disabled={busy} />
        </FormField>
      </div>
      <FormField label="Reason / note (audit log, optional)">
        <textarea className={inputCls} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
      </FormField>
      <ServerError message={error} />
      <Actions onClose={onClose} busy={busy} confirmLabel="Save changes" busyLabel="Saving…" onConfirm={submit} />
    </Modal>
  );
}

function ReactivateModal({
  addon,
  defaultPeriodDays,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  addon: AddonSubscription;
  defaultPeriodDays: number;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const ended = !addon.currentPeriodEnd || new Date(addon.currentPeriodEnd) <= new Date();
  const [end, setEnd] = useState(ended ? addDaysInput(toInputDate(new Date()), defaultPeriodDays) : toInputDate(addon.currentPeriodEnd));
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const endErr = !end ? "Required" : new Date(`${end}T23:59:59`) <= new Date() ? "Period end must be in the future" : null;

  const submit = () => {
    setTouched(true);
    if (endErr) return;
    const body: Record<string, unknown> = {};
    if (ended || end !== toInputDate(addon.currentPeriodEnd)) body.currentPeriodEnd = endIso(end);
    if (ended) body.currentPeriodStart = startIso(toInputDate(new Date()));
    if (reason.trim()) body.reason = reason.trim();
    onSubmit(body);
  };

  return (
    <Modal title="Reactivate Loyalty" subtitle="Pricing, setup fee and activation date are kept exactly as they were." onClose={onClose} busy={busy}>
      {ended && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 p-2.5 text-[12px] text-amber-100">
          <IconAlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-300" />
          The previous billing period has ended — set a new period end to continue.
        </div>
      )}
      <FormField label="Period end" error={touched ? endErr : null} hint={ended ? "A new period starting today is created" : "Keep or extend the current period"}>
        <input type="date" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} disabled={busy} />
      </FormField>
      <FormField label="Reason / note (audit log, optional)">
        <textarea className={inputCls} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
      </FormField>
      <ServerError message={error} />
      <Actions onClose={onClose} busy={busy} confirmLabel="Reactivate" busyLabel="Reactivating…" onConfirm={submit} />
    </Modal>
  );
}

function ConfirmModal({
  kind,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  kind: "suspend" | "cancel";
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [reason, setReason] = useState("");
  const isCancel = kind === "cancel";
  return (
    <Modal
      title={isCancel ? "Cancel Loyalty subscription" : "Suspend Loyalty"}
      subtitle={isCancel ? "The clinic loses access. Nothing is deleted." : "The clinic loses access until you reactivate it."}
      onClose={onClose}
      busy={busy}
    >
      <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-400/25 bg-amber-400/5 p-3 text-[12px] text-amber-100/85">
        <IconCheck size={14} className="mt-0.5 shrink-0 text-emerald-300" />
        <span>
          The subscription record is <b>kept</b> — pricing, dates and any future Loyalty data (members, points, history) stay safe.{" "}
          {isCancel ? "You can re-activate it later." : "Reactivating restores access instantly."}
        </span>
      </div>
      <FormField label="Reason (audit log, optional)">
        <textarea className={inputCls} rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
      </FormField>
      <ServerError message={error} />
      <Actions
        onClose={onClose}
        busy={busy}
        danger={isCancel}
        confirmLabel={isCancel ? "Cancel subscription" : "Suspend"}
        busyLabel={isCancel ? "Cancelling…" : "Suspending…"}
        onConfirm={() => onSubmit({ reason: reason.trim() || undefined })}
      />
    </Modal>
  );
}
