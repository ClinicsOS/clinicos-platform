/**
 * PHASE 5 — what a Dental Chart deep link means (pure, unit-tested). One place decides, for BOTH the 2D and the 3D chart:
 *   - which tooth to select (the link's tooth, else the linked chart entry's tooth, else the first tooth of the linked treatment),
 *   - which surface to emphasise,
 *   - whether to open with the tooth ISOLATED (a Mesial / Distal surface is hidden behind the neighbour in 3D, so it opens isolated),
 *   - which teeth to highlight (every tooth of a multi-tooth treatment),
 *   - whether the target no longer exists (the chart then says so instead of failing silently).
 * Links carry only validated ids / codes (see lib/history/deeplink.ts); this never trusts a hand-edited URL.
 */
import { findFocusedEvent, findFocusedItem, focusedSurface, sanitizeTeeth, type ProfileFocus } from "../history/deeplink";
import type { SurfaceId } from "./taxonomy";

export interface ChartLink {
  tooth: string | null;
  surface: SurfaceId | null;
  isolate: boolean;
  /** Every tooth of a multi-tooth treatment (empty for a single tooth). */
  teeth: string[];
  eventMissing: boolean;
  itemMissing: boolean;
}

export function resolveChartLink(
  focus: Pick<ProfileFocus, "tooth" | "teeth" | "surface" | "event" | "item"> | null | undefined,
  data: { events?: readonly { _id: string; fdi: string }[]; planItems?: readonly { _id: string; toothNumbers: string[] }[] }
): ChartLink {
  const ev = findFocusedEvent(data.events, { event: focus?.event ?? null });
  const item = findFocusedItem(data.planItems, { item: focus?.item ?? null });
  const group = sanitizeTeeth([...(focus?.teeth ?? []), ...(item && item.toothNumbers.length > 1 ? item.toothNumbers : [])]);
  const surface = (focus ? focusedSurface(focus) : null) as SurfaceId | null;
  return {
    tooth: focus?.tooth ?? ev?.fdi ?? group[0] ?? item?.toothNumbers[0] ?? null,
    surface,
    isolate: surface === "M" || surface === "D",
    teeth: group.length > 1 ? group : [],
    eventMissing: !!focus?.event && !!data.events && !ev,
    itemMissing: !!focus?.item && !!data.planItems && !item,
  };
}
