import { toothDims } from "../engine/toothGeometry";
import type { ToothMeta } from "@/lib/dental/fdi";

/**
 * Layout of the tooth PICKER: two perfectly straight rows (upper above, lower below) in clinical view order,
 * exactly like the doctor's sketch — 18…11 | 21…28 on top, 48…41 | 31…38 below.
 *
 * Teeth are laid out by COLUMN: a column is one arch position (side × position, e.g. -6 = patient-right first molar),
 * shared by the upper and lower tooth. A column is as wide as its widest tooth, so upper and lower teeth line up
 * vertically and every row has the same rhythm. Teeth keep their real proportions (incisors narrow, molars wide).
 * Pure (no three.js scene) so it can be tested headlessly.
 */
export const GAP = 0.2; // between neighbouring teeth
export const MID_GAP = 0.44; // extra room at the midline (the divider in the doctor's sketch)
export const OCCLUSAL_GAP = 0.36; // between the longest crowns of the two rows
export const SLAB_H = 0.78; // height of the gum band
export const SLAB_OVERHANG = 0.4; // gum band sticks out past the last tooth
export const LABEL_BAND = 0.62; // room for the FDI numbers above / below the gum bands

export interface PickerColumn { key: number; x: number; w: number }
export interface PickerCell { fdi: string; meta: ToothMeta; col: number; x: number; row: 0 | 1 } // row 0 = upper, 1 = lower

export interface PickerLayout {
  columns: PickerColumn[];
  cells: PickerCell[];
  /** y of the cemento-enamel line: upper row at +cej, lower row at -cej (the chart is symmetric about y = 0). */
  cej: number;
  /** half-extents of everything the chart draws (gum bands + labels) */
  halfW: number;
  halfH: number;
  /** x extent of the gum bands */
  slabHalfW: number;
}

export function layoutTeeth(teeth: readonly ToothMeta[]): PickerLayout {
  const byKey = new Map<number, { w: number }>();
  let maxTip = 1;
  for (const m of teeth) {
    const d = toothDims(m);
    const key = m.side * m.position;
    const cur = byKey.get(key);
    byKey.set(key, { w: Math.max(cur?.w ?? 0, d.w) });
    maxTip = Math.max(maxTip, d.tip);
  }
  const keys = Array.from(byKey.keys()).sort((a, b) => a - b);
  const columns: PickerColumn[] = [];
  let cursor = 0;
  keys.forEach((key, i) => {
    const w = byKey.get(key)!.w + GAP;
    if (i > 0 && keys[i - 1] < 0 && key > 0) cursor += MID_GAP; // the midline
    columns.push({ key, x: cursor + w / 2, w });
    cursor += w;
  });
  const total = cursor;
  columns.forEach((c) => { c.x -= total / 2; }); // centred on x = 0

  const colIndex = new Map(columns.map((c, i) => [c.key, i]));
  const cells: PickerCell[] = teeth.map((m) => {
    const col = colIndex.get(m.side * m.position)!;
    return { fdi: m.fdi, meta: m, col, x: columns[col].x, row: m.jaw === "upper" ? 0 : 1 };
  });
  cells.sort((a, b) => a.row - b.row || a.col - b.col);

  const cej = OCCLUSAL_GAP / 2 + maxTip;
  const slabHalfW = total / 2 + SLAB_OVERHANG;
  return { columns, cells, cej, halfW: slabHalfW + 0.3, halfH: cej + SLAB_H + LABEL_BAND, slabHalfW };
}

/** Which cell sits under a point in chart space (x right, y up). Anywhere inside a column counts — no pixel-hunting. */
export function cellAt(layout: PickerLayout, x: number, y: number): PickerCell | null {
  if (Math.abs(y) > layout.halfH || Math.abs(x) > layout.halfW) return null;
  const row: 0 | 1 = y >= 0 ? 0 : 1;
  // Columns tile the row edge to edge, so the column is the one whose [left, right] span holds x. In the midline gap and in
  // the gum overhang there is no span: use the closest edge (never "closest centre": columns have different widths).
  let best = -1, bestD = Infinity;
  layout.columns.forEach((c, i) => {
    const d = x < c.x - c.w / 2 ? c.x - c.w / 2 - x : x > c.x + c.w / 2 ? x - (c.x + c.w / 2) : 0;
    if (d < bestD || (d === bestD && d > 0 && Math.abs(x - c.x) < Math.abs(x - layout.columns[best].x))) { bestD = d; best = i; }
  });
  if (best < 0) return null;
  return layout.cells.find((c) => c.col === best && c.row === row) ?? null;
}
