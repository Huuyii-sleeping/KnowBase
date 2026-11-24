"""Generate an immutable local corpus. Binary assets stay in ignored reports/."""

import argparse
import hashlib
import importlib.metadata
import json
import platform
from pathlib import Path

from pypdf import PdfReader
from render import register_font, render

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[4] / "benchmarks/ingestion-complex"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def generate(output, font):
    # A failed/partial generation cannot be mistaken for a completed corpus.
    output.mkdir(parents=True, exist_ok=False)
    register_font(font)
    layout_bytes = (SOURCE / "layouts.json").read_bytes()
    gold_bytes = (SOURCE / "annotations.json").read_bytes()
    layouts = json.loads(layout_bytes)
    manifest = dict(
        schema="complex-corpus-v1",
        provenance="authored-synthetic-yuanlan-v1",
        layoutSha256=digest(layout_bytes),
        goldSha256=digest(gold_bytes),
        generatorSha256=digest((HERE / "generate.py").read_bytes() + (HERE / "render.py").read_bytes()),
        fontSha256=digest(font.read_bytes()),
        python=platform.python_version(),
        libraries={name: importlib.metadata.version(name) for name in ["reportlab", "pypdf", "pypdfium2", "Pillow"]},
        cases=[],
    )
    previews = output / "previews"
    previews.mkdir()
    for item in layouts["cases"]:
        data, images = render(item)
        target = output / item["file"]
        target.write_bytes(data)
        if target.suffix == ".pdf":
            reader = PdfReader(target)
            assert len(reader.pages) == len(item["pages"])
            if item["scan"]:
                assert all(not page.extract_text().strip() for page in reader.pages)
        for index, image in enumerate(images, 1):
            image.save(previews / f'{item["id"]}-p{index}.png')
        manifest["cases"].append({key: item[key] for key in ["id", "category", "split", "file"]} | dict(sha256=digest(data), pages=len(images)))
    (output / "gold.json").write_bytes(gold_bytes)
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    parser.add_argument("--font", type=Path, required=True, help="CJK TrueType font; digest is frozen in manifest")
    args = parser.parse_args()
    result = generate(args.output, args.font)
    print(f'Generated {len(result["cases"])} independent synthetic cases')
