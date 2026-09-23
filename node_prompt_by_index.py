"""
PromptByIndexEternal — 1 global prompt + optional per-tile custom prompt.

The multiline STRING widget holds one OPTIONAL custom prompt per line.
Line N (0-based) = tile N in row-major order.  Blank lines are LEGAL and do
NOT shift the index of later lines.

Output (STRING):
  - if line[index] is non-blank  -> global + ", " + custom
  - if line[index] is blank/missing -> global (clamped; if global empty, "")
Also outputs total_lines = count of NON-BLANK lines.

CATEGORY = "⚡ ETERNAL ● ↩ /🗄 _archive"
"""

from __future__ import annotations

from typing import Any, Dict, List


class PromptByIndexEternal:
    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {
                "index": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 65536,
                    "step": 1,
                    "tooltip": "Tile index (row-major). 0 = first tile.",
                }),
                "custom_prompts": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "tooltip": (
                        "One OPTIONAL custom prompt per line.  Line N = tile N "
                        "(row-major).  Blank lines do NOT shift indexing — "
                        "line 2 is always tile 2 even if line 1 is blank."
                    ),
                }),
            },
            "optional": {
                "global_prompt": ("STRING", {
                    "default": "",
                    "tooltip": "Single prompt applied to EVERY tile.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("prompt", "total_lines")
    FUNCTION = "build"
    CATEGORY = "⚡ ETERNAL ● ↩ /🗄 _archive"

    def build(self, index: int, global_prompt: str = "",
              custom_prompts: str = "") -> tuple:
        # Split into lines, PRESERVING blank lines (they occupy an index slot).
        lines: List[str] = custom_prompts.split("\n") if custom_prompts else []
        total_lines = sum(1 for ln in lines if ln.strip())

        # Clamp index; if index >= len(lines) it's "missing" → global only.
        if lines and int(index) < len(lines):
            line = lines[int(index)]
        else:
            line = ""

        custom = line.strip()
        gp = global_prompt.strip()

        if custom:
            # Non-blank custom line -> global + custom  (global first).
            if gp:
                prompt = f"{gp}, {custom}"
            else:
                prompt = custom
        else:
            # Blank or missing -> global only (clamped).
            prompt = gp

        return (prompt, total_lines)


NODE_CLASS_MAPPINGS = {"PromptByIndexEternal": PromptByIndexEternal}
NODE_DISPLAY_NAME_MAPPINGS = {"PromptByIndexEternal": "Prompt By Index Eternal"}
