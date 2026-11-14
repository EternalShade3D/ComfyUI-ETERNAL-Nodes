// Live-graph glue around the pure resolver in filename_tokens_core.mjs.
//
// ComfyUI resolves %NodeName.widget% tokens in filename_prefix ONLY for its own
// hardcoded list of save nodes (SaveImage, SaveVideo, ...). This module lets us
// opt Pixaroma's save nodes (Preview Image Pixaroma, Save Mp4) into the exact
// same behaviour, so a token like %Seed Pixaroma.seed% or %KSampler.seed% fills
// in the referenced node's widget value in our filename fields too.
//
// The resolution runs at graphToPrompt time and affects ONLY the queued prompt
// value; it deliberately does NOT write the resolved text back into the saved
// workflow, so the on-canvas field keeps the raw token (no dirty-on-load),
// exactly like the native Save Image node.
import { app } from "/scripts/app.js";
import { resolveFilenameTokens } from "./filename_tokens_core.mjs";

// Flatten every node in the graph (incl. subgraphs), starting from the ROOT so a
// save node in the root can reference a node in the root even while the user is
// viewing a subgraph. Matches ComfyUI's own resolver, which flattens rootGraph.
function collectNodes() {
  const root = (app.graph && app.graph.rootGraph) || app.graph;
  const out = [];
  const seen = new Set();
  const walk = (g) => {
    if (!g || seen.has(g)) return;
    seen.add(g);
    const arr = g._nodes || g.nodes || [];
    for (const n of arr) {
      if (!n) continue;
      out.push(n);
      const inner = n.subgraph || n.graph || n._graph;
      if (inner && inner !== g) walk(inner);
    }
  };
  walk(root);
  return out;
}

// Resolve %NodeName.widget% references in a string against the live graph.
// Safe on any string; returns it unchanged when there is nothing to resolve.
export function applyFilenameTokenRefs(value) {
  try {
    return resolveFilenameTokens(value, collectNodes());
  } catch (e) {
    console.warn("[Pixaroma] filename token resolve failed", e);
    return value;
  }
}

// Opt a node's filename_prefix widget into %NodeName.widget% resolution. The
// override runs at graphToPrompt/serialize time and returns the RESOLVED value
// for the API prompt. It does NOT write back to the workflow (node.serialize
// uses the raw widget value, so the saved token survives and never dirties).
// Idempotent per widget; re-installs safely on each node (re)creation.
export function installFilenameTokenResolver(node, widgetName = "filename_prefix") {
  const w =
    node && node.widgets && node.widgets.find((x) => x && x.name === widgetName);
  if (!w || w._pixTokenResolver) return;
  w._pixTokenResolver = true;
  const orig = w.serializeValue;
  w.serializeValue = function (workflowNode, widgetIndex) {
    let base;
    try {
      base = orig ? orig.call(this, workflowNode, widgetIndex) : this.value;
    } catch (e) {
      base = this.value;
    }
    // serializeValue may be async on some widgets; handle both shapes.
    if (base && typeof base.then === "function") {
      return base.then((v) => applyFilenameTokenRefs(v == null ? "" : String(v)));
    }
    return applyFilenameTokenRefs(base == null ? "" : String(base));
  };
}
