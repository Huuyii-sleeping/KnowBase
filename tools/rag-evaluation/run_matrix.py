"""Run an unchanged retrieval implementation at several candidate budgets."""

from __future__ import annotations

import argparse
import json
import os
import platform
from pathlib import Path

from benchmark_dataset import validate_dataset
from evaluate_retrieval import evaluate
from evaluation_types import EvaluationConfig
from knowbase_client import KnowBaseClient
from question_set import load_questions
from report import write_comparison, write_outputs, write_trec_files
import ir_measures


def run_matrix(
    base_url: str, dataset: Path, output: Path, token: str, metadata: dict
) -> list[dict]:
    validate_dataset(dataset)
    client = KnowBaseClient(base_url, 60)
    client.login(access_token=token)
    questions = load_questions(dataset / "questions.json")
    metadata = {
        **metadata,
        "python_version": platform.python_version(),
        "ir_measures_version": ir_measures.__version__,
    }
    payloads = []
    for mode in ("keyword", "semantic", "hybrid"):
        client.search(questions[0]["question"], 5, mode)  # Untimed warm-up.
        for top_k in (1, 3, 5):
            directory = output / f"{mode}-k{top_k}"
            config = EvaluationConfig(
                base_url,
                dataset / "questions.json",
                directory,
                top_k,
                mode,
                60,
                access_token=token,
            )
            payload = evaluate(config, client)
            write_outputs(payload, directory)
            write_trec_files(payload, directory)
            payloads.append(payload)
            print(json.dumps(payload["summary"], ensure_ascii=False), flush=True)
    write_comparison(payloads, metadata, output)
    return payloads


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    args = parser.parse_args()
    token = os.environ.get("KNOWBASE_TOKEN")
    if not token:
        parser.error("KNOWBASE_TOKEN is required")
    run_matrix(
        args.base_url,
        args.dataset,
        args.output_dir,
        token,
        json.loads(args.metadata.read_text(encoding="utf-8")),
    )
