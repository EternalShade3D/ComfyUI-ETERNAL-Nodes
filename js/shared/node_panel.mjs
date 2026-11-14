// Shared plumbing for a node's FLOATING SETTINGS PANEL: where it opens, how it
// follows its node, and how it is dragged.
//
// Extracted from js/save_image/settings.mjs on 2026-08-10 when Save Video
// Pixaroma needed the same panel. Deliberately NOT a whole panel component -
// each node keeps its own singleton state, its own CSS prefix and its own rows.
// What is shared here is only the part that carries recorded bug fixes:
//
//   * makeDraggable    - setPointerCapture AND the buttons-are-up guard, or a
//                        LOST pointerup leaves the panel stuck to the cursor
//                        forever (convention #20). Synthetic events never
//                        reproduce it, so it only ever arrives as a human bug
//                        report.
//   * followNode       - a rAF loop, because LiteGraph emits nothing for a
//                        transform change (convention #29), and its liveness
//                        check uses `node.graph || app.graph` because app.graph
//                        holds only TOP-LEVEL nodes, so a node inside a
//                        subgraph failed the identity test on the very first
//                        tick and silently switched the follow off.
//
// Both of those cost a review round each. Do not re-roll them per node.

import { app } from "/scripts/app.js";
import { isVueNodes } from "./nodes2.mjs";

// Screen-pixel rect of the node (DOM in Nodes 2.0, geometry math in legacy) so
// a panel can open BESIDE the node instead of on top of it.
export function getNodeScreenRect(node) {
  if (isVueNodes() && node && node.id != null) {
    const elx = document.querySelector('[data-node-id="' + node.id + '"]');
    if (elx) return elx.getBoundingClientRect();
  }
  const c = app.canvas;
  const ds = c && c.ds;
  const canvasEl = c && c.canvas;
  if (!ds || !canvasEl || !node || !node.pos || !node.size) return null;
  const cr = canvasEl.getBoundingClientRect();
  const titleH = (window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 30;
  const scale = ds.scale || 1;
  const off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * scale;
  const top = cr.top + (node.pos[1] - titleH + off[1]) * scale;
  const width = node.size[0] * scale;
  const height = (node.size[1] + titleH) * scale;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

export function placeBeside(panel, rect) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const mw = panel.offsetWidth;
  const mh = panel.offsetHeight;
  const gap = 12;
  const pad = 8;
  if (!rect) {
    panel.style.left = Math.max(pad, (vw - mw) / 2) + "px";
    panel.style.top = Math.max(pad, (vh - mh) / 2) + "px";
    return;
  }
  let left = rect.right + gap;
  if (left + mw > vw - pad) left = rect.left - gap - mw;
  if (left < pad) left = Math.max(pad, vw - mw - pad);
  let top = rect.top;
  if (top + mh > vh - pad) top = vh - mh - pad;
  if (top < pad) top = pad;
  panel.style.left = left + "px";
  panel.style.top = top + "px";
}

// Follow the node as the canvas is zoomed or panned (convention #29).
//
// `isCurrent()` lets the caller keep owning its own singleton: the loop stops as
// soon as that returns false. `isUserMoved()` is asked every tick rather than
// captured, so a drag mid-flight stops the following immediately.
//
// Returns a stop function. The idle cost is three comparisons, and it only runs
// while a panel is open.
export function followNode(panel, node, { isCurrent, isUserMoved }) {
  let raf = null;
  let lastScale = null, lastX = null, lastY = null;
  const tick = () => {
    if (!panel.isConnected || (isCurrent && !isCurrent())) { raf = null; return; }
    // Stop if the NODE is gone. `node.graph || app.graph`, NOT app.graph:
    // app.graph holds only TOP-LEVEL nodes, so for a node inside a subgraph the
    // identity test failed on the first tick and killed the follow while the
    // panel and node were both plainly on screen. A removed node has its
    // `graph` nulled, so this still catches the case the check exists for.
    if ((node.graph || app.graph)?.getNodeById?.(node.id) !== node) { raf = null; return; }
    raf = requestAnimationFrame(tick);
    if (isUserMoved && isUserMoved()) return; // dragged on purpose: leave it there
    const ds = app.canvas?.ds;
    if (!ds) return;
    const sc = ds.scale || 1;
    const ox = ds.offset?.[0] ?? 0, oy = ds.offset?.[1] ?? 0;
    if (sc === lastScale && ox === lastX && oy === lastY) return;
    lastScale = sc; lastX = ox; lastY = oy;
    placeBeside(panel, getNodeScreenRect(node));
  };
  raf = requestAnimationFrame(tick);

  // The panel's own HEIGHT is the other thing that can push it off screen, and
  // it changes without the canvas moving at all: every one of these panels
  // opens saying "Loading..." and grows when its content arrives, so the
  // placement made at open time was measured against a panel a fraction of its
  // final size and nothing re-placed it. Measured: an 871px panel in a 1270px
  // window, placed at top 684, hanging 285px off the bottom. Reported as "if it
  // doesn't have enough room it is cut, I have to zoom in and out to readjust"
  // - zooming appeared to fix it because the loop above then re-placed it.
  //
  // A ResizeObserver rather than a per-frame `offsetHeight` read, for two
  // reasons: reading offsetHeight every animation frame forces layout every
  // animation frame for the whole time a panel is open, and the rAF version
  // only corrected on the NEXT tick, which was a visible jump - measured at
  // about a second in the in-app browser, whose frames are throttled. This
  // fires the moment the size actually changes (Vue Compat #13).
  //
  // It cannot oscillate: placeBeside writes left/top only, never a size.
  let ro = null;
  try {
    ro = new ResizeObserver(() => {
      // SELF-DISCONNECT on the dead path rather than just returning. Not every
      // caller keeps the stop function this returns - two of the four did not,
      // which was harmless while the rAF half was the only resource, since
      // that self-cancels once the panel leaves the document. An observer does
      // not, so it would sit watching a detached panel for every open. A
      // removed element delivers a 0x0 notification, so this path is reached.
      if (!panel.isConnected || (isCurrent && !isCurrent())) {
        if (ro) { try { ro.disconnect(); } catch (e2) { /* already gone */ } ro = null; }
        return;
      }
      if (isUserMoved && isUserMoved()) return;
      placeBeside(panel, getNodeScreenRect(node));
    });
    ro.observe(panel);
  } catch (e) {
    // No ResizeObserver at all. Nothing then corrects a height change until
    // the canvas is panned or zoomed, since the tick above compares only the
    // transform - so this is a real degrade, not a silent equivalence. Every
    // browser ComfyUI supports has one, and the constructor does not throw;
    // this exists so a hostile environment loses the polish, never the panel.
  }

  return () => {
    if (raf != null) cancelAnimationFrame(raf);
    raf = null;
    if (ro) { try { ro.disconnect(); } catch (e) { /* already gone */ } ro = null; }
  };
}

// Drag the panel by its header. `onUserMove` fires ONCE per drag, on the first
// real MOVEMENT, so the caller can latch "the user placed this deliberately"
// and stop following the node. `ignoreSelector` keeps a click on the close
// button from starting a drag.
//
// ⚠️ It fires on MOVEMENT, not on pointerdown. Save Image latched on pointerdown,
// which meant a single CLICK on the panel header - or a right-click, or a press
// and release with no movement - permanently stopped the panel following its
// node for the rest of that panel's life, with nothing on screen explaining why.
// A click is not a deliberate placement. Dropdown and LoRA Loader always latched
// on movement; this brings the third implementation into line.
const DRAG_THRESHOLD = 3; // px, so a shaky click is still a click

export function makeDraggable(panel, handle, { onUserMove, ignoreSelector } = {}) {
  handle.addEventListener("pointerdown", (e) => {
    if (ignoreSelector && e.target.closest(ignoreSelector)) return;
    if (e.button !== 0) return; // left button only; a right-click is not a drag
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let latched = false;
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left;
    const oy = e.clientY - r.top;
    // Both defences against a LOST pointerup, which this pack has been bitten by
    // on the Help window's resize handle: the pointer leaves the viewport, or
    // something else takes capture mid-drag, the release is never seen, and the
    // panel follows the cursor forever with no way to put it down. It matters
    // more than it looks, because the caller has just latched "user moved", so
    // a stuck drag ALSO permanently disables the follow loop.
    try { handle.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    let done = false;
    const move = (ev) => {
      if (!panel.isConnected) { up(); return; }
      if (!(ev.buttons & 1)) { up(); return; } // we missed the release
      if (!latched) {
        // only a real movement counts as "the user placed this deliberately"
        if (Math.abs(ev.clientX - startX) < DRAG_THRESHOLD &&
            Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
        latched = true;
        onUserMove?.();
      }
      panel.style.left =
        Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - ox)) + "px";
      panel.style.top =
        Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - oy)) + "px";
    };
    const up = () => {
      if (done) return; // idempotent: the guard above can call this too
      done = true;
      try { handle.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      handle.removeEventListener("lostpointercapture", up);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    handle.addEventListener("lostpointercapture", up);
  });
}
