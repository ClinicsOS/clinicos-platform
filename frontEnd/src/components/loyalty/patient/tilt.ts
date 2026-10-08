"use client";
import { useCallback, useEffect, useRef, type PointerEvent as RPointerEvent, type RefObject } from "react";
import { createSpring } from "./patientDesign";

/**
 * Touch / pointer tilt for a 3D object (the Loyalty Card, reward tickets) — Phase 9.
 *
 *  • It writes CSS variables on the element (--rx --ry --ryn --tilt --lx --ly); React never re-renders per frame.
 *  • SCROLL IS NEVER HIJACKED. The element is `touch-action: pan-y` (axes "x"): a finger that moves vertically scrolls the page (the browser
 *    cancels our pointer and the object springs back); only a clearly HORIZONTAL drag tilts it. With axes "xy" (the focused My Card stage,
 *    `touch-action: none`) both axes follow the finger — that area is not part of the scroll.
 *  • A mouse tilts on hover (no press needed). A tap (small movement, short press) calls `onTap`.
 *  • Release → critically-damped spring back. The animation loop runs ONLY while something is moving, then stops.
 *  • One light for the whole app: the highlight rests at (30%,18%) and moves the opposite way to the tilt, the same on every screen.
 */
export interface TiltOptions {
  enabled: boolean;
  axes: "x" | "xy";
  /** max tilt in degrees */
  max?: number;
  onTap?: () => void;
  /** called when a drag starts/ends (callers pause idle effects) */
  onDrag?: (dragging: boolean) => void;
}

const REST_LX = 30;
const REST_LY = 18;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** soft limit: past `max` the object resists instead of stopping dead */
const rubber = (v: number, max: number) => (Math.abs(v) <= max ? v : Math.sign(v) * (max + (Math.abs(v) - max) * 0.18));

export function useTilt<T extends HTMLElement>(opts: TiltOptions): { ref: RefObject<T>; handlers: Record<string, unknown> } {
  const ref = useRef<T>(null);
  const o = useRef(opts);
  o.current = opts;
  const st = useRef({ id: -1, x0: 0, y0: 0, rx0: 0, ry0: 0, t0: 0, dragging: false, moved: false, ignore: false });
  const springs = useRef<{ rx: ReturnType<typeof createSpring>; ry: ReturnType<typeof createSpring> } | null>(null);

  const apply = useCallback(() => {
    const el = ref.current;
    const s = springs.current;
    if (!el || !s) return;
    const rx = s.rx.value;
    const ry = s.ry.value;
    el.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
    el.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
    el.style.setProperty("--ryn", ry.toFixed(2));
    el.style.setProperty("--tilt", clamp((Math.abs(rx) + Math.abs(ry)) / 40, 0, 1).toFixed(3));
    el.style.setProperty("--lx", `${clamp(REST_LX + ry * 1.7, 2, 98).toFixed(1)}%`);
    el.style.setProperty("--ly", `${clamp(REST_LY - rx * 1.4, 2, 98).toFixed(1)}%`);
  }, []);

  const ensure = useCallback(() => {
    if (!springs.current) springs.current = { rx: createSpring(apply, { stiffness: 190, damping: 15 }), ry: createSpring(apply, { stiffness: 190, damping: 15 }) };
    return springs.current;
  }, [apply]);

  useEffect(
    () => () => {
      springs.current?.rx.stop();
      springs.current?.ry.stop();
    },
    []
  );
  // switching to a mode without tilt must leave the object flat
  useEffect(() => {
    if (!opts.enabled && springs.current) {
      springs.current.rx.set(0);
      springs.current.ry.set(0);
    }
  }, [opts.enabled]);

  const release = useCallback(() => {
    const s = ensure();
    s.rx.to(0);
    s.ry.to(0);
  }, [ensure]);

  const onPointerDown = useCallback(
    (e: RPointerEvent<HTMLElement>) => {
      if (!o.current.enabled && !o.current.onTap) return;
      const s = ensure();
      st.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, rx0: s.rx.value, ry0: s.ry.value, t0: performance.now(), dragging: false, moved: false, ignore: false };
      s.rx.stop();
      s.ry.stop();
    },
    [ensure]
  );

  const onPointerMove = useCallback(
    (e: RPointerEvent<HTMLElement>) => {
      const op = o.current;
      if (!op.enabled) {
        // no tilt (static mode): still tell a swipe from a tap, so a swipe never flips the card
        const c0 = st.current;
        if (c0.id === e.pointerId && (Math.abs(e.clientX - c0.x0) > 5 || Math.abs(e.clientY - c0.y0) > 5)) c0.moved = true;
        return;
      }
      const s = ensure();
      const max = op.max ?? 26;
      const cur = st.current;
      // mouse hover: follow the cursor without pressing
      if (e.pointerType === "mouse" && e.buttons === 0) {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        s.ry.to(clamp(nx * 2 * max * 0.7, -max, max));
        s.rx.to(op.axes === "xy" ? clamp(-ny * 2 * max * 0.5, -max, max) : 0);
        return;
      }
      if (cur.id !== e.pointerId || cur.ignore) return;
      const dx = e.clientX - cur.x0;
      const dy = e.clientY - cur.y0;
      if (!cur.dragging) {
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) cur.moved = true;
        if (e.pointerType === "touch" && op.axes === "x") {
          // a vertical gesture is a scroll — never ours
          if (Math.abs(dy) > 9 && Math.abs(dy) > Math.abs(dx)) {
            cur.ignore = true;
            return;
          }
          if (!(Math.abs(dx) > 7 && Math.abs(dx) > Math.abs(dy) * 1.15)) return;
        } else if (!cur.moved) return;
        cur.dragging = true;
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        op.onDrag?.(true);
      }
      s.ry.set(rubber(cur.ry0 + dx * 0.34, max));
      if (op.axes === "xy") s.rx.set(rubber(cur.rx0 - dy * 0.3, max * 0.8));
    },
    [ensure]
  );

  const finish = useCallback(
    (e: RPointerEvent<HTMLElement>, cancelled: boolean) => {
      const cur = st.current;
      if (cur.id !== e.pointerId) return;
      const wasDrag = cur.dragging;
      const tap = !cancelled && !cur.moved && !cur.ignore && performance.now() - cur.t0 < 450;
      cur.id = -1;
      cur.dragging = false;
      if (wasDrag) o.current.onDrag?.(false);
      if (o.current.enabled) release();
      if (tap) o.current.onTap?.();
    },
    [release]
  );

  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: (e: RPointerEvent<HTMLElement>) => finish(e, false),
    onPointerCancel: (e: RPointerEvent<HTMLElement>) => finish(e, true),
    onPointerLeave: (e: RPointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && st.current.id === -1 && o.current.enabled) release();
    },
  };
  return { ref, handlers };
}
