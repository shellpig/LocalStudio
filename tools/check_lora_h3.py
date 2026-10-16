"""Report whether a LoRA can attach to the MiniMax H3 DiT.

Reads only the safetensors header, so it costs no VRAM and never loads the base
model. Module names are compared against the H3 Turbo LoRA, which is known to
fit; where names match, the low-rank shapes are compared too.

    .\.venv\Scripts\python.exe tools\check_lora_h3.py [lora.safetensors ...]

With no arguments every file in ComfyUI\models\loras is checked.

Uses the same naming and shape checks as H3StudioLoRA. The reference is the
unpruned Turbo LoRA; the runtime node checks the actual loaded model instead.
"""
import sys
import importlib.util
from pathlib import Path

import torch
from safetensors import safe_open

ROOT = Path(__file__).resolve().parent.parent
LORA_DIR = ROOT / "ComfyUI" / "models" / "loras"
REFERENCE = LORA_DIR / "minimax_h3_turbo_v4_step600_ema.safetensors"
spec = importlib.util.spec_from_file_location("h3_studio_lora", ROOT / "integrations/ComfyUI-H3-Studio/h3_studio_lora.py")
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)


def read(path):
    """Read shapes on the meta device; alpha values are not needed here."""
    with safe_open(str(path), framework="pt") as handle:
        return {key: torch.empty(handle.get_slice(key).get_shape(), device="meta") for key in handle.keys()}


def report(path, reference):
    print(path.name)
    try:
        mapping, unmatched = loader.lora_key_map(read(path), reference)
    except Exception as error:
        print(f"  incompatible: {type(error).__name__}: {error}\n")
        return
    print(f"  matches H3: {len(mapping)} modules; unmatched: {len(unmatched)}")
    if unmatched:
        print(f"  VERDICT: partial; unmatched modules: {', '.join(unmatched)}\n")
    else:
        print("  VERDICT: names and shapes both fit. Worth a real test render.\n")


def main(argv):
    if not REFERENCE.exists():
        sys.exit(f"H3 reference LoRA missing: {REFERENCE}")
    tensors = read(REFERENCE)
    reference = {}
    for key, down in tensors.items():
        if not key.endswith(".lora_A.weight"):
            continue
        module = key[:-len(".lora_A.weight")].removeprefix("diffusion_model.")
        up = tensors[key.replace(".lora_A.weight", ".lora_B.weight")]
        reference[f"diffusion_model.{module}.weight"] = torch.empty((up.shape[0], down.shape[1]), device="meta")
    print(f"H3 reference: {len(reference)} modules ({REFERENCE.name})\n")

    targets = [Path(item) for item in argv] if argv else sorted(
        item for item in LORA_DIR.glob("*.safetensors") if item != REFERENCE
    )
    if not targets:
        print(f"No LoRA to check. Put files in {LORA_DIR}, or drag one onto the .bat.")
        return
    for path in targets:
        if path.exists():
            report(path, reference)
        else:
            print(f"{path.name}\n  file not found\n")


if __name__ == "__main__":
    main(sys.argv[1:])
