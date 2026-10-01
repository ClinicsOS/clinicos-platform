import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { SurfaceId } from "@/lib/derm/regions";
import type { BodyAsset, CameraState, Facing, MarkerPoint, RenderQuality, ViewMode } from "./types";
import { QUALITY_PIXEL_RATIO } from "./webgl";
import { CameraDirector, type CameraPose } from "./cameraDirector";
import { InteractionMachine, type Transition } from "./interactionMachine";
import { FOV, constraintsFor, entrancePose, focusPose, limitsFor, multiFocusKey, overviewPose, parseFocusKey } from "./cameraPlans";
import { markerWorldPosition, toNormalized } from "./markers";
import { pickRegion } from "./picking";
import { LOOK_HOVER, LOOK_IDLE, LOOK_PLACING, LOOK_SELECTED, makeMarkerTexture, makeOverlayMaterial, type OverlayLook } from "./overlay";

/**
 * DermEngine — the ONE imperative 3D runtime of the dermatology clinical map.
 *
 *   BodyAsset (procedural preview OR production GLB)  ->  region overlays / picking / markers / camera
 *
 * The engine knows only REGISTRY IDS. It never sees a mesh name. React owns the clinical state (selection, history,
 * markers) and pushes it in with `setSelection / setHistory / setMarkers`; the engine reports intents back through the
 * callbacks. ONE scripted camera transition at a time (CameraDirector), guarded by the InteractionMachine token.
 */
export interface HistoryCounts { dermatology: number; aesthetic: number }
export interface StoredMarker extends MarkerPoint { id: string }

export interface CameraSnapshot {
  state: CameraState;
  view: ViewMode;
  facing: Facing;
  focusRegionId: string | null;
  focusSurface: SurfaceId | null;
}

export interface EngineCallbacks {
  /** A region was clicked / tapped. `additive` = Shift / Ctrl / Cmd held. */
  onPick?: (regionId: string, additive: boolean) => void;
  /** A click that hit no region (empty space or an unmapped part of the body). */
  onPickNone?: (additive: boolean) => void;
  onHover?: (regionId: string | null, clientX: number, clientY: number) => void;
  onCameraState?: (s: CameraSnapshot) => void;
  /** Marker-placement mode: the user clicked a point inside the region being annotated. */
  onMarkerPlace?: (m: MarkerPoint) => void;
  /** The GPU context was lost (tab in background on low-memory devices etc.): the page must fall back. */
  onContextLost?: () => void;
}

export interface EngineOptions {
  reducedMotion: boolean;
  asset: BodyAsset;
  view?: ViewMode;
  renderer?: THREE.WebGLRenderer; // injectable for headless tests
  /** Adaptive quality (default "high"): lowers the pixel ratio and skips environment-map generation on phones. */
  quality?: RenderQuality;
  /** Localised accessible name of the canvas (the page passes the translated string). */
  ariaLabel?: string;
  pixelRatioCap?: number;
}

export class DermEngineError extends Error {
  constructor(public phase: "renderer" | "scene", message: string) {
    super(message);
    this.name = "DermEngineError";
  }
}

const CLICK_SLOP_PX = 6;
const BADGE_SCALE = 0.026;
const MARKER_SCALE = 0.03;
const PENDING_SCALE = 0.042;

interface Overlay {
  regionId: string;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  cur: OverlayLook;
  tgt: OverlayLook;
}

export class DermEngine {
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private asset!: BodyAsset;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly director = new CameraDirector();
  private readonly machine = new InteractionMachine();
  private readonly reduced: boolean;
  private readonly quality: RenderQuality;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly pose: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  private readonly ro: ResizeObserver | null;
  private readonly lights: Array<{ light: THREE.Light; base: number }> = [];
  private readonly markerGroup = new THREE.Group();
  private readonly tex = { circle: makeMarkerTexture("circle"), diamond: makeMarkerTexture("diamond"), ring: makeMarkerTexture("ring") };
  private readonly panBox = new THREE.Box3();

  private overlays = new Map<string, Overlay>();
  private pickList: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private skinOriginal = new Map<THREE.Material, THREE.Color>();
  private markerSprites: THREE.Sprite[] = [];

  private selection = new Set<string>();
  private history: Record<string, HistoryCounts> = {};
  private markers: StoredMarker[] = [];
  private pending: MarkerPoint | null = null;
  private placingRegion: string | null = null;
  private focusSurface: SurfaceId | null = null;

  private view: ViewMode;
  private skinEmph = 1;
  private userMoved = false;
  private lastMs = 0;
  private startMs = 0;
  private disposed = false;
  private hoverId: string | null = null;
  private pointerDirty = false;
  private pointerClient = { x: 0, y: 0 };
  private down: { x: number; y: number } | null = null;
  private lastSnapshot = "";

  constructor(private container: HTMLElement, private cb: EngineCallbacks, opts: EngineOptions) {
    this.reduced = opts.reducedMotion;
    this.quality = opts.quality ?? "high";
    this.view = opts.view ?? "body";
    try {
      this.renderer =
        opts.renderer ?? new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (e) {
      throw new DermEngineError("renderer", e instanceof Error ? e.message : "Could not create the WebGL renderer");
    }
    try {
      const w = Math.max(container.clientWidth, 1), h = Math.max(container.clientHeight, 1);
      this.renderer.setPixelRatio(Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, opts.pixelRatioCap ?? QUALITY_PIXEL_RATIO[this.quality]));
      this.renderer.setSize(w, h, false);
      this.renderer.setClearColor(0x000000, 0); // the CSS backdrop is the studio background
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.02;
      const canvas = this.renderer.domElement;
      canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
      canvas.setAttribute("aria-label", opts.ariaLabel ?? "3D clinical body map");
      canvas.setAttribute("role", "img");
      canvas.tabIndex = 0; // keyboard access: arrow keys pan the view (OrbitControls key events); focus ring comes from the page CSS
      container.appendChild(canvas);

      this.camera = new THREE.PerspectiveCamera(FOV, w / h, 0.05, 40);
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.09;
      this.controls.enablePan = true;
      this.controls.screenSpacePanning = true;
      this.controls.rotateSpeed = 0.7;
      this.controls.zoomSpeed = 0.8;
      this.controls.panSpeed = 0.7;
      this.controls.minPolarAngle = 0.1;
      this.controls.maxPolarAngle = Math.PI - 0.1;
      this.controls.addEventListener("start", this.onUserStart);
      this.controls.listenToKeyEvents(canvas as unknown as HTMLElement);

      this.scene.add(this.markerGroup);
      this.buildLighting();
      this.mountAsset(opts.asset);

      const first = this.machine.dispatch({ type: "ENTER", view: this.view });
      const start = this.reduced ? this.poseFor(first!) : entrancePose(this.asset, this.view, this.aspect());
      this.camera.position.copy(start.position);
      this.controls.target.copy(start.target);
      this.controls.update();
      if (!this.reduced) {
        this.director.start(start, this.poseFor(first!), {
          delay: 250, duration: 1000, token: first!.token, now: this.now(), onComplete: () => this.complete(first!.token),
        });
      } else this.complete(first!.token);

      canvas.addEventListener("pointermove", this.onPointerMove);
      canvas.addEventListener("pointerdown", this.onPointerDown);
      canvas.addEventListener("pointerup", this.onPointerUp);
      canvas.addEventListener("pointercancel", this.onPointerCancel);
      canvas.addEventListener("pointerleave", this.onPointerLeave);
      canvas.addEventListener("webglcontextlost", this.onContextLost);

      this.ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.resize()) : null;
      this.ro?.observe(container);
      this.startMs = this.now();
      this.emitCamera();
      this.renderer.setAnimationLoop((t: number) => this.tick(t));
    } catch (e) {
      this.dispose();
      throw e instanceof DermEngineError ? e : new DermEngineError("scene", e instanceof Error ? e.message : "Could not build the 3D scene");
    }
  }

  // ------------------------------------------------------------------ public API
  get camState(): CameraSnapshot { return this.snapshot(); }
  get assetSource() { return this.asset.source; }
  get assetKey() { return this.asset.key; }
  hasRegion(id: string) { return this.asset.regions.has(id); }
  regionIds(): string[] { return Array.from(this.asset.regions.keys()); }
  debug() {
    return {
      state: this.machine.state, view: this.machine.view, facing: this.machine.facing, token: this.machine.token,
      moving: this.director.active, selection: Array.from(this.selection), hover: this.hoverId,
      position: this.camera.position.clone(), target: this.controls.target.clone(), skinEmph: this.skinEmph, quality: this.quality,
    };
  }

  /** Replaces the selected set (registry ids). Unknown / unmapped ids are ignored. */
  setSelection(ids: readonly string[]) {
    this.selection = new Set(ids.filter((id) => this.asset.regions.has(id)));
    this.refreshLooks();
  }

  /** Assessment counts per region -> neutral history badges (no severity colour, same size regardless of the count). */
  setHistory(h: Record<string, HistoryCounts>) { this.history = h; this.rebuildMarkers(); }
  /** Precise stored markers (region-aabb/v1 coordinates) -> ring sprites snapped to this asset's surface. */
  setMarkers(m: StoredMarker[]) { this.markers = m; this.rebuildMarkers(); }
  /** The marker being placed right now (null clears it). */
  setPendingMarker(m: MarkerPoint | null) { this.pending = m; this.rebuildMarkers(); }
  /** Marker-placement mode: clicks inside `regionId` place a marker instead of selecting. `null` leaves the mode. */
  setMarkerPlacement(regionId: string | null) {
    this.placingRegion = regionId && this.asset.regions.has(regionId) ? regionId : null;
    if (!this.placingRegion) this.pending = null;
    this.renderer.domElement.style.cursor = this.placingRegion ? "crosshair" : "";
    this.refreshLooks();
    this.rebuildMarkers();
  }

  setView(view: ViewMode) {
    this.view = view;
    // Already there (e.g. the React layer re-asserting the view it mounted with): never cancel a glide that is heading to it.
    if (view === this.machine.view && this.machine.focusRegionId === null && this.machine.facing === "front" && !this.userMoved) return;
    const t = this.machine.dispatch({ type: "VIEW", view });
    if (t) this.run(t);
  }
  setFacing(facing: Facing) {
    if (facing === "top" && this.machine.view !== "scalp") return; // `top` is a Scalp-view preset only
    const t = this.machine.dispatch({ type: "FACE", facing });
    if (t) this.run(t);
  }
  resetView() { const t = this.machine.dispatch({ type: "RESET" }); if (t) this.run(t); }

  /** Smoothly frames one region (optionally one surface of it). False when this asset does not carry the region. */
  focusRegion(regionId: string, surface?: SurfaceId): boolean {
    if (!this.asset.regions.has(regionId)) return false;
    this.focusSurface = surface ?? null;
    const key = surface ? `${regionId}#${surface}` : regionId;
    const t = this.machine.dispatch({ type: "FOCUS", regionId: key });
    if (t) this.run(t);
    return true;
  }

  /**
   * Smoothly frames SEVERAL regions together (a multi-region treatment / follow-up). Regions this asset does not carry are
   * ignored; one region behaves exactly like focusRegion. False when none of them exists. Reuses the same camera director
   * and machine as every other move — no second camera path.
   */
  focusRegions(regionIds: readonly string[]): boolean {
    const present = Array.from(new Set(regionIds)).filter((id) => this.asset.regions.has(id));
    if (!present.length) return false;
    if (present.length === 1) return this.focusRegion(present[0]);
    this.focusSurface = null;
    const t = this.machine.dispatch({ type: "FOCUS", regionId: multiFocusKey(present) });
    if (t) this.run(t);
    return true;
  }

  /** Dolly in/out (`factor` < 1 = closer). Goes through the director so it cannot fight another move. */
  zoomBy(factor: number) {
    const from: CameraPose = { position: this.camera.position.clone(), target: this.controls.target.clone() };
    const off = from.position.clone().sub(from.target);
    const lim = limitsFor(this.asset);
    const d = Math.min(lim.maxDistance, Math.max(lim.minDistance, off.length() * factor));
    const to: CameraPose = { target: from.target.clone(), position: from.target.clone().addScaledVector(off.normalize(), d) };
    this.userMoved = true;
    const k = this.reduced ? 0.02 : 1;
    this.director.start(from, to, { delay: 0, duration: 280 * k, token: -1, now: this.lastMs || this.now(), onComplete: () => {} });
  }

  /** Swap the male/female (or procedural/GLB) asset. Selection, history and markers are kept — they are keyed by registry id. */
  setAsset(asset: BodyAsset) {
    if (this.disposed) { asset.dispose(); return; }
    const focusKey = this.machine.focusRegionId;
    this.director.cancel();
    this.unmountAsset();
    this.mountAsset(asset);
    this.userMoved = false;
    const t = this.machine.dispatch({ type: "ENTER", view: this.view });
    if (t) this.run(t);
    if (focusKey) {
      const { ids, surface } = parseFocusKey(focusKey);
      if (ids.length > 1) this.focusRegions(ids); else this.focusRegion(ids[0], surface);
    }
  }

  // ------------------------------------------------------------------ asset lifecycle
  private aspect() { return Math.max(this.container.clientWidth, 1) / Math.max(this.container.clientHeight, 1); }

  private mountAsset(asset: BodyAsset) {
    this.asset = asset;
    this.scene.add(asset.root);
    this.mountGroundShadow(asset);
    // Overlays: one mesh per region, sharing the region's geometry (owned by the asset).
    this.overlays.clear();
    const list: THREE.Object3D[] = [];
    asset.regions.forEach((surf, id) => {
      const mat = makeOverlayMaterial();
      const mesh = new THREE.Mesh(surf.geometry, mat);
      mesh.userData.regionId = id;
      mesh.visible = false;
      mesh.renderOrder = 3;
      mesh.matrixAutoUpdate = false;
      surf.parent.add(mesh);
      this.overlays.set(id, { regionId: id, mesh, mat, cur: { ...LOOK_IDLE }, tgt: { ...LOOK_IDLE } });
      list.push(mesh);
    });
    this.pickList = list;
    // Occluders: the visible skin (anything that is not one of our overlays).
    const occ: THREE.Object3D[] = [];
    this.skinOriginal.clear();
    asset.root.traverse((o) => {
      const m = o as THREE.Mesh;
      // Decoration (hair…) is drawn but must never block a region pick, or hair could make the scalp unselectable.
      if (m.isMesh && !m.userData.regionId && m.visible && !m.userData.noOcclude) occ.push(m);
    });
    this.occluders = occ;
    asset.skinMaterials.forEach((mat) => {
      const c = (mat as THREE.MeshStandardMaterial).color;
      if (c) this.skinOriginal.set(mat, c.clone());
    });
    const lim = limitsFor(asset);
    this.controls.minDistance = lim.minDistance;
    this.controls.maxDistance = lim.maxDistance;
    this.panBox.copy(asset.bounds).expandByScalar(0.25);
    this.selection = new Set(Array.from(this.selection).filter((id) => asset.regions.has(id)));
    if (this.placingRegion && !asset.regions.has(this.placingRegion)) this.placingRegion = null;
    this.hoverId = null;
    this.refreshLooks(true);
    this.rebuildMarkers();
  }

  /**
   * Grounding: a very soft contact shadow on the floor (radial-gradient decal, no shadow maps, no room). It sits OUTSIDE the
   * asset root, is never a pick occluder, and is rebuilt per asset so it matches the model's stance.
   */
  private groundShadow: THREE.Mesh | null = null;
  private mountGroundShadow(asset: BodyAsset) {
    this.unmountGroundShadow();
    try {
      const size = asset.bounds.getSize(new THREE.Vector3());
      const c = document.createElement("canvas"); c.width = 128; c.height = 128;
      const g = c.getContext("2d");
      if (!g) return;
      const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
      grad.addColorStop(0, "rgba(0,0,0,0.5)"); grad.addColorStop(0.45, "rgba(0,0,0,0.26)"); grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
      const tex = new THREE.CanvasTexture(c);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.rotation.x = -Math.PI / 2;
      const w = Math.max(0.55, Math.min(size.x, 0.62) * 1.5), d = Math.max(0.4, Math.min(size.z, 0.34) * 2.0);
      mesh.scale.set(w, d, 1);
      mesh.position.set(0, 0.002, 0.03);
      mesh.renderOrder = -1;
      mesh.raycast = () => {}; // never blocks a pick
      this.scene.add(mesh);
      this.groundShadow = mesh;
    } catch { /* grounding is a nicety */ }
  }
  private unmountGroundShadow() {
    const m = this.groundShadow;
    if (!m) return;
    m.removeFromParent();
    (m.material as THREE.MeshBasicMaterial).map?.dispose();
    (m.material as THREE.Material).dispose();
    m.geometry.dispose();
    this.groundShadow = null;
  }

  private unmountAsset() {
    this.unmountGroundShadow();
    this.overlays.forEach((o) => { o.mesh.removeFromParent(); o.mat.dispose(); });
    this.overlays.clear();
    this.clearSprites();
    this.scene.remove(this.asset.root);
    this.asset.dispose();
  }

  // ------------------------------------------------------------------ region looks
  private lookFor(id: string): OverlayLook {
    if (this.selection.has(id)) return LOOK_SELECTED;
    if (this.placingRegion === id) return LOOK_PLACING;
    if (this.hoverId === id && !this.placingRegion) return LOOK_HOVER;
    return LOOK_IDLE;
  }

  private refreshLooks(instant = false) {
    this.overlays.forEach((o) => {
      o.tgt = { ...this.lookFor(o.regionId) };
      if (instant || this.reduced) o.cur = { ...o.tgt };
    });
  }

  private stepLooks(k: number) {
    this.overlays.forEach((o) => {
      const c = o.cur, t = o.tgt;
      if (c.fill === t.fill && c.outline === t.outline && c.hatch === t.hatch) return;
      const f = (a: number, b: number) => (Math.abs(b - a) < 0.004 ? b : a + (b - a) * k);
      c.fill = f(c.fill, t.fill); c.outline = f(c.outline, t.outline); c.hatch = f(c.hatch, t.hatch);
      const u = o.mat.uniforms;
      u.uFill.value = c.fill; u.uOutline.value = c.outline; u.uHatch.value = c.hatch;
      o.mesh.visible = c.fill > 0.003 || c.outline > 0.003;
    });
  }

  // ------------------------------------------------------------------ markers / history sprites
  private clearSprites() {
    this.markerSprites.forEach((s) => { s.removeFromParent(); (s.material as THREE.SpriteMaterial).dispose(); });
    this.markerSprites = [];
  }

  private addSprite(tex: THREE.Texture, pos: THREE.Vector3, scale: number, order: number) {
    const mat = new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: true, depthWrite: false, transparent: true, toneMapped: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos);
    s.scale.set(scale, scale, 1);
    s.renderOrder = order;
    s.raycast = () => {}; // sprites are never pickable
    this.markerGroup.add(s);
    this.markerSprites.push(s);
  }

  private rebuildMarkers() {
    this.clearSprites();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [id, c] of Object.entries(this.history)) {
      const surf = this.asset.regions.get(id);
      if (!surf || (c.dermatology <= 0 && c.aesthetic <= 0)) continue;
      const base = surf.center.clone().addScaledVector(surf.normal, 0.008);
      const tangent = new THREE.Vector3().crossVectors(surf.normal, up);
      if (tangent.lengthSq() < 1e-6) tangent.set(1, 0, 0);
      tangent.normalize();
      const both = c.dermatology > 0 && c.aesthetic > 0;
      // Same size for every region regardless of how many records: the badge says "there is history here", never "how bad".
      if (c.dermatology > 0) this.addSprite(this.tex.circle, both ? base.clone().addScaledVector(tangent, -0.011) : base, BADGE_SCALE, 5);
      if (c.aesthetic > 0) this.addSprite(this.tex.diamond, both ? base.clone().addScaledVector(tangent, 0.011) : base, BADGE_SCALE, 5);
    }
    for (const m of this.markers) {
      const surf = this.asset.regions.get(m.regionId);
      if (surf) this.addSprite(this.tex.ring, markerWorldPosition(surf, m), MARKER_SCALE, 6);
    }
    if (this.pending) {
      const surf = this.asset.regions.get(this.pending.regionId);
      if (surf) this.addSprite(this.tex.ring, markerWorldPosition(surf, this.pending), PENDING_SCALE, 7);
    }
  }

  // ------------------------------------------------------------------ camera
  private now() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }
  private currentPose(): CameraPose { return { position: this.camera.position.clone(), target: this.controls.target.clone() }; }

  private poseFor(t: Transition): CameraPose {
    if (t.kind === "focus" && t.focusRegionId) {
      const p = focusPose(this.asset, t.focusRegionId, this.aspect());
      if (p) return p;
    }
    return overviewPose(this.asset, t.view, t.facing, this.aspect());
  }

  private timing(t: Transition): { delay: number; duration: number } {
    switch (t.kind) {
      case "enter": return { delay: 0, duration: 650 };
      case "view": return { delay: 0, duration: 850 };
      case "facing": return { delay: 0, duration: 800 };
      case "focus": return { delay: 60, duration: 750 };
      case "reset": return { delay: 0, duration: 750 };
    }
  }

  private run(t: Transition) {
    this.userMoved = false;
    const { delay, duration } = this.timing(t);
    const k = this.reduced ? 0.02 : 1;
    // Position AND orbit target are always driven together. A newer intent supersedes the running plan (the director
    // keeps ONE plan; the machine invalidates the old token), so rapid clicks can never leave a stale completion behind.
    this.director.start(this.currentPose(), this.poseFor(t), {
      delay: delay * k, duration: duration * k, token: t.token, now: this.lastMs || this.now(), onComplete: () => this.complete(t.token),
    });
    this.emitCamera();
  }

  private complete(token: number) {
    if (this.machine.complete(token)) this.emitCamera();
  }

  private snapshot(): CameraSnapshot {
    const key = this.machine.focusRegionId;
    const [id, surf] = key ? key.split("#") : [null, undefined];
    return { state: this.machine.state, view: this.machine.view, facing: this.machine.facing, focusRegionId: id, focusSurface: (surf as SurfaceId) || null };
  }

  private emitCamera() {
    const s = this.snapshot();
    const sig = JSON.stringify(s);
    if (sig === this.lastSnapshot) return;
    this.lastSnapshot = sig;
    this.cb.onCameraState?.(s);
  }

  private onUserStart = () => {
    // The user grabbed the camera: the scripted move is dropped (never fight the hand) and the state settles.
    this.director.cancel();
    this.machine.interrupt();
    this.userMoved = true;
    this.emitCamera();
  };

  // ------------------------------------------------------------------ per-frame
  /** Public so tests (and the animation loop) drive the exact same code path. */
  tick(nowMs: number) {
    if (this.disposed) return;
    const dt = this.lastMs ? Math.min(0.05, Math.max(0, (nowMs - this.lastMs) / 1000)) : 0.016;
    this.lastMs = nowMs;
    const k = (rate: number) => 1 - Math.exp(-dt * rate);

    if (this.director.update(nowMs, this.pose)) {
      this.camera.position.copy(this.pose.position);
      this.controls.target.copy(this.pose.target);
    }
    this.controls.enabled = !this.director.active;
    // Orbit constraints follow the camera state (Face / Scalp inspections are tighter than the body overview).
    const cons = constraintsFor(this.asset, this.machine.state, this.director.active || this.machine.inFlight);
    this.controls.minDistance = cons.minDistance; this.controls.maxDistance = cons.maxDistance;
    this.controls.minPolarAngle = cons.minPolar; this.controls.maxPolarAngle = cons.maxPolar;
    this.controls.update();
    this.clampPan();

    // Lighting settles in after the entrance.
    const ls = this.reduced ? 1 : Math.min(1, Math.max(0, (nowMs - this.startMs - 500) / 800));
    const lightK = 0.6 + 0.4 * (ls * ls * (3 - 2 * ls));
    for (const l of this.lights) l.light.intensity = l.base * lightK;

    // Context dimming: while regions are selected the rest of the body recedes a little (never disappears).
    const emphT = this.selection.size > 0 || this.placingRegion ? 0.7 : 1;
    this.skinEmph = this.reduced ? emphT : this.skinEmph + (emphT - this.skinEmph) * k(8);
    this.skinOriginal.forEach((orig, mat) => {
      const c = (mat as THREE.MeshStandardMaterial).color;
      if (c) c.copy(orig).multiplyScalar(this.skinEmph);
    });

    if (this.pointerDirty) { this.pointerDirty = false; this.updateHover(); }
    this.stepLooks(this.reduced ? 1 : k(14));
    this.camera.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
  }

  private clampPan() {
    const t = this.controls.target;
    if (this.panBox.containsPoint(t)) return;
    const c = t.clone();
    this.panBox.clampPoint(t, c);
    const d = c.sub(t);
    this.controls.target.add(d);
    this.camera.position.add(d);
  }

  private resize() {
    if (this.disposed) return;
    const w = Math.max(this.container.clientWidth, 1), h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // If the user has not moved the camera and nothing is animating, re-compose for the new aspect (rotation, panel open/close).
    if (!this.userMoved && !this.director.active) {
      const key = this.machine.focusRegionId;
      const p = (key ? focusPose(this.asset, key, this.aspect()) : null) ?? overviewPose(this.asset, this.machine.view, this.machine.facing, this.aspect());
      if (p) { this.camera.position.copy(p.position); this.controls.target.copy(p.target); this.controls.update(); }
    }
  }

  // ------------------------------------------------------------------ picking
  private setNdc(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1, -((e.clientY - r.top) / Math.max(r.height, 1)) * 2 + 1);
    this.pointerClient = { x: e.clientX, y: e.clientY };
  }

  private pick() {
    this.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return pickRegion(this.raycaster, this.pickList, this.occluders);
  }

  private clearHover() {
    if (this.hoverId !== null) { this.hoverId = null; this.refreshLooks(); this.cb.onHover?.(null, 0, 0); }
    if (!this.placingRegion) this.renderer.domElement.style.cursor = "";
  }

  private updateHover() {
    const hit = this.pick();
    const id = hit ? hit.regionId : null;
    if (id !== this.hoverId) {
      this.hoverId = id;
      this.refreshLooks();
      if (!this.placingRegion) this.renderer.domElement.style.cursor = id ? "pointer" : "";
    }
    this.cb.onHover?.(id, this.pointerClient.x, this.pointerClient.y);
  }

  private onPointerMove = (e: PointerEvent) => {
    if (e.buttons !== 0 || e.pointerType === "touch") return; // dragging = orbiting; touch has no hover
    this.setNdc(e);
    this.pointerDirty = true;
  };
  private onPointerDown = (e: PointerEvent) => {
    this.down = { x: e.clientX, y: e.clientY };
    this.clearHover();
  };
  private onPointerCancel = () => { this.down = null; };
  private onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) return; // a drag, not a click
    this.setNdc(e);
    const hit = this.pick();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (this.placingRegion && hit && hit.regionId === this.placingRegion) {
      const surf = this.asset.regions.get(hit.regionId)!;
      const n = toNormalized(surf.bounds, hit.point);
      const m: MarkerPoint = { regionId: hit.regionId, ...n };
      this.pending = m;
      this.rebuildMarkers();
      this.cb.onMarkerPlace?.(m);
      return;
    }
    if (hit) this.cb.onPick?.(hit.regionId, additive);
    else this.cb.onPickNone?.(additive);
  };
  private onPointerLeave = () => this.clearHover();
  private onContextLost = (e: Event) => { e.preventDefault(); this.cb.onContextLost?.(); };

  // ------------------------------------------------------------------ lighting
  private buildLighting() {
    const add = <T extends THREE.Light>(l: T) => { this.scene.add(l); this.lights.push({ light: l, base: l.intensity }); return l; };
    // Soft studio: warm key upper-front, cool fill, two rims to separate the body from the backdrop.
    const key = add(new THREE.DirectionalLight(0xfff1e6, 2.15)); key.position.set(1.8, 3.2, 3.8);
    const fill = add(new THREE.DirectionalLight(0xd3e3ff, 1.1)); fill.position.set(-3, 1.4, 3.0);
    const rim = add(new THREE.DirectionalLight(0xb5d8ff, 1.5)); rim.position.set(-1.5, 2.6, -4);
    const rim2 = add(new THREE.DirectionalLight(0xb5d8ff, 0.8)); rim2.position.set(3, 1.2, -3.4);
    // the back gets a gentle key too, so the posterior view is never dark
    const back = add(new THREE.DirectionalLight(0xfff1e6, 1.1)); back.position.set(0, 2.4, -4.4);
    add(new THREE.HemisphereLight(0xeaf1f9, 0x2a3140, 0.95));
    if (this.quality === "low") { // phones: skip environment-map generation; brighter hemisphere light keeps the shape readable
      const h = this.lights.find((l) => l.light instanceof THREE.HemisphereLight);
      if (h) h.light.intensity = h.base = h.base * 1.35;
      return;
    }
    try {
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
      c.removeEventListener("pointercancel", this.onPointerCancel);
      c.removeEventListener("pointerleave", this.onPointerLeave);
      c.removeEventListener("webglcontextlost", this.onContextLost);
      this.controls?.removeEventListener("start", this.onUserStart);
      this.controls?.stopListenToKeyEvents();
      this.controls?.dispose();
      this.clearSprites();
      this.overlays.forEach((o) => o.mat.dispose());
      this.overlays.clear();
      this.tex.circle.dispose(); this.tex.diamond.dispose(); this.tex.ring.dispose();
      this.unmountGroundShadow();
      this.asset?.dispose();
      this.scene.environment?.dispose();
      this.renderer.dispose();
      c.remove();
    } catch { /* teardown must never throw */ }
  }
}
