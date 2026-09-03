"""Flat Shade Eternal — make an input mesh shade FLAT (like Blender's shade_flat()).

WHY THIS NODE EXISTS (read before editing):
    glTF/GLB (the format ComfyUI saves and previews 3D with) has NO flat-shading
    state. Unlike Blender, where shade_flat() is render metadata stored in the
    .blend, a GLB only carries per-vertex NORMAL data — and a shared (indexed)
    vertex has exactly ONE normal slot, so it cannot hold the 3 different face
    normals flat shading needs. Blender itself converts shade-flat to split
    vertices when exporting GLB.

    Therefore there are exactly TWO ways to make a mesh display flat in glTF:
      1. SPLIT: de-index the mesh — every face gets its own 3 vertices and the
         face normal. True flat everywhere. Costs ~3x vertices (each shared
         vert duplicated per face) -> bigger GLB export.
      2. CREASE: split ONLY edges sharper than a dihedral-angle threshold.
         Smooth regions stay shared and smooth; hard edges stay visually flat.
         Much lighter on curved (3D-gen) meshes. crease_angle=0 degenerates to
         full SPLIT.

    There is no third option — no flag, no material key survives GLB export
    (verified: comfy-core nodes_save_3d.py forwards only base_color/metallic/
    roughness/double_sided/maps), and ComfyUI's own 3D viewer recomputes
    smooth normals on load (computeVertexNormals in the frontend loader),
    which on split geometry still yields flat per-face shading.

WHAT THIS NODE DOES:
    - Recomputes normals from face geometry (face normals on split verts).
      This also REPLACES any baked custom split normals — the equivalent of
      Blender's mesh.customdata_custom_splitnormals_clear(): inconsistent
      or flipped imported normals are overwritten by winding-derived ones.
    - Does NOT mark edges sharp and does NOT edit vertex positions: splitting
      duplicates verts (topology for shading only); positions are unchanged.
    - GPU torch throughout (Shiloach-Vishkin union-find for crease grouping).
      At 2-5M verts this is far faster than comfy-core's MeshSmoothNormals,
      which uses a CPU numpy union-find loop.

NOTE ON FILE SIZE: split mode multiplies vertex count by ~3 (and UVs/colors
with it). That is the price of flat shading in glTF — unavoidable. Use
crease mode with an angle suited to the mesh to keep exports light.
"""

import math

import torch

from comfy_api.latest import Types
import trimesh
from trimesh import Trimesh


MODES = ["split", "crease"]

MODE_TOOLTIP = (
    "split = every face gets its own 3 vertices + face normal: TRUE flat "
    "shading everywhere, ~3x vertices (bigger GLB). "
    "crease = only edges sharper than crease_angle are split: flat hard edges, "
    "smooth curved areas stay shared (much lighter file)."
)

CREASE_TOOLTIP = (
    "Dihedral angle threshold in degrees (crease mode only). Edges between "
    "faces with an angle above this are split and shaded flat; smoother edges "
    "stay smooth. 0 = same as split (fully flat). Typical hard-surface: 30-60."
)


def _face_normals(v: torch.Tensor, f: torch.Tensor) -> torch.Tensor:
    """Unit per-face normals from winding. (V,3) verts, (F,3) faces -> (F,3)."""
    fv = v[f]
    n = torch.linalg.cross(fv[:, 1] - fv[:, 0], fv[:, 2] - fv[:, 0], dim=1)
    return torch.nn.functional.normalize(n, dim=1, eps=1e-12)


def _split_all(v: torch.Tensor, f: torch.Tensor):
    """De-index: each face owns its 3 verts. Returns (verts, faces, normals, remap).

    remap indexes into the ORIGINAL per-vert attributes (uvs/colors/tangents).
    """
    n = _face_normals(v, f)                       # (F,3)
    new_v = v[f].reshape(-1, 3)                   # (F*3,3)
    new_n = n.repeat_interleave(3, dim=0)         # (F*3,3)
    new_f = torch.arange(new_v.shape[0], device=v.device, dtype=torch.long).reshape(-1, 3)
    remap = f.reshape(-1)                         # (F*3,)
    return new_v, new_f, new_n, remap


def _crease_split(v: torch.Tensor, f: torch.Tensor, crease_deg: float):
    """Split only edges whose dihedral angle exceeds crease_deg.

    Shiloach-Vishkin style GPU union-find groups faces connected by edges
    smoother than the threshold; one output vertex is emitted per
    (original vertex, smoothing group). Returns like _split_all.
    """
    V, F = v.shape[0], f.shape[0]
    dev = v.device
    fn = _face_normals(v, f)
    cos_thresh = math.cos(math.radians(crease_deg))

    # All edges (each of a face's 3 edges once): (F*3, 2) verts + face index.
    e = torch.stack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]], dim=1).reshape(-1, 2)
    face_of_edge = torch.arange(F, device=dev).repeat_interleave(3)
    e_lo, e_hi = e.min(dim=1).values.long(), e.max(dim=1).values.long()
    edge_key = e_lo * V + e_hi

    unique_keys, inverse = torch.unique(edge_key, return_inverse=True)
    E = unique_keys.shape[0]
    # For each unique edge, the min and max adjacent face index.
    big = torch.iinfo(torch.long).max
    f_min = torch.full((E,), big, device=dev, dtype=torch.long)
    f_max = torch.full((E,), -1, device=dev, dtype=torch.long)
    f_min.scatter_reduce_(0, inverse, face_of_edge, reduce="amin", include_self=True)
    f_max.scatter_reduce_(0, inverse, face_of_edge, reduce="amax", include_self=True)
    interior = f_max > f_min  # edges shared by exactly 2 faces

    dot = (fn[f_min.clamp(max=F - 1)] * fn[f_max.clamp(min=0)]).sum(-1)
    union_mask = interior & (dot >= cos_thresh)
    uf1, uf2 = f_min[union_mask], f_max[union_mask]

    # Shiloach-Vishkin: label[i] = current root of face i. Hook larger roots
    # onto smaller ones across union edges, then pointer-jump. O(log F) iters.
    label = torch.arange(F, device=dev, dtype=torch.long)
    for _ in range(64):
        r1, r2 = label[uf1], label[uf2]
        lo = torch.minimum(r1, r2)
        hi = torch.maximum(r1, r2)
        changed = hi != lo
        if not bool(changed.any()):
            break
        label.scatter_reduce_(0, hi[changed], lo[changed], reduce="amin", include_self=True)
        label = label[label]  # pointer jumping

    # One output vertex per (vertex, smoothing-group) pair.
    vert_key = f.reshape(-1).long() * F + label.repeat_interleave(3)
    unique_keys, inverse2 = torch.unique(vert_key, return_inverse=True)
    remap = (unique_keys // F).long()            # original vert per output vert
    new_v = v[remap]
    new_f = inverse2.reshape(-1, 3).long()

    # Per-output-vertex normal = area-weighted sum of its group's face normals.
    new_n = torch.zeros_like(new_v, dtype=torch.float64)
    contrib = fn.repeat_interleave(3, dim=0).double()  # (F*3,3) per face-corner
    new_n.scatter_add_(0, inverse2.unsqueeze(1).expand(-1, 3), contrib)
    new_n = torch.nn.functional.normalize(new_n, dim=1, eps=1e-12).to(v.dtype)

    return new_v, new_f, new_n, remap


class EternalFlatShade:
    """Flat Shade Eternal — shades a MESH flat WITHOUT editing positions.

    Two modes (see MODE_TOOLTIP):
        split  -> fully flat, every face own verts (heavier export)
        crease -> flat only on sharp edges above crease_angle (lighter)

    Replaces baked normals (custom split normals are cleared, like Blender's
    customdata_custom_splitnormals_clear) — geometry positions untouched.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": (MODES, {"tooltip": MODE_TOOLTIP}),
            },
            "optional": {
                "mesh": ("MESH",),
                "trimesh": ("TRIMESH",),
                "crease_angle": ("FLOAT", {
                    "default": 30.0, "min": 0.0, "max": 180.0, "step": 1.0,
                    "tooltip": CREASE_TOOLTIP,
                }),
            },
        }

    RETURN_TYPES = ("MESH", "TRIMESH")
    RETURN_NAMES = ("mesh", "trimesh")
    FUNCTION = "flat_shade"
    CATEGORY = "⚡ ETERNAL ● ↩ /🧊 3D"

    # ---- Types.MESH path: pure GPU torch --------------------------------
    @staticmethod
    def _flat_mesh_item(v, f, crease_deg, mode):
        """One batch item: (V,3)/(F,3) -> split verts/faces/normals + remap."""
        if v.shape[0] == 0 or f.shape[0] == 0:
            return v, f, torch.zeros_like(v), None
        if mode == "split" or crease_deg <= 0.0:
            return _split_all(v, f)
        return _crease_split(v, f, crease_deg)

    @classmethod
    def _flat_mesh(cls, mesh: Types.MESH, crease_deg: float, mode: str) -> Types.MESH:
        B = mesh.vertices.shape[0]
        v_list, f_list, n_list = [], [], []
        c_list = [] if mesh.vertex_colors is not None else None
        u_list = [] if mesh.uvs is not None else None
        t_list = [] if mesh.tangents is not None else None
        vc_list, fc_list = [], []

        for i in range(B):
            v = mesh.vertices[i]
            f = mesh.faces[i].long()
            v_i, f_i, n_i, remap = cls._flat_mesh_item(v, f, crease_deg, mode)
            v_list.append(v_i)
            f_list.append(f_i)
            n_list.append(n_i)
            vc_list.append(torch.tensor(v_i.shape[0], device=v.device))
            fc_list.append(torch.tensor(f_i.shape[0], device=v.device))
            if c_list is not None:
                c_i = mesh.vertex_colors[i]
                c_list.append(c_i[remap.to(c_i.device)] if remap is not None
                              else torch.zeros((0, c_i.shape[-1]), device=v.device))
            if u_list is not None:
                u_i = mesh.uvs[i]
                u_list.append(u_i[remap.to(u_i.device)] if remap is not None
                              else torch.zeros((0, 2), device=v.device))
            if t_list is not None:
                t_i = mesh.tangents[i, :v.shape[0]]
                t_list.append(t_i[remap.to(t_i.device)] if remap is not None
                              else torch.zeros((0, t_i.shape[-1]), device=v.device))

        max_v = max(int(x.shape[0]) for x in v_list)
        max_f = max(int(x.shape[0]) for x in f_list)
        dev = mesh.vertices.device
        pv = torch.zeros(B, max_v, 3, device=dev, dtype=mesh.vertices.dtype)
        pf = torch.zeros(B, max_f, 3, device=dev, dtype=torch.long)
        pn = torch.zeros(B, max_v, 3, device=dev, dtype=mesh.vertices.dtype)
        for i in range(B):
            pv[i, :v_list[i].shape[0]] = v_list[i]
            pf[i, :f_list[i].shape[0]] = f_list[i]
            pn[i, :n_list[i].shape[0]] = n_list[i]

        out = Types.MESH(
            vertices=pv,
            faces=pf,
            normals=pn,
            vertex_counts=torch.stack(vc_list).to(dev),
            face_counts=torch.stack(fc_list).to(dev),
            uvs=torch.stack(u_list) if u_list is not None else None,
            vertex_colors=torch.stack(c_list) if c_list is not None else None,
            metallic_roughness=mesh.metallic_roughness,
            texture=mesh.texture,
            unlit=mesh.unlit,
            material=mesh.material,   # flags are dropped by GLB export; harmless
            emissive=mesh.emissive,
            tangents=torch.stack(t_list) if t_list is not None else None,
            normal_map=mesh.normal_map,
            occlusion_in_mr=mesh.occlusion_in_mr,
        )
        return out

    # ---- trimesh path: same two modes, torch math, rebuilt process=False --
    @classmethod
    def _flat_trimesh(cls, tm, crease_deg: float, mode: str):
        items = tm if isinstance(tm, list) else [tm]
        out = []
        for t in items:
            v = torch.as_tensor(np_from(t.vertices), dtype=torch.float32)
            f = torch.as_tensor(np_from(t.faces), dtype=torch.long)
            v_i, f_i, n_i, remap = cls._flat_mesh_item(v, f, crease_deg, mode)
            kwargs = {"process": False}
            if t.visual is not None and hasattr(t.visual, "uv") and t.visual.uv is not None \
                    and remap is not None:
                uvs = np_from(t.visual.uv)[remap.cpu().numpy()]
                kwargs["visual"] = trimesh.visual.TextureVisuals(uv=uvs)
            new_t = Trimesh(
                vertices=v_i.cpu().numpy(),
                faces=f_i.cpu().numpy(),
                face_normals=n_i.cpu().numpy(),
                **kwargs,
            )
            out.append(new_t)
        return out if isinstance(tm, list) else out[0]

    def flat_shade(self, mode, mesh=None, trimesh=None, crease_angle=30.0):
        mesh_out = self._flat_mesh(mesh, crease_angle, mode) if mesh is not None else None
        trimesh_out = self._flat_trimesh(trimesh, crease_angle, mode) if trimesh is not None else None
        return (mesh_out, trimesh_out)


def np_from(t):
    import numpy as np
    return np.asarray(t)


NODE_CLASS_MAPPINGS = {"EternalFlatShade": EternalFlatShade}
NODE_DISPLAY_NAME_MAPPINGS = {"EternalFlatShade": "Flat Shade Eternal"}
