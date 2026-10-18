import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from aiohttp import web


DIRECTORY = Path(__file__).parent


def load_swap(root):
    package = types.ModuleType("swap_test_package")
    package.__path__ = [str(DIRECTORY)]
    paths = types.ModuleType("folder_paths")
    paths.get_input_directory = lambda: str(root / "input")
    paths.get_output_directory = lambda: str(root / "output")
    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=web.RouteTableDef()))
    api = types.ModuleType("swap_test_package.h3_studio_api")
    api.metadata_path_for = lambda path: path.with_suffix(path.suffix + ".h3.json")

    def resolve(filename, subfolder=""):
        output = (root / "output").resolve()
        target = (output / subfolder / filename).resolve()
        if not target.is_relative_to(output):
            raise ValueError("Invalid output path")
        return target

    api.resolve_output_video = resolve
    with patch.dict(sys.modules, {"swap_test_package": package, "folder_paths": paths, "server": server,
                                  "swap_test_package.h3_studio_api": api}):
        spec = importlib.util.spec_from_file_location("swap_test_package.h3_studio_swap", DIRECTORY / "h3_studio_swap.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg is required")
class SwapTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.swap = load_swap(self.root)
        self.settings = {"mode": "head", "steps": 8, "resolution": "p480", "width": 128, "height": 128,
                         "strength": 1, "seed": 42, "cooldownSeconds": 5, "prompt": "head_swap: reference head"}

    def tearDown(self):
        self.temp.cleanup()

    def test_invalid_settings_and_source_paths(self):
        for patch_data in ({"steps": 7}, {"steps": True}, {"mode": "other"}, {"width": 129},
                           {"strength": float("nan")}, {"seed": -1}, {"cooldownSeconds": 0}):
            with self.assertRaises(ValueError):
                self.swap.validate_settings({**self.settings, **patch_data})
        for source_id in ("../outside", "z" * 32, None):
            with self.assertRaises(ValueError):
                self.swap.source_folder(source_id)

    def test_akatz_settings_and_metadata_survive_prepare_and_finish(self):
        settings = {**self.settings, "mode": "akatz-v1.5", "steps": 20, "prompt": "Replace the person in <Video 1> with <Picture 1>."}
        self.assertEqual(self.swap.validate_settings(settings), {**settings, "target": ""})
        for steps in (4, 6, 8):
            with self.assertRaisesRegex(ValueError, "20"):
                self.swap.validate_settings({**settings, "steps": steps})
        folder = self.swap.source_folder("b" * 32)
        folder.mkdir(parents=True)
        source = folder / "video.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=128x128:rate=24",
                        "-t", "1", "-c:v", "libx264", str(source)], check=True)
        reference = folder / "reference.png"
        from PIL import Image
        Image.new("RGB", (128, 128)).save(reference)
        self.swap.prepare_segments(folder, source, reference, settings, "akatz_source.mp4")
        raw = self.root / "output/h3_swap_cache" / f"{'b' * 32}_seg0_00001_.mp4"
        raw.parent.mkdir(parents=True)
        shutil.copyfile(folder / "guide_0.mp4", raw)
        result = self.swap.finish_segments("b" * 32, [{"filename": raw.name, "subfolder": "h3_swap_cache"}], 12)
        metadata = json.loads((self.root / "output/video" / result["filename"]).with_suffix(".mp4.h3.json").read_text(encoding="utf-8"))
        for key, value in {"swapMode": "akatz-v1.5", "steps": 20, "profile": "quality", "swapStrength": 1, "prompt": settings["prompt"], "sound": False}.items():
            self.assertEqual(metadata[key], value)
        self.assertEqual(metadata["swapReferenceFile"], f"h3_swap/{'b' * 32}/reference.png")

    def test_segments_partial_output_audio_and_exact_display_aspect(self):
        folder = self.swap.source_folder("a" * 32)
        folder.mkdir(parents=True)
        source = folder / "video.mp4"
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30",
                        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "5.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source)], check=True)
        reference = folder / "reference.png"
        from PIL import Image
        Image.new("RGB", (128, 128)).save(reference)
        whole = self.swap.prepare_segments(folder, source, reference, self.settings, "source.mp4")
        self.assertEqual([(s["keepFrames"], s["length"]) for s in whole["segments"]], [(130, 141)])
        self.assertAlmostEqual(self.swap.probe_video(folder / "guide_0.mp4")["duration"], 141 / 24, places=2)
        # Shrink the segment limit so a short clip exercises multi-segment assembly.
        with patch.object(self.swap, "SEGMENT_FRAMES", 124):
            info = self.swap.prepare_segments(folder, source, reference, self.settings, "source.mp4")
        self.assertEqual([(s["keepFrames"], s["length"]) for s in info["segments"]], [(124, 124), (6, 22)])
        self.assertAlmostEqual(self.swap.probe_video(folder / "guide_1.mp4")["duration"], 22 / 24, places=2)
        cache = self.root / "output/h3_swap_cache"
        cache.mkdir(parents=True)
        raw = cache / f"{'a' * 32}_seg0_00001_.mp4"
        shutil.copyfile(folder / "guide_0.mp4", raw)
        item = {"filename": raw.name, "subfolder": "h3_swap_cache", "type": "output"}
        result = self.swap.finish_segments("a" * 32, [item], 12)
        self.assertEqual(result["swapCompletedSegments"], 1)
        self.assertEqual(result["swapTotalSegments"], 2)
        self.assertTrue(result["sound"])
        self.assertEqual(result["profile"], "cooled-turbo-8")
        output = self.root / "output/video" / result["filename"]
        probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-of", "json", str(output)]))
        video = next(s for s in probe["streams"] if s["codec_type"] == "video")
        self.assertEqual(video["display_aspect_ratio"], "16:9")
        self.assertAlmostEqual(float(video["duration"]), 124 / 24, places=2)
        self.assertTrue(any(s["codec_type"] == "audio" for s in probe["streams"]))
        self.assertTrue(output.with_suffix(".mp4.h3.json").is_file())
        with self.assertRaises(ValueError):
            self.swap.finish_segments("a" * 32, [{**item, "filename": "other_seg0_00001_.mp4"}], 1)
        raw_second = cache / f"{'a' * 32}_seg1_00001_.mp4"
        shutil.copyfile(folder / "guide_1.mp4", raw_second)
        complete = self.swap.finish_segments("a" * 32, [item, {**item, "filename": raw_second.name}], 13)
        self.assertEqual(complete["swapCompletedSegments"], 2)
        self.assertAlmostEqual(complete["duration"], info["duration"], places=3)
        self.assertAlmostEqual(self.swap.probe_video(self.root / "output/video" / complete["filename"])["duration"], info["duration"], delta=0.05)

    def test_guide_length_snaps_to_h3_grid(self):
        self.assertEqual([self.swap.guide_length(n) for n in (1, 5, 6, 124, 360)], [5, 5, 22, 124, 362])

    def test_anamorphic_and_rotated_sources_use_display_aspect(self):
        for rotation, height, expected in [(0, 480, "9:8"), (90, 720, "8:9")]:
            stream = {"width": 720, "height": 480, "sample_aspect_ratio": "3:4", "side_data_list": [{"rotation": rotation}]}
            result = types.SimpleNamespace(stdout=json.dumps({"streams": [stream]}))
            with patch.object(self.swap, "probe_video", return_value={"width": 720, "height": height}), patch.object(self.swap.subprocess, "run", return_value=result):
                info = self.swap.probe_source("source.mp4")
            self.assertEqual(info["displayAspect"], expected)


if __name__ == "__main__":
    unittest.main()
