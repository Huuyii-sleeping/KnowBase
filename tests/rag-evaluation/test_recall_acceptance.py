import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools/rag-evaluation"))
from recall_acceptance import assess, select_development_budget


class RecallAcceptanceTests(unittest.TestCase):
    def test_frozen_thresholds_include_categories_latency_and_merge_losses(self):
        protocol = {
            "pool_evidence_recall_min": 0.95,
            "pool_all_sources_rate_min": 0.95,
            "pool_all_evidence_rate_min": 0.90,
            "pool_category_evidence_recall_min": 0.85,
            "merge_loss_max": 0,
            "p95_serial_ms_max": 500,
        }
        summary = {
            "split": "development",
            "budget_per_route": 10,
            "p95_ms": 500,
            "stages": {
                "pool": {
                    "evidence_recall": 0.95,
                    "all_sources_found": 0.95,
                    "all_evidence_found": 0.90,
                }
            },
            "by_category": {
                "positive": {"pool": {"answerable": 2, "evidence_recall": 0.85}},
                "negative": {"pool": {"answerable": 0, "evidence_recall": None}},
            },
        }
        result = assess(summary, [], protocol)
        self.assertTrue(result["quality_and_serial_latency_passed"])
        summary["p95_ms"] = 501
        summary["by_category"]["positive"]["pool"]["evidence_recall"] = 0.84
        result = assess(
            summary,
            [
                {
                    "split": "development",
                    "budget": 10,
                    "losses": [{"cause": "merge_loss"}],
                }
            ],
            protocol,
        )
        self.assertFalse(result["checks"]["serial_latency"])
        self.assertFalse(result["checks"]["each_positive_category"])
        self.assertFalse(result["checks"]["merge_loss"])

    def test_budget_selection_never_uses_validation_results(self):
        def row(split, budget, passed):
            return {
                "split": split,
                "budget_per_route": budget,
                "acceptance": {"quality_and_serial_latency_passed": passed},
            }

        self.assertEqual(
            select_development_budget(
                [
                    row("validation", 5, True),
                    row("development", 15, True),
                    row("development", 10, True),
                ]
            ),
            10,
        )
        self.assertIsNone(
            select_development_budget(
                [row("development", 5, False), row("validation", 5, True)]
            )
        )
