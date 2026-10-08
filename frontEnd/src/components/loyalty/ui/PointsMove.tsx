"use client";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { IconGift } from "@tabler/icons-react";
import { fmtNum, useLT } from "@/lib/loyalty";
import { useVisual } from "../shell/loyaltyDesign";

/**
 * Points-moving animation (Phase 8). It is ONLY ever mounted from a real server answer: `from` / `to` / `points` are the numbers the server returned for a
 * confirmed redemption (direction "out": the balance goes down and coins travel to the reward) or a confirmed reversal (direction "back": the coins
 * travel home and the balance goes up). Nothing here is computed on the client — the counter just walks from the server's "before" to its "after".
 * Reduced motion / lite devices: no coins, no counting — the final figures simply appear.
 */
export default function PointsMove({ from, to, points, direction, label, medal }: { from: number; to: number; points: number; direction: "out" | "back"; label: string; medal?: ReactNode }) {
  const { t } = useLT();
  const { mode } = useVisual();
  const still = mode === "static";
  const [shown, setShown] = useState(still ? to : from);

  useEffect(() => {
    if (still) {
      setShown(to);
      return;
    }
    setShown(from);
    let raf = 0;
    const delay = 420;
    const dur = 1150;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (to - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    const tm = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(tm);
      cancelAnimationFrame(raf);
    };
  }, [from, to, still]);

  const coins = Math.min(7, Math.max(3, Math.round(points / 150) + 3));
  return (
    <div className="lyx-pm" data-dir={direction} data-still={still ? "true" : undefined} data-testid="lyx-points-move">
      <div className="lyx-pm-node lyx-pm-bal">
        <span className="lyx-pm-k">{t("Balance", "الرصيد")}</span>
        <b dir="ltr" data-testid="lyx-pm-balance" aria-live="polite">
          {fmtNum(shown)}
        </b>
        <small dir="ltr">
          {fmtNum(from)} → {fmtNum(to)}
        </small>
      </div>
      <div className="lyx-pm-lane" aria-hidden="true">
        <span className="lyx-pm-line" />
        {Array.from({ length: coins }).map((_, i) => (
          <i key={i} className="lyx-pm-coin" style={{ ["--d" as string]: `${420 + i * 110}ms`, ["--arc" as string]: `${(i % 2 ? -1 : 1) * (6 + (i % 3) * 4)}px` } as CSSProperties} />
        ))}
      </div>
      <div className="lyx-pm-node lyx-pm-rw">
        <span className="lyx-pm-med">{medal ?? <IconGift size={20} />}</span>
        <b className="lyx-pm-name">{label}</b>
        <small dir="ltr" data-k={direction === "out" ? "debit" : "reversal"}>
          {direction === "out" ? "−" : "+"}
          {fmtNum(Math.abs(points))}
        </small>
      </div>
    </div>
  );
}
