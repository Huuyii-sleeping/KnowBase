"""Run using the MinerU Python environment; hash weights without copying them."""

import argparse
import hashlib
import importlib.metadata
import json
import platform
from pathlib import Path


def sha256(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def model_files(root):
    root = root.resolve(strict=True)
    files = []
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if any(part.startswith(".") for part in relative.parts):
            continue
        if path.suffix not in [".safetensors", ".onnx", ".json", ".gguf"]:
            continue
        if path.is_symlink() or not path.is_file():
            raise ValueError("Snapshot requires regular model files")
        files.append(dict(file=str(relative), bytes=path.stat().st_size, sha256=sha256(path)))
    if not any(x["file"].endswith((".safetensors", ".onnx", ".gguf")) for x in files):
        raise ValueError("No model weights found")
    return files


def snapshot(root):
    packages = sorted([dict(name=x.metadata["Name"], version=x.version) for x in importlib.metadata.distributions()], key=lambda x: x["name"].lower())
    files = model_files(root)
    fingerprint = hashlib.sha256(json.dumps(dict(packages=packages, models=files), sort_keys=True).encode()).hexdigest()
    return dict(schema="mineru-runtime-snapshot-v1", python=platform.python_version(), platform=platform.system(), arch=platform.machine(), packages=packages, models=files, sha256=fingerprint)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("models", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = snapshot(args.models)
    with args.output.open("x", encoding="utf8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(result["sha256"])
