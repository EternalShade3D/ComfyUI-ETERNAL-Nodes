"""
PromptListJoinEternal — collect a LIST of per-tile prompts into one string.

A VL / LLM node fed by TileUnbatchEternal produces one prompt per tile as a
list. This node joins them in tile order into a newline string, which is the
exact format TilePromptPanelEternal's `auto_prompts` socket and
PromptByIndexEternal's `custom_prompts` expect.

Also returns how many prompts it saw, so you can assert it matches the tile
count before burning a render.

CATEGORY = "⚡ ETERNAL ● ↩ /🗄 _archive"
"""

from __future__ import annotations

from typing import Any, List

# ComfyUI hands us the WHOLE list instead of running once per element.
INPUT_IS_LIST = True


def _flatten(value: Any) -> List[str]:
    """Accept str / list / nested list / None and return flat non-empty strings."""
    out: List[str] = []
    if value is None:
        return out
    if isinstance(value, (list, tuple)):
        for v in value:
            out.extend(_flatten(v))
        return out
    text = str(value)
    for line in text.split("\n"):
        line = line.strip()
        if line:
            out.append(line)
    return out


class PromptListJoinEternal:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompts": ("STRING", {
                    "forceInput": True,
                    "tooltip": (
                        "Per-tile prompts from a VL / LLM node. A list is "
                        "joined in tile order."
                    ),
                }),
            },
            "optional": {
                "global_prompt": ("STRING", {
                    "forceInput": True,
                    "default": "",
                    "tooltip": (
                        "Optional prefix (e.g. the quality prompt) prepended to "
                        "EVERY tile prompt."
                    ),
                }),
                "keep_blanks": ("BOOLEAN", {
                    "default": False,
                    "tooltip": (
                        "Off: drop empty entries (they would shift the tile "
                        "index). On: keep them as blank lines so tile N stays "
                        "line N."
                    ),
                }),
            },
        }

    RETURN_TYPES = ("STRING", "INT")
    RETURN_NAMES = ("prompts_text", "count")
    FUNCTION = "join"
    CATEGORY = "⚡ ETERNAL ● ↩ /🗄 _archive"
    OUTPUT_TOOLTIPS = (
        "Newline-joined prompts, one line per tile.",
        "Number of prompts collected.",
    )

    def join(self, prompts, global_prompt=None, keep_blanks=False):
        # INPUT_IS_LIST = True -> these arrive as lists
        keep = bool(keep_blanks[0] if isinstance(keep_blanks, list) else keep_blanks)

        gp = ""
        if isinstance(global_prompt, (list, tuple)):
            gp = " ".join(str(g) for g in global_prompt if g)
        elif global_prompt:
            gp = str(global_prompt)
        gp = gp.strip().rstrip(",").strip()

        flat = _flatten(prompts)

        if keep:
            # preserve position: re-expand list entries line by line, blanks kept
            items: List[str] = []
            src = prompts if isinstance(prompts, (list, tuple)) else [prompts]
            for v in src:
                if v is None:
                    items.append("")
                elif isinstance(v, str):
                    items.extend(v.split("\n"))
                else:
                    items.append(str(v))
            items = [s.strip() for s in items]
        else:
            items = flat

        if gp:
            items = [f"{gp}, {s}".strip(", ") if s else gp for s in items]

        return ("\n".join(items), len(items))


NODE_CLASS_MAPPINGS = {"PromptListJoinEternal": PromptListJoinEternal}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptListJoinEternal": "Prompt List -> Text ETERNAL"
}
