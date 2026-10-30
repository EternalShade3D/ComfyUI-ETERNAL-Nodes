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
  persist,
  restorePayload,
  queue,
  upstream,
  findUpstream,
  makeBA,
  stitchFromTiles,
  registerPanel,
} from "./_eternal_panels_common.js";

// -------------------------------------------------------------- SAVE panel
function buildSavePanel(node) {
  ensureCss();
  const root = mk("div", "etp");
  node._etRoot = root;
  root.append(mk("h4", null, "TILES SAVED · fills in while the run goes"));
  const body = mk("div"); body.style.display = "none";
  const rep = mk("div", "hint");
  root.append(body, mk("div", "empty", "nothing saved yet — queue the workflow"), rep);

  node._etSaveUi = (msg) => {
    const raw = Array.isArray(msg.tiles) ? msg.tiles : [];
    const byI = new Map();
    raw.forEach((t) => byI.set(t.i, t));
    const tiles = Array.from(byI.values()).sort((a, b) => a.i - b.i);
    if (!tiles.length) return;
    const key = one(msg.run_key, node.properties?.etUi?.key || "");
    const cacheDir = one(msg.cache_dir, "ETERNAL_TILES");
    const ph = root.querySelector(".empty");
    if (ph) ph.style.display = "none";
    body.style.display = "block";
    while (body.firstChild) body.removeChild(body.firstChild);
    const grid = mk("div", "grid");
    const dir = dirOf(cacheDir, key, "");
    tiles.forEach((t) => {
      const cell = mk("div", "cell cached");
      const box = mk("div", "box");
      const img = mk("img");
      setTileImg(img, null, dir, t.i);
      box.append(img);
      const tag = mk("div", "tag");
      tag.append(mk("span", null, "T" + t.i), mk("span", null, "saved"));
      cell.append(box, tag);
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    if (msg.report?.[0]) rep.textContent = msg.report[0];
    persist(node, { key, cache_dir: cacheDir, tiles: tiles.map((t) => ({ i: t.i })),
                    report: [msg.report?.[0] || ""] });
    refit(node);
  };

  node._etRestore = (p) => {
    if (!p.tiles || !p.tiles.length) return;
    node._etSaveUi({ tiles: p.tiles, report: p.report || [],
                     run_key: [p.key], cache_dir: [p.cache_dir] });
  };
  return root;
}

app.registerExtension(registerPanel("TileSaveEternal",   "ETERNAL_SAVE",   buildSavePanel));
