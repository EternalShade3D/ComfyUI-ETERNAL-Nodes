import { app } from "../../scripts/app.js";

/*
 * TilePromptPanelEternal - frontend
 *
 * Fixes over the previous version:
 *  1. NO self-referential sizing. computeSize() never reads node.size[1],
 *     which is what made the node grow forever.
 *  2. The node grows/shrinks with its content, and you can still drag it
 *     larger - the tile grid reflows (CSS auto-fill) and scrolls.
 *  3. Cells are built once per execution (signature check) and the DOM root
 *     is removed on node deletion, so tiles stop duplicating.
 *  4. The cryptic prompts_json widget is hidden - the textareas ARE the editor.
 */

const NODE_NAME = "TilePromptPanelEternal";
const WIDGET_NAME = "eternal_tile_panel";
const HEADER_H = 74;
const FOOTER_H = 24;
const BOX_H = 74;
const MIN_H = 160;   // used by computeSize; keep both in sync with naturalSize
// Room for a deliberately tall panel (a 1696 px size was being snapped back by
// the old 1500 ceiling + the heal pass). The heal only fires FAR above this, so
// a 308852 px runaway from the old sizing ratchet still gets repaired.
const MAX_H = 4000;

const thumbOf = (node) => {
  const w = (node.widgets || []).find((x) => x.name === "thumb_side");
  const v = parseInt(w ? w.value : 192, 10);
  return Number.isFinite(v) ? Math.min(512, Math.max(64, v)) : 192;
};

const colW = (node) => thumbOf(node) + 14;
const cellH = (node) => thumbOf(node) + BOX_H;

function naturalSize(node, width) {
  const st = node.__eternalPanel || {};
  const n = Math.max(1, st.tiles ? st.tiles.length : 1);
  const w = Math.max(280, width || node.size?.[0] || 360);
  const cols = Math.max(1, Math.floor((w - 18) / colW(node)));
  const rows = Math.ceil(n / cols);
  const h = HEADER_H + rows * cellH(node) + FOOTER_H;
  return [w, Math.min(1500, Math.max(160, h))];
}

function tileSignature(node, data) {
  const tiles = (data && data.tiles) || [];
  return [
    tiles.length,
    thumbOf(node),
    (data && data.global ? data.global.length : 0),
    tiles.map((t) => (t && t.thumb ? t.thumb.length : 0)).join(","),
  ].join("|");
}

function readJsonWidget(node) {
  const w = (node.widgets || []).find((x) => x.name === "prompts_json");
  return w || null;
}

function parseStored(node, n) {
  const w = readJsonWidget(node);
  let arr = [];
  try {
    arr = JSON.parse((w && w.value) || "[]");
  } catch (e) {
    arr = [];
  }
  if (!Array.isArray(arr)) arr = [];
  const out = arr.map((x) => (x == null ? "" : String(x)));
  while (out.length < n) out.push("");
  return out.slice(0, n);
}

function storeStored(node, arr) {
  const w = readJsonWidget(node);
  if (!w) return;
  w.value = JSON.stringify(arr);
}

function buildCell(node, tile, stored, index, redraw) {
  const side = thumbOf(node);
  // tile.i is the key the backend stores prompts under. If a tiles payload ever
  // omits it, fall back to the cell position: reading stored[undefined] made
  // every cell share ONE key, so text typed in one tile showed on ALL of them.
  const key = Number.isFinite(tile.i) ? tile.i : index;
  const autoText = String(tile.auto || "").trim();
  const mine = String(stored[key] || "").trim();
  const cell = document.createElement("div");
  cell.style.cssText =
    "display:flex;flex-direction:column;gap:4px;width:100%;min-width:0;" +
    "box-sizing:border-box;border:1px solid var(--border,#3a3a3a);" +
    "border-radius:6px;padding:4px;background:var(--comfy-input-bg,#1d1d1d);" +
    "overflow:hidden;";

  const head = document.createElement("div");
  head.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;" +
    "font-size:11px;opacity:.85;font-family:monospace;";
  const lbl = document.createElement("span");
  lbl.textContent = tile.label || `T${tile.i}`;
  const badge = document.createElement("span");
  const setBadge = (manual, auto) => {
    const txt = manual ? "MANUAL" : auto ? "AUTO" : "blank";
    badge.textContent = txt;
    badge.style.color = manual ? "#7fd77f" : auto ? "#d7c87f" : "#888";
  };
  setBadge(mine && mine !== autoText, autoText);
  head.appendChild(lbl);
  head.appendChild(badge);
  cell.appendChild(head);

  if (tile.thumb) {
    const img = document.createElement("img");
    img.src = tile.thumb;
    img.style.cssText =
      "width:100%;max-width:100%;height:auto;display:block;" +
      `max-height:${side}px;` +
      "object-fit:contain;background:#000;border-radius:3px;" +
      "image-rendering:auto;";
    img.loading = "lazy";
    cell.appendChild(img);
  } else {
    const ph = document.createElement("div");
    ph.textContent = "no preview";
    ph.style.cssText =
      `width:100%;height:${side}px;box-sizing:border-box;` +
      "display:flex;align-items:center;" +
      "justify-content:center;background:#000;color:#666;font-size:11px;" +
      "border-radius:3px;";
    cell.appendChild(ph);
  }

  // The VL suggestion is REAL, EDITABLE TEXT. It used to live in ta.placeholder,
  // so the instant you started typing it vanished and you could never edit it.
  // Now the box starts with it and you type straight over it.
  const ta = document.createElement("textarea");
  ta.value = mine || autoText;
  ta.placeholder = "prompt for this tile";
  ta.rows = 3;
  ta.style.cssText =
    "width:100%;min-height:78px;resize:vertical;font-size:12.5px;" +
    "line-height:1.35;font-family:inherit;box-sizing:border-box;" +
    "background:var(--comfy-input-bg,#111);" +
    "color:var(--input-text,#eee);border:1px solid var(--border,#3a3a3a);" +
    "border-radius:4px;padding:5px;";
  let timer = null;
  ta.addEventListener("input", () => {
    stored[key] = ta.value;      // was stored[tile.i] - see the key note above
    clearTimeout(timer);
    timer = setTimeout(() => {
      storeStored(node, stored);
      setBadge(ta.value.trim() && ta.value.trim() !== autoText, autoText);
      redraw();
    }, 250);
  });
  cell.appendChild(ta);
  return cell;
}

/*
 * ui values arrive FLATTENED as lists (ComfyUI wraps every ui value, see
 * execution.py) so scalars must be unwrapped before use.
 */
const first = (v, fallback) => {
  if (Array.isArray(v)) return v.length ? v[0] : fallback;
  return v === undefined || v === null ? fallback : v;
};

/*
 * Legacy canvas (Nodes 2.0 OFF) does not re-width a DOM widget when the node is
 * resized, so the grid never reflowed and stayed a single column. Pin the
 * element width to the node width, and always express the columns as
 * min(colW, 100%) so a large thumb_side can never make a column wider than the
 * panel (that overflow is what cropped the tiles).
 */
function pinWidth(node, widthPx) {
  const st = node.__eternalPanel;
  if (!st || !st.root) return;
  const w = Math.max(160, Number(widthPx) || 0);
  st.root.style.width = `${w}px`;
  if (st.grid) {
    st.grid.style.width = `${Math.max(100, w - 12)}px`;
    st.grid.style.gridTemplateColumns =
      `repeat(auto-fill, minmax(min(${colW(node)}px, 100%), 1fr))`;
  }
}

function gridColumns(node) {
  pinWidth(node, (node.size ? node.size[0] : 340) - 28);
}

function renderPanel(node) {
  const st = node.__eternalPanel;
  if (!st || !st.root) return;

  const tiles = st.tiles || [];
  const n = Math.max(1, tiles.length);

  st.head.innerHTML = "";
  const title = document.createElement("div");
  title.style.cssText =
    "display:flex;justify-content:space-between;align-items:baseline;" +
    "font-size:12px;font-weight:600;";
  const left = document.createElement("span");
  left.textContent = `TILE PROMPTS  -  ${tiles.length} tiles`;
  const right = document.createElement("span");
  right.style.cssText = "font-size:10px;opacity:.7;font-weight:400;";
  right.textContent = "line N = tile N  -  manual beats auto";
  title.appendChild(left);
  title.appendChild(right);
  st.head.appendChild(title);

  if (st.mismatch) {
    const warn = document.createElement("div");
    warn.style.cssText = "font-size:10px;color:#e0a030;";
    warn.textContent =
      `note: ${tiles.length} tiles on the panel, ${st.expected} from rows x cols ` +
      "(feed the panel the batch output)";
    st.head.appendChild(warn);
  }

  if (st.globalText) {
    const g = document.createElement("div");
    g.textContent = `global: ${st.globalText}`;
    g.style.cssText =
      "font-size:10px;opacity:.65;max-height:34px;overflow:hidden;" +
      "text-overflow:ellipsis;line-height:1.25;";
    g.title = st.globalText;
    st.head.appendChild(g);
  }

  st.grid.innerHTML = ""; // clearing only - no untrusted content is ever assigned as HTML
  const stored = parseStored(node, n);
  tiles.forEach((tile, i) => {
    st.grid.appendChild(buildCell(node, tile, stored, i, () => renderPanel(node)));
  });
  // min(colW, 100%) stops a column ever being wider than the panel itself -
  // that overflow is what cropped the thumbnails when the node was narrow
  st.grid.style.gridTemplateColumns =
    `repeat(auto-fill, minmax(min(${colW(node)}px, 100%), 1fr))`;
  gridColumns(node);
  st.sig = tileSignature(node, st.raw || {});
}

function ensureWidget(node) {
  if (node.__eternalPanel && node.__eternalPanel.root) return;

  // kill any stale copy (double init is what duplicated tiles)
  if (node.widgets) {
    for (let i = node.widgets.length - 1; i >= 0; i--) {
      if (node.widgets[i].name === WIDGET_NAME) {
        const el = node.widgets[i].element;
        if (el && el.parentNode) el.parentNode.removeChild(el);
        node.widgets.splice(i, 1);
      }
    }
  }

  const root = document.createElement("div");
  root.style.cssText =
    "display:flex;flex-direction:column;gap:6px;padding:6px;overflow:auto;" +
    "width:100%;height:100%;box-sizing:border-box;";

  const head = document.createElement("div");
  head.style.cssText = "display:flex;flex-direction:column;gap:2px;flex:0 0 auto;";
  const grid = document.createElement("div");
  grid.style.cssText =
    "display:grid;gap:8px;justify-items:start;align-content:start;flex:1 1 auto;";
  root.appendChild(head);
  root.appendChild(grid);

  node.__eternalPanel = {
    root, head, grid, tiles: [], raw: null, sig: "", tile_i: 0,
    globalText: "", expected: 0, mismatch: false,
  };

  const widget = node.addDOMWidget(WIDGET_NAME, "div", root, {
    serialize: false,
    hideOnZoom: false,
    getValue: () => "",
    setValue: () => {},
  });
  widget.computeSize = (width) => {
    const [w, h] = naturalSize(node, width);
    // NEVER fold node.size[1] in here. LiteGraph assigns this return value to
    // node.size[1], so max(content, nodeH) ratchets up on every layout pass and
    // the node grows down the canvas forever. Height comes from content ONLY.
    const clamped = Math.min(MAX_H, Math.max(MIN_H, h));
    // `width` is the NEW width being laid out - use it, not node.size[0], or the
    // element lags one resize behind. This is what makes the tiles reflow into
    // more columns as you drag the node wider (legacy UI included).
    pinWidth(node, (Number(width) || (node.size ? node.size[0] : 340)) - 28);
    return [w, clamped];
  };
  widget.onRemoved = () => {
    if (root.parentNode) root.parentNode.removeChild(root);
  };

  // Heal workflows saved while the old sizing ratchet was live: those files
  // carry panel heights in the hundreds of thousands (308852 / 1654520 seen),
  // which is the "node expands forever" you see on load. Clamp on configure and
  // again on the next tick, in case configure lands after this runs.
  const healHeight = () => {
    if (!node.size || !Number.isFinite(node.size[1])) return;
    if (node.size[1] > MAX_H + 60) {
      const w = Math.max(280, node.size[0] || 360);
      node.setSize([w, naturalSize(node, w)[1]]);
      if (node.graph) node.graph.setDirtyCanvas(true, true);
    }
  };
  if (!node.__eternalHeal) {
    node.__eternalHeal = true;
    const prevConfigure = node.onConfigure;
    node.onConfigure = function (...args) {
      const r = prevConfigure ? prevConfigure.apply(this, args) : undefined;
      healHeight();
      return r;
    };
    setTimeout(healHeight, 0);
    setTimeout(healHeight, 300);
  }

  // hide the raw JSON widget - the textareas are the editor
  const jsonW = (node.widgets || []).find((x) => x.name === "prompts_json");
  if (jsonW) {
    jsonW.computeSize = () => [0, -4];
    jsonW.hidden = true;
  }
  const thumbW = (node.widgets || []).find((x) => x.name === "thumb_side");
  if (thumbW && !thumbW.__eternalWrapped) {
    thumbW.__eternalWrapped = true;
    const orig = thumbW.callback;
    thumbW.callback = (v, ...rest) => {
      if (typeof orig === "function") orig.call(thumbW, v, ...rest);
      renderPanel(node);
      node.setSize(naturalSize(node, node.size ? node.size[0] : 360));
    };
  }

  renderPanel(node);
}

app.registerExtension({
  name: "eternal.tilePromptPanel",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function (...args) {
      const r = onNodeCreated ? onNodeCreated.apply(this, args) : undefined;
      ensureWidget(this);
      return r;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      if (onExecuted) onExecuted.apply(this, arguments);
      const st = this.__eternalPanel;
      if (!st) return;
      const data = message || {};
      const sig = tileSignature(this, data);
      st.raw = data;
      st.tiles = Array.isArray(data.tiles) ? data.tiles : [];
      st.globalText = first(data.global, "");
      st.expected = first(data.expected, st.tiles.length);
      st.mismatch = !!first(data.mismatch, false);
      if (sig === st.sig) return; // same tiles -> do not rebuild (no duplicates)
      st.sig = sig;
      renderPanel(this);
      const [w, h] = naturalSize(this, this.size ? this.size[0] : 360);
      this.setSize([w, h]);
    };

    const onRemoved = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () {
      const st = this.__eternalPanel;
      if (st && st.root && st.root.parentNode) st.root.parentNode.removeChild(st.root);
      this.__eternalPanel = null;
      if (onRemoved) onRemoved.apply(this, arguments);
    };
  },
});
