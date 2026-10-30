// ETERNAL tile panels - TILE SPLIT / TILE SOURCE / TILE SAVE / TILE MERGE
//
// Rules learned on the live canvas (each one was a visible bug):
//  * pictures are NEVER shipped as base64 in the UI payload: 128 tiles x 2
//    pictures overflowed the websocket message and the panel silently kept
//    only the first ~20 thumbnails. Python writes PNGs into the run folder,
//    the panel reads them through ComfyUI's /view route.
//  * the DOM widget reports its height through computeSize(); the node is then
//    resized to it, so nothing spills outside the frame and no dead space is
//    left. A manual resize wins: the panel then fills whatever space it gets.
//  * the grid is auto-fill, so columns and rows follow the node width.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const CSS = `
.etp { display:flex; flex-direction:column; gap:6px; font:12px/1.35 system-ui,sans-serif;
       color:#e6e6e6; padding:6px 6px 12px; box-sizing:border-box; }
.etp h4 { margin:0; font-size:11px; letter-spacing:.09em; color:#9fd2ff; font-weight:600; }
.etp .hint { color:#6f7787; font-size:10px; word-break:break-word; }
.etp .empty { border:1px dashed #3a4150; border-radius:6px; min-height:64px; display:flex;
              align-items:center; justify-content:center; text-align:center; padding:10px;
              color:#6f7787; font-size:11px; line-height:1.5; }
.etp .grid { display:grid; gap:6px; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); }
.etp .grid.exact { grid-template-columns:repeat(var(--cols, 2), minmax(0, 1fr)); }

.etp .grid.bounded { overflow-y:visible; padding-right:2px; }
.etp .cell { background:#14161b; border:1px solid #2b2f38; border-radius:6px; overflow:hidden;
             display:flex; flex-direction:column; }
.etp .cell .box { position:relative; background:#0f1116; aspect-ratio:var(--ar, 4 / 3); }
.etp .cell img { width:100%; height:100%; object-fit:cover; display:block; }
.etp .gone { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
             font-size:9px; letter-spacing:.1em; color:#6f7787; background:#14161b; }
.etp .cell .tag { font-size:9px; line-height:1.5; letter-spacing:.06em; padding:5px 6px; color:#8b93a3;
                  display:flex; justify-content:space-between; }
.etp .cell.cached .tag { color:#4ecb71; }
.etp .cell.pending .tag { color:#ffd24e; }
.etp textarea { width:100%; box-sizing:border-box; background:#0f1116; color:#e6e6e6;
                border:0; border-top:1px solid #2b2f38; padding:4px; font:11px/1.3 inherit;
                min-height:44px; max-height:110px; resize:vertical; }
.etp .hit { position:absolute; box-sizing:border-box; pointer-events:none;
            border:1px solid rgba(255,255,255,.20); border-radius:2px; transition:border-color .12s; }
.etp .hit b { position:absolute; left:4px; top:3px; font:600 9px/1 system-ui,sans-serif;
              color:rgba(255,255,255,.42); letter-spacing:.04em;
              background:rgba(0,0,0,.35); border-radius:3px; padding:2px 3px; }
.etp .hit.hover { border-color:rgba(255,255,255,.85); background:rgba(255,255,255,.07); }
.etp .hit.hover b { color:#fff; }
.etp .hit.sel { border-color:#ffd24e; box-shadow:inset 0 0 0 2px rgba(255,210,78,.55);
                background:rgba(255,210,78,.10); }
.etp .hit.sel b { color:#ffd24e; background:rgba(0,0,0,.55); }
.etp .stage.compact { max-height:220px; }
.etp .scroll { overflow:visible; }        /* the PANEL scrolls, not the grid */
.etp .preview { flex:1 1 auto; min-height:120px; position:relative; display:flex;
                align-items:center; justify-content:center; background:#0b0d11;
                border:1px solid #2b2f38; border-radius:6px; overflow:hidden; }
.etp .preview .inner { position:relative; width:100%; height:100%; }
.etp .preview img { position:absolute; inset:0; width:100%; height:100%; object-fit:contain;
                    -webkit-user-drag:none; user-select:none; }
.etp .tcell { position:absolute; box-sizing:border-box; border:1px solid rgba(120,190,255,.55);
              pointer-events:none; }
.etp .tcell b { position:absolute; left:2px; top:1px; font:600 9px/1 system-ui,sans-serif;
                color:#cfe4ff; background:rgba(0,0,0,.45); padding:1px 3px; border-radius:2px; }
.etp .preview .none { position:absolute; inset:0; display:flex; align-items:center;
                      justify-content:center; color:#6f7787; font-size:11px; }
.etp .grid.scroll { max-height:none; }
.etp .grow { flex:1 1 auto; min-height:0; }
.etp .field { display:flex; align-items:center; gap:8px; padding:3px 6px; border-radius:6px;
              background:#1a1d23; border:1px solid #262a33; }
.etp .field label { flex:0 0 78px; font-size:10px; letter-spacing:.06em; color:#8b93a3;
                    text-transform:uppercase; }
.etp .field input[type=range] { flex:1 1 auto; min-width:36px; height:14px; accent-color:#4ea1ff; }
.etp .field input[type=number] { flex:0 0 60px; background:#0f1116; color:#e6e6e6;
                                 border:1px solid #2b2f38; border-radius:4px; padding:2px 4px;
                                 font:11px/1.3 inherit; text-align:right; }
.etp .stage { position:relative; background:#0f1116; border:1px solid #2b2f38; border-radius:6px;
              overflow:hidden; cursor:ew-resize; user-select:none; touch-action:none; }
.etp .stage.empty-stage { display:flex; align-items:center; justify-content:center; min-height:150px; }
.etp .stage .inner { position:relative; width:100%; aspect-ratio:16 / 9; }
.etp .stage img { display:block; width:100%; height:auto; -webkit-user-drag:none; user-select:none;
                  pointer-events:none; }
.etp .stage img.layer { position:absolute; inset:0; width:100%; height:100%; object-fit:fill; }
.etp .stage .hit { position:absolute; }
.etp .stage img.sizer { visibility:hidden; display:block; width:100%; height:auto; }
.etp .stage .divider { position:absolute; top:0; bottom:0; width:2px; background:#4ea1ff;
                       box-shadow:0 0 8px #4ea1ff; pointer-events:none; }
.etp .stage .lbl { position:absolute; bottom:4px; font-size:9px; letter-spacing:.08em; padding:1px 4px;
                   background:#000a; border-radius:3px; pointer-events:none; }
.etp .stage .lbl.l { left:5px; } .etp .stage .lbl.r { right:5px; }
.etp .hit { position:absolute; border:1px solid #ffffff1f; }
.etp .hit.hover { border:2px solid #ffd24e; background:#ffd24e14; }
.etp .hit.sel { border:2px solid #4ea1ff; background:#4ea1ff14; }
.etp .hit b { position:absolute; left:0; top:0; font-size:9px; padding:0 3px; background:#000b; }
.etp .row { display:flex; gap:5px; align-items:center; flex-wrap:wrap; }
.etp button { background:#22303f; color:#dfe8f3; border:1px solid #35506b; border-radius:5px;
              padding:5px 9px; cursor:pointer; font-size:10px; text-transform:uppercase;
              letter-spacing:.04em; }
.etp button:hover { background:#2c3f54; }
.etp button.primary { background:#1f6f3f; border-color:#2e9d59; }
`;

function ensureCss() {
  if (document.getElementById("etp-css")) return;
  const s = document.createElement("style");
  s.id = "etp-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function widgetOf(n, name) { return n?.widgets?.find((w) => w.name === name) || null; }
function hideWidget(n, name) {
  const w = widgetOf(n, name);
  if (!w || w._etHidden) return;
  w._etHidden = true;
  w.computeSize = () => [0, -4];
  w.draw = () => {};
  w.type = "hidden";
}
function setWidget(n, name, v) {
  const w = widgetOf(n, name);
  if (!w) return false;
  w.value = v;
  try { w.callback?.(v, app.canvas, n, app.canvas.graph_mouse, {}); } catch (e) {}
  return true;
}
function one(v, dflt) { return Array.isArray(v) ? (v.length ? v[0] : dflt) : (v ?? dflt); }

function viewUrl(dir, file, bust) {
  const sub = String(dir || "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
  return "/view?filename=" + encodeURIComponent(file) + "&type=temp&subfolder=" + sub +
         (bust ? "&t=" + Date.now() : "");
}
function dirOf(cacheDir, key, leaf) {
  return [cacheDir || "ETERNAL_TILES", key || "", leaf || ""].filter(Boolean).join("/");
}
function tileName(i) { return "T" + String(i).padStart(2, "0") + ".png"; }

// The tile cache lives in ComfyUI/temp, which ComfyUI WIPES on restart. A
// remembered run_key then points at files that no longer exist (that was the
// flood of 404s in the console). Try cut/, then the rendered tile, then give up
// quietly instead of spamming the console.
function setTileImg(img, dirCut, dirRun, i) {
  const name = tileName(i);
  let stageTry = 0;
  img.onerror = () => {
    stageTry += 1;
    if (stageTry === 1 && dirCut) { img.src = viewUrl(dirRun, name, true); return; }
    img.onerror = null;
    img.removeAttribute("src");
    const ph = mk("div", "gone", "cleared");
    if (img.parentElement) img.parentElement.appendChild(ph);
  };
  img.src = dirCut ? viewUrl(dirCut, name) : viewUrl(dirRun, name, true);
}

// A DOM widget is normally laid out BELOW the socket rows, which leaves the
// whole band beside the sockets empty (12 outputs = ~270px of dead space).
// In overlay mode the element is positioned over the node body instead, so the
// controls use that band and the sockets stay readable on the right edge.
function applyOverlay(node) {
  if (!node._etOverlayLeft) return;
  const w = (node.widgets || []).find((x) => String(x.type || "").startsWith("ETERNAL_"));
  const el = w && (w.element || w.inputEl);
  if (!el) return;
  const pad = 8;
  const col = node._etSocketCol || 150;
  el.style.position = "absolute";
  el.style.left = pad + "px";
  el.style.top = (node._etTop || 30) + "px";
  el.style.width = Math.max(240, node.size[0] - col - pad) + "px";
  el.style.height = Math.max(80, node.size[1] - (node._etTop || 30) - pad) + "px";
  el.style.minHeight = "0";
}

function fitPanel(node) {
  const root = node._etRoot;
  const w = (node.widgets || []).find((x) => String(x.type || "").startsWith("ETERNAL_"));
  const el = w && (w.element || w.inputEl);
  if (!root || !w || !el) return;

  // Standard layout: the panel is as tall as its content (up to a cap, then it
  // scrolls) and the node is sized from that. No absolute overlay, no constant
  // height fed back into the node - that combination is what clipped the grid.
  const apply = () => {
    // free-size nodes (the split preview) are owned by the user: fill the body,
    // never resize the node, so vertical + horizontal drag both work
    if (node._etFreeSize) {
      const top = node._etTop || 6;
      // a collapsed-looking box (height ~12) is never what the user wants: put a
      // sane height back, every layout pass, until it sticks
      if (node.size[1] < 200) {
        node._etSelfResize = true;
        node.setSize([Math.max(node.size[0], 480), 520]);
        node._etSelfResize = false;
        app.graph?.setDirtyCanvas?.(true, true);
      }
      const h = Math.max(120, node.size[1] - top - 8);
      root.style.height = "100%";
      root.style.overflow = "hidden";
      el.style.height = h + "px";
      el.style.minHeight = "0";
      // CONSTANT computeSize: deriving it from node.size made the node collapse
      // to 12px (and, the other way round, inflate). The element is stretched by
      // style only.
      w.computeSize = (width) => [width || node.size[0], 240];
      const wrap = el.parentElement;
      if (wrap && wrap !== root) { wrap.style.height = h + "px"; wrap.style.minHeight = "0"; wrap.style.overflow = "visible"; }
      if (node._etLayout) [0, 80].forEach((t) => setTimeout(node._etLayout, t));
      return;
    }
    const CAP = 2400;      // effectively: the panel grows to its content, nothing is cut
    const natural = Math.ceil(root.scrollHeight) + 10;
    const content = Math.min(Math.max(natural, 160), CAP);

    root.style.overflowY = "hidden";      // no scroll: every row is on the node
    root.style.overflowX = "hidden";
    root.style.height = "auto";

    w.computeSize = (width) => [width || node.size[0], content];
    el.style.height = content + "px";
    el.style.minHeight = content + "px";

    const want = content + 8;
    if (!node._etManual && Math.abs(node.size[1] - want) > 2) {
      node._etSelfResize = true;
      node.setSize([node.size[0], want]);
      node._etSelfResize = false;
      node.setDirtyCanvas?.(true, true);
      app.graph?.setDirtyCanvas?.(true, true);
    }

    if (node._etLayout) [0, 80, 320].forEach((t) => setTimeout(node._etLayout, t));
  };

  requestAnimationFrame(apply);
  setTimeout(apply, 60);
  setTimeout(apply, 300);
}

// New content must be able to resize the node even if the user had dragged it:
// otherwise the panel is capped, the node stays tall and the last row is cut.
export function refit(node) {
  node._etManual = false;
  fitPanel(node);
  setTimeout(() => fitPanel(node), 120);
}

function persist(node, payload) {
  node.properties = node.properties || {};
  const prev = node.properties.etUi || {};
  node.properties.etUi = Object.assign({}, prev, payload, {
    key: payload.key || prev.key || "",
    cache_dir: payload.cache_dir || prev.cache_dir || "ETERNAL_TILES",
  });
}
function restorePayload(node) {
  const p = node.properties && node.properties.etUi;
  if (!p || !node._etRestore) return false;
  try { node._etRestore(p); return true; } catch (e) { console.error("[ETERNAL restore]", e); return false; }
}
function queue() { try { app.queuePrompt(0, 1); } catch (e) { console.error("[ETERNAL]", e); } }
function upstream(node, name) {
  const inp = node.inputs?.find((i) => i.name === name);
  if (!inp || inp.link == null) return null;
  const l = node.graph?.links?.[inp.link] ?? app.graph.links[inp.link];
  return l ? node.graph.getNodeById(l.origin_id) : null;
}
function findUpstream(node, inputName, type) {
  const seen = new Set();
  const q = [upstream(node, inputName)].filter(Boolean);
  while (q.length) {
    const n = q.shift();
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    if (n.type === type) return n;
    for (const inp of n.inputs || []) { const u = upstream(n, inp.name); if (u) q.push(u); }
  }
  return null;
}

function makeBA() {
  const stage = mk("div", "stage");
  const inner = mk("div", "inner");
  const sizer = mk("img", "sizer");
  sizer.draggable = false;
  const b = mk("img", "layer before");
  const a = mk("img", "layer after");
  const div = mk("div", "divider");
  const lb = mk("span", "lbl l", "BEFORE");
  const la = mk("span", "lbl r", "AFTER");
  inner.append(sizer, b, a, div, lb, la);
  stage.append(inner);

  const st = { stage, mode: "slider", split: 50, dragging: false, moved: false };

  // same "cleared" treatment the tile grids got: a wiped temp folder must read
  // as a state, not as a blank rectangle
  const gone = mk("div", "gone", "cleared - run again");
  gone.style.display = "none";
  stage.appendChild(gone);
  const showGone = () => { gone.style.display = "flex"; };
  const hideGone = () => { gone.style.display = "none"; };
  [b, a].forEach((im) => {
    im.addEventListener("error", showGone);
    im.addEventListener("load", hideGone);
  });
  // whenever a NEW picture lands in the stage, the overlay must be re-measured
  [sizer, b, a].forEach((im) => im.addEventListener("load", () => {
    if (im === sizer && sizer.naturalWidth && sizer.naturalHeight) {
      const innerEl = stage.querySelector(".inner");
      if (innerEl) innerEl.style.aspectRatio = sizer.naturalWidth + " / " + sizer.naturalHeight;
    }
    if (st.onResize) try { st.onResize(); } catch (e) {}
  }));
  st.syncEmpty = () => {
    const has = !!(b.getAttribute("src") || "").length;
    sizer.style.display = has ? "block" : "none";
    stage.classList.toggle("empty-stage", !has);
    if (!has) {
      if (!stage._ph) {
        stage._ph = mk("div", "empty", "nothing here yet - run the workflow once");
        stage.appendChild(stage._ph);
      }
      stage._ph.style.display = "flex";
    } else if (stage._ph) {
      stage._ph.style.display = "none";
    }
  };
  st.apply = () => {
    const x = st.mode === "after" ? 0 : st.mode === "before" ? 100 : st.split;
    div.style.left = x + "%";
    div.style.display = st.mode === "slider" ? "block" : "none";
    a.style.clipPath = st.mode === "after" ? "none" : "inset(0 0 0 " + x + "%)";
    b.style.display = st.mode === "after" ? "none" : "block";
    lb.style.display = st.mode === "after" ? "none" : "block";
    la.style.display = st.mode === "before" ? "none" : "block";
    stage.style.cursor = st.mode === "slider" ? "ew-resize" : "default";
  };
  const at = (e) => {
    const r = stage.getBoundingClientRect();
    st.split = Math.max(0, Math.min(100, ((e.clientX - r.left) / Math.max(1, r.width)) * 100));
    st.apply();
  };
  stage.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();          // no canvas pan, no image drag
    st.dragging = true; st.moved = false;
    try { stage.setPointerCapture(e.pointerId); } catch (err) {}
    if (st.mode === "slider") at(e);
  });
  stage.addEventListener("dragstart", (e) => e.preventDefault());
  stage.addEventListener("pointermove", (e) => {
    if (!st.dragging) return;
    e.preventDefault();
    st.moved = true;
    at(e);
  });
  const end = () => { st.dragging = false; };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  st.set = (nb, na) => {
    if (nb) {
      sizer.onload = () => {
        const w = sizer.naturalWidth, h = sizer.naturalHeight;
        if (w && h) stage.style.aspectRatio = w + " / " + h;   // box follows the picture
      };
      sizer.src = nb;
      b.src = nb;
    }
    if (na) a.src = na;
    st.syncEmpty();
    st.apply();
    if (st.onResize) try { st.onResize(); } catch (e) {}
  };
  st.setMode = (m) => { st.mode = m; st.apply(); };
  st.syncEmpty(); st.apply();
  return st;
}

function stitchFromTiles(tiles, geom, dir) {
  return new Promise((resolve) => {
    const g = geom || {};
    const sw = g.source_w, sh = g.source_h, tw = g.tile_w, th = g.tile_h;
    const cw = g.cols, ch = g.rows;
    if (!sw || !sh || !cw || !ch || !tiles.length) return resolve("");
    const ox = cw > 1 ? Math.round((cw * tw - sw) / (cw - 1)) : 0;
    const oy = ch > 1 ? Math.round((ch * th - sh) / (ch - 1)) : 0;
    const cv = document.createElement("canvas");
    cv.width = sw; cv.height = sh;
    const ctx = cv.getContext("2d");
    let left = tiles.length;
    tiles.forEach((t) => {
      const im = new Image();
      im.onload = im.onerror = () => {
        const r = (t.i / cw) | 0, c = t.i % cw;
        try { ctx.drawImage(im, c * (tw - ox), r * (th - oy), tw, th); } catch (e) {}
        if (--left === 0) resolve(cv.toDataURL("image/jpeg", 0.85));
      };
      im.src = viewUrl(dir, tileName(t.i), true);
    });
  });
}

// ------------------------------------------------------------ registration
// The graph zooms with the wheel on the CANVAS only, so any DOM panel swallows
// it and hovering a thumbnail freezes the zoom. Forward the wheel to the canvas
// unless it is over a region that can actually scroll.
// The grid must mirror the real split: 2x2 stays 2x2 (not a 1x4 array) and each
// cell takes the tile's own aspect ratio, so thumbs scale with the node.
export function applyGridShape(g, m) {
  const one_ = (v) => (Array.isArray(v) ? v[0] : v);
  const cols = Number(one_(m?.cols ?? m?.geom?.cols ?? 0)) || 0;
  const tw = Number(one_(m?.tile_w ?? m?.geom?.tile_w ?? 0)) || 0;
  const th = Number(one_(m?.tile_h ?? m?.geom?.tile_h ?? 0)) || 0;
  if (!g) return;
  // columns = the split's real columns; every cell keeps the tile's aspect ratio,
  // so the whole grid scales with the node width instead of wrapping or clipping
  if (cols > 0) {
    g.classList.add("exact");
    g.style.setProperty("--cols", String(cols));
  } else {
    g.classList.remove("exact");
    g.style.removeProperty("--cols");
  }
  if (tw > 0 && th > 0) g.style.setProperty("--ar", tw + " / " + th);
  else g.style.removeProperty("--ar");
}

function forwardWheel(root) {
  root.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) return;                 // trackpad pinch = zoom already
    const sc = e.target?.closest?.(".scroll, .grid, textarea");
    if (sc && sc.scrollHeight > sc.clientHeight + 2) {
      const atTop = sc.scrollTop <= 0;
      const atBot = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
      if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBot)) return;   // real scrolling
    }
    const cv = app?.canvas;
    if (!cv?.canvas) return;
    e.preventDefault();
    e.stopPropagation();
    cv.canvas.dispatchEvent(new WheelEvent("wheel", {
      deltaY: e.deltaY, deltaX: e.deltaX, deltaMode: e.deltaMode,
      clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true,
    }));
  }, { capture: true, passive: false });
}

// Keep the panel glued to whatever height the node currently has. This NEVER
// calls setSize: a timer that resizes nodes fights the user's drag and makes the
// canvas jump and flicker.
function syncPanelBox(node) {
  if (!node._etRoot) return;
  const w = (node.widgets || []).find((x) => String(x.type || "").startsWith("ETERNAL_"));
  const el = w && (w.element || w.inputEl);
  if (!el) return;

  const apply = () => {
    const top = node._etTop || 6;
    if (!node._etOverlayLeft) return;
    const h = Math.max(node._etPanelH || 520, node.size[1] - top - 8);
    el.style.position = "absolute";
    el.style.left = "8px";
    el.style.top = top + "px";
    el.style.width = Math.max(240, node.size[0] - (node._etSocketCol || 112) - 8) + "px";
    el.style.height = h + "px";
    el.style.minHeight = "0";
    node._etRoot.style.height = "100%";
    const wrap = el.parentElement;
    if (wrap && wrap !== node._etRoot) {
      wrap.style.height = h + "px";
      wrap.style.minHeight = "0";
      wrap.style.overflow = "visible";
    }
  };

  apply();
  // one more pass after ComfyUI's own layout - never a per-frame loop
  if (!node._etSyncRaf) {
    node._etSyncRaf = requestAnimationFrame(() => { node._etSyncRaf = 0; apply(); });
  }
}

function fitAllOnce() {
  (app.graph?._nodes || []).forEach((n) => {
    if (!n._etRoot || n._etManual) return;
    n._etManual = false;
    fitPanel(n);
  });
}

function registerPanel(nodeName, widgetType, builder) {
  return {
    name: "ETERNAL." + nodeName,
    setup() {
      // debug hook only - nothing runs on a timer
      window.__etFit = fitAllOnce;
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
      if (nodeData.name !== nodeName) return;

      const created = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const r = created?.apply(this, arguments);
        let panelEl;
        try {
          panelEl = builder(this);
        } catch (err) {
          console.error("[ETERNAL panel] builder failed for " + nodeName, err);
          throw err;
        }
        this.addDOMWidget("et_panel", widgetType, panelEl, {
          getValue: () => "", setValue: () => {}, serialize: false, hideOnZoom: false,
        });
        forwardWheel(panelEl);
        this._etManual = false;
        if (this.size[0] < 320) this.size[0] = 320;   // first-created only
        if (this.size[1] < 240) this.size[1] = 240;
        fitPanel(this);
        return r;
      };

      const resized = nodeType.prototype.onResize;
      nodeType.prototype.onResize = function () {
        const r = resized?.apply(this, arguments);
        if (!this._etRoot) return r;
        if (!this._etSelfResize && !this._etLoading) {
          // a real drag: stop auto-fitting for good and just follow the box
          this._etManual = true;
        }
        syncPanelBox(this);
        if (this._etLayout) this._etLayout();
        return r;
      };

      const cfg = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        const r = cfg?.apply(this, arguments);
        this._etManual = false;
        this._etLoading = true;          // restore() resizes; do not read that as a drag
        fitPanel(this);
        setTimeout(() => {
          this._etLoading = false;
          // a free-size node can come back collapsed (height ~12) from a saved
          // workflow - restore a usable box once, then never touch it again
          if (this._etFreeSize && this.size[1] < 200) {
            this._etSelfResize = true;
            this.setSize([Math.max(this.size[0], 480), 520]);
            this._etSelfResize = false;
            app.graph?.setDirtyCanvas?.(true, true);
          }
          syncPanelBox(this);
        }, 600);
        setTimeout(() => { if (!this._etManual) fitPanel(this); }, 900);
        setTimeout(() => {
          // a node saved taller than its panel leaves a band of empty purple
          if (!this._etManual) {
            const w = (this.widgets || []).find((x) => String(x.type || "").startsWith("ETERNAL_"));
            const el = w && (w.element || w.inputEl);
            if (el) {
              const slack = this.size[1] - (Math.ceil(el.getBoundingClientRect().height) + 10);
              if (slack > 40) {
                this._etSelfResize = true;
                this.setSize([this.size[0], Math.ceil(el.getBoundingClientRect().height) + 12]);
                this._etSelfResize = false;
                app.graph?.setDirtyCanvas?.(true, true);
              }
            }
          }
        }, 700);
        setTimeout(() => restorePayload(this), 200);
        return r;
      };

      const ex = nodeType.prototype.onExecuted;
      nodeType.prototype.onExecuted = function (m) {
        ex?.apply(this, arguments);
        try {
          if (this._etSplitUi) this._etSplitUi(m);
          else if (this._etSourceUi) this._etSourceUi(m);
          else if (this._etSaveUi) this._etSaveUi(m);
          else if (this._etMergeUi) this._etMergeUi(m);
        } catch (e) { console.error("[ETERNAL panel]", e); }
      };
    },
  };
}

export {
  applyOverlay,
  ensureCss, mk, widgetOf, hideWidget, setWidget, one, viewUrl, dirOf, tileName, setTileImg,
  fitPanel, persist, restorePayload, queue, upstream, findUpstream, makeBA, stitchFromTiles,
  registerPanel,
};
