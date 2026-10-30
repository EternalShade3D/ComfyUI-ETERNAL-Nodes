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
  applyGridShape,
} from "./_eternal_panels_common.js";

// ------------------------------------------------------------- SPLIT panel
function buildSplitPanel(node) {
  ensureCss();
  const root = mk("div", "etp");
  node._etRoot = root;
  // use the band beside the 12 output sockets instead of leaving it empty
  // cache_dir is read by every downstream node through the geometry socket, so it
  // gets a real input here - hiding the widget with no control would freeze it at the default.
  const cdw = widgetOf(node, "cache_dir");
  if (cdw) {
    const row = mk("div", "field");
    const inp = document.createElement("input");
    inp.type = "text"; inp.value = cdw.value || "ETERNAL_TILES";
    inp.style.cssText = "flex:1 1 auto;min-width:120px;background:#0f1116;color:#e6e6e6;border:1px solid #2b2f38;border-radius:4px;padding:2px 4px;font:11px/1.3 inherit;";
    inp.onchange = () => setWidget(node, "cache_dir", inp.value.trim() || "ETERNAL_TILES");
    row.append(mk("label", null, "cache dir"), inp);
    root.append(row);
    hideWidget(node, "cache_dir");
  }

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

  // resize_tiles as a small toggle instead of a stray widget above the panel
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

  root.append(mk("h4", null, "TILES · THIS IS THE CUT"));
  const body = mk("div"); body.style.display = "none";
  const rep = mk("div", "hint");
  root.append(body, mk("div", "empty", "no image yet — wire an image and press Queue"), rep);

  node._etSplitUi = (msg) => {
    const tiles = Array.isArray(msg.tiles) ? msg.tiles : [];
    if (!tiles.length) return;
    const key = one(msg.run_key, node.properties?.etUi?.key || "");
    const cacheDir = one(msg.cache_dir, "ETERNAL_TILES");
    const ph = root.querySelector(".empty");
    if (ph) ph.style.display = "none";
    body.style.display = "block";
    while (body.firstChild) body.removeChild(body.firstChild);
    const grid = mk("div", "grid exact scroll grow");
    applyGridShape(grid, msg);            // real cols x rows + tile aspect ratio
    const dir = dirOf(cacheDir, key, "cut");
    tiles.forEach((t) => {
      const cell = mk("div", "cell");
      const box = mk("div", "box");
      const img = mk("img");
      setTileImg(img, dir, dirOf(cacheDir, key, ""), t.i);
      box.append(img);
      const tag = mk("div", "tag");
      tag.append(mk("span", null, "T" + t.i));
      cell.append(box, tag);
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    if (msg.report?.[0]) rep.textContent = msg.report[0];
    persist(node, { key, cache_dir: cacheDir, cols: one(msg.cols), rows: one(msg.rows),
                    total: tiles.length, report: [msg.report?.[0] || ""] });
    refit(node);
  };

  node._etRestore = (p) => {
    const total = p.total || (p.tiles || []).length;
    if (!total) return;
    node._etSplitUi({
      tiles: Array.from({ length: total }, (_, i) => ({ i })),
      report: p.report || [], cols: [p.cols], rows: [p.rows],
      run_key: [p.key], cache_dir: [p.cache_dir],
    });
  };
  return root;
}

app.registerExtension(registerPanel("TileSplitEternal",  "ETERNAL_SPLIT",  buildSplitPanel));
