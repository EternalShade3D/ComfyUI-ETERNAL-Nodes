// TILE SAVE -> TILE MERGE live bridge
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

api.addEventListener("eternal-tile-saved", (ev) => {
  const d = ev.detail || {};
  if (!d.run_key) return;
  const tile = { i: d.i };
  for (const n of app.graph._nodes) {
    if (n.type === "TileSaveEternal" && n._etSaveUi) {
      const prev = (n.properties && n.properties.etUi && n.properties.etUi.tiles) || [];
      const merged = prev.filter((t) => t.i !== d.i).concat([tile]).sort((a, b) => a.i - b.i);
      try {
        n._etSaveUi({ tiles: merged, report: [d.report || ""],
                      run_key: [d.run_key], cache_dir: [d.cache_dir] });
      } catch (e) { console.error("[ETERNAL save live]", e); }
    }
    if (n.type === "TileMergeEternal" && n._etLive) {
      try {
        n._etLive({ tiles: Array.from({ length: (d.count || d.i + 1) }, (_, i) => ({ i })),
                    report: [d.report || ""], run_key: [d.run_key], cache_dir: [d.cache_dir] });
      } catch (e) { console.error("[ETERNAL merge live]", e); }
    }
  }
});

api.addEventListener("executed", (ev) => {
  const d = ev.detail;
  if (!d || !d.output) return;
  const node = app.graph.getNodeById(d.node);
  if (!node || node.type !== "TileSaveEternal") return;
  for (const n of app.graph._nodes) {
    if (n.type === "TileMergeEternal" && n._etLive) {
      try { n._etLive(d.output); } catch (e) { console.error("[ETERNAL live]", e); }
    }
  }
});
