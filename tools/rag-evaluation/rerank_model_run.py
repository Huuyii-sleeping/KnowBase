"""Score frozen candidate pools with resumable, fingerprinted local inference."""

import argparse
import importlib.metadata
import json
import platform
from pathlib import Path

from rerank_model_cache import run_tasks
from rerank_model_input import fingerprint, pair_key
from rerank_model_provider import CrossEncoder


def file_hash(path):
    import hashlib

    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_inputs(root, protocol):
    for file, expected in protocol["input_files_sha256"].items():
        if file_hash(root / file) != expected:
            raise ValueError(f"input fingerprint differs: {file}")
    for file, expected in protocol["implementation_sha256"].items():
        if file_hash(root / file) != expected:
            raise ValueError(f"implementation fingerprint differs: {file}")
    replay = json.loads((root / protocol["input_replay"]).read_text())
    expected = {s["id"]: s for s in protocol["sources"]}
    if len(replay["sources"]) != len(expected) or {
        s["id"] for s in replay["sources"]
    } != set(expected):
        raise ValueError("incomplete or duplicate sources")
    tasks = []
    for source in replay["sources"]:
        if any(source[k] != v for k, v in expected[source["id"]].items()):
            raise ValueError("source differs from frozen protocol")
        for file, expected_hash in source["metadata"]["corpus_sha256"].items():
            if file_hash(root / source["dataset"] / file) != expected_hash:
                raise ValueError("source corpus fingerprint differs")
        questions = {
            q["id"]: q["question"]
            for q in json.loads(
                (root / source["dataset"] / "questions.json").read_text()
            )
        }
        split = source["metadata"]["recall_audit"]["split"]
        all_questions = json.loads(
            (root / source["dataset"] / "questions.json").read_text()
        )
        wanted = {
            q["id"] for q in all_questions if split == "all" or q["split"] == split
        }
        ids = [row["id"] for row in source["rows"]]
        if len(ids) != len(set(ids)) or set(ids) != wanted:
            raise ValueError("incomplete or duplicate source rows")
        for row in source["rows"]:
            pool_ids = [p["chunkId"] for p in row["pool"]]
            if len(pool_ids) != len(set(pool_ids)):
                raise ValueError("duplicate pool candidates")
            query = questions[row["id"]]
            tasks.append(
                {
                    "source": source["id"],
                    "id": row["id"],
                    "query": query,
                    "pool": row["pool"],
                    "pair_keys": [pair_key(query, p) for p in row["pool"]],
                }
            )
    return tasks


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    protocol = json.loads(args.protocol.read_text())
    tasks = load_inputs(root, protocol)
    config = next(m for m in protocol["models"] if m["id"] == args.model)
    versions = {name: importlib.metadata.version(name) for name in protocol["runtime"]}
    if versions != protocol["runtime"]:
        raise ValueError("runtime package versions differ")
    args.output.mkdir(parents=True, exist_ok=True)
    import torch

    header = {
        "protocol_sha256": fingerprint(protocol),
        "model": config,
        "runtime": versions,
        "execution": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "device": "mps" if torch.backends.mps.is_available() else "cpu",
            "precision": config.get("precision", "float32"),
            "cpu_threads": 4,
        },
    }
    metadata = args.output / f"{args.model}-metadata.json"
    if metadata.exists() and json.loads(metadata.read_text()) != header:
        raise ValueError("checkpoint protocol or model fingerprint differs")
    metadata.write_text(json.dumps(header, indent=2) + "\n")

    def progress(records):
        if len(records) % 10 == 0 or len(records) == len(tasks):
            print(
                json.dumps(
                    {
                        "model": args.model,
                        "completed": len(records),
                        "total": len(tasks),
                        "inference_seconds": round(
                            sum(r["elapsed_ms"] for r in records) / 1000, 2
                        ),
                    }
                ),
                flush=True,
            )

    records = run_tasks(
        tasks,
        args.output / f"{args.model}-checkpoint.jsonl",
        lambda: CrossEncoder(config, protocol["model_input"], args.model_root),
        progress,
    )
    result = {**header, "complete": True, "rows": records}
    output = args.output / f"{args.model}-scores.json"
    temporary = output.with_suffix(".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False) + "\n")
    temporary.replace(output)


if __name__ == "__main__":
    main()
