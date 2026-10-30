"""
Shared tile math for the ETERNAL tile nodes.

ONE source of truth for grid planning and tile positions, so TileSplitEternal
and TileStitchEternal can never disagree about where a tile belongs.

Contract
--------
* Tiles are always multiples of SNAP = 32 (see the note on SNAP below:
  Qwen-Image 2.1 rounds every reference to a multiple of 32, so a 16-snapped
  tile comes back 16 px narrower and the stitch can't place it).
* Tile positions are EVENLY SPREAD and the LAST tile ends EXACTLY at the
  source edge:   pos(i) = round(i * (source - tile) / (n - 1))
  Consequence: for n >= 2 NO tile ever extends past the source, so there is
  ZERO edge padding and no stretched/clamped pixels in a tile.
* When an axis needs only ONE tile and the source is not a multiple of SNAP,
  the tile is snapped UP, so at most SNAP-1 px of replicated edge exist. The
  stitch crops back to the source size, so the output is still exact.
* Output size always equals source size: stitch crops to (source_h, source_w).
"""

from __future__ import annotations

import math
from typing import List, Tuple

__all__ = [
    "snap_up", "snap_down", "snap16_up", "snap16_down", "plan_axis", "positions",
    "plan_grid", "best_split", "tile_dims", "effective_overlap",
]

# Tile dimensions must be a multiple of SNAP.
# 16 is enough for a plain VAE (8-px latent, even latent dims), but NOT for
# Qwen-Image 2.1: comfy_extras/nodes_qwen.py:160 (TextEncodeQwenImage21) does
#     width, height = round(w / 32) * 32, round(h / 32) * 32
# so a 1552 px tile comes back 1536 px, the stitch has a 1552 px weight mask,
# and the placement math is wrong by 16 px (ValueError broadcast, or a seam).
# 32 keeps every tile through the model untouched.
SNAP = 32


def snap16_up(n: int) -> int:
    """Round UP to the nearest multiple of SNAP (minimum SNAP)."""
    n = int(n)
    if n < SNAP:
        return SNAP
    return ((n + SNAP - 1) // SNAP) * SNAP


def snap_up(n: int) -> int:
    """Round UP to the nearest multiple of SNAP (preferred name)."""
    return snap16_up(n)


def snap_down(n: int) -> int:
    """Round DOWN to the nearest multiple of SNAP (preferred name)."""
    return snap16_down(n)


def snap16_down(n: int) -> int:
    """Round DOWN to the nearest multiple of SNAP (minimum SNAP)."""
    n = int(n)
    if n < SNAP:
        return SNAP
    return max(SNAP, (n // SNAP) * SNAP)


def positions(source: int, tile: int, n: int) -> List[int]:
    """Evenly spread n tiles of width `tile` across `source`.

    Last tile is anchored to the source edge, so no tile overhangs.
    """
    n = max(1, int(n))
    source = int(source)
    tile = int(tile)
    if n == 1:
        return [0]
    span = source - tile
    if span <= 0:
        # tile bigger than the source (should not happen for n >= 2)
        return [0] * n
    return [int(round(i * span / (n - 1))) for i in range(n)]


def effective_overlap(source: int, tile: int, n: int) -> int:
    """Real overlap between neighbouring tiles given even-spread positions."""
    if n <= 1:
        return 0
    span = source - tile
    if span <= 0:
        return 0
    step = span / (n - 1)
    return max(0, int(round(tile - step)))


def plan_axis(source: int, tile_target: int, overlap: int,
              n_fixed=None) -> Tuple[int, int]:
    """Return (n_tiles, tile_size) for ONE axis.

    n_fixed: when given (Total tiles / Manual mode) forces the tile count and
    derives the tile size that yields the requested overlap.
    """
    source = int(source)
    overlap = max(0, int(overlap))
    tile_target = max(SNAP, int(tile_target))

    if n_fixed is not None:
        n = max(1, int(n_fixed))
    else:
        step = max(SNAP, tile_target - overlap)
        n = max(1, math.ceil((source - overlap) / step))

    if n == 1:
        # one tile must cover the whole axis; snap up (<= SNAP-1 px replicated,
        # cropped away by the stitch).
        tile = snap16_up(source)
        return 1, tile

    # Honor the requested overlap EXACTLY.
    # Even-spread anchors the LAST tile flush with the source edge, so the step
    # between neighbours is (source - tile) / (n - 1) and the REAL overlap is
    # tile - step. Solving  tile - (source - tile) / (n - 1) = overlap  gives
    #     tile = (source + (n - 1) * overlap) / n
    # The old formula (source / n + overlap) gave 640 px tiles for a 1024 px
    # source at n = 2, overlap = 128 -> a REAL overlap of 256, i.e. double what
    # was asked, and 94% of the canvas blended from two independent runs.
    want = (source + (n - 1) * overlap) / float(n)
    tile = snap16_up(math.ceil(want))
    # keep the tile inside the source so even-spread can anchor the last tile
    if tile >= source:
        tile = snap16_down(source)
        if tile >= source and source < 16:
            tile = 16
    return n, tile


def best_split(w: int, h: int, total: int, aspect: str = "Square tiles"):
    """Pick (rows, cols) for `total` tiles that give the most square-ish tiles.

    aspect:
      "Square tiles"      -> tile_w / tile_h as close to 1 as possible
      "Match image aspect"-> tiles keep the source aspect ratio
    """
    total = max(1, int(total))
    w = max(1, int(w))
    h = max(1, int(h))
    try:
        src_ar = w / h
    except ZeroDivisionError:
        src_ar = 1.0

    # ONLY exact factorisations, so "Total tiles: 6" really means 6 tiles.
    # (Allowing rows=ceil(total/cols) silently turned 6 into 8.)
    pairs = [(total // c, c) for c in range(1, total + 1) if total % c == 0]
    if not pairs:
        pairs = [(1, total)]

    best = None
    for rows, cols in pairs:
        tw = w / cols
        th = h / rows
        if tw <= 0 or th <= 0:
            continue
        ar = tw / th
        if aspect == "Match image aspect":
            dev = abs(math.log(ar / src_ar))
        else:
            dev = abs(math.log(ar))
        # small tie-breaker: prefer grids that are not extremely lopsided
        dev += 0.001 * abs(cols - rows)
        if best is None or dev < best[0]:
            best = (dev, rows, cols)
    if best is None:
        return 1, 1
    return best[1], best[2]


def tile_dims(w: int, h: int, rows: int, cols: int,
              overlap: int) -> Tuple[int, int, int, int]:
    """(tile_w, tile_h, overlap_x, overlap_y) for a fixed rows/cols grid."""
    _, tile_w = plan_axis(w, max(SNAP, w // max(1, cols)), overlap, n_fixed=cols)
    _, tile_h = plan_axis(h, max(SNAP, h // max(1, rows)), overlap, n_fixed=rows)
    ov_x = effective_overlap(w, tile_w, cols)
    ov_y = effective_overlap(h, tile_h, rows)
    return tile_w, tile_h, ov_x, ov_y


def auto_count(w: int, h: int, target_tile: int, overlap: int,
               aspect: str = "Square tiles") -> Tuple[int, int]:
    """Search tile counts and pick the SQUAREST tiles that still fit the target.

    A pure area estimate is wrong for elongated images (3000x777 would ask for
    2 tiles of 1632x784). This scores each candidate on aspect deviation plus a
    penalty for exceeding / undershooting the requested tile size.
    """
    T = max(SNAP, int(target_tile))
    w = max(1, int(w))
    h = max(1, int(h))
    try:
        src_ar = w / h
    except ZeroDivisionError:
        src_ar = 1.0

    n_max = max(4, min(64, int(math.ceil((w * h) / float(T * T * 0.25))) + 6))
    best = None
    for n in range(1, n_max + 1):
        rows, cols = best_split(w, h, n, aspect)
        tw, th, _, _ = tile_dims(w, h, rows, cols, overlap)
        if tw <= 0 or th <= 0:
            continue
        ar = tw / th
        if aspect == "Match image aspect":
            dev = abs(math.log(ar / src_ar))
        else:
            dev = abs(math.log(ar))
        big, small = max(tw, th), min(tw, th)
        pen = 0.0
        if big > T * 1.10:
            pen += 0.9 * math.log(big / (T * 1.10))
        # Strong anti-oversplit: without this the search happily picks 16 tiny
        # tiles on an elongated image just to chase a perfect 1:1 aspect.
        if small < T * 0.70:
            pen += 0.8 * math.log((T * 0.70) / max(1, small))
        score = dev + pen + 0.002 * n
        if best is None or score < best[0]:
            best = (score, n, rows, cols)
    if best is None:
        return 1, 1
    return best[2], best[3]


def plan_grid(w: int, h: int, mode: str, target_tile: int, overlap: int,
              total_tiles: int, tiles_x: int, tiles_y: int,
              aspect: str = "Square tiles"):
    """Full plan for one image.

    Returns (rows, cols, tile_w, tile_h, overlap_x, overlap_y, total).
    """
    w = max(1, int(w))
    h = max(1, int(h))
    target_tile = max(SNAP, int(target_tile))
    overlap = max(0, int(overlap))

    if mode == "Manual rows x cols":
        cols = max(1, int(tiles_x))
        rows = max(1, int(tiles_y))
    elif mode == "Total tiles":
        rows, cols = best_split(w, h, int(total_tiles), aspect)
    else:  # Auto (squarest)
        rows, cols = auto_count(w, h, target_tile, overlap, aspect)

    tile_w, tile_h, ov_x, ov_y = tile_dims(w, h, rows, cols, overlap)

    # A single-tile axis may have been snapped up; recompute the real overlap.
    ov_x = effective_overlap(w, tile_w, cols)
    ov_y = effective_overlap(h, tile_h, rows)

    return rows, cols, tile_w, tile_h, ov_x, ov_y, rows * cols
