// CLINICOS CONNECT (C2) — the 3D Team Space (approved prototype, ported). A glowing core with one node per ACTIVE staff member.
// It shows who is on the team and a gentle "connected" feel. It never shows, or knows, anything about conversations or messages.
//
// Performance & safety rules (see docs/connect-c2.md):
//   - plain three.js, same pattern as the app's other engines (imperative class, dynamic import, dispose())
//   - pixel ratio capped (1.5 panel / 1.25 band) and stepped down automatically if the frame rate is poor; no post-processing
//   - pools: at most 12 pulses and 8 ripples ever exist; ambient pulses are rare and tiny
//   - renders only while the canvas is on screen AND the tab is visible; with reduced motion it renders only when something changes
//   - dispose() cancels the frame loop, removes every listener/observer, frees geometries, materials, textures and the renderer
import * as THREE from "three";
import { frameFor, worldPositions, type Frame, type TeamPerson } from "./layout";

export interface NodeInput extends TeamPerson {
  isMe: boolean;
  /** Role as text for the label, already translated. */
  roleText: string;
  /** What to call this node in the label ("You" for the current user). */
  label: string;
}

export interface EngineOptions {
  host: HTMLElement;
  labels: HTMLElement;
  dark: boolean;
  reducedMotion: boolean;
  variant: "panel" | "band";
  classes: { label: string; role: string; name: string };
  onLost?: () => void;
}

const ROLE_COL: Record<string, number> = { owner: 0xc8a45c, doctor: 0x3b9de8, receptionist: 0x2bb5a8 };
const ROLE_GEM: Record<string, number> = { owner: 0xb98a32, doctor: 0x1f7fd8, receptionist: 0x12a096 };
const colOf = (r: string) => ROLE_COL[r] ?? 0x7a86ea;
const gemOf = (r: string) => ROLE_GEM[r] ?? 0x5a66d8;

interface NodeObj {
  id: string;
  input: NodeInput;
  g: THREE.Group;
  gem: THREE.Mesh;
  back: THREE.Mesh;
  glass: THREE.Mesh;
  halo: THREE.Mesh;
  glow: THREE.Sprite;
  label: HTMLDivElement;
  target: THREE.Vector3;
  sel: number; dim: number; bump: number; ph: number;
  placed: boolean;
}
interface Pulse { g: THREE.Group; glow: THREE.Sprite; on: boolean; curve?: THREE.Curve<THREE.Vector3>; rev?: boolean; t: number; dur: number; size: number; onEnd?: () => void }
interface Ripple { m: THREE.Mesh; on: boolean; t: number; big: number }

const damp = (cur: number, tar: number, lam: number, dt: number) => cur + (tar - cur) * (1 - Math.exp(-lam * dt));

/** Diagnostics for tests / support: how many engines are alive. Contains no user data. */
/** C4: what kind of message caused a pulse. text = the C3 pulse. */
export type PulseKind = "text" | "appointment" | "patient";
type Diag = { created: number; disposed: number; running: number; pulses?: number; incoming?: number };
const diag = (): Diag => {
  const g = globalThis as unknown as { __clinicosConnect3D?: Diag };
  return (g.__clinicosConnect3D ??= { created: 0, disposed: 0, running: 0 });
};

export class TeamSpaceEngine {
  private o: EngineOptions;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 140);
  private world = new THREE.Group();
  private coreG = new THREE.Group();
  private nucleus!: THREE.Mesh;
  private coreGlow!: THREE.Sprite;
  private ringA = new THREE.Group();
  private ringB = new THREE.Group();
  private beads: { piv: THREE.Group; sp: number }[] = [];
  private shellMats: THREE.MeshPhysicalMaterial[] = [];
  private nodes = new Map<string, NodeObj>();
  private order: string[] = [];
  private lines = new Map<string, { mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3; op: number }>();
  private arc: { mesh: THREE.Mesh; curve: THREE.QuadraticBezierCurve3 } | null = null;
  private arcOp = 0;
  private pulses: Pulse[] = [];
  private ripples: Ripple[] = [];
  private moreEl: HTMLDivElement | null = null;
  private glowTex: THREE.CanvasTexture;
  private envs = new Map<boolean, THREE.Texture>();
  private shared: THREE.BufferGeometry[] = [];
  private envMats: (THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial)[] = [];

  private mode: "team" | "dm" = "team";
  private other: string | null = null;
  private meId = "";
  private dark: boolean;
  private rm: boolean;
  private frame: Frame;
  private w = 0; private h = 0;
  private raf = 0;
  private last = 0;
  private onScreen = true;
  private disposed = false;
  private lowPower = false;
  private dprCap: number;
  private perfAcc = 0; private perfN = 0;
  private fy = 0; private fp = 0; private camD = 20; private coreBump = 0; private ambientAt = 3;
  private userYaw = 0; private userPitch = 0; private dragging = false; private lastDrag = -9; private dragX = 0; private dragY = 0;
  private moving = true;
  private io?: IntersectionObserver;
  private ro?: ResizeObserver;
  private mq?: MediaQueryList;
  private readonly tmp = new THREE.Vector3();
  private cleanups: (() => void)[] = [];
  private timers = new Set<number>();

  constructor(opts: EngineOptions) {
    this.o = opts;
    this.dark = opts.dark;
    this.rm = opts.reducedMotion;
    this.dprCap = opts.variant === "band" ? 1.25 : 1.5;
    this.frame = frameFor(opts.host.clientWidth || 300, opts.host.clientHeight || 300);

    // throws when WebGL is unavailable → the caller keeps the CSS fallback
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "default" });
    if (!this.renderer.getContext()) throw new Error("no webgl");
    diag().created++;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    opts.host.insertBefore(this.renderer.domElement, opts.host.firstChild);
    const lost = (e: Event) => {
      e.preventDefault();
      this.o.onLost?.();
    };
    this.renderer.domElement.addEventListener("webglcontextlost", lost);
    this.cleanups.push(() => this.renderer.domElement.removeEventListener("webglcontextlost", lost));

    this.glowTex = this.makeGlowTexture();
    this.build();
    this.applyTheme();
    this.bindEvents();
    this.resize();
    opts.host.dataset.gl = "on";
    this.kick();
  }

  /* ------------------------------------------------------------------ public API */
  setPeople(list: NodeInput[], hidden: number) {
    if (this.disposed) return;
    const ids = new Set(list.map((p) => p.id));
    // remove nodes that left
    Array.from(this.nodes.entries()).forEach(([id, n]) => {
      if (!ids.has(id)) {
        this.world.remove(n.g);
        this.disposeNode(n);
        this.nodes.delete(id);
      }
    });
    list.forEach((p, i) => {
      let n = this.nodes.get(p.id);
      if (!n) {
        n = this.makeNode(p, i);
        this.nodes.set(p.id, n);
        this.world.add(n.g);
      } else if (n.input.role !== p.role) {
        this.recolor(n, p.role);
      }
      n.input = p;
      this.setLabelText(n);
      if (p.isMe) this.meId = p.id;
    });
    this.order = list.map((p) => p.id);
    this.layoutNodes(false);
    this.setMore(hidden);
    this.refreshClasses();
    this.kick();
  }

  setMode(mode: "team" | "dm", otherId: string | null) {
    if (this.disposed) return;
    this.mode = mode;
    this.other = mode === "dm" ? otherId : null;
    this.rebuildArc();
    this.refreshClasses();
    this.kick();
  }

  setTheme(dark: boolean) {
    if (this.disposed || dark === this.dark) return;
    this.dark = dark;
    this.applyTheme();
    this.kick();
  }

  /** "I just sent a message": a small pulse — me → peer in a private chat, me → core → team in the Clinic Team chat. */
  pulse(kind: PulseKind = "text") {
    if (this.disposed || this.rm) return;
    const me = this.nodes.get(this.meId);
    if (!me) return;
    const col = colOf(me.input.role);
    const d = diag();
    d.pulses = (d.pulses ?? 0) + 1;
    me.bump = 1;
    this.ripple(me.target, col, true);
    // C4: a shared PATIENT is a "node" pulse (the people light up, nothing travels); an APPOINTMENT is a slightly slower, brighter "connection" pulse.
    // No patient or appointment identity is ever drawn: only these generic shapes.
    if (kind === "patient") {
      const peer = this.mode === "dm" && this.other ? this.nodes.get(this.other) : undefined;
      if (peer) { this.ripple(peer.target, col, false); peer.bump = 0.9; }
      else this.coreBump = 0.6;
      this.kick();
      return;
    }
    const slow = kind === "appointment";
    if (this.mode === "dm" && this.other && this.nodes.has(this.other) && this.arc) {
      const peer = this.nodes.get(this.other)!;
      this.spawn(this.arc.curve, false, slow ? 1.3 : 0.95, col, slow ? 1.5 : 1.1, () => { this.ripple(peer.target, col, false); peer.bump = 1; });
    } else {
      const l = this.lines.get(this.meId);
      if (!l) return;
      this.spawn(l.curve, true, 0.6, col, 1.1, () => {
        this.ripple(new THREE.Vector3(0, 0, 0), 0x3b9de8, true);
        this.coreBump = 1;
        let k = 0;
        this.lines.forEach((ln, id) => {
          if (id === this.meId || k++ >= 8) return;
          this.spawn(ln.curve, false, 0.62, col, 0.85, () => { const n = this.nodes.get(id); if (n) { this.ripple(n.target, col, false); n.bump = 1; } });
        });
      });
    }
    this.kick();
  }

  /** C3 — "somebody else's message just arrived live": a SMALL pulse towards me (peer → me in a private chat, sender → core → me in the team chat). Skipped under reduced motion. */
  incoming(fromId: string | null, kind: PulseKind = "text") {
    if (this.disposed || this.rm) return;
    const me = this.nodes.get(this.meId);
    const from = fromId ? this.nodes.get(fromId) : undefined;
    if (!me || !fromId || !from) return;
    const d = diag();
    d.incoming = (d.incoming ?? 0) + 1;
    const col = colOf(from.input.role);
    from.bump = 0.7;
    if (kind === "patient") { // C4: node pulse — the sender's and my node light up, nothing travels
      this.ripple(from.target, col, false);
      me.bump = 0.7;
      this.kick();
      return;
    }
    const slow = kind === "appointment"; // C4: connection pulse
    if (this.mode === "dm" && this.other === fromId && this.arc) {
      this.spawn(this.arc.curve, true, slow ? 1.3 : 0.95, col, slow ? 1.2 : 0.8, () => { this.ripple(me.target, col, false); me.bump = 0.8; });
    } else {
      const l = this.lines.get(fromId);
      if (!l) return this.kick();
      this.spawn(l.curve, true, 0.6, col, 0.8, () => { this.ripple(new THREE.Vector3(0, 0, 0), 0x3b9de8, false); this.coreBump = 0.7; });
    }
    this.kick();
  }

  resize() {
    if (this.disposed) return;
    const r = this.o.host.getBoundingClientRect();
    const w = Math.round(r.width), h = Math.round(r.height);
    if (w < 8 || h < 8) return;
    const changed = w !== this.w || h !== this.h;
    this.w = w; this.h = h;
    const f = frameFor(w, h);
    const relayout = f.kind !== this.frame.kind || Math.abs(f.rx - this.frame.rx) > 0.01 || Math.abs(f.ry - this.frame.ry) > 0.01;
    this.frame = f;
    if (changed) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.dprCap));
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (relayout || this.lines.size === 0) {
      this.camD = f.d;
      this.layoutNodes(false);
    }
    this.nodes.forEach((n) => (n.label.dataset.w = ""));
    this.kick();
    this.placeLabels();
  }

  setReducedMotion(v: boolean) {
    this.rm = v;
    this.kick();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.timers.forEach((t) => window.clearTimeout(t));
    this.timers.clear();
    this.io?.disconnect();
    this.ro?.disconnect();
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.nodes.forEach((n) => { this.world.remove(n.g); this.disposeNode(n); n.label.remove(); });
    this.nodes.clear();
    this.clearLines();
    this.clearArc();
    this.pulses.forEach((p) => { p.glow.material.dispose(); p.g.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if (m.material && !(o instanceof THREE.Sprite)) (m.material as THREE.Material).dispose(); }); });
    this.ripples.forEach((r) => { r.m.geometry.dispose(); (r.m.material as THREE.Material).dispose(); });
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (m as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
    this.shared.forEach((g) => g.dispose());
    this.envs.forEach((t) => t.dispose());
    this.envs.clear();
    this.glowTex.dispose();
    this.moreEl?.remove();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    delete this.o.host.dataset.gl;
    const d = diag();
    d.disposed++;
    if (this.running) d.running--;
    this.running = false;
  }

  /* ------------------------------------------------------------------ scene */
  private build() {
    const T = THREE;
    this.scene.add(this.world);
    this.scene.add(new T.HemisphereLight(0xffffff, 0xa9c8e6, 0.38 * Math.PI));
    const key = new T.DirectionalLight(0xffffff, 0.55 * Math.PI); key.position.set(5, 8, 10); this.scene.add(key);
    const rim = new T.DirectionalLight(0x6fbdf5, 0.5 * Math.PI); rim.position.set(-8, 3, -7); this.scene.add(rim);

    this.world.add(this.coreG);
    this.coreGlow = new T.Sprite(new T.SpriteMaterial({ map: this.glowTex, color: 0x56a9f0, transparent: true, opacity: 0.5, depthWrite: false }));
    this.coreGlow.scale.set(6.2, 6.2, 1); this.coreGlow.renderOrder = -2; this.world.add(this.coreGlow);
    this.nucleus = new T.Mesh(new T.SphereGeometry(0.64, 40, 28), this.envMat(new T.MeshStandardMaterial({ color: 0x1c7dd6, roughness: 0.3, metalness: 0.05, emissive: 0x1668b8, emissiveIntensity: 0.5, envMapIntensity: 0.25 })));
    this.coreG.add(this.nucleus);
    const shell = new T.Mesh(new T.SphereGeometry(1.04, 56, 40), this.envMat(new T.MeshPhysicalMaterial({ color: 0xe3f1fc, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.26, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.0, depthWrite: false })));
    const shellBack = new T.Mesh(new T.SphereGeometry(1.02, 40, 28), new T.MeshPhysicalMaterial({ color: 0x4a86c0, roughness: 0.3, transparent: true, opacity: 0.3, side: T.BackSide, depthWrite: false }));
    shellBack.renderOrder = 1; shell.renderOrder = 3;
    this.coreG.add(shellBack, shell);
    this.shellMats = [shell.material as THREE.MeshPhysicalMaterial, shellBack.material as THREE.MeshPhysicalMaterial];
    const chrome = () => this.envMat(new T.MeshStandardMaterial({ color: 0xdce7f2, metalness: 1, roughness: 0.2, envMapIntensity: 1.1 }));
    this.ringA.add(new T.Mesh(new T.TorusGeometry(1.52, 0.022, 12, 140), chrome()));
    this.ringB.add(new T.Mesh(new T.TorusGeometry(1.88, 0.016, 12, 160), chrome()));
    this.ringA.rotation.set(1.15, 0, 0.35); this.ringB.rotation.set(0.45, 0.6, -0.5);
    ([[this.ringA, 1.52], [this.ringB, 1.88]] as const).forEach(([g, r], i) => {
      const bead = new T.Mesh(new T.SphereGeometry(0.07, 12, 10), new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0x6fbdf5, emissiveIntensity: 0.8, roughness: 0.3 }));
      const piv = new T.Group(); bead.position.set(r, 0, 0); piv.add(bead); g.add(piv);
      this.beads.push({ piv, sp: i ? -0.45 : 0.6 });
    });
    this.coreG.add(this.ringA, this.ringB);

    // geometries shared by every node
    const gemG = new T.SphereGeometry(0.35, 28, 20), backG = new T.SphereGeometry(0.53, 32, 24), glassG = new T.SphereGeometry(0.55, 40, 28), haloG = new T.TorusGeometry(0.78, 0.017, 8, 80);
    this.shared.push(gemG, backG, glassG, haloG);
    this.geo = { gemG, backG, glassG, haloG };
  }
  private geo!: { gemG: THREE.BufferGeometry; backG: THREE.BufferGeometry; glassG: THREE.BufferGeometry; haloG: THREE.BufferGeometry };

  private envMat<M extends THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial>(m: M): M {
    this.envMats.push(m);
    return m;
  }

  private makeNode(p: NodeInput, i: number): NodeObj {
    const T = THREE;
    const g = new T.Group();
    const gem = new T.Mesh(this.geo.gemG, this.envMat(new T.MeshStandardMaterial({ color: gemOf(p.role), roughness: 0.3, metalness: 0.05, emissive: gemOf(p.role), emissiveIntensity: 0.3, envMapIntensity: 0.25 })));
    const back = new T.Mesh(this.geo.backG, new T.MeshPhysicalMaterial({ color: 0x5e93c6, roughness: 0.3, transparent: true, opacity: 0.34, side: T.BackSide, depthWrite: false })); back.renderOrder = 1;
    const glass = new T.Mesh(this.geo.glassG, this.envMat(new T.MeshPhysicalMaterial({ color: 0xeaf5fd, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.08, envMapIntensity: 0.9, depthWrite: false }))); glass.renderOrder = 3;
    const halo = new T.Mesh(this.geo.haloG, new T.MeshBasicMaterial({ color: colOf(p.role), transparent: true, opacity: 0, depthWrite: false }));
    const glow = new T.Sprite(new T.SpriteMaterial({ map: this.glowTex, color: colOf(p.role), transparent: true, opacity: 0.12, depthWrite: false })); glow.scale.set(2.8, 2.8, 1); glow.renderOrder = -1;
    g.add(glow, back, gem, glass, halo);
    const label = document.createElement("div");
    label.className = this.o.classes.label;
    const r = document.createElement("span"); r.className = this.o.classes.role;
    const nm = document.createElement("span"); nm.className = this.o.classes.name;
    label.append(r, nm);
    this.o.labels.appendChild(label);
    return { id: p.id, input: p, g, gem, back, glass, halo, glow, label, target: new T.Vector3(), sel: 0, dim: 0, bump: 0, ph: i * 1.9, placed: false };
  }

  private recolor(n: NodeObj, role: string) {
    (n.gem.material as THREE.MeshStandardMaterial).color.setHex(gemOf(role));
    (n.gem.material as THREE.MeshStandardMaterial).emissive.setHex(gemOf(role));
    (n.halo.material as THREE.MeshBasicMaterial).color.setHex(colOf(role));
    (n.glow.material as THREE.SpriteMaterial).color.setHex(colOf(role));
  }

  private disposeNode(n: NodeObj) {
    // geometries are shared (freed in dispose()); the per-node materials are not
    [n.gem, n.back, n.glass, n.halo].forEach((m) => (m.material as THREE.Material).dispose());
    (n.glow.material as THREE.SpriteMaterial).dispose();
    this.envMats = this.envMats.filter((m) => m !== n.gem.material && m !== n.glass.material);
    n.label.remove();
  }

  private setLabelText(n: NodeObj) {
    const [r, nm] = [n.label.children[0] as HTMLElement, n.label.children[1] as HTMLElement];
    r.textContent = n.input.roleText;
    nm.textContent = n.input.label;
    n.label.dataset.w = "";
  }

  private setMore(hidden: number) {
    if (hidden <= 0) { this.moreEl?.remove(); this.moreEl = null; return; }
    if (!this.moreEl) {
      this.moreEl = document.createElement("div");
      this.moreEl.className = this.o.classes.label;
      this.moreEl.style.cssText = "left:auto;right:8px;top:auto;bottom:8px;opacity:1;transform:none";
      this.o.labels.appendChild(this.moreEl);
    }
    this.moreEl.textContent = `+${hidden}`;
  }

  private refreshClasses() {
    this.nodes.forEach((n) => {
      const sel = this.mode === "dm" && n.id === this.other;
      const dim = this.mode === "dm" && n.id !== this.other && n.id !== this.meId;
      n.label.dataset.sel = sel ? "1" : "0";
      n.label.dataset.dim = dim ? "1" : "0";
    });
  }

  /* ------------------------------------------------------------------ environment / theme */
  private makeGlowTexture() {
    const c = document.createElement("canvas"); c.width = c.height = 96;
    const g = c.getContext("2d")!;
    const gr = g.createRadialGradient(48, 48, 0, 48, 48, 48);
    gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.3, "rgba(255,255,255,.4)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  private makeEnv(dark: boolean): THREE.Texture | null {
    try {
      const T = THREE;
      const es = new T.Scene();
      es.add(new T.Mesh(new T.SphereGeometry(60, 24, 12), new T.MeshBasicMaterial({ side: T.BackSide, color: dark ? 0x0a2a48 : 0x9db7cf })));
      const box = (w: number, h: number, x: number, y: number, z: number, c: number, k: number) => {
        const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(k), side: T.DoubleSide }));
        m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m);
      };
      box(34, 20, 0, 32, 12, 0xffffff, dark ? 1.1 : 1.5);
      box(18, 34, -34, 6, 12, 0xd6ebff, dark ? 0.8 : 1.1);
      box(18, 34, 34, 2, -6, 0xffffff, dark ? 0.7 : 1.0);
      box(46, 7, 0, -28, 10, 0x8ec9ff, dark ? 0.6 : 0.8);
      const pm = new T.PMREMGenerator(this.renderer);
      const rt = pm.fromScene(es, 0.03);
      pm.dispose();
      es.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if (m.material) (m.material as THREE.Material).dispose(); });
      return rt.texture;
    } catch {
      return null;
    }
  }

  private applyTheme() {
    if (!this.envs.has(this.dark)) {
      const e = this.makeEnv(this.dark);
      if (e) this.envs.set(this.dark, e);
    }
    const env = this.envs.get(this.dark) ?? null;
    // three ≥ r163 applies material.envMapIntensity only to an explicitly assigned envMap, so assign it per material
    this.envMats.forEach((m) => { m.envMap = env; m.needsUpdate = true; });
    const lc = this.dark ? 0x6fbdf5 : 0x3b9de8;
    this.lines.forEach((l) => (l.mesh.material as THREE.MeshBasicMaterial).color.setHex(lc));
    if (this.arc) (this.arc.mesh.material as THREE.MeshBasicMaterial).color.setHex(this.dark ? 0x8cd3ff : 0x2379cc);
    (this.coreGlow.material as THREE.SpriteMaterial).color.setHex(this.dark ? 0x3f9bea : 0x56a9f0);
    (this.coreGlow.material as THREE.SpriteMaterial).opacity = this.dark ? 0.55 : 0.42;
    this.shellMats[0].opacity = this.dark ? 0.22 : 0.26;
  }

  /* ------------------------------------------------------------------ layout, lines */
  private layoutNodes(snap: boolean) {
    const pos = worldPositions(this.order.length, this.frame);
    this.order.forEach((id, i) => {
      const n = this.nodes.get(id);
      if (!n) return;
      n.target.set(pos[i][0], pos[i][1], pos[i][2]);
      if (snap || !n.placed) { n.g.position.copy(n.target); n.placed = true; }
    });
    this.rebuildLines();
  }

  private lineCurve(p: THREE.Vector3) {
    const mid = p.clone().multiplyScalar(0.5);
    const perp = new THREE.Vector3(-p.y, p.x, 0).normalize().multiplyScalar(p.length() * 0.12);
    return new THREE.QuadraticBezierCurve3(new THREE.Vector3(), mid.add(perp).add(new THREE.Vector3(0, 0, 0.5)), p.clone());
  }
  private arcCurve(a: THREE.Vector3, b: THREE.Vector3) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dist = a.distanceTo(b);
    const out = mid.length() > 0.5 ? mid.clone().normalize() : new THREE.Vector3(1, 0, 0);
    return new THREE.QuadraticBezierCurve3(a.clone(), mid.add(out.multiplyScalar(dist * 0.34)).add(new THREE.Vector3(0, 0, 0.9)), b.clone());
  }
  private clearLines() {
    this.lines.forEach((l) => { this.world.remove(l.mesh); l.mesh.geometry.dispose(); (l.mesh.material as THREE.Material).dispose(); });
    this.lines.clear();
  }
  private rebuildLines() {
    this.clearLines();
    const col = this.dark ? 0x6fbdf5 : 0x3b9de8;
    this.nodes.forEach((n, id) => {
      const curve = this.lineCurve(n.target);
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.017, 5, false), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.3, depthWrite: false }));
      mesh.renderOrder = -1; this.world.add(mesh);
      this.lines.set(id, { mesh, curve, op: 0.3 });
    });
    this.rebuildArc();
  }
  private clearArc() {
    if (!this.arc) return;
    this.world.remove(this.arc.mesh); this.arc.mesh.geometry.dispose(); (this.arc.mesh.material as THREE.Material).dispose(); this.arc = null;
  }
  private rebuildArc() {
    this.clearArc();
    const me = this.nodes.get(this.meId), peer = this.other ? this.nodes.get(this.other) : null;
    if (this.mode !== "dm" || !me || !peer) return;
    const curve = this.arcCurve(me.target, peer.target);
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.03, 6, false), new THREE.MeshBasicMaterial({ color: this.dark ? 0x8cd3ff : 0x2379cc, transparent: true, opacity: 0, depthWrite: false }));
    this.world.add(mesh); this.arc = { mesh, curve }; this.arcOp = 0;
  }

  /* ------------------------------------------------------------------ pulses */
  private spawn(curve: THREE.Curve<THREE.Vector3>, rev: boolean, dur: number, color: number, size: number, onEnd?: () => void) {
    if (this.rm) { if (onEnd) this.later(onEnd, 120); return; }
    let p = this.pulses.find((x) => !x.on);
    if (!p) {
      if (this.pulses.length >= 12) return;
      const g = new THREE.Group();
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x3b9de8, transparent: true, opacity: 0.9, depthWrite: false })); glow.scale.set(0.9, 0.9, 1);
      g.add(glow, core); g.visible = false; this.world.add(g);
      p = { g, glow, on: false, t: 0, dur: 1, size: 1 }; this.pulses.push(p);
    }
    p.on = true; p.curve = curve; p.rev = rev; p.dur = dur; p.t = 0; p.size = size; p.onEnd = onEnd;
    (p.glow.material as THREE.SpriteMaterial).color.setHex(color); p.g.visible = false;
  }
  private ripple(at: THREE.Vector3, color: number, big: boolean) {
    if (this.rm) return;
    let r = this.ripples.find((x) => !x.on);
    if (!r) {
      if (this.ripples.length >= 8) return;
      const m = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.02, 6, 56), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false; this.world.add(m); r = { m, on: false, t: 0, big: 1 }; this.ripples.push(r);
    }
    r.on = true; r.t = 0; r.big = big ? 1.15 : 1; r.m.position.copy(at); (r.m.material as THREE.MeshBasicMaterial).color.setHex(color); r.m.visible = true;
  }
  private later(fn: () => void, ms: number) {
    const id = window.setTimeout(() => { this.timers.delete(id); if (!this.disposed) fn(); }, ms);
    this.timers.add(id);
  }

  /* ------------------------------------------------------------------ frame */
  private update(dt: number, time: number) {
    const lowMotion = this.rm || this.lowPower;
    let moving = false;
    const k = lowMotion ? 1 : 1 - Math.exp(-6 * dt);
    const fl = lowMotion ? 1 : 1 - Math.exp(-3.2 * dt);
    const peer = this.mode === "dm" && this.other ? this.nodes.get(this.other) : undefined;

    let fyT = 0, fpT = 0, focus = 0;
    if (peer) {
      const p = peer.target;
      fyT = -(p.x / Math.max(this.frame.rx, 1)) * (this.frame.kind === "band" ? 0.14 : 0.34);
      fpT = (p.y / Math.max(this.frame.ry || 3.4, 1)) * 0.2; focus = 1;
    }
    if (!this.dragging && time - this.lastDrag > 1.2) {
      const ny = lowMotion ? 0 : damp(this.userYaw, 0, 1.8, dt), np = lowMotion ? 0 : damp(this.userPitch, 0, 1.8, dt);
      if (Math.abs(ny) > 0.0005 || Math.abs(np) > 0.0005) moving = true;
      this.userYaw = ny; this.userPitch = np;
    }
    this.fy += (fyT - this.fy) * fl; this.fp += (fpT - this.fp) * fl;
    if (Math.abs(fyT - this.fy) > 0.001 || Math.abs(fpT - this.fp) > 0.001) moving = true;
    this.world.rotation.y = this.fy + this.userYaw + (lowMotion ? 0 : Math.sin(time * 0.33) * 0.09);
    this.world.rotation.x = this.fp + this.userPitch + (lowMotion ? 0 : Math.sin(time * 0.27) * 0.03);
    this.camD += (this.frame.d * (1 - 0.055 * focus) - this.camD) * fl;
    this.camera.position.set(0, this.camD * 0.1, this.camD); this.camera.lookAt(0, 0, 0);

    this.coreBump *= Math.exp(-3 * dt);
    if (this.coreBump > 0.01) moving = true;
    if (!lowMotion) {
      this.ringA.rotation.z += dt * 0.12; this.ringB.rotation.y += dt * -0.09; this.coreG.rotation.y += dt * 0.08;
      this.beads.forEach((b) => { b.piv.rotation.z += dt * b.sp; });
      this.coreG.position.y = Math.sin(time * 0.8) * 0.08;
    }
    (this.nucleus.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + this.coreBump * 0.9 + (lowMotion ? 0 : Math.sin(time * 1.6) * 0.08);
    this.coreG.scale.setScalar(1 + this.coreBump * 0.07);

    this.nodes.forEach((n) => {
      const isOther = !!peer && n.id === this.other, isMe = n.id === this.meId;
      const selT = isOther ? 1 : this.mode === "dm" && isMe ? 0.3 : 0;
      const dimT = this.mode === "dm" ? (isOther || isMe ? 0 : 0.5) : 0;
      n.sel += (selT - n.sel) * k; n.dim += (dimT - n.dim) * k; n.bump *= Math.exp(-3.4 * dt);
      if (Math.abs(selT - n.sel) > 0.002 || Math.abs(dimT - n.dim) > 0.002 || n.bump > 0.01) moving = true;
      n.g.position.x += (n.target.x - n.g.position.x) * fl;
      n.g.position.z += (n.target.z - n.g.position.z) * fl;
      n.g.position.y += (n.target.y + (lowMotion ? 0 : Math.sin(time * 0.9 + n.ph) * 0.11) - n.g.position.y) * fl;
      if (Math.abs(n.target.x - n.g.position.x) > 0.002 || Math.abs(n.target.y - n.g.position.y) > 0.002) moving = true;
      n.g.scale.setScalar((1 + 0.26 * n.sel) * (1 - 0.15 * n.dim) * (1 + 0.16 * n.bump));
      (n.glass.material as THREE.MeshPhysicalMaterial).opacity = 0.3 * (1 - 0.45 * n.dim);
      (n.back.material as THREE.MeshPhysicalMaterial).opacity = 0.34 * (1 - 0.5 * n.dim);
      (n.gem.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.3 + 0.45 * n.sel + 0.7 * n.bump;
      (n.halo.material as THREE.MeshBasicMaterial).opacity = Math.min(1, n.sel * 0.85);
      n.halo.quaternion.copy(this.world.quaternion).invert().multiply(this.camera.quaternion);
      (n.glow.material as THREE.SpriteMaterial).opacity = (0.1 + 0.28 * n.sel + 0.3 * n.bump) * (1 - 0.6 * n.dim);
    });

    this.lines.forEach((l, id) => {
      const faded = this.mode === "dm" && id !== this.other && id !== this.meId;
      const tgt = this.mode === "dm" ? (faded ? 0.07 : 0.2) : 0.36;
      l.op += (tgt - l.op) * k; (l.mesh.material as THREE.MeshBasicMaterial).opacity = l.op;
    });
    if (this.arc) { this.arcOp += (0.85 - this.arcOp) * k; (this.arc.mesh.material as THREE.MeshBasicMaterial).opacity = this.arcOp; if (this.arcOp < 0.84) moving = true; }

    this.pulses.forEach((p) => {
      if (!p.on) return;
      moving = true;
      p.t += dt / p.dur;
      if (p.t >= 1) { p.on = false; p.g.visible = false; p.onEnd?.(); return; }
      const e = p.t * p.t * (3 - 2 * p.t);
      p.g.position.copy(p.curve!.getPoint(p.rev ? 1 - e : e)); p.g.visible = true;
      p.g.scale.setScalar((0.45 + 0.55 * Math.sin(Math.PI * p.t)) * p.size);
    });
    this.ripples.forEach((r) => {
      if (!r.on) return;
      moving = true;
      r.t += dt / 0.95;
      if (r.t >= 1) { r.on = false; r.m.visible = false; return; }
      const e = 1 - Math.pow(1 - r.t, 2.2);
      r.m.scale.setScalar((0.8 + e * 1.15) * r.big); (r.m.material as THREE.MeshBasicMaterial).opacity = (1 - r.t) * 0.7;
      r.m.quaternion.copy(this.world.quaternion).invert().multiply(this.camera.quaternion);
    });

    // rare, tiny "the team is connected" breath: core → one node, every 5–8 s (never in reduced motion / low power)
    if (!lowMotion && time > this.ambientAt && this.nodes.size > 1) {
      this.ambientAt = time + 5 + Math.random() * 3;
      const ids = Array.from(this.lines.keys());
      const id = ids[Math.floor(Math.random() * ids.length)];
      const l = this.lines.get(id), n = this.nodes.get(id);
      if (l && n) this.spawn(l.curve, false, 1.4, colOf(n.input.role), 0.6);
    }
    this.moving = moving;
  }

  private placeLabels() {
    const W = this.w, H = this.h;
    if (!W || !H) return;
    const band = this.frame.kind === "band";
    this.nodes.forEach((n) => {
      const el = n.label;
      this.tmp.setFromMatrixPosition(n.g.matrixWorld);
      const dist = this.camera.position.distanceTo(this.tmp);
      const unit = H / (2 * Math.tan((15 * Math.PI) / 180) * dist);
      const r = 0.52 * n.g.scale.x * unit;
      this.tmp.project(this.camera);
      let x = (this.tmp.x * 0.5 + 0.5) * W;
      let y = (-this.tmp.y * 0.5 + 0.5) * H + r + 4;
      const lh = el.offsetHeight || 26;
      if (band && n.target.y > 0) y = (-this.tmp.y * 0.5 + 0.5) * H - r - 4 - lh;
      const lw = el.offsetWidth || 70;
      x = Math.max(lw / 2 + 4, Math.min(W - lw / 2 - 4, x));
      y = Math.max(2, Math.min(H - lh - 2, y));
      const tf = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translateX(-50%)`;
      if (el.style.transform !== tf) el.style.transform = tf;
      if (el.dataset.ready !== "1") el.dataset.ready = "1";
    });
  }

  private running = false;
  private loop = (ts: number) => {
    this.raf = 0;
    if (this.disposed || !this.onScreen || document.hidden) { this.setRunning(false); return; }
    const time = ts / 1000;
    const raw = this.last ? Math.max(0, time - this.last) : 0.016;
    const dt = Math.min(0.05, raw);
    this.last = time;
    this.update(dt, time);
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    // adaptive quality: lower the resolution first, then stop idle animation, if the frame rate is poor
    this.perfAcc += Math.min(0.25, raw); this.perfN++;
    if (this.perfAcc > 1.5) {
      const fps = this.perfN / this.perfAcc;
      if (fps < 28 && !this.lowPower) {
        if (this.dprCap > 1) this.dprCap = 1; else if (this.dprCap > 0.7) this.dprCap = 0.7; else this.lowPower = true;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.dprCap));
        this.renderer.setSize(this.w, this.h, false);
      }
      this.perfAcc = 0; this.perfN = 0;
    }
    const idleAnim = !(this.rm || this.lowPower);
    if (idleAnim || this.moving || this.dragging) this.raf = requestAnimationFrame(this.loop);
    else this.setRunning(false);
  };
  private setRunning(v: boolean) {
    if (v === this.running) return;
    this.running = v;
    diag().running += v ? 1 : -1;
  }
  private kick() {
    if (this.disposed || this.raf || !this.onScreen || document.hidden) return;
    this.last = 0;
    this.setRunning(true);
    this.raf = requestAnimationFrame(this.loop);
  }

  /* ------------------------------------------------------------------ events */
  private bindEvents() {
    const host = this.o.host;
    this.io = new IntersectionObserver((es) => { this.onScreen = es[es.length - 1].isIntersecting; if (this.onScreen) this.kick(); }, { threshold: 0.01 });
    this.io.observe(host);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    const vis = () => { if (!document.hidden) this.kick(); };
    document.addEventListener("visibilitychange", vis);
    this.cleanups.push(() => document.removeEventListener("visibilitychange", vis));
    this.mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const rmChange = () => this.setReducedMotion(this.mq!.matches);
    this.mq.addEventListener("change", rmChange);
    this.cleanups.push(() => this.mq?.removeEventListener("change", rmChange));

    // slight, controlled rotation by dragging (springs back); vertical page scroll is left to the browser (touch-action: pan-y)
    const down = (e: PointerEvent) => { this.dragging = true; this.dragX = e.clientX; this.dragY = e.clientY; host.setPointerCapture?.(e.pointerId); this.kick(); };
    const move = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.userYaw = Math.max(-0.55, Math.min(0.55, this.userYaw + (e.clientX - this.dragX) * 0.006));
      this.userPitch = Math.max(-0.3, Math.min(0.3, this.userPitch + (e.clientY - this.dragY) * 0.004));
      this.dragX = e.clientX; this.dragY = e.clientY; this.kick();
    };
    const up = () => { if (this.dragging) { this.dragging = false; this.lastDrag = this.last || performance.now() / 1000; this.kick(); } };
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerup", up);
    host.addEventListener("pointercancel", up);
    this.cleanups.push(() => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerup", up);
      host.removeEventListener("pointercancel", up);
    });
  }
}

/** True when this browser can create a WebGL context (cheap probe on a throw-away canvas). */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
    (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}
