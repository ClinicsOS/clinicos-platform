import { pct } from "@/lib/analytics";
/** a rate the server returned as a percentage (or null when its denominator was 0) */
export const ratePctText = (v: number | null | undefined) => pct(v);
