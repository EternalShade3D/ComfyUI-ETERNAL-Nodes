"""Panorama 360 Viewer — ETERNAL.

Displays an equirectangular (360) image as an interactive sphere inside the node:
drag to look around, scroll to zoom, optional auto-rotation.

Ported from pavel-zinchenko/comfyui-360-viewer (MIT, Copyright (c) 2026
pavel-zinchenko) — see THIRD_PARTY_NOTICES.md at the pack root.

Differences vs the upstream node:
  - node_id "EternalViewer360" / display "Panorama 360 Viewer" (no collision with
    the upstream pack if both are installed, namespaced like the rest of ETERNAL).
  - IMAGE output: pass-through of the input, so the viewer can sit mid-graph
    instead of ending it.
  - frame_index widget: pick which image of a batch to view (upstream always used
    frame 0).
  - fov widget: the zoom the viewer opens at. Upstream hardcoded 75 and only let the
    wheel move it between 30 and 100, so the view read as "too close" with no way
    back except scrolling the other way. Default 100 matches what other 360 viewers
    ship (Pannellum's default horizontal fov is 100).
  - auto_rotate widget: degrees per second, paused while dragging.
  - background widget: colour behind the sphere.
  - No manual temp-file writing: the image is handed to the frontend through the V3
    ui.PreviewImage path, the same temp-file mechanism core preview nodes use (no
    PIL/numpy round-trip, no uuid filenames).
  - The viewer JS is hardened and gains a gear button + settings panel, following the
    Save 3D Pixaroma pattern (see js/panorama360_viewer.js).
"""

from comfy_api.latest import IO, UI


class EternalViewer360(IO.ComfyNode):
    @classmethod
    def define_schema(cls):
        return IO.Schema(
            node_id="EternalViewer360",
            display_name="Panorama 360 Viewer Eternal",
            category="⚡ ETERNAL ● ↩ /🌐 360",
            description=(
                "Shows an equirectangular (360) image as a WebGL sphere inside the node: "
                "drag to look around, scroll to zoom, optional auto-rotation. Use it to "
                "inspect seams, poles and distortion of a 2:1 panorama.\n\n"
                "fov is the zoom the viewer opens at, in degrees: bigger = wider = the "
                "panorama looks further away. 100 is the usual viewer default, 75 looks "
                "zoomed in. The wheel changes it live and the value is written back here, "
                "so the view you framed is the view the workflow saves.\n\n"
                "The gear button on the view opens the settings panel: start view (yaw "
                "and pitch), camera height on the vertical axis, exposure, zoom range, "
                "wheel and drag speed, horizon guide, background, reset. Equirectangular images "
                "only (2:1, the 'unwrapped' 360 layout).\n\n"
                "The viewer needs internet the first time it loads three.js (~600 KB, "
                "browser-cached afterwards)."
            ),
            search_aliases=[
                "360", "panorama", "equirectangular", "sphere", "vr", "pano viewer",
            ],
            is_output_node=True,
            inputs=[
                IO.Image.Input(
                    "image",
                    tooltip="Equirectangular 360 image (2:1 aspect).",
                ),
                IO.Int.Input(
                    "frame_index",
                    default=0,
                    min=0,
                    max=4096,
                    step=1,
                    tooltip="Which image of the batch to view (0 = first).",
                ),
                IO.Int.Input(
                    "fov",
                    default=100,
                    min=30,
                    max=140,
                    step=1,
                    tooltip=(
                        "Field of view in degrees: the zoom the viewer opens at. "
                        "Bigger = wider = further away. 100 is the usual default, "
                        "75 feels zoomed in, 140 is very wide."
                    ),
                ),
                IO.Float.Input(
                    "auto_rotate",
                    default=0.0,
                    min=0.0,
                    max=60.0,
                    step=0.5,
                    tooltip=(
                        "Degrees per second the view drifts on its own (0 = off). "
                        "Pauses while you drag, resumes when you let go."
                    ),
                ),
                IO.Combo.Input(
                    "background",
                    options=["dark", "black", "grey", "light"],
                    default="dark",
                    tooltip="Colour behind the sphere, visible at the poles and edges.",
                ),
                IO.Float.Input(
                    "exposure",
                    default=1.0,
                    min=0.2,
                    max=3.0,
                    step=0.05,
                    tooltip=(
                        "Viewer brightness: 1.0 shows the file as it is, above brightens, "
                        "below darkens. It affects only what you see in the node, never "
                        "the image on the wire."
                    ),
                ),
                IO.Float.Input(
                    "start_yaw",
                    default=180.0,
                    min=0.0,
                    max=360.0,
                    step=5.0,
                    tooltip=(
                        "Where the view opens horizontally, in degrees around the "
                        "panorama: 0/360 = left edge of the image, 180 = its middle. "
                        "Change it when the subject is not in the middle."
                    ),
                ),
                IO.Float.Input(
                    "start_pitch",
                    default=0.0,
                    min=-90.0,
                    max=90.0,
                    step=5.0,
                    tooltip=(
                        "Where the view opens vertically: 0 = horizon centred, negative "
                        "= looking down at the floor, positive = up at the sky."
                    ),
                ),
                IO.Float.Input(
                    "z_offset",
                    default=0.0,
                    min=-99.0,
                    max=99.0,
                    step=1.0,
                    tooltip=(
                        "Camera height on the vertical (Z) axis: slides the viewpoint up "
                        "or down as a percent of the sphere radius. 100 would put the eye "
                        "exactly on the sphere surface, so 99 slides the image almost all "
                        "the way past you. A translation, not a tilt. Negative looks from "
                        "below, positive from above."
                    ),
                ),
            ],
            outputs=[
                IO.Image.Output(
                    "image",
                    display_name="image",
                    tooltip=(
                        "Pass-through of the input image, so the viewer can sit in the "
                        "middle of a graph instead of ending it."
                    ),
                ),
            ],
        )

    @classmethod
    def execute(
        cls,
        image,
        frame_index=0,
        fov=100,
        auto_rotate=0.0,
        background="dark",
        exposure=1.0,
        start_yaw=180.0,
        start_pitch=0.0,
        z_offset=0.0,
    ):
        total = int(image.shape[0])
        idx = max(0, min(int(frame_index), total - 1))
        return IO.NodeOutput(image, ui=UI.PreviewImage(image[idx:idx + 1]))


NODE_CLASS_MAPPINGS = {"EternalViewer360": EternalViewer360}
NODE_DISPLAY_NAME_MAPPINGS = {"EternalViewer360": "Panorama 360 Viewer Eternal"}