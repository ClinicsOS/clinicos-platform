'use strict';
/**
 * Vertex colours: a neutral clinical skin tone x baked ambient occlusion, plus a few very subtle natural tints (lips,
 * ears, nose tip, knees/elbows, eyes). Colour is NEVER used to imply disease, severity, diagnosis or treatment.
 */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function colorize(human, mesh, atlas) {
  const sp = human.spec, { positions: P, normals: N, ao } = mesh, nv = P.length / 3;
  const skin = sp.skin, H = human.H, chinY = human.chinY, hz = sp.headZ;
  const out = new Float32Array(nv * 3);
  const lipC = [skin[0] * 0.98, skin[1] * 0.74, skin[2] * 0.72];
  const earC = [skin[0], skin[1] * 0.9, skin[2] * 0.88];
  const flushC = [skin[0], skin[1] * 0.86, skin[2] * 0.83];
  const browC = sp.key === 'male' ? 0.8 : 0.9;
  const sclera = [0.86, 0.82, 0.78], iris = [0.27, 0.2, 0.15], pupil = [0.07, 0.055, 0.05];
  const eyes = human.eyes;
  const joints = [];
  for (const nm of ['L', 'R']) { const side = nm === 'L' ? 1 : -1; const { armGeometry, legGeometry } = require('./human.js'); joints.push([armGeometry(sp, side).E, 0.03], [legGeometry(sp, side).knee, 0.045]); }
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    let c = atlas ? atlas(x, y, z) : skin.slice();
    const X = Math.abs(x) / H, Y = (y - chinY) / H, Z = (z - hz) / H;
    const inHead = Y > -0.05 && Y < 1.05 && Z > -0.55 && X < 0.5;
    if (!atlas && inHead && nz > 0.15) {
      // lips
      const lip = Math.max(0, 1 - Math.pow(X / 0.105, 2) - Math.pow((Y - 0.16) / 0.062, 2));
      c = mix(c, lipC, smooth(0.0, 0.55, lip) * 0.85 * (sp.key === 'female' ? 1.0 : 0.8));
      // brows: very subtle darker band (no hair geometry)
      const browBand = smooth(0.0, 0.5, 1 - Math.pow((Y - 0.582) / 0.03, 2)) * smooth(0.04, 0.09, X) * (1 - smooth(0.22, 0.26, X));
      c = [c[0] * (1 - (1 - browC) * browBand), c[1] * (1 - (1 - browC) * browBand), c[2] * (1 - (1 - browC) * browBand)];
      // nose tip + cheeks: faint natural warmth
      const nose = Math.max(0, 1 - Math.pow(X / 0.06, 2) - Math.pow((Y - 0.31) / 0.06, 2));
      const cheek = Math.max(0, 1 - Math.pow((X - 0.17) / 0.09, 2) - Math.pow((Y - 0.33) / 0.09, 2));
      c = mix(c, flushC, Math.min(1, smooth(0, 0.6, nose) * 0.7 + smooth(0, 0.7, cheek) * 0.35));
    }
    // eyes
    for (const e of eyes) {
      const dx = x - e.c[0], dy = y - e.c[1], dz = z - e.c[2];
      const r = Math.hypot(dx, dy, dz);
      if (Math.abs(r - e.r) < 0.0016) {
        const cosA = (dx * e.axis[0] + dy * e.axis[1] + dz * e.axis[2]) / (r || 1);
        const ang = (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI;
        if (ang < 62) {
          let col = sclera;
          col = mix(col, iris, 1 - smooth(27, 32, ang));
          col = mix(col, pupil, 1 - smooth(10, 13, ang));
          // limbal ring: a slightly darker rim keeps the eye readable without looking painted
          col = mix(col, [iris[0] * 0.7, iris[1] * 0.7, iris[2] * 0.7], smooth(24, 28, ang) * (1 - smooth(30, 34, ang)) * 0.6);
          c = col;
        }
      }
    }
    // ears (front-side skin only): slightly warmer
    if (!atlas) for (const e of human.ears || []) { const d = Math.hypot(x - e.c[0], y - e.c[1], z - e.c[2]); if (d < 0.05) c = mix(c, earC, smooth(0.05, 0.02, d) * 0.55); }
    // elbows / knees: faint warmth
    if (!atlas) for (const [j, r] of joints) { const d = Math.hypot(x - j[0], y - j[1], z - j[2]); if (d < r * 2) c = mix(c, flushC, smooth(r * 2, r * 0.4, d) * 0.5); }
    const a = ao ? ao[v] : 1;
    const k = 0.5 + 0.5 * Math.pow(a, 0.9); // AO never makes the skin black
    out[v * 3] = c[0] * k; out[v * 3 + 1] = c[1] * k; out[v * 3 + 2] = c[2] * k;
  }
  return out;
}
module.exports = { colorize };
