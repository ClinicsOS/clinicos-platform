/**
 * Region rules: the ONLY place that decides which anatomical region (registry id) a point of the skin belongs to.
 * Pure functions (no three.js): the development body, the offline human generator (scripts/derm-human) and the tests all
 * use the very same rules, so region semantics can never drift between visual models. Left = the patient's left = +X.
 */
function lerpTable(keys: number[][], x: number): number {
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) { const a = keys[i - 1], b = keys[i]; return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1); }
  }
  return keys[keys.length - 1][1];
}

/** What the torso classifier needs from a body specification (landmark heights + the torso half-width table). */
export interface TorsoRulesSpec {
  y: { rib: number; iliac: number; troch: number; shoulder: number };
  shoulderX: number;
  torso: number[][];
}

export interface HeadFrame { chinY: number; headH: number; headZ: number; headWidth: number }

/** Hairline height (normalised head y') as a function of the absolute azimuth from the front (degrees). */
const HAIR_Y = [[0, 0.79], [40, 0.75], [70, 0.68], [90, 0.615], [100, 0.46], [125, 0.33], [180, 0.3]];

/**
 * Head classifier — works in the NORMALISED head frame: X = |x|/H, Y = height from the chin / H, Z forward.
 * `theta` = azimuth from the front in degrees (0 = front, 90 = the patient's side, 180 = the back).
 */
export function classifyHead(side: 1 | -1, X: number, Y: number, Z: number, theta: number, nz: number): string {
  const L = side > 0 ? "left" : "right";
  const hair = lerpTable(HAIR_Y, theta);
  const nose = Y >= 0.42 ? 0.05 : Y >= 0.34 ? 0.07 : 0.095;
  if (Y > hair) {
    // ---- scalp
    const centerY = 0.58;
    const phi = (Math.atan2(Y - centerY, Math.hypot(X, Z) + 1e-6) * 180) / Math.PI; // elevation above the head centre
    if (phi > 60) return theta < 90 ? "top_scalp" : "vertex_scalp";
    if (theta < 45) return "frontal_scalp";
    if (theta < 112) return phi < 30 ? `${L}_temporal_scalp` : `${L}_lateral_scalp`;
    return "occipital_scalp";
  }
  if (theta >= 88 || nz < -0.05) {
    // behind / under the ear: mastoid + nape
    if (Y >= 0.36 && Y <= 0.68 && theta < 122) return `${L}_ear`;
    return theta > 140 ? "posterior_neck" : `${L}_lateral_neck`;
  }
  // ---- face (front hemisphere, below the hairline)
  if (Y < 0.1 && X < 0.17) return "chin";
  if (Y >= 0.155 && Y < 0.285 && X < 0.115) return "upper_lip";
  if (Y >= 0.105 && Y < 0.155 && X < 0.115) return "lower_lip";
  if (Y >= 0.255 && Y < 0.56 && X < nose) return "nose";
  if (Y >= 0.52 && Y < 0.66 && X < 0.05) return "glabella";
  if (X >= 0.235 && Y >= 0.47) return `${L}_temple`;
  if (Y >= 0.625) return "forehead";
  if (Y >= 0.545) return `${L}_brow`;
  if (Y >= 0.465) return `${L}_periorbital`;
  if (Y >= 0.405 && X >= 0.05 && X < 0.235) return `${L}_infraorbital`;
  if (X >= 0.16 && Y < 0.14 + 0.9 * (X - 0.16) && Y < 0.33) return `${L}_jawline`;
  if (Y >= 0.105 && Y < 0.3 && X < 0.2) return "perioral";
  if (Y < 0.105) return `${L}_jawline`;
  return `${L}_cheek`;
}

export function classifyNeck(side: 1 | -1, theta: number): string {
  const L = side > 0 ? "left" : "right";
  if (theta < 42) return "anterior_neck";
  if (theta > 138) return "posterior_neck";
  return `${L}_lateral_neck`;
}

export function classifyTorso(spec: TorsoRulesSpec, x: number, y: number, z: number): string {
  const L = x >= 0 ? "left" : "right";
  const ax = Math.abs(x);
  const yy = spec.y;
  if (y >= yy.shoulder && ax >= spec.shoulderX) return `${L}_shoulder`;
  const rxAt = lerpTable(spec.torso.map((k) => [k[0], k[1]]), y);
  const ux = ax / Math.max(rxAt, 1e-6);
  if (y >= yy.rib) return z >= 0 ? `${L}_chest` : "upper_back";
  if (y >= yy.iliac) {
    if (ux >= 0.62) return `${L}_flank`;
    return z >= 0 ? "abdomen" : "lower_back";
  }
  if (y >= yy.troch && ux >= 0.8) return `${L}_flank`;
  return z >= 0 ? "abdomen" : `${L}_buttock`;
}

export function classifyArm(side: 1 | -1, s: number, l1: number): string {
  const L = side > 0 ? "left" : "right";
  if (s < 0.085) return `${L}_shoulder`;
  if (s < l1 - 0.045) return `${L}_upper_arm`;
  if (s < l1 + 0.045) return `${L}_elbow`;
  return `${L}_forearm`;
}

export function classifyLeg(side: 1 | -1, s: number, l1: number, len: number): string {
  const L = side > 0 ? "left" : "right";
  if (s < l1 - 0.06) return `${L}_thigh`;
  if (s < l1 + 0.06) return `${L}_knee`;
  if (s < len - 0.095) return `${L}_lower_leg`;
  return `${L}_ankle`;
}

