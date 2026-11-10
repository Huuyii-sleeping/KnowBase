from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def display(value: Any) -> str:
    return "N/A" if value is None else f"{value:.4f}"


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
        f"- Answerable / unanswerable: {summary['answerable_questions']} / {summary['unanswerable_questions']}",
        f"- Precision@K: {display(summary['precision_at_k'])}",
        f"- Recall@K: {display(summary['recall_at_k'])}",
        f"- MRR@K: {display(summary['mrr'])}",
        f"- NDCG@K: {display(summary['ndcg_at_k'])}",
        f"- Hit rate: {display(summary['hit_rate'])}",
        f"- All gold documents found: {display(summary['all_gold_hit_rate'])}",
        f"- Annotated evidence recall: {display(summary['evidence_recall'])}",
        f"- Unanswerable queries returning no candidates: {display(summary['negative_empty_rate'])}",
        f"- Average latency: {summary['average_latency_ms']:.2f} ms",
        f"- P95 latency: {summary['p95_latency_ms']:.2f} ms",
        "",
        "Document ranking metrics exclude unanswerable queries. Evidence recall is an exact annotated quote check on returned content, not an LLM quality judgment. Keyword metadata has no evidence score. API TopK counts candidates; document metrics deduplicate those candidates without fetching extra results.",
        "",
        "## Categories",
        "",
        "| Category | Questions | Recall@K | MRR@K | Evidence |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for category, values in payload.get("by_category", {}).items():
        lines.append(
            f"| {category} | {values['questions']} | {display(values['recall_at_k'])} | {display(values['mrr'])} | {display(values['evidence_recall'])} |"
        )
    lines.extend(
        [
            "",
            "## Results",
            "",
            "| ID | Type | Hit | First relevant rank | Evidence | Retrieved files | Gold | Latency (ms) | Question |",
            "| --- | --- | --- | ---: | ---: | --- | --- | ---: | --- |",
        ]
    )
    for row in payload["results"]:
        question = str(row["question"]).replace("|", "\\|")
        lines.append(
            f"| {row['id']} | {row['type']} | {'yes' if row['hit'] else 'no'} | {row['first_relevant_rank'] or '-'} | {display(row['evidence_recall'])} | "
            f"{', '.join(item.get('file_name') or item['document_id'] for item in row['retrieved'])} | "
            f"{', '.join(row['gold_documents'])} | {row['latency_ms']:.2f} | "
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


def write_comparison(
    payloads: list[dict[str, Any]], metadata: dict[str, Any], output_dir: Path
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    comparison = {
        "metadata": metadata,
        "runs": [
            {"summary": payload["summary"], "by_category": payload["by_category"]}
            for payload in payloads
        ],
    }
    (output_dir / "comparison.json").write_text(
        json.dumps(comparison, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    lines = [
        "# KnowBase 检索基线",
        "",
        "| 模式 | K | 文档 Recall@K | MRR@K | nDCG@K | 全部来源命中率 | 证据召回 | 无答案空结果率 | 平均延迟 ms |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for payload in payloads:
        s = payload["summary"]
        lines.append(
            f"| {s['mode']} | {s['top_k']} | {display(s['recall_at_k'])} | {display(s['mrr'])} | {display(s['ndcg_at_k'])} | {display(s['all_gold_hit_rate'])} | {display(s['evidence_recall'])} | {display(s['negative_empty_rate'])} | {s['average_latency_ms']:.2f} |"
        )
    lines.extend(
        [
            "",
            "## 需要回看的样本",
            "",
            "只列最大 K 下未找到全部标准来源、证据不完整或正确来源未排第一的可回答问题。详情与原始候选见各模式的 JSON 报告。",
            "",
        ]
    )
    max_k = max(payload["summary"]["top_k"] for payload in payloads)
    for payload in payloads:
        if payload["summary"]["top_k"] != max_k:
            continue
        mode = payload["summary"]["mode"]
        lines.extend(
            [
                f"### {mode}",
                "",
                "| ID | 首个相关排名 | 全部来源 | 证据召回 | 问题 |",
                "| --- | ---: | --- | ---: | --- |",
            ]
        )
        for row in payload["results"]:
            if row["type"] == "answerable" and (
                not row["all_gold_found"]
                or row["first_relevant_rank"] != 1
                or row["evidence_recall"] not in {None, 1.0}
            ):
                question = row["question"].replace("|", "\\|")
                lines.append(
                    f"| {row['id']} | {row['first_relevant_rank'] or '-'} | {row['all_gold_found']} | {display(row['evidence_recall'])} | {question} |"
                )
    lines.extend(
        [
            "",
            "## 实验记录",
            "",
            "```json",
            json.dumps(metadata, ensure_ascii=False, indent=2),
            "```",
            "",
            "这是小规模开发评测集上的单次实测，不是盲测、压力测试或答案质量评测。无答案空结果率只描述检索器是否返回候选，不代表问答拒答准确率。",
        ]
    )
    (output_dir / "comparison.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
