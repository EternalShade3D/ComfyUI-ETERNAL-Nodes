# Panorama 360 Viewer Eternal

Shows an **equirectangular (2:1) 360 image as a WebGL sphere inside the node** — drag to look around, scroll to zoom, optional auto-rotation. Use it to inspect seams, poles and distortion of a panorama without leaving the workflow.

## Inputs
- `image` (IMAGE) — equirectangular 2:1 panorama.
- `frame_index` (INT) — which image of a batch to view (0 = first).
- `fov` (INT, 30–140, default 100) — the zoom it opens at; bigger = wider = further away. The wheel changes it live and **writes the value back**, so the view you framed is the view the workflow saves.
- `auto_rotate` (FLOAT, 0–60) — degrees per second; pauses while you drag.
- `background` (COMBO) — `dark` / `black` / `grey` / `light`.
- `exposure` (FLOAT, 0.2–3.0) — viewer brightness only; never touches the image on the wire.
- `start_yaw` (FLOAT, 0–360, default 180), `start_pitch` (FLOAT, −90–90, default 0), `z_offset` (FLOAT, −99–99) — camera start pose (`z_offset` is a translation, not a tilt).

## Output
- `image` (IMAGE) — the image passes through, so the viewer can sit mid-graph.

## Settings panel (gear)
Start yaw/pitch, camera height, exposure, zoom range, wheel/drag speed, horizon guide, background, reset.

## Notes
- Needs internet once to fetch three.js (~600 KB), browser-cached after.
