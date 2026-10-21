# TILE PROMPT PANEL ETERNAL

One panel to hold a per-tile prompt list, so the tile nodes can drive a sampler per tile.

- In: `IMAGE`, `rows`, `cols`.
- Out: `STRING` tile text, `IMAGE` overlay, `STRING` JSON.
- Wire `auto_prompts` (VL-written lines) or `whole_image_prompt` (what the whole picture is).
