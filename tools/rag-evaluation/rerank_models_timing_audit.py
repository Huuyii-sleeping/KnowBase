"""Validate and summarize uncached paired model timings separately from quality."""

import argparse
import json
import math
from pathlib import Path
from statistics import median

from rerank_model_input import fingerprint
from rerank_models_timing import schedule


def audit(protocol, result, scores):
    models = [m["id"] for m in protocol["models"]]
    expected = schedule(protocol["cases"], models, protocol["repeats"])
    if result.get("complete") is not True or result.get("protocol_sha256") != fingerprint(protocol):
        raise ValueError("incomplete or foreign timing result")
    if [r["trial"] for r in result["rows"]] != expected:
        raise ValueError("timing schedule differs")
    lookup = {model: {(r["source"], r["id"]): r for r in score["rows"]}
              for model, score in scores.items()}
    differences = []
    for row in result["rows"]:
        t = row["trial"]
        original = lookup[t["model"]][t["source"], t["id"]]
        if row["pair_keys"] != original["pair_keys"] or len(row["scores"]) != len(original["scores"]):
            raise ValueError("timing candidate identity differs")
        if not math.isfinite(row["elapsed_ms"]) or row["elapsed_ms"] < 0 or any(not math.isfinite(s) for s in row["scores"]):
            raise ValueError("nonfinite timing or scores")
        if row["diagnostics"] != original["diagnostics"]:
            raise ValueError("timing input diagnostics differ")
        differences.append({**t, "max_score_difference": max(abs(a - b) for a, b in zip(row["scores"], original["scores"]))})
    summaries = []
    for repeat in range(protocol["repeats"]):
        rows = [r for r in result["rows"] if r["trial"]["repeat"] == repeat]
        baseline = {(r["trial"]["source"], r["trial"]["id"]): r["elapsed_ms"] for r in rows if r["trial"]["model"] == "bge-m3"}
        before = median(baseline.values())
        for model in models:
            selected = [r for r in rows if r["trial"]["model"] == model]
            after = median(r["elapsed_ms"] for r in selected)
            summaries.append({"repeat": repeat, "model": model, "pools": len(selected),
                              "baseline_p50_ms": before, "p50_ms": after,
                              "p50_reduction": 1 - after / before,
                              "faster_pools": sum(r["elapsed_ms"] < baseline[r["trial"]["source"], r["trial"]["id"]] for r in selected)})
    return {"complete": True, "trials": len(expected), "summaries": summaries,
            "max_score_difference_from_full_run": max(d["max_score_difference"] for d in differences),
            "score_differences": differences,
            "scope": "Fresh uncached full-pool inference, model loading/warmup excluded. All models resident. No HTTP, end-to-end latency or throughput claim."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("protocol", type=Path)
    parser.add_argument("timing", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("scores", type=Path, nargs="+")
    args = parser.parse_args()
    scores = [json.loads(p.read_text()) for p in args.scores]
    result = audit(json.loads(args.protocol.read_text()), json.loads(args.timing.read_text()),
                   {s["model"]["id"]: s for s in scores})
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result["summaries"], indent=2))
