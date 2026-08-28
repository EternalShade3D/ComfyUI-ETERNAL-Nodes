# ComfyUI-ETERNAL-Nodes

Custom ComfyUI nodes by **EternalShade3D** — a single library pack for 3D mesh
repair/bridging, flat-shade control, and image-size picking.

Category prefix on canvas: `👑 ETERNAL / ...`

## Nodes

| Node | Category | In → Out | Purpose |
|------|----------|----------|---------|
| **Mesh to Trimesh Eternal** | `3d/mesh` | `MESH` → `TRIMESH` | Bridge TRELLIS.2 core `Types.MESH` into GeomPack (which needs `trimesh` objects). |
| **Trimesh to Mesh Eternal** | `3d/mesh` | `TRIMESH` → `MESH` | Bridge a GeomPack-repaired mesh back to core `Types.MESH` (SaveGLB / preview). |
| **Flat Shade Eternal** | `3d/mesh` | in: `mesh` (MESH) + `trimesh` (TRIMESH) [optional] / out: `mesh` (MESH) + `trimesh` (TRIMESH) | ONE node for both. Force true flat (faceted) shading on whichever input you supply; de-indexed, baked per-vertex normals. Merged from the old `Flat Shade Mesh Eternal` + `Flat Shade (Trimesh) Eternal`. |
| **Trimesh to Model3D Eternal** | `3d/mesh` | `TRIMESH` → `FILE_3D_GLB` | One-node equivalent of `Trimesh to Mesh Eternal` + `Create 3D File (from Mesh)`. Wires straight into `Preview 3D (Advanced)` `model_3d`. |
| **Video Sizes ETERNAL** | `2d/size` | (state) → sizes | Aspect-ratio + long-edge picker for text-to-image / video latent sizing. |
| **Aspect Ratio Size Picker** | `2d/size` | → `width`, `height` (INT) | Aspect-ratio dropdown + long-edge slider (64–8192, step 8) + invert toggle. Snaps to multiple of 8. |

## Aspect Ratio Size Picker

Pick a target canvas size for an **Empty Latent Image** node from three controls.

### Controls
| Control | Type | Notes |
| --- | --- | --- |
| **Aspect Ratio** | Dropdown | `1:1 (Square)`, `4:3 (Standard)`, `3:2 (Classic 35mm Film)`, `5:4 (Large Format)`, `16:9 (Widescreen)`, `16:10 (Widescreen)` |
| **Long Edge** | Slider (INT) | 64–8192, step 8. Always maps to the larger dimension. |
| **Invert** | Toggle | Swaps the ratio (e.g. `4:3` → `3:4`, `16:9` → `9:16`). |

### Outputs
- `width` (INT)
- `height` (INT)

Both snapped to a multiple of 8 for ComfyUI latent alignment. Wire into an
**Empty Latent Image** node's `width`/`height`.

### Example
```
Aspect Ratio Size Picker ──width──▶ Empty Latent Image
                       └─height─┘
```

## Install

### Manual
```
cd ComfyUI/custom_nodes
git clone https://github.com/EternalShade3D/ComfyUI-ETERNAL-Nodes.git
# restart ComfyUI
```

## License
MIT © EternalShade3D
