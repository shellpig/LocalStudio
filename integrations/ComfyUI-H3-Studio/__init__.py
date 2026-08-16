"""H3 Local Studio integration for ComfyUI.

ComfyUI loads this package through a directory junction at
`ComfyUI/custom_nodes/ComfyUI-H3-Studio`, so the code it runs is the same copy
that Git tracks here.

Importing `h3_studio_api` registers the `/h3-studio/*` routes on the ComfyUI
server. The node mappings come from the cooled sampler module.
"""

from . import h3_studio_api
from .h3_cooled_turbo_sampler import (
    NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS,
)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "h3_studio_api"]
