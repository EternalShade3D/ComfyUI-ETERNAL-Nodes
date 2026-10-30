"""
TILE SPLIT ETERNAL - just the cut.

IMAGE -> tiles (LIST). Feed that LIST to AI Prompt Pixaroma and every tile gets
captioned on its own, with no loop nodes: ComfyUI runs the captioner once per
list item and hands back a LIST of strings.

Its panel shows the cut: every tile, numbered, so you can see the split before
anything renders.

OUTPUTS
    tiles      LIST  -> AI Prompt Pixaroma, and down the chain
    index      LIST  -> TILE SOURCE / TILE SAVE / TILE MERGE (which tile each item is)
    geometry   JSON  -> sizes, grid, overlaps, total AND run_key + cache_dir

Tile edges are multiples of 32: Qwen-Image 2.1 rounds every reference image to
a multiple of 32, so a 16-snapped tile comes back 16 px narrower.

CATEGORY = "ETERNAL / Tiles"
"""

from __future__ import annotations

import numpy as np

try:
    from ._tile_common import plan_grid, positions
    from . import _tile_cache as cache
except ImportError:
    from _tile_common import plan_grid, positions
    import _tile_cache as cache


def _to_numpy_hwc(image) -> np.ndarray:
    try:
        import torch
        if torch.is_tensor(image):
            image = image.detach().cpu().numpy()
    except Exception:
        pass
    arr = np.asarray(image, dtype=np.float32)
    while arr.ndim > 3:
        arr = arr[0]
    if arr.ndim != 3:
        raise ValueError(f"TILE SPLIT ETERNAL expected an image, got {arr.shape}")
    return np.ascontiguousarray(arr)


def _geometry_json(source_w, source_h, tile_w, tile_h, rows, cols, ovx, ovy,
                   total, run_key="", cache_dir="ETERNAL_TILES") -> str:
    """One socket for the whole contract: sizes, grid, overflows AND identity.

    run_key + cache_dir live here because every downstream node needs the same
    two values - three separate copies is how they drift apart.
    """
    import json
    return json.dumps({"source_w": int(source_w), "source_h": int(source_h),
                       "tile_w": int(tile_w), "tile_h": int(tile_h),
                       "rows": int(rows), "cols": int(cols),
                       "overlap_x": int(ovx), "overlap_y": int(ovy),
                       "total": int(total), "run_key": str(run_key),
                       "cache_dir": str(cache_dir)})


def parse_geometry(value) -> dict:
    """Accept the packed geometry socket (JSON) and any legacy dict."""
    import json
    v = value[0] if isinstance(value, (list, tuple)) and value else value
    if isinstance(v, dict):
        return v
    try:
        data = json.loads(str(v or "{}"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


class TileSplitEternal:
    DESCRIPTION = (
        "Cuts the image into tiles (multiples of 32) and shows the cut. Outputs "
        "the tiles as a LIST so a captioner can look at each one."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "IMAGE": ("IMAGE",),
                "tiles": ("INT", {"default": 0, "min": 0, "max": 64,
                                  "tooltip": "How many tiles you want. 0 = work the grid out "
                                             "from target_tile. When set, this wins and "
                                             "target_tile controls the RENDER size."}),
                "target_tile": ("INT", {"default": 1024, "min": 256, "max": 4096, "step": 32,
                                        "tooltip": "Size each tile is rendered at. Every crop is "
                                                   "resized to this (aspect kept, multiples of 32) "
                                                   "before it goes to the model - like TILE PREPARE."}),
                "resize_tiles": ("BOOLEAN", {"default": True,
                                             "tooltip": "Resize each crop to target_tile before "
                                                        "rendering. Off = send the raw crop size "
                                                        "(engine may rescale it instead)."}),
                "overlap": ("INT", {"default": 128, "min": 0, "max": 1024, "step": 32}),
                "cache_dir": ("STRING", {"default": "ETERNAL_TILES",
                                         "tooltip": "Folder under ComfyUI/temp/. Set only "
                                                    "here - the other tile nodes read it from "
                                                    "the geometry socket."}),
            }
        }

    RETURN_TYPES = ("IMAGE", "INT", "STRING")
    RETURN_NAMES = ("tiles", "index", "geometry")
    OUTPUT_IS_LIST = (True, True, False)
    FUNCTION = "split"
    CATEGORY = "ETERNAL / Tiles"
    OUTPUT_NODE = True
    OUTPUT_TOOLTIPS = ("LIST: every tile -> AI Prompt Pixaroma, then TILE SOURCE.",
                       "LIST: tile number for each item.",
                       "JSON: source/tile size, rows, cols, overlaps, total, run_key, cache_dir.")

    def split(self, IMAGE, target_tile=1024, overlap=128, cache_dir="ETERNAL_TILES",
              tiles=0, resize_tiles=True):
        """Cut the picture, then (optionally) resize every crop to target_tile.

        `tiles` is the count you want (0 = let target_tile decide the grid).
        `target_tile` is the size each tile is RENDERED at - the crop is resized
        to it with its aspect kept and edges snapped to 32, like TILE PREPARE.
        Stitching still uses the real crop rect, so nothing is lost.
        """
        src = _to_numpy_hwc(IMAGE)
        source_h, source_w = int(src.shape[0]), int(src.shape[1])
        count = max(0, int(tiles))
        grid_mode = "Total tiles" if count > 0 else "Auto (squarest)"
        rows, cols, tw, th, ovx, ovy, total = plan_grid(
            source_w, source_h, grid_mode, int(target_tile), int(overlap),
            count or 4, 1, 1, "Square tiles")

        px, py = positions(source_w, tw, cols), positions(source_h, th, rows)
        pad_r = max(0, (max(px) + tw) - source_w)
        pad_b = max(0, (max(py) + th) - source_h)
        canvas = src
        if pad_r or pad_b:
            canvas = np.pad(src, ((0, pad_b), (0, pad_r), (0, 0)), mode="edge")
        batch = np.stack([canvas[y:y + th, x:x + tw, :] for y in py for x in px], axis=0)
        crops = batch          # the REAL crops: stitching + colour reference

        # ---- render size: every crop becomes ~target_tile (aspect kept, /32) --
        render_w, render_h = tw, th
        if bool(resize_tiles):
            scale = min(1.0, float(target_tile) / float(max(tw, th)))
            render_w = max(64, int(round(tw * scale / 32.0)) * 32)
            render_h = max(64, int(round(th * scale / 32.0)) * 32)
            if (render_w, render_h) != (tw, th):
                try:
                    from PIL import Image as _PIm
                    batch = np.stack([
                        np.asarray(_PIm.fromarray((np.clip(t, 0, 1) * 255).astype(np.uint8))
                                   .resize((render_w, render_h), _PIm.LANCZOS),
                                   dtype=np.float32) / 255.0
                        for t in batch], axis=0)
                except Exception:
                    render_w, render_h = tw, th

        key = cache.run_key(src, rows, cols, tw, th)
        report = f"{rows}x{cols} = {total} tiles of {tw}x{th}"
        if (render_w, render_h) != (tw, th):
            report += f" rendered at {render_w}x{render_h}"
        report += f" (overlap {ovx}/{ovy})"
        # keep small copies of the crops on disk: the panel can rebuild the cut
        # after a workflow switch instead of going blank
        cache_dir_v = str(cache_dir or "ETERNAL_TILES")
        try:
            import os as _os
            from PIL import Image as _Img
            run_dir = cache.run_dir(cache_dir_v, key)
            cut_dir, src_dir = _os.path.join(run_dir, "cut"), _os.path.join(run_dir, "src")
            # write the ORIGINAL crops, not the resized render tiles: TILE MERGE
            # stitches and colour-matches against these and needs real sizes
            _os.makedirs(cut_dir, exist_ok=True)
            _os.makedirs(src_dir, exist_ok=True)
            for i in range(total):
                im = _Img.fromarray((np.clip(crops[i][:, :, :3], 0, 1) * 255).astype(np.uint8))
                im.save(_os.path.join(src_dir, "T%02d.png" % i))   # full size: colour match
                im.thumbnail((320, 320))
                im.save(_os.path.join(cut_dir, "T%02d.png" % i))   # small: the panel
        except Exception:
            pass

        ui = {
            "tiles": [{"i": i} for i in range(total)],   # pictures come from /view, not base64
            "cols": [cols], "rows": [rows], "total": [total], "report": [report],
            "tile_w": [tw], "tile_h": [th],
            "run_key": [key], "cache_dir": [cache_dir_v],
        }
        return {
            "ui": ui,
            "result": ([cache.to_tensor(batch[i]) for i in range(total)],
                       list(range(total)),
                       _geometry_json(source_w, source_h, tw, th, rows, cols,
                                      ovx, ovy, total, key, cache_dir)),
        }


NODE_CLASS_MAPPINGS = {"TileSplitEternal": TileSplitEternal}
NODE_DISPLAY_NAME_MAPPINGS = {"TileSplitEternal": "TILE SPLIT ETERNAL"}
