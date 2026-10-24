"""Independent VOSR 2.0 1x video experiment; leaves Studio workflows unchanged."""
import importlib.util
import json
import logging
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "ComfyUI/output/video/Singularity_V2_Test_text-4_00001_.mp4"
OUTPUT = ROOT / "work/vosr-1x"
OUTPUT.mkdir(parents=True, exist_ok=True)
FRAMES = OUTPUT / "refined"
FRAMES.mkdir(exist_ok=True)
sys.path.insert(0, str(ROOT / "ComfyUI"))
sys.argv = [sys.argv[0]]
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")

import cv2
import numpy as np
import torch
from PIL import Image

package = ROOT / "ComfyUI/custom_nodes/ComfyUI-VOSR2"
spec = importlib.util.spec_from_file_location("vosr_video_test", package / "__init__.py", submodule_search_locations=[str(package)])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
from vosr_video_test.loader import load_vosr2
from vosr_video_test.inference import run_vosr2

probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(SOURCE)], text=True))
video = next(s for s in probe["streams"] if s["codec_type"] == "video")
count = int(video["nb_frames"])
settings = dict(upscale=1, seed=42, color_alignment="wavelet", tile_size=512, tile_overlap=64, vae_tile_size=512, vae_tile_overlap=64)
metadata = {"source": str(SOURCE), "node_commit": subprocess.check_output(["git", "-C", str(package), "rev-parse", "HEAD"], text=True).strip(), "dtype": "bf16", "settings": settings, "seed_policy": "fixed 42 independently for every frame", "source_probe": probe}
(OUTPUT / "settings.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
print("Loading model (downloads the missing VOSR2 bundle on first run)", flush=True)
model = load_vosr2("VOSR2", "bf16")
torch.cuda.reset_peak_memory_stats()
started = time.monotonic()
capture = cv2.VideoCapture(str(SOURCE))
try:
    with torch.inference_mode():
        for index in range(count):
            ok, bgr = capture.read()
            if not ok:
                raise RuntimeError(f"Cannot decode source frame {index}")
            frame = torch.from_numpy(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0).unsqueeze(0)
            result = run_vosr2(model, frame, **settings)
            pixels = (result[0].detach().cpu().numpy().clip(0, 1) * 255).round().astype(np.uint8)
            assert pixels.shape == (video["height"], video["width"], 3)
            assert np.isfinite(result.cpu().numpy()).all()
            Image.fromarray(pixels).save(FRAMES / f"{index:06d}.png")
            if index % 8 == 0 or index == count - 1:
                print(f"Frames {index + 1}/{count}, elapsed {time.monotonic() - started:.1f}s", flush=True)
finally:
    capture.release()

target = OUTPUT / "VOSR_1x.mp4"
subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", video["r_frame_rate"], "-i", str(FRAMES / "%06d.png"), "-i", str(SOURCE), "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", str(target)], check=True)
output_probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(target)], text=True))
out_video = next(s for s in output_probe["streams"] if s["codec_type"] == "video")
for field in ("width", "height", "nb_frames", "r_frame_rate"):
    assert out_video[field] == video[field], field
audio_hashes = [subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(p), "-map", "0:a:0", "-c", "copy", "-f", "hash", "-hash", "sha256", "-"], text=True).strip() for p in (SOURCE, target)]
assert audio_hashes[0] == audio_hashes[1], "Audio packets changed"
subprocess.run(["ffmpeg", "-v", "error", "-i", str(target), "-f", "null", "-"], check=True)
metadata.update(output=str(target), seconds=time.monotonic() - started, output_probe=output_probe, audio_hash=audio_hashes[0], peak_cuda_allocated_bytes=torch.cuda.max_memory_allocated(), peak_cuda_reserved_bytes=torch.cuda.max_memory_reserved())
(OUTPUT / "result.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
print("VERIFIED", str(target), flush=True)
