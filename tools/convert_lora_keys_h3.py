"""Rewrite a LoRA's key names so the H3 loader can find them.

Some H3 LoRAs are saved with sd-scripts key names
(`lora_unet_blocks_0_attn_out_proj.lora_down.weight`), while MiniMaxH3TurboLoRA
builds its key map from the DiT's own module paths (`blocks.0.attn.out_proj`).
The two never meet, comfy.lora.load_lora is called with log_missing=False, and
the run produces an unchanged video. See tools/check_lora_h3.py.

    .\.venv\Scripts\python.exe tools\convert_lora_keys_h3.py <lora.safetensors>

Writes <name>_FIXED.safetensors next to the input and leaves the input alone.

Target names come from the H3 Turbo LoRA, so a module either lands on a real
DiT path or is reported as unconverted - the underscores are never guessed at.
Output uses lora_A / lora_B like the Turbo LoRA, with alpha folded into lora_B,
so the loader sees one convention it already handles.
"""
import sys
from pathlib import Path

import torch
from safetensors import safe_open
from safetensors.torch import save_file

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = ROOT / "ComfyUI" / "models" / "loras" / "minimax_h3_turbo_v4_step600_ema.safetensors"
SUFFIXES = (".lora_down.weight", ".lora_up.weight", ".alpha")


def h3_module_names(path):
    """Every module the H3 DiT exposes to a LoRA, taken from a LoRA known to fit."""
    names = set()
    with safe_open(str(path), framework="pt") as handle:
        for key in handle.keys():
            name = key[len("diffusion_model."):] if key.startswith("diffusion_model.") else key
            if ".lora_" in name:
                names.add(name.rsplit(".lora_", 1)[0])
    return names


def convert(path, targets):
    with safe_open(str(path), framework="pt") as handle:
        source = {key: handle.get_tensor(key) for key in handle.keys()}
        metadata = handle.metadata() or {}

    grouped = {}
    for key, tensor in source.items():
        for suffix in SUFFIXES:
            if key.endswith(suffix):
                grouped.setdefault(key[: -len(suffix)], {})[suffix] = tensor
                break
        else:
            raise ValueError(f"Unexpected key, refusing to guess: {key}")

    converted, unconverted = {}, []
    for module, parts in sorted(grouped.items()):
        target = targets.get(module)
        if target is None:
            unconverted.append(module)
            continue
        down, up = parts.get(".lora_down.weight"), parts.get(".lora_up.weight")
        if down is None or up is None:
            unconverted.append(module)
            continue
        alpha = parts.get(".alpha")
        if alpha is not None:
            scale = float(alpha) / down.shape[0]
            if scale != 1.0:
                up = up * scale
        converted[f"{target}.lora_A.weight"] = down
        converted[f"{target}.lora_B.weight"] = up
    return converted, unconverted, metadata


def main(argv):
    if len(argv) != 1:
        sys.exit(__doc__)
    path = Path(argv[0])
    if not path.is_file():
        sys.exit(f"File not found: {path}")
    if not REFERENCE.is_file():
        sys.exit(f"H3 reference LoRA missing: {REFERENCE}")

    reference = h3_module_names(REFERENCE)
    # The DiT's own path with the dots flattened is exactly what sd-scripts writes.
    targets = {"lora_unet_" + name.replace(".", "_"): name for name in reference}

    converted, unconverted, metadata = convert(path, targets)
    if not converted:
        sys.exit("Nothing converted. No key matched an H3 module - this is not an H3 LoRA.")

    metadata = {key: value for key, value in metadata.items() if isinstance(value, str)}
    metadata["h3_studio_converted_from"] = path.name
    out = path.with_name(path.stem + "_FIXED" + path.suffix)
    save_file(converted, str(out), metadata=metadata)

    print(f"{path.name} -> {out.name}")
    print(f"  {len(converted) // 2} modules converted, {len(unconverted)} left behind")
    for module in unconverted[:5]:
        print(f"    unconverted: {module}")
    print(f"  written: {out}")


if __name__ == "__main__":
    main(sys.argv[1:])
