import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { DentitionType } from "@/lib/dental/fdi";
import type { ToothVisualState } from "@/lib/dental/types";
import { emptyVisualState } from "@/lib/dental/toothStates";
import { JawModel, JAW_ANGLE } from "./JawModel";
import type { ToothMeshProvider } from "./toothGeometry";
import { CameraDirector, type CameraPose } from "./cameraDirector";
import { InteractionMachine, type Mode, type PresetName, type Transition } from "./interactionMachine";
import { FOV, defaultPose, entrancePose, frameFromBox, presetPose, toothPose, type Framing } from "./cameraPlans";
import { buildDentitionConfig, type DentitionConfig } from "./dentitionConfig";

/**
 * DentalEngine — the ONE imperative 3D runtime for every dentition.
 *
 *   Dentition (permanent | primary | mixed) -> DentitionConfig -> current tooth set -> JawModel -> shared engine
 *
 * Camera, OrbitControls, raycasting, hover, selection, focus, labels, jaw animation and clinical overlays are shared:
 * switching dentition only swaps the JawModel (dim -> swap -> fade in + camera reframe to the new bounds).
 *
 * ONE selection pipeline: click, tooth finder, panel and double-click all call `selectTooth(fdi)`.
 * ONE authoritative camera transition at a time (CameraDirector), guarded by the InteractionMachine token.
 */
export interface EngineCallbacks {
  onSelect?: (fdi: string | null) => void;
  onHover?: (fdi: string | null, clientX: number, clientY: number) => void;
  onModeChange?: (mode: Mode) => void;
  onJawChange?: (angle: number) => void;
}

export interface EngineOptions {
  reducedMotion: boolean;
  dentition?: { type: DentitionType; current?: readonly string[] | null };
  renderer?: THREE.WebGLRenderer; // injectable for headless tests
  provider?: ToothMeshProvider; // injectable: placeholder now, GLB-backed later
  pixelRatioCap?: number;
}

export class DentalEngineError extends Error {
  constructor(public phase: "renderer" | "scene", message: string) {
    super(message);
    this.name = "DentalEngineError";
  }
}

const CLICK_SLOP_PX = 6;
const BG = 0x0b1e31; // matches the CSS studio backdrop, so distant geometry falls off into it

export class DentalEngine {
  model!: JawModel;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly fog = new THREE.Fog(BG, 1000, 2000);
  private readonly director = new CameraDirector();
  private readonly machine = new InteractionMachine();
  private readonly reduced: boolean;
  private readonly provider?: ToothMeshProvider;
  private readonly lights: Array<{ light: THREE.Light; base: number }> = [];
  private readonly labelLayer: HTMLDivElement;
  private readonly labelEls = new Map<string, HTMLDivElement>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly pose: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly ro: ResizeObserver | null;

  private dentition!: DentitionConfig;
  private framing!: Framing;
  private lastStates: Record<string, ToothVisualState> = {};
  private pendingSwap: { at: number; cfg: DentitionConfig; token: number } | null = null;

  private lastMs = 0;
  private startMs = 0;
  private time = 0;
  private disposed = false;

  private pickList: THREE.Object3D[] = [];
  private stateSig = new Map<string, string>();
  private pointerDirty = false;
  private pointerClient = { x: 0, y: 0 };
  private down: { x: number; y: number } | null = null;
  private hoverFdi: string | null = null;

  private gumEmph = 1;
  private gumTarget = 1;
  private fogAmt = 0;
  private fogTarget = 0;
  private labelsOn = false;
  private viewShift = 0;
  private viewShiftTarget = 0;
  private appliedShift = 0;

  private jaw: { angle: number; from: number; to: number; t0: number; dur: number } = {
    angle: JAW_ANGLE.default, from: JAW_ANGLE.default, to: JAW_ANGLE.default, t0: 0, dur: 0,
  };

  constructor(private container: HTMLElement, private cb: EngineCallbacks, opts: EngineOptions) {
    this.reduced = opts.reducedMotion;
    this.provider = opts.provider;
    try {
      this.renderer =
        opts.renderer ??
        new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (e) {
      throw new DentalEngineError("renderer", e instanceof Error ? e.message : "Could not create the WebGL renderer");
    }

    try {
      const w = Math.max(container.clientWidth, 1), h = Math.max(container.clientHeight, 1);
      this.renderer.setPixelRatio(Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, opts.pixelRatioCap ?? 2));
      this.renderer.setSize(w, h, false);
      this.renderer.setClearColor(0x000000, 0); // the CSS backdrop is the "premium navy" studio
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      const canvas = this.renderer.domElement;
      canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none";
      canvas.setAttribute("aria-label", "3D dental chart");
      container.appendChild(canvas);

      this.scene.fog = this.fog;
      this.camera = new THREE.PerspectiveCamera(FOV, w / h, 0.1, 120);
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.09;
      this.controls.enablePan = false; // can't lose the jaw
      this.controls.rotateSpeed = 0.7;
      this.controls.zoomSpeed = 0.8;
      this.controls.minDistance = 2.4;
      this.controls.minPolarAngle = 0.12; // never upside-down
      this.controls.maxPolarAngle = Math.PI - 0.12;

      this.buildLighting();

      this.labelLayer = document.createElement("div");
      this.labelLayer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none";
      container.appendChild(this.labelLayer);

      const d = opts.dentition ?? { type: "permanent" as DentitionType };
      this.mountModel(buildDentitionConfig(d.type, d.current ?? null), 1);

      const start = this.reduced ? this.defaultP() : entrancePose(this.framing, this.aspect());
      this.camera.position.copy(start.position);
      this.controls.target.copy(start.target);
      this.controls.update();

      canvas.addEventListener("pointermove", this.onPointerMove);
      canvas.addEventListener("pointerdown", this.onPointerDown);
      canvas.addEventListener("pointerup", this.onPointerUp);
      canvas.addEventListener("pointerleave", this.onPointerLeave);
      canvas.addEventListener("dblclick", this.onDblClick);

      this.ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.resize()) : null;
      this.ro?.observe(container);

      // Entrance: camera glides from farther away to the default view (250 -> ~1200ms).
      if (!this.reduced) {
        this.director.start(start, this.defaultP(), { delay: 250, duration: 950, token: -1, now: this.now(), onComplete: () => {} });
      }
      this.startMs = this.now();
      this.renderer.setAnimationLoop((t: number) => this.tick(t));
    } catch (e) {
      this.dispose();
      throw e instanceof DentalEngineError ? e : new DentalEngineError("scene", e instanceof Error ? e.message : "Could not build the 3D scene");
    }
  }

  // ------------------------------------------------------------------ public API
  get mode(): Mode { return this.machine.mode; }
  get selectedFdi(): string | null { return this.machine.selectedFdi; }
  get jawAngle(): number { return this.jaw.angle; }
  get dentitionKey(): string { return this.pendingSwap ? this.pendingSwap.cfg.key : this.dentition.key; }
  get dentitionType(): DentitionType { return (this.pendingSwap ? this.pendingSwap.cfg : this.dentition).type; }
  hasTooth(fdi: string): boolean { return this.model.teeth.has(fdi); }
  teethFdis(): string[] { return Array.from(this.model.teeth.keys()); }
  debug() {
    return { mode: this.machine.mode, selected: this.machine.selectedFdi, token: this.machine.token, moving: this.director.active,
      position: this.camera.position.clone(), target: this.controls.target.clone(), dentition: this.dentition.key, pendingSwap: !!this.pendingSwap };
  }

  /** THE tooth-selection pipeline (mouse, finder, panel, double-click). Returns false for a tooth not in the current jaw. */
  selectTooth(fdi: string): boolean {
    if (this.pendingSwap || !this.model.teeth.has(fdi)) return false;
    const t = this.machine.dispatch({ type: "SELECT", fdi });
    if (t) this.run(t);
    return true;
  }
  focusSelected() { if (this.pendingSwap) return; const t = this.machine.dispatch({ type: "FOCUS" }); if (t) this.run(t); }
  /** Back to full jaw (also the panel's close / Reset). */
  backToJaw() { if (this.pendingSwap) return; const t = this.machine.dispatch({ type: "BACK" }); if (t) this.run(t); }
  resetView() { this.backToJaw(); }
  setPreset(name: PresetName) {
    if (this.pendingSwap) return;
    if (name === "upper" || name === "lower") this.animateJaw(JAW_ANGLE.open); // open enough to inspect the arch
    const t = this.machine.dispatch({ type: "PRESET", name });
    if (t) this.run(t);
  }
  setJawOpen(open: boolean) { this.animateJaw(open ? JAW_ANGLE.open : JAW_ANGLE.closed); }
  setFdiLabels(on: boolean) { this.labelsOn = on; }
  /** Horizontal composition offset (px) so the subject sits left of the side panel. */
  setViewShift(px: number) { this.viewShiftTarget = px; }

  /** Apply derived clinical state to the 3D teeth (keyed by FDI). Unchanged teeth are skipped. */
  setToothStates(states: Record<string, ToothVisualState>) {
    this.lastStates = states;
    this.applyStates();
  }

  /**
   * Switch dentition. Permanent / Primary / Mixed all live in this ONE engine:
   *   0–250ms   current jaw dims
   *   250ms     model is swapped (old one fully disposed — no duplicate meshes / raycast targets)
   *   250–650ms new jaw fades in while the camera reframes to the NEW bounds
   * A newer request supersedes a pending one. No spinning, no flying teeth, no camera teleport.
   */
  setDentition(type: DentitionType, current?: readonly string[] | null) {
    const cfg = buildDentitionConfig(type, current ?? null);
    if (cfg.key === this.dentitionKey) return;
    const t = this.machine.dispatch({ type: "DENTITION" });
    if (!t) return;
    this.clearHover();
    this.model.teeth.forEach((v) => { v.setSelected(false); v.setHero(0); v.setEmphasisTarget(0.12); });
    this.gumTarget = 0.12;
    this.fogTarget = 0;
    const k = this.reduced ? 0.02 : 1;
    this.pendingSwap = { at: (this.lastMs || this.now()) + 250 * k, cfg, token: t.token };
    this.cb.onModeChange?.(this.machine.mode);
    this.cb.onSelect?.(null);
  }

  // ------------------------------------------------------------------ model lifecycle
  private aspect() { return Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1); }
  private defaultP() { return defaultPose(this.framing, this.aspect()); }

  private mountModel(cfg: DentitionConfig, initialEmph: number) {
    const m = new JawModel(cfg, this.provider);
    m.setJawAngle(JAW_ANGLE.default);
    m.root.updateMatrixWorld(true);
    this.framing = frameFromBox(new THREE.Box3().setFromObject(m.root)); // bounds at the default opening
    m.setJawAngle(this.jaw.angle);
    m.teeth.forEach((v) => v.setEmphasisNow(initialEmph));
    this.scene.add(m.root);
    this.model = m;
    this.dentition = cfg;
    this.stateSig.clear();
    this.applyStates();
    this.refreshPickList();
    this.controls.maxDistance = Math.max(24, this.framing.halfH * 8);
  }

  private performSwap() {
    const p = this.pendingSwap;
    if (!p) return;
    this.pendingSwap = null;
    this.director.cancel();
    const old = this.model;
    this.scene.remove(old.root);
    old.dispose(); // frees per-tooth materials + gingiva; shared cached tooth geometry is reused by the new model
    this.labelEls.forEach((el) => el.remove());
    this.labelEls.clear();
    this.mountModel(p.cfg, 0.12);
    this.gumEmph = 0.12;
    this.gumTarget = 1;
    this.applyEmphasis(); // -> everything fades up to full emphasis
    const k = this.reduced ? 0.02 : 1;
    this.director.start(this.currentPose(), this.defaultP(), {
      delay: 0, duration: 450 * k, token: p.token, now: this.lastMs || this.now(), onComplete: () => this.complete(p.token),
    });
  }

  private applyStates() {
    this.model.teeth.forEach((v, fdi) => {
      const s = this.lastStates[fdi] ?? emptyVisualState();
      const sig = JSON.stringify(s);
      if (this.stateSig.get(fdi) === sig) return;
      this.stateSig.set(fdi, sig);
      v.applyState(s);
    });
    this.refreshPickList();
  }

  // ------------------------------------------------------------------ transitions
  private now() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }

  private currentPose(): CameraPose {
    return { position: this.camera.position.clone(), target: this.controls.target.clone() };
  }

  private poseFor(t: Transition): { pose: CameraPose; delay: number; duration: number } {
    switch (t.kind) {
      case "select": return { pose: this.toothPoseFor(t.selectedFdi!, "select"), delay: 150, duration: 700 };
      case "focus": return { pose: this.toothPoseFor(t.selectedFdi!, "focus"), delay: 100, duration: 600 };
      case "back": return { pose: this.defaultP(), delay: 0, duration: 800 };
      case "preset": return { pose: presetPose(t.preset!, this.framing, this.aspect()), delay: 0, duration: 900 };
      case "dentition": return { pose: this.defaultP(), delay: 0, duration: 450 };
    }
  }

  private toothPoseFor(fdi: string, kind: "select" | "focus"): CameraPose {
    const v = this.model.teeth.get(fdi)!;
    return toothPose(kind, {
      center: v.focusCenter(new THREE.Vector3()), nx: v.nx, nz: v.nz,
      jaw: v.meta.jaw, tip: v.dims.tip, w: v.dims.w,
    });
  }

  private run(t: Transition) {
    // This supersedes any running move: the director keeps one plan, the machine invalidates old tokens.
    this.model.teeth.forEach((v) => v.setSelected(v.fdi === this.machine.selectedFdi));
    this.applyEmphasis();
    this.controls.minDistance = this.machine.isFocusing ? 1.6 : 2.4;
    const { pose, delay, duration } = this.poseFor(t);
    const k = this.reduced ? 0.02 : 1;
    this.director.start(this.currentPose(), pose, {
      delay: delay * k, duration: duration * k, token: t.token, now: this.lastMs || this.now(),
      onComplete: () => this.complete(t.token),
    });
    this.cb.onModeChange?.(this.machine.mode);
    this.cb.onSelect?.(this.machine.selectedFdi);
  }

  private complete(token: number) {
    const m = this.machine.complete(token);
    if (m) this.cb.onModeChange?.(m);
  }

  /**
   * HERO composition. Selected tooth = 100% and (with the camera framing) becomes the visual hero; the COMPLETE jaw stays
   * behind it, darker + desaturated, and fades into the studio backdrop with distance. Selected ≈ 45% / Focus ≈ 25%.
   */
  private applyEmphasis() {
    const sel = this.machine.selectedFdi;
    const focusing = this.machine.isFocusing;
    const others = sel === null ? 1 : focusing ? 0.25 : 0.45;
    this.model.teeth.forEach((v) => {
      const isSel = v.fdi === sel;
      v.setEmphasisTarget(sel === null || isSel ? 1 : others);
      v.setHero(isSel ? (focusing ? 2 : 1) : 0);
    });
    this.gumTarget = sel === null ? 1 : focusing ? 0.25 : 0.42;
    this.fogTarget = sel === null ? 0 : focusing ? 1 : 0.6;
  }

  private animateJaw(to: number) {
    this.jaw.from = this.jaw.angle;
    this.jaw.to = to;
    this.jaw.t0 = this.lastMs || this.now();
    this.jaw.dur = (this.reduced ? 20 : 700);
    this.cb.onJawChange?.(to);
  }

  // ------------------------------------------------------------------ per-frame
  /** Public so tests (and the animation loop) drive the exact same code path. */
  tick(nowMs: number) {
    if (this.disposed) return;
    const dt = this.lastMs ? Math.min(0.05, Math.max(0, (nowMs - this.lastMs) / 1000)) : 0.016;
    this.lastMs = nowMs;
    this.time += dt;
    const k = (rate: number) => 1 - Math.exp(-dt * rate);

    if (this.pendingSwap && nowMs >= this.pendingSwap.at) this.performSwap();

    if (this.director.update(nowMs, this.pose)) {
      this.camera.position.copy(this.pose.position);
      this.controls.target.copy(this.pose.target);
    }
    this.controls.enabled = !this.director.active;
    this.controls.update();

    // Open / close jaw: rotate the lower jaw as one rigid group around the posterior hinge.
    if (this.jaw.angle !== this.jaw.to) {
      const r = Math.min(1, (nowMs - this.jaw.t0) / this.jaw.dur);
      const e = r < 0.5 ? 2 * r * r : 1 - Math.pow(-2 * r + 2, 2) / 2;
      this.jaw.angle = r >= 1 ? this.jaw.to : this.jaw.from + (this.jaw.to - this.jaw.from) * e;
      this.model.setJawAngle(this.jaw.angle);
    }

    // Lighting "settles" (600–1400ms after start).
    const ls = this.reduced ? 1 : Math.min(1, Math.max(0, (nowMs - this.startMs - 600) / 800));
    const lightK = 0.55 + 0.45 * (ls * ls * (3 - 2 * ls));
    for (const l of this.lights) l.light.intensity = l.base * lightK;

    this.gumEmph += (this.gumTarget - this.gumEmph) * k(9);
    this.model.gingivaMat.color.setScalar(this.gumEmph);

    // Depth falloff: geometry BEHIND the orbit target fades toward the backdrop (0 in full-jaw view).
    this.fogAmt += (this.fogTarget - this.fogAmt) * k(6);
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.fog.near = dist + 0.4;
    this.fog.far = this.fog.near + 400 * Math.pow((this.machine.isFocusing ? 6 : 10) / 400, this.fogAmt);

    this.viewShift += (this.viewShiftTarget - this.viewShift) * k(6);
    this.applyViewOffset();

    if (this.pointerDirty) { this.pointerDirty = false; this.updateHover(); }
    this.model.teeth.forEach((v) => v.update(dt, this.time, this.reduced));
    this.camera.updateMatrixWorld();
    this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  }

  private applyViewOffset() {
    const rounded = Math.round(this.viewShift * 10) / 10;
    if (rounded === this.appliedShift) return;
    this.appliedShift = rounded;
    const w = Math.max(this.container.clientWidth, 1), h = Math.max(this.container.clientHeight, 1);
    if (Math.abs(rounded) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, rounded, 0, w, h); // shifts the image LEFT by `rounded` px
    this.camera.updateProjectionMatrix();
  }

  private resize() {
    if (this.disposed) return;
    const w = Math.max(this.container.clientWidth, 1), h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.appliedShift = NaN; // force the view offset to be re-applied for the new size
    this.applyViewOffset();
  }

  // ------------------------------------------------------------------ picking
  private refreshPickList() {
    const list: THREE.Object3D[] = [];
    this.model.teeth.forEach((v) => v.pickTargets().forEach((o) => list.push(o)));
    this.pickList = list;
  }

  private pick(): string | null {
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickList, false)[0];
    return hit ? (hit.object.userData.fdi as string) : null;
  }

  private setNdc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.pointerClient = { x: e.clientX, y: e.clientY };
  }

  private clearHover() {
    if (this.hoverFdi) { this.model.teeth.get(this.hoverFdi)?.setHover(false); this.hoverFdi = null; this.cb.onHover?.(null, 0, 0); }
    this.renderer.domElement.style.cursor = "";
  }

  private updateHover() {
    if (this.pendingSwap) return;
    const fdi = this.pick();
    if (fdi !== this.hoverFdi) {
      if (this.hoverFdi) this.model.teeth.get(this.hoverFdi)?.setHover(false);
      if (fdi) this.model.teeth.get(fdi)?.setHover(true);
      this.hoverFdi = fdi;
      this.renderer.domElement.style.cursor = fdi ? "pointer" : "";
    }
    this.cb.onHover?.(fdi, this.pointerClient.x, this.pointerClient.y);
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.buttons !== 0) return; // dragging = orbiting, not hovering
    this.setNdc(e);
    this.pointerDirty = true;
  };
  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
    this.clearHover();
  };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return; // a drag, not a click
    this.setNdc(e);
    const fdi = this.pick();
    if (fdi) this.selectTooth(fdi);
  };
  private onPointerLeave = () => this.clearHover();
  private onDblClick = (e: MouseEvent) => {
    this.setNdc(e as PointerEvent);
    const fdi = this.pick();
    if (fdi) { this.selectTooth(fdi); this.focusSelected(); }
  };

  // ------------------------------------------------------------------ labels
  private updateLabels() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const sel = this.machine.selectedFdi;
    const cam = this.camera.position;
    this.model.teeth.forEach((v, fdi) => {
      const isSel = fdi === sel;
      let el = this.labelEls.get(fdi);
      if (!this.labelsOn && !isSel) { if (el && el.style.display !== "none") el.style.display = "none"; return; }
      v.labelAnchor(this.tmpA);
      // hide labels on teeth facing away from the camera (reduces overlap clutter) — never the selected one
      v.group.getWorldPosition(this.tmpB);
      const facing = v.nx * (cam.x - this.tmpB.x) + v.nz * (cam.z - this.tmpB.z);
      this.tmpA.project(this.camera);
      if (!isSel && (facing < -0.5 || this.tmpA.z > 1)) { if (el) el.style.display = "none"; return; }
      if (!el) {
        el = document.createElement("div");
        el.textContent = fdi;
        this.labelLayer.appendChild(el);
        this.labelEls.set(fdi, el);
      }
      el.style.cssText = isSel
        ? "position:absolute;left:0;top:0;padding:2px 8px;border-radius:9px;background:#4FC3B8;color:#06263F;font:600 12px/1.3 ui-monospace,monospace;box-shadow:0 2px 10px rgba(0,0,0,.35);z-index:2;white-space:nowrap"
        : "position:absolute;left:0;top:0;padding:1px 5px;border-radius:7px;background:rgba(8,26,43,.62);color:#CFE9F2;font:500 10px/1.3 ui-monospace,monospace;white-space:nowrap";
      const px = (this.tmpA.x * 0.5 + 0.5) * w, py = (-this.tmpA.y * 0.5 + 0.5) * h;
      el.style.transform = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px) translate(-50%,-50%)`;
    });
  }

  // ------------------------------------------------------------------ lighting
  private buildLighting() {
    const add = <T extends THREE.Light>(l: T) => { this.scene.add(l); this.lights.push({ light: l, base: l.intensity }); return l; };
    // KEY: upper-front, warm.  FILL: opposite side, cool & soft.  RIM: rear/side to separate the arch from the backdrop.
    const key = add(new THREE.DirectionalLight(0xfff1e0, 2.8)); key.position.set(5, 9, 9);
    const fill = add(new THREE.DirectionalLight(0xbcd7ff, 1.0)); fill.position.set(-7, 3, 6);
    const rim = add(new THREE.DirectionalLight(0xa9d3ff, 1.8)); rim.position.set(-2, 5, -11);
    const rim2 = add(new THREE.DirectionalLight(0xa9d3ff, 0.9)); rim2.position.set(6, 2, -9);
    add(new THREE.HemisphereLight(0xdde8f4, 0x1a2230, 0.9));
    try { // soft studio reflections for the enamel (no external assets)
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch { /* environment is a nicety; lighting still works without it */ }
  }

  // ------------------------------------------------------------------ teardown
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.renderer.setAnimationLoop(null);
      this.ro?.disconnect();
      const c = this.renderer.domElement;
      c.removeEventListener("pointermove", this.onPointerMove);
      c.removeEventListener("pointerdown", this.onPointerDown);
      c.removeEventListener("pointerup", this.onPointerUp);
      c.removeEventListener("pointerleave", this.onPointerLeave);
      c.removeEventListener("dblclick", this.onDblClick);
      this.controls?.dispose();
      this.model?.dispose();
      this.scene.environment?.dispose();
      this.renderer.dispose();
      c.remove();
      this.labelLayer?.remove();
    } catch { /* teardown must never throw */ }
  }
}
