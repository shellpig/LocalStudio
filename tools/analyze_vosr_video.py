"""Visual comparisons and motion-compensated diagnostics for the VOSR 1x test."""
import json
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
FOLDER = ROOT / "work/vosr-1x"
result = json.loads((FOLDER / "result.json").read_text(encoding="utf-8"))
capture = cv2.VideoCapture(result["source"])
original, refined = [], []
try:
    for path in sorted((FOLDER / "refined").glob("*.png")):
        ok, frame = capture.read()
        assert ok
        original.append(frame)
        refined.append(cv2.imread(str(path)))
finally:
    capture.release()
assert len(original) == int(result["source_probe"]["streams"][0]["nb_frames"])

# Optical flow is estimated once from the source and applied identically to
# both streams. Residuals include flow errors and detail changes, not just flicker.
h, w = original[0].shape[:2]
xgrid, ygrid = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
metrics = {"source_temporal_mae": [], "vosr_temporal_mae": [], "correction_temporal_mae": [], "head_region_source_temporal_mae": [], "head_region_vosr_temporal_mae": [], "source_edge_variance": [], "vosr_edge_variance": [], "same_frame_mae": []}
for index, (source, output) in enumerate(zip(original, refined)):
    source_gray = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
    metrics["source_edge_variance"].append(float(cv2.Laplacian(source_gray, cv2.CV_32F).var()))
    metrics["vosr_edge_variance"].append(float(cv2.Laplacian(cv2.cvtColor(output, cv2.COLOR_BGR2GRAY), cv2.CV_32F).var()))
    metrics["same_frame_mae"].append(float(np.abs(source.astype(np.float32) - output.astype(np.float32)).mean()))
    if not index:
        continue
    previous_gray = cv2.cvtColor(original[index - 1], cv2.COLOR_BGR2GRAY)
    flow = cv2.calcOpticalFlowFarneback(source_gray, previous_gray, None, 0.5, 3, 21, 3, 5, 1.2, 0)
    mx, my = xgrid + flow[:, :, 0], ygrid + flow[:, :, 1]
    valid = (mx >= 2) & (mx < w - 2) & (my >= 2) & (my < h - 2)
    errors = []
    for frames in (original, refined):
        warped = cv2.remap(frames[index - 1].astype(np.float32), mx, my, cv2.INTER_LINEAR)
        errors.append(frames[index].astype(np.float32) - warped)
    metrics["source_temporal_mae"].append(float(np.abs(errors[0][valid]).mean()))
    metrics["vosr_temporal_mae"].append(float(np.abs(errors[1][valid]).mean()))
    metrics["correction_temporal_mae"].append(float(np.abs((errors[1] - errors[0])[valid]).mean()))
    if index >= 48:
        region = valid & (xgrid >= 280) & (xgrid < 380) & (ygrid >= 40) & (ygrid < 120)
        metrics["head_region_source_temporal_mae"].append(float(np.abs(errors[0][region]).mean()))
        metrics["head_region_vosr_temporal_mae"].append(float(np.abs(errors[1][region]).mean()))

summary = {key: {"mean": float(np.mean(values)), "p95": float(np.percentile(values, 95))} for key, values in metrics.items()}
summary["interpretation_limit"] = "Edge variance measures sharpness, not correctness. Motion-compensated residuals also include flow errors and enhanced details; they are not a perceptual flicker verdict. Source is decoded H264; VOSR metrics use lossless PNGs before re-encoding."
(FOLDER / "metrics.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")

samples = [48, 60, 80, 100]
sheet = Image.new("RGB", (4 * 320, 2 * 350), "#181818")
draw = ImageDraw.Draw(sheet)
for row, frames in enumerate((original, refined)):
    for column, frame in enumerate(samples):
        # Both rows use exactly the same source-coordinate crop and enlargement.
        crop = frames[frame][25:145, 260:380]
        image = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)).resize((320, 320), Image.Resampling.NEAREST)
        sheet.paste(image, (column * 320, row * 350 + 30))
        draw.text((column * 320 + 8, row * 350 + 8), f'{"Original" if row == 0 else "VOSR 1x"} - frame {frame}', fill="white")
sheet.save(FOLDER / "face-comparison.png")

sequence = Image.new("RGB", (6 * 200, 4 * 230), "#181818")
draw = ImageDraw.Draw(sequence)
for stream, frames in enumerate((original, refined)):
    for index, frame in enumerate(range(60, 72)):
        column, row = index % 6, stream * 2 + index // 6
        crop = frames[frame][25:145, 260:380]
        image = Image.fromarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)).resize((200, 200), Image.Resampling.NEAREST)
        sequence.paste(image, (column * 200, row * 230 + 30))
        draw.text((column * 200 + 6, row * 230 + 8), f'{"Original" if stream == 0 else "VOSR 1x"} {frame}', fill="white")
sequence.save(FOLDER / "consecutive-frames.png")

# Compare decoded videos side by side; the source audio is copied unchanged.
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", result["source"], "-i", result["output"], "-filter_complex", "[0:v][1:v]hstack=inputs=2[v]", "-map", "[v]", "-map", "0:a:0?", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-c:a", "copy", str(FOLDER / "comparison-left-original-right-vosr.mp4")], check=True)
print(json.dumps(summary, indent=2))
print("Comparisons saved", FOLDER)
