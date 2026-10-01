import * as THREE from "three";

export interface CameraPose { position: THREE.Vector3; target: THREE.Vector3 }

/** Gentle ease-in-out — calm, clinical camera motion (no bounce, no overshoot). */
export const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;

interface ActivePlan {
  from: CameraPose;
  to: CameraPose;
  delay: number;
  duration: number;
  start: number;
  token: number;
  onComplete: () => void;
  q: THREE.Quaternion;
  d0: THREE.Vector3;
  r0: number;
  r1: number;
}

/**
 * The SINGLE authoritative scripted camera transition of the dermatology map.
 *
 * `start()` supersedes whatever was running — the superseded plan's `onComplete` is NEVER called. The camera is
 * interpolated ORBITALLY (target moves linearly, the view direction slerps around the moving target, distance lerps)
 * so going from the front to the back swings round the patient instead of cutting through the body.
 * Position AND orbit target are always driven together.
 */
export class CameraDirector {
  private plan: ActivePlan | null = null;
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private static readonly IDENTITY = new THREE.Quaternion();

  get active() { return this.plan !== null; }
  get activeToken() { return this.plan ? this.plan.token : null; }

  start(from: CameraPose, to: CameraPose, o: { delay: number; duration: number; token: number; now: number; onComplete: () => void }) {
    const off0 = from.position.clone().sub(from.target);
    const off1 = to.position.clone().sub(to.target);
    const r0 = off0.length() || 1e-6, r1 = off1.length() || 1e-6;
    const d0 = off0.clone().divideScalar(r0), d1 = off1.clone().divideScalar(r1);
    // Exactly opposite directions make the shortest-arc rotation ambiguous: it would pass through the body from an
    // arbitrary side. Nudge the start direction sideways so the swing is deterministic (always the same way round).
    if (d0.dot(d1) < -0.9995) d0.x += 1e-3, d0.normalize();
    this.plan = {
      from: { position: from.position.clone(), target: from.target.clone() },
      to: { position: to.position.clone(), target: to.target.clone() },
      delay: o.delay, duration: Math.max(1, o.duration), start: o.now, token: o.token, onComplete: o.onComplete,
      q: new THREE.Quaternion().setFromUnitVectors(d0, d1), d0, r0, r1,
    };
  }

  cancel() { this.plan = null; }

  /** Writes the current pose into `out`. Returns true while a plan is driving the camera. */
  update(now: number, out: CameraPose): boolean {
    const p = this.plan;
    if (!p) return false;
    const raw = (now - p.start - p.delay) / p.duration;
    if (raw >= 1) {
      out.position.copy(p.to.position);
      out.target.copy(p.to.target);
      this.plan = null;
      p.onComplete();
      return true;
    }
    const t = easeInOutSine(Math.max(0, raw));
    out.target.lerpVectors(p.from.target, p.to.target, t);
    this.tmpQ.copy(CameraDirector.IDENTITY).slerp(p.q, t);
    this.tmpDir.copy(p.d0).applyQuaternion(this.tmpQ);
    out.position.copy(out.target).addScaledVector(this.tmpDir, p.r0 + (p.r1 - p.r0) * t);
    return true;
  }
}
