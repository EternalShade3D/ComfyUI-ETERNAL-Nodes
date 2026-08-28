import torch
import torch.nn.functional as F
from comfy_api.latest import Types


class FlatShadeMesh:
    """Force true flat shading on a Types.MESH.

    De-indexes the mesh to per-face vertices (each triangle owns its 3 verts)
    and assigns every vertex the face normal, computed on GPU with torch.
    No crease-angle split, no CPU numpy path -> fast and genuinely flat
    (unlike Smooth Mesh Normals at crease_angle=0, which splits every edge
    and rebuilds topology).

    Output still carries UVs / vertex colors (de-indexed to match), so
    textured meshes stay correct. SaveGLB uses the provided per-vertex
    normals -> every face shades flat in any glTF viewer.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"mesh": ("MESH",)}}

    RETURN_TYPES = ("MESH",)
    RETURN_NAMES = ("mesh",)
    FUNCTION = "flat_shade"
    CATEGORY = "👑 ETERNAL/3d/mesh"

    def flat_shade(self, mesh: Types.MESH) -> tuple:
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

            fv = v[f]                                   # (M,3,3)
            n = torch.linalg.cross(fv[:, 1] - fv[:, 0], fv[:, 2] - fv[:, 0], dim=1)  # (M,3)
            n = F.normalize(n, dim=1, eps=1e-8)
            fv_flat = fv.reshape(-1, 3)                 # (M*3,3)
            n_flat = n.repeat_interleave(3, dim=0)      # (M*3,3)
            new_f = torch.arange(fv_flat.shape[0], device=v.device, dtype=torch.long).reshape(-1, 3)

            v_list.append(fv_flat)
            f_list.append(new_f)
            n_list.append(n_flat)
            vc_list.append(torch.tensor(fv_flat.shape[0], device=v.device))
            fc_list.append(torch.tensor(new_f.shape[0], device=v.device))

            if c_list is not None:
                ci = mesh.vertex_colors[i]
                c = ci[f].reshape(-1, ci.shape[-1])
                c_list.append(c)
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

        out = Types.MESH(
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
        return (out,)


NODE_CLASS_MAPPINGS = {"FlatShadeMesh": FlatShadeMesh}
NODE_DISPLAY_NAME_MAPPINGS = {"FlatShadeMesh": "Flat Shade Mesh Eternal"}
