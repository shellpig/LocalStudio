import importlib.util
import json
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "ComfyUI"))
# Exercise real ComfyUI adapters and patching on CPU, without loading a base model.
with patch.object(sys, "argv", [sys.argv[0], "--cpu"]):
    import comfy.lora
    import comfy.model_patcher
    import comfy.ops
    import folder_paths
    import torch
from safetensors.torch import save_file

spec = importlib.util.spec_from_file_location("h3_studio_lora", Path(__file__).with_name("h3_studio_lora.py"))
lora = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lora)


def pair(module, kohya=False):
    a, b = ("lora_down", "lora_up") if kohya else ("lora_A", "lora_B")
    return {f"{module}.{a}.weight": torch.ones(2, 3),
            f"{module}.{b}.weight": torch.ones(4, 2),
            f"{module}.alpha": torch.tensor(1.0)}


def header_tensors(path):
    with path.open("rb") as handle:
        header = json.loads(handle.read(struct.unpack("<Q", handle.read(8))[0]))
    return {key: torch.empty(value["shape"], device="meta")
            for key, value in header.items() if key != "__metadata__"}


class LoraTests(unittest.TestCase):
    def setUp(self):
        self.target = "diffusion_model.blocks.0.attn.out_proj.weight"
        self.weights = {self.target: torch.zeros(4, 3)}

    def test_supported_names_preserve_alpha_and_numeric_update(self):
        for module, kohya in (("blocks.0.attn.out_proj", False),
                              ("diffusion_model.blocks.0.attn.out_proj", False),
                              ("lora_unet_blocks_0_attn_out_proj", True)):
            with self.subTest(module=module):
                tensors = pair(module, kohya)
                mapping, unmatched = lora.lora_key_map(tensors, self.weights)
                self.assertFalse(unmatched)
                adapter = comfy.lora.load_lora(tensors, mapping)[self.target]
                result = adapter.calculate_weight(torch.zeros(4, 3), self.target, 0.5, 1.0, None, lambda x: x)
                # rank=2, alpha=1: (B @ A) * alpha/rank * strength = 0.5.
                torch.testing.assert_close(result, torch.full((4, 3), 0.5))

    def test_invalid_files_fail_before_patching(self):
        module = "blocks.0.attn.out_proj"
        incomplete = pair(module)
        del incomplete[module + ".lora_B.weight"]
        invalid_shape = pair(module)
        invalid_shape[module + ".lora_A.weight"] = torch.ones(2, 5)
        rank_mismatch = pair(module)
        rank_mismatch[module + ".lora_B.weight"] = torch.ones(4, 3)
        for tensors in ({}, pair("not_h3"), incomplete, invalid_shape, rank_mismatch,
                        {**pair(module), **pair("diffusion_model." + module)},
                        {**pair(module), "unknown": torch.ones(1)},
                        {**pair(module), module + ".alpha": torch.ones(2)}):
            with self.subTest(keys=list(tensors)):
                with self.assertRaises(ValueError):
                    lora.lora_key_map(tensors, self.weights)

    def test_node_stacks_real_patches_and_warns_on_partial_match(self):
        base = torch.nn.Module()
        base.diffusion_model = torch.nn.Module()
        base.diffusion_model.proj = torch.nn.Linear(3, 4, bias=False)
        base.diffusion_model.proj.weight.data.zero_()
        model = comfy.model_patcher.ModelPatcher(base, torch.device("cpu"), torch.device("cpu"))
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "test.safetensors"
            save_file({**pair("diffusion_model.proj"), **pair("missing")}, path)
            with patch.object(folder_paths, "get_full_path_or_raise", return_value=str(path)):
                with self.assertLogs(level="WARNING") as logs:
                    first, = lora.H3StudioLoRA().apply_lora(model, path.name, 0.5)
                self.assertIn("missing", logs.output[0])
                second, = lora.H3StudioLoRA().apply_lora(first, path.name, 0.25)
            key = "diffusion_model.proj.weight"
            self.assertFalse(model.patches)
            self.assertEqual(len(first.patches[key]), 1)
            self.assertEqual(len(second.patches[key]), 2)
            second.patch_weight_to_device(key)
            torch.testing.assert_close(base.diffusion_model.proj.weight, torch.full((4, 3), 0.75))

    def test_w4a8_uses_logical_parameter_shape_instead_of_packed_storage(self):
        from comfy.quant_ops import QuantizedTensor, get_layout_class

        layout = get_layout_class("AsymW4A8Int8Layout")
        params = layout.Params(scale=torch.ones(4, 1), s_channel=torch.ones(4),
                               orig_dtype=torch.float32, orig_shape=(4, 16),
                               group_size=16, convrot_groupsize=16)
        ops = comfy.ops.mixed_precision_ops()
        base = torch.nn.Module()
        base.diffusion_model = torch.nn.Module()
        base.diffusion_model.proj = ops.Linear(16, 4, bias=False)
        base.diffusion_model.proj.quant_format = "asym_w4a8_int8"
        base.diffusion_model.proj.weight = torch.nn.Parameter(
            QuantizedTensor(torch.zeros(4, 8, dtype=torch.int8), "AsymW4A8Int8Layout", params),
            requires_grad=False)
        model = comfy.model_patcher.ModelPatcher(base, torch.device("cpu"), torch.device("cpu"))
        self.assertEqual(tuple(model.model_state_dict()["diffusion_model.proj.weight"].shape), (4, 8))
        tensors = {"proj.lora_A.weight": torch.ones(2, 16), "proj.lora_B.weight": torch.ones(4, 2)}
        with patch.object(folder_paths, "get_full_path_or_raise", return_value="unused"), \
                patch.object(comfy.utils, "load_torch_file", return_value=tensors):
            result, = lora.H3StudioLoRA().apply_lora(model, "test.safetensors", 0.8)
        self.assertEqual(len(result.patches["diffusion_model.proj.weight"]), 1)

    def test_local_h3_files_against_real_pruned_model_architecture(self):
        from comfy.ldm.minimax.model import MiniMaxH3Model
        from comfy.model_detection import detect_unet_config

        model_dir = ROOT / "ComfyUI/models/diffusion_models"
        files = sorted((ROOT / "ComfyUI/models/loras").glob("*.safetensors"))
        bases = sorted(model_dir.glob("minimax_h3_*.safetensors"))
        if not files or not bases:
            self.skipTest("Local H3 models are not installed")
        for path in bases:
            config = detect_unet_config(header_tensors(path), "")
            with torch.device("meta"):
                model = MiniMaxH3Model(**config, device="meta", operations=comfy.ops.disable_weight_init)
            weights = {"diffusion_model." + key: value for key, value in model.state_dict().items()}
            for file in files:
                if file.name.startswith(("qwen_", "minimax_h3_turbo_")):
                    continue
                with self.subTest(base=path.name, lora=file.name):
                    mapping, unmatched = lora.lora_key_map(header_tensors(file), weights)
                    self.assertFalse(unmatched)
                    self.assertGreater(len(mapping), 0)
                    print(f"{path.name}: {file.name}: {len(mapping)} matched, 0 unmatched", flush=True)


if __name__ == "__main__":
    unittest.main()
