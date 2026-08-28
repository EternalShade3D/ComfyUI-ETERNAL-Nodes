// How big is the picture arriving on an input, read WITHOUT running anything.
//
// ComfyUI's frontend already knows: a Load Image node prints "720 x 1280" on its
// own face, and that comes from `node.imgs[0]`, a plain <img> whose
// naturalWidth/naturalHeight are readable the moment it decodes. Any node that
// wants to show what it is about to produce can walk its input link and measure
// that, instead of waiting for a run.
//
// SHARED because two nodes do this (Longest Side's size readout, Image Resize's
// INPUT card) and the refusal list below MUST NOT be duplicated - a second copy
// would drift the moment a new loader is added, and the failure it prevents is
// silent and confident.
//
// Extracted from js/longest_side/input_size.mjs 2026-08-05, where every rule
// here was earned by a measured wrong number.

import { app } from "/scripts/app.js";

/**
 * Nodes whose `imgs` preview is NOT what they output, so their preview must
 * never be measured.
 *
 * Both Pixaroma loaders set `node.imgs` from the FILE ON DISK
 * (`updateNativePreview` in js/load_image/api.mjs) but pass the picture through
 * `_resize_frame` before returning it (nodes/node_load_image.py). With their
 * inline resize on, the preview is the ORIGINAL and the output is the resized
 * one, so trusting it prints a confident wrong size.
 *
 * Deliberately NOT solved by reading their resize state: that couples this file
 * to another node's state schema, and a schema change would silently start
 * trusting a resizing node again. Refusing outright cannot rot.
 *
 * ADD ANY FUTURE NODE whose preview is not its output.
 *
 * HOW TO KNOW WHETHER A NODE BELONGS HERE. `node.imgs` is only ever populated
 * three ways: core's `image_upload: True` setter, core turning a `ui.images`
 * payload into a preview, and our own `updateNativePreview`. A Pixaroma node
 * that transforms its picture in Python but reports a custom ui key (say
 * `pixaroma_crop_source`) is invisible to this reader and needs no entry - but
 * **the day one of those is switched to `ui.images`, it must be added here**,
 * because several of them deliberately emit the SOURCE picture rather than the
 * result (Crop, Inpaint Crop and Outpaint all do). Audited 2026-08-05: the set
 * is complete for the pack as it stands.
 *
 * A third-party node with `image_upload` plus an internal resize cannot be
 * listed by anyone, so it stays a known blind spot rather than a bug we can fix.
 */
export const PREVIEW_IS_NOT_OUTPUT = new Set([
  "PixaromaLoadImage",
  "PixaromaLoadImageMini",
  // Same "file on disk in, _resize_frame'd image out" shape as the two above.
  // Its frontend does not touch node.imgs today, so it yields no dims either
  // way - listed pre-emptively so that adding a gallery preview later cannot
  // silently turn it into a confident wrong number.
  "PixaromaLoadImagesFolder",
]);

/**
 * The dimensions of the picture arriving on `inputName` (default "image"), or
 * null when it cannot be known honestly.
 *
 * DIRECT upstream only, deliberately. Walking further back would be wrong, not
 * merely incomplete: an intermediate node with no preview of its own may well
 * be a resize, so the size two hops back is not the size arriving here. A
 * confident wrong number is worse than showing nothing, so when the node
 * feeding us draws nothing we say we do not know.
 */
export function upstreamImageDims(node, inputName = "image") {
  try {
    const inputs = node?.inputs || [];
    const inp = inputs.find((i) => i?.name === inputName) || inputs[0];
    if (!inp || inp.link == null) return null;

    const graph = node.graph || app.graph;
    if (!graph) return null;

    // graph.links is a plain object on older frontends and a Map on newer ones
    // (Vue Compat #3) - try both.
    let link = graph.links?.[inp.link];
    if (!link && typeof graph.links?.get === "function") link = graph.links.get(inp.link);
    if (!link) return null;

    const up = graph.getNodeById?.(link.origin_id);
    if (!up) return null;

    // A MUTED (mode 2) or BYPASSED (mode 4) node is not producing the picture it
    // is still showing: bypass passes its own INPUT straight through, so its
    // preview is of an image that never arrives here. Measured on Image Resize:
    // a bypassed loader still reported 480x832 for a picture that no longer
    // flowed from it.
    if (up.mode === 2 || up.mode === 4) return null;

    if (PREVIEW_IS_NOT_OUTPUT.has(up.comfyClass)) return null;

    // node.imgs is the batch the node is previewing; imageIndex is which one is
    // on show. A batch is uniform in size, so the first is representative.
    const imgs = up.imgs;
    if (!imgs?.length) return null;
    const img = imgs[up.imageIndex || 0] || imgs[0];
    const w = Math.trunc(img?.naturalWidth || 0);
    const h = Math.trunc(img?.naturalHeight || 0);
    // naturalWidth is 0 until the picture has actually decoded, so a freshly set
    // src reports nothing for a frame or two. Returning null lets the caller
    // fall back rather than show 0x0.
    if (w > 0 && h > 0) return { w, h };
  } catch { /* any frontend change here degrades to "we do not know" */ }
  return null;
}
