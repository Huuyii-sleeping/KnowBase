"""Evidence metrics for fixed candidate pools; no retrieval or strategy selection."""

from collections import Counter
import math
from statistics import mean

from recall_audit import evidence_hits, grade


def evidence_changes(question, baseline, selected, mapping):
    before = evidence_hits(question, baseline, mapping)
    after = evidence_hits(question, selected, mapping)
    return {
        "gained": [i for i, (b, a) in enumerate(zip(before, after)) if a and not b],
        "lost": [i for i, (b, a) in enumerate(zip(before, after)) if b and not a],
    }


def grade_selection(question, pool, selected, mapping):
    result = grade(question, selected, mapping)
    present = evidence_hits(question, pool, mapping)
    result["pool_evidence_recall"] = mean(present) if present else None
    result["pool_present_retention"] = (
        sum(result["evidence_hits"]) / sum(present) if any(present) else None
    )
    result["evidence_mrr"] = next(
        (
            1 / (index + 1)
            for index, candidate in enumerate(selected)
            if any(evidence_hits(question, [candidate], mapping))
        ),
        0 if present else None,
    )
    return result


def baseline_losses(question, pool, selected, decisions, mapping):
    in_pool = evidence_hits(question, pool, mapping)
    final = evidence_hits(question, selected, mapping)
    by_id = {decision["chunkId"]: decision for decision in decisions}
    losses = []
    for i, (present, found) in enumerate(zip(in_pool, final)):
        if not present or found:
            continue
        single = {"evidence": [question["evidence"][i]]}
        candidates = [
            by_id[item["chunkId"]]
            for item in pool
            if evidence_hits(single, [item], mapping)[0]
        ]
        losses.append({"evidence_index": i, "candidates": candidates})
    return losses


def summarize(rows):
    positive = [row for row in rows if row["type"] == "answerable"]
    result = {"questions": len(rows), "answerable": len(positive)}
    for key in (
        "document_recall",
        "all_sources_found",
        "evidence_recall",
        "all_evidence_found",
        "pool_evidence_recall",
        "pool_present_retention",
        "evidence_mrr",
    ):
        values = [
            row["metrics"][key] for row in positive if row["metrics"][key] is not None
        ]
        result[key] = round(mean(values), 6) if values else None
    for change in ("gained", "lost"):
        result[f"evidence_{change}"] = sum(len(row["changes"][change]) for row in rows)
    result["mean_selected_count"] = round(
        mean(row["metrics"]["candidate_count"] for row in rows), 2
    )
    result["negative_empty_rate"] = (
        mean(
            row["metrics"]["candidate_count"] == 0
            for row in rows
            if row["type"] == "unanswerable"
        )
        if len(positive) < len(rows)
        else None
    )
    result["baseline_loss_decisions"] = dict(
        Counter(
            "+".join(sorted({c["reason"] for c in loss["candidates"]}))
            for row in rows
            for loss in row["baseline_losses"]
        )
    )
    elapsed = sorted(row["elapsed_ms"] for row in rows)
    result["offline_selection_mean_ms"] = round(mean(elapsed), 4)
    result["offline_selection_p95_ms"] = round(
        elapsed[math.ceil(len(elapsed) * 0.95) - 1], 4
    )
    return result
