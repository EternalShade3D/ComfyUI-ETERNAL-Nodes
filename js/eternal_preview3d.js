// Preview 3D Eternal — SELF-CONTAINED viewer extension (true copy of core behavior).
//
// Why a copy (not hijacking core's Preview3D extension):
//   The core "Comfy.Preview3D" extension imports its deps from hashed chunk files
//   that are BUNDLED into the main frontend and NOT individually served (verified:
//   GET /assets/<old-hash>.js -> 404). A file copy of that extension throws on
//   import and silently never registers.
//
//   ComfyUI exposes PUBLIC shims for the exact same viewer pieces, served at
//   /extensions/core/load3d/*.js (confirmed 200):
//     - createLoad3d  -> the SAME Load3d viewer class core uses (identical viewport)
//     - Load3DConfiguration.parseAnnotatedFilename
//     - load3dSerialize.snapshotLoad3dState  (viewer settings snapshot)
//   We import ONLY these public shims, so this file is fully self-contained in our
//   folder and survives frontend updates (shims are stable; only hashes change).
//
// Behavior (matches Preview 3D & Animation):
//   - Builds the SAME Load3d viewer into the node body.
//   - Loads the preview from the TEMP folder (user requirement).
//   - Viewer settings (camera pose, material mode, grid, bg, light) persist into
//     node.properties -> workflow JSON, so they survive refresh + save/load.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { createLoad3d } from "/extensions/core/load3d/createLoad3d.js";
import { snapshotLoad3dState } from "/extensions/core/load3d/load3dSerialize.js";

const OUR_NODE = "EternalPreview3D";

app.registerExtension({
  name: "eternal.Preview3DEternal",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== OUR_NODE) return;
    // Add the PREVIEW_3D input so the node shows the viewer slot.
    nodeData.input = nodeData.input || {};
    nodeData.input.required = nodeData.input.required || {};
    if (!nodeData.input.required.image) {
      nodeData.input.required.image = ["PREVIEW_3D"];
    }
  },

  getCustomWidgets() {
    return {
      PREVIEW_3D(node) {
        const dom = document.createElement("div");
        dom.style.width = "100%";
        dom.style.height = "400px";
        dom.style.minHeight = "400px";

        // createLoad3d builds the exact same Load3d viewer core uses.
        const load3d = createLoad3d(dom, { isViewerMode: true });

        const widget = node.addDOMWidget("preview3d", "PREVIEW_3D", dom, {
          serialize: false,
          hideOnZoom: false,
        });
        widget.type = "load3D";
        widget.load3d = load3d;
        return { widget };
      },
    };
  },

  async nodeCreated(node) {
    if (node.constructor.comfyClass !== OUR_NODE) return;
    const [w, h] = node.size;
    node.setSize([Math.max(w, 400), Math.max(h, 550)]);

    // Restore persisted viewer settings from node properties (survives refresh).
    const cfg = node.properties?.["Viewer Config"];
    const load3d = node.widgets?.find((e) => e.name === "preview3d")?.load3d;
    if (load3d && cfg) {
      try {
        if (cfg.materialMode) load3d.setMaterialMode?.(cfg.materialMode);
        if (cfg.upDirection) load3d.setUpDirection?.(cfg.upDirection);
        if (cfg.cameraState) load3d.setCameraState?.(cfg.cameraState);
      } catch (e) {
        console.warn("Preview3D Eternal restore failed:", e);
      }
    }

    // Persist viewer settings whenever the user tweaks the viewer.
    // snapshotLoad3dState(node, load3d) writes Camera Config into node.properties
    // and returns { camera_info, model_3d_info } for this node (mirrors core).
    const persist = () => {
      try {
        node.properties = node.properties || {};
        const snap = snapshotLoad3dState(node, load3d);
        if (snap) node.properties["Viewer Config"] = snap;
      } catch (e) {
        console.warn("Preview3D Eternal persist failed:", e);
      }
    };
    if (typeof node.addEventListener === "function") {
      node.addEventListener("change", persist);
    }
  },

  onNodeOutputsUpdated(outputs) {
    for (const [nodeId, data] of Object.entries(outputs)) {
      const result = data?.result;
      if (!result?.[0]) continue;
      const node =
        app.graph.getNodeById?.(Number(nodeId)) ||
        app.graph._nodes_by_id?.[nodeId] ||
        null;
      if (!node || node.constructor.comfyClass !== OUR_NODE) continue;

      const filename = String(result[0]).replaceAll("\\", "/");
      const cameraInfo = result[1];
      const bgImagePath = result[2];

      const widget = node.widgets?.find((e) => e.name === "model_file");
      if (widget) widget.value = filename;

      const load3d = node.widgets?.find((e) => e.name === "preview3d")?.load3d;
      if (!load3d) continue;

      const [subfolder, name] = api.splitFilePath(filename);
      const modelUrl = api.apiURL(api.getResourceURL(subfolder, name, "temp"));
      load3d
        .loadModel(modelUrl, filename, { silentOnNotFound: true })
        .then(() => {
          if (bgImagePath) load3d.setBackgroundImage?.(bgImagePath);
          if (cameraInfo) load3d.setCameraState?.(cameraInfo);
        })
        .catch((e) => console.error("Preview3D Eternal load failed:", e));
    }
  },
});
