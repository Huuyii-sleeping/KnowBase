"""Compare policy outcomes without treating unannotated chunks as irrelevant."""

import argparse
from collections import Counter
import json
from pathlib import Path
from statistics import mean

from rerank_refinement_audit import grade_replay

ROOT = Path(__file__).resolve().parents[2]


def summarize(rows):
    answerable = [r for r in rows if r["type"] == "answerable"]
    negative = [r for r in rows if r["type"] == "unanswerable"]
    return {
        "pools": len(rows), "answerable": len(answerable), "unanswerable": len(negative),
        "evidence_recall": mean(r["metrics"]["evidence_recall"] for r in answerable) if answerable else None,
        "top1_hit": mean(r["top1_hit"] for r in answerable) if answerable else None,
        "all_sources_found": mean(r["metrics"]["all_sources_found"] for r in answerable) if answerable else None,
        "gained": sum(len(r["vs_current"]["gained"]) for r in rows),
        "lost": sum(len(r["vs_current"]["lost"]) for r in rows),
        "mean_selected_count": mean(r["selected_count"] for r in rows),
        "mean_characters": mean(r["characters"] for r in rows),
        "negative_empty": sum(r["selected_count"] == 0 for r in negative),
        "negative_empty_rate": mean(r["selected_count"] == 0 for r in negative) if negative else None,
        "answerable_empty": sum(r["selected_count"] == 0 for r in answerable),
        "answerable_empty_rate": mean(r["selected_count"] == 0 for r in answerable) if answerable else None,
        "rejection_reasons": dict(Counter(reason for r in rows for reason in r["rejection_reasons"])),
        "selection_diagnostics": {key: sum(r.get("selection_diagnostics", {}).get(key, 0) for r in rows)
                                  for key in ["nearPairs085", "nearPairs095", "exactBodyPairs",
                                              "changedOrderOrMembership", "changedMembership"]},
    }


def audit(replay):
    graded = grade_replay(replay)
    details = {(d["source"], d["id"], d["strategy"]): d for d in graded["details"]}
    rows, changes = [], []
    for source in replay["sources"]:
        questions = {q["id"]: q for q in json.loads((ROOT / source["dataset"] / "questions.json").read_text())}
        for row in source["rows"]:
            q = questions[row["id"]]
            for strategy, option in row["options"].items():
                detail = details[source["id"], row["id"], strategy]
                rows.append({**detail, "type": q["type"], "selected_count": len(option["selected"]),
                             "characters": option["characters"],
                             "selection_diagnostics": option.get("selectionDiagnostics", {}),
                             "rejection_reasons": [d["reason"] for d in option["decisions"] if d["reason"] not in ["selected", "top_k", "document_cap", "character_budget"]]})
                gained, lost = detail["vs_current"]["gained"], detail["vs_current"]["lost"]
                if gained or lost:
                    changes.append({"source": source["id"], "id": row["id"], "split": q["split"],
                                    "strategy": strategy, "question": q["question"],
                                    "gained": [q["evidence"][i] for i in gained],
                                    "lost": [q["evidence"][i] for i in lost]})
    strategies = sorted({r["strategy"] for r in rows})
    overall = {s: summarize([r for r in rows if r["strategy"] == s]) for s in strategies}
    groups = [{"source": source, "split": split, "strategy": strategy,
               **summarize([r for r in rows if (r["source"], r["split"], r["strategy"]) == (source, split, strategy)])}
              for source, split, strategy in sorted({(r["source"], r["split"], r["strategy"]) for r in rows})]
    return {"overall": overall, "groups": groups, "changes": changes,
            "scope": "Exposed synthetic pools; repeated holdout questions count as source-config instances. Literal evidence annotations are not complete relevance labels; no Precision claim."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("replay", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = audit(json.loads(args.replay.read_text()))
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(result["overall"], ensure_ascii=False, indent=2))
