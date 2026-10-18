import importlib.util
import json
import math
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from aiohttp import web


def import_face(root):
    package = types.ModuleType("face_test")
    package.__path__ = []
    api = types.ModuleType("face_test.h3_studio_api")
    api.metadata_path_for = lambda p: p.with_suffix(p.suffix + ".h3.json")
    api.load_metadata = lambda p: json.loads(api.metadata_path_for(p).read_text(encoding="utf-8")) if api.metadata_path_for(p).is_file() else {}

    def resolve(filename, subfolder=""):
        path = (root / "output" / subfolder / filename).resolve()
        if not path.is_relative_to((root / "output").resolve()):
            raise ValueError("outside output")
        return path

    api.resolve_output_video = resolve
    api.resolve_input_image = lambda filename: root / "input" / filename
    paths = types.ModuleType("folder_paths")
    paths.get_input_directory = lambda: str(root / "input")
    paths.models_dir = str(root / "models")
    enhance = types.ModuleType("face_test.h3_studio_enhance")
    enhance.run_ffmpeg = lambda args: subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", *args], check=True, capture_output=True)
    enhance.probe_video = lambda path: {"width": 320, "height": 240, "duration": 1, "sound": True}
    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=web.RouteTableDef()))
    mappings = types.ModuleType("nodes")
    mappings.NODE_CLASS_MAPPINGS = {}
    modules = {"face_test": package, "face_test.h3_studio_api": api, "face_test.h3_studio_enhance": enhance,
               "folder_paths": paths, "server": server, "nodes": mappings}
    with patch.dict(sys.modules, modules):
        spec = importlib.util.spec_from_file_location("face_test.face", Path(__file__).with_name("h3_studio_face.py"))
        face = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(face)
    return face


def import_multi(face):
    package = types.ModuleType("face_test")
    package.__path__ = []
    with patch.dict(sys.modules, {"face_test": package, "face_test.h3_studio_face": face, "nodes": face.nodes, "folder_paths": face.folder_paths}):
        spec = importlib.util.spec_from_file_location("face_test.multi", Path(__file__).with_name("h3_studio_face_multi.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


class FaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.face = import_face(self.root)
        self.settings = {"select": "largest_face", "strength": 0.3, "referenceIndex": 0}

    def test_skipped_shots_are_removed_from_conditioning_audio_in_frame_order(self):
        import torch
        wave = torch.arange(40).reshape(1, 1, 40).float()
        audio = {"waveform": wave, "sample_rate": 240}
        result, = self.face.H3StudioFaceAudio().align(audio, {"source": [1, 3], "boxes": [None, None]})
        self.assertTrue(torch.equal(result["waveform"], torch.cat([wave[..., 10:20], wave[..., 30:40]], dim=-1)))
        unchanged, = self.face.H3StudioFaceAudio().align(audio, {"source": [0, 1, 2, 3], "boxes": [None] * 4})
        self.assertTrue(torch.equal(unchanged["waveform"], wave))

    def test_unlock_preserves_video_mask_and_samples_without_mutating_native_input(self):
        import torch
        # Use the actual ComfyUI nested tensor implementation, without loading models.
        comfy_root = Path(__file__).resolve().parents[2] / "ComfyUI"
        with patch.object(sys, "path", [str(comfy_root), *sys.path]):
            import comfy.nested_tensor
        video_mask = torch.full((1, 16, 3, 2, 2), 0.35)
        audio_mask = torch.zeros(1, 8, 8)
        samples = comfy.nested_tensor.NestedTensor((torch.zeros_like(video_mask), torch.zeros_like(audio_mask)))
        original = {"samples": samples, "noise_mask": comfy.nested_tensor.NestedTensor((video_mask, audio_mask))}
        result, = self.face.H3StudioFaceUnlockAudio().unlock(original)
        self.assertTrue(torch.equal(result["noise_mask"].unbind()[0], video_mask))
        self.assertTrue(torch.all(result["noise_mask"].unbind()[1] == 1))
        self.assertTrue(torch.all(original["noise_mask"].unbind()[1] == 0))
        self.assertIs(result["samples"], samples)

    def test_legacy_defaults_and_fast_mode_validation(self):
        self.assertEqual(self.face.validate_settings(self.settings)["mode"], "native-20")
        self.assertEqual(self.face.validate_settings({**self.settings, "mode": "turbo-8"})["mode"], "turbo-8")
        with self.assertRaises(ValueError): self.face.validate_settings({**self.settings, "mode": "turbo-4"})

    def test_distinct_tracks_include_later_arrivals_and_restart_at_cuts(self):
        multi = import_multi(self.face)
        a, b, c = [10, 10, 30, 40], [100, 10, 120, 40], [200, 10, 220, 40]
        boxes = [[a, b] for _ in range(5)] + [[a, b, c] for _ in range(4)] + [[a] for _ in range(4)]
        tracks = multi.face_tracks(boxes, [(0, 9), (9, 13)])
        self.assertEqual(len(tracks), 4)
        self.assertEqual([len(track["boxes"]) for track in tracks], [9, 9, 4, 4])
        self.assertEqual([track["shot"] for track in tracks], [0, 0, 0, 1])
        for frame in range(len(boxes)):
            assigned = [tuple(track["boxes"][frame]) for track in tracks if frame in track["boxes"]]
            self.assertEqual(len(assigned), len(set(assigned)))
        self.assertEqual(multi.face_tracks([[a], [], []], [(0, 3)]), [])

    def test_multi_preparation_keeps_distinct_original_faces_and_source_loader_reuses_selection(self):
        import cv2
        import numpy as np
        import torch

        multi = import_multi(self.face)
        source = self.root / "output/video/source.mp4"
        source.parent.mkdir(parents=True)
        writer = cv2.VideoWriter(str(source), cv2.VideoWriter_fourcc(*"mp4v"), 24, (64, 32))
        for frame in range(6):
            image = np.zeros((32, 64, 3), dtype=np.uint8)
            image[8:24, 8:24, 2] = 220
            image[8:24, 40:56, 0] = 220
            if frame == 3:
                image[8:24:2, 8:24:2, 1] = 200
            writer.write(image)
        writer.release()
        sid = "b" * 32
        self.face.manifest_path(sid).parent.mkdir(parents=True)
        prepared = {"sourceId": sid, "videoPath": str(source), "source": {"filename": source.name, "subfolder": "video"},
                    "frames": 6, "width": 64, "height": 32, "sound": False, "settings": {**self.settings, "select": "all_faces"}}
        picker = types.ModuleType("multi_native.picker_api")
        picker._CACHE = {"data": {"path": str(source), "all_boxes": [[[8, 8, 24, 24], [40, 8, 56, 24]]] * 6, "segs": [(0, 6)]}}
        multi.scan = lambda value: {"shots": [{"faces": 2}]}
        loaded_paths = []
        def load_video(path):
            loaded_paths.append(path)
            return torch.zeros(6, 32, 64, 3), None, 24
        multi.face_module = lambda: types.SimpleNamespace(__package__="multi_native", _load_video_components=load_video)
        with patch.dict(sys.modules, {"multi_native.picker_api": picker}):
            result = multi.prepare_people(prepared)
        self.assertEqual(len(result["targets"]), 2)
        self.assertEqual(result["targets"][0]["referenceFrame"], 3)
        first = cv2.imread(str(self.root / "input" / result["targets"][0]["referenceFile"]))
        second = cv2.imread(str(self.root / "input" / result["targets"][1]["referenceFile"]))
        self.assertGreater(first[..., 2].mean(), first[..., 0].mean())
        self.assertGreater(second[..., 0].mean(), second[..., 2].mean())
        self.assertNotIn("facePick", result["targets"][0])
        saved = json.loads(self.face.manifest_path(sid).read_text(encoding="utf-8"))
        self.assertEqual(saved["targets"][0]["facePick"]["boxes"][0], [[8, 8, 24, 24]])
        previous = self.root / f"output/h3_face_cache/{sid}_person0_00001_.mp4"
        previous.parent.mkdir(parents=True)
        previous.write_bytes(b"cached previous pass")
        images, audio, selection = multi.H3StudioMultiFaceSource().load(sid, 1, json.dumps({"filename": previous.name, "subfolder": "h3_face_cache"}))
        self.assertEqual(loaded_paths[-1], str(previous))
        self.assertEqual(list(images.shape), [6, 32, 64, 3])
        self.assertEqual(selection["boxes"][0], [[40, 8, 56, 24]])
        with self.assertRaises(ValueError): multi.H3StudioMultiFaceSource().load(sid, 1, json.dumps(prepared["source"]))

    def test_missing_turbo_dependency_does_not_disable_native_mode(self):
        detector = self.root / "models/ultralytics/bbox/face_yolov8m.pt"
        detector.parent.mkdir(parents=True)
        detector.touch()
        required = [*self.face.FACE_NODES, "MiniMaxH3TurboLoRA", "MiniMaxH3TurboSampler", "H3CooledTurboSampler", "H3StudioFaceUnlockAudio"]
        self.face.nodes.NODE_CLASS_MAPPINGS = dict.fromkeys(required, object)
        self.face.folder_paths.get_full_path = lambda kind, name: None if kind == "loras" else name
        self.assertTrue(self.face.readiness("native-20")["ready"])
        fast = self.face.readiness("turbo-8")
        self.assertFalse(fast["ready"])
        self.assertEqual(fast["missing"], ["minimax_h3_turbo_v4_step600_ema.safetensors"])

    def test_invalid_settings_and_cache_traversal_fail(self):
        for value in [None, {}, {"strength": math.nan}, {"strength": True}, {"strength": 0.5}, {"referenceIndex": True}, {"referenceIndex": -1}, {"select": "all"}]:
            if value == {}:
                continue
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.face.validate_settings(value)
        for source_id in ["../outside", "A" * 32, None, "a" * 31]:
            with self.assertRaises(ValueError): self.face.manifest_path(source_id)

    def test_prepare_requires_valid_reference_and_24fps_without_touching_original(self):
        source = self.root / "output/video/source.mp4"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"original")
        ref = self.root / "input/person.png"
        ref.parent.mkdir(parents=True)
        ref.write_bytes(b"image")
        source.with_suffix(".mp4.h3.json").write_text(json.dumps({"referenceFiles": ["person.png"]}))
        capture = types.SimpleNamespace(get=lambda key: 24 if key == 5 else 24, release=lambda: None)
        with patch.object(self.face, "readiness", return_value={"ready": True}), patch("cv2.VideoCapture", return_value=capture):
            prepared = self.face.prepare({"filename": "source.mp4", "subfolder": "video"}, self.settings)
            self.assertEqual(prepared["referenceFile"], "person.png")
            self.assertEqual(source.read_bytes(), b"original")
            with self.assertRaises(ValueError): self.face.prepare({"filename": "source.mp4", "subfolder": "video"}, {**self.settings, "referenceIndex": 1})
        capture.get = lambda key: 96 if key == 5 else 96
        with patch.object(self.face, "readiness", return_value={"ready": True}), patch("cv2.VideoCapture", return_value=capture), self.assertRaisesRegex(ValueError, "24fps"):
            self.face.prepare({"filename": "source.mp4", "subfolder": "video"}, self.settings)

    def test_finish_preserves_exact_audio_packets_and_source_and_disables_continuation(self):
        source_id = "a" * 32
        source = self.root / "output/video/source.mp4"
        cache = self.root / f"output/h3_face_cache/{source_id}_00001_.mp4"
        source.parent.mkdir(parents=True)
        cache.parent.mkdir(parents=True)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=blue:size=320x240:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1", "-c:v", "libx264", "-c:a", "aac", str(source)], check=True)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(source), "-an", "-c:v", "copy", str(cache)], check=True)
        original = source.read_bytes()
        metadata = {"chainId": "chain", "clipIndex": 1, "latentPath": "h3_context/chain", "referenceFiles": ["person.png"], "inputMode": "reference"}
        self.face.metadata_path_for(source).write_text(json.dumps(metadata))
        manifest = self.face.manifest_path(source_id)
        manifest.parent.mkdir(parents=True)
        manifest.write_text(json.dumps({"source": {"filename": "source.mp4", "subfolder": "video"}, "settings": self.settings, "width": 320, "height": 240, "frames": 24, "sound": True, "referenceFile": "person.png"}))
        raw = {"filename": cache.name, "subfolder": "h3_face_cache"}
        for wrong in [{**raw, "subfolder": "video"}, {**raw, "filename": "wrong.mp4"}]:
            with self.assertRaises(ValueError): self.face.finish(source_id, wrong, self.settings, [0], 1)
        result = self.face.finish(source_id, raw, self.settings, [0], 1)
        output = source.parent / result["filename"]
        def audio_hash(path):
            return subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-c", "copy", "-f", "hash", "-hash", "sha256", "-"])
        self.assertEqual(audio_hash(source), audio_hash(output))
        self.assertEqual(source.read_bytes(), original)
        self.assertFalse(result["extendable"])
        self.assertNotIn("latentPath", result)
        self.assertEqual(result["referenceFiles"], ["person.png"])
        self.assertEqual(result["faceRefineSteps"], 20)
        fast_settings = {**self.settings, "mode": "turbo-8"}
        manifest_data = json.loads(manifest.read_text())
        manifest_data["settings"] = fast_settings
        manifest.write_text(json.dumps(manifest_data))
        fast = self.face.finish(source_id, raw, fast_settings, [0], 1)
        self.assertEqual(fast["faceRefineSteps"], 8)
        self.assertEqual(fast["faceRefine"]["mode"], "turbo-8")
        self.assertEqual(audio_hash(source), audio_hash(source.parent / fast["filename"]))
        people_settings = {**fast_settings, "select": "all_faces"}
        manifest_data["settings"] = people_settings
        manifest_data["targets"] = [{"referenceFile": "one.png"}, {"referenceFile": "two.png"}]
        manifest.write_text(json.dumps(manifest_data))
        person_zero = cache.parent / f"{source_id}_person0_00001_.mp4"
        shutil.copyfile(cache, person_zero)
        raw_zero = {"filename": person_zero.name, "subfolder": "h3_face_cache"}
        with self.assertRaises(ValueError): self.face.finish(source_id, raw_zero, people_settings, None, 1, 2)
        partial = self.face.finish(source_id, raw_zero, people_settings, None, 1, 1)
        self.assertEqual(partial["faceRefinePeopleCompleted"], 1)
        self.assertEqual(partial["faceRefinePeopleTotal"], 2)
        self.assertEqual(partial["faceRefineReferences"], ["one.png"])
        self.assertEqual(audio_hash(source), audio_hash(source.parent / partial["filename"]))


if __name__ == "__main__":
    unittest.main()
