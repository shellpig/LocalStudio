"""Report whether a LoRA can attach to the MiniMax H3 DiT.

Reads only the safetensors header, so it costs no VRAM and never loads the base
model. Module names are compared against the H3 Turbo LoRA, which is known to
fit; where names match, the low-rank shapes are compared too.

    .\.venv\Scripts\python.exe tools\check_lora_h3.py [lora.safetensors ...]

With no arguments every file in ComfyUI\models\loras is checked.

A LoRA whose names do not match is NOT rejected at run time: the loader calls
comfy.lora.load_lora with log_missing=False, so the graph runs, patches nothing
and produces an unchanged video. Check here first.
"""
import sys
from pathlib import Path

from safetensors import safe_open

ROOT = Path(__file__).resolve().parent.parent
LORA_DIR = ROOT / "ComfyUI" / "models" / "loras"
REFERENCE = LORA_DIR / "minimax_h3_turbo_v4_step600_ema.safetensors"


def read(path):
    """Map each LoRA module to the output dimension of its B matrix."""
    shapes = {}
    with safe_open(str(path), framework="pt") as handle:
        for key in handle.keys():
            name = key[len("diffusion_model."):] if key.startswith("diffusion_model.") else key
            if ".lora_" not in name:
                continue
            module, tail = name.rsplit(".lora_", 1)
            if tail.startswith(("B", "up")):
                shapes[module] = tuple(handle.get_slice(key).get_shape())
    return shapes


def report(path, reference):
    print(path.name)
    try:
        shapes = read(path)
    except Exception as error:
        print(f"  unreadable: {type(error).__name__}: {error}\n")
        return
    if not shapes:
        print("  no LoRA tensors found - this is not a LoRA file.\n")
        return

    shared = sorted(set(reference).intersection(shapes))
    print(f"  {len(shapes)} LoRA modules, matches H3: {len(shared)} / {len(reference)}")
    print(f"  sample module: {sorted(shapes)[0]}")

    if not shared:
        print("  VERDICT: incompatible. No module name exists in the H3 DiT.")
        print("           H3 would patch 0 weights and change nothing - silently.\n")
        return

    mismatched = [m for m in shared if shapes[m][0] != reference[m][0]]
    if len(shared) < len(reference) * 0.5:
        print(f"  VERDICT: partial. It covers only {len(shared)} of the DiT's {len(reference)} modules. Not usable.\n")
    elif mismatched:
        print(f"  VERDICT: names fit but {len(mismatched)} shapes differ, e.g. {mismatched[0]} "
              f"{shapes[mismatched[0]]} vs {reference[mismatched[0]]}. Not usable.\n")
    else:
        print("  VERDICT: names and shapes both fit. Worth a real test render.\n")


def main(argv):
    if not REFERENCE.exists():
        sys.exit(f"H3 reference LoRA missing: {REFERENCE}")
    reference = read(REFERENCE)
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
