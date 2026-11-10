"""Apply frozen recall quality gates; live safety and production load are separate."""


def assess(summary: dict, rows: list[dict], protocol: dict) -> dict:
    pool = summary["stages"]["pool"]
    limits = {
        "evidence_recall": "pool_evidence_recall_min",
        "all_sources_found": "pool_all_sources_rate_min",
        "all_evidence_found": "pool_all_evidence_rate_min",
    }
    checks = {
        metric: pool[metric] is not None and pool[metric] >= protocol[limit]
        for metric, limit in limits.items()
    }
    category_scores = {
        category: stages["pool"]["evidence_recall"]
        for category, stages in summary["by_category"].items()
        if stages["pool"]["answerable"]
    }
    checks["each_positive_category"] = bool(category_scores) and all(
        value >= protocol["pool_category_evidence_recall_min"]
        for value in category_scores.values()
    )
    merge_losses = sum(
        loss["cause"] == "merge_loss"
        for row in rows
        if row["budget"] == summary["budget_per_route"]
        and row["split"] == summary["split"]
        for loss in row["losses"]
    )
    checks["merge_loss"] = merge_losses <= protocol["merge_loss_max"]
    checks["serial_latency"] = summary["p95_ms"] <= protocol["p95_serial_ms_max"]
    return {
        "quality_and_serial_latency_passed": all(checks.values()),
        "checks": checks,
        "positive_category_evidence": category_scores,
        "merge_losses": merge_losses,
        "safety_status": "requires separate permission and generation consistency tests",
        "scope": "synthetic engineering gate, not production acceptance",
    }


def select_development_budget(summaries: list[dict]) -> int | None:
    eligible = [
        summary["budget_per_route"]
        for summary in summaries
        if summary["split"] == "development"
        and summary["acceptance"]["quality_and_serial_latency_passed"]
    ]
    return min(eligible) if eligible else None
