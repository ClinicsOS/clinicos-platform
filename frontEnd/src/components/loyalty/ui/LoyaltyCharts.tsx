"use client";
import { useEffect, useState, type CSSProperties } from "react";
import { fmtNum, useLT } from "@/lib/loyalty";

/**
 * Loyalty charts (Phase 8) — small, dependency-free and readable. Every chart is drawn from real numbers handed in by the caller; nothing is smoothed,
 * padded or invented. Day charts are made of focusable columns (not hover-only): tap, click, hover or arrow keys select a day and its exact figures
 * appear in a text read-out beside the chart, so touch users and screen readers get the same numbers.
 */

export interface DaySeries {
  key: string;
  label: string;
  values: number[];
  color: string;
  /** "up" grows above the baseline, "down" below it. Several "up" series overlay (first = widest). */
  dir?: "up" | "down";
}

function useDayLabel() {
  const { lang } = useLT();
  return (iso: string, long = false) => {
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(lang === "ar" ? "ar-JO-u-nu-latn" : "en-GB", long ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short" });
  };
}

export function DayChart({ dates, series, height = 200, testId, ariaLabel }: { dates: string[]; series: DaySeries[]; height?: number; testId?: string; ariaLabel: string }) {
  const label = useDayLabel();
  const [sel, setSel] = useState(Math.max(0, dates.length - 1));
  useEffect(() => setSel(Math.max(0, dates.length - 1)), [dates.length]);
  const ups = series.filter((s) => (s.dir ?? "up") === "up");
  const downs = series.filter((s) => s.dir === "down");
  const maxUp = Math.max(1, ...ups.flatMap((s) => s.values));
  const maxDown = Math.max(0, ...downs.flatMap((s) => s.values));
  const hasDown = downs.length > 0 && maxDown > 0;
  const total = maxUp + (hasDown ? maxDown : 0);
  const upShare = hasDown ? maxUp / total : 1;
  const dense = dates.length > 45;
  const i = Math.min(sel, dates.length - 1);
  return (
    <div className="lyx-ch" data-testid={testId}>
      <div className="lyx-ch-read" aria-live="polite">
        <b>{dates[i] ? label(dates[i], true) : "—"}</b>
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label} <em dir="ltr">{fmtNum(s.values[i] ?? 0)}</em>
          </span>
        ))}
      </div>
      <div className="lyx-ch-plot" style={{ height, ["--base" as string]: `${upShare * 100}%` } as CSSProperties} role="group" aria-label={ariaLabel} data-dense={dense ? "true" : undefined}>
        <span className="lyx-ch-max" dir="ltr" aria-hidden="true">
          {fmtNum(maxUp)}
        </span>
        {hasDown && (
          <span className="lyx-ch-min" dir="ltr" aria-hidden="true">
            {fmtNum(maxDown)}
          </span>
        )}
        <span className="lyx-ch-base" aria-hidden="true" />
        {dates.map((d, k) => (
          <button
            key={d}
            type="button"
            className="lyx-ch-col"
            data-sel={k === i ? "true" : undefined}
            aria-label={`${label(d, true)}: ${series.map((s) => `${s.label} ${fmtNum(s.values[k] ?? 0)}`).join(", ")}`}
            aria-pressed={k === i}
            tabIndex={k === i ? 0 : -1}
            onClick={() => setSel(k)}
            onMouseEnter={() => setSel(k)}
            onFocus={() => setSel(k)}
            onKeyDown={(e) => {
              const rtl = document.documentElement.dir === "rtl" ? -1 : 1;
              const step = e.key === "ArrowRight" ? rtl : e.key === "ArrowLeft" ? -rtl : 0;
              if (!step) return;
              e.preventDefault();
              const n = Math.max(0, Math.min(dates.length - 1, k + step));
              setSel(n);
              (e.currentTarget.parentElement?.querySelectorAll<HTMLElement>(".lyx-ch-col")[n])?.focus();
            }}
          >
            <span className="lyx-ch-up">
              {ups.map((s, n) => (
                <i key={s.key} style={{ height: `${(Math.max(0, s.values[k] ?? 0) / maxUp) * 100}%`, background: s.color, width: `${100 - n * 34}%` }} />
              ))}
            </span>
            {hasDown && (
              <span className="lyx-ch-down">
                {downs.map((s) => (
                  <i key={s.key} style={{ height: `${(Math.max(0, s.values[k] ?? 0) / maxDown) * 100}%`, background: s.color }} />
                ))}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="lyx-ch-axis" aria-hidden="true">
        <span>{dates[0] ? label(dates[0]) : ""}</span>
        <span>{dates.length > 2 ? label(dates[Math.floor(dates.length / 2)]) : ""}</span>
        <span>{dates.length ? label(dates[dates.length - 1]) : ""}</span>
      </div>
      <div className="lyx-ch-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface Part {
  key: string;
  label: string;
  value: number;
  color: string;
}

/** Ring of parts (real counts). The centre shows the caller's own headline. */
export function Donut({ parts, centre, sub, testId }: { parts: Part[]; centre: string; sub: string; testId?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="lyx-donut" data-testid={testId}>
      <div className="lyx-donut-ring">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={R} className="bg" />
          {total > 0 &&
            parts
              .filter((p) => p.value > 0)
              .map((p) => {
                const len = (p.value / total) * C;
                const el = <circle key={p.key} cx="50" cy="50" r={R} className="seg" style={{ stroke: p.color, strokeDasharray: `${Math.max(0, len - 1.5)} ${C - Math.max(0, len - 1.5)}`, strokeDashoffset: -acc }} />;
                acc += len;
                return el;
              })}
        </svg>
        <div className="lyx-donut-c">
          <b dir="ltr">{centre}</b>
          <small>{sub}</small>
        </div>
      </div>
      <ul className="lyx-donut-l">
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: p.color }} />
            <span>{p.label}</span>
            <b dir="ltr">{fmtNum(p.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface HRow {
  key: string;
  label: string;
  value: number;
  sub?: string;
}
/** Horizontal bars scaled to the largest REAL value in the list. */
export function HBars({ rows, color = "var(--lyx-gold)", unit, testId }: { rows: HRow[]; color?: string; unit?: string; testId?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="lyx-hb" data-testid={testId}>
      {rows.map((r) => (
        <li key={r.key}>
          <div>
            <span dir="auto">{r.label}</span>
            <b dir="ltr">
              {fmtNum(r.value)}
              {unit ? ` ${unit}` : ""}
            </b>
          </div>
          <span className="lyx-hb-track">
            <i style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </span>
          {r.sub && <small>{r.sub}</small>}
        </li>
      ))}
    </ul>
  );
}

/** One stacked bar made of real parts (e.g. the redemption funnel). */
export function StackBar({ parts, testId }: { parts: Part[]; testId?: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div data-testid={testId}>
      <div className="lyx-sb" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {total > 0 ? parts.filter((p) => p.value > 0).map((p) => <i key={p.key} style={{ flex: p.value, background: p.color }} title={`${p.label}: ${p.value}`} />) : <i style={{ flex: 1, background: "rgba(255,244,214,.08)" }} />}
      </div>
      <ul className="lyx-donut-l lyx-donut-l--row">
        {parts.map((p) => (
          <li key={p.key}>
            <i style={{ background: p.color }} />
            <span>{p.label}</span>
            <b dir="ltr">{fmtNum(p.value)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
