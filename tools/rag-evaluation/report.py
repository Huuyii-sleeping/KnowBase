from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def write_outputs(payload: dict[str, Any], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "retrieval-result.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    summary = payload["summary"]
    lines = [
        "# KnowBase Retrieval Evaluation",
        "",
        "## Summary",
        "",
        f"- Questions: {summary['questions']}",
        f"- Mode: `{summary['mode']}`",
        f"- Top-K: {summary['top_k']}",
        f"- Precision@K: {summary['precision_at_k']:.4f}",
        f"- Recall@K: {summary['recall_at_k']:.4f}",
        f"- MRR: {summary['mrr']:.4f}",
        f"- NDCG@K: {summary['ndcg_at_k']:.4f}",
        f"- Hit rate: {summary['hit_rate']:.4f}",
        f"- Average latency: {summary['average_latency_ms']:.2f} ms",
        "",
        "## Results",
        "",
        "| ID | Hit | Retrieved | Gold | Latency (ms) | Question |",
        "| --- | --- | --- | --- | ---: | --- |",
    ]
    for row in payload["results"]:
        question = str(row["question"]).replace("|", "\\|")
        lines.append(
            f"| {row['id']} | {'yes' if row['hit'] else 'no'} | "
            f"{', '.join(row['retrieved_document_ids'])} | "
            f"{', '.join(row['gold_document_ids'])} | {row['latency_ms']:.2f} | "
            f"{question} |"
        )
    (output_dir / "retrieval-report.md").write_text(
        "\n".join(lines) + "\n", encoding="utf-8"
    )


def write_trec_files(payload: dict[str, Any], output_dir: Path) -> None:
    qrels_lines: list[str] = []
    run_lines: list[str] = []
    for row in payload["results"]:
        query_id = row["id"]
        for document_id in row["gold_document_ids"]:
            qrels_lines.append(f"{query_id} 0 {document_id} 1")
        for rank, item in enumerate(row["retrieved"], start=1):
            run_lines.append(
                f"{query_id} Q0 {item['document_id']} {rank} {item['score']} knowbase"
            )
    (output_dir / "qrels.txt").write_text(
        "\n".join(qrels_lines) + "\n", encoding="utf-8"
    )
    (output_dir / "run.txt").write_text("\n".join(run_lines) + "\n", encoding="utf-8")
