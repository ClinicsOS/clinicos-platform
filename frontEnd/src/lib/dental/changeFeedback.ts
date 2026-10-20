"use client";
/* PHASE 4 — tiny, transient "what just changed" signal for the gentle visual feedback (new card fade-in, tooth glow).
   It carries NO clinical data and is never persisted: a mutation that the SERVER confirmed publishes {patientId, new/changed item ids, teeth};
   whichever view is mounted (Treatment Plan, 2D grid, 3D chart) reads it for FEEDBACK_MS and then it expires on its own. */
import { useEffect, useState } from "react";
import { create } from "zustand";

export const FEEDBACK_MS = 1800;

export interface ChangeSignal { patientId: string; addedIds: string[]; changedIds: string[]; teeth: string[]; at: number }
interface FeedbackState { last: ChangeSignal | null; publish: (s: Omit<ChangeSignal, "at">) => void }

export const useChangeFeedbackStore = create<FeedbackState>((set) => ({
  last: null,
  publish: (s) => set({ last: { ...s, at: Date.now() } }),
}));

const EMPTY: { addedIds: ReadonlySet<string>; changedIds: ReadonlySet<string>; teeth: ReadonlySet<string>; at: number } = { addedIds: new Set(), changedIds: new Set(), teeth: new Set(), at: 0 };

/** The still-fresh change for this patient (or an empty set). Re-renders once when it expires so the animation classes are removed. */
export function useChangeFeedback(patientId: string) {
  const last = useChangeFeedbackStore((s) => s.last);
  const [, tick] = useState(0);
  const fresh = !!last && last.patientId === patientId && Date.now() - last.at < FEEDBACK_MS;
  const at = last?.at ?? 0;
  useEffect(() => {
    if (!fresh) return;
    const left = Math.max(0, FEEDBACK_MS - (Date.now() - at));
    const h = setTimeout(() => tick((n) => n + 1), left + 20);
    return () => clearTimeout(h);
  }, [fresh, at]);
  if (!fresh || !last) return EMPTY;
  return { addedIds: new Set(last.addedIds), changedIds: new Set(last.changedIds), teeth: new Set(last.teeth), at: last.at };
}
