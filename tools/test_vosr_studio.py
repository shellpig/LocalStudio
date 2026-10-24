"""VOSR input contracts and parent/worker success, failure and interruption."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "integrations/ComfyUI-H3-Studio"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


worker = load("vosr_worker_test", DIRECTORY / "h3_studio_vosr_worker.py")


class VOSRTests(unittest.TestCase):
    def test_probe_keeps_fractional_fps_and_rejects_vfr_rotation_and_hdr(self):
        data = {"streams": [{"width": 608, "height": 352, "avg_frame_rate": "30000/1001", "pix_fmt": "yuv420p", "sample_aspect_ratio": "1:1"}], "frames": [{"best_effort_timestamp_time": str(n * 1001 / 30000)} for n in range(4)]}
        with patch.object(worker.subprocess, "check_output", return_value=json.dumps(data).encode()):
            _, fps, frames = worker.inspect_video("source.mp4")
            self.assertEqual(str(fps), "30000/1001")
            self.assertEqual(frames, 4)
        for mutation, message in ((lambda d: d["frames"][2].update(best_effort_timestamp_time="0.2"), "可變幀率"), (lambda d: d["streams"][0].update(side_data_list=[{"rotation": 90}]), "旋轉"), (lambda d: d["streams"][0].update(color_transfer="smpte2084"), "HDR")):
            changed = json.loads(json.dumps(data)); mutation(changed)
            with patch.object(worker.subprocess, "check_output", return_value=json.dumps(changed).encode()):
                with self.assertRaisesRegex(ValueError, message):
                    worker.inspect_video("source.mp4")

    def test_lifecycle_publishes_only_verified_success_and_cleans_failures(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            package = ModuleType("vosr_backend_test"); package.__path__ = [str(DIRECTORY)]
            api = ModuleType("vosr_backend_test.h3_studio_api")
            api.metadata_path_for = lambda p: p.with_suffix(p.suffix + ".h3.json")
            rtx = ModuleType("vosr_backend_test.h3_studio_rtx")
            def source_folder(value):
                if not isinstance(value, str) or len(value) != 32 or any(x not in "0123456789abcdef" for x in value):
                    raise ValueError("invalid source")
                return root / "input/h3_rtx" / value
            rtx.source_folder = source_folder
            folder_paths = ModuleType("folder_paths")
            folder_paths.base_path = str(root / "ComfyUI")
            folder_paths.get_input_directory = lambda: str(root / "input")
            folder_paths.get_output_directory = lambda: str(root / "output")
            routes = SimpleNamespace(get=lambda *_: lambda f: f, post=lambda *_: lambda f: f)
            server = ModuleType("server"); server.PromptServer = SimpleNamespace(instance=SimpleNamespace(routes=routes))
            comfy = ModuleType("comfy"); comfy.__path__ = []
            mm = ModuleType("comfy.model_management")
            for name in ("unload_all_models", "soft_empty_cache", "throw_exception_if_processing_interrupted"):
                setattr(mm, name, Mock())
            utils = ModuleType("comfy.utils"); utils.ProgressBar = lambda _: SimpleNamespace(update_absolute=Mock())
            comfy.model_management = mm; comfy.utils = utils
            modules = {"vosr_backend_test": package, api.__name__: api, rtx.__name__: rtx, "folder_paths": folder_paths, "server": server, "comfy": comfy, mm.__name__: mm, utils.__name__: utils}
            with patch.dict(sys.modules, modules):
                backend = load("vosr_backend_test.h3_studio_vosr", DIRECTORY / "h3_studio_vosr.py")
                source_id = "a" * 32; folder = source_folder(source_id); folder.mkdir(parents=True)
                source = folder / "source.mp4"; source.write_bytes(b"original")
                (folder / "manifest.json").write_text(json.dumps({"sourceFile": source.name, "sourceName": "original.mp4"}), encoding="utf-8")
                self.assertEqual(backend.prepared_source(source_id)[1], source.resolve())
                with self.assertRaises(ValueError): backend.job_folder("../outside")
                for outcome in ("success", "failure", "interrupt"):
                    process = SimpleNamespace(returncode=None, pid=123)
                    def spawn(command, **kwargs):
                        mm.unload_all_models.assert_called()
                        output = Path(command[command.index("--output") + 1]); output.write_bytes(b"processed")
                        output.with_suffix(".result.json").write_text(json.dumps({"width": 608, "height": 352, "fps": 24, "frames": 124}), encoding="utf-8")
                        process.returncode = 0 if outcome == "success" else 1 if outcome == "failure" else None
                        process.poll = lambda: process.returncode
                        return process
                    def stop(p):
                        if p.returncode is None: p.returncode = -9
                    mm.throw_exception_if_processing_interrupted.side_effect = KeyboardInterrupt if outcome == "interrupt" else None
                    with patch.object(backend, "installation_status", return_value={"ready": True}), patch.object(backend.subprocess, "Popen", side_effect=spawn), patch.object(backend, "stop_worker", side_effect=stop) as stopped, patch.object(backend.time, "sleep"):
                        job_id = {"success": "b", "failure": "c", "interrupt": "d"}[outcome] * 32
                        before = set((root / "output/video").glob("*.mp4"))
                        if outcome == "success":
                            saved = backend.H3StudioVOSR().execute(source_id, job_id)["ui"]["images"][0]
                            self.assertTrue(saved["vosrRefined"])
                            self.assertEqual(saved["vosrSourceId"], source_id)
                            self.assertEqual(saved["vosrSourceName"], "original.mp4")
                        else:
                            with self.assertRaises((RuntimeError, KeyboardInterrupt)):
                                backend.H3StudioVOSR().execute(source_id, job_id)
                            self.assertEqual(set((root / "output/video").glob("*.mp4")), before)
                        stopped.assert_called()
                        self.assertEqual(source.read_bytes(), b"original")
                        self.assertFalse((backend.job_folder(job_id) / "result.mp4").exists())
                        self.assertFalse((backend.job_folder(job_id) / "result.result.json").exists())


if __name__ == "__main__":
    unittest.main()
