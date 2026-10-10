"use client";
import { ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { IconChevronLeft, IconChevronRight, IconChevronsLeft, IconChevronsRight } from "@tabler/icons-react";
import {
  addDaysYmd,
  addMonthsYmd,
  daysInMonth,
  fmtCalendarDate,
  isValidYmd,
  makeYmd,
  parseYmd,
  weekdayOfYmd,
} from "@/lib/dates";

/**
 * Calendar popover for jumping straight to any day.
 *
 * - Works only with "YYYY-MM-DD" strings and pure calendar arithmetic (lib/dates), so
 *   neither the browser timezone nor DST can ever shift the day the user clicked.
 * - `value` is the single source of truth owned by the parent; this component only
 *   calls `onChange` — it keeps no competing "selected date" state of its own.
 * - Keyboard: arrows move by day/week, PageUp/PageDown by month (Shift = year),
 *   Home/End to the start/end of the week, Enter/Space selects, Esc closes and
 *   returns focus to the trigger. RTL-aware (Arabic).
 */
export default function DatePickerPopover({
  value,
  onChange,
  today,
  lang,
  t,
  children,
  triggerClassName = "",
}: {
  value: string;
  onChange: (ymd: string) => void;
  today: string;
  lang: "en" | "ar";
  t: (key: string) => string;
  /** Visible content of the trigger button (the displayed date). */
  children: ReactNode;
  triggerClassName?: string;
}) {
  const rtl = lang === "ar";
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"days" | "months">("days");
  // The day that currently holds keyboard focus (its month is the month on screen).
  const [cursor, setCursor] = useState(value);
  // Direction of the last month change, used only to pick the entry animation.
  const [slide, setSlide] = useState<"next" | "prev" | "none">("none");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusAfterRender = useRef(false);
  const dialogId = useId();

  const safeValue = isValidYmd(value) ? value : today;
  const { y: cy, m: cm } = parseYmd(isValidYmd(cursor) ? cursor : safeValue);

  const openPicker = () => {
    setCursor(safeValue);
    setView("days");
    setSlide("none");
    focusAfterRender.current = true;
    setOpen(true);
  };

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const select = (ymd: string) => {
    onChange(ymd);
    close(true);
  };

  // Move the cursor; `focus` asks the effect below to move DOM focus onto the new cell.
  const moveCursor = (next: string, direction: "next" | "prev" | "none" = "none") => {
    const sameMonth = next.slice(0, 7) === cursor.slice(0, 7);
    setSlide(sameMonth ? "none" : direction);
    focusAfterRender.current = true;
    setCursor(next);
  };

  // Same as moveCursor but for the arrow buttons: changes the month on screen without pulling focus off the button.
  const shiftCursor = (next: string, direction: "next" | "prev") => {
    setSlide(next.slice(0, 7) === cursor.slice(0, 7) ? "none" : direction);
    setCursor(next);
  };

  useEffect(() => {
    if (!open || !focusAfterRender.current || view !== "days") return;
    focusAfterRender.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-ymd="${cursor}"]`)?.focus();
  }, [open, cursor, view]);

  // Click/touch outside closes (without stealing focus from whatever was clicked).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  // 6 weeks x 7 days, Sunday first, so the popover never changes height between months.
  const cells = useMemo(() => {
    const first = makeYmd(cy, cm, 1);
    const lead = weekdayOfYmd(first);
    const start = addDaysYmd(first, -lead);
    return Array.from({ length: 42 }, (_, i) => addDaysYmd(start, i));
  }, [cy, cm]);

  const weekdayLabels = useMemo(() => {
    // 2026-01-04 is a Sunday.
    return Array.from({ length: 7 }, (_, i) => {
      const day = addDaysYmd("2026-01-04", i);
      return rtl
        ? fmtCalendarDate(day, "ar", { weekday: "narrow" })
        : fmtCalendarDate(day, "en", { weekday: "short" }).slice(0, 2);
    });
  }, [rtl]);

  const monthLabel = fmtCalendarDate(makeYmd(cy, cm, 1), lang, { month: "long", year: "numeric" });

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const hz = rtl ? -1 : 1; // ArrowRight moves "forward" in LTR, "backward" in RTL
    let next: string | null = null;
    let dir: "next" | "prev" = "next";
    switch (e.key) {
      case "ArrowRight": next = addDaysYmd(cursor, hz); dir = hz > 0 ? "next" : "prev"; break;
      case "ArrowLeft": next = addDaysYmd(cursor, -hz); dir = hz > 0 ? "prev" : "next"; break;
      case "ArrowDown": next = addDaysYmd(cursor, 7); break;
      case "ArrowUp": next = addDaysYmd(cursor, -7); dir = "prev"; break;
      case "Home": next = addDaysYmd(cursor, -weekdayOfYmd(cursor)); dir = "prev"; break;
      case "End": next = addDaysYmd(cursor, 6 - weekdayOfYmd(cursor)); break;
      case "PageDown": next = addMonthsYmd(cursor, e.shiftKey ? 12 : 1); break;
      case "PageUp": next = addMonthsYmd(cursor, e.shiftKey ? -12 : -1); dir = "prev"; break;
      default: return;
    }
    e.preventDefault();
    moveCursor(next, dir);
  };

  const onRootKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close(true);
    }
  };

  const navBtn =
    "flex h-8 w-8 items-center justify-center rounded-lg text-mute transition-colors hover:bg-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/60";

  return (
    <div ref={rootRef} className="relative" onKeyDown={onRootKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close(false) : openPicker())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        title={t("ap.pickDate")}
        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/60 ${triggerClassName}`}
      >
        {children}
      </button>

      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-label={t("ap.pickDate")}
          className="dropdown-in absolute start-0 top-full z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-edge bg-card p-3 shadow-2xl shadow-black/30"
        >
          {/* Header: month / year navigation */}
          <div className="mb-2 flex items-center gap-1">
            <button
              type="button"
              className={navBtn}
              aria-label={t("ap.prevYear")}
              onClick={() => shiftCursor(addMonthsYmd(cursor, -12), "prev")}
            >
              <IconChevronsLeft size={15} className="rtl-flip" />
            </button>
            <button
              type="button"
              className={`${navBtn} ${view === "months" ? "invisible" : ""}`}
              aria-label={t("ap.prevMonth")}
              tabIndex={view === "months" ? -1 : 0}
              onClick={() => shiftCursor(addMonthsYmd(cursor, -1), "prev")}
            >
              <IconChevronLeft size={15} className="rtl-flip" />
            </button>
            <button
              type="button"
              onClick={() => setView((v) => (v === "days" ? "months" : "days"))}
              aria-label={t("ap.chooseMonth")}
              aria-live="polite"
              className="mx-auto min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-center text-[13px] font-medium text-ink transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/60"
            >
              {view === "days" ? monthLabel : String(cy)}
            </button>
            <button
              type="button"
              className={`${navBtn} ${view === "months" ? "invisible" : ""}`}
              aria-label={t("ap.nextMonth")}
              tabIndex={view === "months" ? -1 : 0}
              onClick={() => shiftCursor(addMonthsYmd(cursor, 1), "next")}
            >
              <IconChevronRight size={15} className="rtl-flip" />
            </button>
            <button
              type="button"
              className={navBtn}
              aria-label={t("ap.nextYear")}
              onClick={() => shiftCursor(addMonthsYmd(cursor, 12), "next")}
            >
              <IconChevronsRight size={15} className="rtl-flip" />
            </button>
          </div>

          {view === "days" ? (
            <>
              <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-medium tracking-wide text-mute" aria-hidden="true">
                {weekdayLabels.map((w, i) => (
                  <div key={i} className="py-1">{w}</div>
                ))}
              </div>
              <div
                key={`${cy}-${cm}`}
                ref={gridRef}
                role="grid"
                aria-label={monthLabel}
                onKeyDown={onGridKeyDown}
                className={`${slide === "next" ? "ap-cal-next" : slide === "prev" ? "ap-cal-prev" : ""}`}
              >
                {Array.from({ length: 6 }, (_, w) => cells.slice(w * 7, w * 7 + 7)).map((week) => (
                  <div key={week[0]} role="row" className="grid grid-cols-7 gap-y-0.5">
                    {week.map((ymd) => {
                      const inMonth = ymd.slice(0, 7) === makeYmd(cy, cm, 1).slice(0, 7);
                      const selected = ymd === safeValue;
                      const isTodayCell = ymd === today;
                      const label = fmtCalendarDate(ymd, lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
                      return (
                        <button
                          key={ymd}
                          type="button"
                          role="gridcell"
                          data-ymd={ymd}
                          tabIndex={ymd === cursor ? 0 : -1}
                          aria-selected={selected}
                          aria-current={isTodayCell ? "date" : undefined}
                          aria-label={label}
                          onClick={() => select(ymd)}
                          className={`mx-auto flex aspect-square w-full max-w-[2.5rem] items-center justify-center rounded-lg text-[12px] tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/70 ${
                            selected
                              ? "bg-blue font-semibold text-white shadow-sm"
                              : isTodayCell
                              ? "font-semibold text-teal ring-1 ring-inset ring-teal/60 hover:bg-teal/10"
                              : inMonth
                              ? "text-ink hover:bg-soft"
                              : "text-mute/50 hover:bg-soft hover:text-mute"
                          }`}
                        >
                          {parseYmd(ymd).d}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 py-1" role="listbox" aria-label={t("ap.chooseMonth")}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((mo) => {
                const sample = makeYmd(cy, mo, 1);
                const isCurrent = mo === cm;
                const isTodayMonth = sample.slice(0, 7) === today.slice(0, 7);
                return (
                  <button
                    key={mo}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    onClick={() => {
                      const d = Math.min(parseYmd(cursor).d, daysInMonth(cy, mo));
                      setSlide("none");
                      setCursor(makeYmd(cy, mo, d));
                      focusAfterRender.current = true;
                      setView("days");
                    }}
                    className={`rounded-lg border py-2.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/70 ${
                      isCurrent
                        ? "border-blue bg-blue/15 font-semibold text-sky"
                        : isTodayMonth
                        ? "border-teal/50 text-teal hover:bg-teal/10"
                        : "border-transparent text-ink hover:bg-soft"
                    }`}
                  >
                    {fmtCalendarDate(sample, lang, { month: "short" })}
                  </button>
                );
              })}
            </div>
          )}

          {/* Quick jumps, all relative to today */}
          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-edge pt-3">
            {[
              { key: "ap.today", target: today },
              { key: "ap.tomorrow", target: addDaysYmd(today, 1) },
              { key: "ap.inOneWeek", target: addDaysYmd(today, 7) },
              { key: "ap.inOneMonth", target: addMonthsYmd(today, 1) },
            ].map((q) => (
              <button
                key={q.key}
                type="button"
                onClick={() => select(q.target)}
                className={`rounded-full border px-3 py-1 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky/60 ${
                  q.target === safeValue
                    ? "border-blue bg-blue/15 text-sky"
                    : "border-edge bg-card2 text-mute hover:border-sky hover:text-ink"
                }`}
              >
                {t(q.key)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
