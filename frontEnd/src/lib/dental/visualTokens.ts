/**
 * Dental chart colour tokens — the SINGLE source for the two restorations a doctor has to tell apart at a glance.
 * The 3D engine (toothVisual.ts), the 2D fallback grid and the chart legend all read these numbers, so the legend can
 * never say one colour while the tooth shows another.
 *
 * Palette audit (colours already carrying a meaning on the chart — none of them is reused here):
 *   amber  #E8A93C  diagnosis marker          red    #E0685E  abscess
 *   sky    #6CB6E8  status: planned           purple #B49BFF  status: in progress      green #62D39A  status: treated
 *   teal   #4FC3B8  selection rim / UI accent
 *
 * Crown   = GOLD  + WHOLE-crown coverage (cap / full outline)  -> the doctor sees "the entire tooth is restored"
 * Filling = COBALT + LOCAL dome on the treated surface(s) only -> the doctor sees "only this surface is restored"
 * Colour is never the only cue: coverage (whole crown vs one surface) and style (ghost = planned, solid = done) carry it too.
 */
export const CROWN_HEX = 0xd9a21b;
export const FILLING_HEX = 0x2f6fe4;

export const hexCss = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
export const CROWN_CSS = hexCss(CROWN_HEX);
export const FILLING_CSS = hexCss(FILLING_HEX);
