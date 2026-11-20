"""Resumable pilot on frozen BGE/rule shortlists; no business configuration."""

import argparse
import hashlib
import json
from pathlib import Path
import time
import urllib.request

from rerank_model_input import fingerprint
from rerank_verifier import validate_verdict, verify

ROOT = Path(__file__).resolve().parents[2]


def prepare(protocol):
    for file, expected in protocol["files_sha256"].items():
        if hashlib.sha256((ROOT / file).read_bytes()).hexdigest() != expected:
            raise ValueError("verifier fingerprint differs: " + file)
    source = json.loads((ROOT / protocol["replay"]).read_text())
    parent = json.loads((ROOT / protocol["query_protocol"]).read_text())
    tasks = []
    for case in protocol["cases"]:
        row = next(r for s in source["sources"] if s["id"] == case["source"] for r in s["rows"] if r["id"] == case["id"])
        # Union of current BGE and already-available rule outputs, not gold docs.
        allowed = set(row["options"]["short"]["selected"]) | set(row["options"]["rule"]["selected"])
        pool = [p for p in row["pool"] if p["chunkId"] in allowed]
        candidates = [{"id": f"P{i}", "title": p["title"], "content": p.get("content") or ""} for i, p in enumerate(pool)]
        query = parent["queries"][case["source"]][case["id"]]
        tasks.append({**case, "query": query, "pool": pool, "candidates": candidates,
                      "input_sha256": fingerprint([query, candidates])})
    return tasks


def run(protocol, output, endpoint):
    tasks = prepare(protocol)
    with urllib.request.urlopen(endpoint + "/api/tags", timeout=10) as response:
        models = json.load(response)["models"]
    if not any(m["name"] == protocol["model"]["name"] and m["digest"] == protocol["model"]["digest"] for m in models):
        raise ValueError("local verifier model differs")
    output.mkdir(parents=True, exist_ok=True)
    metadata = output / "metadata.json"
    header = {"protocol_sha256": fingerprint(protocol), "model": protocol["model"]}
    if metadata.exists() and json.loads(metadata.read_text()) != header:
        raise ValueError("verifier metadata differs")
    metadata.write_text(json.dumps(header, indent=2) + "\n")
    checkpoint = output / "checkpoint.jsonl"
    rows = [json.loads(l) for l in checkpoint.read_text().splitlines()] if checkpoint.exists() else []
    if len(rows) > len(tasks):
        raise ValueError("verifier checkpoint exceeds tasks")
    for row, task in zip(rows, tasks):
        if any(row[k] != task[k] for k in ["source", "id", "input_sha256"]):
            raise ValueError("verifier checkpoint identity differs")
        validate_verdict(row, task["candidates"])
    with checkpoint.open("a") as handle:
        for task in tasks[len(rows):]:
            started = time.perf_counter()
            verdict = verify(endpoint, protocol["model"]["name"], task["query"], task["candidates"],
                             protocol["options"], protocol["timeout_seconds"])
            row = {k: task[k] for k in ["source", "id", "input_sha256"]}
            row.update({**verdict, "elapsed_ms": (time.perf_counter() - started) * 1000})
            handle.write(json.dumps(row, allow_nan=False) + "\n")
            handle.flush()
            rows.append(row)
            print(json.dumps({"completed": len(rows), "total": len(tasks), "id": task["id"],
                              "answerable": row["answerable"], "seconds": round(row["elapsed_ms"] / 1000, 2)}), flush=True)
    temporary = output / "verdicts.tmp"
    temporary.write_text(json.dumps({**header, "complete": True, "rows": rows}, ensure_ascii=False, allow_nan=False) + "\n")
    temporary.replace(output / "verdicts.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--endpoint", default="http://127.0.0.1:11434")
    args = parser.parse_args()
    run(json.loads(args.protocol.read_text()), args.output, args.endpoint)
