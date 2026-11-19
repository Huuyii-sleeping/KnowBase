"""Run frozen serial BGE ablations without changing the production runtime."""

import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import time

from rerank_model_input import aggregate_scores, fingerprint
from rerank_model_provider import CrossEncoder
from rerank_refinement_input import input_windows

ROOT = Path(__file__).resolve().parents[2]


def score(model, query, pool, variant):
    model.synchronize()
    started = time.perf_counter()
    config = {**model.config, **variant.get("config", {})}
    windows, diagnostics = [], []
    for candidate in pool:
        features, stats = input_windows(model.tokenizer, query, candidate, config, variant["mode"])
        windows.extend(features)
        diagnostics.append(stats)
    values = []
    with model.torch.inference_mode():
        for offset in range(0, len(windows), config["batch_size"]):
            batch = model.tokenizer.pad(windows[offset:offset + config["batch_size"]], padding=True, return_tensors="pt").to(model.device)
            values.extend(model.model(**batch).logits.reshape(-1).detach().cpu().tolist())
    model.synchronize()
    return {"scores": aggregate_scores(values, [d["windows"] for d in diagnostics]),
            "diagnostics": diagnostics, "elapsed_ms": (time.perf_counter() - started) * 1000}


def run(protocol, group, output, model_root):
    for file, expected in protocol["files_sha256"].items():
        if hashlib.sha256((ROOT / file).read_bytes()).hexdigest() != expected:
            raise ValueError("fingerprint differs: " + file)
    parent = json.loads((ROOT / protocol["model_protocol"]).read_text())
    if {key: importlib.metadata.version(key) for key in parent["runtime"]} != parent["runtime"]:
        raise ValueError("runtime versions differ")
    replay = json.loads((ROOT / protocol["replay"]).read_text())
    lookup = {(s["id"], r["id"]): r for s in replay["sources"] for r in s["rows"]}
    cases, variants = protocol[group + "_cases"], protocol[group + "_variants"]
    tasks = [(case, repeat) for repeat in range(protocol.get(group + "_repeats", 1)) for case in cases]
    model_config = next(m for m in parent["models"] if m["id"] == "bge-m3")
    header = {"protocol_sha256": fingerprint(protocol), "group": group}
    checkpoint = output.with_suffix(".jsonl")
    rows = [json.loads(line) for line in checkpoint.read_text().splitlines()] if checkpoint.exists() else []
    for i, record in enumerate(rows):
        case, repeat = tasks[i]
        if any(record[k] != v for k, v in {**header, **case, "repeat": repeat}.items()):
            raise ValueError("checkpoint task or protocol differs")
        pool = lookup[(case["source"], case["id"])]["pool"]
        if record["chunk_ids"] != [p["chunkId"] for p in pool] or set(record["variants"]) != {v["id"] for v in variants}:
            raise ValueError("checkpoint candidates or variants differ")
        for result in record["variants"].values():
            aggregate_scores(result["scores"], [1] * len(pool))
    model = CrossEncoder(model_config, parent["model_input"], model_root) if len(rows) < len(tasks) else None
    if model:
        for variant in variants:
            score(model, "health", [{"title": "Health", "content": "Blue."}], variant)
    with checkpoint.open("a") as handle:
        for i in range(len(rows), len(tasks)):
            case, repeat = tasks[i]
            pool = lookup[(case["source"], case["id"])]["pool"]
            query = parent["queries"][case["source"]][case["id"]]
            # Rotate order on every pair/repeat; full fresh inference, no score cache.
            rotation = i % len(variants)
            order = variants[rotation:] + variants[:rotation]
            results = {v["id"]: score(model, query, pool, v) for v in order}
            record = {**header, **case, "repeat": repeat, "chunk_ids": [p["chunkId"] for p in pool], "variants": results}
            handle.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n")
            handle.flush()
            rows.append(record)
            print(json.dumps({"group": group, "completed": len(rows), "total": len(tasks), "id": case["id"],
                              "ms": {k: round(v["elapsed_ms"]) for k, v in results.items()}}), flush=True)
    with output.open("x") as handle:
        json.dump({**header, "complete": True, "rows": rows}, handle, ensure_ascii=False, allow_nan=False)
        handle.write("\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--group", choices=["input", "performance"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    args = parser.parse_args()
    run(json.loads(args.protocol.read_text()), args.group, args.output, args.model_root)
