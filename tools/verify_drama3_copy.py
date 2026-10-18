"""Verify a project-local Drama3 copy against its unchanged migration source."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "services" / "Drama3"


def digest(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def inventory(root):
    return {str(path.relative_to(root)): path.stat().st_size for path in root.rglob("*")
            if path.is_file() and path.suffix != ".pyc" and "__pycache__" not in path.parts}


def packages(root):
    return {item.metadata["Name"].lower().replace("_", "-"): item.version
            for item in importlib.metadata.distributions(path=[str(root / ".venv/Lib/site-packages")])}


def main():
    source = Path(sys.argv[1]).resolve()
    result = {"destination": str(DESTINATION), "sha256": {}, "packages": packages(source)}
    if result["packages"] != packages(DESTINATION):
        raise RuntimeError("Installed Python package versions differ")
    source_lib = source / ".venv/Lib/site-packages"
    target_lib = DESTINATION / ".venv/Lib/site-packages"
    if inventory(source_lib) != inventory(target_lib):
        raise RuntimeError("Python package file inventory differs")
    for folder in ("models", "input", "output", "user"):
        original = source / "ComfyUI" / folder
        target = DESTINATION / "ComfyUI" / folder
        if inventory(original) != inventory(target):
            raise RuntimeError(f"File inventory differs: {folder}")
        for path in original.rglob("*"):
            if not path.is_file():
                continue
            relative = path.relative_to(source)
            expected = digest(path)
            if expected != digest(DESTINATION / relative):
                raise RuntimeError(f"SHA256 differs: {relative}")
            result["sha256"][str(relative)] = expected
        print(f"Verified {folder}: {len(inventory(original))} files", flush=True)
    for path in source_lib.rglob("*"):
        if path.is_file() and path.suffix.lower() in {".dll", ".pyd"}:
            relative = path.relative_to(source)
            expected = digest(path)
            if expected != digest(DESTINATION / relative):
                raise RuntimeError(f"Native package binary differs: {relative}")
            result["sha256"][str(relative)] = expected
    (DESTINATION / "migration-integrity.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Verified {len(result['packages'])} package versions and {len(result['sha256'])} file hashes.")


if __name__ == "__main__":
    main()
