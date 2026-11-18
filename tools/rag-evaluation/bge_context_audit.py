"""Compare bounded multi-context consumption with the archived single-context run."""

import argparse
import hashlib
import json
from pathlib import Path
from statistics import mean

from bge_integration_audit import fingerprint, validate_rows as validate_single
from rerank_metrics import evidence_changes, grade_selection


def validate_multi(protocol, replay, original):
    if (
        replay.get("complete") is not True
        or replay.get("mode") != "replay"
        or replay.get("protocol_sha256") != fingerprint(protocol)
    ):
        raise ValueError("incomplete or foreign context replay")
    expected = [(s, r) for s in original["sources"] for r in s["rows"]]
    if len(expected) != len(replay["rows"]):
        raise ValueError("incomplete context rows")
    for actual, (source, row) in zip(replay["rows"], expected):
        bge = row["options"]["bge-m3-anchor2-model-order"]["selected"]
        if (actual["source"], actual["id"]) != (source["id"], row["id"]) or actual[
            "selected"
        ] != bge:
            raise ValueError("identity or BGE selection differs")
        pool = {x["chunkId"]: x for x in row["pool"]}
        for field, selected in [
            ("baseline_grounded", row["options"]["rule"]["selected"]),
            ("bge_grounded", bge),
        ]:
            ids = actual[field]
            if (
                len(ids) > 5
                or len(set(ids)) != len(ids)
                or not set(ids) <= set(selected)
            ):
                raise ValueError("invalid context IDs")
            bodies = [pool[x].get("content") or "" for x in ids]
            # JS budget uses UTF-16 code units, not Python Unicode code points.
            size = sum(len(x.encode("utf-16-le")) // 2 for x in bodies)
            if any(not x.strip() for x in bodies) or (len(ids) > 1 and size > 6000):
                raise ValueError("invalid context budget")
    return expected


def grade(root, protocol, multi, original, single_protocol, single):
    expected = validate_multi(protocol, multi, original)
    validate_single(single_protocol, single, original)
    questions = {
        s["id"]: {
            q["id"]: q
            for q in json.loads((root / s["dataset"] / "questions.json").read_text())
        }
        for s in original["sources"]
    }
    results = []
    for actual, old, (source, row) in zip(multi["rows"], single["rows"], expected):
        q = questions[source["id"]][row["id"]]
        pool = {p["chunkId"]: p for p in row["pool"]}
        mapping = {d["file"]: d["id"] for d in source["metadata"]["document_mapping"]}
        selections = {
            "rule_single": old["baseline_grounded"],
            "bge_single": old["bge_grounded"],
            "rule_multi": actual["baseline_grounded"],
            "bge_multi": actual["bge_grounded"],
        }
        items = {k: [pool[x] for x in ids] for k, ids in selections.items()}
        comparisons = {
            "rule_fix": ("rule_single", "rule_multi"),
            "bge_fix": ("bge_single", "bge_multi"),
            "bge_vs_rule_multi": ("rule_multi", "bge_multi"),
            "bge_multi_vs_old_default": ("rule_single", "bge_multi"),
        }
        results.append(
            {
                "source": source["id"],
                "id": q["id"],
                "split": q["split"],
                "type": q["type"],
                "metrics": {
                    k: grade_selection(q, row["pool"], v, mapping)
                    for k, v in items.items()
                },
                "changes": {
                    k: evidence_changes(q, items[b], items[a], mapping)
                    for k, (b, a) in comparisons.items()
                },
                "contexts": selections,
            }
        )
    summaries = []
    for source, split in sorted({(r["source"], r["split"]) for r in results}):
        rows = [r for r in results if (r["source"], r["split"]) == (source, split)]
        positive = [r for r in rows if r["type"] == "answerable"]
        negative = [r for r in rows if r["type"] == "unanswerable"]
        summaries.append(
            {
                "source": source,
                "split": split,
                "questions": len(rows),
                "strategies": {
                    k: {
                        "evidence_recall": mean(
                            r["metrics"][k]["evidence_recall"] for r in positive
                        ),
                        "all_evidence_found": mean(
                            r["metrics"][k]["all_evidence_found"] for r in positive
                        ),
                        "all_sources_found": mean(
                            r["metrics"][k]["all_sources_found"] for r in positive
                        ),
                        "negative_empty_rate": (
                            mean(
                                r["metrics"][k]["candidate_count"] == 0
                                for r in negative
                            )
                            if negative
                            else None
                        ),
                    }
                    for k in selections
                },
                "changes": {
                    k: {
                        c: sum(len(r["changes"][k][c]) for r in rows)
                        for c in ("gained", "lost")
                    }
                    for k in comparisons
                },
            }
        )
    old_loss_ids = {
        (r["source"], r["id"])
        for r in results
        if any(
            b and not a
            for b, a in zip(
                r["metrics"]["rule_single"]["evidence_hits"],
                r["metrics"]["bge_single"]["evidence_hits"],
            )
        )
    }
    unrecovered = [
        r
        for r in results
        if (r["source"], r["id"]) in old_loss_ids
        and r["changes"]["bge_multi_vs_old_default"]["lost"]
    ]
    return {
        "scope": "Exposed fixed-pool context evidence, unchanged labels; NOT generated answer accuracy",
        "protocol_sha256": multi["protocol_sha256"],
        "summaries": summaries,
        "previous_single_context_loss_instances": len(old_loss_ids),
        "unrecovered_previous_losses": unrecovered,
        "remaining_bge_vs_rule_multi_losses": [
            r for r in results if r["changes"]["bge_vs_rule_multi"]["lost"]
        ],
        "results": results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--replay", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    read = lambda p: json.loads(Path(p).read_text())
    protocol = read(args.protocol)
    parent = read(root / protocol["model_protocol"])
    for file, expected in {
        **parent["input_files_sha256"],
        **protocol["files_sha256"],
    }.items():
        if hashlib.sha256((root / file).read_bytes()).hexdigest() != expected:
            raise ValueError("fingerprint differs: " + file)
    result = grade(
        root,
        protocol,
        read(args.replay),
        read(root / protocol["replay"]),
        read(root / protocol["single_protocol"]),
        read(root / protocol["single_replay"]),
    )
    result["replay_sha256"] = hashlib.sha256(args.replay.read_bytes()).hexdigest()
    with args.output.open("x") as handle:
        handle.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                k: v
                for k, v in result.items()
                if k
                not in (
                    "results",
                    "remaining_bge_vs_rule_multi_losses",
                    "unrecovered_previous_losses",
                )
            },
            ensure_ascii=False,
        )
    )
    print(
        "remaining losses:",
        [(r["source"], r["id"]) for r in result["remaining_bge_vs_rule_multi_losses"]],
    )


if __name__ == "__main__":
    main()
