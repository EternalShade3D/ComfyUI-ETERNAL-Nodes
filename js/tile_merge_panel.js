import { app } from "../../scripts/app.js";
import {
  ensureCss,
  mk,
  widgetOf,
  hideWidget,
  setWidget,
  one,
  viewUrl,
  dirOf,
  tileName,
  setTileImg,
  fitPanel,
  refit,
  persist,
  restorePayload,
  queue,
  upstream,
  findUpstream,
  makeBA,
  stitchFromTiles,
  registerPanel,
} from "./_eternal_panels_common.js";

// ------------------------------------------------------------- MERGE panel
function buildMergePanel(node) {
  ensureCss();
  const root = mk("div", "etp");
  node._etRoot = root;
  if (node.size[0] < 560) node.setSize([560, Math.max(300, node.size[1])]);
  root.append(mk("h4", null, "STITCHED · DRAG = BEFORE/AFTER · CLICK A TILE"));
  const ba = makeBA();
  root.append(ba.stage);
  const ctl = mk("div", "row");
  const modeBtn = mk("button", null, "MODE: SLIDER");
  ctl.append(modeBtn);
  root.append(ctl);

  root.append(mk("h4", null, "SELECTED TILE"));
  const fb = makeBA();
  fb.stage.classList.add("compact");     // selected tile preview, not a second hero
  root.append(fb.stage);
  const fctl = mk("div", "row");
  const fMode = mk("button", null, "MODE: SLIDER");
  const btnRedo = mk("button", "primary", "Redo this tile");
  const btnAll = mk("button", null, "Redo all");
  fctl.append(fMode, btnRedo, btnAll);
  root.append(fctl);
  const rep = mk("div", "hint");
  root.append(rep);

  const modes = ["slider", "before", "after"];
  const cycle = (t, btn) => () => {
    const next = modes[(modes.indexOf(t.mode) + 1) % modes.length];
    t.setMode(next);
    btn.textContent = "MODE: " + next.toUpperCase();
  };
  modeBtn.onclick = cycle(ba, modeBtn);
  fMode.onclick = cycle(fb, fMode);

  const state = { cacheDir: "ETERNAL_TILES", tiles: [], geom: null, geomKey: "", liveKey: "", sel: -1, hover: -1,
                  key: "", dir: "ETERNAL_TILES" };
  let stitchTimer = null;

  function markHits() {
    ba.stage.querySelectorAll(".hit").forEach((el) => {
      const i = Number(el.dataset.i);
      el.classList.toggle("hover", i === state.hover);
      el.classList.toggle("sel", i === state.sel);
    });
  }
  function paintFocus() {
    const i = state.hover >= 0 ? state.hover : state.sel;
    const t = state.tiles[i];
    if (!t) return;
    fb.set(viewUrl(dirOf(state.dir, "", "cut"), tileName(t.i)), viewUrl(state.dir, tileName(t.i), true));
  }
  function paintGrid() {
    // the stitched picture already shows every tile (hover + click); a second
    // tile grid just made the node long and confusing
    markHits();
  }
  // The overlay lives INSIDE .inner, which is exactly the picture's box
  // (stage aspect ratio == image aspect, layers object-fit:fill). So a tile is
  // simply px[c]/source_w of that box - correct at any zoom, any resize, no
  // re-measuring and nothing that can drift.
  function buildHits() {
    ba.stage.querySelectorAll(".hit").forEach((e) => e.remove());
    const g = state.geom;
    if (!g) return;
    if (!state.key || state.geomKey !== state.key) return;   // geometry from another run
    if (state.tiles.length !== g.rows * g.cols) return;      // stale grid
    const inner = ba.stage.querySelector(".inner");
    if (!inner) return;
    const tw = Math.min(g.tile_w, g.source_w), th = Math.min(g.tile_h, g.source_h);
    state.tiles.forEach((t, i) => {
      const r = (i / Math.max(1, g.cols)) | 0, c = i % Math.max(1, g.cols);
      const x0 = Array.isArray(g.px) && g.px.length ? g.px[c] : c * (g.source_w - tw) / Math.max(1, g.cols - 1);
      const y0 = Array.isArray(g.py) && g.py.length ? g.py[r] : r * (g.source_h - th) / Math.max(1, g.rows - 1);
      const d = mk("div", "hit");
      d.dataset.i = i;
      d.style.left = (100 * x0 / g.source_w) + "%";
      d.style.top = (100 * y0 / g.source_h) + "%";
      d.style.width = (100 * tw / g.source_w) + "%";
      d.style.height = (100 * th / g.source_h) + "%";
      d.append(mk("b", null, "T" + t.i));
      inner.appendChild(d);          // pointer-events:none in CSS - the stage owns the mouse
    });
  }

  // Which tile is under the pointer? Straight from the picture's own box, so
  // the slider drag and the click-selection can share the same surface.
  function hitAt(e) {
    const g = state.geom;
    const inner = ba.stage.querySelector(".inner");
    if (!g || !inner) return -1;
    if (!state.key || state.geomKey !== state.key) return -1;
    if (state.tiles.length !== g.rows * g.cols) return -1;
    const r = inner.getBoundingClientRect();
    if (!r.width || !r.height) return -1;
    const x = (e.clientX - r.left) / r.width * g.source_w;
    const y = (e.clientY - r.top) / r.height * g.source_h;
    const tw = Math.min(g.tile_w, g.source_w), th = Math.min(g.tile_h, g.source_h);
    for (let i = 0; i < state.tiles.length; i++) {
      const row = (i / Math.max(1, g.cols)) | 0, col = i % Math.max(1, g.cols);
      const x0 = Array.isArray(g.px) && g.px.length ? g.px[col] : col * (g.source_w - tw) / Math.max(1, g.cols - 1);
      const y0 = Array.isArray(g.py) && g.py.length ? g.py[row] : row * (g.source_h - th) / Math.max(1, g.rows - 1);
      if (x >= x0 && x < x0 + tw && y >= y0 && y < y0 + th) return i;
    }
    return -1;
  }
  ba.stage.addEventListener("pointermove", (e) => {
    const i = hitAt(e);
    if (i !== state.hover) { state.hover = i; markHits(); if (!ba.dragging) paintFocus(); }
  });
  ba.stage.addEventListener("pointerleave", () => {
    if (state.hover !== -1) { state.hover = -1; markHits(); }
  });
  ba.stage.addEventListener("click", (e) => {
    if (ba.moved) return;                      // a drag, not a click
    const i = hitAt(e);
    if (i >= 0) { state.sel = i; markHits(); paintFocus(); paintGrid(); }
  });

  const layoutHits = () => {};                 // kept for the callers below

  const relayout = () => requestAnimationFrame(layoutHits);
  node._etLayout = relayout;                     // fitPanel calls this too

  // The stage box changes when the picture lands, when the node is resized and
  // when the panel re-fits. Any of those used to leave the overlay at old pixels.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => relayout());
    [ba.stage, ba.stage.querySelector(".inner")].forEach((el) => el && ro.observe(el));
    node._etRO = ro;
  }
  window.addEventListener("resize", relayout);

  function scheduleStitch() {
    clearTimeout(stitchTimer);
    stitchTimer = setTimeout(async () => {
      if (!state.key || state.geomKey !== state.key) return;   // no geometry for this run yet
      const img = await stitchFromTiles(state.tiles, state.geom, state.dir);
      if (img) {
        ba.set(img, img);                        /* keep the divider draggable */
        relayout(); setTimeout(relayout, 120);
      }
    }, 350);
  }

  node._etLive = (msg) => {
    const key = one(msg.run_key, state.liveKey || state.key);
    if (!key) return;
    state.liveKey = key;
    state.dir = dirOf(one(msg.cache_dir, "ETERNAL_TILES"), key, "");
    const raw = Array.isArray(msg.tiles) ? msg.tiles : [];
    state.tiles = raw.map((t) => ({ i: t.i }));
    if (state.sel < 0) state.sel = 0;
    if (msg.report?.[0]) rep.textContent = msg.report[0];
    if (msg.detail?.[0]) rep.title = msg.detail[0];
    paintGrid();
    scheduleStitch();
    paintFocus();
    refit(node);
  };

  ba.onResize = () => { fitPanel(node); layoutHits(); };
  fb.onResize = () => fitPanel(node);

  node._etMergeUi = (msg) => {
    const key = one(msg.run_key, state.key);
    const cacheDir = one(msg.cache_dir, "ETERNAL_TILES");
    state.cacheDir = cacheDir;
    if (key) state.key = key;
    state.dir = dirOf(cacheDir, key, "");
    if (Array.isArray(msg.geom) && msg.geom[0]) { state.geom = msg.geom[0]; state.geomKey = key; }
    const tiles = Array.isArray(msg.tiles) ? msg.tiles : [];
    if (tiles.length) {
      state.tiles = tiles.map((t) => ({ i: t.i }));
      if (state.sel < 0 || state.sel >= state.tiles.length) state.sel = 0;
      ba.set(viewUrl(state.dir, "stitch.png", true), viewUrl(state.dir, "stitch.png", true));
      ba.setMode("slider");
      paintGrid(); buildHits(); markHits(); paintFocus();
    }
    if (msg.report?.[0]) rep.textContent = msg.report[0];
    if (msg.detail?.[0]) rep.title = msg.detail[0];
    persist(node, { key, cache_dir: cacheDir, geom: state.geom,
                    tiles: state.tiles.map((t) => ({ i: t.i })), report: [msg.report?.[0] || ""] });
    refit(node);
  };

  node._etRestore = (p) => {
    if (!p.key || !p.tiles || !p.tiles.length) return;
    state.key = p.key;
    state.dir = dirOf(p.cache_dir, p.key, "");
    state.geom = p.geom || null;
    state.geomKey = p.key || "";
    state.tiles = p.tiles.map((t) => ({ i: t.i }));
    state.sel = 0;
    ba.set(viewUrl(state.dir, "stitch.png", true), viewUrl(state.dir, "stitch.png", true));
    ba.setMode("slider");
    paintGrid(); buildHits(); markHits(); paintFocus();
    if (p.report?.[0]) rep.textContent = p.report[0];
    rep.title = p.detail?.[0] || "";        // the temp path lives in the tooltip
    refit(node);
  };

  function redo(tileIndex, all) {
    const key = state.key || "";
    if (!key) return;
    if (!all && tileIndex < 0) return;
    // one-shot request file in the run folder - TILE SOURCE reads and deletes it
    fetch("/eternal/redo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_key: key,
        cache_dir: state.cacheDir || "ETERNAL_TILES",
        mode: all ? "all" : "one",
        tile: all ? -1 : tileIndex,
      }),
    }).catch(() => {});
    const ks = findUpstream(node, "tiles", "KSampler");
    if (widgetOf(ks, "seed")) setWidget(ks, "seed", Math.floor(Math.random() * 1e15));
    queue();
  }
  btnRedo.onclick = () => redo(state.sel >= 0 ? state.sel : state.hover, false);
  btnAll.onclick = () => redo(-1, true);

  return root;
}

app.registerExtension(registerPanel("TileMergeEternal",  "ETERNAL_MERGE",  buildMergePanel));
