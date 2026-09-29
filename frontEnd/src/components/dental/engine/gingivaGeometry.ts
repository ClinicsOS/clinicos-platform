import * as THREE from "three";
import type { Jaw } from "@/lib/dental/fdi";
import { CONTACT_FACTOR, type ArchCurve, type ToothPlacement } from "./archLayout";

/**
 * Gingiva: a continuous alveolar band SWEPT along the arch (not a tube):
 *  - the crest follows each tooth's CEJ height, with interdental papillae between teeth
 *  - the crest hugs each tooth (width follows tooth depth), then swells outward and rounds off below
 *    the root apices, so roots stay hidden in normal view
 *  - tapers to a retromolar end behind the last molar
 * Per-vertex colour blends attached gingiva -> a slightly deeper alveolar-mucosa tone (muted, healthy pink).
 */
const DS = [0, 0.04, 0.1, 0.18, 0.3, 0.45, 0.62, 0.82, 1.0, 1.2, 1.42, 1.65, 1.85, 2.0, 2.1];
const E_FACIAL = 0.22, E_LINGUAL = 0.2, NS = 160, CREST_PTS = 7;
/** Real depth = normalised depth * DEPTH_SCALE (keeps the band shallow yet deeper than the visual roots). */
const DEPTH_SCALE = 0.78;

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function halfWidthAt(d: number, uHalf: number, e: number) {
  if (d <= 1) return uHalf + e * Math.sin((Math.PI / 2) * d);
  return (uHalf + e) * Math.sqrt(Math.max(0, 1 - ((d - 1) / 1.1) ** 2));
}

function interp(s: number, xs: number[], ys: number[]) {
  if (s <= xs[0]) return ys[0];
  for (let i = 0; i < xs.length - 1; i++) {
    if (s <= xs[i + 1]) {
      const t = (s - xs[i]) / (xs[i + 1] - xs[i]);
      return ys[i] + (ys[i + 1] - ys[i]) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    }
  }
  return ys[ys.length - 1];
}

export function buildGingivaGeometry(jaw: Jaw, curve: ArchCurve, placements: ToothPlacement[], scale = 1): THREE.BufferGeometry {
  const occSign = jaw === "upper" ? -1 : 1; // direction toward the biting plane
  const half = placements.filter((p) => p.side === 1).sort((a, b) => a.arcS - b.arcS);
  const centers = half.map((p) => p.arcS);
  const cej = half.map((p) => p.y);
  const uHalfs = half.map((p) => p.dims.d * 0.5 + 0.12 * Math.max(0.7, scale));
  const bounds = [0];
  half.forEach((p) => bounds.push(bounds[bounds.length - 1] + p.dims.w * CONTACT_FACTOR));
  const last = half[half.length - 1];
  const sLast = last.arcS + (last.dims.w * CONTACT_FACTOR) / 2;
  const sTaper = sLast + 0.3; // full thickness until past the last molar so no root/crown edge is exposed
  const sEnd = Math.min(curve.length, sLast + 1.0);

  const C = new THREE.Color(0xd8938d), M = new THREE.Color(0xc4726f), tmpC = new THREE.Color();
  const P = DS.length + CREST_PTS + (DS.length - 1);
  const pos = new Float32Array((NS + 1) * P * 3), col = new Float32Array((NS + 1) * P * 3);

  for (let i = 0; i <= NS; i++) {
    const sigma = -sEnd + (2 * sEnd * i) / NS;
    const side = sigma < 0 ? -1 : 1;
    const s = Math.abs(sigma);
    const pt = curve.at(s);
    const crest = interp(s, centers, cej);
    let papilla = 0;
    for (const b of bounds) papilla += 0.1 * Math.exp(-(((s - b) / 0.13) ** 2));
    const uHalf = interp(s, centers, uHalfs);
    const k = s <= sTaper ? 1 : Math.cos(Math.min(1, (s - sTaper) / (sEnd - sTaper)) * (Math.PI / 2));

    // closed cross-section loop (u = offset toward facial, dep = depth into the tissue)
    const prof: Array<[number, number]> = [];
    for (let q = DS.length - 1; q >= 0; q--) prof.push([-halfWidthAt(DS[q], uHalf, E_LINGUAL * scale), DS[q]]);
    for (let q = 1; q <= CREST_PTS; q++) {
      const u = -uHalf + (2 * uHalf * q) / (CREST_PTS + 1);
      prof.push([u, -0.07 * (1 - (u / uHalf) ** 2)]);
    }
    for (let q = 0; q < DS.length - 1; q++) prof.push([halfWidthAt(DS[q], uHalf, E_FACIAL * scale), DS[q]]);

    prof.forEach(([u, dep], j) => {
      const wgt = Math.min(1, Math.max(0, 1 - Math.max(dep, 0) / 0.9));
      const idx = (i * P + j) * 3;
      pos[idx] = side * (pt.x + pt.nx * u * k);
      const depReal = dep > 0 ? dep * DEPTH_SCALE * scale : dep;
      pos[idx + 1] = crest - occSign * depReal * k + occSign * papilla * wgt * k;
      pos[idx + 2] = pt.z + pt.nz * u * k;
      tmpC.copy(C).lerp(M, sstep(0.45, 1.5, dep));
      col[idx] = tmpC.r; col[idx + 1] = tmpC.g; col[idx + 2] = tmpC.b;
    });
  }

  const build = (flip: boolean) => {
    const index: number[] = [];
    for (let i = 0; i < NS; i++)
      for (let j = 0; j < P; j++) {
        const a = i * P + j, b = i * P + ((j + 1) % P), c = (i + 1) * P + j, d = (i + 1) * P + ((j + 1) % P);
        if (flip) index.push(a, b, c, b, d, c); else index.push(a, c, b, b, c, d);
      }
    return index;
  };
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(build(false));
  g.computeVertexNormals();
  // Self-check winding: the crest must face the biting plane. Flip if it doesn't.
  const crestIdx = (NS / 2) * P + (DS.length + Math.floor(CREST_PTS / 2));
  if ((g.getAttribute("normal") as THREE.BufferAttribute).getY(crestIdx) * occSign < 0) {
    g.setIndex(build(true));
    g.computeVertexNormals();
  }
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
