"use client";
// PHASE 6 — recharts wrappers. Flat, theme-aware (colours come from CSS variables via the .an-chart rules in globals.css), no 3D.
// The charts only DRAW the series the server returned.
import { Area, Bar, CartesianGrid, Cell, ComposedChart, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart } from "recharts";
import { useI18n } from "@/lib/i18n";
import { bucketLabel, jd, num, type Json } from "@/lib/analytics";
import { CHART } from "@/lib/analytics";

export interface Series { key: string; label: string; color: string; kind?: "area" | "bar" | "line" }

function ChartTooltip({ active, payload, label, money, fmtLabel }: { active?: boolean; payload?: any[]; label?: string; money?: boolean; fmtLabel: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-edge bg-card px-2.5 py-2 text-[10px] shadow-lg" style={{ color: "var(--ink)" }}>
      <div className="mb-1 font-medium">{fmtLabel(String(label))}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-mute"><span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />{p.name}</span>
          <span dir="ltr">{money ? jd(p.value) : num(p.value, 2)}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendChart({ points, series, granularity, money = false, height = 240, testId }: { points: Json[]; series: Series[]; granularity: string; money?: boolean; height?: number; testId?: string }) {
  const { lang } = useI18n();
  const fmtLabel = (k: string) => bucketLabel(k, granularity, lang);
  const gradient = (k: string) => `an-grad-${k}`;
  return (
    <div className="an-chart" dir="ltr" style={{ height }} data-testid={testId ?? "an-trend"}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <ComposedChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <defs>
            {series.filter((s) => s.kind === "area").map((s) => (
              <linearGradient key={s.key} id={gradient(s.key)} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="key" tickFormatter={fmtLabel} tickLine={false} axisLine={false} minTickGap={18} />
          <YAxis tickLine={false} axisLine={false} width={46} allowDecimals={!money ? false : true} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${num(v / 1000, 1)}k` : num(v, money ? 0 : 0))} />
          <Tooltip content={<ChartTooltip money={money} fmtLabel={fmtLabel} />} cursor={{ stroke: "var(--edge)" }} />
          {series.map((s) =>
            s.kind === "bar" ? (
              <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            ) : s.kind === "area" ? (
              <Area key={s.key} dataKey={s.key} name={s.label} type="linear" stroke={s.color} strokeWidth={2} fill={`url(#${gradient(s.key)})`} dot={false} isAnimationActive={false} />
            ) : (
              <Line key={s.key} dataKey={s.key} name={s.label} type="linear" stroke={s.color} strokeWidth={2} dot={false} isAnimationActive={false} />
            ),
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-mute">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
      ))}
    </div>
  );
}

/** Vertical bars over a categorical axis (hour of day, weekday). */
export function CategoryBars({ data, xKey, yKey, name, color = CHART.teal, xFormatter, height = 190, testId }: { data: Json[]; xKey: string; yKey: string; name: string; color?: string; xFormatter?: (v: any) => string; height?: number; testId?: string }) {
  return (
    <div className="an-chart" dir="ltr" style={{ height }} data-testid={testId}>
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={xKey} tickFormatter={xFormatter} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={6} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<ChartTooltip fmtLabel={(l) => (xFormatter ? xFormatter(isNaN(Number(l)) ? l : Number(l)) : l)} />} cursor={{ fill: "var(--soft)" }} />
          <Bar dataKey={yKey} name={name} fill={color} radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface Slice { key: string; label: string; value: number; color: string }
/** A small donut with its own legend. Slices of 0 are omitted; the caller shows <Empty/> when there is nothing to draw. */
export function Donut({ slices, total, centerLabel, fmt = (n: number) => num(n), testId }: { slices: Slice[]; total?: number; centerLabel?: string; fmt?: (n: number) => string; testId?: string }) {
  const live = slices.filter((s) => s.value > 0);
  const sum = total ?? live.reduce((a, s) => a + s.value, 0);
  return (
    <div className="flex flex-wrap items-center gap-4" data-testid={testId}>
      <div className="an-chart relative h-36 w-36 shrink-0" dir="ltr">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <PieChart>
            <Pie data={live} dataKey="value" nameKey="label" innerRadius={44} outerRadius={64} paddingAngle={live.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {live.map((s) => <Cell key={s.key} fill={s.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip fmtLabel={() => centerLabel ?? ""} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-medium text-ink" dir="ltr">{fmt(sum)}</span>
          {centerLabel && <span className="text-[9px] text-mute">{centerLabel}</span>}
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 text-[11px]">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-mute"><span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} /><span className="truncate">{s.label}</span></span>
            <span className="shrink-0 text-ink" dir="ltr">{fmt(s.value)}{sum > 0 && s.value > 0 && <span className="ms-1 text-[9px] text-mute">{Math.round((s.value / sum) * 100)}%</span>}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
