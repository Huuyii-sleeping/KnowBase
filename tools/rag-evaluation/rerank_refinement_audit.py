"""Grade completed rerank ablations using original unchanged literal annotations."""

import argparse
import hashlib
import json
import math
from pathlib import Path
from statistics import mean, median

from recall_audit import evidence_hits
from rerank_metrics import evidence_changes, grade_selection
from rerank_model_input import fingerprint
from rerank_refinement_decision import decide

ROOT = Path(__file__).resolve().parents[2]


def validate_scores(scores, replay, protocol, group):
    expected = [{**case, "repeat": repeat} for repeat in range(protocol.get(group + "_repeats", 1))
                for case in protocol[group + "_cases"]]
    if scores.get("complete") is not True or scores.get("protocol_sha256") != fingerprint(protocol) or scores.get("group") != group:
        raise ValueError("incomplete or foreign protocol scores")
    if [{k: r[k] for k in ["source", "id", "repeat"]} for r in scores["rows"]] != expected:
        raise ValueError("incomplete or reordered score rows")
    lookup = {(s["id"], r["id"]): r for s in replay["sources"] for r in s["rows"]}
    for row in scores["rows"]:
        pool = lookup[(row["source"], row["id"])]["pool"]
        if row["chunk_ids"] != [p["chunkId"] for p in pool] or set(row["variants"]) != {v["id"] for v in protocol[group + "_variants"]}:
            raise ValueError("candidate identities or variants differ")
        for result in row["variants"].values():
            if len(result["scores"]) != len(pool) or len(result["diagnostics"]) != len(pool):
                raise ValueError("incomplete score vector")
            if any(not math.isfinite(s) for s in result["scores"]) or not math.isfinite(result["elapsed_ms"]) or result["elapsed_ms"] < 0:
                raise ValueError("nonfinite scores or invalid timing")
            if any(d["windows"] < 1 for d in result["diagnostics"]):
                raise ValueError("invalid windows")


def grade_replay(replay):
    details = []
    for source in replay["sources"]:
        questions = {q["id"]: q for q in json.loads((ROOT / source["dataset"] / "questions.json").read_text())}
        mapping = {d["file"]: d["id"] for d in source["metadata"]["document_mapping"]}
        for row in source["rows"]:
            q = questions[row["id"]]
            pool = {p["chunkId"]: p for p in row["pool"]}
            for strategy, option in row["options"].items():
                if len(set(option["selected"])) != len(option["selected"]):
                    raise ValueError("duplicate selected candidates")
                selected = [pool[c] for c in option["selected"]]
                metrics = grade_selection(q, row["pool"], selected, mapping)
                details.append({"source": source["id"], "id": q["id"], "split": q["split"],
                                "strategy": strategy, "metrics": metrics,
                                "top1_hit": any(evidence_hits(q, selected[:1], mapping)),
                                "vs_rule": evidence_changes(q, [pool[c] for c in row["options"]["rule"]["selected"]], selected, mapping),
                                "vs_current": evidence_changes(q, [pool[c] for c in row["options"]["current"]["selected"]], selected, mapping)})
    summaries = []
    for key in sorted({(r["source"], r["split"], r["strategy"]) for r in details}):
        rows = [r for r in details if (r["source"], r["split"], r["strategy"]) == key]
        summary = dict(zip(["source", "split", "strategy"], key))
        summary.update({"questions": len(rows)})
        for metric in ["evidence_recall", "all_evidence_found", "all_sources_found", "evidence_mrr"]:
            values = [r["metrics"][metric] for r in rows if r["metrics"][metric] is not None]
            summary[metric] = mean(values) if values else None
        summary["top1_hit"] = mean(r["top1_hit"] for r in rows if r["metrics"]["evidence_recall"] is not None)
        for baseline in ["rule", "current"]:
            for change in ["gained", "lost"]:
                summary[f"{baseline}_{change}"] = sum(len(r[f"vs_{baseline}"][change]) for r in rows)
        summaries.append(summary)
    return {"summaries": summaries, "details": details}


def locate_losses(replay):
    losses = []
    for source in replay["sources"]:
        questions = {q["id"]: q for q in json.loads((ROOT / source["dataset"] / "questions.json").read_text())}
        mapping = {d["file"]: d["id"] for d in source["metadata"]["document_mapping"]}
        for row in source["rows"]:
            q = questions[row["id"]]
            by_id = {p["chunkId"]: p for p in row["pool"]}
            changes = evidence_changes(q, [by_id[c] for c in row["options"]["rule"]["selected"]],
                                       [by_id[c] for c in row["options"]["bge-m3-anchor2-model-order"]["selected"]], mapping)
            model_order = sorted(row["options"]["bge-m3"]["decisions"], key=lambda d: -d["score"])
            decisions = {d["chunkId"]: d for d in row["options"]["bge-m3-anchor2-model-order"]["decisions"]}
            for index in changes["lost"]:
                candidates = [p for p in row["pool"] if evidence_hits({"evidence": [q["evidence"][index]]}, [p], mapping)[0]]
                losses.append({"source": source["id"], "id": q["id"], "evidence_index": index, "evidence": q["evidence"][index],
                               "candidates": [{"chunkId": p["chunkId"], "title": p["title"],
                                               "model_rank": next(i + 1 for i, d in enumerate(model_order) if d["chunkId"] == p["chunkId"]),
                                               "rule_selected_rank": row["options"]["rule"]["selected"].index(p["chunkId"]) + 1 if p["chunkId"] in row["options"]["rule"]["selected"] else None,
                                               "admission": decisions[p["chunkId"]]} for p in candidates]})
    return losses


def performance_summary(scores, replay, protocol):
    lookup = {(s["id"], r["id"]): r for s in replay["sources"] for r in s["rows"]}
    questions = {s["id"]: {q["id"]: q for q in json.loads((ROOT / s["dataset"] / "questions.json").read_text())}
                 for s in replay["sources"]}
    mappings = {s["id"]: {d["file"]: d["id"] for d in s["metadata"]["document_mapping"]} for s in replay["sources"]}
    # Call the existing JS selector to retain exact UTF-16 character limits.
    import subprocess
    script = "const {selectVariant}=require('./tools/rag-evaluation/rerank-refinement.cjs'); const fs=require('fs'); const x=JSON.parse(fs.readFileSync(0,'utf8')); console.log(JSON.stringify(x.map(t=>selectVariant(t.row,t.scores,{},t.constraints).selected)));"
    tasks = [{"row": lookup[(r["source"], r["id"])], "scores": v["scores"], "constraints": protocol["constraints"]}
             for r in scores["rows"] for v in r["variants"].values()]
    selections = iter(json.loads(subprocess.check_output(["node", "-e", script], input=json.dumps(tasks).encode(), cwd=ROOT)))
    trials = []
    for r in scores["rows"]:
        selected = {name: next(selections) for name in r["variants"]}
        row = lookup[(r["source"], r["id"])]
        by_id = {p["chunkId"]: p for p in row["pool"]}
        q, mapping = questions[r["source"]][r["id"]], mappings[r["source"]]
        for name, result in r["variants"].items():
            base = r["variants"]["title"]
            items = [by_id[c] for c in selected[name]]
            paired = evidence_changes(q, [by_id[c] for c in selected["title"]], items, mapping)
            current = evidence_changes(q, [by_id[c] for c in row["options"]["bge-m3-anchor2-model-order"]["selected"]], items, mapping)
            trials.append({"source": r["source"], "id": r["id"], "repeat": r["repeat"], "variant": name,
                           "baseline_ms": base["elapsed_ms"], "ms": result["elapsed_ms"],
                           "same_membership": set(selected[name]) == set(selected["title"]),
                           "same_order": selected[name] == selected["title"],
                           "max_score_difference": max(abs(a-b) for a, b in zip(base["scores"], result["scores"])),
                           "paired_evidence_changes": paired, "current_evidence_changes": current,
                           "query_tokens_dropped": sum(d["query_tokens_dropped"] for d in result["diagnostics"]),
                           "windows": sum(d["windows"] for d in result["diagnostics"])})
    summaries = []
    for repeat, variant in sorted({(r["repeat"], r["variant"]) for r in trials}):
        rows = [r for r in trials if (r["repeat"], r["variant"]) == (repeat, variant)]
        before, after = median(r["baseline_ms"] for r in rows), median(r["ms"] for r in rows)
        faster = sum(r["ms"] < r["baseline_ms"] for r in rows)
        summaries.append({"repeat": repeat, "variant": variant, "baseline_p50_ms": before, "p50_ms": after,
                          "median_reduction": 1-after/before, "faster_cases": faster,
                          "same_membership": all(r["same_membership"] for r in rows), "same_order": all(r["same_order"] for r in rows),
                          "max_score_difference": max(r["max_score_difference"] for r in rows),
                          "paired_evidence_lost": sum(len(r["paired_evidence_changes"]["lost"]) for r in rows),
                          "paired_evidence_gained": sum(len(r["paired_evidence_changes"]["gained"]) for r in rows),
                          "current_evidence_lost": sum(len(r["current_evidence_changes"]["lost"]) for r in rows),
                          "query_tokens_dropped": sum(r["query_tokens_dropped"] for r in rows),
                          "speed_gate": after <= before * 0.8 and faster >= 10})
    return {"summaries": summaries, "trials": trials}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--protocol", type=Path, required=True)
    parser.add_argument("--kind", choices=["selection", "input", "performance", "losses"], required=True)
    parser.add_argument("--data", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    protocol = json.loads(args.protocol.read_text())
    for file, expected in protocol["files_sha256"].items():
        if hashlib.sha256((ROOT/file).read_bytes()).hexdigest() != expected:
            raise ValueError("fingerprint differs: " + file)
    replay = json.loads((ROOT/protocol["replay"]).read_text())
    data = json.loads(args.data.read_text()) if args.data else None
    if args.kind == "losses":
        result = {"losses": locate_losses(replay)}
    elif args.kind == "performance":
        validate_scores(data, replay, protocol, "performance")
        result = performance_summary(data, replay, protocol)
    else:
        result = grade_replay(data)
        result["decision"] = decide(result["summaries"], protocol[args.kind + "_variants"], args.kind)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result.get("summaries", result), ensure_ascii=False))
