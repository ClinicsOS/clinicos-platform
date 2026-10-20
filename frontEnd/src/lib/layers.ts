/**
 * PHASE 6 — the ONE z-index scale of the app (global layers only).
 *
 * Why: before this, 14 ad-hoc values (30 … 120) competed. The worst effect: Nabd (z-50) shared its layer with the standard Modal (z-50) and, being
 * rendered after the page, painted ABOVE modals and the mobile navigation drawer.
 *
 * Use the Tailwind utilities generated from this file (tailwind.config.ts → theme.extend.zIndex), e.g. `z-modal`, `z-toast`, `z-nabd`.
 * Tiny local stacking inside ONE component (a badge over a card, an overlay inside a canvas wrapper) keeps using `z-0 … z-30` — those never
 * leave their own stacking context's neighbourhood and are intentionally not part of this scale.
 *
 * Order (low → high):
 *   raised    local lift inside a page (sticky table header, floating chart controls)
 *   dropdown  absolutely-positioned menus / popovers anchored to a control (date picker, specialty selector, notification bell)
 *   nabd      the Nabd AI launcher and its chat window — above page content and dropdowns, BELOW every drawer / dialog
 *   popover   fixed-position transient menus that must escape clipping (print/export menus) — above Nabd so no option can hide under the launcher
 *   drawer    mobile navigation drawer, bottom sheets (tooth panel, multi-select, derm map) + their backdrops
 *   modal     blocking dialogs
 *   dialog    confirm / destructive-action dialogs (may open on top of a modal)
 *   toast     notifications — always visible; the container itself is pointer-events:none
 */
export const LAYERS = {
  raised: 20,
  dropdown: 30,
  nabd: 40,
  popover: 50,
  drawer: 60,
  modal: 70,
  dialog: 80,
  toast: 90,
} as const;

export type LayerName = keyof typeof LAYERS;
