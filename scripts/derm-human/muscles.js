'use strict';
/**
 * Superficial musculoskeletal layer (visual only) for the ClinicOS clinical human.
 *
 * Each muscle / tendon / bone landmark is a TERRITORY: an oriented ellipsoid placed on the body. Every point of the skin
 * belongs to the territory with the lowest implicit value v1 (the second lowest is v2). That single rule gives:
 *   - SHAPE: a rounded belly where v1 is small, and a groove where two territories meet (v2 - v1 ~ 0) — the muscles read as
 *     separate forms with creases between them instead of one smooth surface;
 *   - COLOUR: muscle red-brown with pale tendinous ends, ivory bone landmarks, pale cartilage / fascia in between.
 * Territories are VISUAL ONLY. They never become clinical ids: the 62 registry regions are decided by regions.js.
 *
 * Everything is authored for the patient's LEFT (+X) and mirrored for the right.
 */
const S = require('./sdf.js');
const { sub, add, mul, dot, norm, cross, lerp3, frameFor } = S;
const H = require('./human.js');
const D2R = Math.PI / 180;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// muted atlas palette (clean educational model: no gloss, no wet red)
const PAL = {
  muscle: [0.60, 0.235, 0.20],
  tendon: [0.86, 0.75, 0.63],
  bone: [0.90, 0.86, 0.75],
  cartilage: [0.84, 0.66, 0.58],
  fascia: [0.80, 0.64, 0.54],
  lip: [0.62, 0.27, 0.25],
};

function buildMuscles(human) {
  const sp = human.spec, Hh = human.H, chinY = human.chinY, hz = sp.headZ;
  const F = sp.face;
  const mus = 0.6 + 0.4 * sp.muscle; // the female form is softer but still anatomical
  const list = [];
  let seq = 0;

  // ---------------------------------------------------------------- helpers
  /** Limb frame independent of the side: u = lateral (away from the midline), w = anterior (+Z), v = limb axis. */
  const limbFrame = (axis, s) => {
    const v = norm(axis);
    let w = sub([0, 0, 1], mul(v, v[2])); w = norm(w);
    let u = norm(cross(v, w)); if (u[0] * s < 0) u = mul(u, -1);
    return { u, v, w };
  };
  const torsoAt = (() => {
    const T = sp.torso;
    return (y) => {
      if (y <= T[0][0]) return T[0].slice(1);
      if (y >= T[T.length - 1][0]) return T[T.length - 1].slice(1);
      let i = 0; while (i < T.length - 2 && y > T[i + 1][0]) i++;
      const t = (y - T[i][0]) / (T[i + 1][0] - T[i][0]);
      return [1, 2, 3, 4].map((c) => T[i][c] + (T[i + 1][c] - T[i][c]) * t);
    };
  })();
  /** point on (slightly inside) the torso surface at height y; xf = fraction of the half width (signed), front = +1 / back = -1 */
  const TS = (y, xf, front, inset = 0.012) => {
    const [rx, zf, zb, e] = torsoAt(y);
    const a = Math.min(0.97, Math.abs(xf));
    const zd = front > 0 ? zf : zb;
    const z = Math.pow(Math.max(0, 1 - Math.pow(a, e)), 1 / e) * zd - inset;
    return [xf * rx, y, front > 0 ? z : -z];
  };
  const head = (x, y, z) => [x * Hh, chinY + y * Hh, hz + z * Hh];

  /**
   * T: one territory. a, b = fibre axis end points; ru = half width, rw = half thickness (outward), `out` = outward hint.
   * opts: kind (muscle|tendon|bone|cartilage), amp (mm of belly), ends (tendinous end fraction), rv (override half length),
   *       tone (colour multiplier), mirror (default true).
   */
  function T(group, kind, a, b, ru, rw, out, opts = {}) {
    const side = opts.side || 1;
    const ax = sub(b, a), len = Math.hypot(ax[0], ax[1], ax[2]);
    const v = norm(ax);
    let w = sub(out, mul(v, dot(out, v)));
    if (Math.hypot(w[0], w[1], w[2]) < 1e-6) w = [0, 0, 1];
    w = norm(w);
    const u = norm(cross(w, v));
    const rv = (opts.rv || len / 2) * (opts.stretch || 1.0);
    list.push({
      id: seq++, group, kind, c: lerp3(a, b, 0.5), u, v, w, ru, rv, rw,
      amp: (opts.amp ?? (kind === 'muscle' ? 4 : kind === 'bone' ? 1.2 : 1.5)) * mus / 1000,
      ends: opts.ends ?? (kind === 'muscle' ? 0.74 : 2), tone: opts.tone ?? 1, jit: ((seq * 2654435761) % 1000) / 1000,
    });
  }
  /** Both sides at once: `fn(side)` receives +1 / -1 and must apply mirroring itself via M(). */
  const M = (p, side) => [p[0] * side, p[1], p[2]];
  const both = (fn) => { fn(1); fn(-1); };
  const mT = (side, group, kind, a, b, ru, rw, out, o) => T(group, kind, M(a, side), M(b, side), ru, rw, M(out, side), { ...(o || {}), side });

  // ---------------------------------------------------------------- TORSO front
  const yy = sp.y, rib = yy.rib, il = yy.iliac;
  both((s) => {
    // pectoralis major (male: strong; female: lies under the breast, still shown)
    mT(s, 'chest', 'muscle', TS(rib + 0.135, 0.12 * 1, 1), TS(rib + 0.1, 0.92, 1, 0.02), 0.058, 0.03, [0, 0.3, 1], { amp: 6.5 * (sp.chest.pec > 0 ? 1 : 0.6), stretch: 1.12 });
    mT(s, 'chest', 'muscle', TS(rib + 0.17, 0.2, 1), TS(rib + 0.14, 0.9, 1, 0.02), 0.04, 0.026, [0, 0.4, 1], { amp: 3 });
    // serratus anterior (finger-like digitations on the lateral rib cage)
    for (let i = 0; i < 3; i++) mT(s, 'chest', 'muscle', TS(rib + 0.07 - i * 0.045, 0.86, 1, 0.014), TS(rib + 0.02 - i * 0.045, 0.99, 1, 0.014), 0.02, 0.018, [1, 0, 0.4], { amp: 2.5, ends: 0.9 });
    // external oblique
    mT(s, 'abdomen', 'muscle', TS(rib + 0.01, 0.84, 1, 0.014), TS(il - 0.01, 0.74, 1, 0.016), 0.05, 0.022, [1, 0, 0.5], { amp: 4, ends: 0.8 });
    mT(s, 'abdomen', 'muscle', TS(il + 0.03, 0.98, 1, 0.012), TS(il - 0.03, 0.8, 1, 0.012), 0.032, 0.02, [1, 0, 0.4], { amp: 3 });
    // rectus abdominis: stacked bellies separated by tendinous intersections, midline groove = linea alba
    for (let i = 0; i < 4; i++) {
      const y0 = il + 0.012 + i * 0.056;
      mT(s, 'abdomen', 'muscle', TS(y0, 0.15, 1), TS(y0 + 0.05, 0.15, 1), 0.028, 0.022, [0, 0, 1], { amp: 4.2, ends: 0.55, stretch: 1.0 });
    }
    // anterior neck: sternocleidomastoid, sternohyoid strips
    const nb = sp.neck.base, nz = sp.neck.z, nr = F.neckR;
    mT(s, 'neck', 'muscle', [nr * 0.95, chinY + 0.3 * Hh, nz - nr * 0.45], [0.02, nb + 0.004, nz + nr * 0.8], 0.017, 0.016, [1, 0, 0.5], { amp: 3.2 * (0.5 + 0.5 * F.scm), ends: 0.8 });
    mT(s, 'neck', 'muscle', [0.014, chinY - 0.002, nz + nr * 0.95], [0.016, nb + 0.01, nz + nr * 0.82], 0.01, 0.01, [0, 0, 1], { amp: 1.4, ends: 0.8 });
    // clavicle + acromion (bone, ivory)
    mT(s, 'chest', 'bone', [0.02, nb + 0.002, 0.056], [sp.shoulderX + 0.026, sp.armRoot[1] + 0.038, 0.02], 0.008, 0.008, [0, 0.4, 1], { amp: 1.6, stretch: 1.0 });
    // deltoid: anterior, lateral, posterior heads
    const R0 = sp.armRoot;
    const sh = [R0[0], R0[1], R0[2]];
    mT(s, 'shoulder', 'muscle', add(sh, [-0.012, 0.045, 0.034]), add(sh, [0.026, -0.052, 0.034]), 0.026, 0.022, [0, 0.3, 1], { amp: 5, ends: 0.75 });
    mT(s, 'shoulder', 'muscle', add(sh, [0.02, 0.05, 0.0]), add(sh, [0.04, -0.06, 0.0]), 0.03, 0.026, [1, 0.3, 0], { amp: 5.5, ends: 0.75 });
    mT(s, 'shoulder', 'muscle', add(sh, [-0.012, 0.045, -0.034]), add(sh, [0.026, -0.052, -0.034]), 0.026, 0.022, [0, 0.3, -1], { amp: 5, ends: 0.75 });
  });
  // sternum (midline bone strip between the pectorals)
  T('chest', 'bone', TS(rib + 0.2, 0, 1, 0.007), TS(rib + 0.03, 0, 1, 0.007), 0.012, 0.01, [0, 0, 1], { amp: 0.8, stretch: 1.02 });

  // ---------------------------------------------------------------- TORSO back
  both((s) => {
    // trapezius (descending + transverse + ascending): one large diamond
    mT(s, 'back', 'muscle', TS(rib + 0.23, 0.05, -1, 0.012), TS(rib + 0.2, 0.95, -1, 0.02), 0.085, 0.034, [0, 0.3, -1], { amp: 4.2, ends: 0.9, stretch: 1.04 });
    mT(s, 'back', 'muscle', TS(rib + 0.12, 0.03, -1, 0.012), TS(rib + 0.23, 0.6, -1, 0.012), 0.06, 0.03, [0, 0.2, -1], { amp: 3.6, ends: 0.85 });
    mT(s, 'back', 'muscle', TS(rib - 0.1, 0.03, -1, 0.012), TS(rib + 0.18, 0.55, -1, 0.012), 0.06, 0.03, [0, 0, -1], { amp: 3.4, ends: 0.85 });
    // scapula: spine + infraspinatus / teres + rhomboid hint
    mT(s, 'back', 'bone', TS(rib + 0.2, 0.28, -1, 0.006), TS(rib + 0.22, 0.88, -1, 0.006), 0.009, 0.008, [0, 0.5, -1], { amp: 1.4 });
    mT(s, 'back', 'muscle', TS(rib + 0.18, 0.34, -1, 0.012), TS(rib + 0.1, 0.8, -1, 0.012), 0.04, 0.03, [0, 0, -1], { amp: 4.2, ends: 0.85 });
    mT(s, 'back', 'muscle', TS(rib + 0.05, 0.5, -1, 0.012), TS(rib + 0.05, 0.9, -1, 0.012), 0.03, 0.026, [0, 0, -1], { amp: 4.4, ends: 0.85 });
    // latissimus dorsi: broad diagonal sheet
    mT(s, 'back', 'muscle', TS(il + 0.03, 0.2, -1, 0.012), TS(rib + 0.05, 0.98, -1, 0.012), 0.085, 0.034, [0.4, 0, -1], { amp: 4.6, ends: 0.85 });
    // erector spinae: two vertical columns beside the spine
    mT(s, 'back', 'muscle', TS(il - 0.01, 0.17, -1, 0.012), TS(rib + 0.17, 0.2, -1, 0.012), 0.032, 0.03, [0, 0, -1], { amp: 4.2, ends: 0.9 });
    // gluteus maximus / medius, thoracolumbar fascia (default colour fills the gaps)
    mT(s, 'pelvis', 'muscle', TS(il - 0.03, 0.2, -1, 0.016), TS(yy.troch - 0.05, 0.92, -1, 0.02), 0.07 * (0.9 + 0.12 * sp.glute), 0.05 * sp.glute, [0, -0.3, -1], { amp: 6 * sp.glute, ends: 0.85 });
    mT(s, 'pelvis', 'muscle', TS(il + 0.012, 0.55, -1, 0.012), TS(yy.troch + 0.06, 0.96, -1, 0.014), 0.04, 0.03, [0.3, 0, -1], { amp: 4, ends: 0.85 });
    mT(s, 'pelvis', 'tendon', TS(il - 0.02, 0.05, -1, 0.006), TS(il + 0.05, 0.05, -1, 0.006), 0.04, 0.02, [0, 0, -1], { amp: 0.5, ends: 2 });
  });

  // ---------------------------------------------------------------- ARMS
  both((s) => {
    const g = H.armGeometry(sp, s);
    const f1 = limbFrame(g.d1, s), f2 = limbFrame(g.d2, s);
    const k = sp.armR;
    const at1 = (t, th, r) => add(lerp3(g.S0, g.E, t), add(mul(f1.u, Math.cos(th * D2R) * r), mul(f1.w, Math.sin(th * D2R) * r)));
    const at2 = (t, th, r) => add(lerp3(g.E, g.Wr, t), add(mul(f2.u, Math.cos(th * D2R) * r), mul(f2.w, Math.sin(th * D2R) * r)));
    const o1 = (th) => add(mul(f1.u, Math.cos(th * D2R)), mul(f1.w, Math.sin(th * D2R)));
    const o2 = (th) => add(mul(f2.u, Math.cos(th * D2R)), mul(f2.w, Math.sin(th * D2R)));
    // biceps (anterior), triceps (posterior; long + lateral heads), brachialis
    T('arm', 'muscle', at1(0.1, 90, 0.03 * k), at1(0.88, 90, 0.026 * k), 0.034 * k, 0.024 * k, o1(90), { amp: 6.2, ends: 0.82 });
    T('arm', 'muscle', at1(0.12, -80, 0.03 * k), at1(0.88, -80, 0.026 * k), 0.034 * k, 0.024 * k, o1(-80), { amp: 6, ends: 0.82 });
    T('arm', 'muscle', at1(0.18, -20, 0.03 * k), at1(0.78, -25, 0.027 * k), 0.017 * k, 0.015 * k, o1(-20), { amp: 4.6, ends: 0.8 });
    T('arm', 'muscle', at1(0.42, 150, 0.026 * k), at1(0.95, 140, 0.026 * k), 0.016 * k, 0.014 * k, o1(150), { amp: 3.4, ends: 0.8 });
    // olecranon (bone)
    T('arm', 'bone', add(g.E, mul(f1.w, -0.02 * k)), add(g.E, mul(f1.w, -0.026 * k)), 0.014 * k, 0.012 * k, o1(-90), { amp: 1.4, rv: 0.016 * k });
    // forearm: flexor mass (front/medial), extensor mass (back/lateral), brachioradialis
    T('forearm', 'muscle', at2(0.1, 120, 0.03 * k), at2(0.82, 105, 0.02 * k), 0.03 * k, 0.022 * k, o2(120), { amp: 4.6, ends: 0.8 });
    T('forearm', 'muscle', at2(0.1, -60, 0.03 * k), at2(0.82, -65, 0.02 * k), 0.03 * k, 0.022 * k, o2(-60), { amp: 4.6, ends: 0.8 });
    T('forearm', 'muscle', at2(0.05, 20, 0.032 * k), at2(0.62, 30, 0.024 * k), 0.015 * k, 0.014 * k, o2(20), { amp: 4.8, ends: 0.78 });
    T('forearm', 'tendon', at2(0.72, 100, 0.018 * k), at2(1.0, 95, 0.012 * k), 0.016 * k, 0.012 * k, o2(100), { amp: 1.0, ends: 2 });
    // ---------------------------------------------------------------- HAND (tendinous: palm / dorsum, digits)
    const hand = human.limbs[s > 0 ? 'L' : 'R'].hand;
    if (hand) {
      const hk = sp.hand;
      const wp = add(g.Wr, mul(hand.T, 0.004 * hk));
      const P = (m, lat, pal) => add(add(add(wp, mul(hand.T, m * hk)), mul(hand.L, lat * hk)), mul(hand.P, pal * hk));
      T('hand', 'tendon', P(0.01, 0, 0), P(0.1, 0, 0), 0.05 * hk, 0.03 * hk, hand.P, { amp: 0.6, ends: 2, rv: 0.06 * hk });
      T('hand', 'tendon', P(0.01, 0, 0), P(0.1, 0, 0), 0.05 * hk, 0.03 * hk, mul(hand.P, -1), { amp: 0.6, ends: 2, rv: 0.06 * hk });
    }
  });

  // ---------------------------------------------------------------- LEGS
  both((s) => {
    const g = H.legGeometry(sp, s);
    const ft = limbFrame(sub(g.knee, g.hip), s), fs = limbFrame(sub(g.ankle, g.knee), s);
    const k = sp.legR;
    const at1 = (t, th, r) => add(lerp3(g.hip, g.knee, t), add(mul(ft.u, Math.cos(th * D2R) * r), mul(ft.w, Math.sin(th * D2R) * r)));
    const at2 = (t, th, r) => add(lerp3(g.knee, g.ankle, t), add(mul(fs.u, Math.cos(th * D2R) * r), mul(fs.w, Math.sin(th * D2R) * r)));
    const o1 = (th) => add(mul(ft.u, Math.cos(th * D2R)), mul(ft.w, Math.sin(th * D2R)));
    const o2 = (th) => add(mul(fs.u, Math.cos(th * D2R)), mul(fs.w, Math.sin(th * D2R)));
    // quadriceps: rectus femoris (front), vastus lateralis (outer), vastus medialis (inner teardrop), sartorius, TFL
    T('thigh', 'muscle', at1(0.1, 90, 0.05 * k), at1(0.84, 90, 0.04 * k), 0.034 * k, 0.03 * k, o1(90), { amp: 6.2, ends: 0.85 });
    T('thigh', 'muscle', at1(0.12, 20, 0.05 * k), at1(0.82, 25, 0.04 * k), 0.038 * k, 0.03 * k, o1(25), { amp: 6.4, ends: 0.85 });
    T('thigh', 'muscle', at1(0.5, 160, 0.044 * k), at1(0.95, 160, 0.036 * k), 0.034 * k, 0.028 * k, o1(160), { amp: 6.2, ends: 0.8 });
    T('thigh', 'muscle', at1(0.04, 55, 0.058 * k), at1(0.78, 150, 0.05 * k), 0.012 * k, 0.012 * k, o1(110), { amp: 3.4, ends: 0.85 });
    T('thigh', 'muscle', at1(0.02, 40, 0.07 * k), at1(0.3, 30, 0.055 * k), 0.022 * k, 0.018 * k, o1(35), { amp: 3.6, ends: 0.8 });
    // adductors / gracilis (inner thigh)
    T('thigh', 'muscle', at1(0.04, 180, 0.05 * k), at1(0.6, 180, 0.044 * k), 0.034 * k, 0.028 * k, o1(180), { amp: 4.4, ends: 0.85 });
    // hamstrings: biceps femoris (outer), semitendinosus + semimembranosus (inner)
    T('thigh', 'muscle', at1(0.1, -50, 0.04 * k), at1(0.9, -52, 0.034 * k), 0.04 * k, 0.03 * k, o1(-50), { amp: 5.2, ends: 0.86 });
    T('thigh', 'muscle', at1(0.1, -125, 0.04 * k), at1(0.9, -128, 0.034 * k), 0.04 * k, 0.03 * k, o1(-125), { amp: 5.2, ends: 0.86 });
    // patella (bone), patellar tendon, popliteal hollow
    T('knee', 'bone', add(g.knee, mul(ft.w, 0.044 * k)), add(g.knee, add(mul(ft.w, 0.046 * k), [0, -0.01, 0])), 0.026, 0.014, o1(90), { amp: 1.4, rv: 0.03 });
    T('knee', 'tendon', add(g.knee, add(mul(ft.w, 0.04 * k), [0, -0.03, 0])), add(g.knee, add(mul(ft.w, 0.036 * k), [0, -0.07, 0])), 0.012, 0.01, o1(90), { amp: 1.2, ends: 2 });
    // lower leg: tibialis anterior + tibial crest (bone), gastrocnemius (2 heads), soleus, peroneals, Achilles
    T('shin', 'bone', at2(0.12, 90, 0.034 * k), at2(0.82, 90, 0.026 * k), 0.008, 0.007, o2(90), { amp: 1.4, ends: 2 });
    T('shin', 'muscle', at2(0.1, 62, 0.034 * k), at2(0.78, 70, 0.026 * k), 0.016 * k, 0.014 * k, o2(65), { amp: 4.2, ends: 0.75 });
    T('shin', 'muscle', at2(0.04, 20, 0.037 * k), at2(0.62, 30, 0.028 * k), 0.015 * k, 0.014 * k, o2(25), { amp: 3.4, ends: 0.8 });
    T('shin', 'muscle', at2(0.04, -125, 0.04 * k), at2(0.46, -115, 0.036 * k), 0.032 * k, 0.03 * k, o2(-125), { amp: 7, ends: 0.85 });
    T('shin', 'muscle', at2(0.04, -55, 0.04 * k), at2(0.46, -65, 0.036 * k), 0.032 * k, 0.03 * k, o2(-55), { amp: 7, ends: 0.85 });
    T('shin', 'muscle', at2(0.34, -90, 0.034 * k), at2(0.82, -90, 0.024 * k), 0.026 * k, 0.014 * k, o2(-90), { amp: 3, ends: 0.8 });
    T('shin', 'tendon', at2(0.78, -90, 0.022 * k), at2(1.0, -90, 0.018 * k), 0.012 * k, 0.012 * k, o2(-90), { amp: 1.4, ends: 2 });
    // malleoli (bone)
    T('ankle', 'bone', add(g.ankle, [-s * 0.028 * k, 0.004, 0]), add(g.ankle, [-s * 0.03 * k, -0.004, 0]), 0.014, 0.012, [-s, 0, 0], { amp: 1.2, rv: 0.014 });
    T('ankle', 'bone', add(g.ankle, [s * 0.028 * k, -0.006, -0.004]), add(g.ankle, [s * 0.03 * k, -0.012, -0.004]), 0.014, 0.012, [s, 0, 0], { amp: 1.2, rv: 0.014 });
    // foot: tendinous dorsum / sole (pale), kept as one territory each
    const base = [g.ankle[0] + s * 0.002, 0.04, g.ankle[2] + 0.07];
    T('foot', 'tendon', add(base, [0, 0.01, -0.04]), add(base, [0, 0.008, 0.16]), 0.045, 0.03, [0, 1, 0], { amp: 0.8, ends: 2, rv: 0.11 });
  });

  // ---------------------------------------------------------------- HEAD / FACE (clean, muted)
  both((s) => {
    const m = (a, b, ru, rw, out, o) => T('face', 'muscle', M(head(...a), s), M(head(...b), s), ru * Hh, rw * Hh, M(out, s), { ...(o || {}), side: s });
    m([0.1, 0.63, 0.32], [0.11, 0.76, 0.27], 0.085, 0.04, [0, 0.4, 1], { amp: 1.6, ends: 0.85 }); // frontalis
    m([0.27, 0.54, 0.15], [0.3, 0.8, 0.0], 0.1, 0.06, [1, 0.2, 0.3], { amp: 1.4, ends: 0.85 }); // temporalis
    m([0.135, 0.505, 0.4], [0.135, 0.506, 0.4], 0.115, 0.075, [0, 0, 1], { amp: 1.4, rv: 0.07 * Hh, ends: 2 }); // orbicularis oculi (ring around the eye)
    m([0.24, 0.37, 0.16], [0.27, 0.16, 0.01], 0.06, 0.04, [1, 0, 0.3], { amp: 2.6, ends: 0.8 }); // masseter
    m([0.2, 0.43, 0.27], [0.1, 0.2, 0.39], 0.03, 0.03, [0.4, 0.3, 1], { amp: 1.6, ends: 0.8 }); // zygomaticus
    m([0.14, 0.3, 0.33], [0.13, 0.2, 0.33], 0.05, 0.04, [0.5, 0, 1], { amp: 1.4, ends: 1.2 }); // cheek / buccinator
    m([0.05, 0.45, 0.4], [0.06, 0.3, 0.42], 0.03, 0.025, [0.3, 0, 1], { amp: 1.0, ends: 0.9 }); // nasalis / levator
  });
  // galea aponeurotica: the pale tendinous cap that keeps the SCALP clearly visible as scalp (no muscle colour on the crown)
  T('scalp', 'tendon', head(0, 0.74, -0.12), head(0, 0.741, -0.12), 0.31 * Hh, 0.30 * Hh, [0, 0, 1], { amp: 0, ends: 2, rv: 0.27 * Hh });
  T('face', 'muscle', head(0, 0.16, 0.4), head(0, 0.161, 0.4), 0.135 * Hh, 0.06 * Hh, [0, 0, 1], { amp: 2, ends: 2, rv: 0.065 * Hh }); // orbicularis oris
  T('face', 'muscle', head(0, 0.07, 0.34), head(0, 0.072, 0.34), 0.07 * Hh, 0.05 * Hh, [0, 0.2, 1], { amp: 1.8, ends: 2, rv: 0.05 * Hh }); // mentalis
  T('face', 'cartilage', head(0, 0.4, 0.43), head(0, 0.29, 0.46), 0.05 * Hh, 0.05 * Hh, [0, 0, 1], { amp: 0.8, ends: 2 }); // nose (cartilage, pale)
  both((s) => {
    const e = human.ears.find((q) => q.side === s);
    if (e) T('face', 'cartilage', add(e.c, [0, 0.03 * Hh, 0]), add(e.c, [0, -0.03 * Hh, 0]), 0.045 * Hh, 0.05 * Hh, [s, 0, 0], { amp: 0.6, ends: 2, rv: 0.15 * Hh });
  });
  // platysma / posterior neck (light muscle)
  T('neck', 'muscle', [0, sp.neck.base - 0.01, sp.neck.z - 0.04], [0, chinY + 0.08, sp.neck.z - 0.045], 0.04, 0.02, [0, 0, -1], { amp: 2.4, ends: 0.85 });

  return list;
}

/** Evaluates the territories at p: { v1, v2, i1 } (lowest and second lowest implicit value, index of the winner). */
function makeEvaluator(list) {
  const n = list.length;
  const C = new Float64Array(n * 3), U = new Float64Array(n * 3), V = new Float64Array(n * 3), W = new Float64Array(n * 3), R = new Float64Array(n * 3);
  list.forEach((t, i) => { for (let k = 0; k < 3; k++) { C[i * 3 + k] = t.c[k]; U[i * 3 + k] = t.u[k]; V[i * 3 + k] = t.v[k]; W[i * 3 + k] = t.w[k]; } R[i * 3] = 1 / t.ru; R[i * 3 + 1] = 1 / t.rv; R[i * 3 + 2] = 1 / t.rw; });
  const out = { v1: 9, v2: 9, i1: -1 };
  function ev(x, y, z) {
    let a = 9, b = 9, ia = -1;
    for (let i = 0; i < n; i++) {
      const dx = x - C[i * 3], dy = y - C[i * 3 + 1], dz = z - C[i * 3 + 2];
      const lu = (dx * U[i * 3] + dy * U[i * 3 + 1] + dz * U[i * 3 + 2]) * R[i * 3];
      const lv = (dx * V[i * 3] + dy * V[i * 3 + 1] + dz * V[i * 3 + 2]) * R[i * 3 + 1];
      const lw = (dx * W[i * 3] + dy * W[i * 3 + 1] + dz * W[i * 3 + 2]) * R[i * 3 + 2];
      const v = Math.sqrt(lu * lu + lv * lv + lw * lw);
      if (v < a) { b = a; a = v; ia = i; } else if (v < b) b = v;
    }
    out.v1 = a; out.v2 = b; out.i1 = ia;
    return out;
  }
  return { ev, local: (i, x, y, z) => {
    const t = list[i]; const dx = x - t.c[0], dy = y - t.c[1], dz = z - t.c[2];
    return { lu: (dx * t.u[0] + dy * t.u[1] + dz * t.u[2]) / t.ru, lv: (dx * t.v[0] + dy * t.v[1] + dz * t.v[2]) / t.rv, lw: (dx * t.w[0] + dy * t.w[1] + dz * t.w[2]) / t.rw };
  } };
}

/** Wraps an SDF with belly + groove relief from the territories (only within a thin shell around the skin). */
function withMuscleRelief(sdf, list, exclude = []) {
  const { ev } = makeEvaluator(list);
  const SHELL = 0.02;
  return (x, y, z) => {
    const d = sdf(x, y, z);
    if (d > SHELL || d < -SHELL) return d;
    for (let i = 0; i < exclude.length; i++) { const e = exclude[i]; const dx = x - e.c[0], dy = y - e.c[1], dz = z - e.c[2]; if (dx * dx + dy * dy + dz * dz < e.r2) return d; }
    const r = ev(x, y, z);
    const t = list[r.i1];
    const bump = t.amp * (1 - Math.min(r.v1, 1) * Math.min(r.v1, 1));
    const gap = (r.v2 - r.v1) / 0.16;
    const groove = 0.0011 * Math.exp(-gap * gap) * (t.kind === 'bone' ? 0.3 : 1);
    const fade = 1 - smooth(0.012, 0.02, Math.abs(d));
    return d - (bump - groove) * fade;
  };
}

/** Atlas colour of a skin point (before ambient occlusion). */
function makeColorizer(list) {
  const { ev, local } = makeEvaluator(list);
  return (x, y, z, jitter = true) => {
    const r = ev(x, y, z);
    const t = list[r.i1];
    const base = t.kind === 'muscle' ? PAL.muscle : t.kind === 'bone' ? PAL.bone : t.kind === 'cartilage' ? PAL.cartilage : PAL.tendon;
    const j = jitter ? 1 + (t.jit - 0.5) * 0.2 : 1;
    let c = [base[0] * j * t.tone, base[1] * (jitter ? 1 + (t.jit - 0.5) * 0.12 : 1), base[2] * (jitter ? 1 + (t.jit - 0.5) * 0.1 : 1)];
    const l = local(r.i1, x, y, z);
    if (t.kind === 'muscle') {
      // pale tendinous ends along the fibre axis; fibre-direction darkening toward the belly centre
      const endK = smooth(t.ends - 0.28, t.ends + 0.32, Math.abs(l.lv));
      c = mixc(c, PAL.tendon, Math.min(1, endK) * 0.9);
      const centre = 1 - smooth(0.0, 0.9, Math.hypot(l.lu, l.lw));
      c = [c[0] * (0.9 + 0.12 * centre), c[1] * (0.88 + 0.14 * centre), c[2] * (0.88 + 0.14 * centre)];
    }
    // uncovered skin between territories = fascia
    const cover = 1 - smooth(3.6, 6.5, r.v1);
    c = mixc(PAL.fascia, c, cover);
    // groove line between two territories: a touch darker
    const gap = (r.v2 - r.v1) / 0.16;
    const g = Math.exp(-gap * gap) * 0.14 * cover;
    return [c[0] * (1 - g), c[1] * (1 - g), c[2] * (1 - g)];
  };
}
module.exports = { buildMuscles, withMuscleRelief, makeColorizer, PAL };
