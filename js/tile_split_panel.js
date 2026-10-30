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
  fitPanel,
  refit,
  persist,
  restorePayload,
  queue,
  registerPanel,
} from "./_eternal_panels_common.js";

// ------------------------------------------------------------- SPLIT panel
// One picture, the tile grid drawn as lines on top. The panel fills the node, so
// the preview scales with the node in BOTH directions and every tile stays inside
// its own cell - no wall of thumbnails, nothing to clip.
function buildSplitPanel(node) {
  ensureCss();
  const root = mk("div", "etp");
  node._etRoot = root;
  node._etFreeSize = true;      // the user owns width and height
  node._etTop = 6;
  if (node.size[0] < 480) node.setSize([480, Math.max(360, node.size[1])]);
  if (node.size[1] < 360) node.setSize([node.size[0], 360]);

  hideWidget(node, "cache_dir");

  const fields = [
    { name: "tiles", label: "tiles (0=auto)", min: 0, max: 64, step: 1 },
    { name: "target_tile", label: "tile px", min: 256, max: 4096, step: 32 },
    { name: "overlap", label: "overlap", min: 0, max: 512, step: 16 },
  ];
  fields.forEach((f) => {
    const w = widgetOf(node, f.name);
    if (!w) return;
    const row = mk("div", "field");
    const lab = mk("label", null, f.label);
    const rng = document.createElement("input");
    rng.type = "range"; rng.min = f.min; rng.max = f.max; rng.step = f.step; rng.value = w.value;
    const num = document.createElement("input");
    num.type = "number"; num.min = f.min; num.max = f.max; num.step = f.step; num.value = w.value;
    const push = (v) => {
      const val = Math.max(f.min, Math.min(f.max, Math.round(Number(v) || 0)));
      rng.value = val; num.value = val;
      setWidget(node, f.name, val);
    };
    rng.oninput = () => push(rng.value);
    num.onchange = () => push(num.value);
    row.append(lab, rng, num);
    root.append(row);
    hideWidget(node, f.name);
  });

  const rw = widgetOf(node, "resize_tiles");
  if (rw) {
    const row = mk("div", "field");
    const lab = mk("label", null, "resize");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = !!rw.value;
    cb.onchange = () => setWidget(node, "resize_tiles", cb.checked);
    row.append(lab, cb);
    root.append(row);
    hideWidget(node, "resize_tiles");
  }

  const prev = mk("div", "preview");
  const inner = mk("div", "inner");
  const img = mk("img");
  img.src = "";
  const none = mk("div", "none", "run once - the picture and its tile grid appear here");
  inner.append(img);
  prev.append(inner, none);
  root.append(prev);

  const rep = mk("div", "hint");
  root.append(rep);

  let dir = "";

  let geom = null;          // last geometry, for redrawing on resize

  function drawGrid(msg) {
    if (msg && one(msg.cols) != null) {
      geom = {
        sw: Number(one(msg.source_w)) || 0,
        sh: Number(one(msg.source_h)) || 0,
        tw: Number(one(msg.tile_w)) || 0,
        th: Number(one(msg.tile_h)) || 0,
        cols: Number(one(msg.cols)) || 0,
        rows: Number(one(msg.rows)) || 0,
        px: one(msg.px) || [],
        py: one(msg.py) || [],
      };
    }
    const g = geom;
    if (!g || !g.sw || !g.sh || !g.cols || !g.rows || !g.tw || !g.th) return;

    inner.querySelectorAll(".tcell").forEach((e) => e.remove());

    // object-fit: contain letterboxes the picture, so measure where the pixels
    // really are and lay the grid on THAT box (pixel-precise, any node size)
    const box = prev.getBoundingClientRect();
    const ar = g.sw / g.sh, boxAR = box.width / Math.max(1, box.height);
    let cw, ch;
    if (ar > boxAR) { cw = box.width; ch = cw / ar; }
    else { ch = box.height; cw = ch * ar; }
    const offX = (box.width - cw) / 2, offY = (box.height - ch) / 2;

    const total = g.cols * g.rows;
    for (let i = 0; i < total; i++) {
      const r = (i / g.cols) | 0, c = i % g.cols;
      const x0 = g.px[c] != null ? g.px[c] : c * (g.sw - g.tw) / Math.max(1, g.cols - 1);
      const y0 = g.py[r] != null ? g.py[r] : r * (g.sh - g.th) / Math.max(1, g.rows - 1);
      const cell = mk("div", "tcell");
      cell.style.left = (offX + cw * x0 / g.sw) + "px";
      cell.style.top = (offY + ch * y0 / g.sh) + "px";
      cell.style.width = (cw * g.tw / g.sw) + "px";
      cell.style.height = (ch * g.th / g.sh) + "px";
      if (cw * g.tw / g.sw > 26) cell.append(mk("b", null, "T" + i));
      inner.appendChild(cell);
    }
  }

  node._etSplitUi = (msg) => {
    const key = one(msg.run_key, node.properties?.etUi?.key || "");
    const cacheDir = one(msg.cache_dir, "ETERNAL_TILES");
    dir = dirOf(cacheDir, key, "");
    const file = one(msg.source_file, "source.png");
    img.onerror = () => { img.style.display = "none"; none.style.display = "flex"; };
    img.onload = () => { img.style.display = "block"; none.style.display = "none"; fitPanel(node); };
    img.src = viewUrl(dir, file, true);
    if (msg.tiles?.length || one(msg.cols)) {
      none.style.display = "none";
      img.style.display = "block";
    }
    drawGrid(msg);
    if (msg.report?.[0]) rep.textContent = msg.report[0];
    persist(node, { key, cache_dir: cacheDir, report: [msg.report?.[0] || ""],
                    cols: one(msg.cols), rows: one(msg.rows), total: (msg.tiles || []).length,
                    source_w: one(msg.source_w), source_h: one(msg.source_h),
                    tile_w: one(msg.tile_w), tile_h: one(msg.tile_h),
                    px: one(msg.px), py: one(msg.py) });
    fitPanel(node);
  };

  node._etRestore = (p) => {
    if (!p || !p.key) return;
    node._etSplitUi({
      run_key: [p.key], cache_dir: [p.cache_dir], report: p.report || [],
      cols: [p.cols], rows: [p.rows], tile_w: [p.tile_w], tile_h: [p.tile_h],
      source_w: [p.source_w], source_h: [p.source_h], px: [p.px], py: [p.py],
      source_file: ["source.png"], tiles: Array.from({ length: p.total || 0 }, (_, i) => ({ i })),
    });
  };

  node._etLayout = () => drawGrid(null);      // resize -> redraw the same geometry
  return root;
}

app.registerExtension(registerPanel("TileSplitEternal", "ETERNAL_SPLIT", buildSplitPanel));
