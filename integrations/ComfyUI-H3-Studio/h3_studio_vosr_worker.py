"""VOSR worker: stream frames through a separate, short-lived Python process."""
import argparse
from fractions import Fraction
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def inspect_video(source):
    data = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-show_frames",
        "-show_entries", "stream=width,height,avg_frame_rate,pix_fmt,color_transfer,sample_aspect_ratio:stream_side_data=rotation:frame=best_effort_timestamp_time", "-of", "json", str(source),
    ], timeout=120))
    if not data.get("streams") or not data.get("frames"):
        raise ValueError("來源沒有可讀取的影片畫面。")
    stream = data["streams"][0]
    fps = Fraction(stream["avg_frame_rate"])
    if fps <= 0:
        raise ValueError("無法讀取來源幀率。")
    timestamps = [float(frame["best_effort_timestamp_time"]) for frame in data["frames"]]
    if any(abs((b - a) - float(1 / fps)) > 0.002 for a, b in zip(timestamps, timestamps[1:])):
        raise ValueError("VOSR 第一版支援固定幀率影片；此影片為可變幀率，請先轉成固定幀率。")
    if stream.get("sample_aspect_ratio", "1:1") not in ("1:1", "N/A", "0:1") or any(int(x.get("rotation", 0)) % 360 for x in stream.get("side_data_list", [])):
        raise ValueError("請先將影片旋轉方向與像素比例轉成一般影片，再做 VOSR 精修。")
    if stream.get("color_transfer") in ("smpte2084", "arib-std-b67") or any(x in stream.get("pix_fmt", "") for x in ("10", "12", "16")):
        raise ValueError("VOSR 第一版支援 8-bit SDR 影片，尚不支援 HDR／高位元影片。")
    if stream["width"] % 2 or stream["height"] % 2:
        raise ValueError("VOSR MP4 輸出需要偶數寬高，請先調整來源尺寸。")
    return stream, fps, len(timestamps)


def audio_hash(path):
    probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", str(path)]))
    if not any(s["codec_type"] == "audio" for s in probe["streams"]):
        return None
    return subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-c", "copy", "-f", "hash", "-hash", "sha256", "-"], text=True).strip()


def run(source, output, progress, comfy_root):
    def report(phase, done=0, total=0):
        temporary = progress.with_suffix(".tmp")
        temporary.write_text(json.dumps({"phase": phase, "done": done, "total": total}), encoding="utf-8")
        temporary.replace(progress)

    report("loading")
    stream, fps, count = inspect_video(source)
    width, height = stream["width"], stream["height"]
    sys.path.insert(0, str(comfy_root))
    sys.argv = [sys.argv[0]]
    import numpy as np
    import torch
    package = comfy_root / "custom_nodes/ComfyUI-VOSR2"
    spec = importlib.util.spec_from_file_location("studio_vosr_package", package / "__init__.py", submodule_search_locations=[str(package)])
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    from studio_vosr_package.loader import load_vosr2
    from studio_vosr_package.inference import run_vosr2
    model = load_vosr2("VOSR2", "bf16")
    decoder = encoder = None
    with tempfile.TemporaryFile() as errors:
        try:
            decoder = subprocess.Popen(["ffmpeg", "-v", "error", "-nostdin", "-noautorotate", "-i", str(source), "-map", "0:v:0", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE, stderr=errors)
            encoder = subprocess.Popen(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-video_size", f"{width}x{height}", "-framerate", str(fps), "-i", "-", "-i", str(source), "-map", "0:v:0", "-map", "1:a:0?", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", str(output)], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors)
            with torch.inference_mode():
                for index in range(count):
                    raw = decoder.stdout.read(width * height * 3)
                    if len(raw) != width * height * 3:
                        raise RuntimeError(f"無法完整解碼第 {index + 1} 幀。")
                    pixels = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3).astype(np.float32) / 255
                    result = run_vosr2(model, torch.from_numpy(pixels).unsqueeze(0), 1, 42, "wavelet", 512, 64, 512, 64)
                    if not torch.isfinite(result).all():
                        raise RuntimeError("VOSR 輸出包含無效像素。")
                    frame = (result[0].cpu().numpy().clip(0, 1) * 255).round().astype(np.uint8)
                    if frame.shape != (height, width, 3):
                        raise RuntimeError("VOSR 輸出尺寸與原片不同。")
                    encoder.stdin.write(frame.tobytes())
                    report("processing", index + 1, count)
            if decoder.stdout.read(1):
                raise RuntimeError("來源實際幀數與預檢結果不同。")
            decoder.stdout.close()
            encoder.stdin.close()
            if decoder.wait(timeout=30) or encoder.wait(timeout=60):
                errors.seek(0)
                raise RuntimeError(errors.read().decode("utf-8", errors="replace")[-2000:])
        finally:
            for process in (decoder, encoder):
                if process and process.poll() is None:
                    process.kill()
                    process.wait()
            if decoder and decoder.stdout:
                decoder.stdout.close()
            if encoder and encoder.stdin and not encoder.stdin.closed:
                encoder.stdin.close()
    report("verifying", count, count)
    probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=width,height,avg_frame_rate,nb_read_frames", "-of", "json", str(output)]))["streams"][0]
    if (probe["width"], probe["height"], int(probe["nb_read_frames"]), Fraction(probe["avg_frame_rate"])) != (width, height, count, fps):
        raise RuntimeError("成品尺寸、幀數或幀率驗證失敗。")
    if audio_hash(source) != audio_hash(output):
        raise RuntimeError("成品音軌與原片不同。")
    report("complete", count, count)
    output.with_suffix(".result.json").write_text(json.dumps({"width": width, "height": height, "fps": float(fps), "frames": count, "duration": float(count / fps)}), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("source", "output", "progress", "comfy-root"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    run(args.source, args.output, args.progress, args.comfy_root)
