"""Queue-owned VOSR subprocess lifecycle and progress endpoints."""
import gc
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

from aiohttp import web
import folder_paths
from server import PromptServer

from .h3_studio_api import metadata_path_for
from .h3_studio_rtx import source_folder


def installation_status():
    root = Path(folder_paths.base_path)
    required = [root.parent / ".venv/Scripts/python.exe", root / "custom_nodes/ComfyUI-VOSR2/__init__.py"]
    bundle = root / "models/vosr2/VOSR2"
    required += [bundle / name for name in ("args.json", "checkpoints/ema_model.safetensors", "Qwen-Image-vae-2d/config.json", "Qwen-Image-vae-2d/diffusion_pytorch_model.safetensors", "dinov2_vitl14.safetensors")]
    missing = [str(p.relative_to(root.parent)) for p in required if not p.is_file()]
    return {"ready": not missing, "missing": missing}


def job_folder(job_id):
    # Share the existing UUID validator, but keep VOSR job state separate.
    source_folder(job_id)
    return Path(folder_paths.get_input_directory()) / "h3_vosr" / job_id


def prepared_source(source_id):
    folder = source_folder(source_id)
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    source = (folder / manifest["sourceFile"]).resolve()
    if source.parent != folder.resolve() or not source.is_file():
        raise ValueError("VOSR 原始影片已不存在，請重新選取或上傳。")
    return manifest, source


@PromptServer.instance.routes.get("/h3-studio/vosr/status")
async def status(_request):
    return web.json_response(installation_status())


@PromptServer.instance.routes.post("/h3-studio/vosr/restore")
async def restore(request):
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError("無效的影片來源。")
        manifest, _ = prepared_source(data.get("sourceId"))
        return web.json_response(manifest)
    except (ValueError, OSError, KeyError) as error:
        return web.json_response({"error": str(error)}, status=400)


@PromptServer.instance.routes.get("/h3-studio/vosr/progress/{job_id}")
async def progress(request):
    try:
        path = job_folder(request.match_info["job_id"]) / "progress.json"
        return web.json_response(json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {"phase": "waiting"})
    except (ValueError, OSError) as error:
        return web.json_response({"error": str(error)}, status=400)


def stop_worker(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        process.kill()
    process.wait(timeout=30)


class H3StudioVOSR:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"source_id": ("STRING",), "job_id": ("STRING",)}}

    RETURN_TYPES = ()
    FUNCTION = "execute"
    OUTPUT_NODE = True
    CATEGORY = "H3 Studio"

    @classmethod
    def IS_CHANGED(cls, **_kwargs):
        return float("nan")

    def execute(self, source_id, job_id):
        import comfy.model_management as mm
        import comfy.utils
        ready = installation_status()
        if not ready["ready"]:
            raise ValueError("VOSR 尚未安裝完整：" + ", ".join(ready["missing"]))
        manifest, source = prepared_source(source_id)
        folder = job_folder(job_id)
        folder.mkdir(parents=True, exist_ok=True)
        progress_path = folder / "progress.json"
        progress_path.write_text(json.dumps({"phase": "loading"}), encoding="utf-8")
        temporary = folder / "result.mp4"
        output = Path(folder_paths.get_output_directory()) / "video" / f"H3_Studio_VOSR_1x_{uuid.uuid4().hex[:12]}.mp4"
        output.parent.mkdir(parents=True, exist_ok=True)
        root = Path(folder_paths.base_path)
        started = time.monotonic()
        process = None
        try:
            mm.unload_all_models()
            gc.collect()
            mm.soft_empty_cache()
            with (folder / "worker.log").open("wb") as log:
                process = subprocess.Popen([str(root.parent / ".venv/Scripts/python.exe"), "-u", str(Path(__file__).with_name("h3_studio_vosr_worker.py")), "--source", str(source), "--output", str(temporary), "--progress", str(progress_path), "--comfy-root", str(root)], stdout=log, stderr=subprocess.STDOUT, env={**os.environ, "PYTHONIOENCODING": "utf-8"}, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                bar = comfy.utils.ProgressBar(1)
                while process.poll() is None:
                    mm.throw_exception_if_processing_interrupted()
                    state = json.loads(progress_path.read_text(encoding="utf-8"))
                    if state.get("total"):
                        bar.update_absolute(state["done"], state["total"])
                    time.sleep(0.25)
            if process.returncode:
                details = (folder / "worker.log").read_text(encoding="utf-8", errors="replace")
                raise RuntimeError("VOSR 精修失敗：" + details[-1800:])
            info = json.loads(temporary.with_suffix(".result.json").read_text(encoding="utf-8"))
            metadata = {**info, "kind": "video", "vosrRefined": True, "vosrSourceId": source_id, "vosrSourceName": manifest["sourceName"], "vosrSeed": 42, "extendable": False, "generationSeconds": round(time.monotonic() - started)}
            temporary.replace(output)
            metadata_path_for(output).write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
            return {"ui": {"images": [{"filename": output.name, "subfolder": "video", "type": "output", **metadata}]}}
        except BaseException:
            if process is not None:
                stop_worker(process)
            progress_path.write_text(json.dumps({"phase": "failed"}), encoding="utf-8")
            output.unlink(missing_ok=True)
            metadata_path_for(output).unlink(missing_ok=True)
            raise
        finally:
            if process is not None:
                stop_worker(process)
            temporary.unlink(missing_ok=True)
            temporary.with_suffix(".result.json").unlink(missing_ok=True)
