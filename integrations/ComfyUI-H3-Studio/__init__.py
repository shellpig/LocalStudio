"""H3 Local Studio integration for ComfyUI.

ComfyUI loads this package through a directory junction at
`ComfyUI/custom_nodes/ComfyUI-H3-Studio`, so the code it runs is the same copy
that Git tracks here.

Importing `h3_studio_api` registers the `/h3-studio/*` routes on the ComfyUI
server. The node mappings come from the cooled sampler module.
"""

from . import h3_studio_api
from . import h3_studio_enhance
from . import h3_studio_swap
from . import h3_studio_drama3
from . import h3_studio_face
from .h3_studio_face import H3StudioFaceAudio, H3StudioFaceUnlockAudio
from .h3_studio_face_multi import H3StudioMultiFaceSource
from .h3_studio_rtx import H3StudioRTX
from .h3_studio_vosr import H3StudioVOSR
from .h3_studio_lora import H3StudioLoRA
from .h3_cooled_turbo_sampler import (
    NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS,
)

NODE_CLASS_MAPPINGS = {**NODE_CLASS_MAPPINGS, "H3StudioRTX": H3StudioRTX, "H3StudioVOSR": H3StudioVOSR, "H3StudioLoRA": H3StudioLoRA, "H3StudioFaceAudio": H3StudioFaceAudio, "H3StudioFaceUnlockAudio": H3StudioFaceUnlockAudio, "H3StudioMultiFaceSource": H3StudioMultiFaceSource}
NODE_DISPLAY_NAME_MAPPINGS = {**NODE_DISPLAY_NAME_MAPPINGS, "H3StudioRTX": "H3 Studio RTX 提升", "H3StudioLoRA": "H3 Studio LoRA"}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "h3_studio_api"]
