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

// ------------------------------------------------------------ SOURCE panel
function buildSourcePanel(node) {
  ensureCss();
  const root = mk("div", "etp");
  node._etRoot = root;
  root.append(mk("h4", null, "TILES · PROMPT PER TILE"));
  const body = mk("div"); body.style.display = "none";
  const rep = mk("div", "hint");
  root.append(body, mk("div", "empty", "no image yet — wire an image and press Queue"), rep);
  const boxes = [];
  const st = { key: "", cacheDir: "ETERNAL_TILES" };   // last run seen by this panel
  // Per-tile text lives in <run>/prompts.json - not in a hidden widget, so the
  // edits survive a reload and the graph contract stays clean.
  let saveTimer = null;
  function writePrompts() {
    clearTimeout(saveTimer);
    // snapshot NOW: a run landing inside the 400 ms window rebuilds `boxes` and
    // st.key, and a late timer must still write the lines the user actually typed
    const lines = boxes.map((t) => t.value.replace(/\n/g, " "));
    const key = st.key || "", dir = st.cacheDir || "ETERNAL_TILES";
    saveTimer = setTimeout(() => {
      fetch("/eternal/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
          run_key: key,
          cache_dir: dir,
          lines,
        }),
      }).catch(() => {});
    }, 400);
  }

  node._etSourceUi = (msg) => {
    const tiles = Array.isArray(msg.tiles) ? msg.tiles : [];
    if (!tiles.length) return;
    const key = one(msg.run_key, node.properties?.etUi?.key || "");
    const cacheDir = one(msg.cache_dir, "ETERNAL_TILES");
    st.key = key; st.cacheDir = cacheDir;
    const ph = root.querySelector(".empty");
    if (ph) ph.style.display = "none";
    body.style.display = "block";
    while (body.firstChild) body.removeChild(body.firstChild);
    const grid = mk("div", "grid exact scroll grow");
    applyGridShape(grid, msg);            // real cols x rows + tile aspect ratio
    boxes.length = 0;
    const dirCut = dirOf(cacheDir, key, "cut");
    const dirRun = dirOf(cacheDir, key, "");
    tiles.forEach((t) => {
      const cell = mk("div", "cell" + (t.render ? " pending" : " cached"));
      const box = mk("div", "box");
      const img = mk("img");
      setTileImg(img, t.cached ? null : dirCut, dirRun, t.i);
      box.append(img);
      const tag = mk("div", "tag");
      tag.append(mk("span", null, "T" + t.i), mk("span", null, t.render ? "render" : "cached"));
      const ta = document.createElement("textarea");
      ta.placeholder = "optional - empty = global prompt only";
      ta.value = t.own || t.caption || "";
      if (t.caption) ta.title = "caption from AI Prompt: " + t.caption;
      ta.oninput = () => writePrompts();
      cell.append(box, tag, ta);
      grid.appendChild(cell);
      boxes.push(ta);
    });
    body.appendChild(grid);
    if (msg.report?.[0]) rep.textContent = msg.report[0];
    persist(node, { key, cache_dir: cacheDir, report: [msg.report?.[0] || ""],
                    tiles: tiles.map((t) => ({ i: t.i, own: t.own || "", caption: t.caption || "",
                                               prompt: t.prompt || "", cached: !!t.cached,
                                               render: !!t.render })) });
    refit(node);
  };

  node._etRestore = (p) => {
    if (!p.tiles || !p.tiles.length) return;
    node._etSourceUi({ tiles: p.tiles, report: p.report || [],
                       run_key: [p.key], cache_dir: [p.cache_dir] });
  };
  return root;
}

app.registerExtension(registerPanel("TileSourceEternal", "ETERNAL_SOURCE", buildSourcePanel));
