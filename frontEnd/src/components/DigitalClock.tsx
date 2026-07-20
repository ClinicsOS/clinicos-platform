"use client";
import { useEffect, useState } from "react";

/**
 * Digital 3D clock — HH:MM:SS in 24h format.
 * Each digit sits on a "card" with a subtle 3D perspective; when a digit
 * changes, the card flips around its X-axis for a satisfying tick.
 */
export default function DigitalClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-edge bg-card px-2 py-1"
      style={{ perspective: "300px" }}
      dir="ltr"
    >
      <Digit value={h[0]} />
      <Digit value={h[1]} />
      <Colon />
      <Digit value={m[0]} />
      <Digit value={m[1]} />
      <Colon />
      <Digit value={s[0]} accent />
      <Digit value={s[1]} accent />
    </div>
  );
}

/**
 * A single flipping digit card. We render two stacked spans and toggle a
 * "flip" class every time the value changes — the CSS handles the animation.
 */
function Digit({ value, accent = false }: { value: string; accent?: boolean }) {
  const [prev, setPrev] = useState(value);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    if (value !== prev) {
      setFlipping(true);
      const t = window.setTimeout(() => {
        setPrev(value);
        setFlipping(false);
      }, 400);
      return () => window.clearTimeout(t);
    }
  }, [value, prev]);

  return (
    <span
      className={`clock-digit relative inline-flex h-5 w-3.5 items-center justify-center overflow-hidden rounded-sm font-mono text-[13px] font-medium leading-none ${
        accent ? "text-teal" : "text-ink"
      }`}
      style={{
        background: accent ? "rgba(79,195,184,0.08)" : "rgba(111,189,245,0.08)",
        transformStyle: "preserve-3d",
      }}
    >
      <span
        className={`absolute inset-0 flex items-center justify-center ${
          flipping ? "clock-flip-out" : ""
        }`}
      >
        {prev}
      </span>
      {flipping && (
        <span className="clock-flip-in absolute inset-0 flex items-center justify-center">
          {value}
        </span>
      )}
    </span>
  );
}

function Colon() {
  return (
    <span className="mx-0.5 flex flex-col items-center gap-0.5 text-mute">
      <span className="h-0.5 w-0.5 rounded-full bg-current" />
      <span className="h-0.5 w-0.5 rounded-full bg-current" />
    </span>
  );
}
