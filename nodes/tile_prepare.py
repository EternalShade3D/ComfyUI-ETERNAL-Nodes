"""
TilePrepareEternal — ONE node that replaces TILE GRID + TILE SPLIT + TILE UNBATCH.

    in:  IMAGE (any size)
    out: IMAGE          tile batch, row-major  -> feed the loop + the prompt panel
         tile           LIST of tiles, one at a time -> feed a VL / captioner
         tile_context   LIST of tiles with the WHOLE image inset in the corner
                        -> feed a VL when it needs scene context, not just the
                           tile (stops each tile becoming its own little world)
         total_tiles, rows, cols, tile_width, tile_height,
         source_w, source_h, overlap_x, overlap_y

Why one node: deciding the grid (math) and cutting the image (pixels) is ONE
job with one output shape. Splitting them across nodes only created the
question "which one actually does it?".

Key guarantees (see _tile_common):
* tile sizes are multiples of 16
* tiles are evenly spread and the LAST tile ends exactly at the source edge,
  so nothing is edge-padded/stretched for multi-tile axes
* the stitch crops back to source_w x source_h = the size you picked before
  tiling, so output size == input size

CATEGORY = "⚡ ETERNAL ● ↩ /🧩 Tiles"
"""

from __future__ import annotations

import numpy as np

try:
    from ._tile_common import plan_grid, positions, effective_overlap
except ImportError:  # standalone import (tests)
    from _tile_common import plan_grid, positions, effective_overlap


def _to_numpy_hwc(image) -> np.ndarray:
    try:
        import torch
        if torch.is_tensor(image):
            image = image.detach().cpu().numpy()
    except Exception:
        pass
    arr = np.asarray(image, dtype=np.float32)
    if arr.ndim == 4:
        arr = arr[0]
    if arr.ndim != 3:
        raise ValueError(f"Expected HWC image, got {arr.shape}")
    return np.ascontiguousarray(arr)


def _as_tensor(batch_hwc):
    out = np.ascontiguousarray(batch_hwc)
    try:
        import torch
        return torch.from_numpy(out)
    except Exception:
        return out


def _resize_hwc(img: np.ndarray, w: int, h: int) -> np.ndarray:
    """Bilinear resize via PIL when available, else nearest-neighbour decimate."""
    if w <= 0 or h <= 0:
        return img
    try:
        from PIL import Image
        pil = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
        pil = pil.resize((w, h), Image.BILINEAR)
        return (np.asarray(pil, dtype=np.float32) / 255.0)
    except Exception:
        yi = (np.arange(h) * (img.shape[0] / h)).astype(int).clip(0, img.shape[0] - 1)
        xi = (np.arange(w) * (img.shape[1] / w)).astype(int).clip(0, img.shape[1] - 1)
        return img[yi][:, xi]


def _with_inset(tile: np.ndarray, whole: np.ndarray, scale: float,
                border: int = 2) -> np.ndarray:
    """Paste a downscaled copy of the WHOLE image into the tile's top-left."""
    th, tw = tile.shape[0], tile.shape[1]
    iw = max(16, int(tw * float(scale)))
    ih = max(16, int(whole.shape[0] * (iw / max(1, whole.shape[1]))))
    if ih >= th - 4 or iw >= tw - 4:
        return tile
    inset = _resize_hwc(whole, iw, ih)
    out = tile.copy()
    out[:border, :iw + border] = 0.0
    out[ih + border:ih + 2 * border, :iw + border] = 0.0
    out[border:ih + border, :border] = 0.0
    out[border:ih + border, iw + border:iw + 2 * border] = 0.0
    out[border:ih + border, border:iw + border] = inset
    return out


class TilePrepareEternal:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "IMAGE": ("IMAGE",),
                "mode": (["Auto (squarest)", "Total tiles", "Manual rows x cols"], {
                    "default": "Auto (squarest)",
                    "tooltip": ("Auto: decide tiles from target_tile. "
                                "Total tiles: you say 2, 3, 6... and it picks the "
                                "squarest split. Manual: you set rows/cols."),
                }),
                "aspect": (["Square tiles", "Match image aspect"], {
                    "default": "Square tiles",
                    "tooltip": "Square-ish tiles for any image shape.",
                }),
                "target_tile": ("INT", {"default": 1024, "min": 16, "max": 8192,
                                        "step": 16}),
                "overlap": ("INT", {"default": 128, "min": 0, "max": 2048,
                                    "step": 16}),
                "total_tiles": ("INT", {"default": 6, "min": 1, "max": 4096}),
                "tiles_x": ("INT", {"default": 1, "min": 1, "max": 256}),
                "tiles_y": ("INT", {"default": 1, "min": 1, "max": 256}),
            }
        }

    # slots 1-8 are the passthroughs, in the SAME order as the TILE STITCH
    # inputs, so PREPARE -> STITCH is one straight drag.
    RETURN_TYPES = ("IMAGE", "INT", "INT", "INT", "INT", "INT", "INT", "INT",
                    "INT", "INT", "IMAGE")
    RETURN_NAMES = ("IMAGE", "source_w", "source_h", "tile_width", "tile_height",
                    "rows", "cols", "overlap_x", "overlap_y", "total_tiles",
                    "tile")
    OUTPUT_IS_LIST = (False, False, False, False, False, False, False, False,
                      False, False, True)
    FUNCTION = "prepare"
    CATEGORY = "⚡ ETERNAL ● ↩ /🧩 Tiles"
    OUTPUT_TOOLTIPS = (
        "Tile batch (row-major) -> the loop, and the prompt panel.",
        "Output width == your input width.",
        "Output height == your input height.",
        "Tile width (multiple of 16).",
        "Tile height (multiple of 16).",
        "Tile rows.",
        "Tile columns.",
        "Real X overlap.",
        "Real Y overlap.",
        "rows * cols -> loop total.",
        "LIST: ONE tile per execution -> feed a VL so it sees a single tile "
        "at a time. Scene context for a VL travels as TEXT (a description of "
        "the whole image + which tile it is on), never as a pasted picture.",
    )

    def prepare(self, IMAGE, mode, aspect, target_tile, overlap, total_tiles,
                tiles_x, tiles_y):
        src = _to_numpy_hwc(IMAGE)
        source_h, source_w = int(src.shape[0]), int(src.shape[1])

        rows, cols, tw, th, ovx, ovy, total = plan_grid(
            source_w, source_h, mode, target_tile, overlap, total_tiles,
            tiles_x, tiles_y, aspect)

        px = positions(source_w, tw, cols)
        py = positions(source_h, th, rows)

        pad_r = max(0, (max(px) + tw) - source_w)
        pad_b = max(0, (max(py) + th) - source_h)
        canvas = src
        if pad_r or pad_b:
            canvas = np.pad(src, ((0, pad_b), (0, pad_r), (0, 0)), mode="edge")

        tiles = []
        for y in py:
            for x in px:
                tiles.append(canvas[y:y + th, x:x + tw, :])
        batch = np.stack(tiles, axis=0)

        # the LOOP gets the batch; a VL gets the same list, one at a time.
        # slice the TENSOR (not the numpy stack) so every IMAGE output is a
        # tensor - numpy here breaks PreviewImage/SaveImage downstream.
        batch_t = _as_tensor(batch)
        # one tile per execution for a VL; slice the TENSOR so every IMAGE
        # output stays a tensor (numpy here breaks PreviewImage/SaveImage)
        tile_list = [batch_t[i:i + 1] for i in range(int(batch_t.shape[0]))]

        ovx = effective_overlap(source_w, tw, cols)
        ovy = effective_overlap(source_h, th, rows)

        # slot order is deliberate: 1-8 line up 1:1 with TILE STITCH inputs
        return (_as_tensor(batch), source_w, source_h, tw, th, rows, cols,
                ovx, ovy, total, tile_list)


NODE_CLASS_MAPPINGS = {"TilePrepareEternal": TilePrepareEternal}
NODE_DISPLAY_NAME_MAPPINGS = {"TilePrepareEternal": "TILE PREPARE ETERNAL"}
