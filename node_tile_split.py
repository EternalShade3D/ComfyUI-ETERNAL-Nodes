"""
TileSplitEternal — cut an image into a row-major tile batch.

Tiles are placed with the shared even-spread contract (_tile_common.positions):
the last tile ends EXACTLY at the source edge, so for any multi-tile axis NO
tile overhangs and there is ZERO replicated/stretched edge padding.

Only a single-tile axis whose source size is not a multiple of 16 gets up to
15 px of replicated edge — and the stitch crops that away, so the final image
is always exactly the source size.

Outputs carry every number the stitch needs, so there is one source of truth.

CATEGORY = "⚡ ETERNAL ● ↩ /🗄 _archive"
"""

from __future__ import annotations

import numpy as np

try:
    from ._tile_common import positions, effective_overlap
except ImportError:  # standalone import (tests)
    from _tile_common import positions, effective_overlap


def _to_numpy_hwc(image) -> np.ndarray:
    """Accept torch tensor or numpy, return float32 HWC of the first image."""
    try:
        import torch
        if torch.is_tensor(image):
            image = image.detach().cpu().numpy()
    except Exception:
        pass
    arr = np.asarray(image, dtype=np.float32)
    if arr.ndim == 4:      # B,H,W,C -> first item
        arr = arr[0]
    if arr.ndim != 3:
        raise ValueError(f"Expected a HWC image, got shape {arr.shape}")
    return np.ascontiguousarray(arr)


def _as_tensor(batch_hwc):
    """ComfyUI IMAGE must be a torch tensor (B,H,W,C float32)."""
    out = np.ascontiguousarray(batch_hwc)
    try:
        import torch
        return torch.from_numpy(out)
    except Exception:
        return out


class TileSplitEternal:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "IMAGE": ("IMAGE",),
                "rows": ("INT", {"default": 1, "min": 1, "max": 256}),
                "cols": ("INT", {"default": 1, "min": 1, "max": 256}),
                "tile_width": ("INT", {"default": 1024, "min": 16, "max": 65536}),
                "tile_height": ("INT", {"default": 1024, "min": 16, "max": 65536}),
            }
        }

    RETURN_TYPES = (
        "IMAGE", "INT", "INT", "INT", "INT", "INT", "INT", "INT", "INT",
    )
    RETURN_NAMES = (
        "IMAGE", "source_w", "source_h", "tile_width", "tile_height",
        "rows", "cols", "overlap_x", "overlap_y",
    )
    FUNCTION = "split"
    CATEGORY = "⚡ ETERNAL ● ↩ /🗄 _archive"
    OUTPUT_TOOLTIPS = (
        "Row-major tile batch.",
        "Original image width (final output width).",
        "Original image height (final output height).",
        "Width of each tile.",
        "Height of each tile.",
        "Tile rows.",
        "Tile columns.",
        "Real X overlap (even-spread, may differ from the request).",
        "Real Y overlap (even-spread, may differ from the request).",
    )

    def split(self, IMAGE, rows, cols, tile_width, tile_height):
        src = _to_numpy_hwc(IMAGE)
        source_h, source_w = int(src.shape[0]), int(src.shape[1])

        rows = max(1, int(rows))
        cols = max(1, int(cols))
        tile_width = max(1, int(tile_width))
        tile_height = max(1, int(tile_height))

        px = positions(source_w, tile_width, cols)
        py = positions(source_h, tile_height, rows)

        # Only a single-tile axis can overhang (<= 15 px) -> replicate edge.
        pad_r = max(0, (max(px) + tile_width) - source_w)
        pad_b = max(0, (max(py) + tile_height) - source_h)
        if pad_r or pad_b:
            src = np.pad(src, ((0, pad_b), (0, pad_r), (0, 0)), mode="edge")

        tiles = []
        for y in py:
            for x in px:
                tiles.append(src[y:y + tile_height, x:x + tile_width, :])

        batch = np.stack(tiles, axis=0)

        ov_x = effective_overlap(source_w, tile_width, cols)
        ov_y = effective_overlap(source_h, tile_height, rows)

        return (
            _as_tensor(batch),
            source_w, source_h,
            tile_width, tile_height,
            rows, cols,
            ov_x, ov_y,
        )


NODE_CLASS_MAPPINGS = {"TileSplitEternal": TileSplitEternal}
NODE_DISPLAY_NAME_MAPPINGS = {"TileSplitEternal": "Tile Split ETERNAL"}
