# ComfyUI-AspectRatioSizePicker
# Single-node aspect-ratio + long-edge + invert size picker for text-to-image.
# Outputs width / height (INT) to feed an Empty Latent Image node.
#
# The dropdown offers BOTH orientations (e.g. "4:3 (Standard)" and
# "3:4 (Standard)") so the frontend can flip the visible label when invert is
# toggled, while the backend always resolves the correct dimensions.

# Each entry: display label -> (w, h) canonical ratio.
RATIOS = {
    "1:1 (Square)": (1, 1),
    # 4:3 family
    "4:3 (Standard)": (4, 3),
    "3:4 (Standard)": (3, 4),
    # 3:2 family
    "3:2 (Classic 35mm Film)": (3, 2),
    "2:3 (Classic 35mm Film)": (2, 3),
    # 5:4 family
    "5:4 (Large Format)": (5, 4),
    "4:5 (Large Format)": (4, 5),
    # 16:9 family
    "16:9 (Widescreen)": (16, 9),
    "9:16 (Widescreen)": (9, 16),
    # 16:10 family
    "16:10 (Widescreen)": (16, 10),
    "10:16 (Widescreen)": (10, 16),
}

# The 6 "base" orientations shown in the dropdown when invert is OFF.
ASPECT_OPTIONS = [
    "1:1 (Square)",
    "4:3 (Standard)",
    "3:2 (Classic 35mm Film)",
    "5:4 (Large Format)",
    "16:9 (Widescreen)",
    "16:10 (Widescreen)",
]


class EternalAspectRatioSizePicker:
    """
    Pick a target size from an aspect-ratio dropdown, a long-edge slider,
    and an invert toggle. Long edge always maps to the larger dimension.
    Outputs width and height (INT) for an Empty Latent Image node.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "aspect_ratio": (
                    ASPECT_OPTIONS,
                    {"default": "1:1 (Square)"},
                ),
                "long_edge": (
                    "INT",
                    {"default": 1024, "min": 64, "max": 8192, "step": 8},
                ),
                "invert": (
                    "BOOLEAN",
                    {"default": False},
                ),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "pick"
    CATEGORY = "👑 ETERNAL/2d/size"

    def pick(self, aspect_ratio, long_edge, invert):
        a, b = RATIOS[aspect_ratio]  # canonical (w, h) from the label
        if invert:
            a, b = b, a  # swap -> portrait/landscape flip

        if a >= b:
            width = long_edge
            height = round(long_edge * b / a)
        else:
            height = long_edge
            width = round(long_edge * a / b)

        # snap to multiple of 8 (ComfyUI latent alignment)
        width = max(8, (width // 8) * 8)
        height = max(8, (height // 8) * 8)

        return (width, height)


NODE_CLASS_MAPPINGS = {
    "EternalAspectRatioSizePicker": EternalAspectRatioSizePicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "EternalAspectRatioSizePicker": "Aspect Ratio Size Picker",
}
