"""Track distinct faces per shot and preserve their original selection across passes."""

import importlib
import json
from pathlib import Path
import shutil
import subprocess

import nodes
import folder_paths

from .h3_studio_face import manifest_path, source_path, scan


def face_module():
    return importlib.import_module(nodes.NODE_CLASS_MAPPINGS["H3FaceSelect"].__module__)


def face_tracks(boxes, segments):
    """One-to-one continuity matching; tracks never cross a shot boundary."""
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    result = []
    for shot, (start, end) in enumerate(segments):
        tracks = []
        for frame in range(start, end):
            current = boxes[frame]
            active = [track for track in tracks if frame - track["last"] <= 12]
            costs = np.full((len(active), len(current)), 1000.0)
            for i, track in enumerate(active):
                old = track["boxes"][track["last"]]
                height = max(1.0, old[3] - old[1])
                for j, box in enumerate(current):
                    size = max(1.0, box[3] - box[1]) / height
                    distance = (((box[0] + box[2] - old[0] - old[2]) / 2) ** 2 +
                                ((box[1] + box[3] - old[1] - old[3]) / 2) ** 2) ** 0.5 / height
                    if 0.5 <= size <= 2 and distance <= 0.8 + 0.08 * (frame - track["last"]):
                        costs[i, j] = distance + abs(float(np.log(size)))
            matched = set()
            if costs.size:
                rows, cols = linear_sum_assignment(costs)
                for i, j in zip(rows, cols):
                    if costs[i, j] >= 1000:
                        continue
                    track = active[i]
                    track["boxes"][frame] = current[j]
                    track["last"] = frame
                    matched.add(j)
            for j, box in enumerate(current):
                if j not in matched:
                    tracks.append({"shot": shot, "segment": [start, end], "last": frame, "boxes": {frame: box}})
        result.extend(track for track in tracks if len(track["boxes"]) >= 3)
    return result


def prepare_people(prepared):
    import cv2

    native = face_module()
    picker = importlib.import_module(native.__package__ + ".picker_api")
    preview = scan(prepared)
    detections = picker._CACHE["data"]
    if detections["path"] != prepared["videoPath"]:
        raise ValueError("偵測來源已改變，請重新偵測人物。")
    tracks = face_tracks(detections["all_boxes"], detections["segs"])
    if not tracks:
        raise ValueError("沒有可連續追蹤至少 3 幀的人臉，請改用單人模式預覽選臉。")
    capture = cv2.VideoCapture(prepared["videoPath"])
    targets = []
    try:
        for number, track in enumerate(tracks):
            best = None
            for frame in sorted(track["boxes"], key=lambda f: track["boxes"][f][3] - track["boxes"][f][1], reverse=True)[:12]:
                capture.set(cv2.CAP_PROP_POS_FRAMES, frame)
                ok, image = capture.read()
                if not ok:
                    continue
                x0, y0, x1, y1 = track["boxes"][frame]
                margin = (y1 - y0) * 0.15
                left, top = max(0, int(x0 - margin)), max(0, int(y0 - margin))
                right, bottom = min(image.shape[1], int(x1 + margin)), min(image.shape[0], int(y1 + margin))
                crop = image[top:bottom, left:right]
                if crop.size == 0:
                    continue
                face = image[max(0, int(y0)):min(image.shape[0], int(y1)), max(0, int(x0)):min(image.shape[1], int(x1))]
                if face.size == 0:
                    continue
                score = float(cv2.Laplacian(cv2.cvtColor(face, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()) * max(1, y1 - y0)
                if best is None or score > best[0]:
                    best = (score, frame, crop)
            if best is None:
                raise ValueError("無法擷取人物參考圖，請重新偵測。")
            reference = f"h3_face/{prepared['sourceId']}_person{number}.png"
            if not cv2.imwrite(str(Path(folder_paths.get_input_directory()) / reference), best[2]):
                raise ValueError("無法保存人物參考圖。")
            target_boxes = [[track["boxes"][f]] if f in track["boxes"] else [] for f in range(prepared["frames"])]
            picks = [{"segment": [a, b], "frame": best[1] if shot == track["shot"] else -1,
                      "box": 0, "index": 0, "absent": shot != track["shot"]}
                     for shot, (a, b) in enumerate(detections["segs"])]
            targets.append({"index": number, "label": f"鏡頭 {track['shot'] + 1} · 人物組 {number + 1}", "referenceFile": reference, "referenceFrame": best[1],
                            "facePick": {"version": 1, "frames": prepared["frames"], "src_size": [prepared["width"], prepared["height"]],
                                         "boxes": target_boxes, "confs": [[1.0] if b else [] for b in target_boxes],
                                         "segments": detections["segs"], "picks": picks, "detector": "face_yolov8m.pt", "confidence": 0.25}})
    finally:
        capture.release()
    saved = {**prepared, "targets": targets}
    manifest_path(prepared["sourceId"]).write_text(json.dumps(saved, ensure_ascii=False), encoding="utf-8")
    return {**prepared, "preview": preview, "targets": [{k: v for k, v in target.items() if k != "facePick"} for target in targets]}


class H3StudioMultiFaceSource:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"source_id": ("STRING",), "target_index": ("INT", {"default": 0, "min": 0}), "source": ("STRING",)}}

    RETURN_TYPES = ("IMAGE", "AUDIO", "H3FACEPICK")
    FUNCTION = "load"
    CATEGORY = "H3 Studio"

    def load(self, source_id, target_index, source):
        import numpy as np
        import torch

        saved = json.loads(manifest_path(source_id).read_text(encoding="utf-8"))
        target = saved["targets"][target_index]
        current = source_path(json.loads(source))
        if target_index == 0:
            if current != source_path(saved["source"]):
                raise ValueError("第一位人物必須從原片開始修復。")
        elif current.parent.name != "h3_face_cache" or not current.name.startswith(f"{source_id}_person{target_index - 1}_"):
            raise ValueError("逐人修復必須接續上一位人物的成品。")
        images, _, _ = face_module()._load_video_components(str(current))
        if list(images.shape[:3]) != [saved["frames"], saved["height"], saved["width"]]:
            raise ValueError("逐人修復的影格數或尺寸已改變，請重新偵測。")
        audio = {"waveform": torch.zeros(1, 2, 1), "sample_rate": 32000}
        if saved["sound"] and saved["settings"].get("mode", "native-20") != "turbo-8":
            original = source_path(saved["source"])
            decoded = subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-i", str(original), "-vn", "-ac", "2", "-ar", "32000", "-f", "f32le", "pipe:1"], capture_output=True, timeout=60)
            if decoded.returncode:
                raise ValueError("無法載入原片音訊約束。")
            wave = np.frombuffer(decoded.stdout, dtype=np.float32).reshape(-1, 2).T.copy()
            audio = {"waveform": torch.from_numpy(wave).unsqueeze(0), "sample_rate": 32000}
        return images, audio, target["facePick"]
