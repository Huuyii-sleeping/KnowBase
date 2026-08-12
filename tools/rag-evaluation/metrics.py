from __future__ import annotations

from statistics import mean
from typing import Any

from ir_measures import P, R, RR, ScoredDoc, calc_aggregate, nDCG


def unique_results(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        document_id = str(item.get("documentId", item.get("id", "")))
        if not document_id or document_id in seen:
            continue
        seen.add(document_id)
        result.append(item)
    return result


def build_run(question_id: str, items: list[dict[str, Any]]) -> list[ScoredDoc]:
    run: list[ScoredDoc] = []
    for rank, item in enumerate(unique_results(items)):
        document_id = str(item.get("documentId", item.get("id", "")))
        score = item.get("rerankScore", item.get("score", 0))
        try:
            numeric_score = float(score or 0)
        except (TypeError, ValueError):
            numeric_score = 0.0
        # Keep the API order when two candidates have exactly the same score.
        run.append(ScoredDoc(question_id, document_id, numeric_score - rank * 1e-9))
    return run


def summarize(
    questions: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    qrels: list[Any],
    runs: list[ScoredDoc],
    top_k: int,
    mode: str,
) -> dict[str, Any]:
    measures = [P @ top_k, R @ top_k, RR, nDCG @ top_k]
    values = calc_aggregate(measures, qrels, runs)
    return {
        "questions": len(questions),
        "mode": mode,
        "top_k": top_k,
        "precision_at_k": round(float(values[P @ top_k]), 4),
        "recall_at_k": round(float(values[R @ top_k]), 4),
        "mrr": round(float(values[RR]), 4),
        "ndcg_at_k": round(float(values[nDCG @ top_k]), 4),
        "hit_rate": round(sum(1 for row in rows if row["hit"]) / len(rows), 4),
        "average_latency_ms": round(mean(row["latency_ms"] for row in rows), 2),
    }
