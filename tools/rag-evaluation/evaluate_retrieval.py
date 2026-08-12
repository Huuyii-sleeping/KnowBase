#!/usr/bin/env python3
"""Run standard retrieval metrics against the KnowBase HTTP API."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

from evaluation_types import EvaluationConfig
from knowbase_client import KnowBaseClient
from metrics import build_run, summarize, unique_results
from question_set import document_lookup, gold_documents, load_questions, resolve_qrels
from report import write_outputs, write_trec_files


def evaluate(config: EvaluationConfig, client: KnowBaseClient) -> dict:
    questions = load_questions(config.questions_path)
    lookup = document_lookup(client.list_documents())
    qrels, resolved = resolve_qrels(questions, lookup)
    runs = []
    rows = []

    for question in questions:
        question_id = str(question["id"])
        items, latency_ms = client.search(question["question"], config.top_k, config.mode)
        deduplicated = unique_results(items)[: config.top_k]
        question_run = build_run(question_id, deduplicated)
        runs.extend(question_run)
        retrieved_ids = [item.doc_id for item in question_run]
        relevant_ids = resolved[question_id]
        rows.append(
            {
                "id": question_id,
                "question": question["question"],
                "gold_documents": gold_documents(question),
                "gold_document_ids": relevant_ids,
                "retrieved_document_ids": retrieved_ids,
                "retrieved": [
                    {
                        "document_id": item.doc_id,
                        "score": item.score,
                        "title": deduplicated[index].get(
                            "title", deduplicated[index].get("document", {}).get("title", "")
                        ),
                    }
                    for index, item in enumerate(question_run)
                ],
                "hit": bool(set(retrieved_ids) & set(relevant_ids)),
                "latency_ms": latency_ms,
            }
        )

    return {
        "summary": summarize(questions, rows, qrels, runs, config.top_k, config.mode),
        "results": rows,
    }


def parse_args() -> EvaluationConfig:
    parser = argparse.ArgumentParser(description="Evaluate KnowBase retrieval with RAGBench-CN.")
    parser.add_argument(
        "--base-url",
        default=os.getenv("KNOWBASE_API_URL", "http://localhost:3000/api/v1"),
    )
    parser.add_argument(
        "--questions",
        type=Path,
        default=Path("benchmarks/ragbench-cn/questions/questions_zh.json"),
    )
    parser.add_argument("--output-dir", type=Path, default=Path("reports/retrieval"))
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--mode", choices=["hybrid", "semantic"], default="hybrid")
    parser.add_argument("--timeout", type=float, default=60)
    args = parser.parse_args()
    if not 1 <= args.top_k <= 20:
        parser.error("--top-k must be between 1 and 20")
    return EvaluationConfig(
        base_url=args.base_url,
        questions_path=args.questions,
        output_dir=args.output_dir,
        top_k=args.top_k,
        mode=args.mode,
        timeout_seconds=args.timeout,
    )


def main() -> int:
    config = parse_args()
    try:
        payload = evaluate(config, KnowBaseClient(config.base_url, config.timeout_seconds))
        write_outputs(payload, config.output_dir)
        write_trec_files(payload, config.output_dir)
    except (OSError, ValueError, requests.RequestException) as error:
        print(f"retrieval evaluation failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(payload["summary"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
