import torch
import numpy as np
import trimesh
from comfy_api.latest import Types


class MeshToTrimesh:
    """Types.MESH -> trimesh.Trimesh.

    Bridges TRELLIS.2 core output (Types.MESH tensors) into GeomPack nodes,
    which only accept the TRIMESH (trimesh object) type. Respects batch
    vertex_counts / face_counts when present (zero-padding slices).
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"mesh": ("MESH",)}}

    RETURN_TYPES = ("TRIMESH",)
    RETURN_NAMES = ("trimesh",)
    FUNCTION = "to_trimesh"
    CATEGORY = "👑 ETERNAL/3d/mesh"

    def to_trimesh(self, mesh: Types.MESH):
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
        return (out if B > 1 else out[0],)


class TrimeshToMesh:
    """trimesh.Trimesh -> Types.MESH.

    Bridges a GeomPack-repaired mesh back to core nodes (SaveGLB / preview),
    which only accept Types.MESH. Re-pads to a single batch dimension.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"trimesh": ("TRIMESH",)}}

    RETURN_TYPES = ("MESH",)
    RETURN_NAMES = ("mesh",)
    FUNCTION = "to_mesh"
    CATEGORY = "👑 ETERNAL/3d/mesh"

    def to_mesh(self, trimesh):
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
        out = Types.MESH(
            vertices=pv,
            faces=pf,
            vertex_counts=torch.tensor(vc_list),
            face_counts=torch.tensor(fc_list),
        )
        return (out,)


NODE_CLASS_MAPPINGS = {
    "MeshToTrimesh": MeshToTrimesh,
    "TrimeshToMesh": TrimeshToMesh,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "MeshToTrimesh": "Mesh to Trimesh Eternal",
    "TrimeshToMesh": "Trimesh to Mesh Eternal",
}
