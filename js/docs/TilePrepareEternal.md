# TILE PREPARE ETERNAL

The modern entry point for tile work: plans the grid and emits the whole crop as one image for the sampler plus a list of individual tiles. Replaces the old GRID + SPLIT + TILES chain.

- In: `IMAGE`.
- Out: `IMAGE` (whole crop) + per-tile `IMAGE`s, `MASK`s, `INT` count, `tile` output.
- `mode`: Auto (squarest) / Total tiles / Manual rows×cols. `target_tile` 1024, `overlap` 128.
