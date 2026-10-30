"""
Shared disk cache + blend for TILE SOURCE ETERNAL / TILE MERGE ETERNAL.

Nothing in here is imported by the older tile nodes - they keep working exactly
as they are. This module only serves the two new nodes.

Cache layout
------------
    <comfy temp>/<cache_dir>/<run_key>/
        meta.json      geometry + the prompt each cached tile was rendered with
        T00.png ...    one file per tile, index padded to 2 digits

Why a run_key: two different source images (or two different grids) must never
share T00.png, otherwise a single-tile redo stitches tiles from two pictures.

Validity of one tile = the PNG exists AND meta.json geometry matches the
current geometry AND meta.json stored that tile's prompt == the prompt we are
about to use. Seed is deliberately NOT part of it: changing a seed re-renders
only what you explicitly redo, never the whole grid.
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Dict, List, Tuple

import numpy as np

try:
    from ._tile_common import positions
except ImportError:  # standalone import (tests)
    from _tile_common import positions


# --------------------------------------------------------------------------- #
# paths
# --------------------------------------------------------------------------- #
def temp_root() -> str:
    """ComfyUI's TEMP folder: tiles live here, never in output/.

    Nothing the user did not explicitly Save ends up in output/. ComfyUI clears
    temp on restart, so the first run after a restart re-renders every tile.
    """
    try:
        import folder_paths
        return folder_paths.get_temp_directory()
    except Exception:
        return os.path.join(os.getcwd(), "temp")


def safe_name(name: str) -> str:
    name = (name or "ETERNAL_TILES").strip().replace("\\", "/")
    name = "/".join(p for p in name.split("/") if p not in ("", ".", ".."))
    keep = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-/ "
    return ("".join(c for c in name if c in keep).strip("/ ") or "ETERNAL_TILES")


def run_key(source_hwc: np.ndarray, rows: int, cols: int,
            tile_w: int, tile_h: int) -> str:
    """Stable fingerprint of the SOURCE PIXELS + the grid they were cut on."""
    h = hashlib.sha1()
    h.update(f"{rows}x{cols}:{tile_w}x{tile_h}:"
             f"{source_hwc.shape[0]}x{source_hwc.shape[1]}".encode())
    # decimate to at most 96 px on the long edge, hash the raw bytes
    sh, sw = source_hwc.shape[0], source_hwc.shape[1]
    step = max(1, int(max(sh, sw) / 96))
    small = np.ascontiguousarray(source_hwc[::step, ::step, :3])
    h.update(np.clip(small * 255.0, 0, 255).astype(np.uint8).tobytes())
    return h.hexdigest()[:12]


def run_dir(cache_dir: str, key: str) -> str:
    return os.path.join(temp_root(), safe_name(cache_dir), key)


def tile_path(directory: str, index: int) -> str:
    return os.path.join(directory, "T%02d.png" % int(index))


def meta_path(directory: str) -> str:
    return os.path.join(directory, "meta.json")


# --------------------------------------------------------------------------- #
# meta.json
# --------------------------------------------------------------------------- #
def geometry(source_w: int, source_h: int, tile_w: int, tile_h: int,
             rows: int, cols: int) -> Dict[str, int]:
    return {"source_w": int(source_w), "source_h": int(source_h),
            "tile_w": int(tile_w), "tile_h": int(tile_h),
            "rows": int(rows), "cols": int(cols)}


def read_meta(directory: str) -> Dict:
    try:
        with open(meta_path(directory), "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_meta(directory: str, geo: Dict[str, int], prompts: List[str]) -> None:
    os.makedirs(directory, exist_ok=True)
    data = {"geometry": geo, "prompts": [str(p or "") for p in prompts]}
    tmp = meta_path(directory) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, meta_path(directory))


def has_tile(directory: str, index: int) -> bool:
    """A tile is reusable when its PNG exists for this source + grid."""
    return os.path.isfile(tile_path(directory, index))


def cached_mask(directory: str, geo: Dict[str, int],
                prompts: List[str], total: int) -> List[bool]:
    """Which tiles on disk are still valid for THIS geometry + THESE prompts."""
    meta = read_meta(directory)
    if meta.get("geometry") != geo:
        return [False] * total
    stored = meta.get("prompts") or []
    out = []
    for i in range(total):
        ok = os.path.isfile(tile_path(directory, i))
        ok = ok and i < len(stored) and str(stored[i]) == str(prompts[i] or "")
        out.append(bool(ok))
    return out


# --------------------------------------------------------------------------- #
# pixel io
# --------------------------------------------------------------------------- #
def save_tile(directory: str, index: int, hwc: np.ndarray) -> str:
    os.makedirs(directory, exist_ok=True)
    from PIL import Image
    arr = np.clip(np.asarray(hwc, dtype=np.float32), 0.0, 1.0)
    if arr.ndim == 2:
        arr = np.repeat(arr[:, :, None], 3, axis=2)
    if arr.shape[-1] == 1:
        arr = np.repeat(arr, 3, axis=2)
    path = tile_path(directory, index)
    Image.fromarray((arr[:, :, :3] * 255.0).astype(np.uint8)).save(path)
    return path


def load_tile(path: str) -> np.ndarray:
    from PIL import Image
    with Image.open(path) as im:
        arr = np.asarray(im.convert("RGB"), dtype=np.float32) / 255.0
    return arr


def png_data_url(hwc: np.ndarray, side: int) -> str:
    """Downscaled base64 PNG for the node panel."""
    import base64
    import io
    from PIL import Image

    arr = np.clip(np.asarray(hwc, dtype=np.float32), 0.0, 1.0)
    while arr.ndim > 3:
        arr = arr[0]
    if arr.ndim == 2:
        arr = np.repeat(arr[:, :, None], 3, axis=2)
    if arr.shape[-1] > 3:
        arr = arr[:, :, :3]
    im = Image.fromarray((arr * 255.0).astype(np.uint8))
    side = max(64, int(side))
    if max(im.size) > side:
        im = im.copy()
        resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
        im.thumbnail((side, side), resample)
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


# --------------------------------------------------------------------------- #
# blend (same cross-fade contract as TileStitchEternal)
# --------------------------------------------------------------------------- #
def _axis_weight(p_i: int, pos_list: List[int], tile: int, i: int,
                 n: int, feather: int = 0) -> np.ndarray:
    """Ramp inside each overlap. `feather` widens/shrinks the fade (0 = use the
    whole overlap). A wider fade hides exposure differences between tiles."""
    w = np.ones(int(tile), dtype=np.float32)
    if n <= 1:
        return w
    if i > 0:
        ov = min(int(tile), int(tile - (p_i - pos_list[i - 1])))
        if feather > 0:
            ov = min(ov, int(feather))
        if ov > 0:
            w[:ov] = np.minimum(w[:ov], np.linspace(0.0, 1.0, ov, dtype=np.float32))
    if i < n - 1:
        ov = min(int(tile), int(tile - (pos_list[i + 1] - p_i)))
        if feather > 0:
            ov = min(ov, int(feather))
        if ov > 0:
            w[-ov:] = np.minimum(w[-ov:], np.linspace(1.0, 0.0, ov, dtype=np.float32))
    return w


def blend(tiles: List[np.ndarray], source_w: int, source_h: int,
          tile_w: int, tile_h: int, rows: int, cols: int,
          feather: int = 0) -> np.ndarray:
    """Row-major tiles -> exact source_w x source_h, cross-faded."""
    source_w, source_h = max(1, int(source_w)), max(1, int(source_h))
    tile_w, tile_h = max(1, int(tile_w)), max(1, int(tile_h))
    rows, cols = max(1, int(rows)), max(1, int(cols))
    px = positions(source_w, tile_w, cols)
    py = positions(source_h, tile_h, rows)

    channels = int(tiles[0].shape[2]) if tiles[0].ndim == 3 else 3
    acc = np.zeros((source_h, source_w, channels), dtype=np.float32)
    wacc = np.zeros((source_h, source_w), dtype=np.float32)

    for idx in range(min(len(tiles), rows * cols)):
        r, c = divmod(idx, cols)
        y0, x0 = py[r], px[c]
        wy = _axis_weight(y0, py, tile_h, r, rows, feather)
        wx = _axis_weight(x0, px, tile_w, c, cols, feather)
        w2d = wy[:, None] * wx[None, :]

        y1, x1 = min(y0 + tile_h, source_h), min(x0 + tile_w, source_w)
        th, tw = y1 - y0, x1 - x0
        if th <= 0 or tw <= 0:
            continue
        tile = np.asarray(tiles[idx], dtype=np.float32)[:th, :tw, :]
        acc[y0:y1, x0:x1, :] += tile * w2d[:th, :tw, None]
        wacc[y0:y1, x0:x1] += w2d[:th, :tw]

    wacc = np.maximum(wacc, 1e-8)
    out = acc / wacc[:, :, None]
    empty = wacc <= 1e-7
    if empty.any():
        out[empty] = 0.0
    return np.clip(out[:source_h, :source_w, :], 0.0, 1.0)


def to_batch_tensor(items):
    """Stack 3-D crops into ONE [B,H,W,C] image batch (no extra leading dim)."""
    arr = np.stack([np.asarray(x, dtype=np.float32) for x in items], axis=0)
    try:
        import torch
        return torch.from_numpy(np.ascontiguousarray(arr))
    except Exception:
        return arr


def to_tensor(hwc: np.ndarray):
    """Single HWC image -> [1,H,W,C]."""
    try:
        import torch
        return torch.from_numpy(np.ascontiguousarray(np.asarray(hwc, dtype=np.float32)[None, ...]))
    except Exception:
        return np.asarray(hwc, dtype=np.float32)[None, ...]


# --------------------------------------------------------------------------- #
# colour match (Reinhard, LAB) - keeps every tile on the source's palette
# --------------------------------------------------------------------------- #
def _rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    def lin(c):
        return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    r, g, b = lin(r), lin(g), lin(b)
    x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375
    y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750
    z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041
    x, y, z = x / 0.95047, y / 1.00000, z / 1.08883
    def f(t):
        return np.where(t > 0.008856, np.cbrt(t), (7.787 * t) + 16.0 / 116.0)
    fx, fy, fz = f(x), f(y), f(z)
    return np.stack([116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)], axis=-1)


def _lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    L, a, bb = lab[..., 0], lab[..., 1], lab[..., 2]
    fy = (L + 16.0) / 116.0
    fx = fy + a / 500.0
    fz = fy - bb / 200.0
    def finv(t):
        return np.where(t ** 3 > 0.008856, t ** 3, (t - 16.0 / 116.0) / 7.787)
    x, y, z = finv(fx) * 0.95047, finv(fy) * 1.00000, finv(fz) * 1.08883
    r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314
    g = x * -0.9692660 + y * 1.8760108 + z * 0.0415560
    b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252
    def gam(c):
        return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0.0), 1 / 2.4) - 0.055)
    return np.clip(np.stack([gam(r), gam(g), gam(b)], axis=-1), 0.0, 1.0)


def color_match_lab(image: np.ndarray, reference: np.ndarray,
                    strength: float = 1.0) -> np.ndarray:
    """Pull `image` onto `reference`'s LAB mean/std (factor 1 = full match)."""
    a = _rgb_to_lab(np.asarray(image, dtype=np.float32)[..., :3])
    r = _rgb_to_lab(np.asarray(reference, dtype=np.float32)[..., :3])
    out = a.copy()
    for ch in range(3):
        am, asd = float(a[..., ch].mean()), float(a[..., ch].std() or 1e-5)
        rm, rsd = float(r[..., ch].mean()), float(r[..., ch].std() or 1e-5)
        # damp the contrast part: full std matching is what flattens or
        # oversaturates generative tiles, the mean is what reads as "colour"
        ratio = 1.0 + (rsd / max(asd, 1e-5) - 1.0) * float(max(0.0, min(1.0, strength)))
        out[..., ch] = (a[..., ch] - am) * ratio + rm
    mixed = a + (out - a) * float(max(0.0, min(1.0, strength)))
    return _lab_to_rgb(mixed)
