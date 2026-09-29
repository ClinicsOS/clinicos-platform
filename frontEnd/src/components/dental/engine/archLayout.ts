import type { Jaw, ToothMeta } from "@/lib/dental/fdi";
import { toothDims, type ToothDims } from "./toothGeometry";

/**
 * Arch layout. Teeth are placed by ARC LENGTH along a curved (elliptical, "U"-shaped) arch using
 * each tooth's real crown width — so spacing follows the anatomy instead of a fixed angular step —
 * and every tooth is yawed to the local arch normal (never "all facing forward").
 *
 * WORLD FRAME: +X = viewer right, +Y = up, +Z = toward the viewer (front of the mouth).
 * FDI orientation is carried by `side` from the FDI registry: patient right = viewer left (-X).
 */
export interface ArchParams { X: number; Z: number; zOffset: number; thetaMax: number }

const CONTACT = 0.985; // adjacent crowns overlap fractionally at their contact points

export interface ArcPoint { x: number; z: number; tx: number; tz: number; nx: number; nz: number }

export class ArchCurve {
  readonly length: number;
  private xs: Float64Array;
  private zs: Float64Array;
  private ss: Float64Array;

  constructor(readonly params: ArchParams, samples = 600) {
    this.xs = new Float64Array(samples);
    this.zs = new Float64Array(samples);
    this.ss = new Float64Array(samples);
    for (let i = 0; i < samples; i++) {
      const th = (params.thetaMax * i) / (samples - 1);
      this.xs[i] = params.X * Math.sin(th);
      this.zs[i] = params.zOffset - params.Z * (1 - Math.cos(th));
      if (i) this.ss[i] = this.ss[i - 1] + Math.hypot(this.xs[i] - this.xs[i - 1], this.zs[i] - this.zs[i - 1]);
    }
    // Continue straight along the final tangent so the retromolar gingiva has room to taper.
    const EXTRA = 1.6, STEP = 0.05, n0 = samples;
    const lx = this.xs[n0 - 1] - this.xs[n0 - 2], lz = this.zs[n0 - 1] - this.zs[n0 - 2], ll = Math.hypot(lx, lz);
    const ex = Math.round(EXTRA / STEP);
    const xs = new Float64Array(n0 + ex), zs = new Float64Array(n0 + ex), ss = new Float64Array(n0 + ex);
    xs.set(this.xs); zs.set(this.zs); ss.set(this.ss);
    for (let i = 0; i < ex; i++) {
      xs[n0 + i] = xs[n0 + i - 1] + (lx / ll) * STEP;
      zs[n0 + i] = zs[n0 + i - 1] + (lz / ll) * STEP;
      ss[n0 + i] = ss[n0 + i - 1] + STEP;
    }
    this.xs = xs; this.zs = zs; this.ss = ss;
    this.length = ss[n0 + ex - 1];
  }

  /** Point on the +X half of the arch at arc length s from the midline, with tangent and FACIAL normal. */
  at(s: number): ArcPoint {
    const n = this.ss.length;
    const c = Math.min(Math.max(s, 0), this.length);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.ss[mid] <= c) lo = mid; else hi = mid;
    }
    const f = (c - this.ss[lo]) / (this.ss[hi] - this.ss[lo] || 1);
    const dx = this.xs[hi] - this.xs[lo], dz = this.zs[hi] - this.zs[lo];
    const len = Math.hypot(dx, dz) || 1;
    const tx = dx / len, tz = dz / len;
    return { x: this.xs[lo] + dx * f, z: this.zs[lo] + dz * f, tx, tz, nx: -tz, nz: tx };
  }
}

export interface ToothPlacement {
  fdi: string;
  jaw: Jaw;
  side: 1 | -1;
  x: number; y: number; z: number; // y = CEJ height (occlusal plane is y = 0)
  yaw: number; // rotation about Y so the tooth's facial (+Z) points along the arch normal
  arcS: number;
  nx: number; nz: number; // world facial normal (xz)
  dims: ToothDims;
}

const curveCache = new Map<string, ArchCurve>();
export const getArchCurve = (p: ArchParams): ArchCurve => {
  const k = `${p.X}|${p.Z}|${p.zOffset}|${p.thetaMax}`;
  let c = curveCache.get(k);
  if (!c) curveCache.set(k, (c = new ArchCurve(p)));
  return c;
};

/** Placement for every tooth of the CURRENT dentition (permanent, primary or mixed), keyed by FDI. */
export function computePlacements(teeth: readonly ToothMeta[], arches: Record<Jaw, ArchParams>): Map<string, ToothPlacement> {
  const out = new Map<string, ToothPlacement>();
  for (const jaw of ["upper", "lower"] as Jaw[]) {
    const curve = getArchCurve(arches[jaw]);
    for (const side of [-1, 1] as const) {
      const row = teeth.filter((t) => t.jaw === jaw && t.side === side).sort((a, b) => a.position - b.position);
      let acc = 0;
      for (const t of row) {
        const dims = toothDims(t);
        const s = acc + (dims.w * CONTACT) / 2;
        acc += dims.w * CONTACT;
        const p = curve.at(s);
        const nx = side * p.nx, nz = p.nz;
        out.set(t.fdi, {
          fdi: t.fdi, jaw, side,
          x: side * p.x, z: p.z,
          // Cusp tips of the two arches just meet at the occlusal plane (y = 0) when the jaw is closed.
          y: (jaw === "upper" ? 1 : -1) * (dims.tip - 0.02),
          yaw: Math.atan2(nx, nz),
          arcS: s, nx, nz, dims,
        });
      }
    }
  }
  return out;
}
export const CONTACT_FACTOR = CONTACT;
