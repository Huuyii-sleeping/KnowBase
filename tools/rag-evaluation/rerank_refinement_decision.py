"""Apply the predeclared development selection and per-group regression gates."""


def decide(summaries, variants, stage):
    eligible = [v["id"] for v in variants if not v.get("diagnostic") and v["id"] != "anchor2-control"]
    lookup = {(s["source"], s["split"], s["strategy"]): s for s in summaries}
    key = ("v3-candidate", "development")
    if not eligible or any((*key, s) not in lookup for s in ["rule", "current", *eligible]):
        raise ValueError("missing development summaries or eligible variants")
    chosen = max(eligible, key=lambda s: tuple(lookup[(*key, s)][m] for m in ["evidence_recall", "all_evidence_found", "evidence_mrr"]))
    baseline = lookup[(*key, "current" if stage == "input" else "rule")]
    gain = lookup[(*key, chosen)]["evidence_recall"] - baseline["evidence_recall"]
    gates = []
    for summary in summaries:
        if summary["strategy"] != chosen:
            continue
        current = lookup[(summary["source"], summary["split"], "current")]
        rule = lookup[(summary["source"], summary["split"], "rule")]
        gates.append({"source": summary["source"], "split": summary["split"],
                      "zero_new_losses_vs_rule": summary["rule_lost"] == 0,
                      "zero_new_losses_vs_current": summary["current_lost"] == 0,
                      "coverage_not_lower_than_current": summary["evidence_recall"] >= current["evidence_recall"],
                      "source_completeness_not_lower": summary["all_sources_found"] >= max(current["all_sources_found"], rule["all_sources_found"])})
    passed = gain >= 0.02 and all(all(v for k, v in g.items() if k not in ["source", "split"]) for g in gates)
    return {"development_candidate": chosen, "gain": gain, "gain_gate": gain >= 0.02,
            "regression_gates": gates, "stage_passed": passed,
            "production_accepted": False,
            "next": "score remaining fixed pools before adoption" if passed and stage == "input" else "stop this candidate" if not passed else "complete runtime and capacity acceptance"}
