"""Grade offline replay, choose on development only, then apply frozen gates."""

import argparse
import hashlib
import json
from pathlib import Path

from benchmark_dataset import validate_dataset
from rerank_metrics import baseline_losses, evidence_changes, grade_selection, summarize


def analyze(root, protocol, replay):
    canonical = json.dumps(protocol, ensure_ascii=False, separators=(",", ":"))
    if replay["protocol_sha256"] != hashlib.sha256(canonical.encode()).hexdigest():
        raise ValueError("replay protocol fingerprint differs")
    strategies = {item["id"]: item for item in protocol["strategies"]}
    expected_sources = {item["id"]: item for item in protocol["sources"]}
    actual_sources = [source["id"] for source in replay["sources"]]
    if len(set(actual_sources)) != len(actual_sources) or set(actual_sources) != set(
        expected_sources
    ):
        raise ValueError("incomplete or duplicate replay sources")
    rows = []
    for source in replay["sources"]:
        frozen = expected_sources[source["id"]]
        if any(source[k] != value for k, value in frozen.items()):
            raise ValueError("source fingerprint differs from protocol")
        dataset = root / source["dataset"]
        validate_dataset(dataset)
        questions = {
            q["id"]: q for q in json.loads((dataset / "questions.json").read_text())
        }
        split = source["metadata"]["recall_audit"]["split"]
        expected = {
            key for key, q in questions.items() if split == "all" or q["split"] == split
        }
        identities = [row["id"] for row in source["rows"]]
        if len(set(identities)) != len(identities) or set(identities) != expected:
            raise ValueError("incomplete or duplicate replay rows")
        mapping = {
            item["file"]: item["id"] for item in source["metadata"]["document_mapping"]
        }
        for row in source["rows"]:
            q = questions[row["id"]]
            if set(row["options"]) != set(strategies):
                raise ValueError("incomplete replay strategies")
            pool = row["pool"]
            by_id = {item["chunkId"]: item for item in pool}
            if len(by_id) != len(pool):
                raise ValueError("duplicate pool chunk IDs")
            selected = {}
            for strategy, result in row["options"].items():
                ids = result["selected"]
                config = strategies[strategy]
                if len(set(ids)) != len(ids) or not set(ids) <= set(by_id):
                    raise ValueError("selected items are not a unique subset of pool")
                if len(ids) > config.get("topK", 5):
                    raise ValueError("selection exceeds frozen TopK")
                selected[strategy] = [by_id[key] for key in ids]
            baseline = selected["rule"]
            losses = baseline_losses(
                q, pool, baseline, row["options"]["rule"]["decisions"], mapping
            )
            for strategy, items in selected.items():
                rows.append(
                    {
                        "source": source["id"],
                        "id": q["id"],
                        "split": q["split"],
                        "type": q["type"],
                        "category": q["category"],
                        "strategy": strategy,
                        "metrics": grade_selection(q, pool, items, mapping),
                        "changes": evidence_changes(q, baseline, items, mapping),
                        "baseline_losses": losses if strategy == "rule" else [],
                        "selected_chunk_ids": [item["chunkId"] for item in items],
                        "elapsed_ms": row["options"][strategy]["elapsedMs"],
                    }
                )
    summaries = []
    for source, split in sorted({(r["source"], r["split"]) for r in rows}):
        for strategy in strategies:
            subset = [
                r
                for r in rows
                if (r["source"], r["split"], r["strategy"]) == (source, split, strategy)
            ]
            summaries.append(
                {
                    "source": source,
                    "split": split,
                    "strategy": strategy,
                    **summarize(subset),
                    "by_category": {
                        category: summarize(
                            [r for r in subset if r["category"] == category]
                        )
                        for category in sorted({r["category"] for r in subset})
                    },
                }
            )
    decision = decide(protocol, summaries)
    return {
        "protocol_sha256": replay["protocol_sha256"],
        "summaries": summaries,
        "decision": decision,
        "results": rows,
    }


def decide(protocol, summaries):
    selection = protocol["selection"]
    development = [
        s
        for s in summaries
        if (s["source"], s["split"]) == (selection["source"], selection["split"])
    ]
    baseline = next(s for s in development if s["strategy"] == "rule")
    eligible = {
        s["id"]
        for s in protocol["strategies"]
        if s["id"] != "rule" and not s.get("diagnostic")
    }
    candidates = [s for s in development if s["strategy"] in eligible]
    chosen = max(
        candidates,
        key=lambda s: (
            s["evidence_recall"],
            s["all_evidence_found"],
            s["evidence_mrr"],
        ),
    )
    improvement = chosen["evidence_recall"] - baseline["evidence_recall"]
    passed = improvement >= selection["minimum_development_gain"]
    gates = []
    for summary in summaries:
        if summary["strategy"] != chosen["strategy"]:
            continue
        base = next(
            s
            for s in summaries
            if (s["source"], s["split"], s["strategy"])
            == (summary["source"], summary["split"], "rule")
        )
        gate = {
            "source": summary["source"],
            "split": summary["split"],
            "no_new_evidence_loss": summary["evidence_lost"] == 0,
            "no_source_completeness_regression": summary["all_sources_found"]
            >= base["all_sources_found"],
        }
        gates.append(gate)
        passed &= (
            gate["no_new_evidence_loss"] and gate["no_source_completeness_regression"]
        )
    return {
        "development_candidate": chosen["strategy"],
        "development_gain": round(improvement, 6),
        "development_gain_gate": improvement >= selection["minimum_development_gain"],
        "regression_gates": gates,
        "accepted": bool(passed),
        "business_defaults_changed": False,
        "scope": "Exposed synthetic fixed-pool regression only; no production or answer acceptance",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--replay", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = analyze(
        Path(__file__).resolve().parents[2],
        json.loads(args.protocol.read_text()),
        json.loads(args.replay.read_text()),
    )
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result["decision"], ensure_ascii=False))
