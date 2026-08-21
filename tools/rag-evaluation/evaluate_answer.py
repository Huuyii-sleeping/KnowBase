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

from knowbase_client import KnowBaseClient


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
        if case.get("expected_context_source") not in {None, "none", "document", "semantic", "keyword", "graph"}:
            raise ValueError(f"invalid expected_context_source: {case.get('expected_context_source')}")
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


def context_source_types(response: dict[str, Any]) -> set[str]:
    return {
        str(context.get("sourceType"))
        for context in response.get("contexts", [])
        if context.get("sourceType")
    }


def evaluate_case(
    case: dict[str, Any], response: dict[str, Any], lookup: dict[str, str], latency_ms: float
) -> dict[str, Any]:
    answer = str(response.get("answer", ""))
    contexts = response.get("contexts", [])
    context_text = "\n".join(str(item.get("content", "")) for item in contexts)
    gold_ids = {lookup[name] for name in case.get("gold_docs", []) if name in lookup}
    cited_ids = citation_ids(response)
    source_types = context_source_types(response)
    answerable = case["type"] == "answerable"
    refusal = answer.strip() == REFUSAL
    facts = [str(fact) for fact in case.get("required_facts", [])]
    expected_source = case.get("expected_context_source")
    source_correctness = (
        1.0
        if expected_source is None
        else float(
            (expected_source == "none" and not source_types)
            or (expected_source != "none" and expected_source in source_types)
        )
    )

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
        "context_source_types": sorted(source_types),
        "expected_context_source": expected_source,
        "latency_ms": latency_ms,
        "answer_fact_coverage": round(contains_all(answer, facts), 4),
        "context_fact_support": round(contains_all(context_text, facts), 4),
        "citation_correctness": citation_correctness,
        "citation_completeness": citation_completeness,
        "refusal_accuracy": refusal_accuracy,
        "context_source_correctness": source_correctness,
        "passed": (
            (not answerable or contains_all(answer, facts) >= 0.5)
            and (not answerable or citation_correctness == 1.0)
            and (not answerable or not refusal)
            and (answerable or refusal)
            and source_correctness == 1.0
        ),
    }


def evaluate(
    base_url: str,
    dataset: Path,
    top_k: int,
    timeout: float,
    username: str | None = None,
    password: str | None = None,
    access_token: str | None = None,
) -> dict[str, Any]:
    client = KnowBaseClient(base_url, timeout)
    client.login(username, password, access_token)
    lookup = document_lookup(client.list_documents())
    rows: list[dict[str, Any]] = []
    for case in load_cases(dataset):
        response, latency_ms = client.answer(case["question"], top_k)
        rows.append(evaluate_case(case, response, lookup, latency_ms))

    answerable_rows = [row for row in rows if row["type"] == "answerable"]
    source_rows = [row for row in rows if row["expected_context_source"] is not None]
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
        "context_source_accuracy": round(mean(row["context_source_correctness"] for row in source_rows), 4) if source_rows else 1.0,
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
    lines.extend(["", "## Results", "", "| ID | Type | Pass | Facts | Citation | Source | Refusal | Latency (ms) |", "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |"])
    for row in payload["results"]:
        lines.append(
            f"| {row['id']} | {row['type']} | {'yes' if row['passed'] else 'no'} | "
            f"{row['answer_fact_coverage']:.2f} | {row['citation_correctness']:.2f} | "
            f"{row['context_source_correctness']:.2f} | {row['refusal_accuracy']:.2f} | {row['latency_ms']:.2f} |"
        )
    (output_dir / "answer-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate grounded answers with KnowBase.")
    parser.add_argument("--base-url", default=os.getenv("KNOWBASE_API_URL", "http://localhost:3000/api/v1"))
    parser.add_argument("--username", default=os.getenv("KNOWBASE_USERNAME", "admin"))
    parser.add_argument("--password", default=os.getenv("KNOWBASE_PASSWORD", "knowbase-admin"))
    parser.add_argument("--token", default=os.getenv("KNOWBASE_TOKEN"))
    parser.add_argument("--dataset", type=Path, default=Path("benchmarks/ragbench-cn/questions/answers_zh.json"))
    parser.add_argument("--output-dir", type=Path, default=Path("reports/answer"))
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()
    try:
        payload = evaluate(
            args.base_url,
            args.dataset,
            args.top_k,
            args.timeout,
            args.username,
            args.password,
            args.token,
        )
        write_report(payload, args.output_dir)
    except (OSError, ValueError, requests.RequestException) as error:
        print(f"answer evaluation failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
