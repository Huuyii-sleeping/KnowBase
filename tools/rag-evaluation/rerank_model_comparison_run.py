"""Run pinned alternative models against the current reranking input contract."""

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


def run(protocol, model_id, model_root, output):
    for file, expected in protocol["files_sha256"].items():
        if file_hash(ROOT / file) != expected:
            raise ValueError("comparison fingerprint differs: " + file)
    parent = json.loads((ROOT / protocol["model_protocol"]).read_text())
    tasks = load_inputs(ROOT, parent)
    if len(tasks) != protocol["expected_pools"]:
        raise ValueError("unexpected pool count")
    model = next((m for m in protocol["models"] if m["id"] == model_id), None)
    if model is None:
        raise ValueError("unknown comparison model")
    runtime = {n: importlib.metadata.version(n) for n in protocol["runtime"]}
    if runtime != protocol["runtime"]:
        raise ValueError("runtime versions differ")
    header = {"protocol_sha256": fingerprint(protocol), "model": model,
              "runtime": runtime, "model_input": protocol["model_input"]}
    output.mkdir(parents=True, exist_ok=True)
    metadata = output / f"{model_id}-metadata.json"
    if metadata.exists() and json.loads(metadata.read_text()) != header:
        raise ValueError("checkpoint metadata differs")
    metadata.write_text(json.dumps(header, indent=2) + "\n")

    def progress(rows):
        if len(rows) % 10 == 0 or len(rows) == len(tasks):
            print(json.dumps({"model": model_id, "completed": len(rows),
                              "total": len(tasks), "inference_seconds": round(
                                  sum(r["elapsed_ms"] for r in rows) / 1000, 2)}), flush=True)

    records = run_tasks(tasks, output / f"{model_id}-checkpoint.jsonl",
                        lambda: CrossEncoder(model, protocol["model_input"], model_root),
                        progress)
    result = {**header, "complete": True, "rows": records}
    temporary = output / f"{model_id}-scores.tmp"
    temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
    temporary.replace(output / f"{model_id}-scores.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(json.loads(args.protocol.read_text()), args.model, args.model_root, args.output)
