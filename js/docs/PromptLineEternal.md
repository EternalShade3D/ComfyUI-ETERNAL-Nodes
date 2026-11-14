# PROMPT FOR TILE #N ETERNAL

The in-loop prompt picker. Answers the question the loop asks once per tile: "give me the final prompt text for tile #N".

- In: `index` (INT), `combine`, `use_global`, `tile_prompts`, `vl_prompt`, `global_prompt`.
- Out: `STRING` ×2. `combine` decides whether your manual text or the VL caption wins.
- Replaces the old PER-TILE PROMPT node.
