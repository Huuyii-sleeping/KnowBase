#!/usr/bin/env python3
"""Evaluate grounded answers through the real KnowBase answer API."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from statistics import mean
from typing import Any

import requests


REFUSAL = "知识库中没有找到足够信息"


def load_cases(path: Path) -> list[dict[str, Any]]:
    cases = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(cases, list) or not cases:
        raise ValueError("answer dataset must be a non-empty JSON array")
    for case in cases:
        if not case.get("id") or not case.get("question"):
            raise ValueError("every answer case must contain id and question")
        if case.get("type") not in {"answerable", "unanswerable"}:
            raise ValueError(f"invalid case type: {case.get('type')}")
    return cases


def document_lookup(documents: list[dict[str, Any]]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for document in documents:
        document_id = str(document.get("id", ""))
        if not document_id:
            continue
        for key in (document.get("fileName"), document.get("title")):
            if key:
                lookup[str(key)] = document_id
    return lookup


def contains_all(text: str, terms: list[str]) -> float:
    if not terms:
        return 1.0
    normalized = text.lower()
    return sum(term.lower() in normalized for term in terms) / len(terms)


def citation_ids(response: dict[str, Any]) -> set[str]:
    return {
        str(citation.get("documentId"))
        for citation in response.get("citations", [])
        if citation.get("documentId")
    }


def evaluate_case(
    case: dict[str, Any], response: dict[str, Any], lookup: dict[str, str], latency_ms: float
) -> dict[str, Any]:
    answer = str(response.get("answer", ""))
    contexts = response.get("contexts", [])
    context_text = "\n".join(str(item.get("content", "")) for item in contexts)
    gold_ids = {lookup[name] for name in case.get("gold_docs", []) if name in lookup}
    cited_ids = citation_ids(response)
    answerable = case["type"] == "answerable"
    refusal = answer.strip() == REFUSAL
    facts = [str(fact) for fact in case.get("required_facts", [])]

    if answerable:
        citation_correctness = 1.0 if cited_ids & gold_ids else 0.0
        citation_completeness = 1.0 if cited_ids and cited_ids <= gold_ids else 0.0
        refusal_accuracy = 1.0 if not refusal else 0.0
    else:
        citation_correctness = 1.0 if not cited_ids else 0.0
        citation_completeness = 1.0 if not cited_ids else 0.0
        refusal_accuracy = 1.0 if refusal else 0.0

    return {
        "id": case["id"],
        "question": case["question"],
        "type": case["type"],
        "answer": answer,
        "citations": response.get("citations", []),
        "context_count": len(contexts),
        "latency_ms": latency_ms,
        "answer_fact_coverage": round(contains_all(answer, facts), 4),
        "context_fact_support": round(contains_all(context_text, facts), 4),
        "citation_correctness": citation_correctness,
        "citation_completeness": citation_completeness,
        "refusal_accuracy": refusal_accuracy,
        "passed": (
            (not answerable or contains_all(answer, facts) >= 0.5)
            and (not answerable or citation_correctness == 1.0)
            and (not answerable or not refusal)
            and (answerable or refusal)
        ),
    }


def evaluate(base_url: str, dataset: Path, top_k: int, timeout: float) -> dict[str, Any]:
    session = requests.Session()
    documents_response = session.get(
        f"{base_url.rstrip('/')}/documents",
        params={"page": 1, "pageSize": 100},
        timeout=timeout,
    )
    documents_response.raise_for_status()
    lookup = document_lookup(documents_response.json().get("items", []))
    rows: list[dict[str, Any]] = []
    for case in load_cases(dataset):
        started = time.perf_counter()
        response = session.post(
            f"{base_url.rstrip('/')}/rag/answer",
            json={"question": case["question"], "topK": top_k},
            timeout=timeout,
        )
        response.raise_for_status()
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        rows.append(evaluate_case(case, response.json(), lookup, latency_ms))

    answerable_rows = [row for row in rows if row["type"] == "answerable"]
    summary = {
        "cases": len(rows),
        "answerable_cases": len(answerable_rows),
        "unanswerable_cases": len(rows) - len(answerable_rows),
        "pass_rate": round(sum(row["passed"] for row in rows) / len(rows), 4),
        "answer_fact_coverage": round(mean(row["answer_fact_coverage"] for row in answerable_rows), 4),
        "context_fact_support": round(mean(row["context_fact_support"] for row in answerable_rows), 4),
        "citation_correctness": round(mean(row["citation_correctness"] for row in rows), 4),
        "citation_completeness": round(mean(row["citation_completeness"] for row in rows), 4),
        "refusal_accuracy": round(mean(row["refusal_accuracy"] for row in rows), 4),
        "average_latency_ms": round(mean(row["latency_ms"] for row in rows), 2),
    }
    return {"summary": summary, "results": rows}


def write_report(payload: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "answer-result.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    summary = payload["summary"]
    lines = [
        "# KnowBase Answer Evaluation",
        "",
        "## Summary",
        "",
    ]
    for key, value in summary.items():
        lines.append(f"- {key}: {value}")
    lines.extend(["", "## Results", "", "| ID | Type | Pass | Facts | Citation | Refusal | Latency (ms) |", "| --- | --- | --- | ---: | ---: | ---: | ---: |"])
    for row in payload["results"]:
        lines.append(
            f"| {row['id']} | {row['type']} | {'yes' if row['passed'] else 'no'} | "
            f"{row['answer_fact_coverage']:.2f} | {row['citation_correctness']:.2f} | "
            f"{row['refusal_accuracy']:.2f} | {row['latency_ms']:.2f} |"
        )
    (output_dir / "answer-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate grounded answers with KnowBase.")
    parser.add_argument("--base-url", default=os.getenv("KNOWBASE_API_URL", "http://localhost:3000/api/v1"))
    parser.add_argument("--dataset", type=Path, default=Path("benchmarks/ragbench-cn/questions/answers_zh.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("reports/answer"))
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()
    try:
        payload = evaluate(args.base_url, args.dataset, args.top_k, args.timeout)
        write_report(payload, args.output_dir)
    except (OSError, ValueError, requests.RequestException) as error:
        print(f"answer evaluation failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
