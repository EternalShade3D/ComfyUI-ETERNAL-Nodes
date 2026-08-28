"""Video Sizes ETERNAL - a labelled list of video resolutions (360p / 480p /
540p / 576p / 720p / 768p / 1080p) that outputs width + height ints chosen via
the JS UI. Behind the curtain each label maps to a 16:9 size snapped to a
multiple of 32 (VAE-friendly for MiniMax H3), so the node shows the name people
expect while sending the real pixel dimensions.

This is a fork of Pixaroma's Sizes node, trimmed to a fixed video preset list
and given p-name labels. Original Pixaroma node is untouched.

All UI lives on the JS side; the only Python input is a hidden serialized state
string injected at execution time via app.graphToPrompt (same pattern as
Resolution / Sizes Pixaroma). JS already computes the final oriented + snapped
width and height and stores them as state.w / state.h, so Python just reads
them back.
"""

import json

# p-label -> [width, height] at 16:9, native (pre-snap) values.
# The snap step (default 32) rounds each to the nearest multiple at send time.
VIDEO_PRESETS = [
    ["360p",  608, 352],
    ["480p",  864, 480],
    ["540p",  960, 544],
    ["576p", 1056, 608],
    ["720p", 1280, 736],
    ["768p", 1344, 768],   # H3 native canvas (official 768p)
    ["1080p", 1920, 1088],
]

DEFAULT_STATE = {
    "version": 1,
    "selected": 4,            # default 720p
    "orientation": "landscape",  # "portrait" | "landscape"
    "snap": 32,               # 0 = off; else 8 / 16 / 32 / 64
    "accent": None,
    "w": 1280,
    "h": 736,
}


def _clamp(n: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, n))


def _orient(pair, orientation):
    a, b = int(pair[0]), int(pair[1])
    lo, hi = min(a, b), max(a, b)
    return (hi, lo) if orientation == "landscape" else (lo, hi)


def _snap(n: int, step: int) -> int:
    if not step:
        return n
    return round(n / step) * step


class ETERNALVideoSizes:
    DESCRIPTION = (
        "Video Sizes ETERNAL - pick a video resolution by its familiar name "
        "(360p, 480p, 540p, 576p, 720p, 768p, 1080p) and it outputs the matching "
        "16:9 width and height as INTs, snapped to a multiple of 32 so they stay "
        "VAE-friendly for MiniMax H3.\\n\\n"
        "The Portrait / Landscape buttons flip the chosen size. The Snap setting "
        "(gear) rounds every size to a multiple of 8, 16, 32 or 64. The node face "
        "shows the p-name, not the raw pixels. State saves and restores with the "
        "workflow.\\n\\n"
        "Outputs width and height - wire them straight into a MiniMax H3 node's "
        "width / height inputs."
    )

    @classmethod
    def INPUT_TYPES(cls):
        # VideoSizesState is `hidden` (no widget, no input dot). The JS frontend
        # stores state in node.properties.videoSizesState and injects it into the
        # API prompt at execution time via app.graphToPrompt.
        return {
            "required": {},
            "hidden": {
                "VideoSizesState": (
                    "STRING",
                    {"default": json.dumps(DEFAULT_STATE)},
                ),
            },
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    OUTPUT_TOOLTIPS = ("The chosen width in pixels.", "The chosen height in pixels.")
    FUNCTION = "get_size"
    CATEGORY = "👑 ETERNAL/🔢 Values"

    def get_size(self, VideoSizesState: str):
        try:
            state = json.loads(VideoSizesState)
            # Recompute authoritatively from the selection (do NOT trust injected
            # w/h — a saved/hand-edited state may carry a stale pair). Mirrors the
            # Sizes node: JS orients + snaps; Python re-derives the same result so
            # the output is correct even if the serialized w/h is absent or wrong.
            idx = int(state.get("selected", 0))
            if idx < 0 or idx >= len(VIDEO_PRESETS):
                idx = 0
            w, h = _orient([VIDEO_PRESETS[idx][1], VIDEO_PRESETS[idx][2]],
                           state.get("orientation", "landscape"))
            step = int(state.get("snap", 32) or 0)
            w, h = _snap(w, step), _snap(h, step)
        except Exception:
            print("[ETERNALVideoSizes] Malformed state, falling back to 1280x736")
            w, h = 1280, 736
        w = _clamp(int(w), 64, 16384)
        h = _clamp(int(h), 64, 16384)
        return (w, h)


NODE_CLASS_MAPPINGS = {"ETERNALVideoSizes": ETERNALVideoSizes}
NODE_DISPLAY_NAME_MAPPINGS = {"ETERNALVideoSizes": "Video Sizes ETERNAL"}
