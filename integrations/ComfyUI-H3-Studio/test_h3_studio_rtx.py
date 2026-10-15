import importlib.util
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

from aiohttp import web


class RTXTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        package = types.ModuleType("rtx_test")
        package.__path__ = []
        paths = types.ModuleType("folder_paths")
        paths.get_input_directory = lambda: str(self.root / "input")
        paths.get_output_directory = lambda: str(self.root / "output")
        api = types.ModuleType("rtx_test.h3_studio_api")
        api.metadata_path_for = lambda path: path.with_suffix(path.suffix + ".h3.json")
        api.resolve_output_video = lambda *args: None
        swap = types.ModuleType("rtx_test.h3_studio_swap")
        swap.probe_source = lambda path: {}
        server = types.ModuleType("server")
        server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=web.RouteTableDef()))
        with patch.dict(sys.modules, {"rtx_test": package, "folder_paths": paths, "server": server,
                                     "rtx_test.h3_studio_api": api, "rtx_test.h3_studio_swap": swap}):
            spec = importlib.util.spec_from_file_location("rtx_test.rtx", Path(__file__).with_name("h3_studio_rtx.py"))
            self.rtx = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.rtx)

    def tearDown(self):
        self.temp.cleanup()

    def test_settings_paths_and_geometry(self):
        for operation, multiplier in (("fps", True), ("fps", 1), ("fps", 17), ("fps", 2.5), ("upscale", 5), ("other", 2)):
            with self.assertRaises(ValueError):
                self.rtx.validate_settings(operation, multiplier)
        for source in (None, "../outside", "z" * 32):
            with self.assertRaises(ValueError):
                self.rtx.source_folder(source)
        self.assertEqual(self.rtx.output_geometry({"width": 480, "height": 640}, "fps", 16), (480, 640))
        self.assertEqual(self.rtx.output_geometry({"width": 480, "height": 640}, "upscale", 2), (960, 1280))
        self.assertEqual(self.rtx.output_geometry({"width": 854, "height": 480}, "upscale", 3), (2560, 1440))
        with self.assertRaises(ValueError):
            self.rtx.output_geometry({"width": 3840, "height": 2160}, "upscale", 4)

    def test_sdk_failure_removes_partial_output_and_metadata(self):
        import json
        folder = self.rtx.source_folder("a" * 32)
        folder.mkdir(parents=True)
        (folder / "manifest.json").write_text(json.dumps({"sourceFile": "source.mp4", "sourceName": "test.mp4"}), encoding="utf-8")

        def fail(source, output, operation, multiplier):
            output.write_bytes(b"partial")
            raise ValueError("SDK failed")

        with patch.object(self.rtx, "process_video", side_effect=fail):
            with self.assertRaisesRegex(ValueError, "SDK failed"):
                self.rtx.H3StudioRTX().execute("a" * 32, "upscale", 2)
        self.assertEqual(list((self.root / "output" / "video").iterdir()), [])


if __name__ == "__main__":
    unittest.main()
