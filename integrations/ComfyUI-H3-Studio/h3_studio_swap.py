"""Prepare BFS guides or Akatz reference videos and assemble segments with source audio."""

import asyncio
from fractions import Fraction
import json
import math
from pathlib import Path
import shutil
import subprocess
import uuid

from aiohttp import web
from PIL import Image
import folder_paths
from server import PromptServer

from .h3_studio_api import metadata_path_for, resolve_output_video
from .h3_studio_enhance import probe_video, run_ffmpeg


def source_folder(source_id):
    if not isinstance(source_id, str) or len(source_id) != 32 or any(c not in "0123456789abcdef" for c in source_id):
        raise ValueError("無效的換角來源。")
    return Path(folder_paths.get_input_directory()) / "h3_swap" / source_id


def validate_settings(data):
    if not isinstance(data, dict) or data.get("mode") not in {"head", "character", "akatz-v1.5", "untmods-face"}:
        raise ValueError("請選擇有效的換角模式。")
    if type(data.get("steps")) is not int or data["steps"] not in {4, 6, 8, 20}:
        raise ValueError("步數必須為 4、6、8 或 20。")
    if data["mode"] == "akatz-v1.5" and data["steps"] != 20:
        raise ValueError("Akatz V1.5 目前僅支援 20 步原生採樣。")
    if data["mode"] == "untmods-face" and data["steps"] not in {8, 20}:
        raise ValueError("UntMods FaceSwap 支援 8 步專用 Turbo 或 20 步原生採樣。")
    if data.get("resolution") not in {"p480", "p540", "native"}:
        raise ValueError("無效的解析度。")
    for key in ("width", "height"):
        if type(data.get(key)) is not int or not 128 <= data[key] <= 1344 or data[key] % 32:
            raise ValueError("生成尺寸必須為 128～1344 的 32 倍數。")
    strength = data.get("strength")
    if type(strength) not in (int, float) or not math.isfinite(strength) or not 0 <= strength <= 2:
        raise ValueError("LoRA 強度必須介於 0～2。")
    if type(data.get("seed")) is not int or not 0 <= data["seed"] <= 9007199254740991:
        raise ValueError("無效的種子。")
    if type(data.get("cooldownSeconds")) is not int or not 5 <= data["cooldownSeconds"] <= 600:
        raise ValueError("每步降溫必須介於 5～600 秒。")
    if not isinstance(data.get("prompt"), str) or not data["prompt"].strip() or len(data["prompt"]) > 30000:
        raise ValueError("請提供換角提示詞（上限 30,000 字元）。")
    if not isinstance(data.get("target", ""), str) or len(data.get("target", "")) > 2000:
        raise ValueError("替換對象說明上限為 2,000 字元。")
    return {**{key: data[key] for key in ("mode", "steps", "resolution", "width", "height", "strength", "seed", "cooldownSeconds", "prompt")}, "target": data.get("target", "")}


def probe_source(source):
    info = probe_video(source)
    result = subprocess.run([shutil.which("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", str(source)],
                            capture_output=True, text=True, timeout=30, check=True)
    video = json.loads(result.stdout)["streams"][0]
    sar = video.get("sample_aspect_ratio", "1:1")
    ratio = Fraction(video["width"], video["height"]) * Fraction(sar.replace(":", "/") if sar not in {"N/A", "0:1"} else "1")
    rotation = video.get("tags", {}).get("rotate", 0)
    for side in video.get("side_data_list", []):
        rotation = side.get("rotation", rotation)
    if round(float(rotation)) % 180:
        ratio = 1 / ratio
    return {**info, "width": max(1, round(ratio * info["height"])), "displayAspect": f"{ratio.numerator}:{ratio.denominator}"}


# 15 s at 24 fps per H3 pass; 480P/540P fit in 12 GB at this length, 720P does not.
SEGMENT_FRAMES = 360


def guide_length(frames):
    """Snap a frame count up to H3's 5 + 17n length grid."""
    return 5 + 17 * max(0, math.ceil((frames - 5) / 17))


def prepare_segments(folder, source, reference, settings, source_name):
    info = probe_source(source)
    if not math.isfinite(info["duration"]) or info["duration"] <= 0:
        raise ValueError("來源影片沒有有效時長。")
    total = max(1, math.ceil(info["duration"] * 24))
    normalized = folder / "normalized.mp4"
    width, height = settings["width"], settings["height"]
    run_ffmpeg(["-i", str(source), "-vf", f"fps=24,scale={width}:{height}:flags=lanczos,setsar=1,tpad=stop_mode=clone:stop_duration=1",
                "-frames:v", str(total), "-an", "-c:v", "libx264", "-crf", "16", "-preset", "fast", "-y", str(normalized)])
    segments = []
    for index, start in enumerate(range(0, total, SEGMENT_FRAMES)):
        keep = min(SEGMENT_FRAMES, total - start)
        length = guide_length(keep)
        target = folder / f"guide_{index}.mp4"
        run_ffmpeg(["-i", str(normalized), "-vf", f"trim=start_frame={start}:end_frame={start + keep},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=1",
                    "-frames:v", str(length), "-an", "-c:v", "libx264", "-crf", "16", "-preset", "fast", "-y", str(target)])
        segments.append({"inputFile": f"h3_swap/{folder.name}/{target.name}", "keepFrames": keep, "length": length})
    normalized.unlink(missing_ok=True)
    manifest = {**info, "sourceId": folder.name, "sourceName": source_name,
                "sourceFile": f"h3_swap/{folder.name}/{source.name}",
                "referenceFile": f"h3_swap/{folder.name}/{reference.name}",
                "segments": segments, "settings": settings}
    (folder / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    return manifest


@PromptServer.instance.routes.post("/h3-studio/swap/prepare")
async def prepare_swap(request):
    folder = source_folder(uuid.uuid4().hex)
    folder.mkdir(parents=True)
    try:
        reader = await request.multipart()
        files = {}
        settings = None
        source_name = "上傳影片"
        async for part in reader:
            if part.name == "settings":
                settings = validate_settings(json.loads(await part.text()))
                continue
            if part.name not in {"video", "reference"}:
                raise ValueError("無效的上傳欄位。")
            if part.name in files:
                raise ValueError("每次只接受一支來源影片和一張角色圖。")
            suffix = Path(part.filename or "").suffix.lower()
            allowed = {".mp4", ".mov", ".webm"} if part.name == "video" else {".png", ".jpg", ".jpeg", ".webp"}
            if suffix not in allowed:
                raise ValueError("影片需為 MP4／MOV／WebM；參考圖需為 PNG／JPEG／WebP。")
            target = folder / (part.name + suffix)
            limit = 1024 ** 3 if part.name == "video" else 32 * 1024 ** 2
            size = 0
            with target.open("wb") as stream:
                while chunk := await part.read_chunk():
                    size += len(chunk)
                    if size > limit:
                        raise ValueError("影片上限 1 GB，參考圖上限 32 MB。")
                    stream.write(chunk)
            files[part.name] = target
            if part.name == "video":
                source_name = Path(part.filename).name
        if settings is None or set(files) != {"video", "reference"}:
            raise ValueError("請選擇來源影片與角色參考圖。")
        with Image.open(files["reference"]) as image:
            image.verify()
        result = await asyncio.to_thread(prepare_segments, folder, files["video"], files["reference"], settings, source_name)
        return web.json_response(result)
    except (ValueError, TypeError, KeyError, OSError, subprocess.SubprocessError) as error:
        # This request owns only regular files inside its fresh UUID directory.
        for target in folder.iterdir():
            if target.is_file():
                target.unlink(missing_ok=True)
        folder.rmdir()
        return web.json_response({"error": str(error)}, status=400)


def finish_segments(source_id, results, generation_seconds):
    folder = source_folder(source_id)
    manifest = folder / "manifest.json"
    if not manifest.is_file():
        raise ValueError("換角來源已不存在，請重新上傳。")
    info = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(results, list) or not 1 <= len(results) <= len(info["segments"]):
        raise ValueError("沒有有效的已完成片段。")
    settings = info["settings"]
    width, height = settings["width"], settings["height"]
    pieces = []
    frames = 0
    for index, item in enumerate(results):
        if not isinstance(item, dict) or item.get("subfolder") != "h3_swap_cache" or not isinstance(item.get("filename"), str) or not item["filename"].startswith(f"{source_id}_seg{index}_"):
            raise ValueError("換角片段與來源或順序不相符。")
        raw = resolve_output_video(item["filename"], item["subfolder"])
        raw_info = probe_video(raw)
        if (raw_info["width"], raw_info["height"]) != (width, height) or raw_info["duration"] < info["segments"][index].get("length", 124) / 24 - 0.1:
            raise ValueError("換角片段尺寸或長度不符。")
        keep = info["segments"][index]["keepFrames"]
        piece = folder / f"piece_{index}.mp4"
        # Correct the H3 canvas alignment with SAR so displayed aspect is exactly the source's.
        aspect = Fraction(info.get("displayAspect", f"{info['width']}:{info['height']}").replace(":", "/"))
        sar = aspect * Fraction(height, width)
        run_ffmpeg(["-i", str(raw), "-vf", f"setsar={sar}:max=65535", "-frames:v", str(keep), "-an", "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-y", str(piece)])
        frames += keep
        pieces.append(piece)
    concat = folder / "concat.txt"
    # Filenames are generated locally and contain no quoting characters.
    concat.write_text("".join(f"file '{piece.name}'\n" for piece in pieces), encoding="utf-8")
    duration = min(info["duration"], frames / 24)
    output = Path(folder_paths.get_output_directory()) / "video" / f"H3_Studio_Swap_{uuid.uuid4().hex[:12]}.mp4"
    output.parent.mkdir(parents=True, exist_ok=True)
    try:
        source = folder / Path(info["sourceFile"]).name
        run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(concat), "-i", str(source), "-map", "0:v:0", "-map", "1:a:0?",
                    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", str(duration), "-movflags", "+faststart", "-y", str(output)])
        metadata = {"kind": "video", "swapMode": settings["mode"], "swapSource": info["sourceName"],
                    "swapSourceFile": info["sourceFile"], "swapReferenceFile": info["referenceFile"],
                    "swapStrength": settings["strength"], "swapTarget": settings.get("target", ""), "swapCompletedSegments": len(results), "swapTotalSegments": len(info["segments"]),
                    "swapAspect": info.get("displayAspect", f"{info['width']}:{info['height']}"), "width": width, "height": height,
                    "duration": duration, "sound": info["sound"], "extendable": False,
                    "profile": {4: "cooled-turbo-4", 6: "fast", 8: "cooled-turbo-8", 20: "quality"}[settings["steps"]],
                    "steps": settings["steps"], "resolution": settings["resolution"], "seed": settings["seed"],
                    "cooldownSeconds": settings["cooldownSeconds"], "prompt": settings["prompt"]}
        if type(generation_seconds) in (int, float) and math.isfinite(generation_seconds) and generation_seconds >= 0:
            metadata["generationSeconds"] = round(generation_seconds)
        metadata_path_for(output).write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
        return {"filename": output.name, "subfolder": "video", "type": "output", "modifiedAt": output.stat().st_mtime, **metadata}
    except Exception:
        output.unlink(missing_ok=True)
        raise


@PromptServer.instance.routes.post("/h3-studio/swap/finish")
async def finish_swap(request):
    try:
        data = await request.json()
        result = await asyncio.to_thread(finish_segments, data.get("sourceId"), data.get("results"), data.get("generationSeconds"))
        return web.json_response(result)
    except (ValueError, TypeError, KeyError, OSError, subprocess.SubprocessError) as error:
        return web.json_response({"error": str(error)}, status=400)
