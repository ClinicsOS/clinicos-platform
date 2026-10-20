/**
 * PHASE 3 — grouping of the clinical timeline into Today / Yesterday / Earlier this week / one group per older day.
 *
 * The day of every item is the CLINIC-LOCAL calendar day computed by the server (`localDate`, from the instant in the clinic's timezone), and
 * "today" is the clinic's today too — so an event at 23:30 UTC (02:30 the next day in Amman) lands on the right day whatever the browser's zone is.
 * Pure calendar arithmetic on "YYYY-MM-DD" strings: no Date, no timezone, no DST involved.
 */
export type DayKind = "today" | "yesterday" | "week" | "date";
export interface DayGroup<T> { key: string; kind: DayKind; ymd?: string; items: T[] }

const MS_DAY = 86_400_000;
const toDays = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
};

/** How many calendar days `ymd` is before `today` (0 = today, 1 = yesterday, negative = in the future). */
export const daysAgo = (ymd: string, today: string): number => toDays(today) - toDays(ymd);

export function groupByDay<T extends { localDate: string }>(items: readonly T[], today: string): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const open = new Map<string, DayGroup<T>>();
  for (const it of items) {
    const ago = daysAgo(it.localDate, today);
    let key: string, kind: DayKind, ymd: string | undefined;
    if (ago <= 0) { key = "today"; kind = "today"; }                     // (a clock-skewed future day is shown as Today, never hidden)
    else if (ago === 1) { key = "yesterday"; kind = "yesterday"; }
    else if (ago <= 6) { key = "week"; kind = "week"; }
    else { key = `date:${it.localDate}`; kind = "date"; ymd = it.localDate; }
    let g = open.get(key);
    if (!g) { g = { key, kind, ymd, items: [] }; open.set(key, g); groups.push(g); }
    g.items.push(it);
  }
  return groups;
}
