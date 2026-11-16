from __future__ import annotations

import math
import re
import unicodedata
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
        # Grade the returned order, not a second ranking inferred from API scores.
        run.append(ScoredDoc(question_id, document_id, float(len(items) - rank)))
    return run


def normalized(value: str) -> str:
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", value))


def evidence_recall(
    question: dict[str, Any],
    items: list[dict[str, Any]],
    lookup: dict[str, str],
    mode: str,
) -> float | None:
    evidence = question.get("evidence", [])
    if mode == "keyword" or not evidence:
        return None
    hits = sum(
        any(
            str(item.get("documentId", item.get("id", ""))) == lookup[entry["doc"]]
            and normalized(entry["quote"]) in normalized(str(item.get("content", "")))
            for item in items
        )
        for entry in evidence
    )
    return round(hits / len(evidence), 4)


def summarize(
    questions: list[dict[str, Any]],
    rows: list[dict[str, Any]],
    qrels: list[Any],
    runs: list[ScoredDoc],
    top_k: int,
    mode: str,
) -> dict[str, Any]:
    positive = [row for row in rows if row["type"] == "answerable"]
    negative = [row for row in rows if row["type"] == "unanswerable"]
    positive_ids = {row["id"] for row in positive}
    measures = [P @ top_k, R @ top_k, RR, nDCG @ top_k]
    values = (
        calc_aggregate(
            measures,
            [q for q in qrels if q.query_id in positive_ids],
            [r for r in runs if r.query_id in positive_ids],
        )
        if positive
        else {}
    )
    annotated = [
        row["evidence_recall"] for row in positive if row["evidence_recall"] is not None
    ]
    latency = sorted(row["latency_ms"] for row in rows)
    return {
        "questions": len(rows),
        "answerable_questions": len(positive),
        "unanswerable_questions": len(negative),
        "mode": mode,
        "top_k": top_k,
        "precision_at_k": round(float(values[P @ top_k]), 4) if positive else None,
        "recall_at_k": round(float(values[R @ top_k]), 4) if positive else None,
        "mrr": round(float(values[RR]), 4) if positive else None,
        "ndcg_at_k": round(float(values[nDCG @ top_k]), 4) if positive else None,
        "hit_rate": (
            round(mean(row["hit"] for row in positive), 4) if positive else None
        ),
        "all_gold_hit_rate": (
            round(mean(row["all_gold_found"] for row in positive), 4)
            if positive
            else None
        ),
        "evidence_recall": round(mean(annotated), 4) if annotated else None,
        "negative_empty_rate": (
            round(mean(row["api_result_count"] == 0 for row in negative), 4)
            if negative
            else None
        ),
        "average_latency_ms": round(mean(row["latency_ms"] for row in rows), 2),
        "p95_latency_ms": round(latency[math.ceil(len(latency) * 0.95) - 1], 2),
    }
