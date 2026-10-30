"""
TILE SOURCE ETERNAL - prompts + cache decision, after the captioner.

It sits BETWEEN AI Prompt Pixaroma and the model chain:

    TILE SPLIT -> tiles (LIST) -> AI Prompt Pixaroma -> captions (LIST)
                                        \\
                                         --> TILE SOURCE -> tiles + prompts (aligned)

For every tile it works out the final prompt and decides whether that tile has
to render:

    prompt = global_prompt, always
             + that tile's AI caption

    render = the tile is not in the temp cache yet
             (or a redo request is sitting in the run folder)

A redo request is a tiny redo.json written by TILE MERGE's buttons:

    {"mode": "one", "tile": 7}     -> only T7 renders
    {"mode": "all"}                -> everything renders

It is deleted as soon as it is read, so it can never stick.

CATEGORY = "ETERNAL / Tiles"
"""

from __future__ import annotations

import json
import os
from typing import List

import numpy as np

try:
    from . import _tile_cache as cache
except ImportError:
    import _tile_cache as cache


def _one(v, default=None):
    if isinstance(v, (list, tuple)):
        return v[0] if v else default
    return default if v is None else v


def _as_list(v):
    if v is None:
        return []
    return list(v) if isinstance(v, (list, tuple)) else [v]


def load_prompts(directory: str) -> dict:
    """Per-tile text typed in the panel, kept in the run folder (prompts.json).

    It lives on disk instead of in a hidden widget: the graph stays clean, the
    edits survive a page reload, and every tile keeps its own line.
    """
    if not directory:
        return {}
    path = os.path.join(directory, "prompts.json")
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        return {int(k): str(v) for k, v in data.items()} if isinstance(data, dict) else {}
    except Exception:
        return {}


def take_redo(directory: str) -> dict:
    """Read (and consume) a redo request left by TILE MERGE's buttons."""
    if not directory:
        return {}
    path = os.path.join(directory, "redo.json")
    if not os.path.isfile(path):
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            req = json.load(fh)
        os.remove(path)
        return req if isinstance(req, dict) else {}
    except Exception:
        return {}


class TileSourceEternal:
    DESCRIPTION = (
        "Builds each tile's prompt: the global prompt alone, plus that tile's "
        "caption only if you wired one. Skips tiles already in the temp cache."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "tiles": ("IMAGE", {"tooltip": "LIST from TILE SPLIT ETERNAL."}),
                "index": ("INT", {"forceInput": True,
                                  "tooltip": "LIST of tile numbers from TILE SPLIT ETERNAL."}),
                "geometry": ("STRING", {"forceInput": True,
                                        "tooltip": "JSON from TILE SPLIT ETERNAL - grid, "
                                                   "sizes, run_key and cache_dir."}),
                "global_prompt": ("STRING", {"default": "", "multiline": True,
                                             "tooltip": "Used for EVERY tile. On its own unless "
                                                        "you also give a caption for that tile."}),
            },
            "optional": {
                # fully optional: most runs are global-prompt-only
                "captions": ("STRING", {"forceInput": True,
                                        "tooltip": "OPTIONAL. LIST from AI Prompt Pixaroma: one "
                                                   "caption per tile, appended to the global "
                                                   "prompt. Leave unwired for global only."}),
            },
        }

    RETURN_TYPES = ("IMAGE", "STRING", "INT")
    RETURN_NAMES = ("tiles", "prompts", "index")
    OUTPUT_IS_LIST = (True, True, True)
    FUNCTION = "pick"
    CATEGORY = "\u26a1 ETERNAL \u25cf \u21a9 /\U0001f9e9 Tiles"
    OUTPUT_NODE = True
    INPUT_IS_LIST = True
    OUTPUT_TOOLTIPS = ("LIST: tiles to render now.", "LIST: prompt for each tile.",
                       "LIST: tile number for each.")

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        """Always re-execute.

        The redo request and the per-tile prompts live on disk, so ComfyUI's
        cache cannot see them change - a cached TILE SOURCE would keep emitting
        the previous plan and the redo button would do nothing.
        """
        return float("nan")

    def pick(self, tiles, index, geometry, global_prompt="", captions=None):
        try:
            from .tile_split_v2 import parse_geometry
        except ImportError:
            from tile_split_v2 import parse_geometry

        geo = parse_geometry(geometry)
        key = str(geo.get("run_key", "") or "")
        cache_dir = str(geo.get("cache_dir", "ETERNAL_TILES") or "ETERNAL_TILES")
        total = int(geo.get("total", 0) or len(_as_list(tiles)))
        directory = cache.run_dir(cache_dir, key) if key else ""

        gp = str(_one(global_prompt, "") or "")
        typed = load_prompts(directory) if directory else {}
        redo = take_redo(directory) if directory else {}
        redo_mode, redo_tile = str(redo.get("mode", "")), int(redo.get("tile", -1))

        tile_list = _as_list(tiles)
        idx_list = [int(x) for x in _as_list(index)] or list(range(len(tile_list)))
        caps = [str(c) for c in _as_list(captions)]      # [] when unwired

        out_tiles, out_prompts, out_index, rows_ui = [], [], [], []
        for pos, i in enumerate(idx_list):
            cap = caps[pos] if pos < len(caps) else ""   # no caption = global only
            own = (typed.get(i, "") or "").strip()      # typed line wins over the caption
            per_tile = own or cap.strip()
            # global prompt is NOT a fallback: every tile carries it, plus its own text
            text = (gp.strip() + (", " + per_tile if per_tile else "")).strip()
            cached = bool(directory) and cache.has_tile(directory, i)
            if redo_mode == "all":
                do = True
            elif redo_mode == "one":
                do = (i == redo_tile)
            else:
                do = not cached
            rows_ui.append({"i": i, "prompt": text, "caption": cap, "own": own,
                            "cached": cached, "render": do})
            if do:
                out_tiles.append(tile_list[pos])
                out_prompts.append(text)
                out_index.append(i)

        report = (f"{len(out_index)} to render"
                  + (" (" + ",".join(f"T{i}" for i in out_index) + ")" if out_index else "")
                  + f" | {total - len(out_index)} reused")
        if redo_mode:
            report += f" | redo {redo_mode}" + (f" T{redo_tile}" if redo_mode == "one" else "")
        if not out_index:
            out_tiles, out_prompts, out_index = [tile_list[0] if tile_list else None], [""], [-1]

        ui = {"tiles": rows_ui, "report": [report],
              "run_key": [key], "cache_dir": [cache_dir], "total": [total],
              "cols": [int(geo.get("cols", 0) or 0)],
              "rows": [int(geo.get("rows", 0) or 0)],
              "tile_w": [int(geo.get("tile_w", 0) or 0)],
              "tile_h": [int(geo.get("tile_h", 0) or 0)]}
        return {"ui": ui, "result": (out_tiles, out_prompts, out_index)}


NODE_CLASS_MAPPINGS = {"TileSourceEternal": TileSourceEternal}
NODE_DISPLAY_NAME_MAPPINGS = {"TileSourceEternal": "TILE SOURCE ETERNAL"}
