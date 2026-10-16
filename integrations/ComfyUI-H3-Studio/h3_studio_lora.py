"""Load community H3 LoRAs using the loaded model's actual weight names."""
import logging

SUFFIXES = (".lora_A.weight", ".lora_B.weight", ".lora_down.weight", ".lora_up.weight", ".alpha")


def lora_key_map(lora, weights):
    aliases = {}
    for key in weights:
        if not key.startswith("diffusion_model.") or not key.endswith(".weight"):
            continue
        module = key[len("diffusion_model."):-len(".weight")]
        for alias in (module, "diffusion_model." + module, "lora_unet_" + module.replace(".", "_")):
            if alias in aliases and aliases[alias] != key:
                raise ValueError(f"Ambiguous H3 LoRA module: {alias}")
            aliases[alias] = key

    groups = {}
    for key, tensor in lora.items():
        suffix = next((s for s in SUFFIXES if key.endswith(s)), None)
        if suffix is None:
            raise ValueError(f"Unsupported H3 LoRA tensor: {key}")
        groups.setdefault(key[:-len(suffix)], {})[suffix] = tensor

    mapping, unmatched = {}, []
    for module, parts in groups.items():
        pairs = [(a, b) for a, b in ((".lora_A.weight", ".lora_B.weight"),
                                   (".lora_down.weight", ".lora_up.weight")) if a in parts or b in parts]
        if len(pairs) != 1 or any(s not in parts for s in pairs[0]):
            raise ValueError(f"Incomplete or duplicate H3 LoRA pair: {module}")
        down, up = (parts[s] for s in pairs[0])
        alpha = parts.get(".alpha")
        if alpha is not None and alpha.numel() != 1:
            raise ValueError(f"Invalid H3 LoRA alpha: {module}")
        target = aliases.get(module)
        if target is None:
            unmatched.append(module)
            continue
        if (down.ndim != 2 or up.ndim != 2 or down.shape[0] == 0 or
                down.shape[0] != up.shape[1] or
                tuple(weights[target].shape) != (up.shape[0], down.shape[1])):
            raise ValueError(f"H3 LoRA shape mismatch: {module} -> {target}")
        if target in mapping.values():
            raise ValueError(f"Duplicate H3 LoRA target: {target}")
        mapping[module] = target
    if not mapping:
        raise ValueError("H3 LoRA 未匹配任何模型權重，已停止生成。")
    return mapping, unmatched


class H3StudioLoRA:
    @classmethod
    def INPUT_TYPES(cls):
        import folder_paths

        return {"required": {
            "model": ("MODEL",),
            "lora_name": (folder_paths.get_filename_list("loras"),),
            "strength": ("FLOAT", {"default": 0.8, "min": -10.0, "max": 10.0, "step": 0.01}),
        }}

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "apply_lora"
    CATEGORY = "H3 Studio"

    def apply_lora(self, model, lora_name, strength):
        import comfy.lora
        import comfy.utils
        import folder_paths

        path = folder_paths.get_full_path_or_raise("loras", lora_name)
        lora = comfy.utils.load_torch_file(path, safe_load=True)
        # Quantized state_dict weights may be packed (e.g. W4A8 K/2).
        # Live parameters expose logical shapes without dequantizing the model.
        mapping, unmatched = lora_key_map(lora, dict(model.model.named_parameters()))
        patches = comfy.lora.load_lora(lora, mapping, log_missing=False)
        if set(patches) != set(mapping.values()):
            raise ValueError(f"H3 LoRA 權重解析不完整：{lora_name}")
        result = model.clone()
        applied = result.add_patches(patches, strength)
        if set(applied) != set(patches):
            raise ValueError(f"H3 LoRA 權重套用不完整：{lora_name}")
        logging.info("[H3StudioLoRA] %s: %d weights patched, strength=%s", lora_name, len(applied), strength)
        if unmatched:
            logging.warning("[H3StudioLoRA] %s: %d modules unmatched: %s", lora_name, len(unmatched), ", ".join(unmatched))
        return (result,)
