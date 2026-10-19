"""Regression checks for optional reference-video frame anchors and metadata."""

import ast
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest


SOURCE = Path(__file__).resolve().parents[1] / "integrations/ComfyUI-H3-Studio/h3_studio_api.py"
NAMES = {"resolve_input_image", "validated_metadata", "prompt_mode", "prompt_instruction", "read_prompt_optimization_request"}
tree = ast.parse(SOURCE.read_text(encoding="utf-8-sig"))
namespace = {"Path": Path, "os": os, "json": json, "MAX_PROMPT_IMAGE_BYTES": 20 * 1024 * 1024,
             "PROMPT_ENGINE_LABELS": {"codex": "Codex", "grok": "Grok"}}
exec(compile(ast.Module(body=[node for node in tree.body if getattr(node, "name", None) in NAMES], type_ignores=[]), str(SOURCE), "exec"), namespace)


class Part:
    def __init__(self, name, value="", image=False):
        self.name = name
        self.value = value
        self.filename = "fixture.png" if image else None
        self.headers = {"Content-Type": "image/png"} if image else {}
        self.chunks = [b"image-fixture", b""]

    async def text(self):
        return self.value

    async def read_chunk(self):
        return self.chunks.pop(0)


class Request:
    def __init__(self, parts):
        self.parts = parts

    async def multipart(self):
        async def reader():
            for part in self.parts:
                yield part
        return reader()


class ReferenceAnchorTests(unittest.IsolatedAsyncioTestCase):
    def test_attention_metadata_keeps_supported_methods_and_legacy_absence(self):
        for method in ("sage", "sol"):
            self.assertEqual(namespace["validated_metadata"]({"attentionMethod": method})["attentionMethod"], method)
        for data in ({}, {"attentionMethod": "unknown"}):
            self.assertNotIn("attentionMethod", namespace["validated_metadata"](data))

    async def test_request_accepts_all_four_anchor_combinations(self):
        for first, last in [(False, False), (True, False), (False, True), (True, True)]:
            with self.subTest(first=first, last=last), tempfile.TemporaryDirectory() as directory:
                parts = [Part("brief", "A blue ball rolls across a table."), Part("duration", "5"), Part("sound", "false"),
                         Part("reference_manifest", json.dumps([{"label": "ball", "description": "Blue ball"}])),
                         Part("reference_image_1", image=True)]
                if first:
                    parts.append(Part("first_image", image=True))
                if last:
                    parts.append(Part("last_image", image=True))
                _, _, _, images, _, names, _ = await namespace["read_prompt_optimization_request"](Request(parts), directory)
                self.assertEqual(names, ["reference_image_1"])
                self.assertEqual("first_image" in images, first)
                self.assertEqual("last_image" in images, last)
                self.assertEqual(namespace["prompt_mode"](first, last, names), "Ref2VA")

    def test_optimizer_numbers_only_reference_images(self):
        refs = [{"label": "ball", "description": "Blue ball"}, {"label": "table", "description": "White table"}]
        instruction = namespace["prompt_instruction"]("A ball rolls.", "Ref2VA", 5, False, refs, True, True)
        self.assertIn("Attached image 1 is <Picture 1>", instruction)
        self.assertIn("Attached image 2 is <Picture 2>", instruction)
        self.assertIn("Attached image 3 is the opening-frame anchor", instruction)
        self.assertIn("Attached image 4 is the final-frame anchor", instruction)
        self.assertNotIn("<Picture 3>", instruction)
        self.assertNotIn("<Picture 4>", instruction)

    def test_last_only_optimizer_attachment_is_after_references(self):
        instruction = namespace["prompt_instruction"]("A ball rolls.", "Ref2VA", 5, True,
            [{"label": "ball", "description": "Blue ball"}], False, True)
        self.assertIn("Attached image 2 is the final-frame anchor", instruction)
        self.assertNotIn("opening-frame anchor", instruction)

    def test_metadata_keeps_reference_and_anchor_files_separate(self):
        with tempfile.TemporaryDirectory() as directory:
            namespace["folder_paths"] = SimpleNamespace(get_input_directory=lambda: directory)
            for name in ["first.png", "last.png", "reference.png"]:
                (Path(directory) / name).write_bytes(b"fixture")
            data = {"sourceMode": "reference", "inputMode": "reference", "firstImagePath": "first.png", "lastImagePath": "last.png",
                    "referenceFiles": ["reference.png"], "referenceDefinitions": [{"label": "ball", "description": "Blue ball"}]}
            actual = namespace["validated_metadata"](data)
            for key, value in data.items():
                self.assertEqual(actual[key], value)
            with self.assertRaises(ValueError):
                namespace["validated_metadata"]({**data, "firstImagePath": "../outside.png"})


if __name__ == "__main__":
    unittest.main()
