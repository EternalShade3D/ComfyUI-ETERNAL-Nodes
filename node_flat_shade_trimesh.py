import numpy as np
import trimesh
from trimesh import Trimesh
from trimesh.visual import TextureVisuals


class EternalFlatShadeTrimesh:
    """True flat (faceted) shading for a trimesh.Trimesh (GeomPack TRIMESH).

    De-indexes the mesh so every triangle owns its 3 vertices, then bakes the
    face normal as the per-vertex normal. Unlike GeomPack 'Compute Normals'
    (smooth=false) which only stores normals as vertex_attributes (trimesh
    overrides them on next compute), this writes real de-indexed vertex_normals
    so the faceted look survives export and downstream consumers.

    Carries UVs / texture material when present.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"trimesh": ("TRIMESH",)}}

    RETURN_TYPES = ("TRIMESH",)
    RETURN_NAMES = ("trimesh",)
    FUNCTION = "flat_shade"
    CATEGORY = "👑 ETERNAL/3d/mesh"

    def flat_shade(self, trimesh):
        items = trimesh if isinstance(trimesh, list) else [trimesh]
        out = []
        for tm in items:
            verts = np.asarray(tm.vertices, dtype=np.float64)
            faces = np.asarray(tm.faces, dtype=np.int64)
            if verts.shape[0] == 0 or faces.shape[0] == 0:
                out.append(tm)
                continue

            fv = verts[faces]                     # (M,3,3)
            fn = np.cross(fv[:, 1] - fv[:, 0],
                          fv[:, 2] - fv[:, 0])    # (M,3)
            n = np.linalg.norm(fn, axis=1, keepdims=True)
            n[n == 0] = 1.0
            fn = fn / n

            new_verts = fv.reshape(-1, 3)
            new_faces = np.arange(new_verts.shape[0], dtype=np.int64).reshape(-1, 3)
            new_normals = np.repeat(fn, 3, axis=0)

            new_tm = Trimesh(vertices=new_verts,
                             faces=new_faces, process=False)
            new_tm.vertex_normals = new_normals

            # carry UVs + texture material if the source had them
            vis = tm.visual
            if isinstance(vis, TextureVisuals) and vis.uv is not None:
                uv = np.asarray(vis.uv)
                if uv.shape[0] == verts.shape[0]:
                    new_uv = uv[faces].reshape(-1, 2)
                    new_tm.visual = trimesh.visual.TextureVisuals(
                        uv=new_uv, material=vis.material)

            out.append(new_tm)

        return (out if isinstance(trimesh, list) else out[0],)


NODE_CLASS_MAPPINGS = {"EternalFlatShadeTrimesh": EternalFlatShadeTrimesh}
NODE_DISPLAY_NAME_MAPPINGS = {"EternalFlatShadeTrimesh": "Flat Shade (Trimesh) Eternal"}
