"""Locate evidence loss before and after candidate selection in isolated runs."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from statistics import mean

from benchmark_dataset import validate_dataset
from metrics import normalized
from question_set import load_questions


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
    traces = json.loads((output / "recall-traces.json").read_text())
    budgets = metadata["recall_audit"]["budgets"]
    identities = [(t["id"], t["budget"]) for t in traces]
    if len(set(identities)) != len(identities) or set(identities) != {
        (q, b) for q in questions for b in budgets
    }:
        raise ValueError("incomplete or duplicate recall audit traces")
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
        stages = {name: grade(q, items, mapping) for name, items in candidates.items()}
        losses = []
        for i, evidence in enumerate(q.get("evidence", [])):

            def hit(stage):
                return stages[stage]["evidence_hits"][i]

            if not hit("indexed"):
                cause = "missing_or_split_in_index"
            elif not (hit("keyword_raw") or hit("semantic_raw")):
                cause = "not_in_raw_candidates"
            elif not (hit("keyword") or hit("semantic")):
                cause = "filtered_or_route_budget"
            elif not hit("pool"):
                cause = "merge_loss"
            elif not hit("selected"):
                cause = "selection_loss"
            else:
                continue
            losses.append(
                {"doc": evidence["doc"], "quote": evidence["quote"], "cause": cause}
            )
        rows.append(
            {
                "id": q["id"],
                "question": q["question"],
                "type": q["type"],
                "category": q["category"],
                "split": q.get("split", "development"),
                "budget": trace["budget"],
                "stages": stages,
                "losses": losses,
                "elapsed_ms": trace["elapsedMs"],
                "keyword_ms": trace["keyword"]["elapsedMs"],
                "semantic_ms": trace["semantic"]["elapsedMs"],
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
    payload = {"metadata": metadata, "summaries": summaries, "results": rows}
    (output / "recall-audit.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    )
    lines = [
        "# 召回逐阶段诊断",
        "",
        "| 问题组 | 每路预算 | 关键词证据 | 向量证据 | 合并证据 | 最终证据 | 合并候选数 | 平均/P95 ms |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for summary in summaries:
        stages = summary["stages"]
        values = [
            f"{stages[stage]['evidence_recall']:.2%}"
            for stage in ("keyword", "semantic", "pool", "selected")
        ]
        lines.append(
            f"| {summary['split']} | {summary['budget_per_route']} | "
            + " | ".join(values)
            + f" | {stages['pool']['mean_candidate_count']:.2f} | {summary['mean_ms']:.2f}/{summary['p95_ms']:.2f} |"
        )
    lines += [
        "",
        "## 默认 15 候选下的证据损失",
        "",
        "| 问题 | 分组 | 阶段 | 来源 |",
        "| --- | --- | --- | --- |",
    ]
    for row in rows:
        if row["budget"] == 15:
            for loss in row["losses"]:
                lines.append(
                    f"| {row['id']} | {row['split']} | {loss['cause']} | {loss['doc']} |"
                )
    lines += [
        "",
        "内部服务 IPC 诊断；真实 HTTP 路径只做一致性抽查。计时包括路由检索与元数据复查，不是生产 HTTP 延迟。无答案只统计候选，不判定问答拒答。合成验证题不是独立盲测。",
        "",
    ]
    (output / "recall-audit.md").write_text("\n".join(lines))
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
