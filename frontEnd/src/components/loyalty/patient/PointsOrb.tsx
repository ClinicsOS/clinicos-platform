"use client";
import { useEffect, useRef, useState } from "react";
import { fmtNum, useLT } from "@/lib/loyalty";
import { usePatientVisual } from "./patientDesign";
import type { BalanceEvent } from "./usePatientData";

/**
 * Available points (Phase 9) — a physical counter with depth: an embossed gold odometer next to a glass medallion.
 *
 *  DATA RULE   the number is ALWAYS the server's `pointsBalance`. It is never computed here.
 *  CHANGE      when two server reads differ, the previous server value is shown, "+50" / "−300" rises above it (sign AND word, never colour
 *              alone), a few particles leave the medallion, and the digits roll to the new server value:  420  →  +50  →  470.
 *  MODES       full: rolling digits + medallion rings + 14 particles · lite: rolling digits + 6 particles · static: instant swap, no particles.
 */

const DIGITS = "0123456789".split("");

function Odometer({ value, instant }: { value: number; instant: boolean }) {
  const s = fmtNum(value);
  const chars = s.split("");
  return (
    <span className={`pp-odo ${instant ? "is-instant" : ""}`} aria-hidden="true" dir="ltr">
      {chars.map((ch, i) => {
        const fromRight = chars.length - 1 - i;
        if (ch === ",") return <span key={`c${fromRight}`} className="pp-comma">,</span>;
        return (
          <span key={`d${fromRight}`} className="pp-col" style={{ ["--d" as string]: Number(ch), ["--k" as string]: fromRight } as React.CSSProperties}>
            <span className="pp-stack">
              {DIGITS.map((d) => (
                <i key={d}>{d}</i>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export default function PointsOrb({ balance, event, onEventDone, stale, label }: { balance: number; event: BalanceEvent | null; onEventDone: () => void; stale?: boolean; label?: string }) {
  const { t } = useLT();
  const v = usePatientVisual();
  const [shown, setShown] = useState(balance);
  const [burst, setBurst] = useState<{ id: number; delta: number } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const lastEvent = useRef(0);

  useEffect(() => {
    const clear = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    if (event && event.id !== lastEvent.current) {
      lastEvent.current = event.id;
      clear();
      const delta = event.to - event.from;
      if (v.mode === "static") {
        setShown(event.to);
        setBurst({ id: event.id, delta });
        timers.current.push(setTimeout(() => (setBurst(null), onEventDone()), 2400));
        return clear;
      }
      setShown(event.from);
      setBurst({ id: event.id, delta });
      timers.current.push(setTimeout(() => setShown(event.to), 650));
      timers.current.push(setTimeout(() => (setBurst(null), onEventDone()), 2600));
      return clear;
    }
    if (!event) setShown(balance);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id, balance, v.mode]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const digits = fmtNum(shown).length;
  const size = digits >= 9 ? "xs" : digits >= 7 ? "s" : "m";
  const n = v.mode === "full" ? 14 : v.mode === "lite" ? 6 : 0;
  const delta = burst?.delta ?? 0;

  return (
    <div className={`pp ${stale ? "is-stale" : ""}`} data-testid="pw-points" data-size={size} data-pts={balance}>
      <div className="pp-orb" aria-hidden="true">
        <span className="pp-glass" />
        <span className="pp-coin">
          <i />
        </span>
        <span className="pp-ring r1" />
        <span className="pp-ring r2" />
        {v.mode === "full" && (
          <span className="pp-moons">
            <i />
            <i />
            <i />
          </span>
        )}
        {burst && n > 0 && (
          <span className="pp-burst" key={burst.id}>
            {Array.from({ length: n }, (_, i) => (
              <i key={i} style={{ ["--a" as string]: `${(360 / n) * i + (i % 2 ? 9 : -6)}deg`, ["--r" as string]: `${46 + (i % 3) * 14}px`, ["--s" as string]: `${0.7 + (i % 4) * 0.18}` } as React.CSSProperties} />
            ))}
          </span>
        )}
      </div>
      <div className="pp-main">
        <div className="pp-label">{label ?? t("AVAILABLE POINTS", "النقاط المتاحة")}</div>
        <div className="pp-num pw-num" data-testid="pw-points-value" data-value={shown}>
          <Odometer value={shown} instant={v.mode === "static"} />
          <span className="pw-sr">{fmtNum(balance)}</span>
        </div>
        <div className="pp-delta-slot" aria-live="polite">
          {burst && delta !== 0 && (
            <span key={burst.id} className={`pp-delta ${delta > 0 ? "is-up" : "is-down"}`} data-testid="pw-points-delta" dir="ltr">
              <b>
                {delta > 0 ? "+" : "−"}
                {fmtNum(Math.abs(delta))}
              </b>
              <em>{delta > 0 ? t("earned", "مكتسبة") : t("spent", "مصروفة")}</em>
            </span>
          )}
        </div>
        <div className="pp-sub">{stale ? t("May be out of date — reconnect to refresh", "قد تكون قديمة — أعد الاتصال للتحديث") : t("Ready to use on rewards", "جاهزة للاستخدام على الجوائز")}</div>
      </div>
    </div>
  );
}
