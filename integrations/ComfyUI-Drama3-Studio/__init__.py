"""Assign a reusable Drama3 voice to the current dialogue's speaker number."""
import re
import os
from pathlib import Path

from aiohttp import web
import folder_paths
from server import PromptServer


class Drama3StudioSpeaker:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"voice": ("DRAMA3_VOICE",), "speaker": ("INT", {"default": 0, "min": 0, "max": 15})}}

    RETURN_TYPES = ("DRAMA3_VOICE",)
    FUNCTION = "assign"
    CATEGORY = "audio/drama3"

    def assign(self, voice, speaker):
        if type(speaker) is not int or not 0 <= speaker <= 15:
            raise ValueError("Speaker must be between 0 and 15")
        text = re.sub(r"^(?:<\|speaker:\d+\|>\s*)+", "", voice["transcript"].strip())
        if not text or "<|" in text:
            raise ValueError("Voice reference must contain a single speaker's transcript")
        return ({**voice, "transcript": f"<|speaker:{speaker}|> {text}"},)


class Drama3StudioVoiceCodes:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"voice": ("DRAMA3_VOICE",)}}

    RETURN_TYPES = ("DRAMA3_CODES",)
    FUNCTION = "extract"
    CATEGORY = "audio/drama3"

    def extract(self, voice):
        return (voice["codes"],)


@PromptServer.instance.routes.get("/drama3-studio/runtime")
async def runtime_info(_request):
    return web.json_response({"comfyRoot": str(Path(folder_paths.base_path).resolve())})


@PromptServer.instance.routes.post("/drama3-studio/voices/open-folder")
async def open_voice_folder(request):
    if request.remote not in {"127.0.0.1", "::1"} or request.headers.get("Origin") not in {None, "http://localhost:3000", "http://127.0.0.1:3000"}:
        raise web.HTTPForbidden()
    data = await request.json()
    voice = data.get("voice") if isinstance(data, dict) else None
    if voice not in folder_paths.get_filename_list("drama3_voices"):
        raise web.HTTPBadRequest(text="請選擇已保存的聲線。")
    target = Path(folder_paths.get_full_path_or_raise("drama3_voices", voice)).resolve()
    if not target.is_file():
        raise web.HTTPNotFound(text="聲線檔案不存在。")
    os.startfile(str(target.parent))
    return web.json_response({"folder": str(target.parent)})


NODE_CLASS_MAPPINGS = {"Drama3StudioSpeaker": Drama3StudioSpeaker, "Drama3StudioVoiceCodes": Drama3StudioVoiceCodes}
NODE_DISPLAY_NAME_MAPPINGS = {"Drama3StudioSpeaker": "Drama3 Studio Speaker", "Drama3StudioVoiceCodes": "Drama3 Reference Voice Codes"}
