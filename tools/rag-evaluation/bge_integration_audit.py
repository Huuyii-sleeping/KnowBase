"""Grade unchanged single-context consumption after the BGE integration replay."""

import argparse
import hashlib
import json
import math
from pathlib import Path
from statistics import mean

from rerank_metrics import evidence_changes, grade_selection


def fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def validate_rows(protocol, replay, original):
    if (
        replay.get("complete") is not True
        or replay.get("mode") != "replay"
        or replay.get("protocol_sha256") != fingerprint(protocol)
    ):
        raise ValueError("incomplete or foreign integration replay")
    expected = [
        (source, row) for source in original["sources"] for row in source["rows"]
    ]
    if len(expected) != len(replay["rows"]):
        raise ValueError("incomplete replay rows")
    for case, (source, row) in zip(replay["rows"], expected):
        if (case["source"], case["id"]) != (source["id"], row["id"]):
            raise ValueError("replay identity differs")
        bge = row["options"]["bge-m3-anchor2-model-order"]["selected"]
        if case["selected"] != bge:
            raise ValueError("BGE admission or order differs")
        for field, selected in [
            ("baseline_grounded", row["options"]["rule"]["selected"]),
            ("bge_grounded", bge),
        ]:
            ids = case[field]
            if (
                len(ids) > 1
                or len(set(ids)) != len(ids)
                or not set(ids) <= set(selected)
            ):
                raise ValueError("invalid grounded selection")
    return expected


def grade(root, protocol, replay, original):
    expected = validate_rows(protocol, replay, original)
    questions = {
        s["id"]: {
            q["id"]: q
            for q in json.loads((root / s["dataset"] / "questions.json").read_text())
        }
        for s in original["sources"]
    }
    results = []
    for case, (source, row) in zip(replay["rows"], expected):
        q = questions[source["id"]][row["id"]]
        pool = {p["chunkId"]: p for p in row["pool"]}
        mapping = {d["file"]: d["id"] for d in source["metadata"]["document_mapping"]}
        baseline = [pool[c] for c in case["baseline_grounded"]]
        bge = [pool[c] for c in case["bge_grounded"]]
        results.append(
            {
                "source": source["id"],
                "id": q["id"],
                "split": q["split"],
                "type": q["type"],
                "baseline": grade_selection(q, row["pool"], baseline, mapping),
                "bge": grade_selection(q, row["pool"], bge, mapping),
                "changes": evidence_changes(q, baseline, bge, mapping),
                "baseline_grounded": case["baseline_grounded"],
                "bge_grounded": case["bge_grounded"],
            }
        )
    summaries = []
    for source, split in sorted({(x["source"], x["split"]) for x in results}):
        rows = [x for x in results if (x["source"], x["split"]) == (source, split)]
        positive = [x for x in rows if x["type"] == "answerable"]
        summary = {
            "source": source,
            "split": split,
            "questions": len(rows),
            "answerable": len(positive),
        }
        for strategy in ("baseline", "bge"):
            for metric in ("evidence_recall", "all_evidence_found"):
                summary[f"{strategy}_grounded_{metric}"] = (
                    mean(x[strategy][metric] for x in positive) if positive else None
                )
        for change in ("gained", "lost"):
            summary[f"evidence_{change}"] = sum(len(x["changes"][change]) for x in rows)
        summaries.append(summary)
    return {
        "scope": "Exposed fixed pools through unchanged grounding limit1; no generated answers or label edits",
        "protocol_sha256": replay["protocol_sha256"],
        "summaries": summaries,
        "grounded_changes": [x for x in results if any(x["changes"].values())],
        "all_grounded_losses": [x for x in results if x["changes"]["lost"]],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--replay", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    protocol = json.loads(args.protocol.read_text())
    # Validate the original labels as well as the replay/implementation files.
    parent = json.loads((root / protocol["model_protocol"]).read_text())
    for file, expected in {
        **parent["input_files_sha256"],
        **protocol["files_sha256"],
    }.items():
        if hashlib.sha256((root / file).read_bytes()).hexdigest() != expected:
            raise ValueError("input or implementation fingerprint differs: " + file)
    result = grade(
        root,
        protocol,
        json.loads(args.replay.read_text()),
        json.loads((root / protocol["replay"]).read_text()),
    )
    result["replay_sha256"] = hashlib.sha256(args.replay.read_bytes()).hexdigest()
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result["summaries"], ensure_ascii=False))


if __name__ == "__main__":
    main()
