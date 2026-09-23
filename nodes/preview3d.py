"""Preview 3D Eternal — faithful copy of core Preview 3D & Animation.

True copy of core Preview3D (comfy_extras/nodes_load_3d.py, node_id "Preview3D",
display "Preview 3D & Animation"). Only differences:
  - node_id "EternalPreview3D" / display "Preview 3D Eternal" (no collision with core).
  - preview file written with a "preview3d_eternal_" prefix so it is identifiable
    in the output folder.

The 3D viewport (rotate / animate / camera / matcap / clay / normal) is IDENTICAL
to Preview 3D & Animation, because the frontend reuses the core viewer via
comfyClass="Preview3D". The viewer's own settings (camera pose, material mode,
background) persist natively into the workflow JSON — that satisfies "save the
settings the user picks on the node" with zero custom widgets.
"""
import os
import shutil
import uuid

import folder_paths
from comfy_api.latest import IO, Types, UI


class EternalPreview3D(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="EternalPreview3D",
            search_aliases=["view mesh", "3d viewer", "eternal preview", "preview 3d"],
            display_name="Preview 3D Eternal",
            category="⚡ ETERNAL ● ↩ /🧊 3D",
            description=(
                "Eternal copy of Preview 3D & Animation. Same 3D viewport; previews are "
                "written to the TEMP folder with a preview3d_eternal_ prefix. Viewer "
                "settings (camera, matcap/clay/normal) persist into the workflow JSON."
            ),
            is_experimental=True,
            is_output_node=True,
            inputs=[
                IO.MultiType.Input(
                    IO.String.Input("model_file", default="", multiline=False),
                    types=[
                        IO.File3DGLB,
                        IO.File3DGLTF,
                        IO.File3DFBX,
                        IO.File3DOBJ,
                        IO.File3DSTL,
                        IO.File3DUSDZ,
                        IO.File3DAny,
                    ],
                    tooltip="3D model file or path string",
                ),
                IO.Load3DCamera.Input("camera_info", optional=True, advanced=True),
                IO.Image.Input("bg_image", optional=True, advanced=True),
            ],
            outputs=[],
        )

    @classmethod
    def execute(
        cls,
        model_file: str | Types.File3D,
        **kwargs,
    ) -> IO.NodeOutput:
        # Previews land in the TEMP folder (user requirement) so they don't
        # clutter output/. The frontend viewer copy loads from loadFolder:'temp'.
        tmp_dir = folder_paths.get_temp_directory()
        if isinstance(model_file, Types.File3D):
            filename = f"preview3d_eternal_{uuid.uuid4().hex}.{model_file.format}"
            model_file.save_to(os.path.join(tmp_dir, filename))
        else:
            # model_file is a path string — copy it into temp/ under our prefix.
            src = model_file
            if os.path.isfile(src):
                ext = os.path.splitext(src)[1].lstrip(".").lower() or "glb"
                filename = f"preview3d_eternal_{uuid.uuid4().hex}.{ext}"
                shutil.copyfile(src, os.path.join(tmp_dir, filename))
            else:
                filename = src
        camera_info = kwargs.get("camera_info", None)
        bg_image = kwargs.get("bg_image", None)
        return IO.NodeOutput(ui=UI.PreviewUI3D(filename, camera_info, bg_image=bg_image))

    process = execute  # TODO: remove
