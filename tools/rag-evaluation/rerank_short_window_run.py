"""Score all frozen pools with the short-window runtime, retaining complete cases."""

import argparse
import importlib.metadata
import json
from pathlib import Path
import sys

from rerank_model_cache import run_tasks
from rerank_model_input import fingerprint
from rerank_model_run import file_hash, load_inputs

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/reranker"))
from knowbase_reranker.model import CrossEncoder


def run(protocol, model_root, output):
    for file, expected in protocol["files_sha256"].items():
        if file_hash(ROOT / file) != expected:
            raise ValueError("short-window fingerprint differs: " + file)
    parent = json.loads((ROOT / protocol["model_protocol"]).read_text())
    tasks = load_inputs(ROOT, parent)
    if len(tasks) != protocol["expected_pools"]:
        raise ValueError("unexpected pool count")
    runtime = {name: importlib.metadata.version(name) for name in parent["runtime"]}
    if runtime != parent["runtime"]:
        raise ValueError("runtime versions differ")
    config = next(model for model in parent["models"] if model["id"] == "bge-m3")
    header = {"protocol_sha256": fingerprint(protocol), "model": config,
              "runtime": runtime, "model_input": protocol["short_input"]}
    output.mkdir(parents=True, exist_ok=True)
    metadata = output / "metadata.json"
    if metadata.exists() and json.loads(metadata.read_text()) != header:
        raise ValueError("checkpoint metadata differs")
    metadata.write_text(json.dumps(header, indent=2) + "\n")

    def progress(rows):
        if len(rows) % 5 == 0 or len(rows) == len(tasks):
            print(json.dumps({"completed": len(rows), "total": len(tasks),
                              "id": rows[-1]["id"], "new_pairs": rows[-1]["new_pairs"],
                              "inference_seconds": round(sum(r["elapsed_ms"] for r in rows) / 1000, 2)}), flush=True)

    records = run_tasks(tasks, output / "checkpoint.jsonl",
                        lambda: CrossEncoder(config, protocol["short_input"], model_root), progress)
    result = {**header, "complete": True, "rows": records}
    target = output / "scores.json"
    temporary = output / "scores.tmp"
    temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
    temporary.replace(target)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(json.loads(args.protocol.read_text()), args.model_root, args.output)
