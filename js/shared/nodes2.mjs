// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma Shared — Nodes 2.0 compatibility helpers           ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// Helpers for the ComfyUI "Nodes 2.0" (Vue/DOM) renderer migration.
// See the "ComfyUI Nodes 2.0 Migration" section in CLAUDE.md for the
// full background and the survive/break matrix.

import { app } from "/scripts/app.js";

/**
 * Effective backing-store scale (device pixels per LAYOUT pixel) for a DOM
 * `<canvas>` widget in Nodes 2.0.
 *
 * The Nodes 2.0 node is CSS-transform-scaled by the graph zoom
 * (`app.canvas.ds.scale`). A `<canvas>` has a FIXED backing store, so if it's
 * sized only at layout resolution (`clientWidth * devicePixelRatio`) the
 * browser CSS-stretches that backing store up when the user zooms IN → the
 * image goes blurry/pixelated. (Native ComfyUI dodges this by using a
 * resolution-independent `<img>`.) Sizing the backing store at `dpr * zoom`
 * keeps the canvas crisp at any zoom.
 *
 * Never below `dpr` (zoomed OUT the node is smaller than layout, so dpr is
 * already plenty), and the long side is capped so a deep zoom can't allocate a
 * giant canvas. This mirrors the proven Compare implementation; it is the
 * single source of truth for every Pixaroma DOM-canvas widget.
 *
 * @param {number} cssW - canvas CSS width  (root.clientWidth)
 * @param {number} cssH - canvas CSS height (root.clientHeight)
 * @returns {number} device-pixels-per-layout-pixel scale to render at
 */
const CANVAS_BACKING_CAP = 6000;
export function canvasBackingScale(cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  const zoom = Math.max(1, app.canvas?.ds?.scale || 1);
  let s = dpr * zoom;
  const longCss = Math.max(cssW || 0, cssH || 0);
  if (longCss > 0 && longCss * s > CANVAS_BACKING_CAP) s = CANVAS_BACKING_CAP / longCss;
  return s;
}

/**
 * Install a per-frame requestAnimationFrame loop that calls `render()` whenever
 * the effective backing scale (graph zoom) changes.
 *
 * A `ResizeObserver` does NOT fire on graph zoom (the element's `clientWidth`
 * in layout px is unchanged - only the CSS transform scale changes), so without
 * this watcher a DOM canvas keeps its old resolution and stays blurry until the
 * next layout-size change. The loop is cheap: it diffs the graph zoom each frame
 * (no DOM read) and repaints only when the zoom actually changes.
 *
 * Stores the rAF id on `node[rafKey]` so an `onRemoved` handler can
 * `cancelAnimationFrame(node[rafKey])`. Also returns a stop() function.
 *
 * @param {object} node - the LiteGraph node (rAF id is parked on it)
 * @param {() => [number, number]} getSize - returns the canvas [cssW, cssH]
 * @param {() => void} render - repaint callback (re-sizes + redraws the canvas)
 * @param {string} rafKey - property name to store the rAF id under on `node`
 * @returns {() => void} stop - cancels the loop
 */
export function installZoomRepaint(node, getSize, render, rafKey) {
  // getSize is kept for API compatibility but is NOT read every frame: reading the
  // element's clientWidth/clientHeight per frame forces a layout reflow PER node using
  // this, so a big graph with several preview / Compare / Load-Image nodes floods the
  // console with rAF + forced-reflow warnings (worst during a marquee's nonstop redraw).
  // The only thing that needs a re-render here is a graph ZOOM change
  // (app.canvas.ds.scale - no DOM read); render() reads the element size itself and
  // applies canvasBackingScale's cap, and a node-SIZE change is already handled by the
  // caller's ResizeObserver. So watch the zoom only.
  void getSize;
  let lastZoom = -1;
  const tick = () => {
    const zoom = Math.max(1, app.canvas?.ds?.scale || 1);
    if (Math.abs(zoom - lastZoom) > 0.005) { lastZoom = zoom; render(); }
    node[rafKey] = requestAnimationFrame(tick);
  };
  node[rafKey] = requestAnimationFrame(tick);
  return () => {
    try { cancelAnimationFrame(node[rafKey]); } catch (_e) { /* ignore */ }
    node[rafKey] = null;
  };
}

/**
 * True when ComfyUI's Nodes 2.0 (Vue) renderer is active.
 * Driven by the `Comfy.VueNodes.Enabled` setting → `LiteGraph.vueNodesMode`.
 * Read live (do not cache) so a runtime renderer toggle is respected.
 */
export function isVueNodes() {
  return !!window.LiteGraph?.vueNodesMode;
}

/**
 * Adaptive `canvasOnly` house rule for internal DOM / custom widgets.
 *
 * The problem (Vue Compat #15 vs Nodes 2.0): setting `canvasOnly: true`
 * keeps an internal widget out of the legacy right-sidebar Parameters tab,
 * BUT in Nodes 2.0 `shouldRenderAsVue = !options.canvasOnly` excludes the
 * widget from the node body entirely → it renders nowhere (empty node).
 *
 * The fix: make `canvasOnly` a LIVE getter — `true` in the legacy renderer
 * (so it's filtered out of the Parameters tab, while the legacy node body
 * still draws DOM widgets regardless of the flag), and `false` in Nodes 2.0
 * (so the Vue body renders it). Evaluated fresh on every render, so a
 * runtime renderer toggle is honored without re-creating the widget.
 *
 * Call AFTER `addDOMWidget` / `addCustomWidget`, passing the returned widget.
 * Do NOT also pass `canvasOnly` in the widget's own options literal — let
 * this own the flag.
 *
 * @param {object} widget - the widget returned by addDOMWidget/addCustomWidget
 * @returns {object} the same widget (for chaining)
 */
export function applyAdaptiveCanvasOnly(widget) {
  if (!widget || !widget.options) return widget;
  try {
    Object.defineProperty(widget.options, "canvasOnly", {
      configurable: true,
      enumerable: true,
      get() {
        return !window.LiteGraph?.vueNodesMode;
      },
    });
  } catch (e) {
    // Fallback: some builds may store a non-configurable options object.
    // Static value (correct after a page reload, which switching the
    // renderer requires anyway).
    widget.options.canvasOnly = !window.LiteGraph?.vueNodesMode;
  }
  return widget;
}
