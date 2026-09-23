"""
TileUnbatchEternal — split a tile BATCH into individual per-tile images.

Feeds a VL / LLM captioner: ComfyUI re-runs every downstream node ONCE PER LIST
ELEMENT, so a VL node wired to `IMAGE` here sees ONE tile at a time and can
write a prompt for that specific tile. `index` travels alongside so the prompt
can be matched back to the right tile.

Pairs with PromptListJoinEternal (list of prompts -> one newline string) which
lands back on the Tile Prompt Panel's `auto_prompts` socket.

CATEGORY = "⚡ ETERNAL ● ↩ /🗄 _archive"
"""

from __future__ import annotations


class TileUnbatchEternal:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "IMAGE": ("IMAGE",),   # tile batch from TileSplitEternal
            }
        }

    RETURN_TYPES = ("IMAGE", "INT")
    RETURN_NAMES = ("tile", "index")
    FUNCTION = "unbatch"
    CATEGORY = "⚡ ETERNAL ● ↩ /🗄 _archive"
    OUTPUT_TOOLTIPS = (
        "One tile per execution — wire to a VL / captioner.",
        "Row-major tile index of this tile.",
    )
    OUTPUT_IS_LIST = (True, True)

    def unbatch(self, IMAGE):
        images = []
        n = 0
        try:
            import torch
            if torch.is_tensor(IMAGE):
                n = int(IMAGE.shape[0])
                for i in range(n):
                    images.append(IMAGE[i:i + 1])
                return (images, list(range(n)))
        except Exception:
            pass

        # numpy fallback
        import numpy as np
        arr = np.asarray(IMAGE, dtype=np.float32)
        if arr.ndim == 3:
            arr = arr[np.newaxis, ...]
        n = int(arr.shape[0])
        for i in range(n):
            images.append(arr[i:i + 1])
        return (images, list(range(n)))


NODE_CLASS_MAPPINGS = {"TileUnbatchEternal": TileUnbatchEternal}
NODE_DISPLAY_NAME_MAPPINGS = {"TileUnbatchEternal": "Tile Unbatch ETERNAL"}
