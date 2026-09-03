import torch
import numpy as np
import trimesh
from comfy_api.latest import Types


class EternalMeshBridge:
    """Bridge between ComfyUI core Types.MESH and GeomPack trimesh.Trimesh.

    Two OPTIONAL inputs:
      - `mesh`    : Types.MESH (e.g. TRELLIS.2 save / core preview)
      - `trimesh` : trimesh.Trimesh (e.g. GeomPack Fill Holes / Compute Normals)

    Two outputs (both populated from whichever input you supply):
      - `mesh`    : Types.MESH  (converted from trimesh if you gave trimesh)
      - `trimesh` : trimesh.Trimesh (converted from mesh if you gave mesh)

    Feed one side, get both back -> wire onwards to whichever node needs which.
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
    FUNCTION = "bridge"
    CATEGORY = "⚡ ETERNAL ● ↩ /🧊 3D /🕸 Mesh"

    # ---- Types.MESH -> trimesh.Trimesh -------------------------------------
    @staticmethod
    def _mesh_to_trimesh(mesh: Types.MESH):
        B = mesh.vertices.shape[0]
        vc = mesh.vertex_counts
        fc = mesh.face_counts
        out = []
        for i in range(B):
            v = mesh.vertices[i]
            f = mesh.faces[i].long()
            if vc is not None:
                v = v[:int(vc[i].item())]
            if fc is not None:
                f = f[:int(fc[i].item())]
            tm = trimesh.Trimesh(
                vertices=np.asarray(v.detach().cpu().float()),
                faces=np.asarray(f.detach().cpu().long()),
                process=False,
            )
            if mesh.normals is not None:
                nrm = mesh.normals[i]
                if vc is not None:
                    nrm = nrm[:int(vc[i].item())]
                tm.vertex_normals = np.asarray(nrm.detach().cpu().float())
            out.append(tm)
        return out if B > 1 else out[0]

    # ---- trimesh.Trimesh -> Types.MESH -------------------------------------
    @staticmethod
    def _trimesh_to_mesh(trimesh):
        items = trimesh if isinstance(trimesh, list) else [trimesh]
        v_list, f_list = [], []
        for tm in items:
            v_list.append(torch.from_numpy(np.asarray(tm.vertices)).float())
            f_list.append(torch.from_numpy(np.asarray(tm.faces)).long())
        max_v = max(x.shape[0] for x in v_list)
        max_f = max(x.shape[0] for x in f_list)
        B = len(items)
        pv = torch.zeros(B, max_v, 3)
        pf = torch.zeros(B, max_f, 3, dtype=torch.long)
        vc_list, fc_list = [], []
        for i, (v, f) in enumerate(zip(v_list, f_list)):
            pv[i, :v.shape[0]] = v
            pf[i, :f.shape[0]] = f
            vc_list.append(v.shape[0])
            fc_list.append(f.shape[0])
        return Types.MESH(
            vertices=pv,
            faces=pf,
            vertex_counts=torch.tensor(vc_list),
            face_counts=torch.tensor(fc_list),
        )

    def bridge(self, mesh=None, trimesh=None):
        mesh_out = mesh if mesh is not None else (
            self._trimesh_to_mesh(trimesh) if trimesh is not None else None)
        trimesh_out = trimesh if trimesh is not None else (
            self._mesh_to_trimesh(mesh) if mesh is not None else None)
        return (mesh_out, trimesh_out)


NODE_CLASS_MAPPINGS = {"EternalMeshBridge": EternalMeshBridge}
NODE_DISPLAY_NAME_MAPPINGS = {"EternalMeshBridge": "Mesh Bridge Eternal"}
