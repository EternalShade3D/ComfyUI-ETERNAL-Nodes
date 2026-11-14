# Aspect Ratio Size Picker

Pick a target canvas size for an **Empty Latent Image** node from three controls.

- **Aspect Ratio** (dropdown): `1:1 (Square)`, `4:3 (Standard)`, `3:2 (Classic 35mm Film)`, `5:4 (Large Format)`, `16:9 (Widescreen)`, `16:10 (Widescreen)`.
- **Long Edge** (INT slider, 64–8192, step 8) — always maps to the larger dimension.
- **Invert** (toggle) — swaps the ratio (`4:3` → `3:4`, `16:9` → `9:16`).

Outputs `width` and `height` (INT), both snapped to a multiple of 8 for latent alignment. Wire into an **Empty Latent Image** node's `width`/`height`.
