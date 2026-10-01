import type { DermRegionRef } from "./types";
import { MAX_TARGET_REGIONS, type TargetType } from "./procedures";

/**
 * Pure target rules of the treatment editor (headless-tested). They mirror the server's validateTarget — the server stays the
 * authority; these only keep the form from offering something it would reject.
 *   single_region: exactly 1 region · multi_region: 2..MAX_TARGET_REGIONS · general: NO regions (no fake region ids)
 */
export const defaultTargetFor = (regionCount: number): TargetType => (regionCount === 0 ? "general" : regionCount === 1 ? "single_region" : "multi_region");

export function isTargetValid(targetType: TargetType, regionCount: number): boolean {
  if (targetType === "general") return true; // a general treatment sends no regions, whatever the form still holds
  if (targetType === "single_region") return regionCount === 1;
  return regionCount >= 2 && regionCount <= MAX_TARGET_REGIONS;
}

/** The regions that are actually sent for a target type (general sends none). */
export const regionsToSend = (targetType: TargetType, regions: readonly DermRegionRef[]): DermRegionRef[] => (targetType === "general" ? [] : regions.map((r) => ({ ...r })));

/** Toggle one region while picking: single = replace / clear, multi = add / remove (capped). */
export function toggleTargetRegion(targetType: TargetType, current: readonly DermRegionRef[], id: string): DermRegionRef[] {
  const has = current.some((r) => r.id === id);
  if (targetType === "single_region") return has ? [] : [{ id }];
  if (has) return current.filter((r) => r.id !== id);
  return current.length >= MAX_TARGET_REGIONS ? [...current] : [...current, { id }];
}

/** Changing the target type keeps what still makes sense: single keeps only the LAST picked region. */
export const regionsAfterTargetChange = (targetType: TargetType, current: readonly DermRegionRef[]): DermRegionRef[] =>
  targetType === "single_region" && current.length > 1 ? current.slice(-1).map((r) => ({ ...r })) : current.map((r) => ({ ...r }));

/** Should the region picker open by itself after choosing this target type? */
export const needsRegionPick = (targetType: TargetType, regionCount: number): boolean =>
  targetType !== "general" && (regionCount === 0 || (targetType === "multi_region" && regionCount < 2) || (targetType === "single_region" && regionCount !== 1));
