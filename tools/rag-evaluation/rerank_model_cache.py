"""Persist complete query results and validate restart/deduplication identity."""

import json
import math


def validate_record(record, task):
    if any(record[k] != task[k] for k in ("source", "id", "pair_keys")):
        raise ValueError("checkpoint task differs")
    if len(record["scores"]) != len(task["pool"]) or len(record["diagnostics"]) != len(
        task["pool"]
    ):
        raise ValueError("incomplete checkpoint scores")
    if any(not math.isfinite(s) for s in record["scores"]):
        raise ValueError("nonfinite checkpoint scores")
    if any(d["windows"] < 1 for d in record["diagnostics"]):
        raise ValueError("invalid checkpoint windows")
    if not math.isfinite(record["elapsed_ms"]) or record["elapsed_ms"] < 0:
        raise ValueError("invalid checkpoint timing")


def run_tasks(tasks, checkpoint, model_factory, on_progress=lambda _: None):
    records = []
    if checkpoint.exists():
        records = [json.loads(line) for line in checkpoint.read_text().splitlines()]
    if len(records) > len(tasks):
        raise ValueError("checkpoint exceeds task count")
    cache = {}
    for record, task in zip(records, tasks):
        validate_record(record, task)
        for key, score, stats in zip(
            task["pair_keys"], record["scores"], record["diagnostics"]
        ):
            if key in cache and cache[key] != (score, stats):
                raise ValueError("conflicting cached pair")
            cache[key] = (score, stats)
    model = model_factory() if len(records) < len(tasks) else None
    if model is not None:
        # Warm only on a synthetic health input, never an evaluation question.
        model.score("What is the color?", [{"title": "Health", "content": "Blue."}])
    with checkpoint.open("a") as handle:
        for task in tasks[len(records) :]:
            missing = {}
            for key, candidate in zip(task["pair_keys"], task["pool"]):
                if key not in cache:
                    missing[key] = candidate
            result = (
                model.score(task["query"], list(missing.values()))
                if missing
                else {"scores": [], "diagnostics": [], "elapsed_ms": 0}
            )
            if len(result["scores"]) != len(missing) or len(
                result["diagnostics"]
            ) != len(missing):
                raise ValueError("incomplete model result")
            additions = dict(zip(missing, zip(result["scores"], result["diagnostics"])))
            prospective = {**cache, **additions}
            record = {
                "source": task["source"],
                "id": task["id"],
                "pair_keys": task["pair_keys"],
                "scores": [prospective[k][0] for k in task["pair_keys"]],
                "diagnostics": [prospective[k][1] for k in task["pair_keys"]],
                "elapsed_ms": result["elapsed_ms"],
                "new_pairs": len(missing),
                "cached_pairs": len(task["pool"]) - len(missing),
            }
            validate_record(record, task)
            handle.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n")
            handle.flush()
            cache.update(additions)
            records.append(record)
            on_progress(records)
    return records
