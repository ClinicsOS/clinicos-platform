import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { resolveCurrentTeeth, type DentitionType } from "@/lib/dental/fdi";
import { sortByChart } from "@/lib/dental/teethFormat";
import { placeholderToothProvider, type ToothMeshProvider } from "../engine/toothGeometry";
import { cellAt, layoutTeeth, SLAB_H, type PickerCell, type PickerLayout } from "./pickerLayout";

/**
 * ToothPickerEngine — a small, self-contained 3D runtime for PICKING teeth.
 *
 * It is deliberately NOT the clinical 3D chart (DentalEngine): no jaw, no camera moves, no clinical overlays. It shows two
 * straight rows of real 3D teeth on gum bands, in chart order, and answers one question: "which teeth did the doctor pick?".
 * It reuses the SAME tooth geometry provider as the main chart, so the teeth look like the rest of the product.
 *
 * Interaction: click toggles a tooth; press and drag along a row to paint-select (or paint-deselect) many; the whole
 * column under the pointer is the hit area, so there is no pixel-hunting between teeth.
 * Motion: teeth drop/rise into place from the midline outward; picked teeth lift toward the viewer on a spring, glow teal and
 * breathe; bulk selections (quick buttons) ripple outward from the midline; the chart leans slightly with the pointer.
 * `prefers-reduced-motion` turns all of it off (state changes are instant, nothing idles).
 *
 * Selection is owned by the caller (React): the engine reports user changes through `onChange` and accepts the result back
 * through `setSelection` (a no-op when nothing differs).
 */
export interface PickerCallbacks {
  onChange?: (fdis: string[]) => void;
  onHover?: (fdi: string | null, clientX: number, clientY: number) => void;
}
export interface PickerOptions {
  reducedMotion: boolean;
  dentition: { type: DentitionType; current?: readonly string[] | null };
  selected: readonly string[];
  mode: "multi" | "single";
  disabled?: boolean;
  renderer?: THREE.WebGLRenderer; // injectable for headless tests
  provider?: ToothMeshProvider;
  pixelRatioCap?: number;
}

const ENAMEL = 0xeadfc8;
const SEL_TINT = new THREE.Color(0x7fe0d4);
const TEAL = 0x4fc3b8;
const GUM_NEAR = new THREE.Color(0xb9645f); // the main chart's coral gingiva (0xd8938d -> 0xc4726f), a touch deeper because this scene is lit from the front
const GUM_FAR = new THREE.Color(0x7c3a44);

const easeOutBack = (x: number) => { const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };

const LABEL_BASE = "position:absolute;left:0;top:0;padding:1px 4px;border-radius:7px;font:600 10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;border:1px solid transparent;transition:background-color .16s,color .16s,border-color .16s,opacity .3s;pointer-events:none;will-change:transform;";
const LABEL_STYLE = {
  idle: LABEL_BASE + "background:rgba(8,26,43,.55);color:#CFE9F2;",
  hover: LABEL_BASE + "background:rgba(8,26,43,.85);color:#FFFFFF;border-color:#6FBDF5;",
  selected: LABEL_BASE + "background:#4FC3B8;color:#06263F;box-shadow:0 2px 10px rgba(79,195,184,.35);",
} as const;

class PickerTooth {
  readonly fdi: string;
  readonly cell: PickerCell;
  readonly group = new THREE.Group();
  readonly label: HTMLDivElement;
  private readonly inner = new THREE.Group();
  private readonly enamel: THREE.MeshPhysicalMaterial;
  private readonly outlineMat: THREE.ShaderMaterial;
  private readonly outline: THREE.Mesh;
  private readonly sign: number;
  private readonly baseY: number;
  private readonly phase: number;
  private labelState: keyof typeof LABEL_STYLE | "" = "";
  private appearAt: number;
  private pending: { at: number; value: boolean } | null = null;

  want = false;
  hover = false;
  selAmt = 0;
  hoverAmt = 0;
  appear = 0; // 0..1 eased entrance
  private z = 0;
  private vz = 0;

  constructor(cell: PickerCell, cej: number, provider: ToothMeshProvider, labelLayer: HTMLElement, appearAt: number) {
    this.fdi = cell.fdi;
    this.cell = cell;
    this.sign = cell.row === 0 ? 1 : -1;
    this.baseY = this.sign * cej;
    this.appearAt = appearAt;
    this.phase = (Number(cell.fdi) % 17) * 0.7;
    const src = provider(cell.meta);

    this.group.name = `pick-${cell.fdi}`;
    this.group.position.set(cell.x, this.baseY, 0);
    if (cell.row === 0) this.inner.rotation.z = Math.PI; // upper teeth hang crown-down, same convention as the main chart
    this.group.add(this.inner);

    this.enamel = new THREE.MeshPhysicalMaterial({
      color: ENAMEL, roughness: 0.4, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45,
      envMapIntensity: 0.55, emissive: new THREE.Color(TEAL), emissiveIntensity: 0,
    });
    const crown = new THREE.Mesh(src.crown, this.enamel); // crown only: the roots live inside the gum band
    crown.userData.fdi = cell.fdi;
    this.inner.add(crown);

    this.outlineMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(TEAL) }, uThick: { value: 0.03 }, uOpacity: { value: 0 } },
      vertexShader: "uniform float uThick; void main(){ vec3 p = position + normal * uThick; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }",
      fragmentShader: "uniform vec3 uColor; uniform float uOpacity; void main(){ gl_FragColor = vec4(uColor, uOpacity);\n#include <colorspace_fragment>\n}",
      side: THREE.BackSide, transparent: true, depthWrite: false,
    });
    this.outline = new THREE.Mesh(src.crown, this.outlineMat);
    this.outline.visible = false;
    this.outline.renderOrder = 2;
    this.inner.add(this.outline);

    this.label = document.createElement("div");
    this.label.textContent = cell.fdi;
    this.label.style.opacity = "0";
    labelLayer.appendChild(this.label);
    this.syncLabel();
  }

  setSelNow(v: boolean) { this.want = v; this.pending = null; }
  scheduleSel(v: boolean, at: number) { this.pending = { at, value: v }; }
  restartAppear(at: number) { this.appearAt = at; this.appear = 0; }

  /** Where the number sits: beyond the gum band, on the same side as the row (stage-local). */
  labelAnchor(out: THREE.Vector3, cej: number): THREE.Vector3 {
    return out.set(this.cell.x, this.sign * (cej + SLAB_H + 0.42), 0);
  }

  private syncLabel() {
    const s: keyof typeof LABEL_STYLE = this.want ? "selected" : this.hover ? "hover" : "idle";
    if (s === this.labelState) return;
    this.labelState = s;
    const op = this.label.style.opacity; // keep the fade-in state across style swaps
    this.label.style.cssText = LABEL_STYLE[s];
    this.label.style.opacity = op;
  }

  update(dt: number, time: number, nowMs: number, reduced: boolean) {
    if (this.pending && nowMs >= this.pending.at) { this.want = this.pending.value; this.pending = null; }
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    const fast = reduced ? 80 : 1;
    this.selAmt += ((this.want ? 1 : 0) - this.selAmt) * k(15 * fast);
    this.hoverAmt += ((this.hover ? 1 : 0) - this.hoverAmt) * k(20 * fast);

    // entrance: rows slide in from above / below, staggered from the midline outward
    const a = reduced ? 1 : Math.min(1, Math.max(0, (nowMs - this.appearAt) / 620));
    this.appear = a;
    const e = a >= 1 ? 1 : easeOutBack(a);

    // lift toward the viewer on a spring (picked teeth stand proud of the row; hover lifts a little more)
    const target = 0.17 * this.selAmt + 0.2 * this.hoverAmt;
    if (reduced) { this.z = target; this.vz = 0; }
    else {
      const acc = (target - this.z) * 190 - this.vz * 15;
      this.vz += acc * dt;
      this.z += this.vz * dt;
    }
    this.group.visible = a > 0.001;
    this.group.position.set(this.cell.x, this.baseY + this.sign * (1 - e) * 1.9, this.z);
    this.group.scale.setScalar((0.88 + 0.12 * Math.min(1, e)) * (1 + 0.04 * this.hoverAmt + 0.025 * this.selAmt));

    // colour: enamel -> teal tint; a soft breathing glow on picked teeth
    this.enamel.color.set(ENAMEL).lerp(SEL_TINT, 0.62 * this.selAmt);
    const breathe = reduced ? 0 : 0.35 * Math.sin(time * 2.3 + this.phase);
    this.enamel.emissiveIntensity = 0.1 * this.hoverAmt + 0.17 * this.selAmt * (1 + breathe);
    this.outline.visible = this.selAmt > 0.01;
    this.outlineMat.uniforms.uOpacity.value = 0.95 * this.selAmt;
    this.syncLabel();
    const lo = this.appear > 0.55 ? "1" : "0"; // numbers fade in once their tooth has arrived
    if (this.label.style.opacity !== lo) this.label.style.opacity = lo;
  }

  dispose() {
    this.enamel.dispose();
    this.outlineMat.dispose(); // geometries are the shared, cached tooth geometry: never disposed here
    this.label.remove();
  }
}

export class ToothPickerEngine {
  layout!: PickerLayout;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
  private readonly stage = new THREE.Group();
  private readonly labelLayer: HTMLDivElement;
  private readonly provider: ToothMeshProvider;
  private readonly reduced: boolean;
  private readonly ro: ResizeObserver | null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly plane = new THREE.Plane();

  private teeth = new Map<string, PickerTooth>();
  private staticMeshes: THREE.Mesh[] = [];
  private staticDisposables: Array<{ dispose(): void }> = [];
  private band!: THREE.Mesh;
  private bandMat!: THREE.MeshBasicMaterial;
  private bandX = 0;
  private bandAmt = 0;
  private selected = new Set<string>();
  private mode: "multi" | "single";
  private disabled: boolean;
  private hoverFdi: string | null = null;
  private painting: { value: boolean } | null = null;
  private pointer = { x: 0, y: 0, inside: false };

  private yaw = 0;
  private pitch = 0;
  private labelsDirty = true;
  private lastMs = 0;
  private time = 0;
  private disposed = false;

  constructor(private container: HTMLElement, private cb: PickerCallbacks, opts: PickerOptions) {
    this.reduced = opts.reducedMotion;
    this.mode = opts.mode;
    this.disabled = !!opts.disabled;
    this.provider = opts.provider ?? placeholderToothProvider;
    this.selected = new Set(opts.selected);
    this.renderer = opts.renderer ?? new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    try {
      const w = Math.max(container.clientWidth, 1), h = Math.max(container.clientHeight, 1);
      this.renderer.setPixelRatio(Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, opts.pixelRatioCap ?? 2));
      this.renderer.setSize(w, h, false);
      this.renderer.setClearColor(0x000000, 0); // the CSS studio backdrop shows through
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      const canvas = this.renderer.domElement;
      canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:pan-y;outline:none;cursor:default";
      canvas.setAttribute("aria-label", "3D tooth picker");
      container.appendChild(canvas);

      this.camera.position.set(0, 0, 24);
      this.camera.lookAt(0, 0, 0);
      this.scene.add(this.stage);
      this.buildLighting();

      this.labelLayer = document.createElement("div");
      this.labelLayer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none";
      container.appendChild(this.labelLayer);

      this.build(opts.dentition.type, opts.dentition.current ?? null, true);

      canvas.addEventListener("pointermove", this.onPointerMove);
      canvas.addEventListener("pointerdown", this.onPointerDown);
      canvas.addEventListener("pointerup", this.onPointerUp);
      canvas.addEventListener("pointercancel", this.onPointerUp);
      canvas.addEventListener("pointerleave", this.onPointerLeave);

      this.ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => this.resize()) : null;
      this.ro?.observe(container);
      this.renderer.setAnimationLoop((t: number) => this.tick(t));
    } catch (e) {
      this.dispose();
      throw e;
    }
  }

  // ------------------------------------------------------------------ public API
  /** Current selection in chart order (includes teeth that are not on the current chart, so nothing is silently lost). */
  getSelected(): string[] { return sortByChart(Array.from(this.selected)); }
  teethFdis(): string[] { return this.layout.cells.map((c) => c.fdi); }
  get hovered(): string | null { return this.hoverFdi; }
  debug() { return { teeth: this.teeth.size, selected: this.getSelected(), columns: this.layout.columns.length, mode: this.mode, painting: !!this.painting }; }

  /** Accepts the caller's selection. Bulk changes (3+ teeth, e.g. a quick button) ripple outward from the midline. */
  setSelection(fdis: readonly string[]) {
    const next = new Set(fdis);
    const changed: string[] = [];
    next.forEach((f) => { if (!this.selected.has(f)) changed.push(f); });
    this.selected.forEach((f) => { if (!next.has(f)) changed.push(f); });
    if (!changed.length) return;
    this.selected = next;
    const ripple = !this.reduced && changed.length >= 3;
    const now = this.lastMs || this.now();
    const mid = (this.layout.columns.length - 1) / 2;
    for (const f of changed) {
      const t = this.teeth.get(f);
      if (!t) continue;
      if (ripple) t.scheduleSel(next.has(f), now + Math.abs(t.cell.col - mid) * 30 + t.cell.row * 14);
      else t.setSelNow(next.has(f));
    }
  }

  setMode(mode: "multi" | "single") { this.mode = mode; }
  setDisabled(d: boolean) { this.disabled = d; this.renderer.domElement.style.cursor = d ? "not-allowed" : ""; }

  /** Dentition (or the mixed chart) changed: rebuild the rows and play the entrance again. */
  setDentition(type: DentitionType, current?: readonly string[] | null) { this.build(type, current ?? null, false); }

  // ------------------------------------------------------------------ scene
  private now() { return typeof performance !== "undefined" ? performance.now() : Date.now(); }

  private build(type: DentitionType, current: readonly string[] | null, first: boolean) {
    this.clearScene();
    const teeth = resolveCurrentTeeth(type, current);
    this.layout = layoutTeeth(teeth);
    this.buildStatic();
    const now = this.lastMs || this.now();
    const mid = (this.layout.columns.length - 1) / 2;
    for (const cell of this.layout.cells) {
      const delay = this.reduced ? 0 : 90 + Math.abs(cell.col - mid) * 40 + cell.row * 45;
      const t = new PickerTooth(cell, this.layout.cej, this.provider, this.labelLayer, now + delay);
      t.setSelNow(this.selected.has(cell.fdi));
      this.stage.add(t.group);
      this.teeth.set(cell.fdi, t);
    }
    this.labelsDirty = true;
    this.fit();
    if (!first) this.clearHover();
  }

  private clearScene() {
    this.teeth.forEach((t) => { this.stage.remove(t.group); t.dispose(); });
    this.teeth.clear();
    this.staticMeshes.forEach((m) => this.stage.remove(m));
    this.staticMeshes = [];
    this.staticDisposables.forEach((d) => d.dispose());
    this.staticDisposables = [];
  }

  private slabGeometry(width: number): THREE.BufferGeometry {
    // rounded gum band; the bevel grows the outline by 0.1 on every side, so the shape is made 0.2 smaller
    const w = width - 0.2, h = SLAB_H - 0.2, r = 0.3;
    const x = -w / 2, y = -h / 2;
    const s = new THREE.Shape();
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: 1.5, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 4, curveSegments: 14 });
    g.translate(0, 0, -0.55); // deep enough that a lifted (hovered / selected) tooth neck never pokes out of the front of the band
    return g;
  }

  /** Vertex colours: gum is lightest at the tooth margin and darkens toward the outer edge (inner edge faces the teeth). */
  private shadeSlab(geo: THREE.BufferGeometry, sign: number) {
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const half = SLAB_H / 2, c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const toward = -sign * pos.getY(i) / half; // +1 at the edge facing the teeth, -1 at the outer edge
      const f = Math.pow(Math.min(1, Math.max(0, (toward + 1) / 2)), 1.4);
      c.copy(GUM_FAR).lerp(GUM_NEAR, f);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }

  private addStatic(mesh: THREE.Mesh, ...disposables: Array<{ dispose(): void }>) {
    this.stage.add(mesh);
    this.staticMeshes.push(mesh);
    this.staticDisposables.push(...disposables);
  }

  private buildStatic() {
    const { cej, slabHalfW } = this.layout;
    const gum = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, envMapIntensity: 0.4 });
    this.staticDisposables.push(gum);
    for (const sign of [1, -1]) {
      const geo = this.slabGeometry(slabHalfW * 2);
      this.shadeSlab(geo, sign);
      this.staticDisposables.push(geo);
      const m = new THREE.Mesh(geo, gum);
      m.position.set(0, sign * (cej + SLAB_H / 2), 0);
      m.name = sign > 0 ? "gum-upper" : "gum-lower";
      this.stage.add(m);
      this.staticMeshes.push(m);
    }
    // the cross-hair of the doctor's sketch: occlusal plane (horizontal) + midline (vertical), drawn very quietly
    const lineMat = new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.32, depthWrite: false });
    const hGeo = new THREE.BoxGeometry(slabHalfW * 2 - 0.4, 0.016, 0.016);
    const vGeo = new THREE.BoxGeometry(0.016, cej * 2, 0.016);
    const h = new THREE.Mesh(hGeo, lineMat), v = new THREE.Mesh(vGeo, lineMat);
    this.addStatic(h, lineMat, hGeo); this.addStatic(v, vGeo);
    // column guide: a faint vertical band that follows the pointer so upper and lower teeth of one position read together
    this.bandMat = new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0, depthWrite: false });
    const bGeo = new THREE.PlaneGeometry(1, (cej + SLAB_H) * 2);
    this.band = new THREE.Mesh(bGeo, this.bandMat);
    this.band.position.z = -0.75;
    this.band.visible = false;
    this.addStatic(this.band, this.bandMat, bGeo);
  }

  private buildLighting() {
    const add = <T extends THREE.Light>(l: T) => { this.scene.add(l); return l; };
    add(new THREE.DirectionalLight(0xfff1e0, 2.7)).position.set(4, 8, 12); // key: upper-front, warm
    add(new THREE.DirectionalLight(0xbcd7ff, 1.0)).position.set(-7, 2, 8); // fill: cool and soft
    add(new THREE.DirectionalLight(0xa9d3ff, 1.4)).position.set(0, 4, -9); // rim
    add(new THREE.HemisphereLight(0xdde8f4, 0x1a2230, 0.85));
    try { // soft studio reflections for the enamel (no external assets); a nicety — lighting works without it
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch { /* ignore */ }
  }

  /** Fit the chart in the canvas (orthographic: rows stay perfectly straight and the same size at any width). */
  private fit() {
    const w = Math.max(this.container.clientWidth, 1), h = Math.max(this.container.clientHeight, 1);
    const aspect = w / h;
    let halfH = this.layout.halfH, halfW = halfH * aspect;
    if (halfW < this.layout.halfW) { halfW = this.layout.halfW; halfH = halfW / aspect; }
    this.camera.left = -halfW; this.camera.right = halfW; this.camera.top = halfH; this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
    this.labelsDirty = true;
  }

  private resize() {
    if (this.disposed) return;
    const w = Math.max(this.container.clientWidth, 1), h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.fit();
  }

  // ------------------------------------------------------------------ per frame
  tick(nowMs: number) {
    if (this.disposed) return;
    const dt = this.lastMs ? Math.min(0.05, Math.max(0, (nowMs - this.lastMs) / 1000)) : 0.016;
    this.lastMs = nowMs;
    this.time += dt;
    const k = (rate: number) => 1 - Math.exp(-dt * rate);

    // the whole chart leans a few degrees toward the pointer (and a fixed slight look-down so cusps read as 3D)
    const baseYaw = this.reduced || !this.pointer.inside ? 0 : this.pointer.x * 0.07;
    const basePitch = -0.2 + (this.reduced || !this.pointer.inside ? 0 : -this.pointer.y * 0.035);
    const ry = this.yaw, rp = this.pitch;
    this.yaw += (baseYaw - this.yaw) * k(5);
    this.pitch += (basePitch - this.pitch) * k(5);
    if (Math.abs(this.yaw - ry) > 1e-5 || Math.abs(this.pitch - rp) > 1e-5) this.labelsDirty = true;
    this.stage.rotation.set(this.pitch, this.yaw, 0);

    let moving = false;
    this.teeth.forEach((t) => {
      t.update(dt, this.time, nowMs, this.reduced);
      if (t.appear < 1) moving = true;
    });
    if (moving) this.labelsDirty = true;

    // column guide follows the hovered column
    const hc = this.hoverFdi ? this.teeth.get(this.hoverFdi)?.cell : undefined;
    if (hc) {
      const col = this.layout.columns[hc.col];
      if (this.bandAmt < 0.02) this.bandX = col.x; else this.bandX += (col.x - this.bandX) * k(18);
      this.band.scale.x = col.w;
    }
    this.bandAmt += ((hc ? 1 : 0) - this.bandAmt) * k(14);
    this.band.position.x = this.bandX;
    this.bandMat.opacity = 0.09 * this.bandAmt;
    this.band.visible = this.bandAmt > 0.01;

    if (this.labelsDirty) { this.labelsDirty = false; this.updateLabels(); }
    this.renderer.render(this.scene, this.camera);
  }

  private updateLabels() {
    this.stage.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.teeth.forEach((t) => {
      t.labelAnchor(this.tmp, this.layout.cej);
      this.stage.localToWorld(this.tmp);
      this.tmp.project(this.camera);
      const px = (this.tmp.x * 0.5 + 0.5) * w, py = (-this.tmp.y * 0.5 + 0.5) * h;
      t.label.style.transform = `translate(${px.toFixed(1)}px,${py.toFixed(1)}px) translate(-50%,-50%)`;
    });
  }

  // ------------------------------------------------------------------ picking (column-based: the whole column is the target)
  private setNdc(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const w = r.width || 1, h = r.height || 1;
    this.ndc.set(((e.clientX - r.left) / w) * 2 - 1, -((e.clientY - r.top) / h) * 2 + 1);
    this.pointer.x = this.ndc.x; this.pointer.y = this.ndc.y;
  }

  /** Chart-space (x, y) under the pointer: the ray is intersected with the chart's own plane, so the lean never skews picking. */
  private pointerToChart(): { x: number; y: number } {
    this.stage.updateMatrixWorld(true);
    this.camera.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const origin = this.tmp.set(0, 0, 0).applyMatrix4(this.stage.matrixWorld).clone();
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(this.stage.matrixWorld);
    this.plane.setFromNormalAndCoplanarPoint(normal, origin);
    const hit = this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (!hit) return { x: Infinity, y: Infinity };
    this.stage.worldToLocal(hit);
    return { x: hit.x, y: hit.y };
  }

  /** The tooth under a client point (null on empty space). Public so tests drive the exact same code path. */
  pick(clientX: number, clientY: number): string | null {
    this.setNdc({ clientX, clientY });
    const p = this.pointerToChart();
    return cellAt(this.layout, p.x, p.y)?.fdi ?? null;
  }

  private setHover(fdi: string | null) {
    if (fdi === this.hoverFdi) return;
    if (this.hoverFdi) { const t = this.teeth.get(this.hoverFdi); if (t) t.hover = false; }
    if (fdi) { const t = this.teeth.get(fdi); if (t) t.hover = true; }
    this.hoverFdi = fdi;
    this.renderer.domElement.style.cursor = this.disabled ? "not-allowed" : fdi ? "pointer" : "";
  }

  private clearHover() { this.setHover(null); this.cb.onHover?.(null, 0, 0); }

  private apply(fdi: string, value: boolean) {
    const cur = new Set(this.selected);
    if (this.mode === "single") { if (value) { cur.clear(); cur.add(fdi); } else cur.delete(fdi); }
    else if (value) cur.add(fdi); else cur.delete(fdi);
    if (cur.size === this.selected.size && Array.from(cur).every((f) => this.selected.has(f))) return;
    const next = sortByChart(Array.from(cur));
    this.setSelection(next);
    this.cb.onChange?.(next);
  }

  private onPointerMove = (e: PointerEvent) => {
    this.pointer.inside = true;
    const fdi = this.pick(e.clientX, e.clientY);
    if (this.painting && fdi && !this.disabled) this.apply(fdi, this.painting.value); // drag = paint
    this.setHover(fdi);
    this.cb.onHover?.(fdi, e.clientX, e.clientY);
  };
  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.disabled) return;
    const fdi = this.pick(e.clientX, e.clientY);
    if (!fdi) return;
    try { this.renderer.domElement.setPointerCapture?.(e.pointerId); } catch { /* not supported: painting still works inside the canvas */ }
    const value = !this.selected.has(fdi);
    this.painting = this.mode === "multi" ? { value } : null;
    this.apply(fdi, value);
  };
  private onPointerUp = (e: PointerEvent) => {
    this.painting = null;
    try { this.renderer.domElement.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
  };
  private onPointerLeave = () => { this.pointer.inside = false; if (!this.painting) this.clearHover(); };

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
      c.removeEventListener("pointercancel", this.onPointerUp);
      c.removeEventListener("pointerleave", this.onPointerLeave);
      this.clearScene();
      this.scene.environment?.dispose();
      this.renderer.dispose();
      c.remove();
      this.labelLayer?.remove();
    } catch { /* teardown must never throw */ }
  }
}
