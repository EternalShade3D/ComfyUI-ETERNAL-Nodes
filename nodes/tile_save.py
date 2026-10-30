"""
TILE SAVE ETERNAL - writes each decoded tile the moment it comes out.

Why this node exists
--------------------
TILE MERGE only runs once, at the very end, so while the workflow was working on
tile 3 of 24 nothing existed on disk and no panel could show it.

This node sits between VAEDecode and TILE MERGE:

    VAEDecode -> TILE SAVE -> TILE MERGE

It runs ONCE PER TILE (no INPUT_IS_LIST), so each finished tile is:

    * written to  <comfy temp>/<cache_dir>/<run_key>/T<nn>.png   immediately
    * pushed to its panel as a live "done" thumbnail
    * passed straight through to TILE MERGE, unchanged

CATEGORY = "ETERNAL / Tiles"
"""

from __future__ import annotations

import os

import numpy as np

try:
    from . import _tile_cache as cache
except ImportError:
    import _tile_cache as cache


def _one(v, default=None):
    if isinstance(v, (list, tuple)):
        return v[0] if v else default
    return default if v is None else v


def _to_hwc(t):
    try:
        import torch
        if torch.is_tensor(t):
            t = t.detach().cpu().numpy()
    except Exception:
        pass
    a = np.asarray(t, dtype=np.float32)
    while a.ndim > 3:
        a = a[0]
    return np.ascontiguousarray(a)


class TileSaveEternal:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {"tooltip": "The decoded tile, straight from VAEDecode."}),
                "index": ("INT", {"forceInput": True,
                                  "tooltip": "Which tile this is - from TILE SOURCE ETERNAL."}),
                "geometry": ("STRING", {"forceInput": True,
                                        "tooltip": "JSON from TILE SPLIT ETERNAL - gives the "
                                                   "run_key and cache_dir."}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("IMAGE", "INT")
    RETURN_NAMES = ("image", "index")
    OUTPUT_TOOLTIPS = ("The same tile, unchanged, so TILE MERGE receives the full set.",
                       "The same index, unchanged.")
    FUNCTION = "save"
    CATEGORY = "\u26a1 ETERNAL \u25cf \u21a9 /\U0001f9e9 Tiles"
    OUTPUT_NODE = True

    def save(self, image, index, geometry, unique_id=None):
        try:
            from .tile_split_v2 import parse_geometry
        except ImportError:
            from tile_split_v2 import parse_geometry

        geo = parse_geometry(geometry)
        key = str(geo.get("run_key", "") or "")
        cache_dir = str(geo.get("cache_dir", "ETERNAL_TILES") or "ETERNAL_TILES")
        i = int(_one(index, -1))

        written, report, done = False, "no run key - tile not saved", []
        if key and i >= 0:
            directory = cache.run_dir(cache_dir, key)
            try:
                os.makedirs(directory, exist_ok=True)
                cache.save_tile(directory, i, _to_hwc(image))
                written, report = True, "T%d saved" % i
            except Exception as exc:
                report = "T%d save failed: %s" % (i, exc)
            try:
                done = sorted(int(f[1:3]) for f in os.listdir(directory)
                              if f.startswith("T") and f.endswith(".png") and len(f) == 7)
            except Exception:
                done = []

        try:
            from server import PromptServer
            PromptServer.instance.send_sync("eternal-tile-saved", {
                "node": _one(unique_id, ""),
                "i": i, "count": len(done), "written": written,
                "run_key": key, "cache_dir": cache_dir,
                "report": report + (" | %d tiles on disk" % len(done) if done else ""),
            })
        except Exception:
            pass

        ui = {
            "tiles": [{"i": n} for n in done],
            "report": [report + (" | %d tiles on disk" % len(done) if done else "")],
            "run_key": [key], "cache_dir": [cache_dir],
        }
        return {"ui": ui, "result": (image, i)}


NODE_CLASS_MAPPINGS = {"TileSaveEternal": TileSaveEternal}
NODE_DISPLAY_NAME_MAPPINGS = {"TileSaveEternal": "TILE SAVE ETERNAL"}
