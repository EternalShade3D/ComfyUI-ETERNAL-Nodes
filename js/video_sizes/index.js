// Video Sizes ETERNAL - wiring. Ported from Longest Side Pixaroma so the face
// is one single-row DOM widget (no rebuild on renderer flip), the gear + size
// readout park in the output-slot dead-space (kills the empty top gap), and a
// watchdog self-heals the face after a renderer flip or subgraph re-render.
//
// State lives on node.properties.videoSizesState and is pushed into the hidden
// VideoSizesState input at submission time (Resolution pattern, Vue Compat #9),
// so no extra input dot appears.

import { app } from "/scripts/app.js";
import {
  applyAdaptiveCanvasOnly, isVueNodes, installResizeFloor,
  installCanvasZoomPassthrough,
} from "../shared/index.mjs";
import { isGraphLoading } from "../shared/graph_loading.mjs";
import { onRendererChange } from "../shared/renderer_switch.mjs";
import { installNodeAccent, registerNodeSettings } from "../shared/node_settings.mjs";
import { HIDDEN_INPUT } from "./core.mjs";
import { openVideoSizesPanel, closeVideoSizesPanelFor } from "./settings.mjs";
import { buildFace, WIDGET_H, DEFAULT_W, MIN_W } from "./ui.mjs";

const CLASS_NAME = "ETERNALVideoSizes";
const WIDGET_NAME = "pix_vs_ui";

function openPanel(node) {
  openVideoSizesPanel(node, (n) => {
    n._pixVsRefresh?.();
    n.setDirtyCanvas?.(true, true);
  });
}

function vueSlotBlock(el) {
  return el?.querySelector(".lg-slot--output")?.parentElement?.parentElement || null;
}

function parkBand(node) {
  try {
    const band = node._pixVsBand;
    if (!band) return;
    const el = document.querySelector(`.lg-node[data-node-id="${node.id}"]`);
    if (!el || !node._pixVsRoot || !el.contains(node._pixVsRoot)) return;
    const block = vueSlotBlock(el);
    if (!block) return;
    if (band.parentElement === block) return;
    block.style.position = "relative";
    block.appendChild(band);
    band.classList.add("parked");
  } catch { /* degrades to an in-flow row; node still works */ }
}

function applyBandPlacement(node) {
  const band = node._pixVsBand;
  if (!band) return;
  const classic = !isVueNodes();
  band.classList.toggle("classic", classic);
  if (classic) {
    band.classList.remove("parked");
    const root = node._pixVsRoot;
    if (root && band.parentElement !== root) root.insertBefore(band, root.firstChild);
  } else {
    parkBand(node);
    requestAnimationFrame(() => parkBand(node));
    setTimeout(() => parkBand(node), 150);
  }
}

function faceAlive(node) {
  return !!node._pixVsRoot && (node.widgets || []).some((w) => w.name === WIDGET_NAME);
}

function teardownFace(node) {
  node._pixVsFloorOff?.();
  node._pixVsFloorOff = null;
  try { node._pixVsBand?.remove(); } catch { }
  try { node._pixVsRoot?.remove(); } catch { }
  const i = (node.widgets || []).findIndex((w) => w.name === WIDGET_NAME);
  if (i >= 0) {
    const w = node.widgets[i];
    node.widgets.splice(i, 1);
    try { w?.onRemove?.(); } catch { }
  }
  node._pixVsBand = null;
  node._pixVsRoot = null;
  node._pixVsRefresh = null;
}

function buildFaceOnNode(node) {
  const { root, band, refresh } = buildFace(node, { onGear: openPanel });
  node._pixVsRoot = root;
  node._pixVsBand = band;
  node._pixVsRefresh = refresh;

  applyBandPlacement(node);

  installCanvasZoomPassthrough(root);
  installNodeAccent(node, root, band);

  const height = () => WIDGET_H;
  const w = node.addDOMWidget(WIDGET_NAME, "pix_vs", root, {
    getValue: () => null,
    setValue: () => { },
    getMinHeight: height,
    getMaxHeight: height,
    margin: 4,
    serialize: false,
  });
  applyAdaptiveCanvasOnly(w);
  w.serialize = false;

  node._pixVsFloorOff = installResizeFloor(root, () => WIDGET_H);
  node.setDirtyCanvas(true, true);
}

function ensureFace(node) {
  if (faceAlive(node)) return false;
  teardownFace(node);
  buildFaceOnNode(node);
  return true;
}

let _watchdog = 0;
let _rendererOff = null;
let _emptySweeps = 0;

function collectNodes() {
  const found = [];
  const seen = new Set();
  const visit = (graph) => {
    if (!graph || seen.has(graph)) return;
    seen.add(graph);
    for (const n of (graph._nodes || graph.nodes || [])) {
      if (!n) continue;
      if (n.comfyClass === CLASS_NAME) found.push(n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return found;
}

function sweep() {
  const nodes = collectNodes();
  if (!nodes.length) {
    if (++_emptySweeps < 3) return;
    if (_watchdog) { clearInterval(_watchdog); _watchdog = 0; }
    _rendererOff?.();
    _rendererOff = null;
    return;
  }
  _emptySweeps = 0;
  for (const n of nodes) {
    try {
      ensureFace(n);
      if (isVueNodes()) parkBand(n);
    } catch (e) {
      console.error("[ETERNAL] Video Sizes sweep failed for one node", e);
    }
  }
}

function startWatchdog() {
  _emptySweeps = 0;
  if (!_watchdog) _watchdog = setInterval(sweep, 350);
  if (!_rendererOff) {
    _rendererOff = onRendererChange(() => {
      sweep();
      for (const n of collectNodes()) { applyBandPlacement(n); n._pixVsRefresh?.(); }
    });
  }
}

app.registerExtension({
  name: "ETERNAL.VideoSizes",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== CLASS_NAME) return;

    const _origConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = _origConfigure?.apply(this, arguments);
      applyBandPlacement(this);
      queueMicrotask(() => { applyBandPlacement(this); this._pixVsRefresh?.(); });
      startWatchdog();
      return r;
    };

    const _origOnResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
      if (!isVueNodes() && !isGraphLoading() && faceAlive(this)) {
        if (size[0] < MIN_W) size[0] = MIN_W;
        if (this.size[0] < MIN_W) this.size[0] = MIN_W;
        const natural = this.computeSize()[1];
        size[1] = natural;
        this.size[1] = natural;
      }
      if (_origOnResize) return _origOnResize.apply(this, arguments);
    };

    const _origDraw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
      if (_origDraw) _origDraw.call(this, ctx);
      if (isVueNodes() || isGraphLoading()) return;
      if (this.flags?.collapsed) return;
      if (this.size[0] < MIN_W) this.size[0] = MIN_W;
    };

    const _origOnRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      closeVideoSizesPanelFor(this);
      teardownFace(this);
      const r = _origOnRemoved?.apply(this, arguments);
      setTimeout(sweep, 0);
      return r;
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== CLASS_NAME) return;
    buildFaceOnNode(node);
    node.size[0] = DEFAULT_W;
    node.size[1] = node.computeSize()[1];
    node.setDirtyCanvas(true, true);
    startWatchdog();
  },
});

// ── app.graphToPrompt hook (subgraph-safe) ──────────────────────────────────
function buildNodeIndex() {
  const index = new Map();
  const visit = (graph) => {
    if (!graph) return;
    const nodes = graph._nodes || graph.nodes || [];
    for (const n of nodes) {
      if (!n) continue;
      if (n.comfyClass === CLASS_NAME || n.type === CLASS_NAME) index.set(String(n.id), n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== graph) visit(inner);
    }
  };
  visit(app.graph);
  return index;
}

function findNode(index, promptId) {
  const sId = String(promptId);
  if (index.has(sId)) return index.get(sId);
  const tail = sId.includes(":") ? sId.slice(sId.lastIndexOf(":") + 1) : null;
  if (tail && index.has(tail)) return index.get(tail);
  return null;
}

const _origGraphToPrompt = app.graphToPrompt.bind(app);
app.graphToPrompt = async function (...args) {
  const result = await _origGraphToPrompt(...args);
  try {
    const out = result?.output;
    if (out) {
      let index = null;
      for (const id in out) {
        const entry = out[id];
        if (!entry || entry.class_type !== CLASS_NAME) continue;
        if (!index) index = buildNodeIndex();
        const node = findNode(index, id);
        if (!node) continue;
        entry.inputs = entry.inputs || {};
        const st = (node.properties || {})[HIDDEN_INPUT];
        entry.inputs[HIDDEN_INPUT] = st ? st : "{}";
      }
    }
  } catch (e) {
    console.error("[ETERNAL] Video Sizes prompt injection failed; prompt sent unchanged", e);
  }
  return result;
};

registerNodeSettings(CLASS_NAME, {
  title: "Video Sizes",
  ownMenuItem: false,
  open: (node) => openPanel(node),
  closeFor: (node) => closeVideoSizesPanelFor(node),
});

export default {};
