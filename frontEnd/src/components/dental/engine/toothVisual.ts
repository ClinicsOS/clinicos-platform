import * as THREE from "three";
import type { ToothMeta } from "@/lib/dental/fdi";
import type { ToothVisualState } from "@/lib/dental/types";
import type { SurfaceId } from "@/lib/dental/taxonomy";
import { CROWN_HEX, FILLING_HEX } from "@/lib/dental/visualTokens";
import type { ToothMeshSource } from "./toothGeometry";
import type { ToothPlacement } from "./archLayout";

/**
 * ToothVisual = the "Dental Tooth Visual Adapter".
 *
 *   Dental data -> FDI id -> ToothVisual -> (ToothMeshSource: placeholder NOW, professional GLB LATER)
 *
 * It owns everything that must survive a geometry swap: materials, hover / selection rim, dimming,
 * missing-tooth fade, clinical markers, surface anchors. The geometry comes ONLY from a `ToothMeshSource`
 * (crown geometry + root geometries in the tooth-local frame documented in toothGeometry.ts).
 * Replacing the placeholder with real models therefore never touches selection, camera, states or the panel.
 */
const ENAMEL = 0xeadfc8;
const OUTLINE = 0x4fc3b8;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
let markerGeo: THREE.SphereGeometry | null = null;
const getMarkerGeo = () => (markerGeo ??= new THREE.SphereGeometry(1, 14, 10));

interface Tint { m: THREE.MeshStandardMaterial; base: THREE.Color }

// Silhouette rim shared by the selection outline and the planned-crown halo (back-face shell pushed out along the normals).
// NOTE: `#include` has to start its own line, otherwise the fragment shader fails to compile ("invalid character '#'")
// and the program stays invalid for the rest of the session.
const RIM_VERTEX = "uniform float uThick; void main(){ vec3 p = position + normal * uThick; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }";
const RIM_FRAGMENT = "uniform vec3 uColor; uniform float uOpacity;\nvoid main(){\n gl_FragColor = vec4(uColor, uOpacity);\n#include <colorspace_fragment>\n}";

/** One animated piece of a treatment picture: opacity fades in when it appears, in-progress pieces breathe. */
interface TreatFx { set: (opacity: number) => void; base: number; pulse: boolean; phase: number; mesh?: THREE.Object3D; baseScale?: THREE.Vector3 }

export class ToothVisual {
  readonly fdi: string;
  readonly meta: ToothMeta;
  readonly group = new THREE.Group(); // positioned + yawed by JawModel
  readonly inner = new THREE.Group(); // crown-up frame; flipped for upper teeth
  readonly dims: ToothMeshSource["dims"];
  readonly nx: number;
  readonly nz: number;

  private crown: THREE.Mesh;
  private roots: THREE.Mesh[] = [];
  private ghost: THREE.Mesh;
  private outline: THREE.Mesh;
  private markers = new THREE.Group();
  private planMarkers = new THREE.Group(); // treatment-plan indicators (ring = planned, diamond = in progress, check = treated)
  private planMats: THREE.MeshBasicMaterial[] = [];
  private treatGroup = new THREE.Group(); // Crown / Filling TYPE pictures for planned + in-progress treatments (ghost style)
  private treatMats: THREE.Material[] = [];
  private treatGeos: THREE.BufferGeometry[] = [];
  private treatFx: TreatFx[] = [];
  private treatSig = "";
  private treatAppear = 1; private treatAppearTarget = 1;
  private stateApplied = false;
  private pulsing: Array<{ mesh: THREE.Mesh; base: THREE.Vector3; phase: number }> = [];
  private enamel: THREE.MeshPhysicalMaterial;
  private capMat: THREE.MeshStandardMaterial | null = null;
  private outlineMat: THREE.ShaderMaterial;
  private ghostMat: THREE.MeshBasicMaterial;
  private tints: Tint[] = [];
  private ownedMats: THREE.Material[] = [];
  private rootsHidden = false;

  private hover = false; private hoverAmt = 0;
  private selected = false; private selAmt = 0;
  private emph = 1; private emphTarget = 1;
  private presence = 1; private presenceTarget = 1;
  private transparentOn = false;
  private hero = 0; // 0 none, 1 selected, 2 focus
  private lift = 0;
  private erupt = 0; private eruptTarget = 0;
  private readonly tmpC = new THREE.Color();

  constructor(meta: ToothMeta, placement: ToothPlacement, src: ToothMeshSource) {
    this.fdi = meta.fdi;
    this.meta = meta;
    this.dims = src.dims;
    this.nx = placement.nx;
    this.nz = placement.nz;

    this.group.name = `tooth-${meta.fdi}`;
    this.group.position.set(placement.x, placement.y, placement.z);
    this.group.rotation.y = placement.yaw;
    // Upper teeth hang crown-down: flip about Z (keeps the facial +Z direction).
    if (meta.jaw === "upper") this.inner.rotation.z = Math.PI;
    this.group.add(this.inner);

    this.enamel = new THREE.MeshPhysicalMaterial({
      color: ENAMEL, roughness: 0.4, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45,
      envMapIntensity: 0.55, emissive: new THREE.Color(0xfff0dc), emissiveIntensity: 0,
    });
    this.ownedMats.push(this.enamel);

    this.crown = new THREE.Mesh(src.crown, this.enamel);
    this.crown.userData.fdi = meta.fdi;
    this.inner.add(this.crown);
    for (const g of src.roots) {
      const r = new THREE.Mesh(g, this.enamel);
      this.roots.push(r);
      this.inner.add(r);
    }

    this.outlineMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(OUTLINE) }, uThick: { value: 0.026 }, uOpacity: { value: 0 } },
      vertexShader: RIM_VERTEX,
      fragmentShader: RIM_FRAGMENT,
      side: THREE.BackSide, transparent: true, depthWrite: false,
    });
    this.ownedMats.push(this.outlineMat);
    this.outline = new THREE.Mesh(src.crown, this.outlineMat);
    this.outline.visible = false;
    this.outline.renderOrder = 2;
    this.inner.add(this.outline);

    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x8fb3cc, transparent: true, opacity: 0, depthWrite: false });
    this.ownedMats.push(this.ghostMat);
    this.ghost = new THREE.Mesh(src.crown, this.ghostMat);
    this.ghost.userData.fdi = meta.fdi;
    this.ghost.visible = false;
    this.inner.add(this.ghost);

    this.inner.add(this.markers);
    this.inner.add(this.treatGroup);
    this.inner.add(this.planMarkers);
    this.rebuildTints();
  }

  // ---------- public API used by the engine ----------
  setHover(on: boolean) { this.hover = on; }
  setSelected(on: boolean) { this.selected = on; }
  /** 1 = selected hero, 2 = focus. Adds only a tiny (<=1mm) facial lift — the tooth never leaves its socket. */
  setHero(level: number) { this.hero = level; }
  /** Start at a given emphasis with no animation (used when a new jaw fades in). */
  setEmphasisNow(v: number) { this.emph = v; this.emphTarget = v; }
  setEmphasisTarget(v: number) { this.emphTarget = v; }
  /** Meshes that raycasting should test. A missing tooth stays selectable through its ghost. */
  pickTargets(): THREE.Object3D[] { return this.presenceTarget < 0.5 ? [this.ghost] : [this.crown]; }
  focusCenter(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateWorldMatrix(true, false);
    return this.inner.localToWorld(out.set(0, this.dims.tip * 0.32, 0));
  }
  /** Where a label should sit (just outside the crown, along the facial direction), in world space. */
  labelAnchor(out: THREE.Vector3): THREE.Vector3 {
    this.group.updateWorldMatrix(true, false);
    return this.inner.localToWorld(out.set(0, this.dims.tip * 0.6, this.dims.d * 0.5 + 0.12));
  }
  get radius() { return Math.max(this.dims.w, this.dims.d, this.dims.tip + this.dims.rootLen * 0.4) * 0.5; }

  applyState(s: ToothVisualState) {
    this.presenceTarget = s.missing || s.unerupted ? 0 : 1; // missing / unerupted: ghost stays selectable
    this.eruptTarget = s.partiallyErupted ? 1 : 0; // partially erupted: sits lower in the gingiva
    // Restoration: crown/bridge/implant get a cap material on the crown mesh; natural roots stay enamel.
    // A crown that is recorded as an existing condition OR as a COMPLETED crown treatment looks the same (it IS a crown on the tooth).
    const restoration = s.restoration ?? (s.treatments.some((x) => x.kind === "crown" && x.status === "completed") ? "crown" : null);
    this.capMat?.dispose();
    this.ownedMats = this.ownedMats.filter((m) => m !== this.capMat);
    this.capMat = null;
    if (restoration) {
      const cfg =
        restoration === "crown" ? { color: CROWN_HEX, metalness: 0.4, roughness: 0.3 }
        : restoration === "bridge" ? { color: 0xe1cc98, metalness: 0.6, roughness: 0.3 }
        : { color: 0xf3efe4, metalness: 0.05, roughness: 0.2 };
      this.capMat = new THREE.MeshStandardMaterial({ ...cfg, envMapIntensity: 0.9, emissive: new THREE.Color(0xfff0dc), emissiveIntensity: 0 });
      this.ownedMats.push(this.capMat);
      this.crown.material = this.capMat;
    } else {
      this.crown.material = this.enamel;
    }
    this.rootsHidden = restoration === "implant";
    // Root-canal-treated: enamel reads very slightly greyer.
    this.enamel.color.set(ENAMEL);
    if (s.rootCanal) this.enamel.color.lerp(new THREE.Color(0x9a9a92), 0.22);
    this.rebuildTints();
    this.rebuildMarkers(s);
    this.rebuildTreatments(s);
    this.rebuildPlanMarkers(s);
    this.stateApplied = true;
  }

  update(dt: number, time: number, reduced: boolean) {
    const k = (rate: number) => 1 - Math.exp(-dt * rate);
    this.hoverAmt += ((this.hover ? 1 : 0) - this.hoverAmt) * k(22);
    this.selAmt += ((this.selected ? 1 : 0) - this.selAmt) * k(18);
    this.emph += (this.emphTarget - this.emph) * k(11);
    this.presence += (this.presenceTarget - this.presence) * k(reduced ? 60 : 7);
    this.lift += ((this.hero === 2 ? 0.1 : this.hero === 1 ? 0.05 : 0) - this.lift) * k(10);
    this.erupt += (this.eruptTarget - this.erupt) * k(reduced ? 60 : 6);
    this.inner.position.z = this.lift;
    this.inner.position.y = (this.meta.jaw === "upper" ? 1 : -1) * 0.4 * this.dims.h * this.erupt;
    if (Math.abs(this.presence - this.presenceTarget) < 0.004) this.presence = this.presenceTarget;

    this.group.scale.setScalar(1 + 0.015 * this.hoverAmt);
    const glow = 0.07 * this.hoverAmt + 0.05 * this.selAmt;
    const fade = this.presence < 0.999;
    if (fade !== this.transparentOn) {
      this.transparentOn = fade;
      for (const t of this.tints) t.m.needsUpdate = true;
    }
    for (const t of this.tints) {
      // De-emphasis = darker + desaturated (reads as "farther / softer") — no blur, no extra passes.
      const c = t.m.color.copy(t.base);
      if (this.emph < 0.999) {
        const luma = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b, d = (1 - this.emph) * 0.6;
        c.r += (luma - c.r) * d; c.g += (luma - c.g) * d; c.b += (luma - c.b) * d;
        c.multiplyScalar(this.emph);
      }
      t.m.emissiveIntensity = glow;
      t.m.transparent = fade;
      t.m.opacity = this.presence;
    }
    const solid = this.presence > 0.02;
    this.crown.visible = solid;
    for (const r of this.roots) r.visible = solid && !this.rootsHidden;
    this.markers.visible = this.presence > 0.5;
    this.planMarkers.visible = this.presence > 0.5;
    this.treatGroup.visible = this.presence > 0.5 && this.treatFx.length > 0;
    if (this.treatGroup.visible) {
      this.treatAppear += (this.treatAppearTarget - this.treatAppear) * (1 - Math.exp(-dt * (reduced ? 60 : 8)));
      if (Math.abs(this.treatAppearTarget - this.treatAppear) < 0.004) this.treatAppear = this.treatAppearTarget;
      const soft = 0.3 + 0.7 * this.emph; // fades with the rest of the jaw when it is de-emphasised
      for (const fx of this.treatFx) {
        const wave = fx.pulse && !reduced ? Math.sin(time * 2.6 + fx.phase) : 0;
        fx.set(fx.base * this.treatAppear * soft * (1 + 0.22 * wave));
        if (fx.mesh && fx.baseScale) fx.mesh.scale.copy(fx.baseScale).multiplyScalar((0.8 + 0.2 * this.treatAppear) * (1 + 0.05 * wave));
      }
    }
    for (const m of this.planMats) m.opacity = 0.3 + 0.7 * this.emph; // fades with the rest of the jaw when it is de-emphasised
    const ghostA = 1 - this.presence;
    this.ghost.visible = ghostA > 0.02;
    this.ghostMat.opacity = 0.2 * ghostA * (0.4 + 0.6 * this.emph);
    this.outline.visible = this.selAmt > 0.01;
    this.outlineMat.uniforms.uOpacity.value = 0.95 * this.selAmt;

    if (this.pulsing.length) {
      for (const p of this.pulsing) {
        const f = reduced ? 1 : 1 + 0.12 * Math.sin(time * 2.4 + p.phase);
        p.mesh.scale.set(p.base.x * f, p.base.y * f, p.base.z);
      }
    }
  }

  dispose() {
    this.clearPlanMarkers();
    this.clearTreatments();
    this.clearMarkers();
    this.ownedMats.forEach((m) => m.dispose());
    this.capMat?.dispose();
  }

  // ---------- internals ----------
  private rebuildTints() {
    const mat = this.crown.material as THREE.MeshStandardMaterial;
    const list: THREE.MeshStandardMaterial[] = [this.enamel];
    if (mat !== this.enamel) list.push(mat);
    this.tints = list.map((m) => ({ m, base: m.color.clone() }));
    this.transparentOn = !this.transparentOn; // force a material refresh on the next update()
  }

  private clearPlanMarkers() {
    for (const c of [...this.planMarkers.children]) {
      this.planMarkers.remove(c);
      c.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.userData.ownGeo) m.geometry.dispose(); });
    }
    this.planMats.forEach((m) => m.dispose());
    this.planMats = [];
  }

  /**
   * Restrained plan indicators: ONE small floating symbol on the facial side of the crown — never a colour wash.
   * Shape carries the meaning as well as colour: ring = planned, diamond = in progress, check = has completed treatment.
   */
  private rebuildPlanMarkers(s: ToothVisualState) {
    this.clearPlanMarkers();
    if (!s.plan && !s.treated) return;
    const { h, d, w, rise } = this.dims;
    const r = 0.055 + 0.03 * w; // ~20% of the crown width: a small badge, not a landmark
    const y = h + rise * 0.5 + r * 0.5; // above the buccal-surface caries/filling anchors (h*0.55), so they never overlap
    const z = d * 0.5 + 0.1 + r * 0.4; // hugging the facial surface, not floating away from it
    const mk = (color: number) => {
      const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false });
      this.planMats.push(m);
      return m;
    };
    const put = (obj: THREE.Object3D, x: number) => { obj.position.set(x, y, z); obj.renderOrder = 3; this.planMarkers.add(obj); };
    const both = !!s.plan && s.treated;
    if (s.plan === "planned") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.2, 8, 24), mk(0x6cb6e8));
      ring.userData.ownGeo = true;
      put(ring, both ? -r * 1.5 : 0);
    } else if (s.plan === "in_progress") {
      const dia = new THREE.Mesh(new THREE.OctahedronGeometry(r * 1.05, 0), mk(0xb49bff));
      dia.userData.ownGeo = true;
      put(dia, both ? -r * 1.5 : 0);
    }
    if (s.treated) {
      const mat = mk(0x62d39a);
      const g = new THREE.Group();
      const a = new THREE.Mesh(new THREE.BoxGeometry(r * 0.32, r * 0.9, r * 0.2), mat);
      const b = new THREE.Mesh(new THREE.BoxGeometry(r * 0.32, r * 1.7, r * 0.2), mat);
      a.userData.ownGeo = b.userData.ownGeo = true;
      a.position.set(-r * 0.42, -r * 0.1, 0); a.rotation.z = Math.PI / 4;
      b.position.set(r * 0.28, r * 0.2, 0); b.rotation.z = -Math.PI / 4;
      g.add(a, b);
      put(g, both ? r * 1.5 : 0);
    }
  }

  private clearTreatments() {
    for (const c of [...this.treatGroup.children]) this.treatGroup.remove(c);
    this.treatMats.forEach((m) => m.dispose());
    this.treatGeos.forEach((g) => g.dispose());
    this.treatMats = []; this.treatGeos = []; this.treatFx = [];
  }

  /**
   * PLANNED / IN-PROGRESS Crown and Filling pictures (completed ones are drawn solid by applyState / rebuildMarkers).
   *   Crown   -> covers the WHOLE crown: a gold halo around the silhouette + a faint gold veil over it
   *   Filling -> only the treated SURFACE(S): a hollow cobalt ring with a faint fill (solid dome once completed)
   * "Ghost" = intent, not yet done; in progress is stronger and breathes. They fade in when a treatment is added.
   */
  private rebuildTreatments(s: ToothVisualState) {
    const sig = JSON.stringify(s.treatments);
    const changed = sig !== this.treatSig;
    this.treatSig = sig;
    this.clearTreatments();
    // in progress beats planned when the same thing is listed twice
    const rank = (x: "planned" | "in_progress" | "completed") => (x === "in_progress" ? 2 : x === "planned" ? 1 : 0);
    let crown: "planned" | "in_progress" | null = null;
    const fillings = new Map<SurfaceId, "planned" | "in_progress">();
    for (const x of s.treatments) {
      if (x.status === "completed") continue;
      if (x.kind === "crown") { if (!crown || rank(x.status) > rank(crown)) crown = x.status; }
      else for (const surf of (x.surfaces.length ? x.surfaces : (["O"] as SurfaceId[]))) {
        const cur = fillings.get(surf);
        if (!cur || rank(x.status) > rank(cur)) fillings.set(surf, x.status);
      }
    }
    if (!crown && !fillings.size) { this.treatAppearTarget = this.treatAppear = 1; return; }
    // animate only when something about the treatments changed after the tooth was first drawn
    this.treatAppear = changed && this.stateApplied ? 0 : 1;
    this.treatAppearTarget = 1;

    if (crown) {
      const live = crown === "in_progress";
      const haloMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(CROWN_HEX) }, uThick: { value: 0.05 }, uOpacity: { value: 0 } },
        vertexShader: RIM_VERTEX, fragmentShader: RIM_FRAGMENT, side: THREE.BackSide, transparent: true, depthWrite: false,
      });
      const halo = new THREE.Mesh(this.crown.geometry, haloMat);
      halo.renderOrder = 1;
      const veilMat = new THREE.MeshBasicMaterial({ color: CROWN_HEX, transparent: true, opacity: 0, depthWrite: false });
      const veil = new THREE.Mesh(this.crown.geometry, veilMat);
      veil.scale.setScalar(1.02);
      veil.renderOrder = 1;
      this.treatGroup.add(halo, veil);
      this.treatMats.push(haloMat, veilMat); // the crown geometry is shared with the tooth: never disposed here
      this.treatFx.push(
        { set: (o) => { haloMat.uniforms.uOpacity.value = Math.min(1, o); }, base: live ? 0.95 : 0.7, pulse: live, phase: 0 },
        { set: (o) => { veilMat.opacity = Math.min(1, o); }, base: live ? 0.3 : 0.18, pulse: live, phase: 0 }
      );
    }

    const r = 0.11 + 0.05 * this.dims.w;
    const ringGeo = new THREE.TorusGeometry(1, 0.13, 8, 32); // unit ring, scaled per surface
    this.treatGeos.push(ringGeo);
    let k = 0;
    for (const [surf, st] of Array.from(fillings.entries())) {
      const live = st === "in_progress";
      const a = this.anchor(surf);
      const ringMat = new THREE.MeshBasicMaterial({ color: FILLING_HEX, transparent: true, opacity: 0, depthWrite: false });
      const fillMat = new THREE.MeshBasicMaterial({ color: FILLING_HEX, transparent: true, opacity: 0, depthWrite: false });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.copy(a.p).addScaledVector(a.n, 0.02);
      ring.quaternion.setFromUnitVectors(Z_AXIS, a.n);
      ring.scale.setScalar(r * 1.35);
      ring.renderOrder = 2;
      const fill = new THREE.Mesh(getMarkerGeo(), fillMat);
      fill.position.copy(a.p);
      fill.quaternion.setFromUnitVectors(Z_AXIS, a.n);
      fill.scale.set(r * 1.2, r * 1.2, r * 0.4);
      fill.renderOrder = 1;
      this.treatGroup.add(ring, fill);
      this.treatMats.push(ringMat, fillMat);
      const phase = k++ * 1.3;
      this.treatFx.push(
        { set: (o) => { ringMat.opacity = Math.min(1, o); }, base: live ? 1 : 0.9, pulse: live, phase, mesh: ring, baseScale: ring.scale.clone() },
        { set: (o) => { fillMat.opacity = Math.min(1, o); }, base: live ? 0.5 : 0.28, pulse: live, phase, mesh: fill, baseScale: fill.scale.clone() }
      );
    }
  }

  private clearMarkers() {
    for (const c of [...this.markers.children]) {
      this.markers.remove(c);
      ((c as THREE.Mesh).material as THREE.Material).dispose();
    }
    this.pulsing = [];
  }

  private anchor(s: SurfaceId): { p: THREE.Vector3; n: THREE.Vector3 } {
    const { w, h, d, rise } = this.dims;
    // inner-frame X: which sign is DISTAL for this tooth (accounts for viewer side + the upper-jaw flip)
    const dx = this.meta.side * (this.meta.jaw === "upper" ? -1 : 1);
    switch (s) {
      case "M": return { p: new THREE.Vector3(-dx * w * 0.485, h * 0.55, 0), n: new THREE.Vector3(-dx, 0, 0) };
      case "D": return { p: new THREE.Vector3(dx * w * 0.485, h * 0.55, 0), n: new THREE.Vector3(dx, 0, 0) };
      case "B": return { p: new THREE.Vector3(0, h * 0.55, d * 0.46), n: new THREE.Vector3(0, 0, 1) };
      case "L": return { p: new THREE.Vector3(0, h * 0.55, -d * 0.42), n: new THREE.Vector3(0, 0, -1) };
      default: return { p: new THREE.Vector3(0, h + rise * 0.55, 0), n: new THREE.Vector3(0, 1, 0) };
    }
  }

  private addMarker(p: THREE.Vector3, n: THREE.Vector3, mat: THREE.Material, r: number, pulse: boolean) {
    const m = new THREE.Mesh(getMarkerGeo(), mat);
    m.position.copy(p);
    m.quaternion.setFromUnitVectors(Z_AXIS, n);
    m.scale.set(r, r, r * 0.4); // flattened along the surface normal: a localised dome, not a blob
    m.renderOrder = 1;
    this.markers.add(m);
    if (pulse) this.pulsing.push({ mesh: m, base: m.scale.clone(), phase: Math.random() * 6 });
  }

  private rebuildMarkers(s: ToothVisualState) {
    this.clearMarkers();
    const r = 0.11 + 0.05 * this.dims.w;
    const surfacesOrO = (arr: SurfaceId[]) => (arr.length ? arr : (["O"] as SurfaceId[]));

    // Filling = LOCAL: a solid cobalt dome on each treated surface only (existing filling OR a completed filling treatment).
    const solid = new Set<SurfaceId>();
    if (s.hasFilling) surfacesOrO(s.fillings).forEach((x) => solid.add(x));
    for (const x of s.treatments) if (x.kind === "filling" && x.status === "completed") surfacesOrO(x.surfaces).forEach((y) => solid.add(y));
    if (solid.size) {
      const mat = new THREE.MeshStandardMaterial({ color: FILLING_HEX, metalness: 0.15, roughness: 0.32 });
      for (const surf of Array.from(solid)) { const a = this.anchor(surf); this.addMarker(a.p, a.n, mat, r * 1.0, false); }
    }
    if (s.rootCanal) {
      const a = this.anchor("O");
      this.addMarker(a.p, a.n, new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.5 }), r * 0.55, false);
    }
    for (const dgn of s.diagnoses) {
      const abscess = dgn.code === "infection_abscess";
      const mat = new THREE.MeshBasicMaterial({ color: abscess ? 0xe0685e : 0xe8a93c, transparent: true, opacity: 0.62, depthWrite: false });
      if (dgn.surfaces.length) {
        for (const surf of dgn.surfaces) { const a = this.anchor(surf); this.addMarker(a.p, a.n, mat, r, true); }
      } else if (["caries", "fractured_cracked_tooth", "defective_filling", "tooth_wear"].includes(dgn.code)) {
        const a = this.anchor("O"); this.addMarker(a.p, a.n, mat, r, true);
      } else {
        const { h, d } = this.dims;
        const p = abscess ? new THREE.Vector3(0, h * 0.02, d * 0.5) : new THREE.Vector3(0, h * 0.2, d * 0.46);
        this.addMarker(p, new THREE.Vector3(0, 0, 1), mat, r, true);
      }
    }
  }
}
