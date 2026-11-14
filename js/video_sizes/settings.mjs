// Video Sizes ETERNAL - the floating settings panel (Sliders / Save Image
// pattern: themed panel beside the node, draggable by its header, closes on
// outside click or Esc). Pick the snap step and the highlight colour. The node
// face stays minimal.

import { app } from "/scripts/app.js";
import { isVueNodes } from "../shared/nodes2.mjs";
import { openPixaromaColorPickerPopup, BUTTON_PALETTE } from "../shared/color_picker.mjs";
import { GLOBAL_ACCENT_SETTING, repaintAllAccents } from "../shared/node_settings.mjs";
import { pixAsset } from "../shared/api_url.mjs";
import {
  readState, writeState, accentOf,
  BRAND, ACCENT_SETTING, SNAP_OPTIONS,
} from "./core.mjs";

let _panel = null;
let _panelNode = null;
let _onChange = null;
let _cpHandle = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function injectCSS() {
  if (document.getElementById("pix-vszp-css")) return;
  const s = document.createElement("style");
  s.id = "pix-vszp-css";
  s.textContent = `
    .pix-vszp { position:fixed; z-index:10010; width:300px; max-width:94vw; background:#1a1a1a;
      border:1px solid #4a4a4a; border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,0.6);
      color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif; overflow:hidden; }
    .pix-vszp-t { display:flex; align-items:center; gap:8px; padding:10px 12px; background:#232323;
      border-bottom:1px solid #333; cursor:grab; user-select:none; color:var(--acc,${BRAND}); }
    .pix-vszp-t .x { margin-left:auto; color:#8a8a8a; cursor:pointer; padding:0 4px; }
    .pix-vszp-t .x:hover { color:#fff; }
    .pix-vszp-b { padding:12px; display:flex; flex-direction:column; gap:12px; }
    .pix-vszp-lab { font-size:12px; color:#9a9a9a; }
    .pix-vszp-seg { display:flex; gap:4px; }
    .pix-vszp-seg button { flex:1; text-align:center; padding:6px 2px; border-radius:5px;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.14); color:#a8a8a8;
      font:11px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-vszp-seg button:hover { color:#ddd; }
    .pix-vszp-seg button.on { background:var(--acc,${BRAND}); border-color:var(--acc,${BRAND}); color:#fff; font-weight:600; }
    .pix-vszp-acc { display:flex; align-items:center; gap:10px; }
    .pix-vszp-sw { width:30px; height:22px; border-radius:5px; border:1px solid #555; cursor:pointer; flex:none; }
    .pix-vszp-sw:hover { border-color:#fff; }
    .pix-vszp-f { display:flex; gap:8px; flex-wrap:wrap; padding:10px 12px; border-top:1px solid #333; background:#1f1f1f; }
    .pix-vszp-btn { border:1px solid #444; background:rgba(255,255,255,0.04); color:#d8d8d8; border-radius:5px;
      padding:6px 12px; font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .pix-vszp-btn:hover { border-color:var(--acc,${BRAND}); color:#fff; }
    .pix-vszp-push { margin-left:auto; }
  `;
  document.head.appendChild(s);
}

function getNodeScreenRect(node) {
  if (isVueNodes() && node && node.id != null) {
    const e = document.querySelector(`[data-node-id="${node.id}"]`);
    if (e) return e.getBoundingClientRect();
  }
  const c = app.canvas;
  const ds = c && c.ds;
  const cv = c && c.canvas;
  if (!ds || !cv || !node?.pos || !node?.size) return null;
  const cr = cv.getBoundingClientRect();
  const titleH = window.LiteGraph?.NODE_TITLE_HEIGHT || 30;
  const sc = ds.scale || 1;
  const off = ds.offset || [0, 0];
  const left = cr.left + (node.pos[0] + off[0]) * sc;
  const top = cr.top + (node.pos[1] - titleH + off[1]) * sc;
  const width = node.size[0] * sc;
  const height = (node.size[1] + titleH) * sc;
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function placeBeside(panel, rect) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const mw = panel.offsetWidth, mh = panel.offsetHeight;
  const gap = 12, pad = 8;
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

function makeDraggable(panel, handle) {
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".x")) return;
    e.preventDefault();
    const r = panel.getBoundingClientRect();
    const ox = e.clientX - r.left, oy = e.clientY - r.top;
    const move = (ev) => {
      if (!panel.isConnected) return up();
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, ev.clientX - ox)) + "px";
      panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, ev.clientY - oy)) + "px";
    };
    const up = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  });
}

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  if (e.target.closest?.(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
  closeVideoSizesPanel();
}
function escClose(e) {
  if (e.key === "Escape" && _panel) {
    if (document.querySelector(".pix-cp-popup, .pix-cp-modal-backdrop")) return;
    e.stopPropagation();
    closeVideoSizesPanel();
  }
}

export function closeVideoSizesPanel() {
  try { _cpHandle?.close(); } catch { }
  _cpHandle = null;
  if (_panel) { try { _panel.remove(); } catch { } }
  _panel = null;
  _panelNode = null;
  _onChange = null;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

export function closeVideoSizesPanelFor(node) {
  if (_panelNode === node) closeVideoSizesPanel();
}

export function openVideoSizesPanel(node, onChange) {
  closeVideoSizesPanel();
  injectCSS();
  _onChange = onChange || null;
  _panelNode = node;

  const panel = el("div", "pix-vszp");
  panel.style.setProperty("--acc", accentOf(node));

  const title = el("div", "pix-vszp-t");
  title.append(el("span", null, "⚙"), el("span", null, "Video Sizes settings"));
  const x = el("span", "x", "✕");
  x.addEventListener("click", closeVideoSizesPanel);
  title.appendChild(x);

  const body = el("div", "pix-vszp-b");
  const foot = el("div", "pix-vszp-f");

  const fire = (info) => { _onChange?.(info); };
  const repaintAccent = () => {
    const a = accentOf(node);
    panel.style.setProperty("--acc", a);
    sw.style.background = a;
  };

  // ── snap ────────────────────────────────────────────────────────────────
  const snapField = el("div");
  snapField.appendChild(el("div", "pix-vszp-lab", "Snap width and height to multiple of"));
  const seg = el("div", "pix-vszp-seg");
  const st0 = readState(node);
  for (const v of SNAP_OPTIONS) {
    const b = el("button", v === (st0.snap || 32) ? "on" : null, v === 0 ? "Off" : String(v));
    b.addEventListener("click", () => {
      writeState(node, { ...readState(node), snap: v });
      fire({ structural: false });
      // refresh the active state in the segment
      [...seg.children].forEach((c) => c.classList.toggle("on", c.textContent === (v === 0 ? "Off" : String(v))));
    });
    seg.appendChild(b);
  }
  snapField.appendChild(seg);
  body.appendChild(snapField);

  // ── accent ────────────────────────────────────────────────────────────
  const acc = el("div", "pix-vszp-acc");
  const sw = el("div", "pix-vszp-sw");
  sw.title = "Pick the highlight colour";
  sw.style.background = accentOf(node);
  sw.addEventListener("click", () => {
    _cpHandle = openPixaromaColorPickerPopup(sw, {
      initialColor: accentOf(node),
      swatches: BUTTON_PALETTE,
      wide: true,
      resetColor: BRAND,
      onPick: (c) => {
        const col = c || BRAND;
        writeState(node, { ...readState(node), accent: col });
        repaintAccent();
        node._pixVsInner?.style.setProperty("--acc", col);
        node.setDirtyCanvas?.(true, true);
      },
    });
  });
  acc.append(sw, el("div", "pix-vszp-lab", "Highlight colour"));
  body.appendChild(acc);

  // ── footer ──────────────────────────────────────────────────────────────
  const mkDefault = el("button", "pix-vszp-btn", "Colour as default");
  mkDefault.title = "Use this node's colour for every new Video Sizes node";
  mkDefault.addEventListener("click", async () => {
    try {
      await app.ui.settings.setSettingValueAsync(ACCENT_SETTING, accentOf(node));
      mkDefault.textContent = "Saved as default";
      setTimeout(() => { mkDefault.textContent = "Colour as default"; }, 1200);
    } catch { }
  });

  const mkAll = el("button", "pix-vszp-btn", "Every Pixaroma node");
  mkAll.title = "Every Pixaroma node follows this colour, unless it has been given one of its own";
  mkAll.addEventListener("click", async () => {
    try {
      await app.ui.settings.setSettingValueAsync(GLOBAL_ACCENT_SETTING, accentOf(node));
      mkAll.textContent = "Saved";
      setTimeout(() => { mkAll.textContent = "Every Pixaroma node"; }, 1200);
      repaintAllAccents();
    } catch { }
  });

  const done = el("button", "pix-vszp-btn pix-vszp-push", "Done");
  done.addEventListener("click", closeVideoSizesPanel);

  foot.append(mkDefault, mkAll, done);

  panel.append(title, body, foot);
  document.body.appendChild(panel);

  placeBeside(panel, getNodeScreenRect(node));
  makeDraggable(panel, title);

  setTimeout(() => {
    if (!_panel) return;
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
  _panel = panel;
}
