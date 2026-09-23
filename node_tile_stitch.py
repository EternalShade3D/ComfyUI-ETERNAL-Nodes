"""
TileStitchEternal — blend a row-major tile batch back to the EXACT source size.

Tiles are placed at the same even-spread positions TileSplitEternal used, and
cross-faded with a separable ramp mask. A tile only ramps on an edge that has
a NEIGHBOUR: ramping the outer canvas edge would drive its weight to zero and
blacken the first row/column.

Every overlap length is derived from the actual positions, so it stays correct
even when the real overlap differs from the requested one.

Output is ALWAYS cropped to (source_h, source_w) — the size the user picked in
the load/resize node before tiling. Nothing else ever leaves this node.

CATEGORY = "⚡ ETERNAL ● ↩ /🧩 Tiles"
"""

from __future__ import annotations

import numpy as np

try:
    from ._tile_common import positions
except ImportError:  # standalone import (tests)
    from _tile_common import positions


def _axis_weight(p_i, pos_list, tile, i, n) -> np.ndarray:
    """1-D cross-fade weight for tile i along one axis."""
    w = np.ones(int(tile), dtype=np.float32)
    if n <= 1:
        return w

    if i > 0:
        ov = min(int(tile), int(tile - (p_i - pos_list[i - 1])))
        if ov > 0:
            w[:ov] = np.minimum(w[:ov], np.linspace(0.0, 1.0, ov,
                                                    dtype=np.float32))
    if i < n - 1:
        ov = min(int(tile), int(tile - (pos_list[i + 1] - p_i)))
        if ov > 0:
            w[-ov:] = np.minimum(w[-ov:], np.linspace(1.0, 0.0, ov,
                                                      dtype=np.float32))
    return w


class TileStitchEternal:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "IMAGE": ("IMAGE",),           # tile batch, row-major
                "source_w": ("INT", {"default": 1024, "min": 1, "max": 65536}),
                "source_h": ("INT", {"default": 1024, "min": 1, "max": 65536}),
                "tile_width": ("INT", {"default": 1024, "min": 16, "max": 65536}),
                "tile_height": ("INT", {"default": 1024, "min": 16, "max": 65536}),
                "rows": ("INT", {"default": 1, "min": 1, "max": 256}),
                "cols": ("INT", {"default": 1, "min": 1, "max": 256}),
                # kept for wiring clarity / future softness control
                "overlap_x": ("INT", {"default": 0, "min": 0, "max": 8192}),
                "overlap_y": ("INT", {"default": 0, "min": 0, "max": 8192}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("IMAGE",)
    FUNCTION = "stitch"
    CATEGORY = "⚡ ETERNAL ● ↩ /🧩 Tiles"
    OUTPUT_TOOLTIPS = ("Stitched image, exactly source_w x source_h.",)

    def stitch(self, IMAGE, source_w, source_h, tile_width, tile_height,
               rows, cols, overlap_x=0, overlap_y=0):
        tiles = IMAGE
        try:
            import torch
            if torch.is_tensor(tiles):
                tiles = tiles.detach().cpu().numpy()
        except Exception:
            pass
        tiles = np.asarray(tiles, dtype=np.float32)
        if tiles.ndim == 3:
            tiles = tiles[np.newaxis, ...]
        if tiles.ndim != 4:
            raise ValueError(f"Tile batch must be 4D, got {tiles.shape}")

        source_w = max(1, int(source_w))
        source_h = max(1, int(source_h))
        tile_width = max(1, int(tile_width))
        tile_height = max(1, int(tile_height))
        rows = max(1, int(rows))
        cols = max(1, int(cols))

        px = positions(source_w, tile_width, cols)
        py = positions(source_h, tile_height, rows)

        channels = int(tiles.shape[3])
        acc = np.zeros((source_h, source_w, channels), dtype=np.float32)
        wacc = np.zeros((source_h, source_w), dtype=np.float32)

        for idx in range(min(len(tiles), rows * cols)):
            r, c = divmod(idx, cols)
            y0, x0 = py[r], px[c]

            wy = _axis_weight(y0, py, tile_height, r, rows)
            wx = _axis_weight(x0, px, tile_width, c, cols)
            w2d = wy[:, None] * wx[None, :]

            # clip placement to the source (covers the single-tile snap case)
            y1 = min(y0 + tile_height, source_h)
            x1 = min(x0 + tile_width, source_w)
            th, tw = y1 - y0, x1 - x0
            if th <= 0 or tw <= 0:
                continue

            tile = tiles[idx]
            tile = tile[:th, :tw, :]
            w = w2d[:th, :tw]

            acc[y0:y1, x0:x1, :] += tile * w[:, :, None]
            wacc[y0:y1, x0:x1] += w

        wacc = np.maximum(wacc, 1e-8)
        out = acc / wacc[:, :, None]

        # never let a numerically-empty pixel through
        empty = wacc <= 1e-7
        if empty.any():
            out[empty] = 0.0

        # EXACT source size, batch dim kept, torch tensor for ComfyUI.
        out = out[:source_h, :source_w, :]
        out = out[np.newaxis, ...]
        out = np.clip(out, 0.0, 1.0)
        try:
            import torch
            out = torch.from_numpy(np.ascontiguousarray(out))
        except Exception:
            pass
        return (out,)


NODE_CLASS_MAPPINGS = {"TileStitchEternal": TileStitchEternal}
NODE_DISPLAY_NAME_MAPPINGS = {"TileStitchEternal": "Tile Stitch ETERNAL"}
