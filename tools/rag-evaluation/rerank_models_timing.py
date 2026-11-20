"""Balanced, uncached model timing; loading and health warmup are excluded."""

import argparse
import importlib.metadata
import itertools
import json
import math
from pathlib import Path
import sys

from rerank_model_input import fingerprint
from rerank_model_run import file_hash, load_inputs

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/reranker"))
from knowbase_reranker.model import CrossEncoder


def schedule(cases, models, repeats):
    orders = list(itertools.permutations(models))
    return [{"repeat": repeat, **case, "model": model}
            for repeat in range(repeats) for index, case in enumerate(cases)
            for model in orders[(index + repeat * (len(orders) // 2)) % len(orders)]]


def benchmark(trials, tasks, factory, output):
    checkpoint = output / "timing-checkpoint.jsonl"
    records = [json.loads(line) for line in checkpoint.read_text().splitlines()] if checkpoint.exists() else []
    if len(records) > len(trials):
        raise ValueError("timing checkpoint exceeds schedule")
    for row, expected in zip(records, trials):
        if row["trial"] != expected or row["pair_keys"] != tasks[expected["source"], expected["id"]]["pair_keys"]:
            raise ValueError("timing checkpoint identity differs")
        if len(row["scores"]) != len(row["pair_keys"]) or any(not math.isfinite(s) for s in row["scores"]):
            raise ValueError("incomplete timing scores")
    providers = {}
    # Keep the same resident models across all trials; no per-trial reload/cache.
    for model in dict.fromkeys(t["model"] for t in trials[len(records):]):
        providers[model] = factory(model)
        providers[model].score("What is the color?", [{"title": "Health", "content": "Blue."}])
    with checkpoint.open("a") as handle:
        for trial in trials[len(records):]:
            task = tasks[trial["source"], trial["id"]]
            result = providers[trial["model"]].score(task["query"], task["pool"])
            if len(result["scores"]) != len(task["pool"]) or any(not math.isfinite(s) for s in result["scores"]):
                raise ValueError("incomplete timing model output")
            row = {"trial": trial, "pair_keys": task["pair_keys"], **result}
            handle.write(json.dumps(row, allow_nan=False) + "\n")
            handle.flush()
            records.append(row)
            print(json.dumps({"timing_completed": len(records), "total": len(trials), **trial}), flush=True)
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    protocol = json.loads(args.protocol.read_text())
    for file, expected in protocol["files_sha256"].items():
        if file_hash(ROOT / file) != expected:
            raise ValueError("timing fingerprint differs: " + file)
    comparison = json.loads((ROOT / protocol["comparison_protocol"]).read_text())
    for file, expected in comparison["files_sha256"].items():
        if file_hash(ROOT / file) != expected:
            raise ValueError("comparison fingerprint differs: " + file)
    parent = json.loads((ROOT / comparison["model_protocol"]).read_text())
    tasks = {(t["source"], t["id"]): t for t in load_inputs(ROOT, parent)}
    runtime = {n: importlib.metadata.version(n) for n in comparison["runtime"]}
    if runtime != comparison["runtime"]:
        raise ValueError("timing runtime differs")
    models = {m["id"]: m for m in protocol["models"]}
    trials = schedule(protocol["cases"], list(models), protocol["repeats"])
    args.output.mkdir(parents=True, exist_ok=True)
    metadata = args.output / "timing-metadata.json"
    header = {"protocol_sha256": fingerprint(protocol), "runtime": runtime}
    if metadata.exists() and json.loads(metadata.read_text()) != header:
        raise ValueError("timing metadata differs")
    metadata.write_text(json.dumps(header, indent=2) + "\n")
    rows = benchmark(trials, tasks, lambda model: CrossEncoder(
        models[model], comparison["model_input"], args.model_root), args.output)
    temporary = args.output / "timing.tmp"
    temporary.write_text(json.dumps({**header, "complete": True, "rows": rows}, allow_nan=False) + "\n")
    temporary.replace(args.output / "timing.json")


if __name__ == "__main__":
    main()
