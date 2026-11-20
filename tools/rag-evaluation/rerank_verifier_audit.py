"""Map verifier IDs to original evidence and grade the isolated pilot."""

import argparse
import json
from pathlib import Path
from statistics import mean, median

from rerank_model_input import fingerprint
from rerank_verifier import validate_verdict
from rerank_verifier_run import ROOT, prepare
from rerank_trials_audit import audit


def replay_verdicts(protocol, result):
    if result.get("complete") is not True or result.get("protocol_sha256") != fingerprint(protocol):
        raise ValueError("incomplete or foreign verifier results")
    tasks = prepare(protocol)
    if len(tasks) != len(result["rows"]):
        raise ValueError("incomplete verifier rows")
    original = json.loads((ROOT / protocol["replay"]).read_text())
    selected_rows = {}
    for task, verdict in zip(tasks, result["rows"]):
        if any(verdict[k] != task[k] for k in ["source", "id", "input_sha256"]):
            raise ValueError("verifier result identity differs")
        validate_verdict(verdict, task["candidates"])
        by_id = {f"P{i}": p for i, p in enumerate(task["pool"])}
        counts, selected, decisions, characters = {}, [], [], 0
        for alias in verdict["selected"]:
            p = by_id[alias]
            # Match API UTF-16 character budget, retaining first-oversized exception.
            size = len((p.get("content") or "").encode("utf-16-le")) // 2
            reason = ("document_cap" if counts.get(p["documentId"], 0) >= protocol["constraints"]["maxChunksPerDocument"]
                      else "character_budget" if selected and characters + size > protocol["constraints"]["maxContextCharacters"]
                      else "selected")
            decisions.append({"chunkId": p["chunkId"], "reason": reason})
            if reason != "selected":
                continue
            selected.append(p["chunkId"])
            characters += size
            counts[p["documentId"]] = counts.get(p["documentId"], 0) + 1
        selected_rows[task["source"], task["id"]] = {"selected": selected, "decisions": decisions, "characters": characters}
    sources = []
    for source in original["sources"]:
        rows = [{**r, "options": {"rule": r["options"]["rule"], "current": r["options"]["short"],
                                   "verified": selected_rows[source["id"], r["id"]]}}
                for r in source["rows"] if (source["id"], r["id"]) in selected_rows]
        if rows:
            sources.append({**source, "rows": rows})
    return {"sources": sources}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("protocol", type=Path)
    parser.add_argument("verdicts", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    p, result = json.loads(args.protocol.read_text()), json.loads(args.verdicts.read_text())
    replay = replay_verdicts(p, result)
    graded = audit(replay)
    graded["latency"] = {"p50_ms": median(r["elapsed_ms"] for r in result["rows"]),
                         "mean_ms": mean(r["elapsed_ms"] for r in result["rows"]),
                         "scope": "Additional local verifier wall time including cold model load, not BGE or full request time."}
    args.output.write_text(json.dumps({"replay": replay, "audit": graded}, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"overall": graded["overall"], "changes": graded["changes"], "latency": graded["latency"]}, ensure_ascii=False, indent=2))
