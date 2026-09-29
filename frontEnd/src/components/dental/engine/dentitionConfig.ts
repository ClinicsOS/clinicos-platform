import { resolveCurrentTeeth, type DentitionType, type Jaw, type ToothMeta } from "@/lib/dental/fdi";
import type { ArchParams } from "./archLayout";

/**
 * Dentition configuration = the ONLY thing that differs between Permanent, Primary and Mixed:
 *   dentition type  ->  current tooth set (from the FDI registry)  +  arch geometry  +  gingiva scale.
 * Everything else (camera, controls, raycasting, hover, selection, focus, labels, jaw animation, clinical
 * overlays) is ONE shared engine that consumes a DentitionConfig.
 */
export interface DentitionConfig {
  type: DentitionType;
  teeth: ToothMeta[]; // CURRENT charted teeth
  arches: Record<Jaw, ArchParams>;
  gumScale: number;
  key: string; // identity of this configuration (type + tooth set)
}

const arch = (X: number, Z: number, zOffset: number): ArchParams => ({ X, Z, zOffset, thetaMax: 1.55 });

/** Dedicated arch shapes — primary and mixed arches are NOT the permanent coordinates reused. */
export const ARCH_PRESETS: Record<DentitionType, { upper: ArchParams; lower: ArchParams; gumScale: number }> = {
  permanent: { upper: arch(3.4, 4.9, 0), lower: arch(3.05, 4.35, -0.28), gumScale: 1 },
  primary: { upper: arch(2.35, 3.3, 0), lower: arch(2.1, 2.95, -0.2), gumScale: 0.72 },
  mixed: { upper: arch(2.95, 4.0, 0), lower: arch(2.65, 3.6, -0.24), gumScale: 0.9 },
};

export function buildDentitionConfig(type: DentitionType, current?: readonly string[] | null): DentitionConfig {
  const teeth = resolveCurrentTeeth(type, current);
  const a = ARCH_PRESETS[type];
  return { type, teeth, arches: { upper: a.upper, lower: a.lower }, gumScale: a.gumScale, key: `${type}:${teeth.map((t) => t.fdi).join(",")}` };
}
