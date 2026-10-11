// CLINICOS CONNECT (C2) — pure layout maths for the Team Space (no three.js, no DOM): which staff become nodes, and where.
// Shared by the 3D engine and the CSS/SVG fallback so both show the same composition. Unit-tested under node:test.
export interface TeamPerson {
  id: string;
  name: string;
  role: string;
}

export const MAX_NODES = 12;
const ROLE_ORDER: Record<string, number> = { owner: 0, doctor: 1, receptionist: 2 };

/**
 * Who is drawn: you first (top of the ring), then colleagues by role (owner, doctors, reception) and name. At most MAX_NODES; if
 * the person you are chatting with would fall outside the cut, they are brought in. `hidden` counts the colleagues not drawn.
 * Only staff the server already lists for every role (name + role) are used — never anything about conversations.
 */
export function orderPeople(me: TeamPerson, others: TeamPerson[], peerId: string | null, cap: number = MAX_NODES): { shown: TeamPerson[]; hidden: number } {
  const sorted = others
    .filter((p) => p.id !== me.id)
    .slice()
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name));
  const room = Math.max(0, cap - 1);
  let take = sorted.slice(0, room);
  if (peerId && !take.some((p) => p.id === peerId)) {
    const peer = sorted.find((p) => p.id === peerId);
    if (peer && room > 0) take = [...take.slice(0, room - 1), peer];
  }
  return { shown: [me, ...take], hidden: Math.max(0, sorted.length - take.length) };
}

export type FrameKind = "panel" | "band";
export interface Frame {
  kind: FrameKind;
  /** camera distance (fov 30°) */
  d: number;
  rx: number;
  ry: number;
}

const TAN15 = Math.tan((15 * Math.PI) / 180);

/** Camera distance + spread radii that keep every node and its label inside a w×h stage. */
export function frameFor(w: number, h: number): Frame {
  const a = w / Math.max(1, h);
  if (a >= 1.9 || h < 220) {
    const halfH = 2.3;
    const halfW = halfH * a;
    return { kind: "band", d: halfH / TAN15, rx: Math.max(1.2, Math.min(6.2, halfW - 1.1)), ry: 0.4 };
  }
  const halfH = 4.6;
  const halfW = halfH * a;
  return { kind: "panel", d: halfH / TAN15, rx: Math.max(1.6, Math.min(3.7, halfW - 1.25)), ry: Math.max(1.8, Math.min(3.1, halfH - 1.5)) };
}

/** Node positions in world units. Index 0 (you) is at the top of the ring / the left of the band. */
export function worldPositions(n: number, f: Frame): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const z = Math.sin(i * 2.3) * 0.9;
    if (f.kind === "band") {
      const x = n === 1 ? 0 : -f.rx + (i * 2 * f.rx) / (n - 1);
      out.push([x, i % 2 ? -f.ry : f.ry, z * 0.6]);
    } else {
      const th = Math.PI / 2 - (i * 2 * Math.PI) / n;
      out.push([f.rx * Math.cos(th), f.ry * Math.sin(th), z]);
    }
  }
  return out;
}

/** The same composition for the 2D fallback, as percentages of the stage: [x%, y%] plus the core. */
export function fallbackPositions(n: number, kind: FrameKind): { core: [number, number]; nodes: [number, number][] } {
  const nodes: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (kind === "band") {
      nodes.push([n === 1 ? 50 : 9 + (i * 82) / (n - 1), i % 2 ? 66 : 34]);
    } else {
      const th = Math.PI / 2 - (i * 2 * Math.PI) / n;
      nodes.push([50 + 36 * Math.cos(th), 46 - 33 * Math.sin(th)]);
    }
  }
  return { core: kind === "band" ? [50, 50] : [50, 46], nodes };
}
