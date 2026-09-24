"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMsg } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/store/auth";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/Confirm";
import Modal from "@/components/Modal";
import { Skeleton } from "@/components/Skeleton";
import type { BillRow, ExpenseEntry, ExpenseOverview, ExpenseScope } from "@/lib/types";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_METHODS,
  categoryIcon,
  statusStyle,
  scopeStyle,
  jd,
  shiftPeriod,
  daysInPeriod,
  periodLabel,
  shortDate,
  ammanToday,
} from "@/lib/expenses";
import {
  IconPlus,
  IconChevronLeft,
  IconChevronRight,
  IconCheck,
  IconArrowBackUp,
  IconPencil,
  IconTrash,
  IconPlayerPause,
  IconPlayerPlay,
  IconAlertTriangle,
  IconRepeat,
  IconReceipt2,
  IconMail,
  IconLock,
} from "@tabler/icons-react";

/**
 * NEW PAGE — /expenses (owner only).
 *
 *  - Monthly bills are entered once and come back every month.
 *  - The month ribbon places each bill on its due day, so the whole month's
 *    obligations are visible at a glance.
 *  - "Mark as paid" writes a line into the log; totals split clinic vs
 *    personal so the two never get mixed.
 */

type FormTarget = { kind: "new" } | { kind: "bill"; bill: BillRow } | { kind: "entry"; entry: ExpenseEntry };
type PayTarget = { kind: "bill"; bill: BillRow } | { kind: "entry"; entry: ExpenseEntry };

export default function ExpensesPage() {
  const { t, lang } = useI18n();
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();

  const thisPeriod = ammanToday().slice(0, 7);
  const [period, setPeriod] = useState(thisPeriod);
  const [scopeFilter, setScopeFilter] = useState<"all" | ExpenseScope>("all");
  const [form, setForm] = useState<FormTarget | null>(null);
  const [paying, setPaying] = useState<PayTarget | null>(null);

  const isOwner = user?.role === "owner";

  const { data, isLoading } = useQuery({
    queryKey: ["expenses", period],
    // Every list defaults to [] so the page never crashes if the API is an
    // older/newer version (frontend and backend deploy separately).
    queryFn: async (): Promise<ExpenseOverview> => {
      const d = (await api.get<Partial<ExpenseOverview>>(`/expenses/overview?period=${period}`)).data;
      return {
        period: d.period ?? period,
        today: d.today ?? ammanToday(),
        currentPeriod: d.currentPeriod ?? ammanToday().slice(0, 7),
        bills: d.bills ?? [],
        notStarted: d.notStarted ?? [],
        carryOver: d.carryOver ?? [],
        entries: d.entries ?? [],
        overduePending: d.overduePending ?? [],
        totals: { clinic: 0, personal: 0, total: 0, pending: 0, expected: 0, ...(d.totals ?? {}) },
        byCategory: d.byCategory ?? [],
      };
    },
    enabled: isOwner,
    placeholderData: (prev) => prev,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["expense-alerts"] });
  };

  const run = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      refresh();
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
    },
    onError: (e) => toast.error(t("common.error"), errMsg(e, t("common.error"))),
  });

  const undoPayment = async (b: BillRow) => {
    const ok = await confirm({ title: t("ex.undoConfirm.title"), message: t("ex.undoConfirm.body"), variant: "warning", confirmText: t("ex.undo") });
    if (ok) run.mutate(() => api.delete(`/expenses/recurring/${b._id}/pay/${b.period}`));
  };
  const deleteBill = async (b: BillRow) => {
    const ok = await confirm({ title: t("ex.deleteBill.title"), message: t("ex.deleteBill.body"), variant: "danger", confirmText: t("ex.delete") });
    if (ok) run.mutate(() => api.delete(`/expenses/recurring/${b._id}`));
  };
  const deleteEntry = async (e: ExpenseEntry) => {
    const ok = await confirm({ title: t("ex.deleteExp.title"), message: t("ex.deleteExp.body"), variant: "danger", confirmText: t("ex.delete") });
    if (ok) run.mutate(() => api.delete(`/expenses/${e._id}`));
  };
  const togglePause = (b: BillRow) => run.mutate(() => api.put(`/expenses/recurring/${b._id}`, { isActive: !b.isActive }));

  const entries = useMemo(
    () => (data?.entries ?? []).filter((e) => scopeFilter === "all" || e.scope === scopeFilter),
    [data, scopeFilter]
  );

  if (!isOwner) {
    return (
      <div className="card mx-auto mt-10 max-w-sm p-8 text-center">
        <IconLock size={26} className="mx-auto mb-3 text-mute" />
        <p className="text-sm text-mute">{t("ex.ownerOnly")}</p>
      </div>
    );
  }

  const isCurrent = period === thisPeriod;
  const attention = data
    ? [
        ...data.carryOver,
        ...data.bills.filter((b) => b.isActive && (b.status === "overdue" || b.status === "due_soon")),
      ]
    : [];
  const today = data?.today ?? ammanToday();
  const pendingSoon = data
    ? [
        ...data.overduePending,
        ...(isCurrent
          ? data.entries.filter(
              (e) => e.status === "pending" && dayDiff(today, e.date) <= (e.remindDaysBefore ?? 3)
            )
          : []),
      ]
    : [];
  const attentionCount = attention.length + pendingSoon.length;

  return (
    <div>
      {/* ===== Header ===== */}
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="me-auto">
          <h1 className="text-lg font-medium text-ink">{t("ex.title")}</h1>
          <p className="text-[11px] text-mute">{t("ex.subtitle")}</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-edge bg-card2 p-1">
          <button onClick={() => setPeriod(shiftPeriod(period, -1))} className="rounded-md p-1.5 text-mute hover:text-ink" aria-label={t("ex.prevMonth")}>
            <IconChevronLeft size={14} className="rtl-flip" />
          </button>
          <span className="min-w-[110px] text-center text-[11px] font-medium text-ink">{periodLabel(period, lang)}</span>
          <button onClick={() => setPeriod(shiftPeriod(period, 1))} className="rounded-md p-1.5 text-mute hover:text-ink" aria-label={t("ex.nextMonth")}>
            <IconChevronRight size={14} className="rtl-flip" />
          </button>
        </div>
        {!isCurrent && (
          <button onClick={() => setPeriod(thisPeriod)} className="btn-ghost !px-3 !py-2 text-[11px]">
            {t("ex.backToday")}
          </button>
        )}
        <button onClick={() => setForm({ kind: "new" })} className="btn-teal !py-2 text-xs">
          <IconPlus size={14} /> {t("ex.add")}
        </button>
      </div>

      {isLoading || !data ? (
        <div className="grid gap-3">
          <Skeleton className="h-36" />
          <Skeleton className="h-28" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          {/* ===== Month hero: totals + clinic/personal split ===== */}
          <MonthHero data={data} period={period} />

          {/* ===== Needs attention (current month only) ===== */}
          {isCurrent && attentionCount > 0 && (
            <div className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-400">
                <IconAlertTriangle size={14} /> {t("ex.alertsTitle").replace("{n}", String(attentionCount))}
              </div>
              <div className="grid gap-1.5">
                {attention.map((b) => (
                  <AttentionRow key={`${b._id}-${b.period}`} title={b.title} amount={b.amount} daysUntil={b.daysUntil} onPay={() => setPaying({ kind: "bill", bill: b })} period={b.period !== period ? periodLabel(b.period, lang) : undefined} />
                ))}
                {pendingSoon.map((e) => (
                  <AttentionRow key={e._id} title={e.title} amount={e.amount} daysUntil={dayDiff(today, e.date)} onPay={() => setPaying({ kind: "entry", entry: e })} />
                ))}
              </div>
            </div>
          )}

          {/* ===== The month ribbon ===== */}
          <MonthRibbon bills={data.bills.filter((b) => b.isActive || b.payment)} period={period} today={data.today} onPick={(b) => (b.payment ? undefined : setPaying({ kind: "bill", bill: b }))} />

          <div className="mt-3 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
            {/* ===== Monthly bills ===== */}
            <div className="card overflow-hidden">
              <div className="flex items-center gap-2 border-b border-edge px-4 py-3">
                <IconRepeat size={15} className="text-teal" />
                <div>
                  <h2 className="text-xs font-medium text-ink">{t("ex.bills")}</h2>
                  <p className="text-[10px] text-mute">{t("ex.billsSub")}</p>
                </div>
              </div>

              {data.bills.length === 0 && data.notStarted.length === 0 && (
                <div className="px-6 py-10 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-soft text-teal">
                    <IconRepeat size={22} />
                  </div>
                  <p className="text-sm font-medium text-ink">{t("ex.billsEmpty.title")}</p>
                  <p className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed text-mute">{t("ex.billsEmpty.body")}</p>
                  <button onClick={() => setForm({ kind: "new" })} className="btn-teal mt-4 !px-3 !py-1.5 text-[11px]">
                    <IconPlus size={13} /> {t("ex.add")}
                  </button>
                </div>
              )}

              {[...data.bills].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.dueDay - b.dueDay).map((b) => (
                <BillLine
                  key={b._id}
                  b={b}
                  onPay={() => setPaying({ kind: "bill", bill: b })}
                  onUndo={() => undoPayment(b)}
                  onEdit={() => setForm({ kind: "bill", bill: b })}
                  onPause={() => togglePause(b)}
                  onDelete={() => deleteBill(b)}
                />
              ))}
              {data.notStarted.map((b) => (
                <BillLine
                  key={b._id}
                  b={b}
                  startsIn={periodLabel(b.startPeriod, lang)}
                  onPay={() => undefined}
                  onUndo={() => undefined}
                  onEdit={() => setForm({ kind: "bill", bill: b })}
                  onPause={() => togglePause(b)}
                  onDelete={() => deleteBill(b)}
                />
              ))}
            </div>

            {/* ===== Where the money went ===== */}
            <div className="card p-4">
              <h2 className="mb-3 text-xs font-medium text-ink">{t("ex.byCategory")}</h2>
              {data.byCategory.length === 0 && <p className="py-4 text-[11px] text-mute">{t("ex.ledgerEmpty")}</p>}
              {data.byCategory.map((c) => {
                const Icon = categoryIcon(c.category);
                const max = data.byCategory[0]?.total || 1;
                return (
                  <div key={c.category} className="mb-2.5 last:mb-0">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px]">
                      <Icon size={13} className="text-mute" />
                      <span className="text-ink">{t(`ex.cat.${c.category}`)}</span>
                      <span className="ms-auto font-mono text-ink" dir="ltr">{jd(c.total)} JD</span>
                    </div>
                    <div className="flex h-1.5 overflow-hidden rounded-full bg-soft" style={{ width: `${Math.max(6, (c.total / max) * 100)}%` }}>
                      {c.clinic > 0 && <span className={scopeStyle.clinic.bar} style={{ width: `${(c.clinic / c.total) * 100}%` }} />}
                      {c.personal > 0 && <span className={scopeStyle.personal.bar} style={{ width: `${(c.personal / c.total) * 100}%` }} />}
                    </div>
                  </div>
                );
              })}
              {user?.email && (
                <p className="mt-4 flex items-start gap-1.5 border-t border-edge pt-3 text-[10px] leading-relaxed text-mute">
                  <IconMail size={12} className="mt-0.5 shrink-0" />
                  <span>
                    {t("ex.reminderNote").split("{email}")[0]}
                    <span dir="ltr" className="text-ink">{user.email}</span>
                    {t("ex.reminderNote").split("{email}")[1]}
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* ===== Ledger ===== */}
          <div className="card mt-3 overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-edge px-4 py-3">
              <IconReceipt2 size={15} className="text-blue" />
              <h2 className="me-auto text-xs font-medium text-ink">{t("ex.ledger")}</h2>
              <div className="flex gap-1 rounded-lg border border-edge bg-card2 p-1">
                {(["all", "clinic", "personal"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScopeFilter(s)}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors ${scopeFilter === s ? "bg-teal text-navy" : "text-mute hover:text-ink"}`}
                  >
                    {s === "all" ? t("ex.filterAll") : s === "clinic" ? t("ex.clinic") : t("ex.personal")}
                  </button>
                ))}
              </div>
            </div>
            {entries.length === 0 && <p className="px-4 py-8 text-center text-[11px] text-mute">{t("ex.ledgerEmpty")}</p>}
            {entries.map((e) => {
              const Icon = categoryIcon(e.category);
              return (
                <div key={e._id} className="flex items-center gap-3 border-b border-edge px-4 py-2.5 last:border-0">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${scopeStyle[e.scope].soft} ${scopeStyle[e.scope].text}`}>
                    <Icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span dir="auto" className="truncate text-[11px] font-medium text-ink">{e.title}</span>
                      {e.recurringId && <IconRepeat size={11} className="text-mute" aria-label={t("ex.bills")} />}
                      {e.status === "pending" && <span className="pill !py-0 bg-amber-500/15 text-amber-400">{t("ex.pendingTag")}</span>}
                    </div>
                    <div className="text-[10px] text-mute">
                      {shortDate(e.date, lang)} · {e.scope === "clinic" ? t("ex.clinic") : t("ex.personal")}
                      {e.method ? ` · ${t(`ex.method.${e.method}`)}` : ""}
                      {e.notes ? ` · ${e.notes}` : ""}
                    </div>
                  </div>
                  <span className="font-mono text-[11px] font-medium text-ink" dir="ltr">{jd(e.amount)} JD</span>
                  <span className="flex shrink-0 gap-1">
                    {e.status === "pending" && (
                      <button onClick={() => setPaying({ kind: "entry", entry: e })} className="btn-teal !px-2 !py-1 text-[10px]">
                        <IconCheck size={12} /> {t("ex.markPaid")}
                      </button>
                    )}
                    <IconBtn label={t("ex.edit")} onClick={() => setForm({ kind: "entry", entry: e })}><IconPencil size={13} /></IconBtn>
                    <IconBtn label={t("ex.delete")} danger onClick={() => deleteEntry(e)}><IconTrash size={13} /></IconBtn>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {form && <ExpenseFormModal target={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh(); }} />}
      {paying && <PayModal target={paying} onClose={() => setPaying(null)} onSaved={() => { setPaying(null); refresh(); }} />}
    </div>
  );
}

// ===================================================================
// Pieces
// ===================================================================

const dayDiff = (from: string, to: string) => {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
};

function useWhen() {
  const { t } = useI18n();
  return (daysUntil: number) =>
    daysUntil < 0
      ? t("ex.lateBy").replace("{n}", String(Math.abs(daysUntil)))
      : daysUntil === 0
      ? t("ex.dueToday")
      : daysUntil === 1
      ? t("ex.dueTomorrow")
      : t("ex.dueIn").replace("{n}", String(daysUntil));
}

function IconBtn({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`rounded-md p-1.5 text-mute transition-colors hover:bg-soft ${danger ? "hover:text-red-400" : "hover:text-ink"}`}
    >
      {children}
    </button>
  );
}

function MonthHero({ data, period }: { data: ExpenseOverview; period: string }) {
  const { t, lang } = useI18n();
  const { clinic, personal, total, pending, expected } = data.totals;
  const clinicPct = total ? (clinic / total) * 100 : 0;
  return (
    <div className="grid gap-4 rounded-xl bg-hero p-4 sm:grid-cols-[1.4fr_1fr]">
      <div>
        <div className="text-[10px] text-[#7FA3BE]">
          {t("ex.paidIn")} {periodLabel(period, lang)}
        </div>
        <div className="mt-1 flex items-baseline gap-1.5" dir="ltr">
          <span className="text-3xl font-medium tracking-tight text-[#F2F7FC]">{jd(total)}</span>
          <span className="text-sm text-[#8FB3CC]">JD</span>
        </div>
        {/* Split meter: clinic vs personal */}
        <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-[#0B3153]">
          {total > 0 && (
            <>
              <span className="bg-teal transition-[width] duration-500" style={{ width: `${clinicPct}%` }} />
              <span className="bg-blue transition-[width] duration-500" style={{ width: `${100 - clinicPct}%` }} />
            </>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
          <span className="flex items-center gap-1.5 text-[#B8D4EA]">
            <span className="h-2 w-2 rounded-full bg-teal" /> {t("ex.clinic")}
            <b className="font-mono font-medium text-[#F2F7FC]" dir="ltr">{jd(clinic)}</b>
          </span>
          <span className="flex items-center gap-1.5 text-[#B8D4EA]">
            <span className="h-2 w-2 rounded-full bg-blue" /> {t("ex.personal")}
            <b className="font-mono font-medium text-[#F2F7FC]" dir="ltr">{jd(personal)}</b>
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 self-center">
        <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 p-3">
          <div className="text-[10px] text-[#B8D4EA]">{t("ex.stillDue")}</div>
          <div className="mt-0.5 font-mono text-[15px] font-medium text-amber-300" dir="ltr">{jd(pending)} JD</div>
        </div>
        <div className="rounded-lg border border-sky/30 bg-sky/10 p-3">
          <div className="text-[10px] text-[#B8D4EA]">{t("ex.expected")}</div>
          <div className="mt-0.5 font-mono text-[15px] font-medium text-[#F2F7FC]" dir="ltr">{jd(expected)} JD</div>
        </div>
      </div>
    </div>
  );
}

/**
 * The month laid out as a strip of days, with every bill pinned to its due
 * day. Several bills on one day stack upwards. Unpaid pins are buttons that
 * open "Mark as paid".
 */
function MonthRibbon({ bills, period, today, onPick }: { bills: BillRow[]; period: string; today: string; onPick: (b: BillRow) => void }) {
  const { t, lang } = useI18n();
  const when = useWhen();
  const days = daysInPeriod(period);
  const todayDay = today.slice(0, 7) === period ? Number(today.slice(8, 10)) : null;
  const pos = (day: number) => `${((day - 0.5) / days) * 100}%`;

  // Lane packing: a pin is ~120px wide, so two bills a few days apart would
  // overlap. Each pin goes into the lowest lane whose last pin is far enough
  // away; close bills stack upwards instead of covering each other.
  const minGap = Math.ceil(days * 0.17);
  const lanesEnd: number[] = [];
  const placed = [...bills]
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title))
    .map((b) => {
      const day = Number(b.dueDate.slice(8, 10));
      let lane = lanesEnd.findIndex((end) => day - end >= minGap);
      if (lane === -1) {
        lane = lanesEnd.length;
        lanesEnd.push(day);
      } else lanesEnd[lane] = day;
      return { b, day, lane };
    });
  const tallest = Math.max(1, lanesEnd.length);
  const dueDays = Array.from(new Set(placed.map((x) => x.day)));
  const ticks = Array.from(new Set([1, 5, 10, 15, 20, 25, days]));

  // Pins near the edges grow inwards so they're never clipped.
  const anchor = (day: number) =>
    day <= 3
      ? ""
      : day >= days - 2
      ? "-translate-x-full rtl:translate-x-full"
      : "-translate-x-1/2 rtl:translate-x-1/2";

  return (
    <div className="card mt-3 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className="me-auto text-xs font-medium text-ink">{t("ex.ribbon")}</h2>
        {(["paid", "due_soon", "overdue", "upcoming"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1 text-[10px] text-mute">
            <span className={`h-2 w-2 rounded-full ${statusStyle[s].dot}`} /> {t(`ex.status.${s}`)}
          </span>
        ))}
      </div>

      {bills.length === 0 ? (
        <p className="py-3 text-[11px] text-mute">{t("ex.noBillsThisMonth")}</p>
      ) : (
        <div className="overflow-x-auto">
          <div className="relative min-w-[520px]" style={{ height: 50 + tallest * 30 }}>
            {/* Pins */}
            {placed.map(({ b, day, lane }) => {
              const st = b.isActive ? b.status : "paid";
              const clickable = !b.payment && b.isActive;
              return (
                <button
                  key={b._id}
                  type="button"
                  disabled={!clickable}
                  onClick={() => onPick(b)}
                  title={`${b.title} · ${jd(b.amount)} JD · ${b.payment ? t("ex.status.paid") : when(b.daysUntil)}`}
                  className={`absolute flex h-6 max-w-[130px] items-center gap-1 rounded-full border bg-card2 px-2 text-[10px] font-medium text-ink shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky ${anchor(day)} ${
                    statusStyle[st].ring
                  } ${clickable ? "cursor-pointer hover:bg-soft" : "cursor-default"}`}
                  style={{ insetInlineStart: pos(day), bottom: 30 + lane * 30 }}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${statusStyle[st].dot} ${st === "overdue" ? "animate-pulse motion-reduce:animate-none" : ""}`} />
                  <span dir="auto" className="truncate">{b.title}</span>
                </button>
              );
            })}

            {/* Day strip */}
            <div className="absolute inset-x-0 bottom-3 h-2 rounded-full bg-soft">
              {dueDays.map((day) => (
                <span key={day} className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-edge" style={{ insetInlineStart: pos(day) }} />
              ))}
              {todayDay && (
                <span className="absolute inset-y-0 start-0 rounded-full bg-sky/25" style={{ width: pos(todayDay) }} />
              )}
            </div>
            {todayDay && (
              <span
                className="absolute bottom-1.5 top-0 w-px -translate-x-1/2 rtl:translate-x-1/2 bg-sky"
                style={{ insetInlineStart: pos(todayDay) }}
                aria-hidden
              >
                <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-sky px-1 text-[8px] font-medium text-navy">
                  {t("ex.today")}
                </span>
              </span>
            )}

            {/* Tick labels */}
            {ticks.map((d) => (
              <span
                key={d}
                className="absolute bottom-0 -translate-x-1/2 rtl:translate-x-1/2 font-mono text-[9px] text-mute"
                style={{ insetInlineStart: pos(d) }}
              >
                {d}
              </span>
            ))}
          </div>
        </div>
      )}
      {todayDay === null && bills.length > 0 && (
        <p className="mt-2 text-[10px] text-mute">{periodLabel(period, lang)}</p>
      )}
    </div>
  );
}

function AttentionRow({ title, amount, daysUntil, onPay, period }: { title: string; amount: number; daysUntil: number; onPay: () => void; period?: string }) {
  const { t } = useI18n();
  const when = useWhen();
  return (
    <div className="flex items-center gap-2 rounded-lg bg-card/60 px-3 py-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${daysUntil < 0 ? "bg-red-500" : "bg-amber-400"}`} />
      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
        {title}
        {period && <span className="ms-1.5 font-normal text-mute">({period})</span>}
      </span>
      <span className={`text-[10px] ${daysUntil < 0 ? "text-red-400" : "text-amber-400"}`}>{when(daysUntil)}</span>
      <span className="font-mono text-[11px] text-ink" dir="ltr">{jd(amount)} JD</span>
      <button onClick={onPay} className="btn-teal !px-2 !py-1 text-[10px]">
        <IconCheck size={12} /> {t("ex.markPaid")}
      </button>
    </div>
  );
}

function BillLine({
  b,
  startsIn,
  onPay,
  onUndo,
  onEdit,
  onPause,
  onDelete,
}: {
  b: BillRow;
  startsIn?: string;
  onPay: () => void;
  onUndo: () => void;
  onEdit: () => void;
  onPause: () => void;
  onDelete: () => void;
}) {
  const { t, lang } = useI18n();
  const when = useWhen();
  const Icon = categoryIcon(b.category);
  const paused = !b.isActive;
  return (
    <div className={`flex flex-wrap items-center gap-3 border-b border-edge px-4 py-2.5 last:border-0 ${paused ? "opacity-60" : ""}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${scopeStyle[b.scope].soft} ${scopeStyle[b.scope].text}`}>
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span dir="auto" className="truncate text-[11px] font-medium text-ink">{b.title}</span>
          <span className={`pill !py-0 ${scopeStyle[b.scope].soft} ${scopeStyle[b.scope].text}`}>
            {b.scope === "clinic" ? t("ex.clinic") : t("ex.personal")}
          </span>
        </div>
        <div className="text-[10px] text-mute">
          {t("ex.everyMonth").replace("{d}", String(b.dueDay))} ·{" "}
          {b.remindDaysBefore === 0 ? t("ex.remindSameDay") : t("ex.remind").replace("{n}", String(b.remindDaysBefore))}
        </div>
      </div>

      <div className="text-end">
        <div className="font-mono text-[11px] font-medium text-ink" dir="ltr">{jd(b.payment?.amount ?? b.amount)} JD</div>
        {paused ? (
          <span className="pill !py-0 bg-soft text-mute">{t("ex.paused")}</span>
        ) : startsIn ? (
          <span className={`pill !py-0 ${statusStyle.upcoming.pill}`}>{t("ex.startsIn").replace("{month}", startsIn)}</span>
        ) : b.payment ? (
          <span className={`pill !py-0 ${statusStyle.paid.pill}`}>{t("ex.paidOn").replace("{date}", shortDate(b.payment.date, lang))}</span>
        ) : (
          <span className={`pill !py-0 ${statusStyle[b.status].pill}`}>{when(b.daysUntil)}</span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {!paused && !startsIn && !b.payment && (
          <button onClick={onPay} className="btn-teal !px-2 !py-1 text-[10px]">
            <IconCheck size={12} /> {t("ex.markPaid")}
          </button>
        )}
        {b.payment && (
          <IconBtn label={t("ex.undo")} onClick={onUndo}><IconArrowBackUp size={13} /></IconBtn>
        )}
        <IconBtn label={t("ex.edit")} onClick={onEdit}><IconPencil size={13} /></IconBtn>
        <IconBtn label={paused ? t("ex.resume") : t("ex.pause")} onClick={onPause}>
          {paused ? <IconPlayerPlay size={13} /> : <IconPlayerPause size={13} />}
        </IconBtn>
        <IconBtn label={t("ex.delete")} danger onClick={onDelete}><IconTrash size={13} /></IconBtn>
      </div>
    </div>
  );
}

// ===================================================================
// Add / edit form
// ===================================================================

const REMIND_OPTIONS = [0, 1, 2, 3, 5, 7];

function firstDueDate(dueDay: number, today: string) {
  const period = today.slice(0, 7);
  const clamp = (p: string) => `${p}-${String(Math.min(dueDay, daysInPeriod(p))).padStart(2, "0")}`;
  const thisMonth = clamp(period);
  return thisMonth >= today ? thisMonth : clamp(shiftPeriod(period, 1));
}

function ExpenseFormModal({ target, onClose, onSaved }: { target: FormTarget; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const today = ammanToday();
  const bill = target.kind === "bill" ? target.bill : null;
  const entry = target.kind === "entry" ? target.entry : null;
  const fromBill = !!entry?.recurringId; // a payment line of a monthly bill

  // New expenses start as a monthly bill — that's the main reason this page exists.
  const [kind, setKind] = useState<"monthly" | "once">(entry ? "once" : "monthly");
  const [scope, setScope] = useState<ExpenseScope>(bill?.scope ?? entry?.scope ?? "clinic");
  const [category, setCategory] = useState<string>(bill?.category ?? entry?.category ?? "rent");
  const [title, setTitle] = useState(bill?.title ?? entry?.title ?? "");
  const [amount, setAmount] = useState(String(bill?.amount ?? entry?.amount ?? ""));
  const [dueDay, setDueDay] = useState(bill?.dueDay ?? 1);
  const [remind, setRemind] = useState(bill?.remindDaysBefore ?? entry?.remindDaysBefore ?? 3);
  const [status, setStatus] = useState<"paid" | "pending">(entry?.status ?? "paid");
  const [date, setDate] = useState(entry?.date ?? today);
  const [method, setMethod] = useState(entry?.method ?? "cash");
  const [notes, setNotes] = useState(bill?.notes ?? entry?.notes ?? "");
  const [error, setError] = useState("");

  const isNew = target.kind === "new";
  const amountNum = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(amountNum) && amountNum >= 0 && (kind === "monthly" || !!date);

  // For new one-time expenses, start the category on something sensible.
  const switchKind = (k: "monthly" | "once") => {
    setKind(k);
    if (isNew && k === "once" && category === "rent") setCategory("supplies");
    if (isNew && k === "monthly" && category === "supplies") setCategory("rent");
  };

  const save = useMutation({
    mutationFn: async () => {
      const finalTitle = title.trim() || t(`ex.cat.${category}`);
      if (kind === "monthly") {
        const body = { title: finalTitle, category, scope, amount: amountNum, dueDay, remindDaysBefore: remind, notes: notes.trim() };
        return bill ? api.put(`/expenses/recurring/${bill._id}`, body) : api.post("/expenses/recurring", body);
      }
      if (fromBill && entry) {
        return api.put(`/expenses/${entry._id}`, { title: finalTitle, amount: amountNum, date, method, notes: notes.trim() });
      }
      const body: Record<string, unknown> = { title: finalTitle, category, scope, amount: amountNum, status, date, notes: notes.trim() };
      if (status === "paid") body.method = method;
      else body.remindDaysBefore = remind;
      return entry ? api.put(`/expenses/${entry._id}`, body) : api.post("/expenses", body);
    },
    onSuccess: () => {
      toast.success(t("tst.savedTitle"), t("tst.savedBody"));
      onSaved();
    },
    onError: (e) => {
      const msg = errMsg(e, t("common.error"));
      setError(msg);
      toast.error(t("common.error"), msg);
    },
  });

  const titleText = isNew ? t("ex.form.newTitle") : bill ? t("ex.form.editBill") : t("ex.form.editExp");

  return (
    <Modal title={titleText} size="lg" onClose={onClose}>
      {/* Monthly vs one-time — only when creating */}
      {isNew && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          {([
            ["monthly", t("ex.form.monthly"), t("ex.form.monthlySub"), IconRepeat],
            ["once", t("ex.form.once"), t("ex.form.onceSub"), IconReceipt2],
          ] as const).map(([k, label, sub, Icon]) => (
            <button
              key={k}
              type="button"
              onClick={() => switchKind(k)}
              aria-pressed={kind === k}
              className={`flex items-start gap-2.5 rounded-lg border p-3 text-start transition-colors ${
                kind === k ? "border-teal bg-teal/10" : "border-edge bg-card2 hover:border-sky"
              }`}
            >
              <Icon size={18} className={kind === k ? "text-teal" : "text-mute"} />
              <span>
                <span className="block text-xs font-medium text-ink">{label}</span>
                <span className="block text-[10px] text-mute">{sub}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {!fromBill && (
        <>
          <label className="lbl">{t("ex.form.whose")}</label>
          <div className="mb-4 grid grid-cols-2 gap-1.5">
            {(["clinic", "personal"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                aria-pressed={scope === s}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  scope === s ? `border-current ${scopeStyle[s].soft} ${scopeStyle[s].text}` : "border-edge bg-card2 text-mute hover:text-ink"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${scopeStyle[s].bar}`} />
                {s === "clinic" ? t("ex.clinic") : t("ex.personal")}
              </button>
            ))}
          </div>

          <label className="lbl">{t("ex.form.category")}</label>
          <div className="mb-4 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
            {EXPENSE_CATEGORIES.map(({ id, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setCategory(id)}
                aria-pressed={category === id}
                className={`flex flex-col items-center gap-1 rounded-lg border px-1.5 py-2 text-[10px] font-medium transition-colors ${
                  category === id ? "border-teal bg-teal/10 text-teal" : "border-edge bg-card2 text-mute hover:text-ink"
                }`}
              >
                <Icon size={16} />
                <span className="line-clamp-1 text-center">{t(`ex.cat.${id}`)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
        <div>
          <label className="lbl">{t("ex.form.title")}</label>
          <input className="inp" value={title} maxLength={100} placeholder={t(`ex.cat.${category}`)} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className="lbl">{t("ex.form.amount")}</label>
          <input className="inp font-mono" dir="ltr" type="number" min={0} step="0.001" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>

      {kind === "monthly" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="lbl">{t("ex.form.dueDay")}</label>
            <select className="inp" value={dueDay} onChange={(e) => setDueDay(Number(e.target.value))}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="lbl">{t("ex.form.remindBefore")}</label>
            <select className="inp" value={remind} onChange={(e) => setRemind(Number(e.target.value))}>
              {REMIND_OPTIONS.map((n) => (
                <option key={n} value={n}>{n === 0 ? t("ex.form.remindSame") : t("ex.form.remindOpt").replace("{n}", String(n))}</option>
              ))}
            </select>
          </div>
          {isNew && (
            <p className="rounded-lg border border-teal/30 bg-teal/10 px-3 py-2 text-[11px] text-teal sm:col-span-2">
              {t("ex.form.firstDue").replace("{date}", shortDate(firstDueDate(dueDay, today), lang))}
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3">
          {!fromBill && (
            <div className="mb-3 grid grid-cols-2 gap-1.5">
              {(["paid", "pending"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  aria-pressed={status === s}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                    status === s
                      ? s === "paid"
                        ? "border-teal bg-teal/10 text-teal"
                        : "border-amber-400 bg-amber-500/10 text-amber-400"
                      : "border-edge bg-card2 text-mute hover:text-ink"
                  }`}
                >
                  {s === "paid" ? t("ex.form.paidAlready") : t("ex.form.notPaid")}
                </button>
              ))}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="lbl">{status === "paid" || fromBill ? t("ex.form.datePaid") : t("ex.form.dateDue")}</label>
              <input type="date" className="inp" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {status === "paid" || fromBill ? (
              <div>
                <label className="lbl">{t("ex.form.method")}</label>
                <select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {EXPENSE_METHODS.map((m) => (
                    <option key={m} value={m}>{t(`ex.method.${m}`)}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="lbl">{t("ex.form.remindBefore")}</label>
                <select className="inp" value={remind} onChange={(e) => setRemind(Number(e.target.value))}>
                  {REMIND_OPTIONS.map((n) => (
                    <option key={n} value={n}>{n === 0 ? t("ex.form.remindSame") : t("ex.form.remindOpt").replace("{n}", String(n))}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      <label className="lbl mt-3">{t("ex.form.notes")}</label>
      <textarea className="inp min-h-14" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />

      <div className="sticky bottom-0 -mx-5 mt-5 border-t border-edge bg-card px-5 py-3">
        {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
        <button className="btn-teal w-full" disabled={!valid || save.isPending} onClick={() => { setError(""); save.mutate(); }}>
          <IconCheck size={15} />
          {save.isPending ? t("common.loading") : kind === "monthly" ? t("ex.form.saveBill") : t("ex.form.save")}
        </button>
      </div>
    </Modal>
  );
}

// ===================================================================
// Mark as paid
// ===================================================================

function PayModal({ target, onClose, onSaved }: { target: PayTarget; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const item = target.kind === "bill" ? target.bill : target.entry;
  const [amount, setAmount] = useState(String(item.amount));
  const [date, setDate] = useState(ammanToday());
  const [method, setMethod] = useState("cash");
  const [error, setError] = useState("");
  const amountNum = Number(amount);

  const pay = useMutation({
    mutationFn: async () => {
      if (target.kind === "bill") {
        return api.post(`/expenses/recurring/${target.bill._id}/pay`, { period: target.bill.period, amount: amountNum, date, method });
      }
      return api.post(`/expenses/${target.entry._id}/pay`, { amount: amountNum, date, method });
    },
    onSuccess: () => {
      toast.success(t("tst.savedTitle"), `${item.title} · ${jd(amountNum)} JD`);
      onSaved();
    },
    onError: (e) => {
      const msg = errMsg(e, t("common.error"));
      setError(msg);
      toast.error(t("common.error"), msg);
    },
  });

  return (
    <Modal title={`${t("ex.pay.title")} — ${item.title}`} onClose={onClose}>
      {target.kind === "bill" && (
        <p className="mb-3 text-[11px] text-mute">{periodLabel(target.bill.period, lang)}</p>
      )}
      <label className="lbl">{t("ex.pay.amount")}</label>
      <input className="inp mb-3 font-mono" dir="ltr" type="number" min={0} step="0.001" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div>
          <label className="lbl">{t("ex.pay.date")}</label>
          <input type="date" className="inp" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="lbl">{t("ex.form.method")}</label>
          <select className="inp" value={method} onChange={(e) => setMethod(e.target.value)}>
            {EXPENSE_METHODS.map((m) => (
              <option key={m} value={m}>{t(`ex.method.${m}`)}</option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="mb-2 text-xs text-red-400">{error}</p>}
      <button
        className="btn-teal w-full"
        disabled={amount.trim() === "" || !Number.isFinite(amountNum) || amountNum < 0 || !date || pay.isPending}
        onClick={() => { setError(""); pay.mutate(); }}
      >
        <IconCheck size={15} /> {pay.isPending ? t("common.loading") : t("ex.pay.confirm")}
      </button>
    </Modal>
  );
}
