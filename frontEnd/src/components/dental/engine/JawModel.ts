import * as THREE from "three";
import type { Jaw } from "@/lib/dental/fdi";
import { computePlacements, getArchCurve, type ToothPlacement } from "./archLayout";
import { buildGingivaGeometry } from "./gingivaGeometry";
import { placeholderToothProvider, type ToothMeshProvider } from "./toothGeometry";
import { ToothVisual } from "./toothVisual";
import type { DentitionConfig } from "./dentitionConfig";

/**
 * The 3D dental model for ONE dentition configuration, as a plain Three.js scene graph (no renderer, no DOM) so it can be
 * built and verified headlessly.
 *
 *   root
 *    ├─ upper            (upper gingiva + upper teeth)          fixed
 *    └─ lowerPivot       (posterior hinge, behind the last molar)
 *        └─ lower        (lower gingiva + lower teeth)          rotates as ONE rigid group
 *
 * Opening the jaw rotates `lowerPivot` about X at a posterior hinge (plus a tiny forward glide) — teeth are never moved
 * individually and the jaw never simply drops straight down.
 */
export const JAW_ANGLE = { closed: 0, default: 0.12, open: 0.34 } as const;

export class JawModel {
  readonly root = new THREE.Group();
  readonly upper = new THREE.Group();
  readonly lowerPivot = new THREE.Group();
  readonly lower = new THREE.Group();
  readonly teeth = new Map<string, ToothVisual>();
  readonly gingivaMat: THREE.MeshStandardMaterial;
  readonly gingiva: Record<Jaw, THREE.Mesh>;
  readonly hinge = new THREE.Vector3();
  /** The hinge already sits closer for smaller jaws, so the same angle gives a proportionally smaller gap. */
  readonly angleScale = 1;

  constructor(readonly config: DentitionConfig, provider: ToothMeshProvider = placeholderToothProvider) {
    this.root.name = `jaw-${config.type}`;
    this.upper.name = "upper-jaw";
    this.lower.name = "lower-jaw";

    const placements = computePlacements(config.teeth, config.arches);
    const byJaw: Record<Jaw, ToothPlacement[]> = { upper: [], lower: [] };
    let minZ = 0;
    placements.forEach((p) => { byJaw[p.jaw].push(p); minZ = Math.min(minZ, p.z); });

    // Hinge sits behind the last molar (posterior), just above the occlusal plane.
    this.hinge.set(0, 0.6, minZ - 2.25);
    this.lowerPivot.position.copy(this.hinge);
    this.lower.position.copy(this.hinge).negate();
    this.lowerPivot.add(this.lower);
    this.root.add(this.upper, this.lowerPivot);

    this.gingivaMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, envMapIntensity: 0.4 });
    this.gingiva = {
      upper: new THREE.Mesh(buildGingivaGeometry("upper", getArchCurve(config.arches.upper), byJaw.upper, config.gumScale), this.gingivaMat),
      lower: new THREE.Mesh(buildGingivaGeometry("lower", getArchCurve(config.arches.lower), byJaw.lower, config.gumScale), this.gingivaMat),
    };
    this.upper.add(this.gingiva.upper);
    this.lower.add(this.gingiva.lower);

    // Every visual tooth is created FROM ITS FDI META — nothing depends on creation order or array index.
    config.teeth.forEach((meta) => {
      const visual = new ToothVisual(meta, placements.get(meta.fdi)!, provider(meta));
      this.teeth.set(meta.fdi, visual);
      (meta.jaw === "upper" ? this.upper : this.lower).add(visual.group);
    });
  }

  setJawAngle(rad: number) {
    const a = rad * this.angleScale;
    this.lowerPivot.rotation.x = a;
    this.lowerPivot.position.z = this.hinge.z + a * 1.0; // small forward glide with opening
  }

  dispose() {
    this.teeth.forEach((t) => t.dispose());
    this.gingiva.upper.geometry.dispose();
    this.gingiva.lower.geometry.dispose();
    this.gingivaMat.dispose();
  }
}
