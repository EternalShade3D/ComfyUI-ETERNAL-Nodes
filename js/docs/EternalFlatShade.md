# Flat Shade Eternal

Shades the mesh FLAT (like Blender `shade_flat()`, with custom split normals cleared). glTF has no flat-shading state, so splitting is the only way a GLB displays flat.

## Modes
- `split` — every face gets its own vertices: true flat everywhere, ~3x verts.
- `crease` — only edges sharper than `crease_angle` are split: flat hard edges, lighter file. `0°` = `split`.

## In / Out
- In: `mesh` (MESH) + `trimesh` (TRIMESH, optional).
- Out: `mesh` (MESH) + `trimesh` (TRIMESH).

Same mesh, same workflow — `split` bakes per-face geometry, `crease` only splits above the angle threshold.
