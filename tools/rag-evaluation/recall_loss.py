"""Attribute frozen evidence loss without confusing safety filters with budgets."""

from metrics import normalized


def locate_loss(stages: dict, index: int) -> str | None:
    def hit(stage):
        return stages[stage]["evidence_hits"][index]

    if not hit("indexed"):
        return "missing_or_split_in_index"
    if not (hit("keyword_raw") or hit("semantic_raw")):
        return "not_in_raw_candidates"
    if not (hit("keyword") or hit("semantic")):
        if "keyword_eligible" not in stages:
            return "filtered_or_route_budget"
        if hit("keyword_eligible") or hit("semantic_eligible"):
            return "route_budget"
        return "metadata_filter"
    if not hit("pool"):
        return "merge_loss"
    if not hit("selected"):
        return "selection_loss"
    return None


def route_details(evidence: dict, trace: dict, mapping: dict) -> dict:
    details = {}
    for route in ("keyword", "semantic"):
        source = trace[route]

        def rank(field):
            return next(
                (
                    i + 1
                    for i, item in enumerate(source.get(field, []))
                    if item["documentId"] == mapping[evidence["doc"]]
                    and normalized(evidence["quote"])
                    in normalized(item.get("content", ""))
                ),
                None,
            )

        raw, eligible, retained = (
            rank("rawCandidates"),
            rank("eligibleCandidates"),
            rank("items"),
        )
        reason = (
            "retained"
            if retained
            else (
                "not_in_raw_candidates"
                if not raw
                else (
                    "filtered_or_route_budget"
                    if "eligibleCandidates" not in source
                    else "route_budget" if eligible else "metadata_filter"
                )
            )
        )
        details[route] = {
            "raw_rank": raw,
            "eligible_rank": eligible,
            "retained_rank": retained,
            "reason": reason,
        }
    return details
