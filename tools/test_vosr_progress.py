"""Exercise the real worker report function under Windows sharing locks."""
import ast
import ctypes
from ctypes import wintypes
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

DIRECTORY = Path(__file__).resolve().parents[1] / "integrations/ComfyUI-H3-Studio"
sys.path.insert(0, str(DIRECTORY))
spec = importlib.util.spec_from_file_location("vosr_progress_worker_test", DIRECTORY / "h3_studio_vosr_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
import h3_studio_vosr_progress as progress_io


def reporter(path):
    # Execute the worker's actual nested callback, including its imported helper.
    tree = ast.parse(Path(worker.__file__).read_text(encoding="utf-8"))
    run = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "run")
    callback = next(n for n in run.body if isinstance(n, ast.FunctionDef) and n.name == "report")
    namespace = {**vars(worker), "progress": path}
    exec(compile(ast.Module(body=[callback], type_ignores=[]), worker.__file__, "exec"), namespace)
    return namespace["report"]


def hold_without_delete_sharing(path, share=0x1 | 0x2):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    kernel.CreateFileW.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    handle = kernel.CreateFileW(str(path), 0x80000000, share, None, 3, 0x80, None)
    if handle == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    return lambda: kernel.CloseHandle(handle)


@unittest.skipUnless(os.name == "nt", "Windows file-sharing regression")
class WindowsProgressTests(unittest.TestCase):
    def test_reader_holding_progress_cannot_abort_frame_processing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            path.write_text(json.dumps({"phase": "processing", "done": 48, "total": 243}), encoding="utf-8")
            report = reporter(path)
            release = hold_without_delete_sharing(path)
            try:
                self.assertFalse(report("processing", 49, 243))
                self.assertEqual(json.loads(path.read_text())["done"], 48)
            finally:
                release()
            self.assertTrue(report("processing", 50, 243))
            self.assertEqual(json.loads(path.read_text())["done"], 50)

    def test_short_reader_lock_is_retried_and_publishes_current_frame(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            path.write_text('{"phase":"loading"}', encoding="utf-8")
            release = hold_without_delete_sharing(path)
            thread = threading.Thread(target=lambda: (time.sleep(0.025), release()))
            thread.start()
            try:
                self.assertTrue(reporter(path)("processing", 49, 243))
                self.assertEqual(json.loads(path.read_text())["done"], 49)
            finally:
                thread.join()

    def test_read_conflict_preserves_previous_state_then_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "progress.json"
            path.write_text('{"phase":"processing","done":49,"total":243}', encoding="utf-8")
            previous = {"phase": "processing", "done": 48, "total": 243}
            release = hold_without_delete_sharing(path, share=0x2)
            try:
                self.assertIs(progress_io.read_progress(path, previous), previous)
            finally:
                release()
            self.assertEqual(progress_io.read_progress(path, previous)["done"], 49)


class ProgressReadTests(unittest.TestCase):
    def test_busy_missing_or_partial_progress_keeps_previous_snapshot(self):
        previous = {"phase": "processing", "done": 48, "total": 243}
        for outcome in (PermissionError("busy"), FileNotFoundError("not yet created"), '{"phase":', "null"):
            options = {"side_effect": outcome} if isinstance(outcome, Exception) else {"return_value": outcome}
            with patch.object(Path, "read_text", **options):
                self.assertIs(progress_io.read_progress(Path("progress.json"), previous), previous)
                self.assertEqual(progress_io.read_progress(Path("progress.json")), {"phase": "waiting"})

    def test_unrelated_storage_errors_are_not_silenced(self):
        with patch.object(Path, "read_text", side_effect=OSError("disk error")):
            with self.assertRaises(OSError):
                progress_io.read_progress(Path("progress.json"))
        with patch.object(Path, "write_text", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                progress_io.write_progress(Path("progress.json"), {"phase": "processing"})


if __name__ == "__main__":
    unittest.main()
