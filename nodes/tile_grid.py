"""
TileGridEternal — plan a tile grid for ANY input image size.

You choose HOW MANY tiles you want (2, 3, 6, ...) or how big each tile should
be; the node figures out rows/cols, and picks the split that gives the most
SQUARE-ish tiles for the image's shape:

    square image      -> square tiles
    9:16 image        -> 2x3 tiles, still square-ish, never stretched slivers

All tile sizes are multiples of 16 so latent models never resample.
The stitched output is always EXACTLY the source size.

CATEGORY = "⚡ ETERNAL ● ↩ /🗄 _archive"
"""

from __future__ import annotations

try:
    from ._tile_common import plan_grid
except ImportError:  # standalone import (tests)
    from _tile_common import plan_grid


class TileGridEternal:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "IMAGE": ("IMAGE",),
                "mode": ([
                    "Auto (squarest)",
                    "Total tiles",
                    "Manual rows x cols",
                ], {
                    "default": "Auto (squarest)",
                    "tooltip": (
                        "Auto: pick tile size below and the node decides the "
                        "grid. Total tiles: say you want 2, 3, 6 tiles and the "
                        "node splits them squarest. Manual: you set rows/cols."
                    ),
                }),
                "aspect": ([
                    "Square tiles",
                    "Match image aspect",
                ], {
                    "default": "Square tiles",
                    "tooltip": (
                        "Square tiles: every tile as close to 1:1 as the image "
                        "shape allows. Match image aspect: tiles keep the "
                        "source's aspect ratio."
                    ),
                }),
                "target_tile": (
                    "INT",
                    {"default": 1024, "min": 16, "max": 8192, "step": 16,
                     "tooltip": "Desired tile size in px (Auto mode)."},
                ),
                "overlap": (
                    "INT",
                    {"default": 128, "min": 0, "max": 2048, "step": 16,
                     "tooltip": "Overlap between neighbouring tiles, in px."},
                ),
                "total_tiles": (
                    "INT",
                    {"default": 2, "min": 1, "max": 4096, "step": 1,
                     "tooltip": "Used by 'Total tiles' mode: 2, 3, 6, ..."},
                ),
                "tiles_x": (
                    "INT",
                    {"default": 1, "min": 1, "max": 256, "step": 1,
                     "tooltip": "Used by 'Manual rows x cols' mode: columns."},
                ),
                "tiles_y": (
                    "INT",
                    {"default": 1, "min": 1, "max": 256, "step": 1,
                     "tooltip": "Used by 'Manual rows x cols' mode: rows."},
                ),
            }
        }

    RETURN_TYPES = ("INT", "INT", "INT", "INT", "INT", "INT", "INT", "INT", "INT")
    RETURN_NAMES = (
        "rows", "cols", "tile_width", "tile_height",
        "overlap_x", "overlap_y", "total_tiles", "out_w", "out_h",
    )
    FUNCTION = "compute"
    CATEGORY = "⚡ ETERNAL ● ↩ /🗄 _archive"
    OUTPUT_TOOLTIPS = (
        "Number of tile rows.",
        "Number of tile columns.",
        "Tile width in px (multiple of 16).",
        "Tile height in px (multiple of 16).",
        "Real X overlap after the grid is laid out.",
        "Real Y overlap after the grid is laid out.",
        "rows * cols — feed straight into the loop total.",
        "Final output width (== source width).",
        "Final output height (== source height).",
    )

    def compute(self, IMAGE, mode, aspect, target_tile, overlap,
                total_tiles, tiles_x, tiles_y):
        if not hasattr(IMAGE, "shape"):
            raise TypeError(
                f"IMAGE must have a shape attribute, got {type(IMAGE)!r}")
        s = IMAGE.shape
        if len(s) == 4:      # BHWC (torch tensor from ComfyUI)
            h, w = int(s[1]), int(s[2])
        elif len(s) == 3:    # HWC (numpy)
            h, w = int(s[0]), int(s[1])
        else:
            raise ValueError(f"Unexpected image shape {s!r}")

        rows, cols, tw, th, ovx, ovy, total = plan_grid(
            w, h, mode, target_tile, overlap, total_tiles, tiles_x, tiles_y,
            aspect,
        )
        return (rows, cols, tw, th, ovx, ovy, total, w, h)


NODE_CLASS_MAPPINGS = {"TileGridEternal": TileGridEternal}
NODE_DISPLAY_NAME_MAPPINGS = {"TileGridEternal": "Tile Grid ETERNAL"}
