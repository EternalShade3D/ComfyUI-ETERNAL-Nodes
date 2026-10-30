"""
TILE MERGE ETERNAL - the back half, and the interactive panel.

It receives the rendered tiles as a LIST (one item per tile the model chain just
produced), writes each one into the temp cache under its tile number, then loads
the WHOLE set back from disk, cross-fades it into the full-size image and hands
it to your Save / Preview node.

Because it stitches from the cache - not from the in-memory batch - a
single-tile redo replaces just that tile and everything else is reused.

Its panel (js/tile_merge_panel.js) shows the stitched before/after with a drag
divider, every tile clickable on top of it, and:
  * REDO THIS TILE -> renders only that tile and re-stitches
  * REDO ALL       -> renders every tile again

Both buttons POST a redo request to /eternal/redo; TILE SOURCE reads it on the
next run. No widget poking between nodes.

INPUT_IS_LIST is True: this node MUST receive the whole list in one call. With
it False ComfyUI would run the node once per tile and it could never stitch.

CATEGORY = "ETERNAL / Tiles"
"""

from __future__ import annotations

import os
from typing import List

import numpy as np

try:
    from . import _tile_cache as cache
    from ._tile_common import positions
except ImportError:  # standalone import (tests)
    import _tile_cache as cache
    from _tile_common import positions


def _one(value, default=None):
    if isinstance(value, (list, tuple)):
        if not value:
            return default
        value = value[0]
    return default if value is None else value


def _to_hwc(item) -> np.ndarray:
    try:
        import torch
        if torch.is_tensor(item):
            item = item.detach().cpu().numpy()
    except Exception:
        pass
    arr = np.asarray(item, dtype=np.float32)
    while arr.ndim > 3:
        arr = arr[0]
    if arr.ndim == 2:
        arr = np.repeat(arr[:, :, None], 3, axis=2)
    return np.ascontiguousarray(arr)


def _save_png(arr, path, box=None):
    try:
        from PIL import Image
        im = Image.fromarray((np.clip(arr, 0, 1) * 255).astype(np.uint8))
        if box:
            im.thumbnail(box)
        im.save(path)
        return True
    except Exception:
        return False


class TileMergeEternal:
    DESCRIPTION = (
        "Writes the rendered tiles to the temp cache, reloads the whole set, "
        "cross-fades it to the source size and shows the before/after panel "
        "where you can pick one tile and redo only that tile."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "tiles": ("IMAGE", {"tooltip": "LIST from the model chain (one image per tile)."}),
                "index": ("INT", {"forceInput": True,
                                  "tooltip": "LIST of tile numbers from TILE SOURCE ETERNAL."}),
                "geometry": ("STRING", {"forceInput": True,
                                        "tooltip": "JSON from TILE SPLIT ETERNAL - sizes, grid, "
                                                   "overlaps, total, run_key, cache_dir."}),
                "color_match": ("BOOLEAN", {"default": True,
                                            "tooltip": "Match each tile's colour to its own source "
                                                       "crop (LAB mean/std) so the stitch has no "
                                                       "colour drift."}),
                "color_strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05,
                                             "tooltip": "How hard to pull each tile onto its crop. "
                                                        "1.0 = full match (measured most accurate), "
                                                        "0.85 = softer, 0 = off. Ignored when "
                                                        "color_match is off."}),
            },
            "optional": {
                "prompts": ("STRING", {"forceInput": True,
                                       "tooltip": "Prompts actually used, one per rendered tile."}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    OUTPUT_TOOLTIPS = ("Stitched, exact source size -> Save Image.",)
    FUNCTION = "merge"
    CATEGORY = "\u26a1 ETERNAL \u25cf \u21a9 /\U0001f9e9 Tiles"
    OUTPUT_NODE = True
    INPUT_IS_LIST = True

    # ------------------------------------------------------------------ #
    def merge(self, tiles, index, geometry, color_match=True, color_strength=1.0,
              prompts=None):

        try:
            from .tile_split_v2 import parse_geometry
        except ImportError:
            from tile_split_v2 import parse_geometry

        geo = parse_geometry(geometry)
        source_w, source_h = int(geo.get("source_w", 0)), int(geo.get("source_h", 0))
        tile_w, tile_h = int(geo.get("tile_w", 0)), int(geo.get("tile_h", 0))
        rows, cols = int(geo.get("rows", 1)), int(geo.get("cols", 1))
        total = int(geo.get("total", 1))
        key = str(geo.get("run_key", "") or "")
        cache_dir = str(geo.get("cache_dir", "ETERNAL_TILES") or "ETERNAL_TILES")
        if not source_w or not tile_w:
            raise ValueError("TILE MERGE ETERNAL: the geometry socket is empty or not valid "
                             "JSON - wire it from TILE SPLIT ETERNAL.")
        if not key:
            raise ValueError("TILE MERGE ETERNAL: no run_key inside the geometry socket - "
                             "wire the geometry output of TILE SPLIT ETERNAL here.")

        rendered = list(tiles) if isinstance(tiles, (list, tuple)) else [tiles]
        flat_r = []
        for it in rendered:                     # a batch can arrive as one item
            if isinstance(it, (list, tuple)):
                flat_r.extend(it)
            elif hasattr(it, "ndim") and getattr(it, "ndim", 0) == 4:
                flat_r.extend(list(it))
            else:
                flat_r.append(it)
        rendered = flat_r

        idx_list = []
        for x in (list(index) if isinstance(index, (list, tuple)) else [index]):
            if isinstance(x, (list, tuple)):
                idx_list.extend(int(v) for v in x)
            else:
                idx_list.append(int(x))
        prompts = list(prompts) if isinstance(prompts, (list, tuple)) else ([prompts] if prompts else [])

        directory = cache.run_dir(cache_dir, key)
        os.makedirs(directory, exist_ok=True)

        # ---- 1. write what the chain just produced --------------------- #
        # If the index arrives as the "nothing to render" dummy (-1) while the
        # chain still handed over the full set, pair by position instead of
        # dropping every tile and then complaining the cache is empty.
        usable = [x for x in idx_list if x >= 0]
        if not usable and len(rendered) == total:
            idx_list = list(range(len(rendered)))
        written = []
        for n, item in enumerate(rendered):
            i = int(idx_list[n]) if n < len(idx_list) else -1
            if i < 0:
                continue
            cache.save_tile(directory, i, _to_hwc(item))
            written.append(i)

        # ---- 2. load the whole set back ------------------------------- #
        after, missing = [], []
        for i in range(total):
            path = cache.tile_path(directory, i)
            if not os.path.isfile(path):
                missing.append(i)
                after.append(None)
            else:
                after.append(cache.load_tile(path))
        if missing and len(missing) == total:
            raise ValueError(
                "TILE MERGE ETERNAL: nothing is on disk in " + directory + " - not one of the "
                f"{total} tiles. Run the whole grid once (TILE SAVE must sit between VAEDecode "
                "and TILE MERGE), then redo single tiles."
            )

        # ---- 3. engines that insist on their own size ------------------ #
        # Flux3 / Qwen styles encode at a fixed megapixel count and hand back a
        # smaller picture (2464x1664 came back 1232x832). That is a property of
        # the engine, not a wiring bug: rescale the tile instead of killing the
        # run, and say so in the report.
        rescaled = []
        for i, t in enumerate(after):
            if t is None:
                continue
            if (t.shape[0], t.shape[1]) != (tile_h, tile_w):
                rescaled.append((i, int(t.shape[1]), int(t.shape[0])))

        # ---- 4. before = the source crops TILE SPLIT wrote -------------- #
        before = []
        src_dir = os.path.join(directory, "src")
        for i in range(total):
            path = os.path.join(src_dir, "T%02d.png" % i)
            if os.path.isfile(path):
                try:
                    from PIL import Image
                    before.append(np.asarray(Image.open(path).convert("RGB"),
                                             dtype=np.float32) / 255.0)
                    continue
                except Exception:
                    pass
            before.append(None)              # no crop on disk

        if rescaled:
            try:
                from PIL import Image
                for i, _w, _h in rescaled:
                    im = Image.fromarray((np.clip(after[i], 0, 1) * 255).astype(np.uint8))
                    im = im.resize((tile_w, tile_h), Image.LANCZOS)
                    after[i] = np.asarray(im, dtype=np.float32) / 255.0
            except Exception as exc:
                raise ValueError(
                    f"TILE MERGE ETERNAL: {len(rescaled)} tile(s) came back at another size "
                    f"({rescaled[0][1]}x{rescaled[0][2]} instead of {tile_w}x{tile_h}) and "
                    f"rescaling them failed: {exc}"
                )

        # gaps: a wiped temp folder (every restart) or an interrupted run. Show
        # the source crop there instead of killing the whole stitch, and say so.
        blank = np.zeros((tile_h, tile_w, 3), dtype=np.float32)
        for i in range(total):
            if before[i] is None:
                before[i] = after[i] if after[i] is not None else blank
        for i in range(total):
            if after[i] is None:
                after[i] = before[i]

        strength = float(_one(color_strength, 1.0))
        delta_before, matched = 0.0, 0
        if bool(_one(color_match, True)) and strength > 0.001:
            for i, t in enumerate(after):
                if i in written and before[i].shape[:2] == t.shape[:2]:
                    delta_before += float(np.abs(t - before[i]).mean())
                    after[i] = cache.color_match_lab(t, before[i], strength)
                    # store the MATCHED tile: otherwise a later run that reuses
                    # the cache stitches unmatched tiles and the colours shift
                    # between a fresh run and a reused one
                    try:
                        cache.save_tile(directory, i, after[i])
                    except Exception:
                        pass
                    matched += 1
        delta_before = delta_before / matched if matched else 0.0

        fe = 0                      # fade = the whole overlap
        stitched_after = cache.blend(after, source_w, source_h, tile_w, tile_h, rows, cols, fe)
        stitched_before = cache.blend(before, source_w, source_h, tile_w, tile_h, rows, cols, fe)

        # ---- 5. panel payload ------------------------------------------ #
        used_prompts = {}
        for n, i in enumerate(idx_list):
            if n < len(prompts):
                used_prompts[int(i)] = prompts[n]

        thumb_dir = os.path.join(directory, "thumb")
        os.makedirs(thumb_dir, exist_ok=True)
        tiles_ui = []
        for i, t in enumerate(after):
            cache.save_tile(thumb_dir, i, before[i])                 # before thumb (B??.png)
            _save_png(t, os.path.join(thumb_dir, "A%02d.png" % i), (320, 320))
            tiles_ui.append({"i": i, "r": i // max(1, cols), "c": i % max(1, cols),
                             "used": used_prompts.get(i, ""), "fresh": i in written})

        _save_png(stitched_after, os.path.join(directory, "stitch.png"), (1600, 1600))

        gap_note = (f" | {len(missing)} missing (kept the source crop)" if missing else "")
        if matched:
            gap_note += (f" | colour matched {matched} tiles, source delta was {delta_before:.3f}")
        if rescaled:
            gap_note += (f" | {len(rescaled)} rescaled {rescaled[0][1]}x{rescaled[0][2]}"
                         f"->{tile_w}x{tile_h} (engine output size)")
        # the panel shows counts, not a Windows path: that belongs in a tooltip
        report = (f"{len(written)} written"
                  + (" (" + ",".join("T%d" % i for i in written) + ")" if written else "")
                  + f" | {total - len(written) - len(missing)} reused{gap_note}"
                  + f" | {rows}x{cols} of {tile_w}x{tile_h}")
        detail = f"{directory}"

        ui = {
            "geom": [{"source_w": source_w, "source_h": source_h,
                      "tile_w": tile_w, "tile_h": tile_h, "rows": rows, "cols": cols,
                      "px": positions(source_w, tile_w, cols),
                      "py": positions(source_h, tile_h, rows)}],
            "tiles": tiles_ui,
            "run_key": [key], "cache_dir": [cache_dir],
            "stitch_before": [], "stitch_after": [],
            "report": [report], "detail": [detail],
            "count": [total], "cols": [cols], "rows": [rows],
        }
        return {"ui": ui, "result": (cache.to_tensor(stitched_after),)}


NODE_CLASS_MAPPINGS = {"TileMergeEternal": TileMergeEternal}
NODE_DISPLAY_NAME_MAPPINGS = {"TileMergeEternal": "TILE MERGE ETERNAL"}
