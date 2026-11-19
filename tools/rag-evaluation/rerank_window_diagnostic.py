"""Observe original BGE window logits; do not alter scoring or candidate text."""

import argparse
import hashlib
import json
import math
from pathlib import Path

from rerank_model_input import fingerprint
from rerank_model_provider import CrossEncoder

ROOT = Path(__file__).resolve().parents[2]


def partition_logits(values, diagnostics):
    counts = [d["windows"] for d in diagnostics]
    if any(type(n) is not int or n < 1 for n in counts) or sum(counts) != len(values):
        raise ValueError("incomplete window logits")
    if any(not math.isfinite(v) for v in values):
        raise ValueError("nonfinite window logits")
    result, offset = [], 0
    for count in counts:
        result.append(values[offset:offset + count])
        offset += count
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    protocol = json.loads(args.protocol.read_text())
    for file, expected in protocol["files_sha256"].items():
        if hashlib.sha256((ROOT/file).read_bytes()).hexdigest() != expected:
            raise ValueError("diagnostic fingerprint differs: " + file)
    parent = json.loads((ROOT/protocol["model_protocol"]).read_text())
    import importlib.metadata
    if {k: importlib.metadata.version(k) for k in parent["runtime"]} != parent["runtime"]:
        raise ValueError("runtime versions differ")
    original = json.loads((ROOT/protocol["replay"]).read_text())
    model = CrossEncoder(next(m for m in parent["models"] if m["id"] == "bge-m3"), parent["model_input"], args.model_root)
    model.score("health", [{"title": "Health", "content": "Blue."}])
    rows = []
    for case in protocol["diagnostic_cases"]:
        row = next(r for s in original["sources"] if s["id"] == case["source"] for r in s["rows"] if r["id"] == case["id"])
        values = []
        hook = model.model.register_forward_hook(lambda module, inputs, output: values.extend(output.logits.detach().cpu().reshape(-1).tolist()))
        try:
            result = model.score(parent["queries"][case["source"]][case["id"]], row["pool"])
        finally:
            hook.remove()
        logits = partition_logits(values, result["diagnostics"])
        if [max(v) for v in logits] != result["scores"]:
            raise ValueError("observed logits differ from original aggregation")
        frozen = {d["chunkId"]: d["score"] for d in row["options"]["bge-m3"]["decisions"]}
        diff = max(abs(s-frozen[p["chunkId"]]) for p, s in zip(row["pool"], result["scores"]))
        rows.append({**case, "elapsed_ms": result["elapsed_ms"], "max_frozen_difference": diff,
                     "candidates": [{"chunkId": p["chunkId"], "title": p["title"],
                                     "content_sha256": hashlib.sha256(p["content"].encode()).hexdigest(),
                                     "window_logits": w, "stats": stats, "score": score}
                                    for p, w, stats, score in zip(row["pool"], logits, result["diagnostics"], result["scores"])]})
        print(json.dumps({**case, "completed": len(rows), "max_frozen_difference": diff}), flush=True)
    with args.output.open("x") as handle:
        json.dump({"complete": True, "protocol_sha256": fingerprint(protocol), "rows": rows}, handle, ensure_ascii=False, allow_nan=False)
        handle.write("\n")


if __name__ == "__main__":
    main()
