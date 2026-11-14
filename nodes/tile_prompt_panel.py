"""
TilePromptPanelETERNAL — the ONE prompt node.

Absorbs the two nodes that used to sit next to it:
  * "PER-TILE PROMPT (global + custom)"  -> its global/merge duty moved to
    PROMPT FOR TILE #N (in-loop), so it is not needed here.
  * "VL PROMPTS -> PANEL"                -> auto_prompts now accepts the
    captioner text directly (plain text, no separate list-join node).

What it does:
  1. shows you every tile as a thumbnail, in the same order the loop walks them
  2. you type a prompt under any tile you care about
  3. auto_prompts (optional) fills the tiles you left blank
  4. outputs one text block: LINE N = TILE N

Manual text always beats auto text, per tile.

CATEGORY = "⚡ ETERNAL ● ↩ /🧩 Tiles"
"""

from __future__ import annotations

import json

try:
    from ._tile_common import positions, effective_overlap
except ImportError:  # standalone import (tests)
    from _tile_common import positions, effective_overlap


def _to_batch(image):
    """Normalise ANY tile input into a (B, H, W, C) tensor.

    Accepts the IMAGE batch, one HWC tensor/array, or the LIST output of TILE
    PREPARE ETERNAL (list of (1,H,W,C) or (H,W,C)).

    The list form is why the panel showed empty boxes when it was wired to the
    "tile" output instead of the IMAGE output: each element arrived 4-D, PIL
    rejected it, every thumbnail came back None.
    """
    try:
        import numpy as np
        import torch
    except Exception:
        return image
    try:
        if isinstance(image, (list, tuple)):
            rows = []
            for item in image:
                t = item if torch.is_tensor(item) else torch.from_numpy(
                    np.ascontiguousarray(item))
                while t.dim() > 3:
                    t = t[0]
                if t.dim() == 3:
                    rows.append(t)
            if not rows:
                return image
            return torch.stack(rows, dim=0)
        t = image if torch.is_tensor(image) else torch.from_numpy(
            np.ascontiguousarray(image))
        if t.dim() == 2:
            t = t.unsqueeze(-1)
        return t
    except Exception:
        return image


def _batch_len(image) -> int:
    try:
        return int(image.shape[0])
    except Exception:
        try:
            return len(image)
        except Exception:
            return 0


def _thumb(image, index: int, side: int):
    """Return a base64 PNG data URL for the UI, or None.

    Data URL instead of a raw tensor keeps the JS side free of tensor->canvas
    plumbing, which is where the old panel produced duplicated tiles.
    """
    try:
        import io
        import base64
        import numpy as np
        from PIL import Image

        try:
            import torch
            t = _to_batch(image)
            if not torch.is_tensor(t):
                raise TypeError("not a tensor")
            arr = t[index].detach().cpu().numpy()
        except Exception:
            arr = np.asarray(image)[index]

        # A 4-D slice (1,H,W,C) or a stray batch dim makes PIL raise, which is
        # how every thumbnail silently became None and the panel drew a box.
        while arr.ndim > 3:
            arr = arr[0]
        if (arr.ndim == 3 and arr.shape[0] in (1, 3, 4)
                and arr.shape[-1] not in (1, 3, 4)):
            arr = np.transpose(arr, (1, 2, 0))          # CHW -> HWC
        if arr.ndim == 2:
            arr = np.repeat(arr[:, :, None], 3, axis=2)

        arr = np.clip(arr, 0.0, 1.0)
        pil = Image.fromarray((arr * 255).astype(np.uint8))
        side = max(32, int(side))
        pil.thumbnail((side, side), Image.BILINEAR)
        buf = io.BytesIO()
        pil.save(buf, format="PNG", optimize=True)
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except Exception:
        return None


def _parse_json(raw, fallback_n):
    if raw is None:
        return [""] * fallback_n
    data = raw
    if isinstance(data, str):
        text = data.strip()
        if not text:
            return [""] * fallback_n
        try:
            data = json.loads(text)
        except Exception:
            data = [ln for ln in text.replace("\r\n", "\n").split("\n")]
    if isinstance(data, dict):  # {"0": "text"} is also accepted
        out = [""] * fallback_n
        for k, v in data.items():
            try:
                i = int(k)
            except Exception:
                continue
            if 0 <= i < fallback_n:
                out[i] = str(v or "")
        return out
    if not isinstance(data, (list, tuple)):
        data = [data]
    out = [str(x or "") for x in data]
    if len(out) < fallback_n:
        out += [""] * (fallback_n - len(out))
    return out[:fallback_n]


def _parse_auto(text, fallback_n):
    if text is None:
        return [""] * fallback_n
    chunks = []
    if isinstance(text, (list, tuple)):
        for item in text:
            chunks.extend(_parse_auto(item, 1))
        out = chunks
    else:
        out = str(text).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = [("" if ln is None else str(ln).strip()) for ln in out]
    # '#' lines are notes, not tile slots -> dropped before position mapping
    out = [ln for ln in out if not ln.startswith("#")]
    if len(out) < fallback_n:
        out += [""] * (fallback_n - len(out))
    return out[:fallback_n]


class TilePromptPanelEternal:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "IMAGE": ("IMAGE", {
                    "tooltip": "Tile batch from TILE PREPARE ETERNAL "
                               "(use the IMAGE output, NOT the tile list).",
                }),
                "rows": ("INT", {"default": 1, "min": 1, "max": 256,
                                 "forceInput": True}),
                "cols": ("INT", {"default": 1, "min": 1, "max": 256,
                                 "forceInput": True}),
            },
            # ORDER MATTERS. ComfyUI appends optionals after requireds, and the
            # frontend always writes sockets BEFORE widgets when it saves. Keep
            # every socket ahead of every widget here, or "Reload Node" rebuilds
            # the input array differently and your wires jump sockets.
            "optional": {
                "auto_prompts": ("STRING", {
                    "forceInput": True,
                    "tooltip": "What the VL wrote, one line per tile. Fills the "
                               "tiles you left blank. Your own text always wins.",
                }),
                "global_prompt": ("STRING", {
                    "forceInput": True,
                    "tooltip": "The shared quality instruction. Shown at the top "
                               "of the panel; PROMPT FOR TILE #N adds it to "
                               "every tile.",
                }),
                "prompts_json": ("STRING", {"default": "[]", "multiline": False}),
                "thumb_side": ("INT", {"default": 160, "min": 48, "max": 384,
                                       "step": 8,
                                       "tooltip": "Thumbnail size in the panel."}),
                # forceInput + NO default -> a plain SOCKET with its label,
                # never a text box. As a widget that ALSO had a link, the UI
                # drew a dead text box you could type into that nothing read.
                "whole_image_prompt": ("STRING", {
                    "forceInput": True,
                    "tooltip": "WHOLE IMAGE PROMPT. Wire a STRING here: what "
                               "the whole picture is, said once. It travels to "
                               "the VL as TEXT so every tile knows the scene it "
                               "belongs to. Nothing is pasted onto the tile.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "INT", "STRING")
    RETURN_NAMES = ("prompts", "tile_count", "whole_image_prompt")
    FUNCTION = "build_prompts"
    CATEGORY = "⚡ ETERNAL ● ↩ /🧩 Tiles"
    OUTPUT_NODE = True
    OUTPUT_TOOLTIPS = (
        "Text block, LINE N = TILE N -> PROMPT FOR TILE #N.",
        "How many tiles the panel is showing.",
        "Your whole-image description, as text -> the VL prompt formula.",
    )

    def build_prompts(self, IMAGE, rows, cols, auto_prompts=None,
                      global_prompt=None, prompts_json="[]", thumb_side=160,
                      whole_image_prompt=""):
        image = _to_batch(IMAGE)
        n = _batch_len(image)
        expected = max(1, int(rows) * int(cols))
        if n == 0:
            n = expected

        manual = _parse_json(prompts_json, n)
        auto = _parse_auto(auto_prompts, n)

        gp = global_prompt
        if isinstance(gp, (list, tuple)):
            gp = " ".join(str(x) for x in gp if x)
        gp = " ".join(str(gp).split()) if gp else ""

        final, tiles = [], []
        for i in range(n):
            man, aut = (manual[i] if i < len(manual) else ""), (auto[i] if i < len(auto) else "")
            text = man.strip() or aut.strip()
            final.append(" ".join(text.split()))
            r, c = divmod(i, max(1, int(cols)))
            entry = {"i": i, "r": r, "c": c, "label": f"T{i}  r{r}c{c}",
                     "manual": man, "auto": aut, "final": final[-1]}
            thumb = _thumb(image, i, thumb_side)
            if thumb is not None:
                entry["thumb"] = thumb
            tiles.append(entry)

        # ComfyUI flattens ui values across executions
        # (execution.py: ui = {k: [y for x in uis for y in x[k]] ...}), so
        # EVERY value must be a list - a bare int raises
        # "'int' object is not iterable" and kills the node.
        scene = str(whole_image_prompt or "").strip()
        return {
            "ui": {
                "tiles": tiles,
                "prompts": list(final),
                "global": [gp],
                "scene": [scene],
                "count": [n],
                "expected": [expected],
                "mismatch": [bool(n != expected)],
                "text": ["\n".join(final)],
            },
            "result": ("\n".join(final), n, scene),
        }


NODE_CLASS_MAPPINGS = {"TilePromptPanelEternal": TilePromptPanelEternal}
NODE_DISPLAY_NAME_MAPPINGS = {
    "TilePromptPanelEternal": "TILE PROMPT PANEL ETERNAL"
}
