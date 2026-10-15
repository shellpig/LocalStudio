"""Queued, streaming NVIDIA RTX video enhancement for Studio."""

import asyncio
from fractions import Fraction
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid

from aiohttp import web
import folder_paths
from server import PromptServer

from .h3_studio_api import metadata_path_for, resolve_output_video
from .h3_studio_swap import probe_source


def source_folder(source_id):
    if not isinstance(source_id, str) or len(source_id) != 32 or any(c not in "0123456789abcdef" for c in source_id):
        raise ValueError("無效的 RTX 影片來源。")
    return Path(folder_paths.get_input_directory()) / "h3_rtx" / source_id


def validate_settings(operation, multiplier):
    allowed = range(2, 17) if operation == "fps" else (2, 3, 4) if operation == "upscale" else ()
    if type(multiplier) is not int or multiplier not in allowed:
        raise ValueError("補幀倍數需為 2～16；解析度倍數需為 2、3 或 4。")


def video_info(path):
    executable = shutil.which("ffprobe")
    if not executable:
        raise ValueError("找不到 FFprobe，請先安裝 FFmpeg。")
    result = subprocess.run([executable, "-v", "error", "-show_streams", "-of", "json", str(path)],
                            capture_output=True, text=True, timeout=30, check=True)
    stream = next((s for s in json.loads(result.stdout)["streams"] if s["codec_type"] == "video"), None)
    if stream is None:
        raise ValueError("檔案沒有影片畫面。")
    try:
        fps = Fraction(stream.get("avg_frame_rate", "0/1"))
    except (ValueError, ZeroDivisionError) as error:
        raise ValueError("無法讀取影片幀率。") from error
    if fps <= 0:
        raise ValueError("無法讀取影片幀率。")
    info = probe_source(path)
    if not math.isfinite(info["duration"]) or info["duration"] <= 0:
        raise ValueError("來源影片沒有有效時長。")
    # Normalize display geometry (rotation and non-square pixels) before the SDK.
    info["width"] = max(2, round(info["width"] / 2) * 2)
    info["height"] = max(2, round(info["height"] / 2) * 2)
    return info, fps


@PromptServer.instance.routes.post("/h3-studio/rtx/prepare")
async def prepare_rtx(request):
    folder = source_folder(uuid.uuid4().hex)
    folder.mkdir(parents=True, exist_ok=True)
    try:
        if request.content_type == "multipart/form-data":
            reader = await request.multipart()
            source = None
            async for part in reader:
                suffix = Path(part.filename or "").suffix.lower()
                if part.name != "video" or source is not None or suffix not in {".mp4", ".mov", ".webm"}:
                    raise ValueError("請上傳一支 MP4、MOV 或 WebM 影片。")
                source = folder / ("source" + suffix)
                source_name = Path(part.filename).name
                size = 0
                with source.open("wb") as stream:
                    while chunk := await part.read_chunk():
                        size += len(chunk)
                        if size > 1024 ** 3:
                            raise ValueError("影片檔案上限為 1 GB。")
                        stream.write(chunk)
            if source is None:
                raise ValueError("請選擇來源影片。")
        else:
            data = await request.json()
            if not isinstance(data, dict):
                raise ValueError("無效的影片來源。")
            item = data.get("source")
            if not isinstance(item, dict):
                raise ValueError("無效的影片來源。")
            original = resolve_output_video(item.get("filename"), item.get("subfolder", ""))
            if original.stat().st_size > 1024 ** 3:
                raise ValueError("影片檔案上限為 1 GB。")
            source_name = original.name
            source = folder / ("source" + original.suffix.lower())
            await asyncio.to_thread(shutil.copyfile, original, source)
        info, fps = await asyncio.to_thread(video_info, source)
        manifest = {**info, "sourceName": source_name, "sourceFile": source.name, "sourceId": folder.name, "fps": float(fps)}
        (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
        return web.json_response(manifest)
    except (ValueError, TypeError, KeyError, OSError, subprocess.SubprocessError) as error:
        for path in folder.iterdir():
            path.unlink()
        folder.rmdir()
        return web.json_response({"error": str(error)}, status=400)


def output_geometry(info, operation, multiplier):
    validate_settings(operation, multiplier)
    width, height = info["width"], info["height"]
    if operation == "upscale":
        width, height = (max(8, math.floor(n * multiplier / 8 + 0.5) * 8) for n in (width, height))
    if max(width, height, info["width"], info["height"]) > 8192:
        raise ValueError("RTX 輸入與輸出尺寸上限為 8192 像素，請降低倍數或來源解析度。")
    return width, height


def process_video(source, output, operation, multiplier):
    import numpy as np
    import torch
    try:
        import nvvfx
    except ImportError as error:
        raise ValueError("尚未安裝 NVIDIA RTX 套件，請在 ComfyUI 環境安裝 nvidia-vfx>=0.2。") from error
    import comfy.model_management as management
    from comfy.utils import ProgressBar

    info, fps = video_info(source)
    width, height = output_geometry(info, operation, multiplier)
    device = management.get_torch_device()
    if device.type != "cuda":
        raise ValueError("RTX 提升需要 NVIDIA CUDA 顯示卡。")
    if operation == "fps" and torch.cuda.get_device_capability(device) < (8, 9):
        raise ValueError("RTX 補幀需要 RTX 40 系列或更新的顯示卡。")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("找不到 FFmpeg。")
    management.unload_all_models()
    management.soft_empty_cache()
    output_fps = fps * multiplier if operation == "fps" else fps
    decoder = encoder = None
    frames = 0
    total = max(1, round(info["duration"] * float(fps)))
    progress = ProgressBar(total)
    # stderr goes to disk so neither FFmpeg process can block on a full error pipe.
    with tempfile.TemporaryFile() as decode_errors, tempfile.TemporaryFile() as encode_errors:
        try:
            decoder = subprocess.Popen([ffmpeg, "-v", "error", "-i", str(source), "-map", "0:v:0", "-vf",
                f"scale={info['width']}:{info['height']},setsar=1,fps={fps}",
                "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], stdout=subprocess.PIPE, stderr=decode_errors)
            encoder = subprocess.Popen([ffmpeg, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s",
                f"{width}x{height}", "-r", str(output_fps), "-i", "pipe:0", "-i", str(source),
                "-map", "0:v:0", "-map", "1:a:0?", "-vf", "scale=out_color_matrix=bt709:out_range=tv",
                "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-colorspace", "bt709",
                "-color_trc", "iec61966-2-1", "-color_primaries", "bt709", "-c:a", "aac",
                "-movflags", "+faststart", str(output)], stdin=subprocess.PIPE, stderr=encode_errors)
            effect = (nvvfx.VideoSuperRes(quality=nvvfx.QualityLevel.ULTRA, strength=1.0, device=device.index or 0)
                      if operation == "upscale" else nvvfx.VideoFrameGeneration(
                          mode=nvvfx.VideoFrameGeneration.Mode.MEDIUM,
                          automatic_shot_change_detection_enabled=True, device=device.index or 0))

            def pixels(tensor):
                return tensor.permute(1, 2, 0).clamp(0, 1).mul(255).round().to(torch.uint8).cpu().numpy().tobytes()

            with torch.inference_mode(), effect:
                if operation == "upscale":
                    effect.output_width, effect.output_height = width, height
                else:
                    effect.input_width, effect.input_height = width, height
                    effect.frame_multiplier = multiplier
                effect.load()
                previous = last = None
                size = info["width"] * info["height"] * 3
                while True:
                    management.throw_exception_if_processing_interrupted()
                    raw = decoder.stdout.read(size)
                    if not raw:
                        break
                    if len(raw) != size:
                        raise ValueError("影片解碼得到不完整畫面。")
                    array = np.frombuffer(raw, dtype=np.uint8).reshape(info["height"], info["width"], 3).copy()
                    current = torch.from_numpy(array).to(device, dtype=torch.float32).permute(2, 0, 1).contiguous().div_(255)
                    if operation == "upscale":
                        encoder.stdin.write(pixels(torch.from_dlpack(effect.run(current).image).clone()))
                    else:
                        if previous is not None:
                            for index in range(1, multiplier):
                                management.throw_exception_if_processing_interrupted()
                                result = effect.run(previous, current, frame_index=index, shot_change=False)
                                encoder.stdin.write(pixels(torch.from_dlpack(result.image).clone()))
                        encoder.stdin.write(raw)
                        previous, last = current, raw
                    frames += 1
                    progress.update_absolute(frames, max(total, frames))
                if not frames:
                    raise ValueError("來源影片沒有可處理的畫面。")
                if operation == "fps":
                    # Fill the final source frame's display interval to preserve duration.
                    for _ in range(multiplier - 1):
                        encoder.stdin.write(last)
            decoder.stdout.close()
            encoder.stdin.close()
            if decoder.wait(timeout=60) or encoder.wait(timeout=120):
                raise ValueError("FFmpeg 無法完成 RTX 影片，請檢查來源與磁碟空間。")
        finally:
            for process in (decoder, encoder):
                if process is not None:
                    if process.poll() is None:
                        process.kill()
                    process.wait()
                    for stream in (process.stdin, process.stdout):
                        if stream and not stream.closed:
                            stream.close()
    return {"width": width, "height": height, "fps": float(output_fps),
            "duration": frames / float(fps), "sound": info["sound"]}


class H3StudioRTX:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"source_id": ("STRING",), "operation": (["fps", "upscale"],),
                             "multiplier": ("INT", {"default": 2, "min": 2, "max": 16})}}

    RETURN_TYPES = ()
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "H3 Studio"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def execute(self, source_id, operation, multiplier):
        started = time.monotonic()
        validate_settings(operation, multiplier)
        folder = source_folder(source_id)
        manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        source = folder / manifest["sourceFile"]
        output = Path(folder_paths.get_output_directory()) / "video" / f"H3_Studio_RTX_{operation}_{multiplier}x_{uuid.uuid4().hex[:12]}.mp4"
        output.parent.mkdir(parents=True, exist_ok=True)
        try:
            info = process_video(source, output, operation, multiplier)
            metadata = {**info, "kind": "video", "rtxOperation": operation, "rtxMultiplier": multiplier,
                        "rtxSource": manifest["sourceName"], "extendable": False,
                        "generationSeconds": round(time.monotonic() - started, 2)}
            metadata_path_for(output).write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
            return {"ui": {"images": [{"filename": output.name, "subfolder": "video", "type": "output", **metadata}]}}
        except BaseException:
            output.unlink(missing_ok=True)
            metadata_path_for(output).unlink(missing_ok=True)
            raise
