"""Locate evidence loss before and after candidate selection in isolated runs."""

from __future__ import annotations

import argparse
import gzip
import json
import math
from pathlib import Path
from statistics import mean

from benchmark_dataset import validate_dataset
from metrics import normalized
from recall_acceptance import assess, select_development_budget
from recall_report import render_report
from question_set import load_questions
from recall_loss import locate_loss, route_details


def evidence_hits(question: dict, candidates: list[dict], mapping: dict) -> list[bool]:
    return [
        any(
            item["documentId"] == mapping[e["doc"]]
            and normalized(e["quote"]) in normalized(item.get("content", ""))
            for item in candidates
        )
        for e in question.get("evidence", [])
    ]


def grade(question: dict, candidates: list[dict], mapping: dict) -> dict:
    gold = {mapping[file] for file in question["gold_docs"]}
    found = {item["documentId"] for item in candidates}
    hits = evidence_hits(question, candidates, mapping)
    return {
        "document_recall": len(gold & found) / len(gold) if gold else None,
        "all_sources_found": gold <= found if gold else None,
        "evidence_recall": mean(hits) if hits else None,
        "all_evidence_found": all(hits) if hits else None,
        "evidence_hits": hits,
        "candidate_count": len(candidates),
        "unique_document_count": len(found),
    }


def summarize(rows: list[dict], stage: str) -> dict:
    positive = [row["stages"][stage] for row in rows if row["type"] == "answerable"]
    negative = [row["stages"][stage] for row in rows if row["type"] == "unanswerable"]
    result = {
        "questions": len(rows),
        "answerable": len(positive),
        "unanswerable": len(negative),
    }
    for key in (
        "document_recall",
        "all_sources_found",
        "evidence_recall",
        "all_evidence_found",
    ):
        result[key] = (
            round(mean(item[key] for item in positive), 4) if positive else None
        )
    result["mean_candidate_count"] = round(
        mean(row["stages"][stage]["candidate_count"] for row in rows), 2
    )
    result["negative_empty_rate"] = (
        mean(item["candidate_count"] == 0 for item in negative) if negative else None
    )
    return result


def analyze(directory: Path, output: Path) -> dict:
    validate_dataset(directory)
    questions = {q["id"]: q for q in load_questions(directory / "questions.json")}
    metadata = json.loads((output / "metadata.json").read_text())
    split = metadata["recall_audit"].get("split", "all")
    questions = {
        key: q
        for key, q in questions.items()
        if split == "all" or q.get("split") == split
    }
    mapping = {item["file"]: item["id"] for item in metadata["document_mapping"]}
    corpus = json.loads((output / "indexed-corpus.json").read_text())
    trace_path = output / "recall-traces.json"
    if trace_path.is_file():
        traces = json.loads(trace_path.read_text())
    else:
        with gzip.open(output / "recall-traces.json.gz", "rt", encoding="utf-8") as f:
            traces = json.load(f)
    query_mode = metadata["recall_audit"].get("query_mode", "off")
    if any(trace.get("queryMode", "off") != query_mode for trace in traces):
        raise ValueError("trace query mode differs from metadata")
    keyword_mode = metadata["recall_audit"].get("keyword_query_mode", "off")
    if any(trace.get("keywordQueryMode", "off") != keyword_mode for trace in traces):
        raise ValueError("trace keyword query mode differs from metadata")
    match_mode = metadata["recall_audit"].get("keyword_match_mode", "off")
    if any(trace.get("keywordMatchMode", "off") != match_mode for trace in traces):
        raise ValueError("trace keyword match mode differs from metadata")
    eligibility = [
        "eligibleCandidates" in trace[route]
        for trace in traces
        for route in ("keyword", "semantic")
    ]
    if any(eligibility) and not all(eligibility):
        raise ValueError("incomplete eligibility diagnostics")
    budgets = metadata["recall_audit"]["budgets"]
    identities = [(t["id"], t["budget"]) for t in traces]
    if len(set(identities)) != len(identities) or set(identities) != {
        (q, b) for q in questions for b in budgets
    }:
        raise ValueError("incomplete or duplicate recall audit traces")
    pairs = metadata["recall_audit"].get("route_budgets")
    if pairs is not None:
        allocations = {pair["id"]: pair for pair in pairs}
        if len(allocations) != len(pairs) or set(allocations) != set(budgets):
            raise ValueError("inconsistent recall route budget metadata")
        for trace in traces:
            pair = allocations[trace["budget"]]
            if (trace.get("keywordBudget"), trace.get("semanticBudget")) != (
                pair["keyword"],
                pair["semantic"],
            ):
                raise ValueError("trace route budgets differ from metadata")
    rows = []
    for trace in traces:
        q = questions[trace["id"]]
        candidates = {
            "indexed": corpus,
            "keyword_raw": trace["keyword"]["rawCandidates"],
            "keyword": trace["keyword"]["items"],
            "semantic_raw": trace["semantic"]["rawCandidates"],
            "semantic": trace["semantic"]["items"],
            "pool": trace["pool"],
            "selected": trace["selected"],
        }
        if all(eligibility):
            for route in ("keyword", "semantic"):
                candidates[f"{route}_eligible"] = trace[route]["eligibleCandidates"]
        stages = {name: grade(q, items, mapping) for name, items in candidates.items()}
        losses = []
        for i, evidence in enumerate(q.get("evidence", [])):

            cause = locate_loss(stages, i)
            if cause is None:
                continue
            losses.append(
                {
                    "doc": evidence["doc"],
                    "quote": evidence["quote"],
                    "cause": cause,
                    "routes": route_details(evidence, trace, mapping),
                }
            )
        rows.append(
            {
                "id": q["id"],
                "question": q["question"],
                "type": q["type"],
                "category": q["category"],
                "split": q.get("split", "development"),
                "budget": trace["budget"],
                "keyword_budget": trace.get("keywordBudget", trace["budget"]),
                "semantic_budget": trace.get("semanticBudget", trace["budget"]),
                "stages": stages,
                "losses": losses,
                "elapsed_ms": trace["elapsedMs"],
                "keyword_ms": trace["keyword"]["elapsedMs"],
                "semantic_ms": trace["semantic"]["elapsedMs"],
                "route_timings": {
                    route: trace[route].get("timings")
                    for route in ("keyword", "semantic")
                },
                "query_plans": {
                    route: trace[route].get("queryPlan")
                    for route in ("keyword", "semantic")
                },
                "keyword_match_targets": trace.get("keywordMatchTargets", []),
            }
        )
    summaries = []
    for split in sorted({r["split"] for r in rows}):
        for budget in budgets:
            subset = [r for r in rows if r["split"] == split and r["budget"] == budget]
            latency = sorted(r["elapsed_ms"] for r in subset)
            summaries.append(
                {
                    "split": split,
                    "budget_per_route": budget,
                    "route_budgets": next(
                        (
                            p
                            for p in metadata["recall_audit"].get("route_budgets", [])
                            if p["id"] == budget
                        ),
                        None,
                    ),
                    "stages": {
                        stage: summarize(subset, stage) for stage in rows[0]["stages"]
                    },
                    "by_category": {
                        category: {
                            stage: summarize(
                                [r for r in subset if r["category"] == category], stage
                            )
                            for stage in ("keyword", "semantic", "pool", "selected")
                        }
                        for category in sorted({r["category"] for r in subset})
                    },
                    "mean_ms": round(mean(latency), 2),
                    "p95_ms": round(latency[math.ceil(len(latency) * 0.95) - 1], 2),
                }
            )
    protocol_path = directory / "protocol.json"
    if protocol_path.exists():
        protocol = json.loads(protocol_path.read_text())
        for summary in summaries:
            summary["acceptance"] = assess(summary, rows, protocol)
    payload = {"metadata": metadata, "summaries": summaries, "results": rows}
    if protocol_path.exists():
        payload["selected_development_budget"] = select_development_budget(summaries)
    (output / "recall-audit.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    )
    (output / "recall-audit.md").write_text(
        render_report(
            summaries, rows, budgets, payload.get("selected_development_budget")
        )
    )
    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    result = analyze(args.dataset, args.output_dir)
    print(
        json.dumps(
            [
                {k: s[k] for k in ("split", "budget_per_route", "mean_ms", "p95_ms")}
                for s in result["summaries"]
            ]
        )
    )
