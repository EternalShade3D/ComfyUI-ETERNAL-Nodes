import numpy as np
import torch
import trimesh
from io import BytesIO
from comfy_api.latest import Types
from comfy_extras.nodes_save_3d import mesh_item_to_glb_bytes


class EternalTrimeshToModel3D:
    """trimesh.Trimesh -> Types.File3D (GLB, model_3d socket).

    Internally performs the EXACT same conversion as the proven
    'Trimesh to Mesh Eternal' + 'Create 3D File (from Mesh)' chain:
        TRIMESH -> Types.MESH -> ComfyUI's own GLB encoder
        (mesh_item_to_glb_bytes) -> Types.File3D.
    This replaces the prior trimesh.export() path, which emitted
    degenerate point-cloud geometry instead of a solid mesh.
    Vertex normals from GeomPack are carried through so flat/smooth
    shading is preserved in the GLB.
    """
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"trimesh": ("TRIMESH",)}}

    RETURN_TYPES = ("FILE_3D_GLB",)
    RETURN_NAMES = ("model_3d",)
    FUNCTION = "to_model3d"
    CATEGORY = "⚡ ETERNAL ● ↩ /🧊 3D /🕸 Mesh"

    def to_model3d(self, trimesh):
        items = trimesh if isinstance(trimesh, list) else [trimesh]
        out = []
        for tm in items:
            if tm is None or len(tm.vertices) == 0 or len(tm.faces) == 0:
                raise ValueError("Trimesh to Model3D Eternal: empty mesh, cannot export GLB.")
            # 1) TRIMESH -> Types.MESH  (mirrors Trimesh to Mesh Eternal)
            v = torch.from_numpy(np.asarray(tm.vertices)).float()
            f = torch.from_numpy(np.asarray(tm.faces)).long()
            nrm = torch.from_numpy(np.asarray(tm.vertex_normals)).float()
            mesh = Types.MESH(
                vertices=v.unsqueeze(0),
                faces=f.unsqueeze(0),
                vertex_counts=torch.tensor([v.shape[0]]),
                face_counts=torch.tensor([f.shape[0]]),
                normals=nrm.unsqueeze(0),
            )
            # 2) Types.MESH -> GLB bytes  (mirrors Create 3D File (from Mesh))
            glb = mesh_item_to_glb_bytes(mesh, 0)
            out.append(Types.File3D(BytesIO(glb), file_format="glb"))
        return (out if isinstance(trimesh, list) else out[0],)


NODE_CLASS_MAPPINGS = {"EternalTrimeshToModel3D": EternalTrimeshToModel3D}
NODE_DISPLAY_NAME_MAPPINGS = {"EternalTrimeshToModel3D": "Trimesh to Model3D Eternal"}
