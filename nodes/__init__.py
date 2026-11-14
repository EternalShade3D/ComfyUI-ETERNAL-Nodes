"""ETERNAL-Nodes - the node modules.

One module per node, mirroring the layout of the Pixaroma pack: this package is
the Python side, ``../js`` is the front-end ComfyUI serves as WEB_DIRECTORY.

``_tile_common.py`` is shared by the tile modules and is imported as
``._tile_common`` from inside this package (the modules also carry a bare
``_tile_common`` fallback so they can be imported standalone in tests).
"""
