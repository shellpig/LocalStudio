"""Local Drama3 dialogue jobs, voice references, and Studio audio outputs."""
import asyncio
import json
import logging
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import tempfile
import time
import uuid

import aiohttp
from aiohttp import web
import folder_paths
from server import PromptServer

from .h3_studio_api import STUDIO_ORIGINS, load_metadata, metadata_path_for


BASE = "http://127.0.0.1:8190"
RUNTIME_ROOT = Path(__file__).resolve().parents[2] / "services" / "Drama3" / "ComfyUI"
MODEL = "drama3_w4a8experts_bf16.safetensors"
CODEC = "drama3_codec.safetensors"
ASR = "qwen3_asr_0.6b_bf16.safetensors"
SUBFOLDER = "H3_Drama3"
PREVIEW_SUBFOLDER = "H3_Drama3_Previews"
FILENAME = re.compile(r"H3_Drama3_[0-9a-f]{32}\.flac")
REFERENCE = re.compile(r"H3_Drama3_ref_[0-9a-f]{32}\.wav")
JOBS = {}
TASKS = set()
GPU_ADMISSION = asyncio.Lock()
MAX_AUDIO_BYTES = 32 * 1024 * 1024


def runtime_installed():
    return (RUNTIME_ROOT / "main.py").is_file() and (RUNTIME_ROOT.parent / ".venv/Scripts/python.exe").is_file()


def local_voice_names():
    root = RUNTIME_ROOT / "output/drama3_voices"
    return sorted(path.relative_to(root).as_posix() for path in root.rglob("*.safetensors") if path.is_file())


async def service_action(action):
    script = RUNTIME_ROOT.parents[2] / "tools/drama3_service.ps1"
    # The detached venv launcher may inherit handles; pipe EOF would wait for the service to exit.
    with tempfile.TemporaryFile() as output:
        process = await asyncio.create_subprocess_exec(
            "powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), "-Action", action,
            stdout=output, stderr=asyncio.subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        await process.wait()
        if process.returncode:
            output.seek(0)
            detail = output.read().decode(errors="replace")[-1000:]
            raise RuntimeError(f"Drama3 {action} 失敗：{detail}")


async def start_runtime(session):
    try:
        await require_project_runtime(session)
    except aiohttp.ClientConnectorError:
        try:
            await service_action("Start")
            await require_project_runtime(session)
        except Exception:
            try:
                await service_action("Stop")
            except Exception:
                logging.exception("Drama3 startup cleanup failed")
            raise


def node(kind, **inputs):
    return {"class_type": kind, "inputs": inputs}


def text_value(value, label, limit):
    if not isinstance(value, str) or not value.strip() or len(value) > limit or "<|" in value:
        raise ValueError(f"{label}不可空白、超過 {limit} 字元或包含 speaker／系統標記。")
    return value.strip()


def validate_dialogue(data, voices):
    roles, lines = data.get("roles"), data.get("lines")
    if not isinstance(roles, list) or not 1 <= len(roles) <= 16:
        raise ValueError("請設定 1～16 個角色。")
    role_ids = set()
    for role in roles:
        if not isinstance(role, dict):
            raise ValueError("角色設定無效。")
        role_id = text_value(role.get("id"), "角色 ID", 50)
        if role_id in role_ids:
            raise ValueError("角色 ID 不可重複。")
        role_ids.add(role_id)
        text_value(role.get("name"), "角色名稱", 50)
        if role.get("voice") not in voices:
            raise ValueError(f"請為 {role['name']} 選擇已保存的聲線。")
    if not isinstance(lines, list) or not 1 <= len(lines) <= 100:
        raise ValueError("請提供 1～100 段台詞。")
    for line in lines:
        if not isinstance(line, dict) or line.get("roleId") not in role_ids:
            raise ValueError("台詞使用了不存在的角色。")
        text_value(line.get("text"), "台詞", 2000)
    if sum(len(line["text"]) for line in lines) > 12000:
        raise ValueError("整份劇本最多 12,000 字元。")
    seed = data.get("seed", secrets.randbelow(9007199254740991))
    if type(seed) is not int or not 0 <= seed <= 9007199254740991:
        raise ValueError("種子必須是 0～9007199254740991 的整數。")
    settings = {"seed": seed}
    for key, default, low, high in (("temperature", 1.0, 0.1, 2.0), ("topP", 0.9, 0.05, 1.0),
                                   ("topK", 30, 1, 4096), ("maxFrames", 1290, 1, 8192)):
        value = data.get(key, default)
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"{key} 必須介於 {low}～{high}。")
        if key in {"topK", "maxFrames"} and type(value) is not int:
            raise ValueError(f"{key} 必須是整數。")
        settings[key] = value
    return {"roles": [{key: r[key] for key in ("id", "name", "voice")} for r in roles],
            "lines": [{"roleId": line["roleId"], "text": line["text"].strip()} for line in lines], **settings}


def dialogue_graph(data, prefix):
    ids = {role["id"]: index for index, role in enumerate(data["roles"])}
    text = "\n".join(f"<|speaker:{ids[line['roleId']]}|> {line['text']}" for line in data["lines"])
    graph = {"1": node("Drama3Loader", model_name=MODEL, experts="in RAM", expert_cache_gb=2.0, second_gpu="none", split_layer=0),
             "2": node("Drama3CodecLoader", codec_name=CODEC),
             "3": node("Drama3Generate", model=["1", 0], text=text, seed=data["seed"], temperature=data["temperature"],
                       top_p=data["topP"], top_k=data["topK"], max_frames=data["maxFrames"], split_long_text=True),
             "4": node("Drama3Decode", codec=["2", 0], codes=["3", 0]),
             "5": node("SaveAudio", audio=["4", 0], filename_prefix=prefix)}
    for index, role in enumerate(data["roles"]):
        load, assign = str(100 + index * 2), str(101 + index * 2)
        graph[load] = node("Drama3LoadVoice", voice=role["voice"])
        graph[assign] = node("Drama3StudioSpeaker", voice=[load, 0], speaker=index)
        graph["3"]["inputs"][f"voices.voice{index}"] = [assign, 0]
    return graph


async def remote(session, path, payload=None, base=None):
    method = "GET" if payload is None else "POST"
    async with session.request(method, (base or BASE) + path, json=payload) as response:
        if response.status >= 400:
            detail = (await response.text())[:500]
            raise RuntimeError(f"Drama3 服務錯誤（HTTP {response.status}）：{detail}")
        if response.content_type == "application/json":
            return await response.json()
        await response.read()
        return {}


def combo_options(schema):
    if not schema:
        return []
    return schema[1].get("options", []) if schema[0] == "COMBO" else schema[0]


async def voice_names(session):
    await require_project_runtime(session)
    info = await remote(session, "/object_info/Drama3LoadVoice")
    return combo_options(info.get("Drama3LoadVoice", {}).get("input", {}).get("required", {}).get("voice"))


async def require_project_runtime(session):
    try:
        info = await remote(session, "/drama3-studio/runtime")
        root = info.get("comfyRoot")
        if not isinstance(root, str) or os.path.normcase(str(Path(root).resolve())) != os.path.normcase(str(RUNTIME_ROOT.resolve())):
            raise ValueError("Unexpected Drama3 runtime")
    except (RuntimeError, ValueError) as error:
        raise RuntimeError("8190 的 Drama3 不屬於目前的 MinimaxH3 專案，請使用本專案的 start_drama3.bat 啟動。") from error


async def idle(session, base):
    queue = await remote(session, "/queue", base=base)
    if queue.get("queue_running") or queue.get("queue_pending"):
        raise RuntimeError("GPU 服務仍有其他工作，請等候完成後重試。")


async def release_gpu(session, base):
    await idle(session, base)
    await remote(session, "/free", {"unload_models": True, "free_memory": True}, base)
    # /free sets a worker flag. Wait for observed allocation to fall, not just HTTP 200.
    started = time.monotonic()
    while time.monotonic() - started < 60:
        await asyncio.sleep(0.5)
        stats = await remote(session, "/system_stats", base=base)
        allocated = sum(d.get("torch_vram_total", 0) - d.get("torch_vram_free", 0) for d in stats.get("devices", []))
        if time.monotonic() - started >= 1 and allocated < 256 * 1024**2:
            return
    raise RuntimeError("模型記憶體尚未釋放，已停止下一筆生成；請檢查對應 ComfyUI。")


def active_job():
    return next((job for job in JOBS.values() if job["status"] in {"running", "cancelling"}), None)


def public_job(job):
    return {key: job[key] for key in ("id", "operation", "status", "message", "result") if key in job}


async def wait_history(session, graph, job):
    submitted = await remote(session, "/prompt", {"prompt": graph})
    prompt_id = submitted.get("prompt_id")
    if not prompt_id or submitted.get("node_errors"):
        raise RuntimeError("Drama3 工作流程無法提交，請確認轉接節點與模型均已安裝。")
    job["promptId"] = prompt_id
    started = time.monotonic()
    while time.monotonic() - started < 3600:
        if job.get("cancel"):
            await remote(session, "/queue", {"delete": [prompt_id]})
            await remote(session, "/interrupt", {"prompt_id": prompt_id})
            # Keep the Studio queue occupied until the interrupted prompt actually stops.
            while True:
                queue = await remote(session, "/queue")
                if not any(item[1] == prompt_id for item in queue.get("queue_running", [])):
                    raise asyncio.CancelledError()
                await asyncio.sleep(0.5)
        history = await remote(session, "/history/" + prompt_id)
        record = history.get(prompt_id)
        if record:
            if record.get("status", {}).get("status_str") != "success":
                errors = [entry[1].get("exception_message", "") for entry in record.get("status", {}).get("messages", [])
                          if entry[0] == "execution_error"]
                raise RuntimeError("Drama3 生成失敗：" + (errors[-1][:500] if errors else "工作已中斷或沒有產生輸出。"))
            return record.get("outputs", {})
        await asyncio.sleep(1)
    await remote(session, "/interrupt", {"prompt_id": prompt_id})
    raise TimeoutError("Drama3 工作超過一小時，已要求中斷。")


async def copy_audio(session, output, data, job):
    preview = job["operation"] == "previewVoice"
    subfolder = PREVIEW_SUBFOLDER if preview else SUBFOLDER
    target = Path(folder_paths.get_output_directory()) / subfolder / f"H3_Drama3_{job['id']}.flac"
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".part")
    try:
        async with session.get(BASE + "/view", params=output) as response:
            response.raise_for_status()
            size = 0
            with temporary.open("wb") as handle:
                async for chunk in response.content.iter_chunked(65536):
                    size += len(chunk)
                    if size > 256 * 1024**2:
                        raise RuntimeError("生成音訊超過 256 MB，無法匯入。")
                    handle.write(chunk)
        if size == 0:
            raise RuntimeError("Drama3 回傳空音訊。")
        temporary.replace(target)
        if preview:
            return {"voice": data["voice"], "previewKey": job["id"]}
        item = {"filename": target.name, "subfolder": SUBFOLDER, "type": "output", "kind": "audio", "model": "drama3",
                "voice": "、".join(role["name"] for role in data["roles"]), "modifiedAt": target.stat().st_mtime,
                "seed": data["seed"], "drama3": data}
        metadata_path_for(target).write_text(json.dumps(item, ensure_ascii=False), encoding="utf-8")
        return item
    except BaseException:
        target.unlink(missing_ok=True)
        metadata_path_for(target).unlink(missing_ok=True)
        raise
    finally:
        temporary.unlink(missing_ok=True)


async def run_job(job, data):
    terminal = "completed"
    message = "完成"
    runtime_started = False
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=90)) as session:
        try:
            job["message"] = "正在釋放影片模型記憶體…"
            await release_gpu(session, "http://127.0.0.1:8188")
            if job.get("cancel"):
                raise asyncio.CancelledError()
            job["message"] = "正在啟動 Drama3…"
            await start_runtime(session)
            runtime_started = True
            await idle(session, BASE)
            job["message"] = "Drama3 正在處理，首次載入模型需要較長時間…"
            if job["operation"] == "generate":
                outputs = await wait_history(session, dialogue_graph(data, f"H3_Studio_Drama3/{job['id']}"), job)
                audio = outputs.get("5", {}).get("audio", [])
                if not audio:
                    raise RuntimeError("Drama3 沒有產生音訊。")
                job["result"] = await copy_audio(session, audio[0], data, job)
            elif job["operation"] == "previewVoice":
                graph = {"1": node("Drama3LoadVoice", voice=data["voice"]),
                         "2": node("Drama3StudioVoiceCodes", voice=["1", 0]),
                         "3": node("Drama3CodecLoader", codec_name=CODEC),
                         "4": node("Drama3Decode", codec=["3", 0], codes=["2", 0]),
                         "5": node("SaveAudio", audio=["4", 0], filename_prefix=f"H3_Studio_VoicePreview/{job['id']}")}
                outputs = await wait_history(session, graph, job)
                audio = outputs.get("5", {}).get("audio", [])
                if not audio:
                    raise RuntimeError("聲線檔沒有可還原的參考音訊。")
                job["result"] = await copy_audio(session, audio[0], data, job)
            elif job["operation"] == "transcribe":
                graph = {"1": node("LoadAudio", audio=data["reference"]),
                         "2": node("Qwen3ASRLoader", model_name=ASR),
                         "3": node("Qwen3ASRTranscribe", model=["2", 0], audio=["1", 0], language=data["language"], context="", max_new_tokens=1024),
                         "4": node("PreviewAny", source=["3", 0])}
                outputs = await wait_history(session, graph, job)
                text = "\n".join(outputs.get("4", {}).get("text", []))
                job["result"] = {"transcript": text_value(text, "辨識結果", 4000)}
            else:
                prefix = "studio_" + re.sub(r"[^\w-]", "_", data["name"]) + "_" + job["id"][:8]
                graph = {"1": node("LoadAudio", audio=data["reference"]), "2": node("Drama3CodecLoader", codec_name=CODEC),
                         "3": node("Drama3EncodeVoice", codec=["2", 0], audio=["1", 0], transcript=data["transcript"]),
                         "4": node("Drama3SaveVoice", voice=["3", 0], name=prefix)}
                await wait_history(session, graph, job)
                names = [name for name in await voice_names(session) if name.startswith(prefix + "_")]
                if len(names) != 1:
                    raise RuntimeError("聲線已處理，但無法確認保存的檔案。")
                job["result"] = {"voice": names[0]}
        except asyncio.CancelledError:
            terminal, message = "cancelled", "已停止"
        except Exception as error:
            logging.exception("Drama3 Studio job failed")
            terminal, message = "failed", str(error)
        finally:
            if runtime_started:
                try:
                    job["message"] = "正在關閉 Drama3 並釋放記憶體…"
                    await service_action("Stop")
                except Exception as error:
                    logging.exception("Drama3 shutdown failed")
                    terminal, message = "failed", f"{message}；Drama3 記憶體釋放失敗：{error}"
            job.update(status=terminal, message=message)


def list_audio(root):
    items = []
    for path in (root / SUBFOLDER).glob("*.flac"):
        if FILENAME.fullmatch(path.name):
            item = load_metadata(path)
            if item.get("model") == "drama3":
                items.append({**item, "filename": path.name, "subfolder": SUBFOLDER, "type": "output", "kind": "audio", "modifiedAt": path.stat().st_mtime})
    return items


def require_origin(request):
    if request.headers.get("Origin") not in STUDIO_ORIGINS:
        raise web.HTTPForbidden(text="This endpoint is only available from H3 Local Studio")


@web.middleware
async def gpu_admission(request, handler):
    # Serialize admission, including other browser tabs using ComfyUI directly.
    if request.method != "POST" or request.path not in {"/prompt", "/h3-studio/drama3/jobs"}:
        return await handler(request)
    async with GPU_ADMISSION:
        if request.path == "/prompt":
            if active_job():
                return web.json_response({"error": "Drama3 正在使用 GPU，請等候或停止語音工作。"}, status=409)
            try:
                async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
                    try:
                        await idle(session, BASE)
                    except aiohttp.ClientConnectorError:
                        return await handler(request)
                    await require_project_runtime(session)
                    await release_gpu(session, BASE)
            except Exception as error:
                return web.json_response({"error": str(error)}, status=409)
        return await handler(request)


PromptServer.instance.app.middlewares.append(gpu_admission)


@PromptServer.instance.routes.get("/h3-studio/drama3/status")
async def status(_request):
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
            info = await remote(session, "/object_info/Drama3StudioSpeaker")
            if "Drama3StudioSpeaker" not in info:
                raise RuntimeError("請安裝 Drama3 Studio 轉接節點並重新啟動 Drama3。")
            voices = await voice_names(session)
        return web.json_response({"ready": True, "voices": voices, "activeJob": public_job(active_job()) if active_job() else None})
    except aiohttp.ClientConnectorError:
        ready = runtime_installed()
        return web.json_response({"ready": ready, "standby": ready, "voices": local_voice_names() if ready else [],
                                  "error": None if ready else "尚未安裝專案的 Drama3。",
                                  "activeJob": public_job(active_job()) if active_job() else None})
    except Exception as error:
        return web.json_response({"ready": False, "voices": [], "error": str(error), "activeJob": public_job(active_job()) if active_job() else None})


@PromptServer.instance.routes.post("/h3-studio/drama3/jobs")
async def submit(request):
    require_origin(request)
    if active_job():
        return web.json_response({"error": "Drama3 已有工作進行中。"}, status=409)
    try:
        if request.content_length and request.content_length > 100000:
            raise ValueError("設定資料過大。")
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError("設定格式無效。")
        operation = data.get("operation")
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10)) as session:
            try:
                await require_project_runtime(session)
                await idle(session, BASE)
                voices = await voice_names(session)
            except aiohttp.ClientConnectorError:
                if not runtime_installed():
                    raise ValueError("尚未安裝專案的 Drama3。")
                voices = local_voice_names()
            if operation == "generate":
                data = validate_dialogue(data, voices)
            elif operation == "previewVoice":
                if data.get("voice") not in voices:
                    raise ValueError("請選擇已保存的聲線。")
                data = {"voice": data["voice"]}
            elif operation in {"transcribe", "saveVoice"}:
                if not isinstance(data.get("reference"), str) or not REFERENCE.fullmatch(data["reference"]):
                    raise ValueError("請先上傳參考音訊。")
                if operation == "saveVoice":
                    data = {"reference": data["reference"], "name": text_value(data.get("name"), "聲線名稱", 50),
                            "transcript": text_value(data.get("transcript"), "逐字稿", 4000)}
                elif data.get("language") not in {"Chinese", "English", "Japanese", "Cantonese", "Korean"}:
                    raise ValueError("請選擇辨識語言。")
            else:
                raise ValueError("不支援的 Drama3 操作。")
        # Recheck after network awaits so two tabs cannot claim the GPU together.
        if active_job() or PromptServer.instance.prompt_queue.get_tasks_remaining():
            raise RuntimeError("GPU 仍有其他工作，請稍後重試。")
        job = {"id": uuid.uuid4().hex, "operation": operation, "status": "running", "message": "正在準備…"}
        JOBS[job["id"]] = job
        for key in list(JOBS)[:-100]:
            if JOBS[key]["status"] not in {"running", "cancelling"}:
                del JOBS[key]
        task = asyncio.create_task(run_job(job, data))
        TASKS.add(task)
        task.add_done_callback(TASKS.discard)
        return web.json_response(public_job(job))
    except (ValueError, json.JSONDecodeError) as error:
        return web.json_response({"error": str(error)}, status=400)
    except Exception as error:
        return web.json_response({"error": str(error)}, status=503)


@PromptServer.instance.routes.get("/h3-studio/drama3/jobs/{job_id}")
async def job_status(request):
    job = JOBS.get(request.match_info["job_id"])
    return web.json_response(public_job(job)) if job else web.json_response({"error": "找不到工作；Studio 後端可能已重新啟動。"}, status=404)


@PromptServer.instance.routes.post("/h3-studio/drama3/jobs/{job_id}/cancel")
async def cancel(request):
    require_origin(request)
    job = JOBS.get(request.match_info["job_id"])
    if not job:
        return web.json_response({"error": "找不到工作。"}, status=404)
    if job["status"] in {"running", "cancelling"}:
        job.update(cancel=True, status="cancelling", message="正在停止並釋放模型…")
    return web.json_response(public_job(job))


def normalize_reference(source, output):
    result = subprocess.run([shutil.which("ffprobe") or "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(source)],
                            capture_output=True, text=True, timeout=30, check=True)
    duration = float(json.loads(result.stdout)["format"]["duration"])
    if not math.isfinite(duration) or not 1 <= duration <= 30:
        raise ValueError("參考音訊請使用 1～30 秒的單人清晰語音。")
    subprocess.run([shutil.which("ffmpeg") or "ffmpeg", "-v", "error", "-nostdin", "-i", str(source), "-vn", "-ac", "1", "-ar", "44100", "-y", str(output)],
                   capture_output=True, timeout=60, check=True)


@PromptServer.instance.routes.post("/h3-studio/drama3/upload")
async def upload(request):
    require_origin(request)
    try:
        reader = await request.multipart()
        part = await reader.next()
        if part is None or part.name != "audio" or Path(part.filename or "").suffix.lower() not in {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".webm"}:
            raise ValueError("請上傳 WAV、MP3、FLAC、M4A、OGG 或 WebM 音訊。")
        with tempfile.TemporaryDirectory(prefix="h3_drama3_") as temp:
            source = Path(temp) / ("reference" + Path(part.filename).suffix.lower())
            size = 0
            with source.open("wb") as handle:
                while chunk := await part.read_chunk():
                    size += len(chunk)
                    if size > MAX_AUDIO_BYTES:
                        raise ValueError("音訊上限為 32 MB。")
                    handle.write(chunk)
            target = Path(temp) / f"H3_Drama3_ref_{uuid.uuid4().hex}.wav"
            await asyncio.to_thread(normalize_reference, source, target)
            if not runtime_installed():
                raise ValueError("尚未安裝專案的 Drama3。")
            destination = RUNTIME_ROOT / "input" / target.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            await asyncio.to_thread(shutil.copyfile, target, destination)
        return web.json_response({"reference": target.name})
    except (ValueError, subprocess.SubprocessError, KeyError) as error:
        return web.json_response({"error": str(error)}, status=400)
    except Exception as error:
        return web.json_response({"error": str(error)}, status=503)


@PromptServer.instance.routes.get("/h3-studio/drama3/download")
async def download(request):
    name = request.query.get("filename", "")
    if not FILENAME.fullmatch(name):
        raise web.HTTPBadRequest(text="Invalid Drama3 output")
    path = Path(folder_paths.get_output_directory()) / SUBFOLDER / name
    if not path.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={"Content-Type": "audio/flac", "Content-Disposition": f'attachment; filename="{name}"'})


@PromptServer.instance.routes.post("/h3-studio/drama3/voices/open-folder")
async def open_voice_folder(request):
    require_origin(request)
    try:
        data = await request.json()
        if not isinstance(data, dict) or data.get("voice") not in local_voice_names():
            raise ValueError("請選擇已保存的聲線。")
        folder = (RUNTIME_ROOT / "output/drama3_voices" / data["voice"]).resolve().parent
        os.startfile(str(folder))
        return web.json_response({"folder": str(folder)})
    except ValueError as error:
        return web.json_response({"error": str(error)}, status=400)
    except Exception as error:
        return web.json_response({"error": str(error)}, status=503)


@PromptServer.instance.routes.get("/h3-studio/drama3/voices/preview/{key}")
async def voice_preview(request):
    key = request.match_info["key"]
    if not re.fullmatch(r"[0-9a-f]{32}", key):
        raise web.HTTPBadRequest(text="Invalid voice preview")
    path = Path(folder_paths.get_output_directory()) / PREVIEW_SUBFOLDER / f"H3_Drama3_{key}.flac"
    if not path.is_file():
        raise web.HTTPNotFound(text="找不到聲線試聽音訊，請重新試聽。")
    return web.FileResponse(path, headers={"Content-Type": "audio/flac"})
