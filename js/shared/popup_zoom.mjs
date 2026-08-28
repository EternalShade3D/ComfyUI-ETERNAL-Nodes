// Shared: make a document.body popup track the canvas zoom, grow to fit its
// content, and land next to its anchor without poking off screen.
//
// WHY THIS IS SHARED (node UI convention #27, user-locked 2026-07-31 and
// restated 2026-08-02 as "all nodes should have that"): a popup opened by a
// node is `position:fixed` on document.body, so it inherits NO canvas
// transform. At working zooms above 100% the node's own DOM row grows with the
// graph while a fixed 12px popup reads tiny beside it. Dropdown Pixaroma solved
// it first; this module is that proven implementation promoted verbatim so
// every future picker gets it for free instead of re-deriving the traps.
//
// THE THREE TRAPS, all of which cost a round on Dropdown:
//  1. The zoom font and grow-to-fit only work TOGETHER. Scaled text inside a
//     popup still locked to its anchor's width re-cuts the very names the
//     growth was added to reveal. Set both or neither.
//  2. Set the font BEFORE measuring. The flip-above branch reads offsetHeight,
//     and offsetHeight depends on the font that is already applied.
//  3. A grown popup can poke past the window's right edge (an anchor-width
//     popup never could), so `left` must be clamped AFTER the width is known.
//
// NOT for floating SETTINGS panels (.pix-ddp, the Sizes / Sliders / Run Timer
// panels). Those are workbenches beside the canvas, not part of a node, and
// deliberately keep a constant size.

import { app } from "/scripts/app.js";

// 12px matches Show Text's readout and the native node widgets - the size a
// Pixaroma row is at 100% zoom.
export const POPUP_BASE_FONT_PX = 12;
// Floor 1: a popup you opened to READ must not shrink with the graph when you
// zoom out. Cap 2.5: keeps a deep zoom-in from producing poster text.
export const POPUP_ZOOM_MIN = 1;
export const POPUP_ZOOM_MAX = 2.5;

// The clamped canvas scale this module sizes against. Defensive against a
// missing/!finite/zero scale (an early call before the canvas exists).
export function popupZoom() {
  const s = Number(app.canvas?.ds?.scale);
  if (!isFinite(s) || s <= 0) return 1;
  return Math.min(POPUP_ZOOM_MAX, Math.max(POPUP_ZOOM_MIN, s));
}

// Size the popup's ROOT font from the zoom. The popup's inner sizes (text, row
// padding, gaps) MUST be authored in em so this one number scales them
// together - putting px back on the rows silently opts that row out.
// `baseMaxHeightPx` scales the scroll height the same way; it is applied only
// when zoomed IN so the stylesheet's own max-height still governs at 100%.
export function applyPopupZoom(pop, opts = {}) {
  const zoom = popupZoom();
  const base = opts.baseFontPx || POPUP_BASE_FONT_PX;
  pop.style.fontSize = Math.round(base * zoom * 10) / 10 + "px";
  if (opts.baseMaxHeightPx) {
    if (zoom > 1) {
      const vh = opts.maxHeightVh == null ? 0.6 : opts.maxHeightVh;
      pop.style.maxHeight =
        Math.round(Math.min(opts.baseMaxHeightPx * zoom, window.innerHeight * vh)) + "px";
    } else {
      // Cleared, not left alone: both callers today build a fresh element per
      // open, but a caller that REUSES one popup would otherwise keep a stale
      // zoomed max-height after the user zoomed back out. At zoom 1 the
      // stylesheet's own max-height is the right answer.
      pop.style.maxHeight = "";
    }
  }
  return zoom;
}

// Zoom + grow-to-fit + place, in the one order that works. Call it AFTER the
// popup's rows are in it and it is in the document (it measures), and pass the
// element the popup belongs to. Returns the zoom actually used.
//
//   baseFontPx        root font at 100% zoom (default 12)
//   baseMaxHeightPx   scroll height at 100% zoom (omit to leave it to CSS)
//   maxHeightVh       viewport fraction ceiling for the above (default .6)
//   minWidthPx        hard floor for the width (default 200)
//   baseMaxWidthPx    width ceiling at 100% zoom, scaled by zoom
//                     (omit and it still caps at 90vw, never uncapped)
//   anchorWidthIsMin  anchor width becomes min-width (default true)
//   gap               px between anchor and popup (default 4)
//   margin            px kept clear of the viewport edges (default 8)
export function placeZoomedPopup(pop, anchorEl, opts = {}) {
  // Trap 2: font first - everything below measures.
  const zoom = applyPopupZoom(pop, opts);

  const r = anchorEl.getBoundingClientRect();
  const margin = opts.margin == null ? 8 : opts.margin;
  const gap = opts.gap == null ? 4 : opts.gap;

  // Trap 1: the anchor's width is the MINIMUM, never the width. Content grows
  // the popup so long names show in full.
  //
  // ⚠ Trap 4 (found by testing at 1.8x zoom on a 900-wide node): CSS min-width
  // BEATS max-width. The anchor's rect is in SCREEN px, so on a wide node at a
  // high zoom it can exceed the cap - a 1409px popup on a 1350px window, hanging
  // off the right edge with the left clamp unable to save it. The ceiling has to
  // be worked out FIRST and the floor clamped under it.
  // Always APPLY the ceiling, not just compute it. Omitting baseMaxWidthPx used
  // to mean the 90vw figure was used to clamp min-width but never enforced as a
  // real max-width, so a long-content popup could still outgrow the window and
  // the left clamp would then pin it at `margin` with its right edge off screen.
  const maxW = opts.baseMaxWidthPx
    ? Math.min(Math.round(window.innerWidth * 0.9), Math.round(opts.baseMaxWidthPx * zoom))
    : Math.round(window.innerWidth * 0.9);
  pop.style.maxWidth = maxW + "px";
  if (opts.anchorWidthIsMin !== false) {
    const wantMin = Math.max(opts.minWidthPx || 200, Math.round(r.width));
    pop.style.minWidth = Math.min(wantMin, maxW) + "px";
  }

  // Trap 3: clamp left only once the grown width is measurable.
  const pw = pop.offsetWidth;
  let left = Math.round(r.left);
  if (left + pw > window.innerWidth - margin) left = Math.max(margin, window.innerWidth - margin - pw);
  pop.style.left = left + "px";

  // Flip above when there is not room below.
  const h = pop.offsetHeight;
  const below = window.innerHeight - r.bottom;
  pop.style.top = (below < h + margin && r.top > h + margin)
    ? Math.round(r.top - h - gap) + "px"
    : Math.round(r.bottom + gap) + "px";

  return zoom;
}
