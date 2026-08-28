import numpy as np
import torch
import torch.nn.functional as F
from comfy_api.latest import Types
import trimesh
from trimesh import Trimesh
from trimesh.visual import TextureVisuals


class EternalFlatShade:
    """Force true flat (faceted) shading on a mesh, regardless of input type.

    Two OPTIONAL inputs:
      - `mesh`    : ComfyUI core Types.MESH (e.g. from TRELLIS.2 save / Mesh bridges)
      - `trimesh` : trimesh.Trimesh (e.g. from GeomPack Fill Holes / Compute Normals)

    Two outputs (one per input you supplied):
      - `mesh`    : flat-shaded Types.MESH
      - `trimesh` : flat-shaded trimesh.Trimesh (de-indexed, baked per-vertex normals)

    Each supplied input is de-indexed so every triangle owns its 3 vertices and
    carries the face normal -> genuine faceted shading that survives GLB export.
    Unsupplied inputs yield None on their output.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "mesh": ("MESH",),
                "trimesh": ("TRIMESH",),
            }
        }

    RETURN_TYPES = ("MESH", "TRIMESH")
    RETURN_NAMES = ("mesh", "trimesh")
    FUNCTION = "flat_shade"
    CATEGORY = "👑 ETERNAL/3d/mesh"

    # ---- core Types.MESH path (GPU torch) ----------------------------------
    @staticmethod
    def _flat_mesh(mesh: Types.MESH) -> Types.MESH:
        B = mesh.vertices.shape[0]
        v_list, f_list, n_list = [], [], []
        c_list = [] if mesh.vertex_colors is not None else None
        uv_list = [] if mesh.uvs is not None else None
        vc_list, fc_list = [], []

        for i in range(B):
            v = mesh.vertices[i]
            f = mesh.faces[i].long()
            if v.shape[0] == 0 or f.shape[0] == 0:
                v_list.append(v)
                f_list.append(f)
                n_list.append(torch.zeros_like(v))
                vc_list.append(torch.tensor(0))
                fc_list.append(torch.tensor(0))
                if c_list is not None:
                    c_list.append(torch.zeros((0, 3), device=v.device))
                if uv_list is not None:
                    uv_list.append(torch.zeros((0, 2), device=v.device))
                continue

            fv = v[f]
            n = torch.linalg.cross(fv[:, 1] - fv[:, 0], fv[:, 2] - fv[:, 0], dim=1)
            n = F.normalize(n, dim=1, eps=1e-8)
            fv_flat = fv.reshape(-1, 3)
            n_flat = n.repeat_interleave(3, dim=0)
            new_f = torch.arange(fv_flat.shape[0], device=v.device, dtype=torch.long).reshape(-1, 3)

            v_list.append(fv_flat)
            f_list.append(new_f)
            n_list.append(n_flat)
            vc_list.append(torch.tensor(fv_flat.shape[0], device=v.device))
            fc_list.append(torch.tensor(new_f.shape[0], device=v.device))

            if c_list is not None:
                ci = mesh.vertex_colors[i]
                c_list.append(ci[f].reshape(-1, ci.shape[-1]))
            if uv_list is not None:
                uvi = mesh.uvs[i]
                uv_list.append(uvi[f].reshape(-1, 2))

        max_v = max(x.shape[0] for x in v_list)
        max_f = max(x.shape[0] for x in f_list)
        dev = mesh.vertices.device
        pv = torch.zeros(B, max_v, 3, device=dev, dtype=mesh.vertices.dtype)
        pf = torch.zeros(B, max_f, 3, device=dev, dtype=torch.long)
        pn = torch.zeros(B, max_v, 3, device=dev, dtype=mesh.vertices.dtype)
        for i in range(B):
            pv[i, :v_list[i].shape[0]] = v_list[i]
            pf[i, :f_list[i].shape[0]] = f_list[i]
            pn[i, :n_list[i].shape[0]] = n_list[i]

        return Types.MESH(
            vertices=pv,
            faces=pf,
            normals=pn,
            vertex_counts=torch.stack(vc_list).to(dev),
            face_counts=torch.stack(fc_list).to(dev),
            uvs=torch.stack(uv_list) if uv_list is not None else None,
            vertex_colors=torch.stack(c_list) if c_list is not None else None,
            metallic_roughness=mesh.metallic_roughness,
            texture=mesh.texture,
            unlit=mesh.unlit,
            material=mesh.material,
            emissive=mesh.emissive,
        )

    # ---- trimesh.Trimesh path (numpy, carries UVs/textures) ----------------
    @staticmethod
    def _flat_trimesh(tm) -> "Trimesh":
        items = tm if isinstance(tm, list) else [tm]
        out = []
        for t in items:
            verts = np.asarray(t.vertices, dtype=np.float64)
            faces = np.asarray(t.faces, dtype=np.int64)
            if verts.shape[0] == 0 or faces.shape[0] == 0:
                out.append(t)
                continue

            fv = verts[faces]
            fn = np.cross(fv[:, 1] - fv[:, 0], fv[:, 2] - fv[:, 0])
            nrm = np.linalg.norm(fn, axis=1, keepdims=True)
            nrm[nrm == 0] = 1.0
            fn = fn / nrm

            new_verts = fv.reshape(-1, 3)
            new_faces = np.arange(new_verts.shape[0], dtype=np.int64).reshape(-1, 3)
            new_normals = np.repeat(fn, 3, axis=0)

            new_tm = Trimesh(vertices=new_verts, faces=new_faces, process=False)
            new_tm.vertex_normals = new_normals

            vis = t.visual
            if isinstance(vis, TextureVisuals) and vis.uv is not None:
                uv = np.asarray(vis.uv)
                if uv.shape[0] == verts.shape[0]:
                    new_uv = uv[faces].reshape(-1, 2)
                    new_tm.visual = trimesh.visual.TextureVisuals(
                        uv=new_uv, material=vis.material)

            out.append(new_tm)

        return out if isinstance(tm, list) else out[0]

    def flat_shade(self, mesh=None, trimesh=None):
        mesh_out = self._flat_mesh(mesh) if mesh is not None else None
        trimesh_out = self._flat_trimesh(trimesh) if trimesh is not None else None
        return (mesh_out, trimesh_out)


NODE_CLASS_MAPPINGS = {"EternalFlatShade": EternalFlatShade}
NODE_DISPLAY_NAME_MAPPINGS = {"EternalFlatShade": "Flat Shade Eternal"}
