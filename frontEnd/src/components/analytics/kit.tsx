"use client";
// PHASE 6 — small presentational pieces shared by every Analytics section. No data logic here.
import { useMemo, useState, type ReactNode } from "react";
import { IconArrowDownRight, IconArrowUpRight, IconInfoCircle, IconMinus, IconAlertTriangle, IconChartBarOff, IconRefresh, IconArrowUp, IconArrowDown } from "@tabler/icons-react";
import { useI18n } from "@/lib/i18n";
import { Skeleton } from "@/components/Skeleton";
import { jd, num, pct, type Cmp, type Json } from "@/lib/analytics";

export type Fmt = "jd" | "int" | "dec" | "pct";
const fmtVal = (f: Fmt, v: number | null | undefined) => (f === "jd" ? jd(v) : f === "pct" ? pct(v) : f === "dec" ? num(v, 2) : num(v));

/** Which direction of change is "good". `neutral` = no value judgement (e.g. appointment volume, expenses are shown amber when they rise). */
export type Good = "up" | "down" | "neutral";

export function Delta({ c, fmt, good = "up", compact = false }: { c: Cmp | null | undefined; fmt: Fmt; good?: Good; compact?: boolean }) {
  const { t } = useI18n();
  if (!c) return null;
  const tone = (up: boolean) => (good === "neutral" ? "text-sky bg-sky/10" : (up ? good === "up" : good === "down") ? "text-teal bg-teal/15" : "text-amber-400 bg-amber-500/15");
  const base = "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium";
  if (c.state === "none" || c.previous === null) return <span className={`${base} text-mute`} data-testid="delta-none">—</span>;
  if (c.state === "new") return <span className={`${base} bg-sky/10 text-sky`} data-testid="delta-new" title={`${t("an.cmp.previous")}: ${fmtVal(fmt, c.previous)}`}>{t("an.cmp.new")}</span>;
  if (c.state === "flat") return <span className={`${base} bg-soft text-mute`} data-testid="delta-flat"><IconMinus size={10} />{compact ? "" : "0%"}</span>;
  const up = c.state === "up";
  // a rate (already a percentage) is compared in percentage POINTS, never as a percent of a percent
  const text = fmt === "pct" ? `${up ? "+" : "−"}${num(Math.abs(c.diff ?? 0), 1)} ${t("an.cmp.pp")}` : `${up ? "+" : "−"}${num(Math.abs(c.pct ?? 0), 1)}%`;
  return (
    <span className={`${base} ${tone(up)}`} data-testid={up ? "delta-up" : "delta-down"} title={`${t("an.cmp.previous")}: ${fmtVal(fmt, c.previous)}`}>
      {up ? <IconArrowUpRight size={11} /> : <IconArrowDownRight size={11} />}
      <span dir="ltr">{text}</span>
    </span>
  );
}

export function Info({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} className="inline-flex cursor-help text-mute/70 hover:text-sky">
      <IconInfoCircle size={12} />
    </span>
  );
}

export function Kpi({ label, hint, c, value, fmt = "int", good = "up", unit, sub, testId, tone }: {
  label: string; hint?: string; c?: Cmp | null; value?: number | null; fmt?: Fmt; good?: Good; unit?: string; sub?: ReactNode; testId?: string; tone?: "teal" | "amber" | "sky";
}) {
  const { t } = useI18n();
  const v = c ? c.current : value ?? null;
  const color = tone === "amber" ? "text-amber-400" : tone === "sky" ? "text-sky" : "text-ink";
  return (
    <div className="card p-3.5" data-testid={testId ?? "kpi"}>
      <div className="mb-1 flex items-start justify-between gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-mute">{label}</span>
        {hint && <Info text={hint} />}
      </div>
      <div className={`flex items-baseline gap-1 ${color}`}>
        <span className="text-xl font-medium" dir="ltr" data-testid={testId ? `${testId}-value` : undefined}>{fmtVal(fmt, v)}</span>
        {v !== null && unit && <span className="text-[10px] text-mute">{unit}</span>}
      </div>
      <div className="mt-1.5 flex min-h-[18px] flex-wrap items-center gap-1.5">
        {c && <Delta c={c} fmt={fmt} good={good} />}
        {c && c.previous !== null && c.state !== "none" && <span className="text-[9px] text-mute">{t("an.cmp.vs")} <span dir="ltr">{fmtVal(fmt, c.previous)}</span></span>}
        {sub}
      </div>
    </div>
  );
}

export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 }) {
  const cls = cols === 5 ? "lg:grid-cols-5" : cols === 4 ? "lg:grid-cols-4" : cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2";
  return <div className={`mb-4 grid grid-cols-2 gap-3 ${cls}`}>{children}</div>;
}

export function Panel({ title, hint, right, children, className = "", testId }: { title?: string; hint?: string; right?: ReactNode; children: ReactNode; className?: string; testId?: string }) {
  return (
    <section className={`card p-4 ${className}`} data-testid={testId}>
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-ink">{title}{hint && <Info text={hint} />}</div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ text, compact = false }: { text?: string; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`flex flex-col items-center justify-center text-center text-mute ${compact ? "py-6" : "py-10"}`} data-testid="an-empty">
      <IconChartBarOff size={compact ? 20 : 26} className="mb-2 opacity-60" />
      <p className="max-w-xs text-[11px]">{text ?? t("an.empty")}</p>
    </div>
  );
}

export function SectionError({ onRetry, forbidden }: { onRetry?: () => void; forbidden?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="card flex flex-col items-center justify-center py-12 text-center" data-testid="an-error">
      <IconAlertTriangle size={24} className="mb-2 text-amber-400" />
      <p className="mb-3 max-w-sm text-xs text-mute">{forbidden ? t("an.forbidden") : t("an.error")}</p>
      {onRetry && !forbidden && (
        <button className="btn-ghost !px-3 !py-1.5 !text-xs" onClick={onRetry}><IconRefresh size={13} />{t("an.retry")}</button>
      )}
    </div>
  );
}

export function SectionSkeleton() {
  return (
    <div data-testid="an-skeleton">
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-3.5"><Skeleton className="mb-2 h-3 w-20" /><Skeleton className="mb-2 h-6 w-24" /><Skeleton className="h-3 w-16" /></div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="card p-4 lg:col-span-2"><Skeleton className="mb-3 h-3 w-32" /><Skeleton className="h-56 w-full" /></div>
        <div className="card p-4"><Skeleton className="mb-3 h-3 w-24" /><Skeleton className="h-56 w-full" /></div>
      </div>
    </div>
  );
}

/** Horizontal share bars (label — value — bar). Values come from the server; the bar is just value ÷ max for drawing. */
export function BarList({ rows, fmt = "int", color = "bg-teal", empty }: { rows: { key: string; label: string; value: number; sub?: string; href?: string; onClick?: () => void }[]; fmt?: Fmt; color?: string; empty?: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max <= 0) return <Empty compact text={empty} />;
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="mb-0.5 flex justify-between gap-2 text-[11px]">
              <span className="truncate text-ink">{r.label}{r.sub && <span className="ms-1.5 text-[9px] text-mute">{r.sub}</span>}</span>
              <span className="shrink-0 text-ink" dir="ltr">{fmtVal(fmt, r.value)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-soft"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} /></div>
          </>
        );
        return r.onClick ? (
          <button key={r.key} type="button" onClick={r.onClick} className="block w-full text-start hover:opacity-80" data-testid="barlist-link">{inner}</button>
        ) : (
          <div key={r.key}>{inner}</div>
        );
      })}
    </div>
  );
}

export interface Col<R> { key: string; label: string; hint?: string; align?: "start" | "end"; value?: (r: R) => number | string | null; render?: (r: R) => ReactNode; sortable?: boolean; className?: string }

/** Client-side SORT of the rows the server returned (no recalculation). */
export function DataTable<R extends Json>({ cols, rows, initialSort, rowKey, empty, testId }: { cols: Col<R>[]; rows: R[]; initialSort?: { key: string; dir: "asc" | "desc" }; rowKey: (r: R) => string; empty?: string; testId?: string }) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = cols.find((c) => c.key === sort.key);
    if (!col) return rows;
    const val = (r: R) => (col.value ? col.value(r) : (r[col.key] as number | string | null));
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1; // empty values always last
      if (y === null || y === undefined) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.dir === "asc" ? c : -c;
    });
  }, [rows, cols, sort]);
  if (!rows.length) return <Empty compact text={empty} />;
  return (
    <div className="an-scroll overflow-x-auto" data-testid={testId}>
      <table className="w-full min-w-[520px] text-[11px]">
        <thead>
          <tr className="border-b border-edge text-mute">
            {cols.map((c) => (
              <th key={c.key} className={`whitespace-nowrap px-2 py-2 font-medium ${c.align === "end" ? "text-end" : "text-start"}`}>
                {c.sortable === false ? (
                  c.label
                ) : (
                  <button type="button" className="inline-flex items-center gap-0.5 hover:text-ink" onClick={() => setSort((s) => (s && s.key === c.key ? { key: c.key, dir: s.dir === "desc" ? "asc" : "desc" } : { key: c.key, dir: "desc" }))} data-testid={`sort-${c.key}`}>
                    {c.label}
                    {c.hint && <Info text={c.hint} />}
                    {sort?.key === c.key && (sort.dir === "desc" ? <IconArrowDown size={10} /> : <IconArrowUp size={10} />)}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className="border-b border-edge/60 last:border-0 hover:bg-soft" data-testid="row">
              {cols.map((c) => (
                <td key={c.key} className={`whitespace-nowrap px-2 py-2 text-ink ${c.align === "end" ? "text-end" : "text-start"} ${c.className ?? ""}`}>
                  {c.render ? c.render(r) : <span dir={c.align === "end" ? "ltr" : undefined}>{String(r[c.key] ?? "—")}</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Small "what is this number" footnote under a section. */
export function Footnote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-[10px] leading-relaxed text-mute">{children}</p>;
}
