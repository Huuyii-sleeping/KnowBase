"""Fresh paired baseline/cascade timing using one shared pinned BGE model."""

import argparse
import copy
import importlib.metadata
import json
from pathlib import Path
import sys
import time

from rerank_model_input import fingerprint
from rerank_model_run import file_hash, load_inputs

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "services/reranker"))
from knowbase_reranker.model import CrossEncoder


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("protocol", type=Path)
    parser.add_argument("model_root", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    p = json.loads(args.protocol.read_text())
    for f, expected in p["files_sha256"].items():
        if file_hash(ROOT / f) != expected:
            raise ValueError("cascade timing fingerprint differs: " + f)
    manifest = json.loads((ROOT / p["manifest"]).read_text())
    if {n: importlib.metadata.version(n) for n in manifest["runtime"]} != manifest["runtime"]:
        raise ValueError("runtime versions differ")
    parent = json.loads((ROOT / p["query_protocol"]).read_text())
    tasks = {(t["source"], t["id"]): t for t in load_inputs(ROOT, parent)}
    short = CrossEncoder(manifest["model"], manifest["model_input"], args.model_root)
    long = copy.copy(short)
    long.config = {**short.config, "max_length": 512, "overlap_tokens": 128}
    short.score("Color?", [{"title": "Health", "content": "Blue."}])
    rows = []
    for repeat in range(2):
        for index, case in enumerate(p["cases"]):
            task = tasks[case["source"], case["id"]]
            variants = {}
            order = ["short", "cascade"] if (index + repeat) % 2 == 0 else ["cascade", "short"]
            for mode in order:
                short.synchronize()
                started = time.perf_counter()
                initial = short.score(task["query"], task["pool"])
                trigger = max(initial["scores"]) < 0
                final = long.score(task["query"], task["pool"]) if mode == "cascade" and trigger else initial
                short.synchronize()
                variants[mode] = {"elapsed_ms": (time.perf_counter() - started) * 1000,
                                  "trigger": trigger, "initial": initial, "final": final}
            rows.append({**case, "repeat": repeat, "pair_keys": task["pair_keys"], "variants": variants})
            print(json.dumps({"completed": len(rows), "total": len(p["cases"]) * 2,
                              "id": case["id"], "times_ms": {k: round(v["elapsed_ms"]) for k, v in variants.items()}}), flush=True)
    args.output.write_text(json.dumps({"complete": True, "protocol_sha256": fingerprint(p), "rows": rows}, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
