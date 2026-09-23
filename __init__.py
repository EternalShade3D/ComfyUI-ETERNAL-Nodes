from .node_video_sizes import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS
from .node_flat_shade import NODE_CLASS_MAPPINGS as _FLAT_MAP, NODE_DISPLAY_NAME_MAPPINGS as _FLAT_NAMES
from .node_mesh_bridge import NODE_CLASS_MAPPINGS as _BRIDGE_MAP, NODE_DISPLAY_NAME_MAPPINGS as _BRIDGE_NAMES
from .node_trimesh_to_file3d import NODE_CLASS_MAPPINGS as _F3D_MAP, NODE_DISPLAY_NAME_MAPPINGS as _F3D_NAMES
from .node_aspect_ratio_size_picker import NODE_CLASS_MAPPINGS as _AR_MAP, NODE_DISPLAY_NAME_MAPPINGS as _AR_NAMES
from .node_eternal_preview3d import EternalPreview3D
from .node_tile_grid import NODE_CLASS_MAPPINGS as _TILE_GRID_MAP, NODE_DISPLAY_NAME_MAPPINGS as _TILE_GRID_NAMES
from .node_tile_split import NODE_CLASS_MAPPINGS as _TILE_SPLIT_MAP, NODE_DISPLAY_NAME_MAPPINGS as _TILE_SPLIT_NAMES
from .node_tile_stitch import NODE_CLASS_MAPPINGS as _TILE_STITCH_MAP, NODE_DISPLAY_NAME_MAPPINGS as _TILE_STITCH_NAMES
from .node_prompt_by_index import NODE_CLASS_MAPPINGS as _PROMPT_MAP, NODE_DISPLAY_NAME_MAPPINGS as _PROMPT_NAMES
from .node_tile_prompt_panel import NODE_CLASS_MAPPINGS as _PANEL_MAP, NODE_DISPLAY_NAME_MAPPINGS as _PANEL_NAMES
from .node_tile_unbatch import NODE_CLASS_MAPPINGS as _UNBATCH_MAP, NODE_DISPLAY_NAME_MAPPINGS as _UNBATCH_NAMES
from .node_prompt_list_join import NODE_CLASS_MAPPINGS as _JOIN_MAP, NODE_DISPLAY_NAME_MAPPINGS as _JOIN_NAMES
from .node_tile_prepare import NODE_CLASS_MAPPINGS as _PREP_MAP, NODE_DISPLAY_NAME_MAPPINGS as _PREP_NAMES
from .node_prompt_line import NODE_CLASS_MAPPINGS as _PLINE_MAP, NODE_DISPLAY_NAME_MAPPINGS as _PLINE_NAMES
from .node_viewer360 import NODE_CLASS_MAPPINGS as _V360_MAP, NODE_DISPLAY_NAME_MAPPINGS as _V360_NAMES

NODE_CLASS_MAPPINGS = {
    **NODE_CLASS_MAPPINGS,
    **_FLAT_MAP,
    **_BRIDGE_MAP,
    **_F3D_MAP,
    **_AR_MAP,
    **_TILE_GRID_MAP,
    **_TILE_SPLIT_MAP,
    **_TILE_STITCH_MAP,
    **_PROMPT_MAP,
    **_PANEL_MAP,
    **_UNBATCH_MAP,
    **_JOIN_MAP,
    **_PREP_MAP,
    **_PLINE_MAP,
    **_V360_MAP,
    "EternalPreview3D": EternalPreview3D,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    **NODE_DISPLAY_NAME_MAPPINGS,
    **_FLAT_NAMES,
    **_BRIDGE_NAMES,
    **_F3D_NAMES,
    **_AR_NAMES,
    **_TILE_GRID_NAMES,
    **_TILE_SPLIT_NAMES,
    **_TILE_STITCH_NAMES,
    **_PROMPT_NAMES,
    **_PANEL_NAMES,
    **_UNBATCH_NAMES,
    **_JOIN_NAMES,
    **_PREP_NAMES,
    **_PLINE_NAMES,
    **_V360_NAMES,
    # ---------------------------------------------------------------
    # Legacy tile nodes: still registered so older workflows keep
    # loading, but superseded - the names say where to go instead.
    #   TILE GRID + TILE SPLIT + TILES -> VL   ==>  TILE PREPARE
    #   PER-TILE PROMPT + VL PROMPTS -> PANEL  ==>  PROMPT FOR TILE #N
    # ---------------------------------------------------------------
    "TileGridEternal": "(old) TILE GRID - use TILE PREPARE",
    "TileSplitEternal": "(old) TILE SPLIT - use TILE PREPARE",
    "TileUnbatchEternal": "(old) TILES -> VL - TILE PREPARE has a tile output",
    "PromptByIndexEternal": "(old) PER-TILE PROMPT - use PROMPT FOR TILE #N",
    "PromptListJoinEternal": "(old) VL PROMPTS -> PANEL - wire auto_prompts",
    "EternalPreview3D": "Preview 3D Eternal",
}

WEB_DIRECTORY = "./js"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
