"""FaceRefine preparation and lossless source-audio export for Studio."""

import asyncio
import importlib
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import uuid

from aiohttp import web
import folder_paths
import nodes
from server import PromptServer

from .h3_studio_api import load_metadata, metadata_path_for, resolve_input_image, resolve_output_video
from .h3_studio_enhance import probe_video, run_ffmpeg


FACE_NODES = ("H3FaceSelect", "H3FaceTrackCrop", "H3FaceStitch", "H3InjectVideoLatent", "H3PerFrameDenoise", "MiniMaxH3NativeAudioLock", "H3StudioFaceAudio")
FACE_SELECT = ("largest_face", "left_most", "right_most", "centre_most", "all_faces")


class H3StudioFaceUnlockAudio:
    """Release the implicit audio lock after FaceRefine creates its video mask."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"av_latent": ("LATENT",)}}

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "unlock"
    CATEGORY = "H3 Studio"

    def unlock(self, av_latent):
        import torch
        import comfy.nested_tensor

        masks = list(av_latent["noise_mask"].unbind())
        masks[1] = torch.ones_like(masks[1])
        return ({**av_latent, "noise_mask": comfy.nested_tensor.NestedTensor(tuple(masks))},)


class H3StudioFaceAudio:
    """Match audio conditioning to the frames retained by a per-shot face selection."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"audio": ("AUDIO",), "transform": ("H3FACEXFORM",)}}

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "align"
    CATEGORY = "H3 Studio"

    def align(self, audio, transform):
        import torch
        import torch.nn.functional as F

        indices = transform.get("source") or list(range(len(transform["boxes"])))
        rate = int(audio["sample_rate"])
        wave = audio["waveform"]
        parts = []
        # Combine contiguous runs to avoid a separate tiny tensor for every frame.
        start = end = indices[0]
        runs = []
        for index in indices[1:]:
            if index == end + 1:
                end = index
            else:
                runs.append((start, end + 1))
                start = end = index
        runs.append((start, end + 1))
        for start, end in runs:
            a, b = round(start * rate / 24), round(end * rate / 24)
            part = wave[..., a:b]
            parts.append(F.pad(part, (0, max(0, b - a - part.shape[-1]))))
        return ({"waveform": torch.cat(parts, dim=-1), "sample_rate": rate},)


def validate_settings(value):
    if not isinstance(value, dict):
        raise ValueError("人臉精修設定無效。")
    select = value.get("select", "largest_face")
    strength = value.get("strength", 0.4)
    reference = value.get("referenceIndex", 0)
    mode = value.get("mode", "native-20")
    if mode not in {"native-20", "turbo-8"}:
        raise ValueError("人臉精修模式無效。")
    if select not in FACE_SELECT or type(strength) not in (int, float) or not math.isfinite(strength) or not 0.1 <= strength <= 0.4:
        raise ValueError("修臉強度必須介於 0.1～0.4，並選擇有效的人物位置。")
    if type(reference) is not int or reference < 0:
        raise ValueError("請選擇有效的身份參考圖。")
    return {"select": select, "strength": strength, "referenceIndex": reference, "mode": mode}


def readiness(mode="native-20", multiple=False):
    required = FACE_NODES if mode != "turbo-8" else tuple(name for name in FACE_NODES if name not in {"MiniMaxH3NativeAudioLock", "H3StudioFaceAudio"}) + ("MiniMaxH3TurboLoRA", "MiniMaxH3TurboSampler", "H3CooledTurboSampler", "H3StudioFaceUnlockAudio")
    if multiple:
        required += ("H3StudioMultiFaceSource",)
    missing = [name for name in required if name not in nodes.NODE_CLASS_MAPPINGS]
    missing += [name for name in ("ultralytics", "scipy", "scenedetect") if importlib.util.find_spec(name) is None]
    detector = Path(folder_paths.models_dir) / "ultralytics" / "bbox" / "face_yolov8m.pt"
    if not detector.is_file():
        missing.append("face_yolov8m.pt")
    if mode == "turbo-8" and not folder_paths.get_full_path("loras", "minimax_h3_turbo_v4_step600_ema.safetensors"):
        missing.append("minimax_h3_turbo_v4_step600_ema.safetensors")
    for kind, name in (("diffusion_models", "minimax_h3_ref2va_pruned_w4a8_mixed.safetensors"),
                       ("text_encoders", "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"),
                       ("vae", "minimax_h3_video_vae_fp16.safetensors"),
                       ("vae", "minimax_h3_audio_vae_fp32.safetensors")):
        if not folder_paths.get_full_path(kind, name):
            missing.append(name)
    return {"ready": not missing, "missing": missing}


def manifest_path(source_id):
    if not isinstance(source_id, str) or len(source_id) != 32 or any(c not in "0123456789abcdef" for c in source_id):
        raise ValueError("無效的修臉來源。")
    return Path(folder_paths.get_input_directory()) / "h3_face" / f"{source_id}.json"


def source_path(item):
    if not isinstance(item, dict) or item.get("type", "output") != "output":
        raise ValueError("請選擇作品列表中的影片。")
    target = resolve_output_video(item.get("filename"), item.get("subfolder", ""))
    if not target.is_file():
        raise ValueError("找不到來源影片。")
    return target


def prepare(item, settings, reference_file=None):
    settings = validate_settings(settings)
    multiple = settings["select"] == "all_faces"
    status = readiness(settings["mode"], multiple)
    if not status["ready"]:
        raise ValueError("人臉精修尚未就緒，請安裝並重啟 ComfyUI：" + "、".join(status["missing"]))
    source = source_path(item)
    info = probe_video(source)
    if not 0 < info["duration"] <= 15.2:
        raise ValueError("人臉精修目前每次支援最多 15 秒，請選擇原始短片。")
    metadata = load_metadata(source)
    references = list(metadata.get("referenceFiles") or [])
    references += [metadata[k] for k in ("firstImagePath", "lastImagePath") if metadata.get(k)]
    if metadata.get("faceRefineReference") and metadata["faceRefineReference"] not in references:
        references.append(metadata["faceRefineReference"])
    if multiple:
        reference_file = ""
    elif reference_file is None:
        if settings["referenceIndex"] >= len(references):
            raise ValueError("找不到身份參考圖，請補上一張清晰的人物圖片。")
        reference_file = references[settings["referenceIndex"]]
    if not multiple and not resolve_input_image(reference_file).is_file():
        raise ValueError("身份參考圖已不存在，請重新上傳。")
    source_id = uuid.uuid4().hex
    manifest = manifest_path(source_id)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    # H3's audio/video timing is 24fps. Refine before RTX interpolation; never silently retime speech.
    import cv2
    capture = cv2.VideoCapture(str(source))
    try:
        fps = capture.get(cv2.CAP_PROP_FPS)
        frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    finally:
        capture.release()
    if abs(fps - 24) > 0.05 or not 1 <= frames <= 365:
        raise ValueError("請選擇 24fps 的 H3 原片，在 RTX 補幀之前精修人臉。")
    prepared = {**info, "fps": fps, "frames": frames, "sourceId": source_id,
                "source": {"filename": source.name, "subfolder": item.get("subfolder", ""), "type": "output"},
                "videoPath": str(source), "referenceFile": reference_file, "settings": settings}
    manifest.write_text(json.dumps(prepared, ensure_ascii=False), encoding="utf-8")
    if multiple:
        from .h3_studio_face_multi import prepare_people
        return prepare_people(prepared)
    return prepared


def scan(prepared):
    cls = nodes.NODE_CLASS_MAPPINGS["H3FaceSelect"]
    picker = importlib.import_module(cls.__module__.rsplit(".", 1)[0] + ".picker_api")
    result = picker._scan({"video": prepared["videoPath"], "detector": "face_yolov8m.pt",
                           "confidence": 0.25, "select": "manual", "cut_detection": "auto (pyscenedetect)"})
    # No arbitrary paths from the caller reach the third-party picker API.
    return {key: result[key] for key in ("shots", "frames", "width", "height", "fps")}


def finish(source_id, raw, settings, picks, elapsed, completed_people=None):
    saved = json.loads(manifest_path(source_id).read_text(encoding="utf-8"))
    source = source_path(saved["source"])
    settings = validate_settings(settings)
    if settings != validate_settings(saved["settings"]):
        raise ValueError("修臉設定與準備時不一致。")
    if not isinstance(raw, dict) or raw.get("subfolder") != "h3_face_cache" or not str(raw.get("filename", "")).startswith(source_id + "_"):
        raise ValueError("修臉成品與來源不符。")
    multiple = settings["select"] == "all_faces"
    if multiple and (type(completed_people) is not int or not 1 <= completed_people <= len(saved["targets"]) or
                     not raw["filename"].startswith(f"{source_id}_person{completed_people - 1}_")):
        raise ValueError("逐人修復的成品或完成數量不符。")
    refined = source_path(raw)
    info = probe_video(refined)
    if (info["width"], info["height"]) != (saved["width"], saved["height"]) or abs(info["duration"] - saved["frames"] / 24) > 0.08:
        raise ValueError("修臉成品尺寸或影格數與來源不一致。")
    output = source.parent / f"H3_Studio_Face_{uuid.uuid4().hex[:12]}.mp4"
    try:
        run_ffmpeg(["-i", str(refined), "-i", str(source), "-map", "0:v:0", "-map", "1:a?",
                    "-c", "copy", "-movflags", "+faststart", "-y", str(output)])
        metadata = load_metadata(source)
        # A refined video has no matching continuation latent. Keep identity inputs for a re-run.
        for key in ("chainId", "clipIndex", "latentPath"):
            metadata.pop(key, None)
        metadata.update({"kind": "video", "faceRefined": True, "faceRefine": settings,
                         "faceRefineSteps": 8 if settings["mode"] == "turbo-8" else 20,
                         "faceRefineSource": saved["source"], "faceRefineReference": saved["referenceFile"],
                         "extendable": False, "width": saved["width"],
                         "height": saved["height"], "fps": 24, "duration": saved["frames"] / 24,
                         "sound": saved["sound"], "generationSeconds": max(1, round(float(elapsed)))})
        if multiple:
            metadata.pop("faceRefineReference", None)
            metadata["faceRefineReferences"] = [target["referenceFile"] for target in saved["targets"][:completed_people]]
            metadata["faceRefinePeopleTotal"] = len(saved["targets"])
            metadata["faceRefinePeopleCompleted"] = completed_people
        else:
            metadata.pop("faceRefinePeopleTotal", None)
            metadata.pop("faceRefinePeopleCompleted", None)
        if picks is not None:
            metadata["faceRefinePicks"] = picks
        else:
            metadata.pop("faceRefinePicks", None)
        metadata_path_for(output).write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        return {"filename": output.name, "subfolder": saved["source"]["subfolder"], "type": "output",
                "modifiedAt": output.stat().st_mtime, **metadata}
    except Exception:
        output.unlink(missing_ok=True)
        metadata_path_for(output).unlink(missing_ok=True)
        raise


@PromptServer.instance.routes.get("/h3-studio/face/status")
async def status_route(request):
    mode = request.query.get("mode", "native-20")
    if mode not in {"native-20", "turbo-8"}:
        return web.json_response({"error": "人臉精修模式無效。"}, status=400)
    return web.json_response(readiness(mode, request.query.get("select") == "all_faces"))


@PromptServer.instance.routes.post("/h3-studio/face/prepare")
async def prepare_route(request):
    try:
        data = await request.json()
        result = await asyncio.to_thread(prepare, data.get("source"), data.get("settings"), data.get("referenceFile"))
        if data.get("scan") and not result.get("targets"):
            result["preview"] = await asyncio.to_thread(scan, result)
        return web.json_response(result)
    except (ValueError, TypeError, KeyError, OSError, RuntimeError, subprocess.SubprocessError) as error:
        return web.json_response({"error": str(error)}, status=400)


@PromptServer.instance.routes.post("/h3-studio/face/finish")
async def finish_route(request):
    try:
        data = await request.json()
        result = await asyncio.to_thread(finish, data.get("sourceId"), data.get("raw"), data.get("settings"), data.get("picks"), data.get("elapsed"), data.get("completedPeople"))
        return web.json_response(result)
    except (ValueError, TypeError, KeyError, OSError, subprocess.SubprocessError) as error:
        return web.json_response({"error": str(error)}, status=400)
