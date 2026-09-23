"""
PromptLineEternal — the IN-LOOP prompt picker.

Replaces BOTH "PER-TILE PROMPT (global + custom)" and
"VL PROMPTS -> PANEL (line N = tile N)".

It answers the only question the loop actually asks, once per tile:

    "give me the final prompt text for tile #N"

    index        <- loop index
    tile_prompts <- the text block from TILE PROMPT PANEL
    vl_prompt    <- OPTIONAL captioner output for THIS tile (in-loop VL)
    global_prompt<- your big "preserve / upscale" instruction

Result = global_prompt + the tile's own text, where the tile text is either
the manual panel line or the VL caption.

Because it lives inside the loop, a VL wired here only ever sees ONE tile at a
time - it does not have to caption all of them up front.

CATEGORY = "⚡ ETERNAL ● ↩ /🧩 Tiles"
"""

from __future__ import annotations


def _flatten(v):
    """Accept str, list, tuple, nested lists -> flat list of str."""
    out = []
    if v is None:
        return out
    if isinstance(v, (list, tuple)):
        for item in v:
            out.extend(_flatten(item))
    else:
        out.append(str(v))
    return out


def _scalar(v, default=None):
    """INPUT_IS_LIST hands every input over as a list - unwrap one level.

    Without this, `combine` would arrive as ["VL wins..."] and never match a
    string, and `use_global` would arrive as [False] which is TRUTHY.
    """
    while isinstance(v, (list, tuple)):
        if not v:
            return default
        v = v[0]
    return v


def _split_lines(text) -> list:
    """Newline separated lines; '#' lines are notes and are dropped."""
    lines = []
    for chunk in _flatten(text):
        for line in chunk.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
            lines.append(line)
    return lines


def _clean(text: str) -> str:
    """Collapse the comma noise that concatenation creates."""
    t = " ".join(str(text).split())
    while ",," in t:
        t = t.replace(",,", ",")
    return t.strip().strip(",").strip()


def _join_parts(parts) -> str:
    out = []
    for p in parts:
        p = _clean(p)
        if p:
            out.append(p)
    return _clean(", ".join(out))


class PromptLineEternal:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "index": ("INT", {"default": 0, "min": 0, "max": 100000,
                                  "tooltip": "Which tile this run is on. Wire it "
                                             "from the loop index; left as a widget "
                                             "it just picks that one line."}),
                "combine": (["Manual wins (VL is fallback)",
                             "VL wins (manual is fallback)",
                             "Merge both"], {"default": "Manual wins (VL is fallback)"}),
                "use_global": ("BOOLEAN", {"default": True,
                                           "tooltip": "Prefix your global prompt to the tile text."}),
            },
            "optional": {
                "tile_prompts": ("STRING", {
                    "forceInput": True,
                    "tooltip": "Text block from TILE PROMPT PANEL. Line N = tile N.",
                }),
                "vl_prompt": ("STRING", {
                    "forceInput": True,
                    "tooltip": "Captioner output for THIS tile (one tile per run).",
                }),
                "global_prompt": ("STRING", {
                    "forceInput": True,
                    "tooltip": "Your global preserve/upscale instruction.",
                }),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("prompt", "used")
    FUNCTION = "pick"
    CATEGORY = "⚡ ETERNAL ● ↩ /🧩 Tiles"
    # The captioner emits a LIST of strings (one per tile). Without this flag
    # ComfyUI would run THIS node once per list element and the loop would get
    # a different tile's prompt. We take the whole list and pick by index.
    INPUT_IS_LIST = True
    OUTPUT_TOOLTIPS = ("Final prompt text for this tile -> CLIPTextEncode.",
                       "Where the tile text came from: panel / vl / global / empty")

    def pick(self, index, combine, use_global,
             tile_prompts=None, vl_prompt=None, global_prompt=None):
        combine = _scalar(combine, "Manual wins (VL is fallback)")
        use_global = True if _scalar(use_global, True) is None else bool(
            _scalar(use_global, True))

        idx = _scalar(index, 0)
        try:
            idx = int(idx)
        except Exception:
            idx = 0
        idx = max(0, idx)

        # '# ' lines are notes about the block, not tile slots: drop them
        # BEFORE indexing so a header comment cannot shift tile 0.
        lines = [ln for ln in _split_lines(tile_prompts)
                 if not ln.lstrip().startswith("#")]
        manual = ""
        if 0 <= idx < len(lines):
            cand = lines[idx]
            # strictly positional: line N is tile N. A blank line means
            # "no manual prompt for this tile" -> fall back to the VL,
            # never borrow a neighbour's text.
            if cand.strip():
                manual = cand

        vl = ""
        vl_parts = [p for p in _flatten(vl_prompt) if p and p.strip()]
        if vl_parts:
            # one tile per run normally, but tolerate a whole list
            vl = vl_parts[idx] if idx < len(vl_parts) else vl_parts[-1]

        global_text = ""
        gp = [p for p in _flatten(global_prompt) if p and p.strip()]
        if gp:
            global_text = gp[0]

        manual, vl = _clean(manual), _clean(vl)
        if combine == "VL wins (manual is fallback)":
            body, used = (vl, "vl") if vl else (manual, "panel" if manual else "empty")
        elif combine == "Merge both":
            body = ", ".join([p for p in (manual, vl) if p])
            used = "panel+vl" if manual and vl else ("panel" if manual else ("vl" if vl else "empty"))
        else:
            body, used = (manual, "panel") if manual else (vl, "vl" if vl else "empty")

        final = _join_parts([global_text, body]) if use_global else _clean(body)
        if not final:
            final = _clean(global_text)
            used = "global" if final else "empty"
        return (final, used)


NODE_CLASS_MAPPINGS = {"PromptLineEternal": PromptLineEternal}
NODE_DISPLAY_NAME_MAPPINGS = {"PromptLineEternal": "PROMPT FOR TILE #N ETERNAL"}
